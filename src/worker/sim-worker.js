/*
  The simulation worker: owns the race session and steps it at a fixed 1/60 s (docs/PLAN.md,
  "Threads and timing").

  Protocol (shared/worker-client.js): `init` sets up a session from plain data (terrain,
  surfaces, the truck's geometry and start pose); each `tick { tMs, input }` steps until the
  simulation has caught up with `tMs` (at most 0.25 s of catch-up) and replies with the last two
  states so the main thread can interpolate between them.

  Everything here is portable: the same code runs in Node tests through `createSession`.
*/
import { mtm2Sim as S } from "../vendor/openphotex/index.js";

export const STEP = 1 / 60;


/** A cheap fingerprint of a box's pose, to tell which boxes moved. */
const poseKey = (b) => `${b.pos[0]},${b.pos[1]},${b.pos[2]},${b.matrix[2]},${b.matrix[5]},${b.matrix[6]}`;
const MAX_CATCH_UP = 0.25;
/** Race time the fast simulation gives the trucks still racing (MONSTER_EXE_ANALYSIS.md 5). */
const FAST_SIMULATION_S = 240;

/** A pose for drawing: position (feet), rotation matrix, and per-tire wheel state. */
function snapshot(state) {
  return {
    pos: Array.from(state.pos),
    matrix: Array.from(state.matrix),
    euler: Array.from(state.euler),
    tires: state.tires.map((t) => ({ angle: t.angle, onGround: t.onGround })),
    axles: state.axles.map((a) => ({ articulation: a.articulation, travel: a.travel })),
    steer: state.controls.steer,
    rearSteer: state.controls.rearSteer,
    speed: Math.hypot(state.bvel[0], state.bvel[1], state.bvel[2]),
    forward: state.bvel[2],
    gear: state.controls.gear,
    rpm: state.rpm,
    throttle: state.controls.throttle,
    heliTimer: state.heliTimer,
  };
}

/**
 * A session from plain data:
 * `{ heights, clr, textureValues, ra0, ra1, boxes, ramps, course, sonicTrack, waterLevelFt, weather, difficulty, trucks, race }`,
 * with `trucks` a list of `{ truck: { anchors, scrapePoints }, start: { pos, heading }, autopilot }`
 * (the first is the player's), or the single-truck form `{ truck, start, autopilot }`.
 * `ra0` / `ra1` are the level's ground-box layers and `boxes` its collision boxes (track-build.js);
 * `race`, when given, is `{ checkpoints, laps }` and runs the race rules (MTM2_PHYSICS.md 14.24).
 */
