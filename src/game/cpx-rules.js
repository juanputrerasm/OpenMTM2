/*
  Community Patch 4 2.0.52.4's race rules, `WORLD\<level>.CPX` (docs/CP4_ENGINE_UPDATES.md 8): what each checkpoint box
  of the situation means, split checkpoints, lanes, walls, laps, the time-out and the wall penalties. OpenPhotex
  `readCpx` reads the bytes; this module checks the rules against the track the way the engine does and turns them into
  what the race needs. A defect refuses the race ("Race not started: <note>") except a COUR defect, which is ignored
  with a note. Pure: the tests use it.
*/
import { msg } from "./strings.js";

export const CPX_MODE = Object.freeze({ DRAG: 1, PARALLEL: 2, RACE: 3 });
export const CPX_ROLE = Object.freeze({ PRESTAGE: 1, STAGE: 2, LAUNCH: 3, FINISH: 4, GATE: 5 });
export const CPX_SPLIT = Object.freeze({ NONE: 0, ANY: 1, LANE: 2 });
/** A lap's share of the default time-out, seconds (laps x 90 s), and the fingerprint's tolerances (1/256 ft, 1/65536 turn). */
export const CPX_LAP_TIMEOUT_S = 90;
export const CPX_FINGERPRINT = Object.freeze({ position: 16, heading: 64 });
/** The most slots, copies of a slot and a level name's length (`WORLD\` + level + `.CPX` in 31 characters). */
export const CPX_MAX_SLOTS = 100, CPX_MAX_COPIES = 8, CPX_MAX_LEVEL = 21;

export const CPX_NOTES = Object.freeze({
  missing: (level) => msg("This track's race rules (WORLD\\<<1>>.CPX) are missing.").replace("<<1>>", level),
  mismatch: () => msg("Track rules do not match the track (re-export from Traxx)"),
  misfit: () => msg("Track rules do not fit this track type (re-export from Traxx)."),
  damaged: () => msg("This track's race rules are damaged."),
  newer: () => msg("This track's race rules need a newer build."),
  unannounced: () => msg("This track has race rules its .TXV does not announce; they are used."),
  courses: () => msg("This track's lead-in courses are damaged and were left out."),
});

/** Which situation track types (1 drag, 2 circuit, 3 rally) a mode fits. */
const FITS = { 1: [1], 2: [2], 3: [2, 3] };

const turnUnits = (radians) => ((Math.round((radians / (2 * Math.PI)) * 65536) % 65536) + 65536) % 65536;

/**
 * Check a read `.CPX` (OpenPhotex `readCpx`) against its track. `checkpoints` are the situation's checkpoint boxes in
 * box order (`{ positionFt, psi }`, psi in radians), `trackType` the situation's type code, `worldFt` the world's side.
 * Returns `{ rules, notes }`, or `{ refused: note }`.
 */
