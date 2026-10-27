/*
  The simulation worker: owns the race session and steps it at a fixed 1/60 s (docs/PLAN.md,
  "Threads and timing").

  Protocol (shared/worker-client.js): `init` sets up a session from plain data (terrain,
  surfaces, the truck's geometry and start pose); each `tick { tMs, input }` steps until the
  simulation has caught up with `tMs` (at most 0.25 s of catch-up) and replies with the last two
  states so the main thread can interpolate between them.

  Everything here is portable: the same code runs in Node tests through `createSession`.
*/
import * as E from "../vendor/openphotex/sim/evo/index.js";
import * as Cp from "../vendor/openphotex/sim/cpr/index.js";
import * as S from "../vendor/openphotex/sim/mtm2/index.js";
import { createCrossingLog, raceGap, recordCrossings } from "../game/timing.js";
import { buildRumbleField, createRumbleDriver, rumbleControls } from "../game/rumble-ai.js";
import { REVERSE_SPEED, TREE_S, createDrag, dragCollision, dragLamps, dragOver, dragPedals, dragPlaces, dragTick, mirrorCourse, stageSpeed, stagingDistance, stillStaging } from "../game/drag-race.js";
import { createExtensionSession, extensionSessionGround } from "../game/extensions/session-loader.js";
import { createEvoPathRunner } from "../game/evo-paths.js";
import { applyCprAids, cprAids, cprCarFigures, cprCourse, createCprDriver, createWidthLookup, spinCorrection } from "../game/cpr-driver.js";
import { cprAnchorsForSag } from "../shared/cpr-anchors.js";
import { createFlight, departVisual, flightVisual, nearestCourseSpot, stepFlight, timerVisual } from "../game/heli-flight.js";
import { createRacerRecovery, racerRecovering, racerRecoveryBefore, racerRecoveryStep } from "../game/racer-recovery.js";
import { cpuControlBefore, cpuControlStep, createCpuControl } from "../game/cpu-control.js";

