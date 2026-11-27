/*
  The simulation worker: owns the race session and steps it at a fixed 1/60 s (docs/CHANGELOG.md,
  "Threads and timing").

  Protocol (shared/worker-client.js): `init` sets up a session from plain data (terrain,
  surfaces, the truck's geometry and start pose); each `tick { tMs, input }` steps until the
  simulation has caught up with `tMs` (at most 0.25 s of catch-up) and replies with the last two
  states so the main thread can interpolate between them.

  Everything here is portable: the same code runs in Node tests through `createSession`.
*/
import * as E from "../vendor/openphotex/sim/evo/index.js";
import * as Cp from "../vendor/openphotex/sim/cpr/index.js";
import * as C4 from "../vendor/openphotex/sim/cp4/index.js";
import * as S from "../vendor/openphotex/sim/mtm2/index.js";
import { createCrossingLog, raceGap, recordCrossings } from "../game/timing.js";
import { buildRumbleField, createRumbleDriver, rumbleControls } from "../game/rumble-ai.js";
import { CPU_FINISH_COAST_S, DQ_CODE, OUT, REVERSE_SPEED, STAGED, TREE_S, createDrag, pastFinish, dragCollision, dragLamps, dragOver, dragPedals, dragPlaces, dragTick, dragWallTouch, mirrorCourse, stageSpeed, stagingDistance, stillStaging } from "../game/drag-race.js";
import { CPX_MODE, cpxTimeoutS } from "../game/cpx-rules.js";
import { createPenalties, lostOnPenalties, parallelOrder, pointTouches, wallGrid, wallPieces } from "../game/cpx-walls.js";
import { createExtensionSession, createMutatorSession, extensionSessionGround, extensionSimRules } from "../game/extensions/session-loader.js";
import { createEvoPathRunner } from "../game/evo-paths.js";
import { applyCprAids, cprAids, cprCarFigures, cprCourse, createCprDriver, createWidthLookup, spinCorrection } from "../game/cpr-driver.js";
import { cprAnchorsForSag } from "../shared/cpr-anchors.js";
import { courseWindow, createFlight, departVisual, flightVisual, nearestCourseSpot, spotOnSegment, stepFlight, timerVisual } from "../game/heli-flight.js";
import { CLOSE_FT, STOPPED_FT_S, joinedSegment, obstacleAhead, offCourse, pickRoute } from "../game/course-route.js";
import { createRacerRecovery, racerRecovering, racerRecoveryBefore, racerRecoveryStep } from "../game/racer-recovery.js";
import { cpuAvoidStep, cpuControlBefore, cpuControlStep, createCpuControl } from "../game/cpu-control.js";
import { cpuPaceFactor, cpuPaceObserve, createCpuPace, isSliding, isSpun, segmentCurvature, segmentHeading } from "../game/cpu-pace.js";
import { createEvoDriver, evoAiLine, evoDriveStep } from "../game/evo-driver.js";
import { AVOID, boxObstacles, groundBoxWalls } from "../game/obstacle-avoid.js";
import { createMeshGround, meshObstacles } from "../game/mesh-ground.js";
import { createCourseGround } from "../game/course-ground.js";
import { replyError, sendWorkerFaults } from "../shared/worker-faults.js";
import { aiSpeedFactor } from "../game/ai-speed.js";
import { LOADING_BAR } from "../game/loading-bar.js";
import { CRASH_APART_S, CRASH_MIN_FT_S } from "../game/sound-model.js";
import { forEachBoxPair } from "./box-pairs.js";
import { CP4_LIMITS } from "../game/cp4-limits.js";
import { APPLY_S, MIRROR_S, SEND_GAP_S, SEND_MIN_DV, STALE_S, T as CP4_TICK_S, createCp4Sync, feedHit, hitHistory, judgeHit } from "../net/cp4-sync.js";

export const STEP = 1 / 60;
/** CP4 2.0.52.4's tree collision: the nearest 24 trunks a truck, 128 at once (CP4_ENGINE_UPDATES.md 7.1). */
export const CP4_TREES_PER_TRUCK = 24, CP4_TREES_AT_ONCE = 128;
/** The presses that act once (a shift, Drive Mode, the helicopter): kept until a step takes them, and taken by one only. */
export const ONE_SHOT_INPUTS = ["shiftUp", "shiftDown", "driveMode", "helicopter"];


/** A cheap fingerprint of a box's pose, to tell which boxes moved: six numbers, into `out` from `k`. */
function poseInto(b, out, k) {
  out[k] = b.pos[0]; out[k + 1] = b.pos[1]; out[k + 2] = b.pos[2];
  out[k + 3] = b.matrix[2]; out[k + 4] = b.matrix[5]; out[k + 5] = b.matrix[6];
}
/** Equal as their text is: NaN to NaN, and 0 to -0. */
const same = (x, y) => x === y || (x !== x && y !== y);
/** Whether `b` stands as the fingerprint from `k` says. */
const posedAs = (b, out, k) => same(out[k], b.pos[0]) && same(out[k + 1], b.pos[1]) && same(out[k + 2], b.pos[2])
  && same(out[k + 3], b.matrix[2]) && same(out[k + 4], b.matrix[5]) && same(out[k + 5], b.matrix[6]);
export const MAX_CATCH_UP = 0.25;
/** The module's step and catch-up, which a CommPatch4 session replaces with its own (`createSession`). */
const BASE_STEP = STEP, BASE_CATCH_UP = MAX_CATCH_UP;

/** Two trucks' world velocities' closing speed along the line between them (ft/s; going apart is negative). */
export function closingSpeedOf(a, b) {
  const wv = (s) => {
    const m = s.matrix, [x, y, z] = s.bvel;
    return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
  };
  const va = wv(a), vb = wv(b);
  const d = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  return ((va[0] - vb[0]) * d[0] + (va[1] - vb[1]) * d[1] + (va[2] - vb[2]) * d[2]) / n;
}

/**
 * The wall-clock origin (ms) of the next tick: wall time past `MAX_CATCH_UP` that the simulation
 * has fallen behind (a hitch, a hidden tab) is dropped, so a stall never fast-forwards the race.
 */
export function catchUpOrigin(originMs, tMs, simSeconds) {
  const behind = (tMs - originMs) / 1000 - simSeconds;
  return behind > MAX_CATCH_UP ? originMs + (behind - MAX_CATCH_UP) * 1000 : originMs;
}
/** Race time the fast simulation gives the trucks still racing (MONSTER_EXE_ANALYSIS.md 5). */
const FAST_SIMULATION_S = 240;

/**
 * OpenPhotex `groundBoxesAround` (MTM2_PHYSICS.md 14.14), each cell's box made once and kept: a ground box never moves
 * and nothing writes to it (a truck takes an immovable box as ground; a box against a box writes only the one that
 * moves), so the box of a cell, at a copy of the world, is the same object step after step, and the same numbers as a
 * box made afresh. The heights do not change in a race.
 */
export function createGroundBoxCache(ra0, ra1, stepFt = 2, gridCells = 256, baseFt = 0) {
  // By the exact start of the copy of the world (x, then z), then the cell, -1 to N each way. `gridCells` (N) and `baseFt`:
  // a track format version 6 world's size and height base (its 16-bit layers as u16 grids, `stepFt` 1 / step).
  const kept = new Map();
  const CELL = S.GROUND_BOX_CELL_FT, MASK = gridCells - 1, worldFt = gridCells * CELL;
  return {
    around(x, z, out = []) {
      const col = (Math.trunc(x * 256) >> 13) & MASK;
      const row = (Math.trunc(z * 256) >> 13) & MASK;
      const baseX = x - S.wrapCoord(x, worldFt), baseZ = z - S.wrapCoord(z, worldFt);
      let byZ = kept.get(baseX);
      if (!byZ) kept.set(baseX, byZ = new Map());
      let cells = byZ.get(baseZ);
      if (!cells) byZ.set(baseZ, cells = new Map());
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const c = (col + dc) & MASK, r = (row + dr) & MASK;
          const i = r * gridCells + c;
          const lo = baseFt + ra0[i] * stepFt, hi = baseFt + ra1[i] * stepFt;
          if (lo === hi) continue;
          const key = (col + dc + 1) * (gridCells + 2) + (row + dr + 1);
          let box = cells.get(key);
          if (!box) {
            const h = hi - lo;
            box = S.createBox([baseX + (col + dc) * CELL + 16, lo + (stepFt === 2 ? Math.trunc(h / 2) : h / 2), baseZ + (row + dr) * CELL + 16], [CELL, h, CELL]);
            cells.set(key, box);
          }
          out.push(box);
          if (out.length > S.MAX_GROUND_BOXES) throw new Error("Too many ground boxes.");
        }
      }
      return out;
    },
  };
}

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
    // How many forward gears the gearbox has: an Evo vehicle's own under Evo physics (its maxGear, past Park, Reverse and
    // Neutral), MTM2's three otherwise.
    gears: state.forwardGears ?? 3,
    rpm: state.rpm,
    throttle: state.controls.throttle,
    heliTimer: state.heliTimer,
    // Evo physics: the transfer case, 0 2WD, 1 4WD High, 2 4WD Low (null under MTM physics).
    transfer: state.evo?.transfer ?? null,
    // What the instant replay records (game/replay.js).
    bvel: Array.from(state.bvel),
    rates: Array.from(state.rates),
    brakeFront: state.controls.brakeFront,
    brakeRear: state.controls.brakeRear,
    course: state.ap.segment,
    // The recovery helicopter, when one is flying (game/heli-flight.js): `{ pos, heading, teryl }`.
    heli: state.heliVisual ?? null,
  };
}

/**
 * Crash damage (MONSTER_EXE_ANALYSIS.md 10): each step, every hull point in contact (depth of
 * at least -0.25 ft) counts for its zone, with the truck's impact force. The renderer pushes
 * the body's vertices for each counted step.
 */
function noteHull(t) {
  const s = t.state;
  for (let j = 0; j < 12; j++) {
    if (!(s.depths[j] >= -0.25)) continue;
    const zone = t.dmg.get(j + 1) ?? { steps: 0, force: 0 };
    zone.steps++;
    zone.force = Math.max(zone.force, s.impactForce);
    t.dmg.set(j + 1, zone);
  }
}

/** A truck's speed, height and turn rate past which its state is taken for broken, ft/s, ft and rad/s. */
export const SANE_SPEED_FT_S = 2000, SANE_HEIGHT_FT = 1e5, SANE_RATE = 500;

/** Whether a truck's state is one the simulation can go on from: every number finite and none absurd. */
export function stateIsSane(s) {
  for (const list of [s.pos, s.bvel, s.rates, s.matrix, s.euler]) for (let i = 0; i < list.length; i++) if (!Number.isFinite(list[i])) return false;
  return Math.hypot(s.bvel[0], s.bvel[1], s.bvel[2]) < SANE_SPEED_FT_S && Math.abs(s.pos[1]) < SANE_HEIGHT_FT && Math.hypot(s.rates[0], s.rates[1], s.rates[2]) < SANE_RATE;
}

/** Whether a level box's pose and motion are all finite numbers. */
export function boxIsSane(box) {
  for (const list of [box.pos, box.vel, box.bvel, box.rates, box.matrix, box.euler]) for (let i = 0; i < list.length; i++) if (!Number.isFinite(list[i])) return false;
  return true;
}

/**
 * A level box whose numbers have broken (an addition, as for the trucks below): put back where it last stood, at rest.
 * Keeps a sane box's pose as the one to go back to. Returns whether it was put back.
 */
export function keepBoxSane(box) {
  if (boxIsSane(box)) {
    const safe = box.safe ?? (box.safe = { pos: [0, 0, 0], matrix: new Float64Array(9), euler: new Float64Array(3) });
    for (let k = 0; k < 3; k++) safe.pos[k] = box.pos[k];
    safe.matrix.set(box.matrix);
    safe.euler.set(box.euler);
    return false;
  }
  const safe = box.safe;
  if (safe) {
    for (let k = 0; k < 3; k++) box.pos[k] = safe.pos[k];
    box.matrix.set(safe.matrix);
    box.euler.set(safe.euler);
  }
  for (const list of [box.vel, box.bvel, box.rates, box.force, box.moment]) list.fill(0);
  box.depths.fill(-9999);
  return true;
}

/** A deep copy of a state's numbers, and the same numbers put back into the live state (its objects are kept). */
export function copyState(value) {
  if (ArrayBuffer.isView(value)) return value.slice();
  if (Array.isArray(value)) return value.map(copyState);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copyState(v)]));
  return value;
}
export function restoreState(live, saved) {
  for (const [key, value] of Object.entries(saved)) {
    const now = live[key];
    if (ArrayBuffer.isView(value) && ArrayBuffer.isView(now) && now.length === value.length) now.set(value);
    else if (value && typeof value === "object" && now && typeof now === "object" && !ArrayBuffer.isView(now)) restoreState(now, value);
    else live[key] = copyState(value);
  }
  return live;
}

/** A top-crush car's crush as a share of the most it can be: the roof stops 0.25 ft over the body (14.27.5). */
export function crushShare(car) {
  const most = 1 - (car.body.height + 0.25) / car.cab.height;
  return most > 0 ? Math.max(0, Math.min(1, car.crush / most)) : 0;
}

/** The hull contacts counted since the last look, `[{ zone, steps, force }]`; reset on reading. */
function damageOf(t) {
  const out = [...t.dmg].map(([zone, { steps, force }]) => ({ zone, steps, force }));
  t.dmg.clear();
  return out;
}

/** A hull-against-hull contact with another truck since the last look, `{ force, pos, steps }` or null; reset on reading. */
function takeTouch(t) {
  const touch = t.touch ?? null;
  t.touch = null;
  return touch;
}

/** What the sound needs from a truck, over the steps since the last look (it is reset on reading). */
function soundOf(t, ground) {
  const s = t.state;
  const air = 4 - s.tires.filter((x) => x.onGround).length;
  // `slip`: the 4x4 Evolution model's wheelspin (0 under MTM physics); `vLat`: the tire's sideways speed, body ft/s.
  // `rolls`: the radius the simulation turns the wheel by, feet (`spin` times it is how fast the tread runs): not the
  // drawn tire's, which is another size, and by which a wheel rolling true looked to be spinning the faster it went.
  const rolls = t.params?.tireRadiusFt ?? null;
  const tires = s.tires.map((x, i) => ({
    onGround: x.onGround, grip: x.grip, force: [x.force[0], x.force[1], x.force[2]], spin: x.spin, surface: x.surface, lateral: x.lateral,
    slip: s.evo?.slip[i] ?? 0, vLat: x.velocity[0], rolls,
  }));
  const m = s.matrix, weather = ground.weather ?? 0;
  // In water, for its sounds (0x41bbd0, OpenPhotex `inWaterForSound`): a tire's hub under the water level there (a CP4
  // lake's or the track's), or a tire on the ground on water or deep water; never in Snow. A tire held up by an object
  // reads no water from the terrain (`dryOnObjects`). (A probe's `waterDepth` is no measure of it: it is how deep the
  // probe is in the ground, wet or dry.)
  const inWater = S.inWaterForSound(s, ground, weather);
  // What the truck's effects (dust, tracks, spray) take it to stand on: the type most of its tires on the ground stand
  // on (each tire's own surface, as its grip reads it: .SRF faces and `dryOnObjects` included; ties to the lower tire),
  // else the terrain under the body.
  const counts = new Map();
  for (const x of s.tires) if (x.onGround && x.surface >= 0) counts.set(S.surfaceType(x.surface), (counts.get(S.surfaceType(x.surface)) ?? 0) + 1);
  let surface = null, most = 0;
  for (const [type, n] of counts) if (n > most) { surface = type; most = n; }
  if (surface === null) surface = S.surfaceType(ground.surface(s.pos[0], s.pos[1] + 100, s.pos[2]));
  const out = {
    weather, inWater, vy: m[3] * s.bvel[0] + m[4] * s.bvel[1] + m[5] * s.bvel[2],
    rpm: s.rpm, throttle: s.controls.throttle, brake: Math.max(s.controls.brakeFront, s.controls.brakeRear), gear: s.controls.gear, airborne: air, forward: s.bvel[2],
    speed: Math.hypot(s.bvel[0], s.bvel[1], s.bvel[2]), vx: s.bvel[0], bottoming: t.snd.bottoming, collide: t.snd.collide ?? 0, crash: t.snd.crash ?? 0, 
    impact: t.snd.impact, hit: t.snd.hit, clearance: s.pos[1] - ground.height(s.pos[0], s.pos[2]), splash: t.snd.splash, tires, surface, heli: s.heliTimer > 0, heliTeryl: !!s.heliVisual?.teryl, heliPos: s.heliVisual ? [...s.heliVisual.pos] : null,
  };
  t.snd.impact = 0;
  t.snd.bottoming = 0;
  t.snd.collide = 0;
  t.snd.crash = 0;
  t.snd.hit = null;
  t.snd.splash = false;
  return out;
}

/**
 * A session from plain data:
 * `{ heights, clr, textureValues, ra0, ra1, boxes, ramps, course, sonicTrack, waterLevelFt, weather, difficulty, trucks, race }`,
 * with `trucks` a list of `{ truck: { anchors, scrapePoints }, start: { pos, heading }, autopilot }`
 * (the first is the player's), or the single-truck form `{ truck, start, autopilot }`.
 * `ra0` / `ra1` are the level's ground-box layers and `boxes` its collision boxes (track-build.js);
 * `race`, when given, is `{ checkpoints, laps }` and runs the race rules (MTM2_PHYSICS.md 14.24).
 */
/** Whether every number in a built course segment is finite. */
function finiteSegment(seg) {
  for (const value of Object.values(seg)) {
    if (typeof value === "number" && !Number.isFinite(value)) return false;
    if (Array.isArray(value) && value.some((v) => typeof v === "number" && !Number.isFinite(v))) return false;
  }
  return true;
}

/** The least thickness, feet, a level box is given on each axis (see `solidBounds`). */
export const MIN_BOX_FT = 0.5;

/**
 * A model's bounds made solid (an addition, for a box that moves only): F.S.R.'s camper sides are flat models with a
 * mass (pushable), and two that overlap give the box against box test (OpenPhotex `collideBoxes`, which only a box with
 * a mass runs) a contact of no direction, whose NaNs then spread to every truck and object that meets them. Each axis
 * gets at least `MIN_BOX_FT`, about the model's middle.
 *
 * A box without a mass keeps the model's bounds as the game does (`0x5495e0` sets no least size): a flat model is a
 * box of no thickness, its two faces in one plane, and the wheel test then takes its top for a wheel on either side of
 * it (MTM2_PHYSICS.md 14.14). Stacked flat models are the add-on tracks' lifts (DDR Rumble's `MAGELEV1`, Smile's
 * rumble, Time Machine); made solid, they were a ceiling.
 */
export function solidBounds(bounds) {
  if (!bounds?.min || !bounds?.max) return bounds ?? null;
  const min = [...bounds.min], max = [...bounds.max];
  for (let k = 0; k < 3; k++) {
    if (max[k] - min[k] >= MIN_BOX_FT) continue;
    const mid = (min[k] + max[k]) / 2;
    min[k] = mid - MIN_BOX_FT / 2;
    max[k] = mid + MIN_BOX_FT / 2;
  }
  return { ...bounds, min, max };
}

/** The built course, or no course (`[]`) when any segment of it is not finite. */
export function usableCourse(course) {
  return course.every(finiteSegment) ? course : [];
}

/** A ground box this near a course segment's edge is on the course's way (a deck, a ramp's top): never avoided, feet. */
const COURSE_ROOM_FT = 24;

/** A computer racer this far under its course line for this long has fallen off the meshes it races on (`fellOffCourse`). */
const FALL_FT = 15, FALL_S = 3;

/** A computer truck that stays within this many feet for this long is stuck. */
const NO_HEADWAY_FT = 12, NO_HEADWAY_S = 6;

/** A smoothed remote truck eases out its error over this many seconds, and is snapped past this many feet (Evo's rule). */
export const REMOTE_BLEND_S = 0.5, REMOTE_SNAP_FT = 100;

/**
 * The index of the course straight a truck at `pos` heading `heading` is on: the nearest one that runs its way.
 * For a grid that stands part way round the course (CART Precision Racing); 0 without one.
 */
/** Spin Correction's turn (CPR_PHYSICS.md 14.3): a new heading, the world velocity kept (the body's follows the turn). */
function turnKeepingVelocity(state, heading) {
  const m = state.matrix, b = state.bvel;
  const v = [0, 1, 2].map((r) => m[r * 3] * b[0] + m[r * 3 + 1] * b[1] + m[r * 3 + 2] * b[2]);
  state.euler[2] = heading;
  S.eulerToMatrix(state.euler[0], state.euler[1], state.euler[2], m);
  for (let c = 0; c < 3; c++) b[c] = m[c] * v[0] + m[3 + c] * v[1] + m[6 + c] * v[2];
}

function nearestStraight(course, pos, heading) {
  let best = 0, bestDistance = Infinity;
  course.forEach((seg, i) => {
    if (S.isArc(seg)) return;
    const dx = seg.end[0] - seg.start[0], dz = seg.end[2] - seg.start[2];
    if (Math.sin(heading) * dx + Math.cos(heading) * dz <= 0) return;
    const t = Math.max(0, Math.min(1, ((pos[0] - seg.start[0]) * dx + (pos[2] - seg.start[2]) * dz) / (dx * dx + dz * dz || 1)));
    const distance = Math.hypot(pos[0] - (seg.start[0] + dx * t), pos[2] - (seg.start[2] + dz * t));
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  });
  return best;
}

