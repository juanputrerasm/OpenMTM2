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
 * `{ heights, clr, textureValues, waterLevelFt, weather, difficulty, truck: { anchors, scrapePoints }, start: { pos, heading } }`.
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
  // Until the race rules exist (M6) the dev session counts as racing, with no course: a reset
  // keeps the heading and the helicopter sets the truck down where it was.
  const recovery = {
    racing: true, player: true, autopilot: false, difficulty, summit: false, segment: null, previous: null,
  };
  const ctx = { ground, human: true, difficulty, sonicTrack: false, recovery };
  let time = 0;
  let previous = snapshot(state);
  const keys = { accelerate: false, brake: false, left: false, right: false };

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
    S.stepTruck(state, params, ctx, STEP);
    S.postStepTruck(state, params, ground, STEP);
    time += STEP;
  }

  /** Catch up with `seconds` of wall time; returns the states to interpolate between. */
  function advance(seconds, input) {
    const target = Math.min(seconds, time + MAX_CATCH_UP);
    if (time < target - MAX_CATCH_UP) time = target - MAX_CATCH_UP;
    let steps = 0;
    while (time + STEP <= target) { step(input); steps++; }
    return { previous, current: snapshot(state), alpha: (target - time) / STEP, time, steps };
  }

  return { state, params, ground, step, advance, snapshot: () => snapshot(state) };
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