export const STEP = 1 / 60;


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
export function createGroundBoxCache(ra0, ra1, stepFt = 2) {
  // By the exact start of the copy of the world (x, then z), then the cell, -1 to 256 each way.
  const kept = new Map();
  const CELL = S.GROUND_BOX_CELL_FT;
  return {
    around(x, z, out = []) {
      const col = (Math.trunc(x * 256) >> 13) & 255;
      const row = (Math.trunc(z * 256) >> 13) & 255;
      const baseX = x - S.wrapCoord(x), baseZ = z - S.wrapCoord(z);
      let byZ = kept.get(baseX);
      if (!byZ) kept.set(baseX, byZ = new Map());
      let cells = byZ.get(baseZ);
      if (!cells) byZ.set(baseZ, cells = new Map());
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          const c = (col + dc) & 255, r = (row + dr) & 255;
          const i = r * 256 + c;
          const lo = ra0[i] * stepFt, hi = ra1[i] * stepFt;
          if (lo === hi) continue;
          const key = (col + dc + 1) * 258 + (row + dr + 1);
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
  const tires = s.tires.map((x, i) => ({
    onGround: x.onGround, grip: x.grip, force: [x.force[0], x.force[1], x.force[2]], spin: x.spin, surface: x.surface, lateral: x.lateral,
    slip: s.evo?.slip[i] ?? 0, vLat: x.velocity[0],
  }));
  const m = s.matrix, weather = ground.weather ?? 0;
  // In water, for its sounds (0x41bbd0): on a level with water, a tire on a water surface or the body under the level;
  // never in Snow. (A probe's `waterDepth` is no measure of it: it is how deep the probe is in the ground, wet or dry.)
  const level = ground.waterLevelFt ?? null;
  const inWater = weather !== 5 && level !== null
    && (s.tires.some((x) => x.onGround && [3, 13].includes(S.surfaceType(x.surface))) || s.pos[1] < level);
  const out = {
    weather, inWater, vy: m[3] * s.bvel[0] + m[4] * s.bvel[1] + m[5] * s.bvel[2],
    rpm: s.rpm, throttle: s.controls.throttle, brake: Math.max(s.controls.brakeFront, s.controls.brakeRear), gear: s.controls.gear, airborne: air, forward: s.bvel[2],
    speed: Math.hypot(s.bvel[0], s.bvel[1], s.bvel[2]), vx: s.bvel[0], bottoming: t.snd.bottoming, collide: t.snd.collide ?? 0, 
    impact: t.snd.impact, hit: t.snd.hit, clearance: s.pos[1] - ground.height(s.pos[0], s.pos[2]), splash: t.snd.splash, tires, surface: S.surfaceType(ground.surface(s.pos[0], s.pos[1] + 100, s.pos[2])), heli: s.heliTimer > 0, heliTeryl: !!s.heliVisual?.teryl, heliPos: s.heliVisual ? [...s.heliVisual.pos] : null,
  };
  t.snd.impact = 0;
  t.snd.bottoming = 0;
  t.snd.collide = 0;
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
  // `heightsFt`: corner heights in feet, for a level finer than MTM2's 2 ft steps (CART Precision Racing).
  const terrain = init.heightsFt
    ? S.createTerrainFt(new Float32Array(init.heightsFt), init.waterLevelFt ?? null, init.fineFt ? new Float32Array(init.fineFt) : null)
    : S.createTerrain(new Uint8Array(init.heights), init.waterLevelFt ?? null);
  const surfaces = init.clr && init.textureValues
    ? S.createSurfaceMap(new Uint16Array(init.clr), new Int32Array(init.textureValues))
    : null;
  let weather = init.weather ?? 0;
  // The physics model's rules (app/settings.js PHYSICS_MODELS): MTM2's unless the race asks for the 1996 game's, or for one
  // of 4x4 Evolution's, whose vehicle model then drives every truck (OpenPhotex evoSim; docs/EVO2_PHYSICS.md).
  const evoModel = E.isEvoRules(init.rules);
  // CART Precision Racing's model (OpenPhotex sim/cpr): its cars drive on it, every other vehicle on MTM2's.
  const cprModel = Cp.isCprRules(init.rules);
  const rules = evoModel ? E.evoRules(init.rules) : cprModel ? Cp.CPR_RULES : S.simRules(init.rules);
  const terrainGround = S.createTerrainGround(terrain, surfaces, weather, init.waterLevelFt ?? null, rules);
  // CPR's road layer lies over the terrain and is the ground where it does (OpenPhotex world/road.ts).
  const ground = init.road ? S.createRoadGround(terrainGround, init.road) : terrainGround;
  // Surfaces over the terrain that count only when they are under a truck (4x4 Evolution's rocks and decks): each
  // truck asks with its own height, so what stands over it is not its ground (OpenPhotex world/road.ts `below`).
  const meshGround = init.meshGround ? S.createRoadGround(terrainGround, init.meshGround) : null;
  for (const g of [ground, meshGround]) if (g) g.rules = rules;
  /** Optional rules loaded over the race's countdown and clock. */
  const extensionPayload = init.extension && init.race ? init.extension : null;
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
    // A 4x4 Evolution tree (worker/evo-track-build.js): knocked over, not solid.
    if (w.tree) box.tree = w.tree;
    const reach = w.matrix ? Math.hypot(w.size[0], w.size[1], w.size[2]) * 0.5 : Math.hypot(w.size[0], w.size[2]) * 0.5;
    for (let cx = Math.floor((w.pos[0] - reach) / WALL_CELL_FT); cx <= Math.floor((w.pos[0] + reach) / WALL_CELL_FT); cx++) {
      for (let cz = Math.floor((w.pos[2] - reach) / WALL_CELL_FT); cz <= Math.floor((w.pos[2] + reach) / WALL_CELL_FT); cz++) {
        const key = cx * 65536 + cz;
        if (!wallCells.has(key)) wallCells.set(key, []);
        wallCells.get(key).push(box);
      }
    }
  }
  /** The walls a truck of radius `r` at (x, z) may touch, each once, onto `out`. */
  function wallsAround(x, z, r, out) {
    // A position that is not a number, or is far off the world, has no walls (and must not be walked cell by cell).
    if (!wallCells.size || !(Math.abs(x) < 1e6) || !(Math.abs(z) < 1e6)) return;
    const seen = new Set();
    // The cells are the one world's: a cell past its edge is the cell at the other side.
    const cells = S.WORLD_FT / WALL_CELL_FT, inWorld = (c) => ((c % cells) + cells) % cells;
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
    const cells = S.WORLD_FT / WALL_CELL_FT, inWorld = (c) => ((c % cells) + cells) % cells;
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
  // MONSTER.INI steeringResponse, which the controls take as r = steeringResponse * 0.1 (MONSTER_EXE_ANALYSIS.md section 7).
  const steeringResponse = Math.min(10, Math.max(0, Number(init.steeringResponse ?? 10) || 0)) * 0.1;
  const sonicTrack = !!init.sonicTrack;
  // The feet to a ground box's height step: MTM's 2, or a level's own (Hellbender's 1.5).
  const groundBoxStepFt = init.groundBoxStepFt > 0 ? init.groundBoxStepFt : 2;
  const ra0 = init.ra0 ? new Uint8Array(init.ra0) : null;
  const ra1 = init.ra1 ? new Uint8Array(init.ra1) : null;
  const groundBoxes = createGroundBoxCache(ra0, ra1, groundBoxStepFt);
  const levelBoxes = [];
  /** Moving objects: type 10 boxes and their SIT bvel (MTM2_PHYSICS.md 14.18). */
  const movingObjects = [];
  for (const b of init.boxes ?? []) {
    const box = S.createLevelBox(b, b.bounds);
    if (box) {
      box.sitIndex = b.sitIndex;
      // A 4x4 Evolution object's model stands off its box's centre: its origin, in the box's frame (worker/evo-track-build.js).
      if (b.drawOffset) box.drawOffset = b.drawOffset;
      // Moved by a 4x4 Evolution object path (game/evo-paths.js): the path's object, or what hangs from it (`attach`); a
      // `ghost` is moved but met by nothing (its class does not collide).
      if (b.pathRoot !== undefined) { box.pathRoot = b.pathRoot; box.attach = b.attach ?? null; box.ghost = !!b.ghost; }
      levelBoxes.push(box);
    }
    if (box && b.bvel) movingObjects.push({ box, bvel: b.bvel });
  }
  const allRamps = (init.ramps ?? []).map((r) => S.createRamp(r, r.bounds)).filter(Boolean);
  // The course's straights with the arcs built between them, over the ground the probes see
  // (MTM2_PHYSICS.md 12, 14.22).
  const course = S.buildCourse(init.course ?? [], (x, z) => ground.height(x, z), {
    sonicTrack, gripK: sonicTrack && difficulty === S.DIFFICULTY.PROFESSIONAL ? 2 : 1.75,
  });
  // The computer trucks steer by the game's frame time, not the simulation's step (OpenPhotex AUTOPILOT_FRAME_DT, 1/30 s):
  // `opponentFps` (Options, Advanced) is the frame rate they drive as if the game ran at.
  const opponentFps = Number(init.opponentFps);
  const apCtx = { course, height: (x, z) => ground.height(x, z), dt: STEP, difficulty, sonicTrack };
  if (opponentFps >= 10 && opponentFps <= 240) apCtx.frameDt = 1 / opponentFps;

  const specs = init.trucks ?? [{ truck: init.truck, start: init.start, autopilot: init.autopilot }];
  // The CPR Skill Level (Options, Advanced): the player's driving aids under CPR physics.
  const cprPlayerAids = cprAids(init.cprSkill ?? "rookie");
  const playerAids = {
    abs: cprPlayerAids.abs, tractionControl: cprPlayerAids.tractionControl,
    gripScale: cprPlayerAids.gripScale, offroadGrip: cprPlayerAids.offroadGrip,
  };
  const trucks = specs.map((spec, i) => {
    const setup = { difficulty, autoShift: init.autoShift ?? true, ...spec.setup };
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
    if (init.startOnNearestSegment) state.ap.segment = nearestStraight(course, spec.start.pos, spec.start.heading ?? 0);
    // A Rumble needs no course: its computer trucks drive to the zone (rumble-ai.js).
    // A remote truck (multiplayer, docs/MULTIPLAYER.md) is driven by another machine's updates, never by this one.
    const remote = !!spec.remote;
    const autopilot = !remote && !!spec.autopilot && (course.length > 0 || init.race?.mode === "summit" || !!extensionPayload);
    // Without a course the reset keeps the heading and the helicopter sets the truck down in place.
    // `proLift`: a computer truck that misses a checkpoint or comes to rest is always fetched by the helicopter, never
    // set back on the course at once as the game does on Professional (the port's choice).
    const recovery = {
      racing: true, player: i === 0 && !autopilot && !remote, autopilot, difficulty, summit: false, segment: null, previous: null, proLift: true,
    };
    // A foot under the body's origin: a step up to about a wheel's height is climbed, a taller face is not ground.
    const ownGround = meshGround ? meshGround.below(() => state.pos[1] - 1) : extensionGround;
    const ctx = { ground: ownGround, human: i === 0 && !autopilot && !remote, difficulty, sonicTrack, recovery };
    return { state, params, autopilot, remote, recovery, ctx, evoVehicle: !!spec.truck.evo, cprCar, radius: S.truckRadius(params), nearBoxes: [], dmg: new Map(), snd: { impact: 0, bottoming: 0, collide: 0, hit: null, splash: false, surface: 1 }, safe: copyState(state), sinceSafe: 0 };
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
  const dragMode = init.race?.mode === "drag" && (init.race.checkpoints?.length ?? 0) >= 4;
  const drag = dragMode ? createDrag(init.race.checkpoints, [0, 1].map((lane) => specs.some((spec, i) => (spec.lane ?? i) === lane)), rules.id === "mtm1" ? "mtm1" : "cp3") : null;
  const race = init.race
    ? S.createRace(trucks.map((t, i) => ({ s: t.state, p: t.params, player: (i === 0 && !t.autopilot) || t.remote })),
      S.raceCheckpoints(dragMode ? [] : init.race.checkpoints), dragMode ? [] : course,
      dragMode ? 1 : init.race.laps ?? 3, difficulty, dragMode ? "circuit" : init.race.mode ?? "circuit")
    : null;
  const raceAp = dragMode ? { ...apCtx, course: [] } : apCtx;
  if (drag) {
    race.startTime = Infinity;
    const beam = init.race.checkpoints[0].gate;
    // Lane 1 drives the SIT's course 2 (the lanes are the courses, 6.4); a strip without one gets lane 0's, mirrored.
    const other = init.race.laneCourse?.length ? init.race.laneCourse : mirrorCourse(init.course ?? [], beam.position, beam.angles[2]);
    const mirrored = S.buildCourse(other, (x, z) => ground.height(x, z), {
      sonicTrack, gripK: sonicTrack && difficulty === S.DIFFICULTY.PROFESSIONAL ? 2 : 1.75,
    });
    specs.forEach((spec, i) => {
      const t = trucks[i];
      t.lane = spec.lane ?? i;
      t.apCtx = { ...apCtx, course: t.lane === 1 ? mirrored : course, dragMode: true, traffic: undefined };
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
  /** The autopilot context a truck drives by: its lane's in a drag race. */
  const apOf = (t) => t.apCtx ?? apCtx;

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
      const i = (((Math.trunc(z * 256) >> 13) & 255) << 8) | ((Math.trunc(x * 256) >> 13) & 255);
      if (ra0[i] === ra1[i]) return [g];
      const lo = ra0[i] * 2, hi = ra1[i] * 2;
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
    step: STEP, trucks, race, levelBoxes, dirty, wallsAround, walls: init.walls,
    ground, course, specs, ramps: allRamps, weather: () => weather, watchHeadway, net: netRole,
    // The helicopter for a truck, set down on course segment `segment` (as for a missed checkpoint).
    liftTo: (t, segment) => liftToSegment(t, segment),
  });
  // An extension may give a truck a ground of its own (Combat's, which hides a lost wheel's ground: the wheel never touches).
  if (extensionSession?.groundFor) {
    trucks.forEach((t, i) => {
      const own = extensionSession.groundFor(i, t.ctx.ground);
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
  // Computer racers' own recovery (game/racer-recovery.js): on Professional they drive back through a missed
  // checkpoint; an extension may have its racers get themselves out when stuck (Race & Rumble).
  if (race && !race.summit && !drag && course.length) {
    trucks.forEach((t, i) => {
      if (!t.autopilot || t.remote || t.cprDriver || race.trucks[i].outOfRace) return;
      const returns = difficulty === S.DIFFICULTY.PROFESSIONAL;
      const unsticks = !!extensionSession?.selfRecovery?.(i);
      if (returns || unsticks) t.racerRecovery = createRacerRecovery({ returns, unsticks });
      // Every computer truck on the course keeps control of itself (game/cpu-control.js).
      t.cpuControl = createCpuControl();
    });
  }

  /**
   * This frame's boxes (MTM2_PHYSICS.md 14.15): those within r + R + 10 ft on x and z of a truck
   * or of a box already listed, and those moving faster than 0.1 ft/s; then the ramps (14.19).
   */
  function listBoxes() {
    listed.length = 0;
    const near = (x, z, r, box) => {
      const range = r + box.radius + 10;
      // The short way round: a box across the world's seam is as near as one beside the truck.
      return Math.abs(S.wrapDelta(box.pos[0] - x)) < range && Math.abs(S.wrapDelta(box.pos[2] - z)) < range;
    };
    const nearTruck = (box) => trucks.some((t) => near(t.state.pos[0], t.state.pos[2], t.radius, box));
    for (const box of levelBoxes) {
      if (box.ghost) continue;
      const moving = Math.hypot(box.vel[0], box.vel[1], box.vel[2]) > 0.1;
      if (moving || nearTruck(box) || listed.some((o) => near(o.pos[0], o.pos[2], o.radius, box))) listed.push(box);
    }
    // An extension's own loose objects (Combat's lost wheels) are always in the list: every truck meets them.
    for (const box of extensionSession?.movableBoxes?.() ?? []) listed.push(box);
    ground.ramps.length = 0;
    for (const ramp of allRamps) {
      if (nearTruck(ramp) || listed.some((o) => near(o.pos[0], o.pos[2], o.radius, ramp))) ground.ramps.push(ramp);
    }
  }

  // Top-crush cars (14.27): the truck is held up by the body and the cab, and flattens the cab.
  /**
   * 4x4 Evolution's trees (docs/EVO2_EXE_ANALYSIS.md 2.5): a tree inside a truck's hull footprint is knocked over and no
   * longer met. The game makes it a falling object with the truck's velocity; how the truck feels it is not traced, so here
   * it does not. `fallen` collects them for the drawing.
   */
  const knocked = new Set();
  let fallen = [];
  function knockTree(t, box) {
    if (knocked.has(box.tree)) return;
    const s = t.state, m = s.matrix;
    const dx = box.pos[0] - s.pos[0], dy = box.pos[1] - s.pos[1], dz = box.pos[2] - s.pos[2];
    const x = m[0] * dx + m[3] * dy + m[6] * dz, z = m[2] * dx + m[5] * dy + m[8] * dz;
    t.footprint ??= (() => {
      const pts = t.params.scrapePoints.length ? t.params.scrapePoints : t.params.hubs;
      return { x0: Math.min(...pts.map((p) => p[0])) - 1, x1: Math.max(...pts.map((p) => p[0])) + 1, z0: Math.min(...pts.map((p) => p[2])) - 1, z1: Math.max(...pts.map((p) => p[2])) + 1 };
    })();
    const f = t.footprint;
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1 || Math.abs(dy) > box.half[1] + 10) return;
    knocked.add(box.tree);
    const v = [m[0] * s.bvel[0] + m[1] * s.bvel[1] + m[2] * s.bvel[2], m[6] * s.bvel[0] + m[7] * s.bvel[1] + m[8] * s.bvel[2]];
    fallen.push({ id: box.tree, pos: [box.pos[0], box.pos[1] - box.half[1], box.pos[2]], dir: v, speed: Math.hypot(v[0], v[1]) });
  }
  const crushCars = (init.topCrush ?? []).map((car) => S.createTopCrush(car, car.bodyBounds ?? null, car.cabBounds ?? null));
  const crushCtx = { groundNormal: (x, z) => ground.normal(x, z, [0, 0, 0]), dt: STEP, edges: S.createEdgeState() };
  /** The pair tests (14.14, 14.17, 14.19, 14.20, 14.21), trucks first in list order. */
  function pairTests() {
    for (let i = 0; i < trucks.length; i++) {
      for (let j = i + 1; j < trucks.length; j++) {
        const a = trucks[i], b = trucks[j];
        const f = a.state.extForce, f0 = f[0], f1 = f[1], f2 = f[2];
        const met = S.collideTrucks({ s: a.state, p: a.params }, { s: b.state, p: b.params }, STEP, rules);
        // A hull against a hull: the pair's forces changed. Remember the hardest hit and where the trucks met.
        const force = Math.hypot(f[0] - f0, f[1] - f1, f[2] - f2);
        if (force > 0) {
          if (drag) dragCollision(drag, a.lane, b.lane);
          extensionSession?.touch?.(i, j);
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
    for (const [ti, t] of trucks.entries()) {
      t.nearBoxes.length = 0;
      if (t.state.heliTimer > 0) continue;
      if (ra0 && ra1) groundBoxes.around(t.state.pos[0], t.state.pos[2], t.nearBoxes);
      wallsAround(t.state.pos[0], t.state.pos[2], t.radius, t.nearBoxes);
      // Each test is made with the truck as the copy nearest the thing it is tested against (OpenPhotex world/wrap.ts):
      // what stands across the world's seam is met as what stands beside the truck is.
      const near = (thing, test) => S.withNearest(t.state, thing.pos[0], thing.pos[2], test);
      for (const box of t.nearBoxes) {
        if (box.tree) { near(box, () => knockTree(t, box)); continue; }
        near(box, () => S.collideTruckImmovableBox(t.state, t.params, box, STEP));
      }
      nearFaces.length = 0;
      facesAround(t.state.pos[0], t.state.pos[2], t.radius, nearFaces);
      for (const face of nearFaces) S.withNearest(t.state, face.centre[0], face.centre[2], () => S.collideTruckFace(t.state, t.params, face, STEP));
      for (const box of listed) {
        const collide = () => {
          const touch = near(box, () => S.collideTruckBox(t.state, t.params, box, STEP));
          if (touch) noteObjectHit(t, box, touch);
          return touch;
        };
        if (box === extensionSession?.specialBox) extensionSession.collideSpecial(ti, box, collide);
        else collide();
      }
      for (const car of crushCars) near(car, () => S.collideTruckTopCrush(car, t.state, t.params, crushCtx));
      // Ramp sides and front ends are walls (14.19), for ramps within reach of the truck.
      for (const ramp of ground.ramps) {
        const d = Math.hypot(S.wrapDelta(ramp.pos[0] - t.state.pos[0]), ramp.pos[1] - t.state.pos[1], S.wrapDelta(ramp.pos[2] - t.state.pos[2]));
        if (d < ramp.radius + t.radius) near(ramp, () => S.collideTruckRamp(ramp, t.state, t.params));
      }
      grounds.push(...t.nearBoxes);
    }
    const all = listed.length ? [...listed, ...grounds] : listed;
    extensionSession?.addSpecialWalls?.(all, listed);
    // Two boxes that never move never meet (OpenPhotex collideBoxes returns at once): each pair has a moving one first.
    const moving = all.filter((box) => box.dynamic), still = all.filter((box) => !box.dynamic);
    for (let i = 0; i < moving.length; i++) {
      for (let j = i + 1; j < moving.length; j++) S.collideBoxes(moving[i], moving[j], STEP);
      for (const box of still) S.collideBoxes(moving[i], box, STEP);
    }
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
  const gold = { slew: false };
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
  /** Slew mode: the simulation stands still and the player's truck is moved by hand. */
  function slewMove(slew) {
    const s = player.state;
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
  const remotePolicy = init.net?.policy === "smooth" ? "smooth" : "legacy";
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
  /** What a truck this machine owns sends (the 0x02 fields, game units). */
  function netState(i) {
    const t = trucks[i], s = t.state, c = s.controls;
    return {
      truck: i, pos: Array.from(s.pos), bvel: Array.from(s.bvel), euler: Array.from(s.euler), steer: c.steer, throttle: c.throttle,
      brakeRear: c.brakeRear, brakeFront: c.brakeFront, gear: c.gear, autoShift: !!t.params.autoShift,
      score: race?.summit ? race.summit.trucks[i].score : 0,
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
    return undefined;
  }

  /** A debug command from the page; returns the new state of what it changed. */
  function command(name, value) {
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
    if (name === "autopilot") return setAutopilotLevel((player.apLevel + 1) % 3);
    if (name === "slew") return (gold.slew = !gold.slew);
    throw new Error(`Unknown command "${name}"`);
  }

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
        Object.assign(rt, { raceTime: l.et, lapTimes: [l.et], fastestLap: l.et, laps: 1, finished: true });
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

  /** The helicopter for a stuck computer truck, at once. */
  function liftStuck(t) {
    const s = t.state;
    s.heliTimer = S.STUCK_LIMIT_S - 1;
    S.liftOff(s, t.params, ground, recoveryOf(t), s.contactCount ?? 0);
  }

  /**
   * A computer truck that just missed a checkpoint (MTM2_PHYSICS.md 14.24): one that drives back through it itself
   * (game/racer-recovery.js) is left to; any other is lifted as the race rules do, toward the segment it was on when
   * it missed. (The port never sets it on the gate as the game does on Professional.)
   */
  function missedCheckpoint(t, segment) {
    if (t.racerRecovery?.returns) return;
    const s = t.state;
    s.heliTimer = -6;
    S.liftOff(s, t.params, ground, recoveryOf(t, segment), s.contactCount);
  }

  /** The helicopter for truck `t`, to course segment `segment`, the way the race rules lift a truck that missed a checkpoint. */
  function liftToSegment(t, segment) {
    const s = t.state;
    if (s.heliTimer > 0 || t.flight) return false;
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

  /**
   * A computer racer's own recovery after the course autopilot (game/racer-recovery.js). While it handles the truck
   * the course's stuck timer is off and it alone calls the helicopter, as its last resort.
   */
  function recoverRacer(t, i) {
    const r = t.racerRecovery, s = t.state, rt = race.trucks[i];
    if (s.heliTimer > 0) return;
    const cp = rt.state === 3 && !rt.finished ? race.checkpoints[rt.checkpoint] : null;
    const verdict = racerRecoveryStep(r, {
      state: s, dt: STEP, gears: S.GEAR,
      missed: cp ? { pos: cp.gate.pos, psi: cp.psi, half: cp.gate.half } : null,
      aim: segmentAim(recoveryOf(t).segment),
      trucks: r.unsticks ? trucks.filter((o) => o !== t && o.state.heliTimer <= 0).map((o) => o.state.pos) : null,
      threats: extensionSession?.threats?.(i) ?? null,
    });
    const own = r.unsticks || racerRecovering(r);
    t.recovery.autopilot = !own;
    if (own && s.heliTimer < 0) s.heliTimer = 0;
    if (verdict === "course") keepControl(t);
    if (verdict === "heli") { t.headway = null; liftStuck(t); }
    else if (own) t.headway = null;
    else watchHeadway(t);
  }

  /** A computer truck keeping control after the autopilot (game/cpu-control.js). */
  function keepControl(t) {
    if (!t.cpuControl || t.state.heliTimer > 0) return;
    cpuControlStep(t.cpuControl, t.state, STEP, segmentAim(recoveryOf(t).segment), S.GEAR);
  }

  /**
   * Whether a step keeps the trucks' states from before it (`previous`, what a reply interpolates from). Only the last
   * step of a catch-up's is sent, so `advance` and `finishRace` ask for that one alone; a step made any other way keeps it.
   */
  let keepPrevious = true;
  /** An extension's action waiting for the next step (`step`). */
  let pendingAction = null;
  /** The listed boxes' poses before a step (`poseInto`), kept from step to step. */
  let before = new Float64Array(0);

  /** Step one fixed step with the held keys (the player's truck). */
  function step(input) {
    const { joystick = null, helicopter = false, slew = null, modeAction = null, ...held } = input ?? {};
    // An extension's own key (Combat's repair, on the Crash Damage key) and its menu's choices (leaving to watch): kept
    // until a step takes it, as a tick may run none (the first after a pause).
    if (modeAction) pendingAction = modeAction;
    if (input) input.modeAction = null;
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
      if (extensionSession && S.raceStarted(race)) extensionSession.tick();
      recordCrossings(crossings, race.trucks);
    }
    const go = !race || S.raceStarted(race);
    // The at-rest reset and lift-off run only in the race state, not through the countdown (10.3).
    // A remote truck's resets and helicopter are its owner's; they arrive as position snaps.
    for (const t of trucks) t.recovery.racing = go && !t.remote;
    for (const [i, t] of trucks.entries()) {
      if (t.remote) {
        // Its controls are the last ones it sent (applyRemote); a smoothed truck eases out its error.
        easeRemote(t);
        continue;
      }
      if (t.autopilot) {
        if (!race || drag) S.advanceAutopilotSegment(t.state, apOf(t));
        recoveryOf(t);
        // An extension mode drives its trucks; one that answers false leaves the truck to the course's autopilot (Race & Rumble's racers).
        if (go && extensionSession && extensionSession.drive(t, i) !== false) { /* driven by the mode */ }
        else if (go && t.rumble) {
          const rivals = trucks.filter((o) => o !== t && o.state.heliTimer <= 0).map((o) => o.state.pos);
          rumbleControls(t.state, t.rumble, race.summit.zone, rivals, S.GEAR, STEP, rumbleField);
        } else if (go && drag && (drag.lanes[t.lane].dq || race.clock - race.startTime < (t.reaction ?? 0))) {
          // A computer driver's reaction to the green; a disqualified truck stays where it is.
          t.state.controls.throttle = 0;
          t.state.controls.brakeFront = t.state.controls.brakeRear = 1;
        } else if (go && t.cprDriver) {
          cprDrive(t);
          watchHeadway(t);
        } else if (go && t.racerRecovery) {
          racerRecoveryBefore(t.racerRecovery, t.state.controls);
          if (t.cpuControl) cpuControlBefore(t.cpuControl, t.state.controls);
          S.applyAutopilot(t.state, t.params, apOf(t));
          recoverRacer(t, i);
        } else if (go) {
          if (t.cpuControl) cpuControlBefore(t.cpuControl, t.state.controls);
          S.applyAutopilot(t.state, t.params, apOf(t));
          keepControl(t);
          // A drag pass: flat out to the finish beam (game/drag-race.js `dragPedals`); the autopilot steers and stops it after.
          if (drag && !race.trucks[i].finished && t.state.bvel[2] > 1) dragPedals(t.state.controls, -t.state.euler[0], Math.atan2(t.state.bvel[0], t.state.bvel[2]));
          watchHeadway(t);
        } else t.state.controls.throttle = 0;
      } else if (i === 0) {
        const controlCtx = {
          dt: STEP, autoShift: t.params.autoShift, forwardSpeed: t.state.bvel[2], dragMode: !!drag, segments: drag ? 4 : 0, difficulty, steeringResponse,
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
        S.stepMovingObject(box, bvel, terrain, ra0, ra1, STEP, weather === S.WEATHER.SNOW);
        dirty.add(box);
      }
    }
    listBoxes();
    if (before.length < listed.length * 6) before = new Float64Array(listed.length * 12);
    listed.forEach((box, i) => poseInto(box, before, i * 6));
    for (const t of trucks) {
      // The player's helicopter holds the truck still and carries it itself (game/heli-flight.js).
      if (t.flight) { flyTruck(t); continue; }
      extensionSession?.afterTruckStep?.(t);
      if (t.cprCar) Cp.stepCprTruck(t.state, t.params, t.ctx, STEP);
      else if (evoModel) E.stepEvoTruck(t.state, t.params, t.ctx, STEP);
      else S.stepTruck(t.state, t.params, t.ctx, STEP);
      t.snd.impact = Math.max(t.snd.impact, t.state.impactForce);
      // The bump stops' jolt, for a gamepad's rumble (game/input/rumble.js); only the MTM2 model reports it.
      t.snd.bottoming = Math.max(t.snd.bottoming, t.state.bottoming ?? 0);
      t.snd.splash = t.snd.splash || t.state.splash;
    }
    for (const box of listed) S.stepBox(box, ground, STEP);
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
        const [dx, dz] = S.wrapTruck(t.state);
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
    listed.forEach((box, i) => {
      S.postStepBox(box, ground);
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
    t.snd.hit = { sitIndex: box.sitIndex, force: touch.speed, offset: [S.wrapDelta(box.pos[0] - s.pos[0]), box.pos[1] - s.pos[1], S.wrapDelta(box.pos[2] - s.pos[2])] };
  }

  /**
   * The player's Helicopter key: at any time once the race runs, the helicopter takes the truck (frozen in the
   * air) to the nearest point of the course and sets it down facing along it; pressed again, it lets go where it is.
   * Every third call brings the pterodactyl instead (the game's counter at `0x651798`).
   */
  let heliCalls = 0;
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
    const spot = extensionSession?.heliSpot?.(trucks.indexOf(t))
      ?? nearestCourseSpot(driven, here, (x, z) => ground.height(x, z))
      ?? { pos: [here[0], ground.height(here[0], here[2]), here[2]], heading: t.state.euler[2] };
    t.flight = createFlight(t.state, spot, { teryl: heliCalls === 2, height: (x, z) => ground.height(x, z) });
    t.state.heliTimer = 1;
    t.exit = null;
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
    const places = drag ? dragPlaces(race.trucks.map((rt, i) => ({ ...rt, dq: laneOf(i)?.dq || laneOf(i)?.rerun }))) : null;
    return {
      started: since >= 0,
      countdown: drag && drag.phase !== "go" ? (drag.phase === "tree" ? TREE_S - drag.tree : 3) : Math.max(0, -since),
      /** A drag race's tree: its phase, and each truck's lamps and lane. */
      drag: drag ? {
        phase: drag.phase,
        lamps: trucks.map((t) => dragLamps(drag, t.lane)),
        lane: trucks.map((t) => t.lane),
      } : null,
      clock: Math.max(0, since),
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
        /** A drag pass: why the truck is out (a name of game/drag-race.js `DQ_CODE`), whether its pass is to be run again, its reaction time. */
        dq: laneOf(i)?.dq ?? null,
        rerun: !!laneOf(i)?.rerun,
        reaction: laneOf(i)?.reaction ?? null,
        score: race.summit ? race.summit.trucks[race.trucks.indexOf(rt)].score : extensionSession?.score(i) ?? 0,
        laps: rt.laps,
        lap: Math.min(rt.laps + 1, race.laps),
        lapTime: rt.finished ? (rt.lapTimes[rt.lapTimes.length - 1] ?? 0) : Math.max(0, since - rt.raceTime),
        best: rt.fastestLap,
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
   * gets a time (MONSTER_EXE_ANALYSIS.md 5, "End of race"). Returns the race view.
   */
  function finishRace() {
    if (!race) return null;
    // An extension race left early ends where it stands; one played on the race (Race & Rumble) runs on as a race does.
    if (extensionSession && !extensionSession.keepsRace) { extensionSession.finish(); return raceView(); }
    const until = race.clock + FAST_SIMULATION_S;
    keepPrevious = false;
    try {
      while (race.clock < until && !race.trucks.every((rt) => rt.finished)) step({});
    } finally {
      keepPrevious = true;
    }
    for (const t of trucks) t.previous = snapshot(t.state);
    extensionSession?.finish();
    return raceView();
  }

  /** Catch up with `seconds` of wall time; returns the states to interpolate between. */
  function advance(seconds, input) {
    if (input?.modeAction) { pendingAction = input.modeAction; input.modeAction = null; }
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
    // An extension's own objects are drawn by the extension (they are in its view), not as the level's.
    const boxes = [...dirty].filter((box) => !box.extensionOwned).map(boxPose);
    dirty.clear();
    const messages = scriptMessages.splice(0);
    const poses = trucks.map((t) => ({ previous: t.previous, current: snapshot(t.state), sound: soundOf(t, ground), damage: damageOf(t), touch: takeTouch(t) }));
    return {
      previous: poses[0].previous, current: poses[0].current, alpha: (target - time) / STEP, time, steps, boxes,
      poses, race: raceView(),
      // How far each top-crush car's cab is flattened: 0 intact, 1 as flat as it goes (its roof 0.25 ft over the body).
      crush: crushCars.map(crushShare),
      // 4x4 Evolution trees knocked over since the last reply: `{ id, pos, dir, speed }`, game feet.
      fallen: fallen.length ? (() => { const out = fallen; fallen = []; return out; })() : null,
      gold: { reversed: !!apCtx.reversed, apLevel: player.apLevel, slew: gold.slew, weather },
      // The track script's Message() lines since the last reply (4x4 Evolution 2).
      messages: messages.length ? messages : null,
      // Multiplayer: the state of each truck this machine owns (the player's, and the computer trucks' on the host).
      net: init.net ? trucks.flatMap((t, i) => (t.remote ? [] : [netState(i)])) : null,
      modeNet: netRole.authority === "owner" ? extensionSession?.netState?.() ?? null : null,
      // A mode that judges each truck where it is driven (Combat): this machine's trucks' state, from every machine.
      modeOwn: init.net && extensionSession?.netOwn ? extensionSession.netOwn() : null,
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
      return session.advance((tMs - origin) / 1000, input);
    },
    /** Pause: the wall clock keeps running, so restart the catch-up from the next tick. */
    resume() {
      origin = null;
      return true;
    },
    /** A GOLD-mode debug command: "reverse", "autopilot" or "slew". */
    command({ name, value }) {
      if (!session) throw new Error("No session.");
      return session.command(name, value);
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