export function createSession(init) {
  // The world: `worldCells` a side (256, or a track format version 6 world's N: docs/EXTENSIONS.md), 32 ft each. Every
  // wrap, cell lookup and grid in the session takes its size from here (the specification's 8.1).
  const worldCells = init.worldCells === 512 ? 512 : 256, worldFt = S.worldFtOf(worldCells);
  const wrapDelta = (d) => S.wrapDelta(d, worldFt);
  // `heightsFt`: corner heights in feet, for a level finer than MTM2's 2 ft steps (CART Precision Racing).
  const terrain = init.heightsFt
    ? S.createTerrainFt(new Float32Array(init.heightsFt), init.waterLevelFt ?? null, init.fineFt ? new Float32Array(init.fineFt) : null, worldCells)
    : S.createTerrain(new Uint8Array(init.heights), init.waterLevelFt ?? null);
  // Community Patch 4's lakes: per 32 ft tile, deep water below the lake's surface (docs/CP4_EXE_ANALYSIS.md 2).
  if (init.lakes) S.setTerrainLakes(terrain, new Uint8Array(init.lakes.tileMap), new Float32Array(init.lakes.levelFt));
  // `dirtEverywhere` (a Terminal Velocity, Fury3 or Hellbender level): no surface map, so the ground is Dirt everywhere
  // (OpenPhotex `createTerrainGround`), with no MTM2 level rule over it.
  const surfaces = !init.dirtEverywhere && init.clr && init.textureValues
    ? S.createSurfaceMap(new Uint16Array(init.clr), new Int32Array(init.textureValues), worldCells)
    : null;
  let weather = init.weather ?? 0;
  /** How the computer trucks drive (Advanced, Computer trucks): "omtm2" (the port's), "mtm2", "mtm1" or "evo". */
  const aiBehaviour = ["omtm2", "mtm2", "mtm1", "evo"].includes(init.aiBehaviour) ? init.aiBehaviour : "omtm2";
  // The physics model's rules (app/settings.js PHYSICS_MODELS): MTM2's unless the race asks for the 1996 game's, or for one
  // of 4x4 Evolution's, whose vehicle model then drives every truck (OpenPhotex evoSim; docs/EVO2_PHYSICS.md).
  const evoModel = E.isEvoRules(init.rules);
  // CART Precision Racing's model (OpenPhotex sim/cpr): its cars drive on it, every other vehicle on MTM2's.
  const cprModel = Cp.isCprRules(init.rules);
  // Community Patch 4's (OpenPhotex sim/cp4; docs/CP4_EXE_ANALYSIS.md 10, 11): MTM2's step under CP4's rules, props that
  // collide by their triangles unless `cp4Collision` is "classic", on CP4's fixed tick.
  const cp4Model = C4.isCp4Rules(init.rules);
  /** Optional rules loaded over the race's countdown and clock. */
  const extensionPayload = init.extension && init.race ? init.extension : null;
  // An extension may change the model's handling (Freestyle's Trick physics, OpenPhotex `Mtm2Rules`).
  const baseRules = extensionSimRules(extensionPayload, evoModel ? E.evoRules(init.rules) : cprModel ? Cp.CPR_RULES
    : cp4Model ? C4.cp4Rules(init.cp4Collision) : S.simRules(init.rules));
  // A track made for CP4 under the OpenMTM2 physics (ui/screens/race.js `cp4TrackTriangles`): MTM2's step, with CP4's
  // triangle collision for its placed models (its [Collision] defaults) and its reading of a tire's surface where the
  // tire touches (`surfaceAtPoint`; MTM2 reads it from 100 ft over the hub, past the .SRF faces under the tire, so a
  // street read as the terrain under the city), and none of CP4's other rules. The MTM2 and MTM1 physics keep the
  // game's boxes.
  const trackTriangles = init.rules === "omtm2" && !!init.cp4TrackTriangles && !!init.collisionSoups;
  const rules = trackTriangles ? { ...baseRules, collisionMode: 1, triangles: C4.CP4_TRIANGLES, surfaceAtPoint: true } : baseRules;
  // CP4 steps every 40 ms tick once, or in 10 ms substeps online or with `cp4SubstepsOffline` ([Game] simSubstepOffline),
  // and catches up at most 160 ms (four ticks) a frame (CP4_EXE_ANALYSIS.md 10.2). Every other model steps at 1/60 s.
  const cp4Split = cp4Model && (!!init.net || !!init.cp4SubstepsOffline);
  const STEP = cp4Model ? C4.cp4Substeps(rules, cp4Split).dt : BASE_STEP;
  const MAX_CATCH_UP = cp4Model ? 0x28f4 / 65536 : BASE_CATCH_UP;
  const terrainGround = S.createTerrainGround(terrain, surfaces, weather, init.waterLevelFt ?? null, rules);
  // CPR's road layer lies over the terrain and is the ground where it does (OpenPhotex world/road.ts).
  const ground = init.road ? S.createRoadGround(terrainGround, init.road) : terrainGround;
  // Surfaces over the terrain that count only when they are under a truck (4x4 Evolution's rocks and decks): each
  // truck asks with its own height, so what stands over it is not its ground (OpenPhotex world/road.ts `below`).
  const meshGround = init.meshGround ? S.createRoadGround(terrainGround, init.meshGround) : null;
  for (const g of [ground, meshGround]) if (g) g.rules = rules;
  const extensionGround = extensionSessionGround(extensionPayload, ground);
  // Static scenery (CPR's walls, 4x4 Evolution's objects and trees): immovable upright boxes, found by a grid of 64 ft
  // cells (a box is in every cell it reaches).
  const WALL_CELL_FT = 64;
  const wallCells = new Map();
  for (const w of init.walls ?? []) {
    const box = S.createBox(w.pos, w.size, 0, [0, 0, w.psi]);
    // A box turned every way (4x4 Evolution's tilted collision boxes and rock faces, worker/evo-track-build.js): its
    // matrix as given, row-major with the box's axes as columns; it reaches as far as its whole diagonal.
    if (w.matrix) { box.matrix.set(w.matrix); box.radius = Math.hypot(...box.half); }
    // A 4x4 Evolution tree (worker/evo-track-build.js): leaned when touched, not solid.
    if (w.tree) box.tree = w.tree;
    // A Community Patch 4 tree trunk (worker/cp4-world.js `vegetationWalls`): under CP4's physics only the nearest ones
    // collide, and computer trucks do not see it (CP4_ENGINE_UPDATES.md 7.1).
    if (w.cp4Tree) box.cp4Tree = true;
    const reach = w.matrix ? Math.hypot(w.size[0], w.size[1], w.size[2]) * 0.5 : Math.hypot(w.size[0], w.size[2]) * 0.5;
    for (let cx = Math.floor((w.pos[0] - reach) / WALL_CELL_FT); cx <= Math.floor((w.pos[0] + reach) / WALL_CELL_FT); cx++) {
      for (let cz = Math.floor((w.pos[2] - reach) / WALL_CELL_FT); cz <= Math.floor((w.pos[2] + reach) / WALL_CELL_FT); cz++) {
        const key = cx * 65536 + cz;
        if (!wallCells.has(key)) wallCells.set(key, []);
        wallCells.get(key).push(box);
      }
    }
  }
  /**
   * CP4 2.0.52.4 collides only the nearest trees: 24 a truck and 128 at once (CP4_ENGINE_UPDATES.md 7.1). Keeps at most
   * those of `t.nearBoxes`'s trunks, nearest first, given `taken` already used this tick; returns how many it kept.
   */
  function nearestTrees(t, taken) {
    const trees = [], rest = [];
    for (const box of t.nearBoxes) (box.cp4Tree ? trees : rest).push(box);
    if (!trees.length) return 0;
    const [x, z] = [t.state.pos[0], t.state.pos[2]];
    const d = (b) => wrapDelta(b.pos[0] - x) ** 2 + wrapDelta(b.pos[2] - z) ** 2;
    trees.sort((a, b) => d(a) - d(b));
    const kept = trees.slice(0, Math.max(0, Math.min(CP4_TREES_PER_TRUCK, CP4_TREES_AT_ONCE - taken)));
    t.nearBoxes.length = 0;
    t.nearBoxes.push(...rest, ...kept);
    return kept.length;
  }

  /** The walls a truck of radius `r` at (x, z) may touch, each once, onto `out`. */
  function wallsAround(x, z, r, out) {
    // A position that is not a number, or is far off the world, has no walls (and must not be walked cell by cell).
    if (!wallCells.size || !(Math.abs(x) < 1e6) || !(Math.abs(z) < 1e6)) return;
    const seen = new Set();
    // The cells are the one world's: a cell past its edge is the cell at the other side.
    const cells = worldFt / WALL_CELL_FT, inWorld = (c) => ((c % cells) + cells) % cells;
    for (let cx = Math.floor((x - r) / WALL_CELL_FT); cx <= Math.floor((x + r) / WALL_CELL_FT); cx++) {
      for (let cz = Math.floor((z - r) / WALL_CELL_FT); cz <= Math.floor((z + r) / WALL_CELL_FT); cz++) {
        for (const box of wallCells.get(inWorld(cx) * 65536 + inWorld(cz)) ?? []) {
          if (seen.has(box)) continue;
          seen.add(box);
          out.push(box);
        }
      }
    }
  }
  // 4x4 Evolution's rocks: their steep faces are walls, each its own triangle (OpenPhotex `collideTruckFace`), found by
  // the same grid of cells as the walls.
  const faceCells = new Map();
  const faceData = init.faces ? new Float32Array(init.faces) : null;
  for (let k = 0; faceData && k + 11 < faceData.length; k += 12) {
    const at = (o) => [faceData[k + o], faceData[k + o + 1], faceData[k + o + 2]];
    const face = S.createFace(at(0), at(3), at(6), at(9));
    if (!face) continue;
    const { centre, radius } = face;
    for (let cx = Math.floor((centre[0] - radius) / WALL_CELL_FT); cx <= Math.floor((centre[0] + radius) / WALL_CELL_FT); cx++) {
      for (let cz = Math.floor((centre[2] - radius) / WALL_CELL_FT); cz <= Math.floor((centre[2] + radius) / WALL_CELL_FT); cz++) {
        const key = cx * 65536 + cz;
        if (!faceCells.has(key)) faceCells.set(key, []);
        faceCells.get(key).push(face);
      }
    }
  }
  /** The rock faces a truck of radius `r` at (x, z) may touch, each once, onto `out`. */
  function facesAround(x, z, r, out) {
    if (!faceCells.size || !(Math.abs(x) < 1e6) || !(Math.abs(z) < 1e6)) return;
    const seen = new Set();
    const cells = worldFt / WALL_CELL_FT, inWorld = (c) => ((c % cells) + cells) % cells;
    for (let cx = Math.floor((x - r) / WALL_CELL_FT); cx <= Math.floor((x + r) / WALL_CELL_FT); cx++) {
      for (let cz = Math.floor((z - r) / WALL_CELL_FT); cz <= Math.floor((z + r) / WALL_CELL_FT); cz++) {
        for (const face of faceCells.get(inWorld(cx) * 65536 + inWorld(cz)) ?? []) {
          if (seen.has(face)) continue;
          seen.add(face);
          out.push(face);
        }
      }
    }
  }
  const nearFaces = [];
  const difficulty = init.difficulty ?? S.DIFFICULTY.INTERMEDIATE;
  // MONSTER.INI steeringResponse, which the controls take as r = steeringResponse * 0.1 (MONSTER_EXE_ANALYSIS.md section 7);
  // 0 to 20, as Community Patch 3 lets it go (CP3_EXE_ANALYSIS.md "Steering model").
  const steeringResponse = Math.min(20, Math.max(0, Number(init.steeringResponse ?? 10) || 0)) * 0.1;
  // Community Patch 3's steering model, curve, range and Expo figures (OpenPhotex controls `joystickSteer`).
  const num = (v, fallback, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);
  const steerCurve = {
    steerCurveMode: init.steerCurveMode === 1 ? 1 : 0,
    steerRange: num(init.steerRange, 90, 5, 100),
    steerExpo: num(init.steerExpo, 100, 0, 100),
    steerSpeedSens: num(init.steerSpeedSens, 35, 0, 100),
  };
  const sonicTrack = !!init.sonicTrack;
  // The feet to a ground box's height step: MTM's 2, or a level's own (Hellbender's 1.5).
  const groundBoxStepFt = init.groundBoxStepFt > 0 ? init.groundBoxStepFt : 2;
  // A track format version 6 track's ground boxes (the specification's 8.3): u16 layers when `groundBoxDepth` is 16, and
  // the terrain's base under both depths.
  const groundBoxBaseFt = Number(init.groundBoxBaseFt) || 0;
  const BoxGrid = init.groundBoxDepth === 16 ? Uint16Array : Uint8Array;
  const ra0 = init.ra0 ? new BoxGrid(init.ra0) : null;
  const ra1 = init.ra1 ? new BoxGrid(init.ra1) : null;
  const groundBoxes = createGroundBoxCache(ra0, ra1, groundBoxStepFt, worldCells, groundBoxBaseFt);
  const levelBoxes = [];
  /** Moving objects: type 10 boxes and their SIT bvel (MTM2_PHYSICS.md 14.18). */
  const movingObjects = [];
  const movingBoxes = new Set();
  // CommPatch4's triangle collision (OpenPhotex sim/cp4; docs/CP4_EXE_ANALYSIS.md 11.2): each model's shape, built once
  // from the track build's triangles, and the static props whose .SRF types the tires grip by (section 5, 11.9).
  const cp4Triangles = (cp4Model || trackTriangles) && rules.collisionMode === 1 && !!init.collisionSoups;
  const cp4Shapes = new Map();
  const surfaceBoxes = [];
  const shapeOf = (name, shiftY) => {
    const key = `${name}|${shiftY}`;
    if (!cp4Shapes.has(key)) {
      const soup = init.collisionSoups[name];
      let shape = null;
      if (soup) {
        let pos = soup.positions;
        if (shiftY) { pos = Float32Array.from(pos); for (let k = 1; k < pos.length; k += 3) pos[k] -= shiftY; }
        shape = C4.buildCollShape(pos, soup.surfaceTypes ? new Int16Array(soup.surfaceTypes) : null);
      }
      cp4Shapes.set(key, shape);
    }
    return cp4Shapes.get(key);
  };
  // MTM2's and CP4's checkpoint footprints (OpenPhotex `checkpointFootprintType`; MTM2_PHYSICS.md 14.15): a type 0 box
  // inside a checkpoint gate's footprint becomes type 11, which a computer truck does not bring into the frame's object
  // list (`listBoxes`) and CP4 does not make a surface. Not in Summit Rumble (race mode 4). The gates are the track's
  // checkpoints whatever the race (the game loads them with the level).
  const mtm2Listing = rules.id === "mtm2" || rules.id === "cp4";
  // Community Patch 4 2.0.52.4 (CP4_ENGINE_UPDATES.md 7.3): on a rumble or a drag, boxes without a model and the scenery
  // beside a checkpoint are solid for every truck: no footprint retype, and the computer trucks list every box.
  const solidForAll = cp4Model && (init.race?.mode === "summit" || init.race?.mode === "drag");
  const footprintGates = mtm2Listing && !solidForAll && init.race?.mode !== "summit" ? (init.checkpointGates ?? init.race?.checkpoints ?? []) : [];
  // The count at [0x646c40] + 0xc that lets a computer truck bring in every box: believed to be a network game's
  // other drivers (MONSTER_EXE_ANALYSIS.md 16), so 1 in a network race.
  const networkDrivers = init.net ? 1 : 0;
  for (const b0 of init.boxes ?? []) {
    const type = footprintGates.length && !b0.checkpointPole ? S.checkpointFootprintType(b0, footprintGates) : b0.type;
    const b = type === b0.type ? b0 : { ...b0, type };
    const box = S.createLevelBox(b, b.mass >= 1 ? solidBounds(b.bounds) : b.bounds);
    if (box) {
      box.sitIndex = b.sitIndex;
      box.hasModel = !!b.modelName;
      // A 4x4 Evolution object's model stands off its box's centre: its origin, in the box's frame (worker/evo-track-build.js).
      if (b.drawOffset) box.drawOffset = b.drawOffset;
      // CP4's offCentreCollision (10.6): a model whose vertical centre is further from its origin than its height has its
      // box moved onto it; drawn at its origin still, and its triangles kept where they are. The CommPatch4 physics only.
      let shiftY = 0;
      if (cp4Model) {
        if (rules.offCentreCollision && b.bounds) {
          const cy = (b.bounds.min[1] + b.bounds.max[1]) / 2, h = b.bounds.max[1] - b.bounds.min[1];
          if (Math.abs(cy) > h) {
            shiftY = cy;
            for (let k = 0; k < 3; k++) box.pos[k] += box.matrix[k * 3 + 1] * cy;
            const o = box.drawOffset ?? [0, 0, 0];
            box.drawOffset = [o[0], o[1] - cy, o[2]];
          }
        }
      }
      if (cp4Triangles && b.modelName) {
        box.shape = shapeOf(b.modelName, shiftY);
        // Surfaces: static props only, not fog, moving or pushable boxes, nor types 6 to 13 (section 5).
        if (box.shape?.surfaceTypes && !(b.mass > 0) && !(b.type >= 6 && b.type <= 14)) surfaceBoxes.push(box);
      }
      // Moved by a 4x4 Evolution object path (game/evo-paths.js): the path's object, or what hangs from it (`attach`); a
      // `ghost` is moved but met by nothing (its class does not collide).
      if (b.pathRoot !== undefined) { box.pathRoot = b.pathRoot; box.attach = b.attach ?? null; box.ghost = !!b.ghost; }
      levelBoxes.push(box);
    }
    if (box && b.bvel) { movingObjects.push({ box, bvel: b.bvel }); movingBoxes.add(box); }
  }
  /*
    `inert`: a level box nothing moves. With no mass at all it is never stepped (stepBox and postStepBox return at once for
    a box that is not dynamic) nor pushed by a truck (a box under 1 slug is not dynamic but a truck pushes it out), and it
    is no moving object (14.18) and on no 4x4 Evolution path, so being listed changes nothing of it: its pose stays, its
    numbers stay sane. A mode's own session may move level boxes itself, so with one every listed box is treated as able
    to move.
  */
  for (const box of levelBoxes) box.inert = box.mass === 0 && !box.dynamic && !movingBoxes.has(box) && box.pathRoot === undefined;
  // Under CP4's physics only the first 64 surface boxes count, as the game takes them (CP4_ENGINE_UPDATES.md 5); under
  // OpenMTM2's own physics every one does (converted cities carry hundreds).
  const surfaceLimit = cp4Model ? CP4_LIMITS.surfaceBoxes : Infinity;
  if (surfaceBoxes.length) for (const g of new Set([ground, extensionGround])) C4.withSurfaceMeshes(g, surfaceBoxes, { limit: surfaceLimit });
  // The meshes a computer racer drives on (game/mesh-ground.js): the static models that collide by their triangles.
  // Their boxes are no blocks to steer round; their walls and drops are read from the triangles.
  const triMeshes = cp4Triangles
    ? createMeshGround(levelBoxes.filter((b) => b.shape && !(b.mass > 0) && !movingBoxes.has(b)), { terrainHeight: (x, z) => ground.height(x, z), wrapDelta, worldFt })
    : null;
  const meshBoxes = new Set(triMeshes?.boxes ?? []);
  // The ground the autopilot and its course read (game/course-ground.js, OpenMTM2's rule): on a track built of meshes,
  // the drivable surface at the course's own height, so a road high over the terrain is not read as the terrain
  // under it; elsewhere the ground the game's autopilot reads.
  const apGround = (triMeshes && createCourseGround({
    straightsLists: [init.course, ...(init.routeCourses ?? []), init.race?.laneCourse, ...(init.race?.cpxCourses ?? [])],
    surfaceBelow: (x, y, z, depth) => triMeshes.surfaceBelow(x, y, z, depth),
    terrain: (x, z) => ground.height(x, z),
    wrapDelta,
  })) || ((x, z) => ground.height(x, z));
  const allRamps = (init.ramps ?? []).map((r) => S.createRamp(r, r.bounds)).filter(Boolean);
  // The course's straights with the arcs built between them, over the ground the probes see
  // (MTM2_PHYSICS.md 12, 14.22).
  // A course the game cannot build (two straights in line give an arc of no finite size, as on F.S.R., a Summit
  // Rumble track) is no course: a mode that drives there without the Summit's rules (Tag) must not aim the autopilot or
  // the helicopter at it, which spreads the arc's NaNs into the truck's controls and wheels.
  const course = usableCourse(S.buildCourse(init.course ?? [], apGround, {
    sonicTrack, gripK: sonicTrack && difficulty === S.DIFFICULTY.PROFESSIONAL ? 2 : 1.75,
  }));
  // The SIT's other courses (game/course-route.js): a computer racer cut off from its own by an unmovable obstacle
  // takes one that passes within reach, to where it meets the one it races.
  const routes = (init.routeCourses ?? []).map((c) => usableCourse(S.buildCourse(c, apGround, {
    sonicTrack, gripK: sonicTrack && difficulty === S.DIFFICULTY.PROFESSIONAL ? 2 : 1.75,
  }))).filter((c) => c.length);
  // The computer trucks steer by the game's frame time, not the simulation's step (OpenPhotex AUTOPILOT_FRAME_DT, 1/30 s):
  // `opponentFps` (Options, Advanced) is the frame rate they drive as if the game ran at.
  const opponentFps = Number(init.opponentFps);
  const apCtx = { course, height: apGround, dt: STEP, difficulty, sonicTrack, rules };
  if (opponentFps >= 10 && opponentFps <= 240) apCtx.frameDt = 1 / opponentFps;
  // CP4 runs the autopilot once a tick with the whole tick as its frame time (10.2).
  if (cp4Model) apCtx.frameDt = rules.tickS;
  // AI Speed (Community Patch 3, game/ai-speed.js): the computer trucks' target speed and torque, never the player's.
  const cpuAiSpeed = aiSpeedFactor(init.aiSpeed);

  const specs = init.trucks ?? [{ truck: init.truck, start: init.start, autopilot: init.autopilot }];
  // The CPR Skill Level (Options, Advanced): the player's driving aids under CPR physics.
  const cprPlayerAids = cprAids(init.cprSkill ?? "rookie");
  const playerAids = {
    abs: cprPlayerAids.abs, tractionControl: cprPlayerAids.tractionControl,
    gripScale: cprPlayerAids.gripScale, offroadGrip: cprPlayerAids.offroadGrip,
  };
  const trucks = specs.map((spec, i) => {
    // The game copies the player's gearbox setting to every truck (MONSTER_EXE_ANALYSIS.md +0xfb0), which the MTM1 and
    // MTM2 computer drivers keep; the OMTM2 and EVO drivers always use the automatic box.
    // Community Patch 4 2.0.52.4: computer trucks in drags shift for themselves (CP4_ENGINE_UPDATES.md 9.1).
    const cpuAuto = !!spec.autopilot && (aiBehaviour === "omtm2" || aiBehaviour === "evo" || (cp4Model && init.race?.mode === "drag"));
    const setup = { difficulty, ...spec.setup, autoShift: cpuAuto ? true : spec.setup?.autoShift ?? init.autoShift ?? true };
    let params, state, cprCar = false;
    if (cprModel && spec.truck.cpr) {
      // A CPR car on its own figures and the player's Garage setup (`setup.cpr`; the stock one for the others).
      cprCar = true;
      // The player's car carries the Skill Level's aids (CPR_PHYSICS.md 14.3); a computer car brakes with ABS.
      const aids = i === 0 && !spec.remote ? playerAids : undefined;
      params = Cp.createCprParams(Cp.cprSpec(spec.truck.anchors, spec.truck.scrapePoints, setup.cpr ?? null),
        { radiusFt: spec.truck.tire?.radiusFt, widthFt: spec.truck.tire?.widthFt }, { cpu: !!spec.autopilot, autoShift: setup.autoShift, difficulty, aids });
      state = Cp.createCprTruckState(spec.start.pos, spec.start.heading ?? 0, S.GEAR.FIRST, params);
      state.forwardGears = params.cpr.gears.length;
    } else if (evoModel) {
      // An Evo vehicle drives on its own .TRK figures (`truck.evo`); any other on MTM2's figures for it, its MTM2 grip
      // factor included (OpenPhotex evoSpecFromMtm2: the port's rule). An MTM truck rolls on MTM2's 3 by 4 ft tires.
      const cpuSonicPro = !!spec.autopilot && difficulty === S.DIFFICULTY.PROFESSIONAL && sonicTrack;
      // The player's Garage settings for an Evo vehicle (EVO2_PHYSICS.md 2.2; `setup.evo`, the player only).
      const evoSpec = spec.truck.evo ? E.applyEvoGarage(spec.truck.evo, setup.evo ?? null, rules.defaultCgZ ?? 0) : E.evoSpecFromMtm2({
        wheelAnchors: spec.truck.anchors, scrapePoints: spec.truck.scrapePoints, suspension: setup.suspension,
        transferSetting: setup.transferSetting, difficulty, gripK: cpuSonicPro ? S.TIRE_GRIP_K_SONIC_PRO : S.TIRE_GRIP_K,
      });
      params = E.createEvoParams(evoSpec, rules,
        { tireRadiusFt: spec.truck.tire?.radiusFt ?? S.TRUCK.tireRadiusFt, tireWidthFt: spec.truck.tire?.widthFt ?? S.TRUCK.tireWidthFt },
        { difficulty, cpu: !!spec.autopilot, autoShift: setup.autoShift, tread: (spec.truck.evo ? setup.evo?.tread : null) ?? setup.tireCut ?? (spec.truck.evo ? 1 : 0) });
      state = E.createEvoTruckState(spec.start.pos, spec.start.heading ?? 0, S.GEAR.FIRST, params);
      state.forwardGears = Math.max(1, params.evo.spec.maxGear - 3);
    } else {
      // `tire`: another game's vehicle rolls on its own tires' size (worker/foreign-truck-build.js); an MTM truck has none.
      const figures = { wheelAnchors: spec.truck.anchors, scrapePoints: spec.truck.scrapePoints, tireRadiusFt: spec.truck.tire?.radiusFt, tireWidthFt: spec.truck.tire?.widthFt };
      params = S.createTruckParams(figures, setup);
      // A CPR car rests at its ride height on MTM2's softer springs too: its anchors for MTM2's sag.
      if (spec.truck.restHubs) params = S.createTruckParams({ ...figures, wheelAnchors: cprAnchorsForSag(spec.truck.restHubs, params.sagFt) }, setup);
      state = S.createTruckState(spec.start.pos, spec.start.heading ?? 0, S.GEAR.FIRST, params);
    }
    // A Spline or Full Map track (CP4's 8 ft drive surface): a start found under the ground is lifted to 6 ft above it,
    // the one thing CP4 2.0.52.4 moves at load (CP4_ENGINE_UPDATES.md 4).
    if (init.fineFt && cp4Model) {
      const ground = terrainGround.height(state.pos[0], state.pos[2]);
      if (state.pos[1] < ground) state.pos[1] = ground + 6;
    }
    if (init.startOnNearestSegment) state.ap.segment = nearestStraight(course, spec.start.pos, spec.start.heading ?? 0);
    // A Rumble needs no course: its computer trucks drive to the zone (rumble-ai.js).
    // A remote truck (multiplayer, docs/MULTIPLAYER.md) is driven by another machine's updates, never by this one.
    const remote = !!spec.remote;
    const autopilot = !remote && !!spec.autopilot && (course.length > 0 || init.race?.mode === "summit" || !!extensionPayload);
    // Without a course the reset keeps the heading and the helicopter sets the truck down in place.
    // `proLift`: a computer truck that misses a checkpoint or comes to rest is always fetched by the helicopter, never
    // set back on the course at once as the game does on Professional (the port's choice).
    const recovery = {
      racing: true, player: i === 0 && !autopilot && !remote, autopilot, difficulty, summit: false, segment: null, previous: null,
      // The OMTM2 drivers' choice; the MTM2 and EVO drivers keep the game's Professional reset, MTM1's always lifts a missed checkpoint.
      proLift: aiBehaviour === "omtm2", missedLift: aiBehaviour === "mtm1",
    };
    // A foot under the body's origin: a step up to about a wheel's height is climbed, a taller face is not ground.
    const ownGround = meshGround ? meshGround.below(() => state.pos[1] - 1) : extensionGround;
    // `online`: CP4's computer-truck grip applies offline only (10.4).
    // `dryOnObjects`: OpenMTM2's own rule, not the game's (docs/MTM2_PHYSICS.md 2.4): a tire held up by a box, ramp, prop or car
    // never stands on the terrain's water under it (OpenPhotex truck/object-support.ts).
    const ctx = { ground: ownGround, human: i === 0 && !autopilot && !remote, difficulty, sonicTrack, recovery, online: !!init.net, dryOnObjects: true };
    // On meshes the helicopter flies over the mesh (`heliGround`), not the terrain under the city: in the air the
    // ground's height is the drivable surface under the course height it carries the truck to, so a truck set back on a
    // freeway is set down on its deck, not on the street below. Only in the air; the wheels never see it.
    const heliGround = triMeshes ? Object.create(ownGround, {
      height: { value: (x, z) => {
        const seg = recovery.segment, prev = recovery.previous;
        const ref = !seg ? state.pos[1] : !S.isArc(seg) ? seg.start[1] : prev && !S.isArc(prev) ? prev.end[1] : state.pos[1];
        return triMeshes.surfaceBelow(x, ref + 6, z, 80) ?? ownGround.height(x, z);
      } },
    }) : null;
    // Shift gears in automatic (Advanced, OMTM2; OpenPhotex `autoOverride`): the player's box takes LB / RB and the keys.
    if (ctx.human && init.shiftInAuto) state.controls.autoOverride = true;
    const aiSpeed = autopilot && i > 0 && cpuAiSpeed !== null ? cpuAiSpeed : undefined;
    if (aiSpeed !== undefined) ctx.aiSpeed = aiSpeed;
    return { state, params, autopilot, remote, remoteComputer: remote && !!spec.remoteComputer, recovery, ctx, ownGround, heliGround, aiSpeed, evoVehicle: !!spec.truck.evo, cprCar, radius: S.truckRadius(params), nearBoxes: [], dmg: new Map(), snd: { impact: 0, bottoming: 0, collide: 0, crash: 0, hit: null, splash: false, surface: 1 }, safe: copyState(state), sinceSafe: 0 };
  });
  const player = trucks[0];
  // Under CPR physics a CPR car drives by CART.EXE's autopilot on the SIT course (game/cpr-driver.js, CPR_PHYSICS.md
  // 14.2), every one of them: the player's gives the aids and drives under Full Autopilot.
  if (cprModel && course.length) {
    const segs = cprCourse(course);
    const widthAt = createWidthLookup(init.cprLine);
    for (const t of trucks) {
      if (!t.cprCar || t.remote) continue;
      t.cprDriver = createCprDriver(segs, widthAt);
      t.cprFigures = cprCarFigures(t.params, Cp.cprAero(t.params.cpr.spec.setup), Cp.CPR_CAR.refAreaFt2, Cp.CPR_AIR_DENSITY);
    }
  }
  /** One step of a CPR car's autopilot; `player` for the aids' dry run. */
  const cprDrive = (t, player = false) => {
    const others = trucks.filter((o) => o !== t).map((o) => ({ pos: o.state.pos, speed: Math.hypot(o.state.bvel[0], o.state.bvel[2]) }));
    return t.cprDriver.step(t.state, { car: t.cprFigures, dt: STEP, mu: Cp.cprMu, others, player, dryRun: player });
  };
  // Traffic (MTM2_PHYSICS.md 14.25): every truck sees the others' last values.
  if (trucks.length > 1) apCtx.traffic = trucks.map((t) => ({ s: t.state, p: t.params }));
  // A drag race (game/drag-race.js) is one pass: staging and the tree in place of the countdown, the beams and the
  // times its own (the race's checkpoint test is left with nothing to do); each lane drives its own course.
  /*
    Community Patch 4 2.0.52.4's race rules (`.CPX`, game/cpx-rules.js; CP4_ENGINE_UPDATES.md 8): mode 1 a new-style drag
    (the drag pass with the rules' beams, laps and time-out), mode 2 a Parallel race (two trucks, a lane each, wall
    touches cost time), mode 3 a race with split checkpoints. Without them every rule below is the old one.
  */
  const cpxRules = init.race?.raceRules ?? null;
  const cpxMode = cpxRules?.mode ?? 0;
  const dragMode = init.race?.mode === "drag" && (init.race.checkpoints?.length ?? 0) >= (cpxMode === CPX_MODE.DRAG ? 1 : 4);
  const parallel = cpxMode === CPX_MODE.PARALLEL;
  const drag = dragMode ? createDrag(init.race.checkpoints, [0, 1].map((lane) => specs.some((spec, i) => (spec.lane ?? i) === lane)), rules.id === "mtm1" ? "mtm1" : "cp3",
    cpxMode === CPX_MODE.DRAG ? { cpx: cpxRules, laps: init.race.laps ?? 1 } : {}) : null;
  // A Parallel race or a race with splits: a checkpoint a slot, split slots holding their copies.
  const raceCps = dragMode ? [] : cpxRules && (parallel || cpxMode === CPX_MODE.RACE)
    ? S.raceSlotCheckpoints(init.race.checkpoints, cpxRules.boxes) : S.raceCheckpoints(init.race?.checkpoints ?? []);
  const race = init.race
    ? S.createRace(trucks.map((t, i) => ({ s: t.state, p: t.params, player: (i === 0 && !t.autopilot) || t.remote })),
      raceCps, dragMode ? [] : course,
      dragMode ? 1 : init.race.laps ?? 3, difficulty, dragMode ? "circuit" : init.race.mode ?? "circuit",
      // CP4 2.0.52.4 counts Summit Rumble in physics ticks (CP4_ENGINE_UPDATES.md 9.3), a tick being `substeps` steps.
      cp4Model ? { tickClock: true, callsPerTick: C4.cp4Substeps(rules, cp4Split).n } : {})
    : null;
  /*
    CP4 2.0.52.4's tide (CP4_ENGINE_UPDATES.md 7.4): the track's water steps once a physics tick from the green flag,
    remainder carried, frozen in Snow; it restarts with the race and a saved race's load. The other models keep the
    simulation's water still (the drawn water bobs by itself).
  */
  const tide = cp4Model && init.waterLevelFt != null ? S.createTide(Math.round(init.waterLevelFt * 2), rules.tickS, weather === S.WEATHER.SNOW) : null;
  const tideSubsteps = cp4Model ? C4.cp4Substeps(rules, cp4Split).n : 1;
  let tideCalls = 0;
  // 4x4 Evolution 2's physics: a checkpoint counts driven through either way (EVO2_PHYSICS.md 12).
  if (race && rules.twoWayCheckpoints) race.twoWay = true;
  // A .CPX race's lanes: stored once at the start from the grid (lane 1 the first start slot); online the spawn slot's.
  // Trucks past the second slot have none.
  if (race && cpxRules) race.trucks.forEach((rt, i) => { const l = specs[i]?.lane ?? i; rt.lane = l === 0 ? 1 : l === 1 ? 2 : 0; });
  // A CP4 room (18.1): only a truck's own machine counts its passes, and only it judges its drag lane; the others take
  // them from its 0x0b and 0x26.
  if (race && init.net?.policy === "cp4") race.trucks.forEach((rt, i) => { if (trucks[i].remote) rt.passesFromOwner = true; });
  if (drag && init.net?.policy === "cp4") trucks.forEach((t) => { if (t.remote && drag.lanes[t.lane]) drag.lanes[t.lane].remote = true; });
  // A Parallel race runs until every truck has finished (each its laps), or the time-out; the walls cost time.
  if (race && parallel) race.allFinish = true;
  const cpxWalls = cpxRules?.walls?.length ? wallGrid(wallPieces(cpxRules.walls), { worldFt }) : null;
  const penalties = parallel ? createPenalties(trucks.length, { penaltyMs: cpxRules.penaltyMs || 5000, rearmMs: cpxRules.rearmMs || 1000 }) : null;
  const cpxTimeout = parallel ? cpxTimeoutS(cpxRules, init.race.laps ?? 1) : null;
  let firstFinishAt = null;
  /** The penalty events of this race, oldest first: a replay's `penalties` block and the network's packet 43. */
  const penaltyEvents = [];
  /** Each truck's points the walls are tested with: its hull points and its tyres' hubs (body frame). */
  const wallPointsOf = (t) => [...(t.params.scrapePoints ?? []), ...(t.params.hubs ?? [])];
  const worldPoint = (t, q) => {
    const m = t.state.matrix, p = t.state.pos;
    return [p[0] + m[0] * q[0] + m[1] * q[1] + m[2] * q[2], p[1] + m[3] * q[0] + m[4] * q[1] + m[5] * q[2], p[2] + m[6] * q[0] + m[7] * q[1] + m[8] * q[2]];
  };
  /**
   * The walls each of this machine's trucks touched this step (a remote truck is judged by its owner; nothing is judged
   * while the truck is being put back). Drag: the truck is out. Parallel: a penalty for each armed wall.
   */
  function cpxWallStep() {
    if (!cpxWalls || !race || (!S.raceStarted(race) && !drag)) return;
    trucks.forEach((t, i) => {
      if (t.remote || t.state.heliTimer > 0) { t.wallSeen = null; return; }
      const now = wallPointsOf(t).map((q) => worldPoint(t, q));
      const before = t.wallSeen ?? now;
      t.wallSeen = now;
      const touched = new Set();
      now.forEach((p, k) => pointTouches(cpxWalls, before[k] ?? p, p, touched, wrapDelta));
      if (drag) { if (touched.size) dragWallTouch(drag, t.lane); return; }
      if (penalties && !race.trucks[i].finished) {
        const added = penalties.touch(i, touched, Math.round((race.clock - race.startTime) * 1000));
        if (added) penaltyEvents.push({ time: race.clock - race.startTime, truck: i, totalMs: penalties.totals[i] });
      }
    });
  }
  /** A Parallel race's end: every truck finished, or offline the time-out gone by since the first finish. */
  function parallelStep() {
    if (!parallel || !race || !S.raceStarted(race)) return;
    const since = race.clock - race.startTime;
    if (firstFinishAt === null && race.trucks.some((rt) => rt.finished)) firstFinishAt = since;
    const timedOut = since >= cpxTimeout || (!init.net && firstFinishAt !== null && since - firstFinishAt >= cpxTimeout);
    if (timedOut) for (const rt of race.trucks) if (!rt.finished) { rt.finished = true; rt.dq = "timeout"; }
    if (race.trucks.every((rt) => rt.finished)) race.over = true;
  }
  /** A lead-in course (COUR first pass only): driven once to its last segment, then the lane's course for good. */
  function leadInStep() {
    for (const t of trucks) {
      const lead = t.leadIn;
      if (!lead || t.state.ap.segment < lead.length - 1) continue;
      t.leadIn = null;
      t.apCtx = { ...t.apCtx, course: lead.then };
      t.state.ap.segment = nearestStraight(lead.then, t.state.pos, t.state.euler[2]);
      t.course = lead.thenIndex;
    }
  }
  const raceAp = dragMode ? { ...apCtx, course: [] } : apCtx;
  if (drag) {
    race.startTime = Infinity;
    const beam = init.race.checkpoints[0].gate;
    // Lane 1 drives the SIT's course 2 (the lanes are the courses, 6.4); a strip without one gets lane 0's, mirrored.
    const other = init.race.laneCourse?.length ? init.race.laneCourse : mirrorCourse(init.course ?? [], beam.position, beam.angles[2]);
    const mirrored = S.buildCourse(other, apGround, {
      sonicTrack, gripK: sonicTrack && difficulty === S.DIFFICULTY.PROFESSIONAL ? 2 : 1.75,
    });
    specs.forEach((spec, i) => {
      const t = trucks[i];
      t.lane = spec.lane ?? i;
      t.apCtx = { ...apCtx, course: t.lane === 1 ? mirrored : course, dragMode: true, traffic: undefined };
      // The step knows a drag pass too: CP4's computer trucks grip harder there (OpenPhotex `dragCpuGrip`; MTM2 ignores it).
      t.ctx.dragMode = true;
      t.recovery.dragRace = true;
      // What breaks the beams: the front tyre's leading point (the bodywork never counts).
      t.frontZ = Math.max(...t.params.hubs.map((q) => q[2])) + t.params.tireRadiusFt;
    });
    // A drag weekend's computer drivers (game/events/drag-event.js): how deep each stages, and its launch, seconds after
    // the green or, negative, before it (a false start).
    specs.forEach((spec, i) => { trucks[i].stageDepth = spec.stageDepth; trucks[i].launch = Number.isFinite(spec.launch) ? spec.launch : null; });
    // Auto Stage (Options, Game, or its key during a pass): the player's truck stages itself.
    player.autoStage = !!init.race.autoStage;
  }
  // A .CPX drag or Parallel race's courses (CP4_ENGINE_UPDATES.md 8.3): lane 1 drives course 0, lane 2 course 1, and a
  // lead-in (COUR first pass only) is driven once before its then-course.
  if (cpxRules && (drag || parallel)) {
    const built = (c) => (c?.length ? S.buildCourse(c, apGround, { sonicTrack, gripK: sonicTrack && difficulty === S.DIFFICULTY.PROFESSIONAL ? 2 : 1.75 }) : null);
    const all = (init.race.cpxCourses ?? []).map(built);
    specs.forEach((spec, i) => {
      const t = trucks[i];
      if (parallel) {
        t.lane = spec.lane ?? i;
        t.apCtx = { ...apCtx, course: t.lane === 1 ? (all[1] ?? course) : (all[0] ?? course), traffic: undefined };
      }
      const laneCourse = t.lane === 0 ? 0 : t.lane === 1 ? 1 : -1;
      const lead = cpxRules.courses.find((c) => c.thenCourse === laneCourse);
      const leadCourse = lead ? all[lead.course] : null;
      if (leadCourse && t.apCtx) {
        t.leadIn = { length: leadCourse.length, then: t.apCtx.course, thenIndex: laneCourse };
        t.apCtx = { ...t.apCtx, course: leadCourse };
        t.state.ap.segment = 0;
        t.course = lead.course;
      } else t.course = Math.max(0, laneCourse);
    });
  }
  /**
   * The autopilot context a truck drives by: its lane's in a drag race. A computer truck with an AI Speed gets a view
   * that inherits the shared context (so a reversed course still reaches it) and adds its own `aiSpeed`.
   */
  const apOf = (t) => {
    const base = t.apCtx ?? apCtx;
    if (t.aiSpeed === undefined && !t.cpuPace) return base;
    if (t.apViewBase !== base) {
      // AI Speed (Community Patch 3) times the pace the truck has learnt for its segment (game/cpu-pace.js), read
      // each step; the pace scales the target speed alone, the torque keeps AI Speed only (the step context's).
      t.apView = Object.create(base, { aiSpeed: { get: () => (t.aiSpeed ?? 1) * (t.pace ?? 1), enumerable: true } });
      t.apViewBase = base;
    }
    return t.apView;
  };

  const crossings = createCrossingLog(trucks.length);
  /** Laps each truck closed in first place. */
  const lapsLed = trucks.map(() => 0);
  let rumbleField = null;
  if (race?.summit) {
    // The ground, and the top of any ground box on it: as a second layer when it stands clear of the
    // ground (a table, a bridge), for the computer trucks' way up to the zone.
    // A box's top is flagged (`box`), so its edges count as faces (rumble-ai.js `BOX_STEP_FT`).
    const layers = (x, z) => {
      const g = ground.height(x, z);
      if (!ra0 || !ra1) return [g];
      const i = ((Math.trunc(z * 256) >> 13) & (worldCells - 1)) * worldCells + ((Math.trunc(x * 256) >> 13) & (worldCells - 1));
      if (ra0[i] === ra1[i]) return [g];
      const lo = groundBoxBaseFt + ra0[i] * groundBoxStepFt, hi = groundBoxBaseFt + ra1[i] * groundBoxStepFt;
      const out = lo > g + 12 ? [g, hi] : [Math.max(g, hi)];
      out.box = lo > g + 12 ? [false, true] : [hi > g + 0.5];
      return out;
    };
    rumbleField = buildRumbleField(race.summit.zone, layers);
    const aggression = [0.35, 0.6, 0.85][difficulty] ?? 0.6;
    for (const [i, t] of trucks.entries()) {
      t.recovery.summit = true;
      // Every truck gets a driver, so the player's full autopilot (Ctrl+T) drives a Rumble too.
      t.rumble = createRumbleDriver(Math.min(1, aggression + ((i * 0.37) % 0.3) - 0.15));
      // A computer truck recovers as the player does (an addition): set back on its wheels where it lies, never
      // fetched by the helicopter, which a player cannot call in a Rumble either. Its driver backs out when stuck.
      if (t.autopilot && !t.remote) {
        t.recovery.player = true;
        t.recovery.autopilot = false;
      }
    }
  }

  const listed = [];
  /** This step's listed boxes that can move (`step`), in the list's order. */
  const stirring = [];
  /** Boxes whose pose changed since the last `advance` reply. */
  const dirty = new Set();

  /*
    4x4 Evolution 2's object paths (game/evo-paths.js; docs/EVO2_EXE_ANALYSIS.md 6.7): each moves its object's box, and
    the boxes that hang from it at their places against it, every step.
  */
  const pathRuns = (init.paths ?? []).map((p) => {
    const runner = createEvoPathRunner(p.path, {
      ground: { height: (x, z) => ground.height(x, z), normal: (x, z) => ground.normal(x, z, [0, 1, 0]) }, bottom: p.bottom ?? 0,
    });
    const members = levelBoxes.filter((b) => b.pathRoot === p.sitIndex);
    const root = members.find((b) => b.sitIndex === p.sitIndex);
    return runner && root ? { runner, number: p.number, root, members } : null;
  }).filter(Boolean);
  const mul = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const mulM = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  /** Puts a path's boxes where its runner says, their velocity from the move (so a truck is pushed as by a moving box). */
  function placePath(run, still = false) {
    const { pos, matrix } = run.runner.pose();
    for (const box of run.members) {
      let at = pos, m = matrix;
      if (box !== run.root && box.attach) {
        const off = mul(matrix, box.attach.pos);
        at = [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]];
        m = mulM(matrix, box.attach.matrix);
      }
      // The box's centre: the model's origin less its draw offset, in the box's frame.
      const o = box.drawOffset ?? [0, 0, 0];
      const c = mul(m, [-o[0], -o[1], -o[2]]);
      const centre = [at[0] + c[0], at[1] + c[1], at[2] + c[2]];
      for (let i = 0; i < 3; i++) box.vel[i] = still ? 0 : (centre[i] - box.pos[i]) / STEP;
      box.pos[0] = centre[0]; box.pos[1] = centre[1]; box.pos[2] = centre[2];
      box.matrix.set(m);
      dirty.add(box);
    }
  }
  // Each object starts where its path starts, not where the SIT shows it.
  for (const run of pathRuns) placePath(run, true);

  /*
    The track's script (OpenPhotex parseEvoScript), as 4x42.exe runs it every frame (0x455140, docs/EVO2_EXE_ANALYSIS.md
    6.7): every rule whose conditions hold (one with none, always) acts that frame; `raise(flag, d)` queues a flag for
    `d` seconds, `once` (a frame), `forever` or `clear` (taken away), and the queue is taken in after the rules
    (0x44ff50), so a rule sees a flag from the next frame. What the port acts on is objectsIntersect (a vehicle,
    `vehicleN`, inside a named trigger box), flags, start/stop/togglePathObject and Message; the rest (money, objectives,
    secrets, tides) is the career's.
  */
  const script = init.script ?? null;
  /** Flag name to `{ kind: "seconds" | "once" | "forever", left }`. */
  const scriptFlags = new Map();
  const raised = [];
  const scriptMessages = [];
  let lastMessage = null;
  const triggerByName = new Map((script?.triggers ?? []).map((t) => [t.name, { ...t, matrix: S.eulerToMatrix(t.orient[0], t.orient[1], t.orient[2], new Array(9)) }]));
  const insideTrigger = (trigger, p) => {
    const d = [p[0] - trigger.pos[0], p[1] - trigger.pos[1], p[2] - trigger.pos[2]];
    const m = trigger.matrix;
    return [0, 1, 2].every((a) => Math.abs(m[a] * d[0] + m[3 + a] * d[1] + m[6 + a] * d[2]) <= trigger.size[a] / 2);
  };
  const conditionHolds = (c) => {
    let value = false;
    if (c.call?.name === "objectsIntersect") {
      const [a = "", b = ""] = c.call.args.map((x) => x.toLowerCase());
      const vehicle = /^vehicle(\d+)$/.exec(b) ? b : /^vehicle(\d+)$/.exec(a) ? a : null;
      const other = vehicle === b ? a : b;
      const t = vehicle ? trucks[Number(vehicle.slice(7)) - 1] : null;
      const trigger = triggerByName.get(other);
      value = !!(t && trigger && insideTrigger(trigger, t.state.pos));
    } else if (c.flag) value = scriptFlags.has(c.flag.toLowerCase());
    // Another call as a condition (none in the stock scripts) holds not.
    return c.negate ? !value : value;
  };
  const pathByNumber = (n) => pathRuns.find((r) => r.number === Number(n))?.runner ?? null;
  function stepScript() {
    if (!script) return;
    // Flags of a while run down; one of a frame is gone (0x44ff50).
    for (const [name, flag] of scriptFlags) {
      if (flag.kind === "once") scriptFlags.delete(name);
      else if (flag.kind === "seconds" && (flag.left -= STEP) < 0) scriptFlags.delete(name);
    }
    let said = null;
    for (const rule of script.rules) {
      if (!rule.conditions.every(conditionHolds)) continue;
      for (const { name, args } of rule.actions) {
        if (name === "raise") {
          const flag = String(args[0] ?? "").toLowerCase(), d = String(args[1] ?? "once").toLowerCase();
          raised.push([flag, d === "forever" ? { kind: "forever" } : d === "clear" ? null : d === "once" ? { kind: "once" } : { kind: "seconds", left: Number(d) || 0 }]);
        } else if (name === "startPathObject") pathByNumber(args[0])?.start();
        else if (name === "stopPathObject") pathByNumber(args[0])?.stop();
        else if (name === "togglePathObject") pathByNumber(args[0])?.toggle();
        else if (name === "Message" && args[0]) said = String(args[0]);
      }
    }
    for (const [name, flag] of raised.splice(0)) { if (flag) scriptFlags.set(name, flag); else scriptFlags.delete(name); }
    // A message is shown once while a rule keeps saying it.
    if (said !== lastMessage && said) scriptMessages.push(said);
    lastMessage = said;
  }
  let time = 0;
  for (const t of trucks) t.previous = snapshot(t.state);
  let started = false;
  const keys = { accelerate: false, brake: false, left: false, right: false };

  /** An online room's extension race: "owner" decides the mode's state, "follower" takes it (game/extensions/session-loader.js). */
  const netRole = { authority: init.net?.authority ?? null };
  const extensionSession = createExtensionSession(extensionPayload, {
    step: STEP, trucks, race, levelBoxes, dirty, wallsAround, walls: init.walls, worldFt,
    ground, course, specs, ramps: allRamps, weather: () => weather, watchHeadway, net: netRole,
    // The helicopter for a truck, set down on course segment `segment` (as for a missed checkpoint).
    liftTo: (t, segment) => liftToSegment(t, segment),
  });
  // Loose Wheels (Options, Game; game/extensions/loose-wheels.js): a mutator beside any mode, at its own few hooks.
  const mutator = createMutatorSession(init.looseWheels ?? null, { step: STEP, trucks, race, now: () => time });
  // An extension may give a truck a ground of its own (Combat's, which hides a lost wheel's ground: the wheel never touches).
  for (const session of [extensionSession, mutator]) {
    if (!session?.groundFor) continue;
    trucks.forEach((t, i) => {
      const own = session.groundFor(i, t.ctx.ground);
      if (own) t.ctx.ground = own;
    });
  }
  // A truck an extension keeps out of the race (Race & Rumble's blockers) has no checkpoint left to take: it never
  // passes or misses one, and never closes a lap.
  if (race && !race.summit && !drag && extensionSession?.outOfRace) {
    race.trucks.forEach((rt, i) => {
      if (!extensionSession.outOfRace(i)) return;
      rt.outOfRace = true;
      rt.checkpoint = race.checkpoints.length;
    });
  }
  // Computer racers' own recovery (game/racer-recovery.js), an addition: every one drives back through a missed
  // checkpoint (or calls the helicopter when that is quicker) and gets itself out of a jam; the helicopter is its last
  // resort, when it makes no headway, never a fixed count-down. A truck that starts off the course (Castle Nugget's
  // grid stands on the castle) finds its way to it the same way.
  // Only the OMTM2 drivers (Advanced, Computer trucks); the EVO ones follow the track's AI line (game/evo-driver.js).
  const evoLine = aiBehaviour === "evo" && init.evoLine?.points?.length > 10 ? evoAiLine(init.evoLine) : null;
  if (race && !race.summit && !drag && course.length && evoLine) {
    trucks.forEach((t, i) => {
      if (!t.autopilot || t.remote || t.cprDriver || race.trucks[i].outOfRace) return;
      t.evoDriver = createEvoDriver(evoLine, Math.min(4, Math.max(1, Number(difficulty) + 1)));
    });
  }
  if (race && !race.summit && !drag && course.length && aiBehaviour === "omtm2") {
    trucks.forEach((t, i) => {
      if (!t.autopilot || t.remote || t.cprDriver || race.trucks[i].outOfRace) return;
      t.racerRecovery = createRacerRecovery({ returns: true, unsticks: true });
      // Every computer truck on the course keeps control of itself (game/cpu-control.js).
      t.cpuControl = createCpuControl();
      // And learns the corners it cannot take at the SIT's speed (game/cpu-pace.js).
      t.cpuPace = createCpuPace(course.length);
      t.pace = 1;
    });
  }

  /**
   * This frame's boxes (MTM2_PHYSICS.md 14.15): those within r + R + 10 ft on x and z of a truck
   * or of a box already listed, and those moving faster than 0.1 ft/s; then the ramps (14.19).
   */
  const LIST_CELL_FT = 256, listCells = Math.max(1, Math.round(worldFt / LIST_CELL_FT));
  const listGrid = new Map();
  /** Calls `fn(cell)` for each grid cell (on the wrap) the square of half side `reach` about (x, z) covers, until it returns true. */
  function eachListCell(x, z, reach, fn) {
    const x0 = Math.floor((x - reach) / LIST_CELL_FT), x1 = Math.floor((x + reach) / LIST_CELL_FT);
    const z0 = Math.floor((z - reach) / LIST_CELL_FT), z1 = Math.floor((z + reach) / LIST_CELL_FT);
    const nx = Math.min(listCells, x1 - x0 + 1), nz = Math.min(listCells, z1 - z0 + 1);
    for (let j = 0; j < nz; j++) {
      const cz = (((z0 + j) % listCells) + listCells) % listCells;
      for (let i = 0; i < nx; i++) if (fn(cz * listCells + ((((x0 + i) % listCells) + listCells) % listCells))) return;
    }
  }
  /** Whether `box` is within `r` + its radius + 10 ft of (x, z) on x and z, the short way round the world's seam. */
  const nearListing = (x, z, r, box) => {
    const range = r + box.radius + 10;
    return Math.abs(wrapDelta(box.pos[0] - x)) < range && Math.abs(wrapDelta(box.pos[2] - z)) < range;
  };
  // A truck that is not the player's own does not bring in a type 11 box or one with no model (MTM2 and CP4,
  // OpenPhotex `listedByComputerTruck`); the player's truck and the listed objects bring in every box.
  const bringsIn = (box, t, i) => nearListing(t.state.pos[0], t.state.pos[2], t.radius, box)
    && (i === 0 || !mtm2Listing || solidForAll || S.listedByComputerTruck(box.type, box.hasModel, networkDrivers));

  /*
    The list without going through it (`chainFast`): which boxes listBoxes would list, asked only of the boxes that
    matter this step. A box that is listed and far from every truck, every moving box and every ramp changes nothing
    (an inert box's step does nothing, and every pair test with it returns at its first, distance, test), and a city
    lists nearly all its thousands of boxes a step through its blocks. So:

    - the inert boxes (`inert`, they never move) stand in `stillCells`, a grid of LIST_CELL_FT cells on the world's
      wrap, each in the cells its radius twice + 10 ft covers (`stillAround`: the boxes a square may be near, for every
      test below);
    - each inert box keeps the inert boxes before it in the level's order that it is near (`chainBefore`), worked out
      once; the boxes that can move (`live`) are looked at again each step;
    - a box is listed when it is a seed (moving, or brought in by a truck) or is near a listed box before it: in the
      order listBoxes goes, that is being reached from a seed through boxes each near the next and each later than the
      last. `isListed` follows those links back from the box asked about, remembered for the step.

    The answers are listBoxes's, box for box, and the boxes handed on keep its order. Only where it pays, a level of
    CHAIN_FAST_INERT inert boxes or more (a stock track lists a few hundred quicker by going through them), and not with a
    mode's own session (its boxes and its walls take the whole list) or a world that is not a whole number of cells.
  */
  const CHAIN_FAST_INERT = 1000;
  const chainFast = !extensionSession && worldFt % LIST_CELL_FT === 0
    && levelBoxes.reduce((n, box) => n + (box.inert && !box.ghost ? 1 : 0), 0) >= CHAIN_FAST_INERT;
  let stillCells = null, stillMoving = [], live = [], liveCells = new Map(), aroundQuery = 0, listStep = 0;
  /** The listed boxes that can move (in the level's order), and a mode's own and Loose Wheels' boxes, this step. */
  let listedLive = [], extraBoxes = [], listAny = false;
  function prepareChain() {
    stillCells = new Map();
    live = [];
    levelBoxes.forEach((box, i) => {
      Object.assign(box, { listIndex: i, seenAt: 0, seedAt: 0, memoAt: 0, memoListed: false, chainBefore: null, listX: box.pos[0], listZ: box.pos[2] });
    });
    for (const box of levelBoxes) {
      if (box.ghost) continue;
      if (!box.inert) { live.push(box); continue; }
      addToCells(stillCells, box);
      // An inert box's speed never changes: one set moving (over 0.1 ft/s) is a seed every step.
      if (Math.hypot(box.vel[0], box.vel[1], box.vel[2]) > 0.1) stillMoving.push(box);
    }
    for (const box of levelBoxes) {
      if (box.ghost || !box.inert) continue;
      const before = [];
      stillAround(box.pos[0], box.pos[2], box.radius, (o) => { if (o.listIndex < box.listIndex && listedNearAt(o, box)) before.push(o); });
      box.chainBefore = before;
    }
  }
  function addToCells(cells, box) {
    eachListCell(box.pos[0], box.pos[2], 2 * box.radius + 10, (cell) => {
      const there = cells.get(cell);
      if (there) there.push(box); else cells.set(cell, [box]);
      return false;
    });
  }
  /**
   * Calls `fn(box)` once for each box of `cells` whose square may meet the square of half side `reach` about (x, z).
   * The boxes are gathered first: `fn` may ask the grid again.
   */
  function stillAround(x, z, reach, fn, cells = stillCells) {
    const query = ++aroundQuery, found = [];
    eachListCell(x, z, reach, (cell) => {
      const there = cells.get(cell);
      if (there) for (const box of there) if (box.seenAt !== query) { box.seenAt = query; found.push(box); }
      return false;
    });
    for (const box of found) fn(box);
  }
  /** listBoxes's "near a listed box" for `o` before `box`, where both stood when the list was made (`listX`, `listZ`). */
  function listedNearAt(o, box) {
    const range = o.radius + box.radius + 10;
    return Math.abs(wrapDelta(box.listX - o.listX)) < range && Math.abs(wrapDelta(box.listZ - o.listZ)) < range;
  }
  /** The listed boxes before `box` that it is near could be any of these: the inert ones it keeps, and the live ones. */
  function eachBefore(box, fn) {
    if (box.chainBefore) for (const o of box.chainBefore) { if (fn(o)) return; }
    else stillAround(box.listX, box.listZ, box.radius, (o) => { if (o.listIndex < box.listIndex) fn(o); });
    stillAround(box.listX, box.listZ, box.radius, (o) => { if (o.listIndex < box.listIndex) fn(o); }, liveCells);
  }
  /** Whether listBoxes lists `box` this step (a level box that is not a ghost). */
  function isListed(box) {
    if (box.memoAt === listStep) return box.memoListed;
    const stack = [box];
    while (stack.length) {
      const b = stack[stack.length - 1];
      if (b.memoAt === listStep) { stack.pop(); continue; }
      let listedNow = b.seedAt === listStep, waiting = null;
      if (!listedNow) {
        eachBefore(b, (o) => {
          if (waiting || listedNow || !listedNearAt(o, b)) return listedNow;
          if (o.memoAt !== listStep) waiting = o;
          else if (o.memoListed) listedNow = true;
          return listedNow;
        });
      }
      if (waiting && !listedNow) { stack.push(waiting); continue; }
      b.memoAt = listStep;
      b.memoListed = listedNow;
      stack.pop();
    }
    return box.memoListed;
  }
  function listChain() {
    if (!stillCells) prepareChain();
    listStep++;
    // The live boxes stand where they are this step.
    liveCells = new Map();
    for (const box of live) { box.listX = box.pos[0]; box.listZ = box.pos[2]; addToCells(liveCells, box); }
    // The seeds: what moves faster than 0.1 ft/s, and what a truck brings in. With none, nothing is listed.
    listAny = false;
    for (const box of live) if (Math.hypot(box.vel[0], box.vel[1], box.vel[2]) > 0.1) { box.seedAt = listStep; listAny = true; }
    for (const box of stillMoving) { box.seedAt = listStep; listAny = true; }
    trucks.forEach((t, i) => {
      const bring = (box) => { if (box.seedAt !== listStep && bringsIn(box, t, i)) { box.seedAt = listStep; listAny = true; } };
      stillAround(t.state.pos[0], t.state.pos[2], t.radius, bring);
      stillAround(t.state.pos[0], t.state.pos[2], t.radius, bring, liveCells);
    });
    listedLive = live.filter(isListed);
    extraBoxes = [...extensionSession?.movableBoxes?.() ?? [], ...mutator?.movableBoxes() ?? []];
    if (extraBoxes.length) listAny = true;
    ground.ramps.length = 0;
    for (const ramp of allRamps) {
      let near = trucks.some((t) => nearListing(t.state.pos[0], t.state.pos[2], t.radius, ramp))
        || listedLive.some((o) => nearListing(o.pos[0], o.pos[2], o.radius, ramp))
        || extraBoxes.some((o) => nearListing(o.pos[0], o.pos[2], o.radius, ramp));
      if (!near) stillAround(ramp.pos[0], ramp.pos[2], ramp.radius, (o) => { if (!near && nearListing(o.pos[0], o.pos[2], o.radius, ramp) && isListed(o)) near = true; });
      if (near) ground.ramps.push(ramp);
    }
  }
  /** The listed boxes within `reach` + their radius of (x, z) on x and z, in the list's order (`all` with listBoxes). */
  function listedAround(x, z, reach, test) {
    if (!chainFast) return listed.filter(test);
    const found = [];
    stillAround(x, z, reach, (box) => { if (test(box) && isListed(box)) found.push(box); });
    for (const box of listedLive) if (test(box)) found.push(box);
    found.sort((a, b) => a.listIndex - b.listIndex);
    for (const box of extraBoxes) if (test(box)) found.push(box);
    return found;
  }

  function listBoxes() {
    if (chainFast) { listChain(); return; }
    listed.length = 0;
    const near = nearListing;
    const nearTruck = (box) => trucks.some((t) => near(t.state.pos[0], t.state.pos[2], t.radius, box));
    const truckBringsIn = (box) => trucks.some((t, i) => bringsIn(box, t, i));
    // "Near a box already listed", without testing every listed box: the boxes listed so far stand in a grid on the
    // world's wrap, each in the cells its reach covers (its radius + 10 ft either way), and a box asks only the cells
    // it covers (its radius either way). Two boxes are near only when those squares overlap, so the answer, the list
    // and its order are the same as testing them all (a box still sees exactly the boxes listed before it). A city of
    // 6,600 boxes listed one another all over the map: testing each against every listed box took 94 percent of the
    // simulation (gta3conversion's Liberty City, 25 steps a second).
    listGrid.clear();
    const listedNear = (box) => {
      let hit = false;
      eachListCell(box.pos[0], box.pos[2], box.radius, (cell) => {
        const there = listGrid.get(cell);
        if (there) for (const o of there) if (near(o.pos[0], o.pos[2], o.radius, box)) { hit = true; return true; }
        return false;
      });
      return hit;
    };
    const addListed = (box) => {
      listed.push(box);
      eachListCell(box.pos[0], box.pos[2], box.radius + 10, (cell) => {
        const there = listGrid.get(cell);
        if (there) there.push(box); else listGrid.set(cell, [box]);
        return false;
      });
    };
    for (const box of levelBoxes) {
      if (box.ghost) continue;
      const moving = Math.hypot(box.vel[0], box.vel[1], box.vel[2]) > 0.1;
      if (moving || truckBringsIn(box) || listedNear(box)) addListed(box);
    }
    // An extension's own loose objects (Combat's lost wheels) are always in the list: every truck meets them.
    for (const box of extensionSession?.movableBoxes?.() ?? []) addListed(box);
    for (const box of mutator?.movableBoxes() ?? []) addListed(box);
    ground.ramps.length = 0;
    for (const ramp of allRamps) {
      if (nearTruck(ramp) || listedNear(ramp)) ground.ramps.push(ramp);
    }
  }

  // Top-crush cars (14.27): the truck is held up by the body and the cab, and flattens the cab.
  /**
   * 4x4 Evolution's trees (docs/EVO2_EXE_ANALYSIS.md 2.5): a tree inside a truck's hull footprint is touched, every step
   * it stays there, with the truck's velocity; the drawing leans it (game/falling-trees.js). The game then runs its
   * truck-against-object response, whose figures for a tree are not traced, so here the truck does not feel it.
   * `fallen` collects the touches for the drawing, one a tree a reply.
   */
  let fallen = [];
  function knockTree(t, box) {
    const s = t.state, m = s.matrix;
    const dx = box.pos[0] - s.pos[0], dy = box.pos[1] - s.pos[1], dz = box.pos[2] - s.pos[2];
    const x = m[0] * dx + m[3] * dy + m[6] * dz, z = m[2] * dx + m[5] * dy + m[8] * dz;
    t.footprint ??= (() => {
      const pts = t.params.scrapePoints.length ? t.params.scrapePoints : t.params.hubs;
      return { x0: Math.min(...pts.map((p) => p[0])) - 1, x1: Math.max(...pts.map((p) => p[0])) + 1, z0: Math.min(...pts.map((p) => p[2])) - 1, z1: Math.max(...pts.map((p) => p[2])) + 1 };
    })();
    const f = t.footprint;
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1 || Math.abs(dy) > box.half[1] + 10) return;
    const v = [m[0] * s.bvel[0] + m[1] * s.bvel[1] + m[2] * s.bvel[2], m[6] * s.bvel[0] + m[7] * s.bvel[1] + m[8] * s.bvel[2]];
    const hit = { id: box.tree, pos: [box.pos[0], box.pos[1] - box.half[1], box.pos[2]], dir: v, speed: Math.hypot(v[0], v[1]) };
    const at = fallen.findIndex((h) => h.id === box.tree);
    if (at < 0) fallen.push(hit); else if (hit.speed > fallen[at].speed) fallen[at] = hit;
  }
  const crushCars = (init.topCrush ?? []).map((car) => S.createTopCrush(car, car.bodyBounds ?? null, car.cabBounds ?? null, worldFt));
  const crushCtx = { groundNormal: (x, z) => ground.normal(x, z, [0, 0, 0]), dt: STEP, edges: S.createEdgeState() };
  /** The pair tests (14.14, 14.17, 14.19, 14.20, 14.21), trucks first in list order. */
  /** When each pair of trucks last pushed on each other (its step count), for the crash sound's new meetings. */
  const pairMet = new Map();
  let pairStep = 0;
  function pairTests() {
    pairStep++;
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i + 1; j < trucks.length; j++) {
        const a = trucks[i], b = trucks[j];
        const f = a.state.extForce, f0 = f[0], f1 = f[1], f2 = f[2];
        // A CP4 room: one of this machine's trucks against a remote copy is a hit to report (0x27, 18.3).
        const mixed = cp4Net && a.remote !== b.remote;
        const copy = mixed ? (a.remote ? a : b) : null;
        const copyBefore = copy ? [...copy.state.extForce, ...copy.state.extMoment] : null;
        // How fast they close on each other, along the line between them, before the pair's response.
        const closing = closingSpeedOf(a.state, b.state);
        const met = S.collideTrucks({ s: a.state, p: a.params }, { s: b.state, p: b.params }, STEP, rules, worldFt);
        if (copy && Math.hypot(a.state.pos[0] - b.state.pos[0], a.state.pos[1] - b.state.pos[1], a.state.pos[2] - b.state.pos[2]) < S.truckRadius(a.params) + S.truckRadius(b.params)) {
          const ci = copy === a ? i : j, h = hitNet[ci];
          h.contactAt = wallNow;
          if (wallNow - h.sentAt >= SEND_GAP_S) {
            const cs = copy.state;
            for (let k = 0; k < 3; k++) { h.lin[k] += (cs.extForce[k] - copyBefore[k]) * STEP; h.ang[k] += (cs.extMoment[k] - copyBefore[3 + k]) * STEP; }
            h.source = copy === a ? j : i;
          }
        }
        // A hull against a hull: the pair's forces changed. Remember the hardest hit and where the trucks met.
        const force = Math.hypot(f[0] - f0, f[1] - f1, f[2] - f2);
        if (force > 0) {
          if (drag) dragCollision(drag, a.lane, b.lane);
          extensionSession?.touch?.(i, j);
          mutator?.touch(i, j);
          // Their crash (0x429cb0): from the player's truck when it is one of them, else the second's; once a meeting
          // (game/sound-model.js `truckCrashSound`).
          const key = i * 4096 + j, last = pairMet.get(key);
          pairMet.set(key, pairStep);
          if ((last === undefined || (pairStep - last) * STEP >= CRASH_APART_S) && closing >= CRASH_MIN_FT_S) {
            const from = a === player ? a : b;
            from.snd.crash = Math.max(from.snd.crash ?? 0, closing);
          }
          const where = [0, 1, 2].map((k) => (a.state.pos[k] + b.state.pos[k]) / 2);
          // `hull`: bodywork met, not only tires (which throw no sparks).
          for (const t of [a, b]) {
            const hull = met.hull || !!t.touch?.hull;
            // The pair's force, for a gamepad's rumble (game/input/rumble.js): the game's jolt counts collision forces.
            t.snd.collide = Math.max(t.snd.collide ?? 0, force);
            if (!t.touch || force > t.touch.force) t.touch = { force, pos: where, steps: (t.touch?.steps ?? 0) + 1, hull };
            else { t.touch.steps++; t.touch.hull = hull; }
          }
        }
      }
    }
    const grounds = [];
    let treesTaken = 0;
    for (const [ti, t] of trucks.entries()) {
      t.nearBoxes.length = 0;
      if (t.state.heliTimer > 0) continue;
      if (ra0 && ra1) groundBoxes.around(t.state.pos[0], t.state.pos[2], t.nearBoxes);
      wallsAround(t.state.pos[0], t.state.pos[2], t.radius, t.nearBoxes);
      if (cp4Model) treesTaken += nearestTrees(t, treesTaken);
      // Each test is made with the truck as the copy nearest the thing it is tested against (OpenPhotex world/wrap.ts):
      // what stands across the world's seam is met as what stands beside the truck is.
      const near = (thing, test) => S.withNearest(t.state, thing.pos[0], thing.pos[2], test, worldFt);
      for (const box of t.nearBoxes) {
        if (box.tree) { near(box, () => knockTree(t, box)); continue; }
        near(box, () => S.collideTruckImmovableBox(t.state, t.params, box, STEP, rules));
      }
      nearFaces.length = 0;
      facesAround(t.state.pos[0], t.state.pos[2], t.radius, nearFaces);
      for (const face of nearFaces) S.withNearest(t.state, face.centre[0], face.centre[2], () => S.collideTruckFace(t.state, t.params, face, STEP), worldFt);
      // A box further off on x or z than the pair's widest sphere (twice the truck's radius and the box's, the triangle
      // path's) is separated by collideTruckBox's first test, which returns at once with nothing changed: not called.
      // A city lists thousands of boxes a step through its blocks (14.15), nearly all of them far from every truck.
      const special = extensionSession?.specialBox, R = S.truckRadius(t.params);
      const close = (box) => {
        const reach = 2 * (R + box.radius);
        return Math.abs(wrapDelta(box.pos[0] - t.state.pos[0])) < reach && Math.abs(wrapDelta(box.pos[2] - t.state.pos[2])) < reach;
      };
      for (const box of chainFast ? listedAround(t.state.pos[0], t.state.pos[2], 2 * R, close) : listed) {
        if (box !== special && !close(box)) continue;
        const collide = () => {
          const touch = near(box, () => S.collideTruckBox(t.state, t.params, box, STEP, rules));
          if (touch) noteObjectHit(t, box, touch);
          return touch;
        };
        if (box === special) extensionSession.collideSpecial(ti, box, collide);
        else collide();
      }
      for (const car of crushCars) near(car, () => S.collideTruckTopCrush(car, t.state, t.params, crushCtx));
      // Ramp sides and front ends are walls (14.19), for ramps within reach of the truck.
      for (const ramp of ground.ramps) {
        const d = Math.hypot(wrapDelta(ramp.pos[0] - t.state.pos[0]), ramp.pos[1] - t.state.pos[1], wrapDelta(ramp.pos[2] - t.state.pos[2]));
        if (d < ramp.radius + t.radius) near(ramp, () => S.collideTruckRamp(ramp, t.state, t.params));
      }
      grounds.push(...t.nearBoxes);
    }
    // Two boxes that never move never meet (OpenPhotex collideBoxes returns at once): each pair has a moving one first.
    // Through a grid (worker/box-pairs.js): only the pairs that can meet, in the full loops' order.
    if (chainFast) {
      // The list's still boxes that matter are those within a mover's reach (collideBoxes's first test is their spheres).
      const withGrounds = listAny ? grounds : [];
      const moving = [...listedLive, ...extraBoxes, ...withGrounds].filter((box) => box.dynamic);
      if (!moving.length) return;
      const near = new Set();
      for (const m of moving) stillAround(m.pos[0], m.pos[2], m.radius, (o) => { if (isListed(o)) near.add(o); });
      const level = [...near, ...listedLive.filter((box) => !box.dynamic)].sort((a, b) => a.listIndex - b.listIndex);
      const still = [...level, ...extraBoxes.filter((box) => !box.dynamic), ...withGrounds.filter((box) => !box.dynamic)];
      forEachBoxPair(moving, still, (a, b) => S.collideBoxes(a, b, STEP, rules));
      return;
    }
    const all = listed.length ? [...listed, ...grounds] : listed;
    extensionSession?.addSpecialWalls?.(all, listed);
    const moving = all.filter((box) => box.dynamic), still = all.filter((box) => !box.dynamic);
    forEachBoxPair(moving, still, (a, b) => S.collideBoxes(a, b, STEP, rules));
  }

  /** A moved box's pose for drawing. */
  /** A box's pose for drawing: at its model's origin (`drawOffset`, in the box's frame) where that is not its centre. */
  const boxPose = (box) => {
    const pos = [...box.pos], o = box.drawOffset, m = box.matrix;
    if (o) for (let i = 0; i < 3; i++) pos[i] += m[i * 3] * o[0] + m[i * 3 + 1] * o[1] + m[i * 3 + 2] * o[2];
    return { sitIndex: box.sitIndex, pos, matrix: Array.from(m), euler: Array.from(box.euler) };
  };

  /** A truck's recovery context, aimed at its course segment (or segment `i`) when it has one (10.3). */
  function recoveryOf(t, i = t.state.ap.segment) {
    const own = apOf(t).course;
    if (own.length) {
      const driven = S.orientedCourse(own, apCtx.reversed);
      t.recovery.segment = driven[i];
      t.recovery.previous = driven[apCtx.reversed ? (i + 1) % own.length : (i + own.length - 1) % own.length];
    }
    return t.recovery;
  }

  // GOLD mode (MONSTER_EXE_ANALYSIS.md 15): the player's autopilot level, slew mode, the
  // reversed course.
  // `cpuStopped`: Z mode's X, every computer truck's autopilot off (MONSTER_EXE_ANALYSIS.md 15).
  const gold = { slew: false, cpuStopped: false };
  /** 0 manual, 1 speed control only (the player steers), 2 full autopilot (Ctrl+T cycles them). */
  player.apLevel = player.autopilot ? 2 : 0;
  function setAutopilotLevel(level) {
    if (!course.length) return player.apLevel;
    player.apLevel = level;
    player.autopilot = level === 2;
    player.ctx.human = level !== 2;
    // In a Rumble every truck recovers as the player does (see the Rumble's drivers above).
    player.recovery.player = level !== 2 || !!race?.summit;
    player.recovery.autopilot = level === 2 && !race?.summit;
    if (race) race.trucks[0].player = level !== 2;
    return level;
  }
  /**
   * Slew mode: the simulation stands still and the truck the camera is on (`slew.truck`, the player's when not given)
   * is moved by hand (MONSTER_EXE_ANALYSIS.md 15).
   */
  function slewMove(slew) {
    const s = (Number.isInteger(slew.truck) ? trucks[slew.truck] : null)?.state ?? player.state;
    const speed = (slew.fast ? 160 : 40) * STEP;
    const sin = Math.sin(s.euler[2]), cos = Math.cos(s.euler[2]);
    s.pos[0] += (sin * slew.forward + cos * slew.right) * speed;
    s.pos[2] += (cos * slew.forward - sin * slew.right) * speed;
    s.pos[1] += slew.up * speed;
    const turn = (slew.fast ? 1.6 : 0.6) * STEP;
    s.euler[2] += slew.yaw * turn;
    s.euler[1] += slew.roll * turn;
    s.euler[0] += slew.pitch * turn;
    S.eulerToMatrix(s.euler[0], s.euler[1], s.euler[2], s.matrix);
    s.prevPos.set(s.pos);
    s.bvel.fill(0);
    s.rates.fill(0);
  }
  // ---- Multiplayer (docs/MULTIPLAYER.md, MONSTER_EXE_ANALYSIS.md 14.4) ----
  /**
   * How remote trucks follow their updates: "legacy" as the game (controls, velocity and angles from every update, the
   * position snapped at most once a second), or "smooth" (the error eased out over REMOTE_BLEND_S, snapped past
   * REMOTE_SNAP_FT, stale updates dropped).
   */
  const remotePolicy = init.net?.policy === "smooth" || init.net?.policy === "cp4" ? init.net.policy : "legacy";
  /*
    "cp4": a Community Patch 4 room (docs/CP4_EXE_ANALYSIS.md 18): remote trucks played back from a buffer by their
    senders' ticks and pinned there before every step (net/cp4-sync.js), hits sent and judged as packet 0x27, each
    truck's progress from its owner (0x26). `wallNow` is the race screen's clock for this frame, seconds.
  */
  const cp4Net = remotePolicy === "cp4";
  const cp4Sync = cp4Net ? createCp4Sync({ worldFt }) : null;
  let wallNow = 0, wallDt = 0;
  const toBodyFrame = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const toWorldFrame = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const massOf = (t) => S.truckWeight(t.params) * S.INV_G;
  /** 0x27: per truck, when this machine last met it, the hits summed for it and when one was last sent to it. */
  const hitNet = cp4Net ? trucks.map(() => ({ contactAt: -Infinity, sentAt: -Infinity, lin: [0, 0, 0], ang: [0, 0, 0], source: null, pending: null, budget: { used: 0, at: null }, history: [] })) : null;
  /** 0x26: what was last sent for each truck this machine owns. */
  const sentProgress = trucks.map(() => null);
  let lastNetTick = null;
  /** Put a truck where it is said to be, at rest in its angles; the picture does not slide there. */
  function placeTruck(t, pos, euler) {
    const s = t.state;
    s.pos[0] = pos[0]; s.pos[1] = pos[1]; s.pos[2] = pos[2];
    if (euler) { s.euler[0] = euler[0]; s.euler[1] = euler[1]; s.euler[2] = euler[2]; }
    S.eulerToMatrix(s.euler[0], s.euler[1], s.euler[2], s.matrix);
    s.prevPos.set(s.pos);
  }
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  /**
   * One update for a remote truck: `{ truck, pos, bvel, euler, steer, throttle, brakeRear, brakeFront?, gear, autoShift?,
   * score?, seq? }`, game units (feet, ft/s, radians, controls 0 to 1).
   */
  function applyRemote(u) {
    const t = trucks[u.truck];
    if (!t?.remote) return false;
    if (remotePolicy === "smooth" && Number.isFinite(u.seq)) {
      // Sequence numbers are 16-bit and wrap: older means up to half the range behind.
      if (t.lastSeq !== undefined) { const d = (u.seq - t.lastSeq) & 0xffff; if (d === 0 || d >= 0x8000) return false; }
      t.lastSeq = u.seq;
    }
    const s = t.state, c = s.controls;
    c.throttle = u.throttle ?? 0;
    c.brakeRear = u.brakeRear ?? 0;
    // The game sets both brakes from the rear one it sends.
    c.brakeFront = u.brakeFront ?? c.brakeRear;
    c.steer = u.steer ?? 0;
    c.rearSteer = S.rearSteer(c.steer, !!drag);
    if (Number.isFinite(u.gear)) c.gear = u.gear;
    if (u.autoShift !== undefined) t.params.autoShift = !!u.autoShift;
    if (u.bvel) s.bvel.set(u.bvel);
    if (race?.summit && Number.isFinite(u.score)) race.summit.trucks[u.truck].score = u.score;
    if (cp4Net) {
      // The packet's body velocity until the pin's own takes over; the pose goes to the buffer.
      if (u.bvel) t.netBvel = [...u.bvel];
      if (u.pos && u.euler) cp4Sync.receive({ truck: u.truck, sender: u.sender ?? u.truck, tick: u.tick ?? 0, pos: u.pos, euler: u.euler, poses: u.poses ?? [] }, Number.isFinite(u.at) ? u.at / 1000 : wallNow);
      return true;
    }
    if (remotePolicy === "legacy") {
      if (u.euler) {
        for (let k = 0; k < 3; k++) s.euler[k] = wrapPi(u.euler[k]);
        S.eulerToMatrix(s.euler[0], s.euler[1], s.euler[2], s.matrix);
      }
      // 0x58e1f0: the position only when a second has passed since that truck's last snap.
      if (u.pos && (t.lastSnap === undefined || time - t.lastSnap > 1)) {
        placeTruck(t, u.pos, null);
        t.lastSnap = time;
      }
      return true;
    }
    if (!u.pos) return true;
    const dp = [u.pos[0] - s.pos[0], u.pos[1] - s.pos[1], u.pos[2] - s.pos[2]];
    if (Math.hypot(dp[0], dp[1], dp[2]) > REMOTE_SNAP_FT || !u.euler) {
      placeTruck(t, u.pos, u.euler);
      t.blend = null;
      return true;
    }
    t.blend = { dp, de: u.euler.map((a, k) => wrapPi(a - s.euler[k])), left: REMOTE_BLEND_S };
    return true;
  }
  /** A smoothed remote truck's step share of its error. */
  function easeRemote(t) {
    const b = t.blend;
    if (!b || b.left <= 0) return;
    const share = Math.min(STEP, b.left) / REMOTE_BLEND_S;
    b.left -= STEP;
    const s = t.state;
    for (let k = 0; k < 3; k++) { s.pos[k] += b.dp[k] * share; s.euler[k] += b.de[k] * share; }
    S.eulerToMatrix(s.euler[0], s.euler[1], s.euler[2], s.matrix);
  }
  /**
   * CP4's pin (18.2): before a step, a remote truck is put where its buffer says it is at playback + lead, its world
   * velocity the buffer's, its body velocity the move over the next tick (or the packet's). A computer truck with no
   * packet for STALE_S is left where it goes.
   */
  function pinRemote(t, i) {
    if (!cp4Sync.has(i) || (t.remoteComputer && cp4Sync.age(i, wallNow) > STALE_S)) return;
    const p = cp4Sync.pin(i, wallNow);
    if (!p) return;
    const s = t.state;
    s.pos[0] = p.pos[0]; s.pos[1] = p.pos[1]; s.pos[2] = p.pos[2];
    s.euler[0] = wrapPi(p.euler[0]); s.euler[1] = wrapPi(p.euler[1]); s.euler[2] = p.euler[2];
    S.eulerToMatrix(s.euler[0], s.euler[1], s.euler[2], s.matrix);
    s.prevPos.set(s.pos);
    const bvel = p.pinVel ? toBodyFrame(s.matrix, p.pinVel) : t.netBvel;
    if (bvel) s.bvel.set(bvel);
  }
  /** The pose a CP4 remote truck is drawn in (the playback time, with its correction), or null. */
  function drawnRemote(i, snap) {
    const d = cp4Sync.drawn(i, wallNow);
    if (!d) return snap;
    const matrix = S.eulerToMatrix(d.euler[0], d.euler[1], d.euler[2], new Array(9));
    return { ...snap, pos: d.pos, euler: d.euler, matrix };
  }
  /** Each frame before the steps: the hits received (0x27) fed into their trucks over APPLY_S. */
  function feedHits() {
    hitNet.forEach((h, i) => {
      if (!h.pending) return;
      const { dv, w, done } = feedHit(h.pending, wallDt);
      const s = trucks[i].state;
      for (let k = 0; k < 3; k++) s.bvel[k] += dv[k];
      // Body rates: x is q, y is r, z is p.
      s.rates[1] += w[0]; s.rates[2] += w[1]; s.rates[0] += w[2];
      if (done) h.pending = null;
    });
  }
  /** After the steps: the hits this machine's trucks dealt the remote copies, one packet a victim (0x27). */
  function flushHits() {
    const out = [];
    hitNet.forEach((h, i) => {
      if (h.source === null) return;
      const lin = h.lin, ang = h.ang, source = h.source;
      h.lin = [0, 0, 0]; h.ang = [0, 0, 0]; h.source = null;
      if (Math.hypot(lin[0], lin[1], lin[2]) / massOf(trucks[i]) < SEND_MIN_DV) return;
      h.sentAt = wallNow;
      out.push({ target: i, source, linear: lin, angular: ang });
    });
    return out;
  }
  /** The end-of-frame poses of this machine's trucks, the victim's side of the hit check (16 kept). */
  function keepHitHistory() {
    trucks.forEach((t, i) => {
      if (t.remote) return;
      const h = hitNet[i].history;
      h.push({ at: wallNow, pos: Array.from(t.state.pos), vel: toWorldFrame(t.state.matrix, t.state.bvel) });
      if (h.length > 16) h.shift();
    });
  }
  /** A received hit (0x27) on one of this machine's trucks: the mirror rule, the hit check and the budget. */
  function takeHit({ target, source, linear, angular, rtt = 0 }) {
    const t = trucks[target], from = trucks[source];
    if (!cp4Net || !t || t.remote || !from?.remote) return false;
    const h = hitNet[target];
    if (wallNow - hitNet[source].contactAt < MIRROR_S) return false;
    const drawnTime = cp4Sync.playback(source, wallNow), lead = cp4Sync.lead(source);
    const history = hitHistory({
      ours: h.history, attacker: (time) => cp4Sync.at(source, time), span: cp4Sync.span(source), now: wallNow,
      drawnTime, pinTime: drawnTime + lead, delay: cp4Sync.appliedDelay(source, wallNow), lead, rtt: rtt > 0 && rtt < 1 ? rtt : 0,
      radii: [S.truckRadius(t.params), S.truckRadius(from.params)], worldFt,
    });
    const hit = judgeHit({ linear, angular, mass: massOf(t), inertia: t.params.inertia, history, check: true, budget: h.budget, now: wallNow });
    if (!hit) return false;
    const p = h.pending ?? (h.pending = { dv: [0, 0, 0], w: [0, 0, 0] });
    for (let k = 0; k < 3; k++) { p.dv[k] += hit.dv[k]; p.w[k] += hit.w[k]; }
    return true;
  }
  /**
   * 0x26 out (18.1): for each truck this machine owns, what CP4 sends, when it changes. A race: at each pass, the
   * passes (to 90) and the total of the laps closed before it. A drag lane: 1 prestaged, 2 staged, 3 the tree has run,
   * 4 and on the beams after the start, the disqualification's code (95, the re-run, is each machine's own), and at the
   * finish the elapsed time. Never in a Summit Rumble.
   */
  function progressOut() {
    if (!race || race.summit || !S.raceStarted(race) && !drag) return null;
    const out = [];
    trucks.forEach((t, i) => {
      if (t.remote) return;
      const rt = race.trucks[i];
      let now = null;
      if (drag) {
        const l = drag.lanes[t.lane];
        if (!l || l.empty) return;
        const code = l.dq ? DQ_CODE[l.dq] ?? OUT.LANE : null;
        const segments = code ?? (l.state >= STAGED.LAUNCHED ? 4 + l.next + (l.et !== null ? 1 : 0)
          : l.state >= STAGED.STAGED && (drag.phase === "tree" || drag.phase === "go") ? 3 : l.state);
        now = { segments, total: l.et ?? 0 };
      } else {
        const last = sentProgress[i];
        if (last && last.passCount === rt.passCount) return;
        if (!last && !rt.passCount) { sentProgress[i] = { passCount: 0, laps: 0 }; return; }
        // The total before this pass's lap closed: the lap the pass closed is left out, as CP4 sends it.
        const closed = rt.laps > (last?.laps ?? 0);
        now = { segments: Math.min(90, rt.passCount), total: closed ? rt.raceTime - (rt.lapTimes[rt.lapTimes.length - 1] ?? 0) : rt.raceTime, passCount: rt.passCount, laps: rt.laps };
        sentProgress[i] = now;
        out.push({ truck: i, segments: now.segments, total: now.total });
        return;
      }
      const last = sentProgress[i];
      if (last && last.segments === now.segments && last.total === now.total) return;
      if (!last && !now.segments && !now.total) { sentProgress[i] = now; return; }
      sentProgress[i] = now;
      out.push({ truck: i, ...now });
    });
    return out.length ? out : null;
  }
  /**
   * 0x26 in (18.1): a remote truck's passes and total from its owner, set (not added). On a drag strip its lane's
   * staging, launch, finish time or disqualification.
   */
  function takeProgress({ truck, segments, total }) {
    const t = trucks[truck], rt = race?.trucks[truck];
    if (!t?.remote || !rt || race.summit) return false;
    const seg = Math.max(0, Math.trunc(Number(segments) || 0)), time = Number(total) || 0;
    if (drag) {
      const l = drag.lanes[t.lane];
      if (!l) return false;
      if (seg >= 91) {
        l.dq = Object.keys(DQ_CODE).find((k) => DQ_CODE[k] === seg) ?? (seg === OUT.RERUN ? null : "out of lane");
        if (seg === OUT.RERUN) l.rerun = true;
      } else {
        const state = seg >= 4 ? STAGED.LAUNCHED : seg >= 2 ? STAGED.STAGED : seg >= 1 ? STAGED.PRESTAGED : STAGED.NONE;
        if (state >= STAGED.STAGED && l.stagedAt === null) l.stagedAt = drag.clock;
        l.state = state;
        if (seg >= 4) l.next = Math.max(0, Math.min(l.beams.gates.length, seg - 4));
      }
      if (time > 0) {
        l.et = time;
        if (!l.lapTimes.length) { l.lapTimes = [time]; l.best = time; }
      }
      return true;
    }
    rt.passCount = Math.min(90, seg);
    if (time > 0) rt.raceTime = time;
    return true;
  }
  /** What a truck this machine owns sends (the 0x02 fields, game units). */
  function netState(i) {
    const t = trucks[i], s = t.state, c = s.controls;
    return {
      truck: i, pos: Array.from(s.pos), bvel: Array.from(s.bvel), euler: Array.from(s.euler), steer: c.steer, throttle: c.throttle,
      brakeRear: c.brakeRear, brakeFront: c.brakeFront, gear: c.gear, autoShift: !!t.params.autoShift,
      score: race?.summit ? race.summit.trucks[i].score : 0,
      // CP3's and CP4's sender tick, 25 a second from the start of the session (never 0).
      tick: Math.floor(time / CP4_TICK_S) + 1,
    };
  }
  /**
   * A remote truck's checkpoint report (packet 0x0b): `next`, its next checkpoint after the pass, and the split. A pass
   * this machine saw already is left alone; one it missed (the truck was snapped past the gate) is counted now.
   */
  function remoteSplit({ truck, next, split }) {
    const rt = race?.trucks[truck];
    if (!rt || rt.finished || rt.outOfRace || !trucks[truck]?.remote || race.summit) return false;
    const n = race.checkpoints.length;
    if (!n || ((rt.checkpoint + 1) % n) !== ((next % n) + n) % n) return false;
    rt.splits.push(Number.isFinite(split) ? split : 0);
    rt.checkpoint++;
    rt.passed = rt.laps * n + rt.checkpoint;
    if (rt.checkpoint >= n) {
      const lap = rt.splits.reduce((a, x) => a + x, 0);
      rt.raceTime += lap;
      rt.lapTimes.push(lap);
      if (!rt.fastestLap || lap < rt.fastestLap) rt.fastestLap = lap;
      rt.laps++;
      rt.checkpoint = 0;
      rt.splits = [];
      if (rt.laps >= rt.finishLap) rt.finished = true;
    }
    return true;
  }
  /** A network command; returns what it changed. */
  function netCommand(name, value) {
    if (name === "remote") return (value ?? []).map(applyRemote);
    if (name === "split") return remoteSplit(value);
    if (name === "collision") return takeHit(value);
    if (name === "progress") return takeProgress(value);
    if (name === "startPositions") {
      // 0x17: every truck's start position from the host, headings kept.
      (value ?? []).forEach((pos, i) => { if (pos && trucks[i]) placeTruck(trucks[i], pos, null); });
      return true;
    }
    if (name === "raceStart") {
      // 0x19: the first machine to finish the countdown starts everyone's race.
      if (!race || S.raceStarted(race)) return false;
      race.clock = race.startTime;
      return true;
    }
    if (name === "handOver") {
      // A player left: their truck goes to the autopilot on every machine (not in a Summit Rumble).
      const t = trucks[value];
      if (!t?.remote) return false;
      t.remote = false;
      // An extension drives its own computer trucks without a course (Hockey, Tag).
      if ((!course.length && !extensionPayload) || race?.summit) return true;
      t.autopilot = true;
      t.recovery.autopilot = true;
      if (race) race.trucks[value].player = false;
      return true;
    }
    // An online room's extension race: the owner's mode state, and taking over when the owner left.
    if (name === "mode") return extensionSession?.applyNet ? (extensionSession.applyNet(value), true) : false;
    if (name === "modeAuthority") { netRole.authority = value ? "owner" : "follower"; return true; }
    if (name === "modeOwn") return extensionSession?.applyNetOwn ? (extensionSession.applyNetOwn(value), true) : false;
    // Wheels damage online: another machine's trucks' wheels (game/extensions/loose-wheels-session.js `applyNetOwn`).
    if (name === "wheelsOwn") return mutator?.applyNetOwn ? mutator.applyNetOwn(value) : false;
    return undefined;
  }

  /**
   * The race as Monster Truck Madness 2's saved game keeps it (MONSTER_EXE_ANALYSIS.md 16, "Saved games"): the clock
   * and every truck's motion, gear, course segment and race progress. Null outside a circuit, rally or Rumble.
   */
  function savedRace() {
    if (!race || drag) return null;
    return {
      clock: race.clock, startTime: race.startTime,
      trucks: trucks.map((t, i) => {
        const st = t.state, rt = race.trucks[i];
        return {
          pos: [...st.pos], bvel: [...st.bvel], euler: [...st.euler], rates: [...st.rates], gear: st.controls.gear,
          autopilot: t.autopilot ? 1 : 0, cnumber: st.ap?.segment ?? 0, progress: rt.progress ?? 0, laps: rt.laps,
          passCount: rt.passCount ?? 0, finished: rt.finished ? 1 : 0, checkpoint: rt.checkpoint, raceTime: rt.raceTime,
          fastestLap: rt.fastestLap ?? 0, splits: [...(rt.splits ?? [])],
          // A Rumble keeps its score where a race keeps its first lap's time (+0xf50).
          lapTimes: race.summit ? [race.summit.trucks[i].score] : [...rt.lapTimes],
        };
      }),
      // A .CPX race's state (CP4 2.0.52.4's saved-game block): each truck's penalties and the course it follows.
      ...(cpxRules ? { cpx: trucks.map((t, i) => ({ penaltyMs: penalties?.totals[i] ?? 0, course: t.course ?? 0 })) } : {}),
    };
  }
  /** Put a saved race (`savedRace`'s shape) back: each truck where it was, as fast, with its laps and times. */
  function restoreRace(saved) {
    // A .CPX race's penalties and courses, as the saved game's block keeps them: a truck past its lead-in follows its lane.
    for (const [i, c] of (saved?.cpx ?? []).entries()) {
      penalties?.set(i, c.penaltyMs);
      const t = trucks[i];
      if (t?.leadIn && c.course === t.leadIn.thenIndex) {
        t.apCtx = { ...t.apCtx, course: t.leadIn.then };
        t.leadIn = null;
        t.course = c.course;
      }
    }
    // A saved race's load restarts the tide (CP4_ENGINE_UPDATES.md 7.4).
    if (tide) { S.resetTide(tide); tideCalls = 0; terrainGround.waterLevelFt = S.tideLevelFt(tide); }
    if (!race || drag || !Array.isArray(saved?.trucks)) return false;
    const n = race.checkpoints.length;
    if (Number.isFinite(saved.clock)) race.clock = saved.clock;
    if (Number.isFinite(saved.startTime) && saved.startTime > 0) race.startTime = saved.startTime;
    saved.trucks.forEach((v, i) => {
      const t = trucks[i], rt = race.trucks[i];
      if (!t || !rt || !v) return;
      const st = t.state;
      for (let k = 0; k < 3; k++) {
        st.pos[k] = Number(v.pos?.[k]) || 0;
        st.bvel[k] = Number(v.bvel?.[k]) || 0;
        st.euler[k] = Number(v.euler?.[k]) || 0;
        st.rates[k] = Number(v.rates?.[k]) || 0;
      }
      S.eulerToMatrix(st.euler[0], st.euler[1], st.euler[2], st.matrix);
      if (Number.isInteger(v.gear)) st.controls.gear = v.gear;
      if (st.ap && Number.isInteger(v.cnumber)) st.ap.segment = v.cnumber;
      rt.progress = v.progress ?? rt.progress;
      rt.laps = Math.max(0, v.laps | 0);
      rt.passCount = v.passCount ?? rt.passCount;
      rt.checkpoint = n ? Math.max(0, Math.min(n - 1, v.checkpoint | 0)) : 0;
      rt.passed = rt.laps * n + rt.checkpoint;
      rt.finished = !!v.finished;
      rt.splits = (v.splits ?? []).slice(0, rt.checkpoint).map(Number);
      if (race.summit) {
        race.summit.trucks[i].score = Number(v.lapTimes?.[0]) || 0;
      } else {
        rt.lapTimes = (v.lapTimes ?? []).slice(0, rt.laps).map(Number);
        rt.raceTime = rt.lapTimes.reduce((a, x) => a + x, 0);
        rt.fastestLap = Number(v.fastestLap) || (rt.lapTimes.length ? Math.min(...rt.lapTimes) : 0);
      }
      t.previous = snapshot(st);
    });
    // Restored after GO: the countdown's gears are not set again.
    if (S.raceStarted(race)) started = true;
    return true;
  }

  /** A debug command from the page; returns the new state of what it changed. */
  function command(name, value) {
    if (name === "savedRace") return savedRace();
    // A Parallel race's penalty total for a truck another machine owns (packet 0x2b): set, never added.
    if (name === "penalty") { penalties?.set(value.truck, value.totalMs); return penalties ? penalties.totals[value.truck] : null; }
    if (name === "restoreRace") return restoreRace(value);
    const net = netCommand(name, value);
    if (net !== undefined) return net;
    if (name === "weather") {
      // The grip changes at once (A section 2.3); snow's frozen water stays as it was set up.
      ground.weather = value;
      weather = value;
      return value;
    }
    if (name === "laps") {
      // The console's `laps`: the race's length from now on, for every truck still racing.
      if (!race || race.summit) return null;
      race.laps = Math.max(1, Math.trunc(Number(value)) || 1);
      for (const t of race.trucks) if (!t.finished) t.finishLap = race.laps;
      return race.laps;
    }
    if (name === "reverse") return (apCtx.reversed = !apCtx.reversed);
    // A player who left the race (Leave and watch) cannot take the wheel back.
    // With a value (0 to 2) that level is set; without one the levels go round (Ctrl+T).
    if (name === "autopilot") return player.left ? player.apLevel : setAutopilotLevel([0, 1, 2].includes(value) ? value : (player.apLevel + 1) % 3);
    // With a value slew mode is switched on or off; without one it changes over (Ctrl+Y).
    if (name === "slew") return (gold.slew = typeof value === "boolean" ? value : !gold.slew);
    // Z mode's X: the computer trucks stop driving, and drive again on the next press; a single-player race of two or more.
    if (name === "cpuStop") return trucks.length > 1 && !trucks.some((t) => t.remote) ? (gold.cpuStopped = !gold.cpuStopped) : null;
    throw new Error(`Unknown command "${name}"`);
  }

  /** Whether a computer truck's drag is done: its finish, or (disqualified) its would-be finish; the time is kept. */
  function cpuDragDone(t, i) {
    if (t.dragDoneAt !== undefined) return true;
    const lane = drag.lanes[t.lane];
    const done = lane && (lane.et !== null || (lane.dq && pastFinish(drag, t.lane, frontOf(t))) || (race.trucks[i].finished && !lane.dq));
    if (done) t.dragDoneAt = time;
    return !!done;
  }
  /** A truck's front hub, in the world (the hub furthest forward). */
  const hubOf = (t) => {
    const hubs = t.params.hubs ?? [[0, 0, t.frontZ ?? 0]];
    const front = hubs.reduce((a, b) => (b[2] > a[2] ? b : a), hubs[0]);
    return worldPoint(t, front);
  };
  /** A truck's front tyre, its leading point, in the world. */
  const frontOf = (t) => {
    const m = t.state.matrix, z = t.frontZ ?? 0;
    return [t.state.pos[0] + m[2] * z, t.state.pos[1] + m[5] * z, t.state.pos[2] + m[8] * z];
  };
  /**
   * Staging, before the green (6.4): the truck is driven to the prestage beam, then the stage beam, slowing to a stop
   * as its front tyre arrives, and held on the brakes there.
   */
  function stage(t) {
    const c = t.state.controls;
    const distance = stagingDistance(drag, t.lane, frontOf(t), t.stageDepth);
    const target = distance === null ? 0 : stageSpeed(distance);
    const v = t.state.bvel[2];
    c.gear = S.GEAR.FIRST;
    if (target <= 0) {
      c.throttle = 0;
      c.brakeFront = c.brakeRear = 1;
      return;
    }
    c.throttle = Math.max(0, Math.min(0.35, (target - v) * 0.5));
    c.brakeFront = c.brakeRear = Math.max(0, Math.min(1, (v - target) * 0.5));
    const err = Math.atan2(Math.sin(drag.stage.heading - t.state.euler[2]), Math.cos(drag.stage.heading - t.state.euler[2]));
    c.steer = Math.max(-0.45, Math.min(0.45, err * 1.5));
    c.rearSteer = S.rearSteer(c.steer, true);
  }
  /** Whether a truck is staged for its driver: a computer truck, or the player's with Auto Stage until it has staged. */
  const stagedForIt = (t) => t.autopilot || (t.autoStage && drag.lanes[t.lane].state < 2);
  /** The drag pass's tick: staging, the tree, the beams, the lanes and the times; at the green the clock starts. */
  function dragStep() {
    const lanes = drag.lanes.map((_, lane) => trucks.find((t) => t.lane === lane) ?? null);
    const event = dragTick(drag, lanes.map((t) => t && {
      front: frontOf(t), centre: t.state.pos, reversing: t.state.bvel[2] < -REVERSE_SPEED && (t.state.contactCount ?? 0) > 0,
      // The front wheel's hub height, for a new-style drag's height band.
      hubY: hubOf(t)[1],
    }), STEP);
    if (event === "go") {
      race.startTime = race.clock;
      // The computer drivers' reactions to the green, by difficulty (an addition: the game's launch on the green itself).
      const base = [0.55, 0.38, 0.24][difficulty] ?? 0.38;
      // Under the 1996 rules they launch on the green itself.
      for (const t of trucks) t.reaction = t.launch ?? (drag.rules === "mtm1" ? 0 : base + Math.random() * 0.15);
    }
    lanes.forEach((t, lane) => {
      const rt = t ? race.trucks[trucks.indexOf(t)] : null, l = drag.lanes[lane];
      if (!rt || rt.finished) return;
      if (l.et !== null) {
        // A looped drag: its best lap is the fast lap and the total its run time.
        const laps = l.lapTimes?.length ? l.lapTimes : [l.et];
        Object.assign(rt, { raceTime: l.et, lapTimes: laps, fastestLap: l.best ?? l.et, laps: laps.length, finished: true });
      } else if (l.dq || l.rerun) {
        rt.finished = true;
        rt.dq = l.dq;
      }
    });
    if (dragOver(drag)) race.over = true;
  }

  /**
   * A computer truck that makes no headway calls the helicopter (an addition: the game's own check is
   * the speed, which a truck rocking against a tree passes). It must leave a NO_HEADWAY_FT circle
   * around where it was within `patience` seconds (NO_HEADWAY_S unless a mode gives its trucks longer).
   */
  function watchHeadway(t, patience = NO_HEADWAY_S) {
    const s = t.state;
    const w = t.headway ?? (t.headway = { pos: [s.pos[0], s.pos[2]], time: 0 });
    if (s.heliTimer > 0 || Math.hypot(s.pos[0] - w.pos[0], s.pos[2] - w.pos[1]) > NO_HEADWAY_FT) {
      w.pos = [s.pos[0], s.pos[2]];
      w.time = 0;
      return;
    }
    w.time += STEP;
    if (w.time < patience) return;
    w.time = 0;
    liftStuck(t);
  }

  /**
   * A player's truck lying on its hull on a mesh (the port's own rule, for tracks built of meshes): the game sets a
   * truck back on its wheels as soon as it lies at rest, and counts five seconds only for one that does not (10.3).
   * On the terrain a rolled truck is stopped by the bumps within a second or two; on a flat deck of triangles it
   * slides twice as far and then rocks a foot or two a second without ever coming to rest, so a roll there waited
   * much longer (measured on Beaver City: 4.8 s on average against 3.2 s on Farm Road 29, the worst 8 s). Here a
   * truck the game's own count is running for (the timer under zero) with no wheel down, slower than LYING_FT_S for
   * LYING_S, is at rest.
   */
  const LYING_FT_S = 10, LYING_S = 0.5;
  function resetLying(t) {
    const s = t.state;
    const lying = t.recovery.player && s.heliTimer < 0 && s.tires.every((tire) => !tire.onGround);
    if (!lying || Math.hypot(s.bvel[0], s.bvel[1], s.bvel[2]) >= LYING_FT_S) { t.lying = 0; return; }
    t.lying = (t.lying ?? 0) + STEP;
    if (t.lying >= LYING_S && S.resetTruck(s, t.recovery, 1)) t.lying = 0;
  }

  /** The helicopter for a stuck computer truck, at once. */
  function liftStuck(t) {
    const s = t.state;
    t.route = null;
    s.heliTimer = S.STUCK_LIMIT_S - 1;
    S.liftOff(s, t.params, ground, recoveryOf(t), s.contactCount ?? 0);
  }

  /**
   * A computer truck that just missed a checkpoint (MTM2_PHYSICS.md 14.24): one that drives back through it itself
   * (game/racer-recovery.js) is left to; any other is lifted as the race rules do, toward the segment it was on when
   * it missed. (The port never sets it on the gate as the game does on Professional.)
   */
  function missedCheckpoint(t, segment) {
    // Kept for the helicopter, should the way back come to that.
    t.missedSegment = segment;
    if (t.racerRecovery?.returns) return;
    const s = t.state;
    s.heliTimer = -6;
    S.liftOff(s, t.params, ground, recoveryOf(t, segment), s.contactCount);
  }

  /** The helicopter for truck `t`, to course segment `segment`, the way the race rules lift a truck that missed a checkpoint. */
  function liftToSegment(t, segment) {
    const s = t.state;
    if (s.heliTimer > 0 || t.flight) return false;
    t.route = null;
    s.heliTimer = -6;
    S.liftOff(s, t.params, ground, recoveryOf(t, segment), s.contactCount ?? 0);
    s.ap.segment = segment;
    return true;
  }

  /** Where the course goes from a truck's segment: the end of a straight, the exit of an arc. */
  function segmentAim(seg) {
    if (!seg) return null;
    if (!S.isArc(seg)) return seg.end;
    return [seg.centre[0] + Math.sin(seg.exitAngle) * seg.radius, seg.centre[1], seg.centre[2] + Math.cos(seg.exitAngle) * seg.radius];
  }

  /** Where a computer truck is going: its segment's end, on the course it is taking to its own (`route`) or its own. */
  const aimOf = (t) => (t.route ? segmentAim(t.route.ctx.course[t.route.segment]) : segmentAim(recoveryOf(t).segment));

  /**
   * The autopilot on the course a truck is taking to its own (game/course-route.js): the game's, on that course's
   * segment; the truck's own segment, which the race rules keep, is left as it was.
   */
  function driveRoute(t) {
    const s = t.state, r = t.route, keep = s.ap.segment, passed = s.ap.segmentsPassed;
    s.ap.segment = r.segment;
    S.advanceAutopilotSegment(s, r.ctx);
    S.applyAutopilot(s, t.params, r.ctx);
    r.segment = s.ap.segment;
    s.ap.segment = keep;
    s.ap.segmentsPassed = passed;
  }

  /**
   * A computer racer cut off from its course (game/course-route.js): on another course, until it is on its own; off its
   * own with an unmovable obstacle in its way, another course in reach, or the helicopter once it is at the obstacle
   * and stopped. Returns whether it is on another course.
   */
  function routeStep(t) {
    const s = t.state;
    if (t.route) {
      const at = joinedSegment(course, s.pos);
      if (at < 0) return true;
      t.route = null;
      s.ap.segment = at;
      recoveryOf(t);
      return false;
    }
    if (!offCourse(course[s.ap.segment], s.pos)) return false;
    // A look four times a second.
    t.probeIn = (t.probeIn ?? 0) - STEP;
    if (t.probeIn > 0) return false;
    t.probeIn = 0.25;
    const m = s.matrix, b = s.bvel;
    const vx = m[0] * b[0] + m[1] * b[1] + m[2] * b[2], vz = m[6] * b[0] + m[7] * b[1] + m[8] * b[2];
    const speed = Math.hypot(vx, vz);
    const heading = speed > 5 ? Math.atan2(vx, vz) : s.euler[2];
    // On meshes, the height ahead is the drivable surface near the truck's level, not the terrain under the city.
    const height = triMeshes
      ? (x, z) => triMeshes.surfaceBelow(x, s.pos[1] + 4, z, 60) ?? ground.height(x, z)
      : (x, z) => ground.height(x, z);
    const at = obstacleAhead(s.pos, heading, { height, circles: obstaclesFor(t, { still: true }) });
    if (at === null) return false;
    const pick = pickRoute(routes, s.pos);
    if (pick) {
      t.route = { ctx: { ...apCtx, course: routes[pick.route], traffic: undefined, aiSpeed: t.aiSpeed }, segment: pick.segment };
      t.headway = null;
      return true;
    }
    if (at <= CLOSE_FT && speed < STOPPED_FT_S) liftStuck(t);
    return false;
  }

  /**
   * A computer racer's own recovery after the course autopilot (game/racer-recovery.js). While it handles the truck
   * the course's stuck timer is off and it alone calls the helicopter, as its last resort.
   */
  function recoverRacer(t, i) {
    const r = t.racerRecovery, s = t.state, rt = race.trucks[i];
    if (s.heliTimer > 0) return;
    if (fellOffCourse(t)) return;
    const cp = rt.state === 3 && !rt.finished ? race.checkpoints[rt.checkpoint] : null;
    if (!cp) routeStep(t);
    if (s.heliTimer > 0) return;
    const verdict = racerRecoveryStep(r, {
      state: s, dt: STEP, gears: S.GEAR,
      missed: cp ? { pos: cp.gate.pos, psi: cp.psi, half: cp.gate.half } : null,
      aim: aimOf(t),
      trucks: r.unsticks ? trucks.filter((o) => o !== t && o.state.heliTimer <= 0).map((o) => o.state.pos) : null,
      threats: extensionSession?.threats?.(i) ?? null,
    });
    const own = r.unsticks || racerRecovering(r);
    t.recovery.autopilot = !own;
    if (own && s.heliTimer < 0) s.heliTimer = 0;
    if (verdict === "course") keepControl(t);
    // The helicopter on the way back to a missed gate sets the truck down on the segment it missed it from.
    if (verdict === "heli") { t.headway = null; if (cp && Number.isInteger(t.missedSegment)) liftToSegment(t, t.missedSegment); else liftStuck(t); }
    else if (own) t.headway = null;
    else watchHeadway(t);
  }

  /**
   * A computer racer that has dropped off the meshes it races on (a deck's edge, a bridge into the river): more than
   * FALL_FT under the course line beside it for FALL_S, it is lifted back to its segment, as there is seldom a way
   * back up from a river bed or the street under a freeway. The fall teaches the segment's pace as a spin does
   * (game/cpu-pace.js). Meshes only; not the game's. Returns whether the helicopter took it.
   */
  function fellOffCourse(t) {
    if (!triMeshes || t.route) return false;
    const s = t.state;
    const driven = S.orientedCourse(apOf(t).course, apCtx.reversed);
    if (!driven.length) return false;
    let best = null;
    for (const k of courseWindow(driven.length, s.ap.segment, 2, 3)) {
      const seg = driven[k];
      if (S.isArc(seg)) continue;
      const dx = seg.end[0] - seg.start[0], dz = seg.end[2] - seg.start[2], l2 = dx * dx + dz * dz;
      if (!(l2 > 1e-9)) continue;
      const u = Math.min(1, Math.max(0, ((s.pos[0] - seg.start[0]) * dx + (s.pos[2] - seg.start[2]) * dz) / l2));
      const d = Math.hypot(seg.start[0] + dx * u - s.pos[0], seg.start[2] + dz * u - s.pos[2]);
      if (!best || d < best.d) best = { d, y: seg.start[1] + (seg.end[1] - seg.start[1]) * u };
    }
    if (!best || !(s.pos[1] < best.y - FALL_FT)) { t.fallenFor = 0; return false; }
    if (!t.fallenFor && t.cpuPace) cpuPaceObserve(t.cpuPace, { segment: s.ap.segment, spin: true });
    t.fallenFor = (t.fallenFor ?? 0) + STEP;
    if (t.fallenFor < FALL_S) return false;
    t.fallenFor = 0;
    t.headway = null;
    return liftToSegment(t, s.ap.segment);
  }

  /** A computer truck keeping control after the autopilot (game/cpu-control.js), and steering clear of what is ahead. */
  /** One step of an EVO computer driver (game/evo-driver.js): its controls, or its warp back to the line. */
  function evoDrive(t, i) {
    const s = t.state, d = t.evoDriver;
    const pointOf = (pos) => {
      let best = 0, bd = Infinity;
      d.line.points.forEach((p, k) => { const dd = (p[0] - pos[0]) ** 2 + (p[2] - pos[2]) ** 2; if (dd < bd) { bd = dd; best = k; } });
      return best;
    };
    // The humans' places on the line are looked up twice a second, not every step.
    if (!t.evoSeen || d.clock - t.evoSeen.at >= 0.5) {
      t.evoSeen = {
        at: d.clock,
        humans: trucks.filter((o) => !o.autopilot || o.remote).map((o) => ({ pos: o.state.pos, index: pointOf(o.state.pos) })),
        others: trucks.filter((o) => o !== t && o.evoDriver).map((o) => ({ index: o.evoDriver.index })),
      };
    }
    const out = evoDriveStep(d, {
      pos: s.pos, heading: s.euler[2], speed: s.bvel[2], allDown: s.tires.every((w) => w.onGround),
    }, {
      weather: weather === S.WEATHER.RAIN ? "rain" : weather === S.WEATHER.SNOW ? "snow" : null,
      humans: t.evoSeen.humans, others: t.evoSeen.others, lengthFt: 2 * t.radius,
      rearSteerFactor: t.params.evo && !t.params.evo.spec.rearSteer ? 0 : 0.33,
    }, STEP);
    const c = s.controls;
    if (out.warp) {
      s.pos[0] = out.warp.pos[0]; s.pos[1] = Math.max(out.warp.pos[1], ground.height(out.warp.pos[0], out.warp.pos[2]) + 10); s.pos[2] = out.warp.pos[2];
      s.euler[0] = 0; s.euler[1] = 0; s.euler[2] = out.warp.heading;
      S.eulerToMatrix(s.euler[0], s.euler[1], s.euler[2], s.matrix);
      s.rates.fill(0); s.bvel.fill(0); s.bvel[2] = out.warp.speed;
      c.gear = S.GEAR.FIRST;
      return;
    }
    c.steer = out.steer;
    c.rearSteer = out.rearSteer;
    if (out.reverse) c.gear = S.GEAR.REVERSE;
    else if (c.gear === S.GEAR.REVERSE || c.gear === S.GEAR.PARK || c.gear === S.GEAR.NEUTRAL) c.gear = S.GEAR.FIRST;
    c.throttle = out.throttle;
    c.brakeFront = c.brakeRear = out.brake;
    if (s.evo) s.evo.handbrake = out.handbrake;
    void i;
  }
  function keepControl(t) {
    if (!t.cpuControl || t.state.heliTimer > 0) return;
    const aim = aimOf(t);
    const seg = t.route ? t.route.ctx.course[t.route.segment] : recoveryOf(t).segment;
    cpuControlStep(t.cpuControl, t.state, STEP, aim, S.GEAR, undefined, segmentCurvature(seg));
    cpuAvoidStep(t.cpuControl, t.state, obstaclesFor(t), aim);
  }

  /**
   * A computer racer learning its course (game/cpu-pace.js), before the autopilot sets its target: a slide, a spin
   * or a missed checkpoint on a segment lowers the pace it drives that segment at; the pace reaches the autopilot
   * through `apOf`. Not on another course (`route`), whose segments are not its own.
   */
  function learnPace(t, i) {
    const m = t.cpuPace, s = t.state;
    if (!m || t.route) { t.pace = 1; return; }
    if (s.heliTimer > 0) return;
    const segment = s.ap.segment;
    const sliding = isSliding(s);
    // A spin counts with the wheels down: a truck thrown round in the air (Torture Pit's jumps) is not driving too fast.
    const down = s.tires.filter((w) => w.onGround).length;
    const spun = down >= 3 && isSpun(s, segmentHeading(S.orientedCourse(course, apCtx.reversed)[segment], s.pos));
    // Only what happens while the truck drives the course teaches it: a truck backing out of a jam or turning round
    // (racer-recovery.js, cpu-control.js) slides and faces every way on purpose.
    const driving = !racerRecovering(t.racerRecovery) && !t.cpuControl?.turn;
    if (driving) {
      cpuPaceObserve(m, {
        segment, slide: sliding && !t.wasSliding, spin: spun && !t.wasSpun,
        missed: !!race && race.trucks[i].state === 3 && !race.trucks[i].finished,
      });
    }
    t.wasSliding = sliding;
    t.wasSpun = spun;
    t.pace = cpuPaceFactor(m, segment, course);
  }

  /*
    The level boxes `obstaclesFor` looks at, without going through every one for every computer truck: the inert ones
    (they never move) stand in a grid of LIST_CELL_FT cells on the world's wrap, each in the cells its radius covers, and
    a truck asks the cells within `reach` of it; the others are always asked. A box within reach + its radius on x and
    z shares a cell with the truck's square, so no box the test below passes is left out, and the candidates come in
    the level's order, so the obstacles do too. A city has thousands of boxes; a truck has a few dozen in reach. Where
    the list is made by going through every box (`chainFast` false: a small level, a mode's own session, which may
    move level boxes, or a world not a whole number of cells), every box is asked.
  */
  let obstacleGrid = null, obstacleQuery = 0;
  const obstacleOrder = new Map(levelBoxes.map((box, i) => [box, i]));
  function obstacleCandidates(x, z, reach) {
    if (!chainFast) return levelBoxes;
    if (!obstacleGrid) {
      obstacleGrid = { cells: new Map(), others: [], stamp: new Map() };
      for (const box of levelBoxes) {
        if (box.ghost || meshBoxes.has(box)) continue;
        if (!box.inert) { obstacleGrid.others.push(box); continue; }
        eachListCell(box.pos[0], box.pos[2], box.radius, (cell) => {
          const there = obstacleGrid.cells.get(cell);
          if (there) there.push(box); else obstacleGrid.cells.set(cell, [box]);
          return false;
        });
      }
    }
    const { cells, others, stamp } = obstacleGrid, query = ++obstacleQuery, found = [...others];
    eachListCell(x, z, reach, (cell) => {
      for (const box of cells.get(cell) ?? []) if (stamp.get(box) !== query) { stamp.set(box, query); found.push(box); }
      return false;
    });
    return found.sort((a, b) => obstacleOrder.get(a) - obstacleOrder.get(b));
  }

  /**
   * What a computer racer could drive into ahead (game/obstacle-avoid.js): the level's objects it cannot shove, the
   * static walls, and the ground boxes that stand up as walls where the course does not run over them.
   */
  function obstaclesFor(t, { still = false } = {}) {
    const s = t.state, out = still ? [] : t.obstacles ?? (t.obstacles = []);
    out.length = 0;
    const reach = AVOID.maxLookFt + 40;
    for (const box of obstacleCandidates(s.pos[0], s.pos[2], reach)) {
      if (box.ghost || !S.boxIsImmovableFor(box, t.params.massSlug)) continue;
      // A mesh is driven on: its walls and drops are looked for below, not its box.
      if (meshBoxes.has(box)) continue;
      // `still`: only what never moves (a moving object, as Castle Nugget's sliding gate, passes).
      if (still && movingBoxes.has(box)) continue;
      const dx = wrapDelta(box.pos[0] - s.pos[0]), dz = wrapDelta(box.pos[2] - s.pos[2]);
      if (Math.abs(dx) > reach + box.radius || Math.abs(dz) > reach + box.radius) continue;
      boxObstacles(box, out, [s.pos[0] + dx - box.pos[0], s.pos[2] + dz - box.pos[2]]);
    }
    const walls = [];
    wallsAround(s.pos[0], s.pos[2], reach, walls);
    for (const w of walls) {
      if (w.tree || (cp4Model && w.cp4Tree)) continue;
      boxObstacles(w, out, [s.pos[0] + wrapDelta(w.pos[0] - s.pos[0]) - w.pos[0], s.pos[2] + wrapDelta(w.pos[2] - s.pos[2]) - w.pos[2]]);
    }
    if (ra0 && ra1 && course.length) {
      const m = s.matrix, b = s.bvel;
      const vx = m[0] * b[0] + m[1] * b[1] + m[2] * b[2], vz = m[6] * b[0] + m[7] * b[1] + m[8] * b[2];
      const speed = Math.hypot(vx, vz);
      const heading = speed > 5 ? Math.atan2(vx, vz) : s.euler[2];
      const look = Math.max(AVOID.minLookFt, Math.min(AVOID.maxLookFt, speed * AVOID.lookS));
      const driven = S.orientedCourse(apOf(t).course, apCtx.reversed);
      const segments = courseWindow(driven.length, s.ap.segment, 2, 6).map((i) => driven[i]);
      // On the course's own way: within its width (an arc's as the straights') and some room of a segment's line.
      const onCourse = (x, z) => segments.some((seg) => {
        const spot = spotOnSegment(seg, [x, 0, z]);
        return spot && spot.distance < (seg.trackWidth ?? 16) / 2 + COURSE_ROOM_FT;
      });
      out.push(...groundBoxWalls(s.pos, heading, look, { ra0, ra1, stepFt: groundBoxStepFt, baseFt: groundBoxBaseFt, cells: worldCells, onCourse }));
    }
    if (triMeshes && !still) {
      const m = s.matrix, b = s.bvel;
      const vx = m[0] * b[0] + m[1] * b[1] + m[2] * b[2], vz = m[6] * b[0] + m[7] * b[1] + m[8] * b[2];
      const speed = Math.hypot(vx, vz);
      const heading = speed > 5 ? Math.atan2(vx, vz) : s.euler[2];
      const look = Math.max(AVOID.minLookFt, Math.min(AVOID.maxLookFt, speed * AVOID.lookS));
      meshObstacles(triMeshes, s.pos, s.pos[1] - AVOID.rideFt, heading, look, AVOID.halfWidthFt + AVOID.marginFt, out);
    }
    return out;
  }

  /**
   * Whether a step keeps the trucks' states from before it (`previous`, what a reply interpolates from). Only the last
   * step of a catch-up's is sent, so `advance` and `finishRace` ask for that one alone; a step made any other way keeps it.
   */
  let keepPrevious = true;
  /** An extension's action waiting for the next step (`step`). */
  let pendingAction = null;
  /** One-shot presses (`ONE_SHOT_INPUTS`) no step has taken yet (`advance`). */
  let carriedPresses = {};
  /** The listed boxes' poses before a step (`poseInto`), kept from step to step. */
  let before = new Float64Array(0);

  /** Step one fixed step with the held keys (the player's truck). */
  function step(input) {
    const { joystick = null, helicopter = false, slew = null, modeAction = null, ...held } = input ?? {};
    // An extension's own key (Combat's repair, on the Crash Damage key) and its menu's choices (leaving to watch): kept
    // until a step takes it, as a tick may run none (the first after a pause).
    if (modeAction) pendingAction = modeAction;
    if (input) input.modeAction = null;
    // Leave and watch (ui/screens/race.js): the player's truck races on under the full autopilot, for good.
    if (pendingAction === "leave") {
      setAutopilotLevel(2);
      player.left = true;
      pendingAction = null;
    }
    // The pit crew (Loose Wheels) is the mutator's, whatever the mode.
    if (pendingAction === "pit" && mutator && (!race || S.raceStarted(race))) {
      mutator.action("pit", 0);
      pendingAction = null;
    }
    if (pendingAction && extensionSession?.action && (!race || S.raceStarted(race))) {
      extensionSession.action(pendingAction, 0);
      pendingAction = null;
    }
    if (gold.slew) {
      if (slew) slewMove(slew);
      if (keepPrevious) for (const t of trucks) t.previous = snapshot(t.state);
      time += STEP;
      return;
    }
    Object.assign(keys, held);
    // One-shot presses are taken by this step only: a tick that runs two steps must not shift twice.
    if (input) input.shiftUp = input.shiftDown = input.driveMode = false;
    if (helicopter) {
      callHelicopter(player);
      input.helicopter = false;
    }
    // The race tick comes first in the game's frame (0x487300): checkpoints, segments, the order.
    if (race) {
      const lapsBefore = race.trucks.map((rt) => rt.laps);
      // The missed-checkpoint helicopter is decided here (`missedCheckpoint`), not in the race rules, so a racer can
      // drive back through the gate; the segment each truck was on is the one the rules would lift it toward.
      const missedBefore = race.trucks.map((rt) => rt.state === 3);
      const segmentBefore = trucks.map((t) => t.state.ap.segment);
      // Each truck's recovery context follows its segment, as the rules' own call kept it.
      if (S.raceStarted(race) && !race.summit) for (const t of trucks) recoveryOf(t);
      S.raceTick(race, STEP, raceAp);
      race.trucks.forEach((rt, i) => {
        if (!rt.player && !missedBefore[i] && rt.state === 3) missedCheckpoint(trucks[i], segmentBefore[i]);
      });
      // The game's `bonusLaps` (0x485afc): a lap closed in first place is a lap led, for the points.
      race.trucks.forEach((rt, i) => { if (rt.laps > lapsBefore[i] && rt.place === 1) lapsLed[i]++; });
      if (drag) dragStep();
      if (cpxRules) { cpxWallStep(); parallelStep(); leadInStep(); }
      if (extensionSession && S.raceStarted(race)) extensionSession.tick();
      recordCrossings(crossings, race.trucks);
    }
    const go = !race || S.raceStarted(race);
    if (tide && go && ++tideCalls >= tideSubsteps) {
      tideCalls = 0;
      S.tideTick(tide);
      terrainGround.waterLevelFt = S.tideLevelFt(tide);
    }
    if (mutator && go) mutator.tick();
    // The at-rest reset and lift-off run only in the race state, not through the countdown (10.3).
    // A remote truck's resets and helicopter are its owner's; they arrive as position snaps.
    for (const t of trucks) t.recovery.racing = go && !t.remote;
    for (const [i, t] of trucks.entries()) {
      if (t.remote) {
        // Its controls are the last ones it sent (applyRemote); a smoothed truck eases out its error; a CP4 room's is
        // pinned to its buffer.
        if (cp4Net) pinRemote(t, i);
        else easeRemote(t);
        continue;
      }
      if (t.autopilot && gold.cpuStopped && i > 0) {
        // Its autopilot off (Z mode's X): no one drives it, so it rolls to a stop where it is.
        const c = t.state.controls;
        c.throttle = 0; c.steer = 0; c.rearSteer = 0; c.brakeFront = c.brakeRear = 0;
      } else if (t.autopilot) {
        if (!race || drag) S.advanceAutopilotSegment(t.state, apOf(t));
        recoveryOf(t);
        // An extension mode drives its trucks; one that answers false leaves the truck to the course's autopilot (Race & Rumble's racers).
        if (go && extensionSession && extensionSession.drive(t, i) !== false) { /* driven by the mode */ }
        else if (go && t.rumble) {
          const rivals = trucks.filter((o) => o !== t && o.state.heliTimer <= 0).map((o) => o.state.pos);
          rumbleControls(t.state, t.rumble, race.summit.zone, rivals, S.GEAR, STEP, rumbleField);
        } else if (go && drag && cp4Model && t !== player && cpuDragDone(t, i)) {
          // CP4 2.0.52.4: after its finish (a disqualified truck's would-be finish) it coasts 1.5 s, then brakes and holds.
          const c = t.state.controls;
          c.throttle = 0;
          c.brakeFront = c.brakeRear = time - t.dragDoneAt >= CPU_FINISH_COAST_S ? 1 : 0;
        } else if (go && drag && ((drag.lanes[t.lane].dq && !cp4Model) || race.clock - race.startTime < (t.reaction ?? 0))) {
          // A computer driver's reaction to the green; a disqualified truck stays where it is (under CP4 it runs on).
          t.state.controls.throttle = 0;
          t.state.controls.brakeFront = t.state.controls.brakeRear = 1;
        } else if (go && t.cprDriver) {
          cprDrive(t);
          watchHeadway(t);
        } else if (go && t.evoDriver) {
          evoDrive(t, i);
        } else if (go && t.racerRecovery) {
          racerRecoveryBefore(t.racerRecovery, t.state.controls);
          if (t.cpuControl) cpuControlBefore(t.cpuControl, t.state.controls);
          learnPace(t, i);
          if (t.route) driveRoute(t);
          else S.applyAutopilot(t.state, t.params, apOf(t));
          recoverRacer(t, i);
        } else if (go) {
          if (t.cpuControl) cpuControlBefore(t.cpuControl, t.state.controls);
          S.applyAutopilot(t.state, t.params, apOf(t));
          keepControl(t);
          // A drag pass: flat out to the finish beam (game/drag-race.js `dragPedals`); the autopilot steers and stops it after.
          if (drag && (!race.trucks[i].finished || (cp4Model && drag.lanes[t.lane].dq)) && t.state.bvel[2] > 1) dragPedals(t.state.controls, -t.state.euler[0], Math.atan2(t.state.bvel[0], t.state.bvel[2]));
          // The no-headway helicopter is the OMTM2 drivers' (the games' own check is the speed, in the recovery step).
          if (aiBehaviour === "omtm2" || drag) watchHeadway(t);
        } else t.state.controls.throttle = 0;
      } else if (i === 0) {
        const controlCtx = {
          dt: STEP, autoShift: t.params.autoShift, forwardSpeed: t.state.bvel[2], dragMode: !!drag, segments: drag ? 4 : 0, difficulty, steeringResponse, ...steerCurve,
        };
        // The keyboard routine always runs; a joystick then overwrites it (MONSTER_EXE_ANALYSIS.md §7).
        S.applyKeyboard(t.state.controls, keys, controlCtx);
        if (joystick) S.applyJoystick(t.state.controls, joystick, controlCtx);
        // An Evolution truck's handbrake: under its own physics the game's (rear brakes locked, rear grip a tenth);
        // under MTM physics the rear brakes locked.
        if (t.evoVehicle) {
          const handbrake = !!keys.handbrake || !!joystick?.handbrake;
          if (t.state.evo) t.state.evo.handbrake = handbrake;
          else if (handbrake) t.state.controls.brakeRear = 1;
        }
        // The Drive Mode key (0x489a90): the transfer case 2WD, 4WD High, 4WD Low and round, under Evo physics; a vehicle
        // without four-wheel drive (drive_type 0) stays in 2WD. MTM2's model drives all four wheels and has no transfer case.
        if (keys.driveMode && t.state.evo) {
          t.state.evo.transfer = t.params.evo.spec.driveType === 0 ? 0 : (t.state.evo.transfer + 1) % 3;
        }
        if (t.cprDriver && go) {
          // The CPR aids (CPR_PHYSICS.md 14.3): the autopilot's pedals and a window on the wheel; speed control
          // (Ctrl+T once) works both pedals, as Auto-Throttle.
          const ap = cprDrive(t, true);
          applyCprAids(t.state.controls, ap, t.apLevel === 1 ? { ...cprPlayerAids, control: 2 } : cprPlayerAids);
          const turned = cprPlayerAids.spinCorrection ? spinCorrection(t.state, ap) : null;
          if (turned !== null) turnKeepingVelocity(t.state, turned);
        } else if (t.apLevel === 1 && course.length && go) {
          // Speed control only: the autopilot drives the pedals, the player the wheel.
          const { steer, rearSteer } = t.state.controls;
          recoveryOf(t);
          S.applyAutopilot(t.state, t.params, apCtx);
          Object.assign(t.state.controls, { steer, rearSteer });
        }
      }
    }
    // The countdown (MONSTER_EXE_ANALYSIS.md 6.1): every truck sits in Park, so revving moves
    // nobody; at the start every truck goes into first.
    if (drag && !go) {
      // The player stages their own truck, in whatever gear they like, unless Auto Stage does it for them.
      if (keys.autoStage) player.autoStage = true;
      for (const t of trucks) {
        // A false start: the driver goes while the tree still runs, and the start beam gives the red light.
        if (t.autopilot && t.launch < 0 && drag.phase === "tree" && TREE_S - drag.tree <= -t.launch && !drag.lanes[t.lane].dq) S.applyAutopilot(t.state, t.params, apOf(t));
        else if (stagedForIt(t)) stage(t);
      }
    } else if (race && !go) {
      for (const t of trucks) {
        t.state.controls.gear = S.GEAR.PARK;
        t.state.controls.brakeFront = t.state.controls.brakeRear = 1;
      }
    } else if (race && !started) {
      started = true;
      for (const t of trucks) t.state.controls.gear = S.GEAR.FIRST;
    }
    // An extension may hold trucks after the countdown, then release them into first gear.
    if (extensionSession && go) {
      trucks.forEach((t, i) => {
        const held = extensionSession.held(i);
        const c = t.state.controls;
        if (held) {
          c.gear = S.GEAR.PARK;
          c.throttle = 0;
          c.brakeFront = c.brakeRear = 1;
        } else if (t.held) c.gear = S.GEAR.FIRST;
        t.held = held;
      });
    }
    keys.shiftUp = keys.shiftDown = keys.driveMode = false;
    if (joystick) joystick.shiftUp = joystick.shiftDown = false;
    // A vehicle without rear steering under Evo physics: the step zeroes the rear angle the controls set, so zero it
    // before the pose drawn from is taken too, or the rear wheels swing between the two poses every frame in a turn.
    for (const t of trucks) if (t.params.evo && !t.params.evo.spec.rearSteer) t.state.controls.rearSteer = 0;
    if (keepPrevious) for (const t of trucks) t.previous = snapshot(t.state);
    // 4x4 Evolution 2's object paths and the track's script run from the start, as the game's (0x4f3680).
    stepScript();
    for (const run of pathRuns) {
      if (run.runner.step(STEP)) placePath(run);
      else for (const box of run.members) box.vel.fill(0);
    }
    // Moving objects move before the frame's list is built, once the race runs.
    if (go) {
      for (const { box, bvel } of movingObjects) {
        S.stepMovingObject(box, bvel, terrain, ra0, ra1, STEP, weather === S.WEATHER.SNOW, { stepFt: groundBoxStepFt, baseFt: groundBoxBaseFt });
        dirty.add(box);
      }
    }
    listBoxes();
    // The listed boxes that can move this step; the others' steps and checks below change nothing (`inert`).
    stirring.length = 0;
    if (chainFast) stirring.push(...listedLive, ...extraBoxes);
    else for (const box of listed) if (!box.inert || extensionSession) stirring.push(box);
    if (before.length < stirring.length * 6) before = new Float64Array(stirring.length * 12);
    stirring.forEach((box, i) => poseInto(box, before, i * 6));
    for (const t of trucks) {
      // The player's helicopter holds the truck still and carries it itself (game/heli-flight.js).
      if (t.flight) { flyTruck(t); continue; }
      extensionSession?.afterTruckStep?.(t);
      mutator?.afterTruckStep(t);
      if (t.heliGround) t.ctx.ground = t.state.heliTimer > 0 ? t.heliGround : t.ownGround;
      if (t.cprCar) Cp.stepCprTruck(t.state, t.params, t.ctx, STEP);
      else if (evoModel) E.stepEvoTruck(t.state, t.params, t.ctx, STEP);
      else S.stepTruck(t.state, t.params, t.ctx, STEP);
      if (triMeshes) resetLying(t);
      t.snd.impact = Math.max(t.snd.impact, t.state.impactForce);
      // The bump stops' jolt, for a gamepad's rumble (game/input/rumble.js); only the MTM2 model reports it.
      t.snd.bottoming = Math.max(t.snd.bottoming, t.state.bottoming ?? 0);
      t.snd.splash = t.snd.splash || t.state.splash;
    }
    for (const box of stirring) S.stepBox(box, ground, STEP);
    pairTests();
    // A truck whose state has blown up (a contact it was deep inside of threw it with a force no step can follow) is put
    // back as it last stood, at rest. The game has no such guard; without one a broken number spreads and the race
    // stops answering (a player's report: frozen after being set down under a bridge).
    for (const t of trucks) {
      if (stateIsSane(t.state)) {
        if (++t.sinceSafe >= 30 && Math.hypot(t.state.bvel[0], t.state.bvel[1], t.state.bvel[2]) < 400) { t.safe = copyState(t.state); t.sinceSafe = 0; }
        continue;
      }
      restoreState(t.state, t.safe);
      for (const list of [t.state.bvel, t.state.rates, t.state.extForce, t.state.extMoment]) list.fill(0);
      t.rescued = (t.rescued ?? 0) + 1;
    }
    // The world is a torus: a truck that has left it comes in at the other side, as the game wraps it every frame
    // (MONSTER_EXE_ANALYSIS.md "The wrapping world"). The state it is drawn from goes with it, so the picture between
    // two steps does not cross the world.
    const wrapAfter = () => {
      for (const t of trucks) {
        const [dx, dz] = S.wrapTruck(t.state, worldFt);
        if (!dx && !dz) continue;
        if (t.previous) { t.previous.pos[0] += dx; t.previous.pos[2] += dz; }
        t.wraps = (t.wraps ?? 0) + 1;
      }
    };
    // Each truck's own ground: where a level has surfaces over the terrain (a bridge's deck, a rock), the wheels must
    // meet the same one the hull does, not the terrain under it.
    for (const t of trucks) S.postStepTruck(t.state, t.params, t.ctx.ground, STEP);
    wrapAfter();
    if (rules.crashDamage) for (const t of trucks) noteHull(t);
    stirring.forEach((box, i) => {
      S.postStepBox(box, ground);
      // A box whose numbers broke is put back, before a truck or a mode's driver meets them.
      keepBoxSane(box);
      if (!posedAs(box, before, i * 6)) dirty.add(box);
    });
    updateHeliVisuals();
    time += STEP;
    if (race) handOverFinished();
  }

  /**
   * A truck touched a level object (SIT "@sound effect entries"): its sound, as the game plays it at each contact the
   * collision finds (`0x428bc0`, MONSTER_EXE_ANALYSIS.md "Object sounds"), never for a hit near it. The hardest contact
   * of the reply is kept, with where the object stands from the truck (the short way round the world's seam).
   */
  function noteObjectHit(t, box, touch) {
    if (box.sitIndex === undefined) return;
    if (t.snd.hit && touch.speed <= t.snd.hit.force) return;
    const s = t.state;
    t.snd.hit = { sitIndex: box.sitIndex, force: touch.speed, offset: [wrapDelta(box.pos[0] - s.pos[0]), box.pos[1] - s.pos[1], wrapDelta(box.pos[2] - s.pos[2])] };
  }

  /**
   * The player's Helicopter key: at any time once the race runs, the helicopter takes the truck (frozen in the
   * air) to the nearest point of the part of the course it has reached and sets it down facing along it; pressed
   * again, it lets go where it is.
   * Every third call brings the pterodactyl instead (the game's counter at `0x651798`).
   */
  let heliCalls = 0;
  // On a track built of meshes the course runs over decks and bridges, with the terrain (often water) far under them:
  // the truck is set down on the drivable surface at the course's own height there, and in the air it clears what
  // lies under it, not the terrain alone.
  const courseGround = (x, z, y) => (triMeshes && Number.isFinite(y) ? triMeshes.surfaceBelow(x, y + 6, z, 80) : null) ?? ground.height(x, z);
  const flightGround = (x, z, y) => (triMeshes && Number.isFinite(y) ? triMeshes.surfaceBelow(x, y, z, 400) : null) ?? ground.height(x, z);
  function callHelicopter(t) {
    if (t.recovery.summit || !(!race || S.raceStarted(race)) || gold.slew) return;
    if (t.flight) { releaseTruck(t); return; }
    // A truck on its roof is counting down to the game's own reset (a negative timer): the call still goes through.
    if (t.state.heliTimer > 0) return;
    // An extension may refuse the call (Cops & Robbers: the robber, out of deep water).
    if (extensionSession?.heliAllowed?.(trucks.indexOf(t)) === false) return;
    heliCalls = (heliCalls + 1) % 3;
    const driven = course.length ? S.orientedCourse(course, apCtx.reversed) : [];
    const here = t.state.pos;
    // An extension may name its own spot (Hockey: the rink's centre).
    // In a race the truck's own segment (the race tick follows it lap by lap) keeps the drop to the part of the course it
    // has reached: at a crossroads the nearest point may be on another part of the lap (game/heli-flight.js).
    const racing = !!race && !race.summit && S.raceStarted(race);
    const spot = extensionSession?.heliSpot?.(trucks.indexOf(t))
      ?? (racing && init.checkpointHeli && t === player ? lastCheckpointSpot(t) : null)
      ?? nearestCourseSpot(driven, here, courseGround, { around: racing ? t.state.ap.segment : null })
      ?? { pos: [here[0], courseGround(here[0], here[2], here[1]), here[2]], heading: t.state.euler[2] };
    t.flight = createFlight(t.state, spot, { teryl: heliCalls === 2, height: flightGround });
    t.state.heliTimer = 1;
    t.exit = null;
  }
  /**
   * 4x4 Evolution 2's H key (EVO2_EXE_ANALYSIS.md 11, Advanced: Helicopter to the last checkpoint): 32 ft behind the last
   * checkpoint passed, facing along it. Before the first checkpoint of the race, null (the course's nearest point then).
   */
  function lastCheckpointSpot(t) {
    const rt = race.trucks[trucks.indexOf(t)];
    const n = race.checkpoints.length;
    if (!rt || !n || (rt.checkpoint === 0 && rt.laps === 0)) return null;
    const cp = race.checkpoints[(rt.checkpoint - 1 + n) % n];
    const heading = cp.psi;
    const x = cp.gate.pos[0] - Math.sin(heading) * 32, z = cp.gate.pos[2] - Math.cos(heading) * 32;
    return { pos: [x, courseGround(x, z, cp.gate.pos[1]), z], heading };
  }
  function flyTruck(t) {
    const s = t.state;
    s.bvel.fill(0);
    s.rates.fill(0);
    s.heliTimer = 1;
    for (const tire of s.tires) tire.onGround = false;
    const done = stepFlight(t.flight, s, STEP);
    S.eulerToMatrix(s.euler[0], s.euler[1], s.euler[2], s.matrix);
    s.prevPos.set(s.pos);
    s.heliVisual = flightVisual(t.flight, s);
    if (done) releaseTruck(t);
  }
  function releaseTruck(t) {
    const s = t.state;
    t.exit = { t: 0, pos: [...s.pos], heading: s.euler[2], teryl: t.flight.teryl };
    t.flight = null;
    s.heliTimer = 0;
    s.hover = 0;
    s.bvel.fill(0);
    s.rates.fill(0);
    s.depths.fill(-9999);
    s.heliVisual = departVisual(t.exit);
  }
  /** The helicopter drawn for each truck: the player's own flight or departure, the game's flight for the others. */
  function updateHeliVisuals() {
    for (const t of trucks) {
      const s = t.state;
      if (t.exit) {
        t.exit.t += STEP;
        s.heliVisual = departVisual(t.exit);
        if (!s.heliVisual) t.exit = null;
      } else if (!t.flight) {
        s.heliVisual = timerVisual(s.heliTimer, s.pos, s.euler[2]);
      }
    }
  }

  /** Finished trucks go on autopilot (MTM2_PHYSICS.md 14.24); the player's too. */
  function handOverFinished() {
    race.trucks.forEach((rt, i) => {
      const t = trucks[i];
      if (!rt.finished || t.autopilot || t.remote || !course.length) return;
      t.autopilot = true;
      t.ctx.human = false;
      t.recovery.player = false;
      t.recovery.autopilot = true;
    });
  }

  /** What the race HUD and the results show (MONSTER_EXE_ANALYSIS.md 6, 11). */
  function raceView() {
    if (!race) return null;
    const since = drag && drag.phase !== "go" ? -1 : race.clock - race.startTime;
    const laneOf = (i) => (drag ? drag.lanes[trucks[i].lane] : null);
    // A Parallel race's order: finish time plus penalties (game/cpx-walls.js `parallelOrder`).
    const parallelRows = penalties ? race.trucks.map((rt, i) => ({ i, finished: rt.finished && !rt.dq, time: rt.raceTime, penaltyMs: penalties.totals[i], progress: rt.passed + rt.progress })) : null;
    const places = drag ? dragPlaces(race.trucks.map((rt, i) => ({ ...rt, dq: laneOf(i)?.dq || laneOf(i)?.rerun })))
      : parallelRows ? (() => { const out = []; parallelOrder(parallelRows).forEach((r, k) => { out[r.i] = k + 1; }); return out; })() : null;
    return {
      started: since >= 0,
      countdown: drag && drag.phase !== "go" ? (drag.phase === "tree" ? TREE_S - drag.tree : 3) : Math.max(0, -since),
      /** A drag race's tree: its phase, and each truck's lamps and lane. */
      drag: drag ? {
        phase: drag.phase,
        /** Seconds in this phase (CP3's announcer counts the staging time down). */
        phaseTime: drag.phaseTime,
        lamps: trucks.map((t) => dragLamps(drag, t.lane)),
        lane: trucks.map((t) => t.lane),
      } : null,
      clock: Math.max(0, since),
      /** A Parallel race: each truck's wall penalty total, ms, and the events so far; else null. */
      penalties: penalties ? { totals: [...penalties.totals], events: penaltyEvents.length } : null,
      /** A .CPX race's mode (1 drag, 2 Parallel, 3 splits), or 0. */
      cpxMode,
      /** CP4's tide: the track's water level this tick, feet (the drawn water follows it), or undefined. */
      tideFt: tide ? terrainGround.waterLevelFt : undefined,
      laps: race.laps,
      over: race.over,
      /** The HUD's Lead or Back gap for the player's truck (game/timing.js). */
      // A mode may show another truck's times (a Race & Rumble blocker sees its racer's).
      gap: race.summit || (extensionSession && !extensionSession.keepsRace) ? null : raceGap(race.trucks, crossings, extensionSession?.timingTruck?.(0) ?? 0),
      /** Public state supplied by the active extension, else null. */
      extension: extensionSession?.view(since) ?? null,
      /** Summit Rumble: scores and the seconds left in the round (6.3), else null. */
      summit: race.summit ? { left: Math.max(0, race.roundSeconds - since), states: race.summit.trucks.map((t) => t.state) } : null,
      trucks: race.trucks.map((rt, i) => ({
        place: places ? places[i] : rt.place,
        /** A Parallel race: the truck's wall penalties, ms, and whether they cost it a place it crossed the line in. */
        penaltyMs: penalties ? penalties.totals[i] : 0,
        lostOnPenalties: parallelRows ? lostOnPenalties(parallelRows, parallelRows[i]) : false,
        /** A drag pass: why the truck is out (a name of game/drag-race.js `DQ_CODE`), whether its pass is to be run again, its reaction time. */
        dq: laneOf(i)?.dq ?? null,
        /** Out of lane: over the "centre" line or the outside "edge". */
        dqLine: laneOf(i)?.line ?? null,
        rerun: !!laneOf(i)?.rerun,
        reaction: laneOf(i)?.reaction ?? null,
        score: race.summit ? race.summit.trucks[race.trucks.indexOf(rt)].score : extensionSession?.score(i) ?? 0,
        laps: rt.laps,
        lap: Math.min(rt.laps + 1, race.laps),
        lapTime: rt.finished ? (rt.lapTimes[rt.lapTimes.length - 1] ?? 0) : Math.max(0, since - rt.raceTime),
        best: rt.fastestLap,
        /** The last lap closed, seconds (0 before the first): Time Attack's (game/extensions/time-attack.js). */
        lastLap: rt.lapTimes[rt.lapTimes.length - 1] ?? 0,
        led: lapsLed[i],
        raceTime: rt.raceTime,
        finished: rt.finished,
        missed: rt.state === 3 && !rt.outOfRace,
        checkpoint: rt.outOfRace ? 0 : rt.checkpoint,
        /** Out of the race (a Race & Rumble blocker): no checkpoints, no place while it runs. */
        outOfRace: !!rt.outOfRace,
      })),
    };
  }

  /**
   * After the player finishes: run the trucks still racing on, up to 240 s of race time, so each
   * gets a time (MONSTER_EXE_ANALYSIS.md 5, "End of race"). Returns the race view. `progress(count)` is called as the
   * loading screen's bar moves on: 30 steps over the 240 s, as the game's ("The loading bar").
   */
  function finishRace(progress = () => {}) {
    if (!race) return null;
    // An extension race left early ends where it stands; one played on the race (Race & Rumble) runs on as a race does.
    if (extensionSession && !extensionSession.keepsRace) { extensionSession.finish(); return raceView(); }
    const until = race.clock + FAST_SIMULATION_S;
    keepPrevious = false;
    try {
      const from = race.clock;
      let shown = 0;
      while (race.clock < until && !race.trucks.every((rt) => rt.finished)) {
        step({});
        const count = Math.min(LOADING_BAR.finishSteps, Math.floor(((race.clock - from) / FAST_SIMULATION_S) * LOADING_BAR.finishSteps));
        if (count > shown) progress((shown = count));
      }
    } finally {
      keepPrevious = true;
    }
    for (const t of trucks) t.previous = snapshot(t.state);
    extensionSession?.finish();
    return raceView();
  }

  /** Catch up with `seconds` of wall time; returns the states to interpolate between. */
  function advance(seconds, input, wallS = null) {
    if (Number.isFinite(wallS)) { wallDt = wallNow ? Math.max(0, wallS - wallNow) : 0; wallNow = wallS; }
    if (cp4Net) { cp4Sync.frame(wallNow, wallDt); feedHits(); }
    if (input?.modeAction) { pendingAction = input.modeAction; input.modeAction = null; }
    // One-shot presses a tick with no step kept (a frame under 1/60 s, as on a 120 Hz screen): this tick's step takes them.
    if (input) for (const k of ONE_SHOT_INPUTS) if (carriedPresses[k]) input[k] = true;
    carriedPresses = {};
    const target = Math.min(seconds, time + MAX_CATCH_UP);
    let steps = 0;
    try {
      while (time + STEP <= target) {
        // The same sum the loop tests next: whether this step is its last.
        keepPrevious = !(time + STEP + STEP <= target);
        step(input);
        steps++;
      }
    } finally {
      keepPrevious = true;
    }
    if (input) for (const k of ONE_SHOT_INPUTS) if (input[k]) carriedPresses[k] = true;
    const hits = cp4Net ? flushHits() : null;
    if (cp4Net) keepHitHistory();
    // CP4 sends one truck state a tick (18.2): only when this frame's steps reached a new tick.
    const netTick = Math.floor(time / CP4_TICK_S) + 1;
    const sendStates = !cp4Net || netTick !== lastNetTick;
    lastNetTick = netTick;
    // An extension's own objects are drawn by the extension (they are in its view), not as the level's.
    const boxes = [...dirty].filter((box) => !box.extensionOwned).map(boxPose);
    dirty.clear();
    const messages = scriptMessages.splice(0);
    const poses = trucks.map((t, i) => {
      if (cp4Net && t.remote) {
        // Drawn at the playback time, not where the pin and the lead put the physics.
        const current = drawnRemote(i, snapshot(t.state));
        return { previous: current, current, sound: soundOf(t, ground), damage: damageOf(t), touch: takeTouch(t) };
      }
      return { previous: t.previous, current: snapshot(t.state), sound: soundOf(t, ground), damage: damageOf(t), touch: takeTouch(t) };
    });
    return {
      previous: poses[0].previous, current: poses[0].current, alpha: (target - time) / STEP, time, steps, boxes,
      poses, race: raceView(),
      // Loose Wheels: each truck's wheels, the loose ones, the stubs and what came off (free roam too).
      wheels: mutator?.view() ?? null,
      // How far each top-crush car's cab is flattened: 0 intact, 1 as flat as it goes (its roof 0.25 ft over the body).
      crush: crushCars.map(crushShare),
      // 4x4 Evolution trees touched since the last reply: `{ id, pos, dir, speed }`, game feet.
      fallen: fallen.length ? (() => { const out = fallen; fallen = []; return out; })() : null,
      gold: { reversed: !!apCtx.reversed, apLevel: player.apLevel, slew: gold.slew, weather },
      // The track script's Message() lines since the last reply (4x4 Evolution 2).
      messages: messages.length ? messages : null,
      // Multiplayer: the state of each truck this machine owns (the player's, and the computer trucks' on the host).
      net: init.net ? (sendStates ? trucks.flatMap((t, i) => (t.remote ? [] : [netState(i)])) : []) : null,
      // A CP4 room: the hits this machine's trucks dealt (0x27) and each owned truck's progress (0x26), by local index.
      netHits: hits?.length ? hits : null,
      netProgress: cp4Net ? progressOut() : null,
      modeNet: netRole.authority === "owner" ? extensionSession?.netState?.() ?? null : null,
      // A mode that judges each truck where it is driven (Combat): this machine's trucks' state, from every machine.
      modeOwn: init.net && extensionSession?.netOwn ? extensionSession.netOwn() : null,
      /** Online, Wheels damage: the wheels of the trucks this machine judges, for the others. */
      wheelsOwn: init.net && mutator?.netOwn ? mutator.netOwn() : null,
    };
  }

  return {
    state: player.state, params: player.params, trucks, race, ground, levelBoxes, course, rumbleField, crushCars,
    extension: extensionSession?.debug ?? null,
    step, advance, raceView, finishRace, command, gold, now: () => time, snapshot: () => snapshot(player.state), netState,
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
    tick({ tMs, input, net }) {
      if (!session) throw new Error("No session.");
      // Multiplayer: what arrived since the last tick (`[{ name, value }]`, the network commands), before the steps.
      for (const { name, value } of net ?? []) session.command(name, value);
      // The simulated time carries on from where it stopped (a new session, or after a pause).
      if (origin === null) origin = tMs - session.now() * 1000;
      origin = catchUpOrigin(origin, tMs, session.now());
      return session.advance((tMs - origin) / 1000, input, tMs / 1000);
    },
    /** Pause: the wall clock keeps running, so restart the catch-up from the next tick. */
    resume() {
      origin = null;
      return true;
    },
    /** A GOLD-mode debug command: "reverse", "autopilot", "slew" or "cpuStop". */
    command({ name, value }) {
      if (!session) throw new Error("No session.");
      return session.command(name, value);
    },
    finish() {
      if (!session) throw new Error("No session.");
      return session.finishRace((count) => self.postMessage({ event: "finish-progress", payload: { count } }));
    },
  };
  self.addEventListener("message", async ({ data }) => {
    const { id, type, payload } = data ?? {};
    try {
      const handler = handlers[type];
      if (!handler) throw new Error(`Unknown request "${type}"`);
      self.postMessage({ id, ok: true, payload: await handler(payload) });
    } catch (err) {
      self.postMessage({ id, ok: false, error: err?.message ?? String(err), ...replyError(err) });
    }
  });
  sendWorkerFaults(self);
  self.postMessage({ ready: true });
}
