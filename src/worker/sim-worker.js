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
 * `{ heights, clr, textureValues, ra0, ra1, boxes, ramps, waterLevelFt, weather, difficulty, truck: { anchors, scrapePoints }, start: { pos, heading } }`.
 * `ra0` / `ra1` are the level's ground-box layers and `boxes` its collision boxes (track-build.js).
 */
export function createSession(init) {
  const terrain = S.createTerrain(new Uint8Array(init.heights), init.waterLevelFt ?? null);
  const surfaces = init.clr && init.textureValues
    ? S.createSurfaceMap(new Uint16Array(init.clr), new Int32Array(init.textureValues))
    : null;
  const ground = S.createTerrainGround(terrain, surfaces, init.weather ?? 0, init.waterLevelFt ?? null);
  const difficulty = init.difficulty ?? S.DIFFICULTY.INTERMEDIATE;
  const params = S.createTruckParams(
    { wheelAnchors: init.truck.anchors, scrapePoints: init.truck.scrapePoints },
    { difficulty, autoShift: init.autoShift ?? true },
  );
  const state = S.createTruckState(init.start.pos, init.start.heading ?? 0, S.GEAR.FIRST, params);
  const ra0 = init.ra0 ? new Uint8Array(init.ra0) : null;
  const ra1 = init.ra1 ? new Uint8Array(init.ra1) : null;
  const levelBoxes = [];
  /** Type 10 boxes and their SIT bvel (MTM2_PHYSICS.md 14.18). */
  const trains = [];
  for (const b of init.boxes ?? []) {
    const box = S.createLevelBox(b, b.bounds);
    if (box) { box.sitIndex = b.sitIndex; levelBoxes.push(box); }
    if (box && b.bvel) trains.push({ box, bvel: b.bvel });
  }
  const allRamps = (init.ramps ?? []).map((r) => S.createRamp(r, r.bounds)).filter(Boolean);
  const nearBoxes = [];
  const listed = [];
  const truckRadius = S.truckRadius(params);
  /** Boxes whose pose changed since the last `advance` reply. */
  const dirty = new Set();
  // Until the race rules exist (M6) the dev session counts as racing, with no course: a reset
  // keeps the heading and the helicopter sets the truck down where it was.
  const recovery = {
    racing: true, player: true, autopilot: false, difficulty, summit: false, segment: null, previous: null,
  };
  const ctx = { ground, human: true, difficulty, sonicTrack: false, recovery };
  let time = 0;
  let previous = snapshot(state);
  const keys = { accelerate: false, brake: false, left: false, right: false };

  /**
   * This frame's boxes (MTM2_PHYSICS.md 14.15): those within r + R + 10 ft on x and z of the truck
   * or of a box already listed, and those moving faster than 0.1 ft/s.
   */
  function listBoxes() {
    listed.length = 0;
    const near = (x, z, r, box) => {
      const range = r + box.radius + 10;
      return Math.abs(box.pos[0] - x) < range && Math.abs(box.pos[2] - z) < range;
    };
    for (const box of levelBoxes) {
      const moving = Math.hypot(box.vel[0], box.vel[1], box.vel[2]) > 0.1;
      if (moving || near(state.pos[0], state.pos[2], truckRadius, box) || listed.some((o) => near(o.pos[0], o.pos[2], o.radius, box))) {
        listed.push(box);
      }
    }
    // Ramps after the boxes, near the truck or a listed box (14.19); their tops are ground.
    ground.ramps.length = 0;
    for (const ramp of allRamps) {
      if (near(state.pos[0], state.pos[2], truckRadius, ramp) || listed.some((o) => near(o.pos[0], o.pos[2], o.radius, ramp))) {
        ground.ramps.push(ramp);
      }
    }
  }

  /** The pair tests (14.14, 14.17): ground boxes around the truck, then the listed level boxes. */
  function collideBoxes() {
    if (state.heliTimer > 0) return;
    nearBoxes.length = 0;
    if (ra0 && ra1) S.groundBoxesAround(ra0, ra1, state.pos[0], state.pos[2], nearBoxes);
    for (const box of nearBoxes) S.collideTruckImmovableBox(state, params, box, STEP);
    for (const box of listed) S.collideTruckBox(state, params, box, STEP);
  }

  /** A moved box's pose for drawing. */
  const boxPose = (box) => ({ sitIndex: box.sitIndex, pos: [...box.pos], matrix: Array.from(box.matrix) });

  /** Step one fixed step with the held keys. */
  function step(input) {
    const { joystick = null, helicopter = false, ...held } = input ?? {};
    Object.assign(keys, held);
    if (helicopter) {
      S.pressHelicopterKey(state, { dragRace: false, summit: recovery.summit });
      input.helicopter = false;
    }
    const controlCtx = {
      dt: STEP, autoShift: params.autoShift, forwardSpeed: state.bvel[2], dragMode: false, segments: 0, difficulty,
    };
    // The keyboard routine always runs; a joystick then overwrites it (MONSTER_EXE_ANALYSIS.md §7).
    S.applyKeyboard(state.controls, keys, controlCtx);
    if (joystick) S.applyJoystick(state.controls, joystick, controlCtx);
    keys.shiftUp = keys.shiftDown = false;
    if (joystick) joystick.shiftUp = joystick.shiftDown = false;
    previous = snapshot(state);
    // Trains move before the frame's list is built; the dev session counts as racing from the start.
    for (const { box, bvel } of trains) {
      S.moveTrain(box, bvel, terrain, ra0, ra1, STEP, (init.weather ?? 0) === S.WEATHER.SNOW);
      dirty.add(box);
    }
    listBoxes();
    const before = listed.map(poseKey);
    S.stepTruck(state, params, ctx, STEP);
    for (const box of listed) S.stepBox(box, ground, STEP);
    collideBoxes();
    S.postStepTruck(state, params, ground, STEP);
    listed.forEach((box, i) => {
      S.postStepBox(box, ground);
      if (before[i] !== poseKey(box)) dirty.add(box);
    });
    time += STEP;
  }

  /** Catch up with `seconds` of wall time; returns the states to interpolate between. */
  function advance(seconds, input) {
    const target = Math.min(seconds, time + MAX_CATCH_UP);
    if (time < target - MAX_CATCH_UP) time = target - MAX_CATCH_UP;
    let steps = 0;
    while (time + STEP <= target) { step(input); steps++; }
    const boxes = [...dirty].map(boxPose);
    dirty.clear();
    return { previous, current: snapshot(state), alpha: (target - time) / STEP, time, steps, boxes };
  }

  return { state, params, ground, levelBoxes, step, advance, snapshot: () => snapshot(state) };
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
      if (origin === null) origin = tMs;
      return session.advance((tMs - origin) / 1000, input);
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