export function checkCpx(cpx, { checkpoints, trackType, worldFt = 8192 }) {
  const notes = [];
  const fatal = cpx.errors.filter((e) => !e.code.startsWith("COUR"));
  if (fatal.some((e) => e.code === "NEWER_MAJOR")) return { refused: CPX_NOTES.newer() };
  if (fatal.length || !cpx.rule || !cpx.boxes) return { refused: CPX_NOTES.damaged() };
  const { mode, laps } = cpx.rule;
  if (!FITS[mode]) return { refused: CPX_NOTES.misfit() };
  if (!FITS[mode].includes(trackType)) return { refused: CPX_NOTES.misfit() };

  // CPBX: one record a checkpoint box, in order; the fingerprint must match the situation's box.
  const boxes = cpx.boxes;
  if (boxes.length !== checkpoints.length) return { refused: CPX_NOTES.mismatch() };
  const W = worldFt * 256;
  const near = (a, b) => { const d = Math.abs(a - b) % W; return Math.min(d, W - d) <= CPX_FINGERPRINT.position; };
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i], c = checkpoints[i];
    const p = c.positionFt.map((v) => v * 256);
    const dh = Math.abs(turnUnits(c.psi ?? 0) - b.psi);
    if (!near(p[0], b.x) || Math.abs(p[1] - b.y) > CPX_FINGERPRINT.position || !near(p[2], b.z) || Math.min(dh, 65536 - dh) > CPX_FINGERPRINT.heading) {
      return { refused: CPX_NOTES.mismatch() };
    }
  }

  // Slots: from 0 without gaps, never decreasing, at most 100; a slot's copies share role and split.
  const slots = [];
  let last = -1;
  for (const [i, b] of boxes.entries()) {
    if (b.slot < last || b.slot > last + 1) return { refused: CPX_NOTES.mismatch() };
    last = b.slot;
    if (!slots[b.slot]) slots[b.slot] = { role: b.role, split: b.split, copies: [], lanes: [], groundLine: !!b.groundLine };
    const s = slots[b.slot];
    if (s.role !== b.role || s.split !== b.split) return { refused: CPX_NOTES.mismatch() };
    s.copies.push(i);
    s.lanes.push(b.lane);
  }
  if (!slots.length || slots.length > CPX_MAX_SLOTS) return { refused: CPX_NOTES.mismatch() };
  for (const s of slots) {
    if (s.role < 1 || s.role > 5 || s.copies.length > CPX_MAX_COPIES) return { refused: CPX_NOTES.mismatch() };
    if (s.split === CPX_SPLIT.NONE && s.copies.length !== 1) return { refused: CPX_NOTES.mismatch() };
    if (s.split === CPX_SPLIT.ANY && s.copies.length < 2) return { refused: CPX_NOTES.mismatch() };
    if (s.split === CPX_SPLIT.LANE && (s.copies.length !== 2 || [...s.lanes].sort().join() !== "1,2")) return { refused: CPX_NOTES.mismatch() };
    if (s.split > 2) return { refused: CPX_NOTES.mismatch() };
    if (s.split !== CPX_SPLIT.LANE && s.lanes.some((l) => l !== 0)) return { refused: CPX_NOTES.mismatch() };
  }
  const roles = slots.map((s) => s.role), finish = roles.lastIndexOf(CPX_ROLE.FINISH);
  const onlyGatesBetween = (from, to) => roles.slice(from, to).every((r) => r === CPX_ROLE.GATE);
  if (finish !== roles.length - 1 || roles.indexOf(CPX_ROLE.FINISH) !== finish) return { refused: CPX_NOTES.mismatch() };
  const walls = cpx.walls ?? [], points = cpx.points ?? [];
  if (mode === CPX_MODE.DRAG) {
    if (roles[0] !== CPX_ROLE.PRESTAGE || roles[1] !== CPX_ROLE.STAGE || roles[2] !== CPX_ROLE.LAUNCH || !onlyGatesBetween(3, finish)) return { refused: CPX_NOTES.mismatch() };
    // Per-lane start slots: then every slot is per lane.
    if (slots.slice(0, 3).some((s) => s.split === CPX_SPLIT.LANE) && slots.some((s) => s.split !== CPX_SPLIT.LANE)) return { refused: CPX_NOTES.mismatch() };
    if (laps !== 0 && laps !== 1) return { refused: CPX_NOTES.mismatch() };
  } else {
    if (!onlyGatesBetween(0, finish)) return { refused: CPX_NOTES.mismatch() };
    if (laps !== 0) return { refused: CPX_NOTES.mismatch() };
  }
  if (mode === CPX_MODE.RACE) {
    const { timeoutMs, penaltyMs, rearmMs } = cpx.rule;
    if (slots.some((s) => s.split === CPX_SPLIT.LANE || s.groundLine) || timeoutMs || penaltyMs || rearmMs || walls.length || points.length) {
      return { refused: CPX_NOTES.mismatch() };
    }
  }

  // Walls: their points, in 1/256 ft; a wall of fewer than 2 points (3 when closed) or a stretch's bend past half its
  // chord is a defect.
  const outWalls = [];
  for (const w of walls) {
    const list = points.slice(w.first, w.first + w.count);
    if (list.length !== w.count || w.count < (w.closed ? 3 : 2) || w.count > 1024 || !(w.thickness > 0) || !(w.height > 0)) return { refused: CPX_NOTES.damaged() };
    for (const p of list) if (!(p.x >= 0 && p.x <= W && p.z >= 0 && p.z <= W)) return { refused: CPX_NOTES.damaged() };
    outWalls.push({
      name: w.name, closed: w.closed, side: w.side, thicknessFt: w.thickness / 256, heightFt: w.height / 256,
      points: list.map((p) => ({ x: p.x / 256, z: p.z / 256, baseFt: p.baseY / 256, bendFt: p.bend / 256, gap: !!(p.gap & 1) })),
    });
  }

  // Courses: a defect is ignored with a note.
  let courses = [];
  const raw = cpx.courses ?? [];
  const coursesOk = !cpx.errors.some((e) => e.code.startsWith("COUR")) && raw.every((c, i) => {
    if (c.course > 4 || c.thenCourse > 4 || c.thenCourse === c.course) return false;
    if (raw.findIndex((o) => o.course === c.course) !== i) return false;
    if (!c.firstPassOnly) return true;
    if ((mode === CPX_MODE.DRAG || mode === CPX_MODE.PARALLEL) && c.thenCourse > 1) return false;
    if (c.course <= 1) return false;
    if (raw.some((o) => o.course === c.thenCourse && o.firstPassOnly)) return false;
    return raw.filter((o) => o.firstPassOnly && o.thenCourse === c.thenCourse).length === 1;
  });
  if (coursesOk) courses = raw.filter((c) => c.firstPassOnly).map((c) => ({ course: c.course, thenCourse: c.thenCourse }));
  else if (raw.length || cpx.errors.some((e) => e.code.startsWith("COUR"))) notes.push(CPX_NOTES.courses());

  return {
    notes,
    rules: {
      mode, oneRun: mode === CPX_MODE.DRAG && laps === 1, looped: mode === CPX_MODE.DRAG && laps === 0,
      timeoutMs: cpx.rule.timeoutMs, penaltyMs: cpx.rule.penaltyMs, rearmMs: cpx.rule.rearmMs,
      slots: slots.map(({ role, split, copies, lanes, groundLine }) => ({ role, split, copies, lanes, groundLine })),
      boxes: boxes.map((b) => ({ slot: b.slot, split: b.split, lane: b.lane, role: b.role })),
      walls: outWalls, courses,
    },
  };
}