export function createSession(init) {
  const terrain = S.createTerrain(new Uint8Array(init.heights), init.waterLevelFt ?? null);
  const surfaces = init.clr && init.textureValues
    ? S.createSurfaceMap(new Uint16Array(init.clr), new Int32Array(init.textureValues))
    : null;
  const ground = S.createTerrainGround(terrain, surfaces, init.weather ?? 0, init.waterLevelFt ?? null);
  const difficulty = init.difficulty ?? S.DIFFICULTY.INTERMEDIATE;
  const sonicTrack = !!init.sonicTrack;
  const ra0 = init.ra0 ? new Uint8Array(init.ra0) : null;
  const ra1 = init.ra1 ? new Uint8Array(init.ra1) : null;
  const levelBoxes = [];
  /** Moving objects: type 10 boxes and their SIT bvel (MTM2_PHYSICS.md 14.18). */
  const movingObjects = [];
  for (const b of init.boxes ?? []) {
    const box = S.createLevelBox(b, b.bounds);
    if (box) { box.sitIndex = b.sitIndex; levelBoxes.push(box); }
    if (box && b.bvel) movingObjects.push({ box, bvel: b.bvel });
  }
  const allRamps = (init.ramps ?? []).map((r) => S.createRamp(r, r.bounds)).filter(Boolean);
  // The course's straights with the arcs built between them, over the ground the probes see
  // (MTM2_PHYSICS.md 12, 14.22).
  const course = S.buildCourse(init.course ?? [], (x, z) => ground.height(x, z), {
    sonicTrack, gripK: sonicTrack && difficulty === S.DIFFICULTY.PROFESSIONAL ? 2 : 1.75,
  });
  const apCtx = { course, height: (x, z) => ground.height(x, z), dt: STEP, difficulty, sonicTrack };

  const specs = init.trucks ?? [{ truck: init.truck, start: init.start, autopilot: init.autopilot }];
  const trucks = specs.map((spec, i) => {
    const params = S.createTruckParams(
      { wheelAnchors: spec.truck.anchors, scrapePoints: spec.truck.scrapePoints },
      { difficulty, autoShift: init.autoShift ?? true },
    );
    const state = S.createTruckState(spec.start.pos, spec.start.heading ?? 0, S.GEAR.FIRST, params);
    const autopilot = !!spec.autopilot && course.length > 0;
    // Without a course the reset keeps the heading and the helicopter sets the truck down in place.
    const recovery = {
      racing: true, player: i === 0 && !autopilot, autopilot, difficulty, summit: false, segment: null, previous: null,
    };
    const ctx = { ground, human: i === 0 && !autopilot, difficulty, sonicTrack, recovery };
    return { state, params, autopilot, recovery, ctx, radius: S.truckRadius(params), nearBoxes: [] };
  });
  const player = trucks[0];
  // Traffic (MTM2_PHYSICS.md 14.25): every truck sees the others' last values.
  if (trucks.length > 1) apCtx.traffic = trucks.map((t) => ({ s: t.state, p: t.params }));
  const race = init.race
    ? S.createRace(trucks.map((t, i) => ({ s: t.state, p: t.params, player: i === 0 && !t.autopilot })),
      S.raceCheckpoints(init.race.checkpoints), course, init.race.laps ?? 3, difficulty)
    : null;

  const listed = [];
  /** Boxes whose pose changed since the last `advance` reply. */
  const dirty = new Set();
  let time = 0;
  for (const t of trucks) t.previous = snapshot(t.state);
  let started = false;
  const keys = { accelerate: false, brake: false, left: false, right: false };

  /**
   * This frame's boxes (MTM2_PHYSICS.md 14.15): those within r + R + 10 ft on x and z of a truck
   * or of a box already listed, and those moving faster than 0.1 ft/s; then the ramps (14.19).
   */
  function listBoxes() {
    listed.length = 0;
    const near = (x, z, r, box) => {
      const range = r + box.radius + 10;
      return Math.abs(box.pos[0] - x) < range && Math.abs(box.pos[2] - z) < range;
    };
    const nearTruck = (box) => trucks.some((t) => near(t.state.pos[0], t.state.pos[2], t.radius, box));
    for (const box of levelBoxes) {
      const moving = Math.hypot(box.vel[0], box.vel[1], box.vel[2]) > 0.1;
      if (moving || nearTruck(box) || listed.some((o) => near(o.pos[0], o.pos[2], o.radius, box))) listed.push(box);
    }
    ground.ramps.length = 0;
    for (const ramp of allRamps) {
      if (nearTruck(ramp) || listed.some((o) => near(o.pos[0], o.pos[2], o.radius, ramp))) ground.ramps.push(ramp);
    }
  }

  /** The pair tests (14.14, 14.17, 14.20, 14.21), trucks first in list order. */
  function pairTests() {
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i + 1; j < trucks.length; j++) {
        S.collideTrucks({ s: trucks[i].state, p: trucks[i].params }, { s: trucks[j].state, p: trucks[j].params }, STEP);
      }
    }
    const grounds = [];
    for (const t of trucks) {
      t.nearBoxes.length = 0;
      if (t.state.heliTimer > 0) continue;
      if (ra0 && ra1) S.groundBoxesAround(ra0, ra1, t.state.pos[0], t.state.pos[2], t.nearBoxes);
      for (const box of t.nearBoxes) S.collideTruckImmovableBox(t.state, t.params, box, STEP);
      for (const box of listed) S.collideTruckBox(t.state, t.params, box, STEP);
      grounds.push(...t.nearBoxes);
    }
    const all = listed.length ? [...listed, ...grounds] : listed;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) S.collideBoxes(all[i], all[j], STEP);
    }
  }

  /** A moved box's pose for drawing. */
  const boxPose = (box) => ({ sitIndex: box.sitIndex, pos: [...box.pos], matrix: Array.from(box.matrix) });

  /** A truck's recovery context, aimed at its course segment when it has one (10.3). */
  function recoveryOf(t) {
    if (course.length) {
      t.recovery.segment = course[t.state.ap.segment];
      t.recovery.previous = course[(t.state.ap.segment + course.length - 1) % course.length];
    }
    return t.recovery;
  }

  /** Step one fixed step with the held keys (the player's truck). */
  function step(input) {
    const { joystick = null, helicopter = false, ...held } = input ?? {};
    Object.assign(keys, held);
    if (helicopter) {
      S.pressHelicopterKey(player.state, { dragRace: false, summit: player.recovery.summit });
      input.helicopter = false;
    }
    // The race tick comes first in the game's frame (0x487300): checkpoints, segments, the order.
    if (race) {
      S.raceTick(race, STEP, apCtx, { ground, rc: (rt) => recoveryOf(trucks[race.trucks.indexOf(rt)]) });
    }
    const go = !race || S.raceStarted(race);
    for (const [i, t] of trucks.entries()) {
      if (t.autopilot) {
        if (!race) S.advanceAutopilotSegment(t.state, apCtx);
        recoveryOf(t);
        if (go) S.applyAutopilot(t.state, t.params, apCtx);
        else t.state.controls.throttle = 0;
      } else if (i === 0) {
        const controlCtx = {
          dt: STEP, autoShift: t.params.autoShift, forwardSpeed: t.state.bvel[2], dragMode: false, segments: 0, difficulty,
        };
        // The keyboard routine always runs; a joystick then overwrites it (MONSTER_EXE_ANALYSIS.md §7).
        S.applyKeyboard(t.state.controls, keys, controlCtx);
        if (joystick) S.applyJoystick(t.state.controls, joystick, controlCtx);
      }
    }
    // The countdown (MONSTER_EXE_ANALYSIS.md 6.1): every truck sits in Park, so revving moves
    // nobody; at the start every truck goes into first.
    if (race && !go) {
      for (const t of trucks) {
        t.state.controls.gear = S.GEAR.PARK;
        t.state.controls.brakeFront = t.state.controls.brakeRear = 1;
      }
    } else if (race && !started) {
      started = true;
      for (const t of trucks) t.state.controls.gear = S.GEAR.FIRST;
    }
    keys.shiftUp = keys.shiftDown = false;
    if (joystick) joystick.shiftUp = joystick.shiftDown = false;
    for (const t of trucks) t.previous = snapshot(t.state);
    // Moving objects move before the frame's list is built, once the race runs.
    if (go) {
      for (const { box, bvel } of movingObjects) {
        S.stepMovingObject(box, bvel, terrain, ra0, ra1, STEP, (init.weather ?? 0) === S.WEATHER.SNOW);
        dirty.add(box);
      }
    }
    listBoxes();
    const before = listed.map(poseKey);
    for (const t of trucks) S.stepTruck(t.state, t.params, t.ctx, STEP);
    for (const box of listed) S.stepBox(box, ground, STEP);
    pairTests();
    for (const t of trucks) S.postStepTruck(t.state, t.params, ground, STEP);
    listed.forEach((box, i) => {
      S.postStepBox(box, ground);
      if (before[i] !== poseKey(box)) dirty.add(box);
    });
    time += STEP;
    if (race) handOverFinished();
  }

  /** Finished trucks go on autopilot (MTM2_PHYSICS.md 14.24); the player's too. */
  function handOverFinished() {
    race.trucks.forEach((rt, i) => {
      const t = trucks[i];
      if (!rt.finished || t.autopilot || !course.length) return;
      t.autopilot = true;
      t.ctx.human = false;
      t.recovery.player = false;
      t.recovery.autopilot = true;
    });
  }

  /** What the race HUD and the results show (MONSTER_EXE_ANALYSIS.md 6, 11). */
  function raceView() {
    if (!race) return null;
    const since = race.clock - race.startTime;
    return {
      started: since >= 0,
      countdown: Math.max(0, -since),
      clock: Math.max(0, since),
      laps: race.laps,
      over: race.over,
      trucks: race.trucks.map((rt) => ({
        place: rt.place,
        laps: rt.laps,
        lap: Math.min(rt.laps + 1, race.laps),
        lapTime: rt.finished ? (rt.lapTimes[rt.lapTimes.length - 1] ?? 0) : Math.max(0, since - rt.raceTime),
        best: rt.fastestLap,
        raceTime: rt.raceTime,
        finished: rt.finished,
        missed: rt.state === 3,
        checkpoint: rt.checkpoint,
      })),
    };
  }

  /**
   * After the player finishes: run the trucks still racing on, up to 240 s of race time, so each
   * gets a time (MONSTER_EXE_ANALYSIS.md 5, "End of race"). Returns the race view.
   */
  function finishRace() {
    if (!race) return null;
    const until = race.clock + FAST_SIMULATION_S;
    while (race.clock < until && !race.trucks.every((rt) => rt.finished)) step({});
    return raceView();
  }

  /** Catch up with `seconds` of wall time; returns the states to interpolate between. */
  function advance(seconds, input) {
    const target = Math.min(seconds, time + MAX_CATCH_UP);
    if (time < target - MAX_CATCH_UP) time = target - MAX_CATCH_UP;
    let steps = 0;
    while (time + STEP <= target) { step(input); steps++; }
    const boxes = [...dirty].map(boxPose);
    dirty.clear();
    const poses = trucks.map((t) => ({ previous: t.previous, current: snapshot(t.state) }));
    return {
      previous: poses[0].previous, current: poses[0].current, alpha: (target - time) / STEP, time, steps, boxes,
      others: poses.slice(1).map((x) => x.current), poses, race: raceView(),
    };
  }

  return {
    state: player.state, params: player.params, trucks, race, ground, levelBoxes, course,
    step, advance, raceView, finishRace, now: () => time, snapshot: () => snapshot(player.state),
  };
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  let session = null;
  let origin = null;
  const handlers = {
    init(payload) {
      session = createSession(payload);
      origin = null;
      return session.snapshot();
    },
    tick({ tMs, input }) {
      if (!session) throw new Error("No session.");
      // The simulated time carries on from where it stopped (a new session, or after a pause).
      if (origin === null) origin = tMs - session.now() * 1000;
      return session.advance((tMs - origin) / 1000, input);
    },
    /** Pause: the wall clock keeps running, so restart the catch-up from the next tick. */
    resume() {
      origin = null;
      return true;
    },
    finish() {
      if (!session) throw new Error("No session.");
      return session.finishRace();
    },
  };
  self.addEventListener("message", async ({ data }) => {
    const { id, type, payload } = data ?? {};
    try {
      const handler = handlers[type];
      if (!handler) throw new Error(`Unknown request "${type}"`);
      self.postMessage({ id, ok: true, payload: await handler(payload) });
    } catch (err) {
      self.postMessage({ id, ok: false, error: err?.message ?? String(err) });
    }
  });
  self.postMessage({ ready: true });
}