/** The laps a `.CPX` race runs: a one-run drag always 1, otherwise the menu's. */
export const cpxLaps = (rules, menuLaps) => (rules.oneRun ? 1 : Math.max(1, menuLaps | 0));

/** The time-out in seconds: RULE `timeoutMs` when not 0, else laps x 90 s. */
export const cpxTimeoutS = (rules, laps) => (rules.timeoutMs ? rules.timeoutMs / 1000 : laps * CPX_LAP_TIMEOUT_S);

/**
 * How a track's `.CPX` stands before the race (CP4_ENGINE_UPDATES.md 8.6): `raceRules` the .TXV's key or null, `bytes`
 * the file (same archive as the level) or null. `{ cpx: null }` for a track without rules, `{ refused }` when the race
 * may not start, else `{ cpx, notes }` with `cpx` OpenPhotex's read.
 */
export function cpxPresence(raceRules, bytes, level, readCpx) {
  if (!bytes) return raceRules ? { refused: CPX_NOTES.missing(level) } : { cpx: null, notes: [] };
  const cpx = readCpx(bytes);
  if (cpx.errors.some((e) => e.code === "NOT_CPX" || e.code === "DIRECTORY_CUT")) return { refused: CPX_NOTES.damaged() };
  return { cpx, notes: raceRules ? [] : [CPX_NOTES.unannounced()] };
}
