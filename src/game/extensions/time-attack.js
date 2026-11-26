/*
  Time Attack (docs/EXTENSIONS.md, "Shipped extension: Time Attack"; Community Patch 4 2.0.52.4,
  docs/CP4_ENGINE_UPDATES.md 9.5): hot laps alone against the player's own best-lap ghost. A mode of the Races screen's
  Mode list, on a circuit or a rally, played on the track's own race (`keepsRace`) with no opponents. Each lap is recorded at 25 Hz from the player's own simulation; a lap better than the ghost's becomes
  the ghost. At each checkpoint the HUD shows the gap to the ghost's split there. Laps driven before End Race bank to
  the Hall of Fame (the best of them).

  The ghost is OpenPhotex's `MTM2GHOST 1` text (`writeGhost`, `parseGhost`): 29 numbers a sample. The game's axis and
  angle conventions were not published, so OpenMTM2's ghosts are in its own frame (game feet, the simulation's Euler
  angles) and a ghost from Community Patch 4 is not known to line up. Pure apart from what it is handed: no DOM.
*/
import { GHOST_COLUMNS, GHOST_RATE_HZ, parseGhost, writeGhost } from "../../vendor/openphotex/mtm/ghost.js";
import { eulerToMatrix } from "../../vendor/openphotex/sim/mtm2/index.js";
import { msg } from "../strings.js";
import { hasCheckpoints } from "./track-kinds.js";

/** The laps a session is given: it runs until the player ends it from the pause menu. */
export const TIME_ATTACK_LAPS = 99;

export const TIME_ATTACK_EXTENSION = Object.freeze({
  id: "time-attack",
  name: msg("Time attack"),
  description: msg("Hot laps alone on a circuit or a rally against the ghost of your best lap. Each checkpoint shows the gap to the ghost; a faster lap becomes the new ghost. End the session from the pause menu: your best lap goes to the Hall of Fame."),
  // No length to choose: the laps run on until End Race.
  length: null,
  fixedLaps: TIME_ATTACK_LAPS,
  settings: Object.freeze([]),
  acceptsTrack: hasCheckpoints,
  trackLocked: false,
  keepsRace: true,
  maxEntrants: 1,
  // The player alone: no name over the truck unless the Names key asks for it.
  names: false,
  weather: null,
  detailLevel: null,
});

const STEP_S = 1 / GHOST_RATE_HZ;

/** A pose's 29 ghost numbers at `t` seconds into the lap (OpenMTM2's frame; see the header). */
export function ghostRow(t, pose) {
  const a = pose.axles ?? [{ articulation: 0, travel: 0 }, { articulation: 0, travel: 0 }];
  const tires = pose.tires ?? [];
  const travel = (i) => a[i < 2 ? 0 : 1]?.travel ?? 0;
  return [
    t, ...pose.pos.slice(0, 3), ...pose.euler.slice(0, 3),
    0, a[0]?.travel ?? 0, 0, 0, a[1]?.travel ?? 0, 0,
    a[0]?.articulation ?? 0, a[1]?.articulation ?? 0, pose.steer ?? 0, pose.rearSteer ?? 0,
    travel(0), travel(1), travel(2), travel(3),
    ...[0, 1, 2, 3].map((i) => tires[i]?.angle ?? 0),
    0, 0, 0, 0,
  ];
}

/** The pose a ghost shows at `t` seconds into its lap (interpolated between its samples), or null past its end. */
export function ghostPoseAt(ghost, t) {
  const s = ghost.samples, n = s.length / GHOST_COLUMNS;
  if (!(n >= 2) || t < s[0] || t > s[(n - 1) * GHOST_COLUMNS]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid * GHOST_COLUMNS] <= t) lo = mid; else hi = mid; }
  const a = lo * GHOST_COLUMNS, b = hi * GHOST_COLUMNS;
  const span = s[b] - s[a], f = span > 0 ? (t - s[a]) / span : 0;
  const v = (c) => s[a + c] + (s[b + c] - s[a + c]) * f;
  // Angles take the short way round between samples.
  const ang = (c) => { let d = s[b + c] - s[a + c]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return s[a + c] + d * f; };
  const euler = [ang(4), ang(5), ang(6)];
  return {
    pos: [v(1), v(2), v(3)], euler, matrix: eulerToMatrix(euler[0], euler[1], euler[2], new Array(9)),
    axles: [{ articulation: v(13), travel: v(8) }, { articulation: v(14), travel: v(11) }],
    steer: v(15), rearSteer: v(16),
    tires: [21, 22, 23, 24].map((c) => ({ angle: ang(c), onGround: true })),
  };
}

/**
 * A Time Attack session. `ghost` the stored best (OpenPhotex's `Ghost`) or null; `names` for the file written:
 * `{ track, trackName, truck, truckName, driver }`. `frame(time, pose, rt)` each frame with the simulation's time, the
 * player's pose and race row (`laps`, `lapTime` this lap so far, `lapTimes`, `checkpoint`); it returns what happened:
 * `{ split: { index, gap } }` at a checkpoint (gap in seconds, negative ahead of the ghost), `{ lap: { time, best } }`
 * when a lap closes (`best` when it beat the ghost, which it then replaces).
 */
export function createTimeAttack({ ghost = null, names }) {
  let best = ghost;
  let rows = [], lastSample = -Infinity, laps = 0, checkpoint = 0, splits = [];
  const banked = [];
  const reset = () => { rows = []; lastSample = -Infinity; splits = []; };
  return {
    get ghost() { return best; },
    /** Every lap closed, seconds: what End Race banks. */
    get laps() { return banked.slice(); },
    frame(time, pose, rt) {
      if (!rt || !pose) return null;
      let event = null;
      const lapTime = rt.lapTime ?? 0;
      if (rt.laps > laps) {
        // A lap closed: its time, and the ghost if it beats the best.
        laps = rt.laps;
        const time = rt.lastLap ?? rt.lapTimes?.[rt.lapTimes.length - 1] ?? 0;
        if (time > 0) {
          banked.push(time);
          rows.push(ghostRow(time, pose));
          const faster = !best || time < best.lapTime;
          if (faster && rows.length >= 2) {
            best = { ...names, lapTime: time, splits: splits.slice(0, 100), samples: Float64Array.from(rows.flat()) };
          }
          event = { lap: { time, best: faster } };
        }
        reset();
        checkpoint = rt.checkpoint ?? 0;
        return event;
      }
      if ((rt.checkpoint ?? 0) !== checkpoint) {
        checkpoint = rt.checkpoint ?? 0;
        if (checkpoint > 0) {
          splits.push(lapTime);
          const k = splits.length - 1, theirs = best?.splits?.[k];
          if (Number.isFinite(theirs)) event = { split: { index: k, gap: lapTime - theirs } };
        }
      }
      if (lapTime - lastSample >= STEP_S - 1e-6 && lapTime >= (rows.length ? rows[rows.length - 1][0] : -Infinity)) {
        lastSample = lapTime;
        if (rows.length < 200000) rows.push(ghostRow(lapTime, pose));
      }
      return event;
    },
    /** The ghost's pose for the player's current lap time, or null. */
    ghostPose(lapTime) {
      return best ? ghostPoseAt(best, lapTime) : null;
    },
  };
}

/** A ghost as its `.gst` text (OpenPhotex `writeGhost`), or null when it cannot be written. */
export function ghostText(ghost) {
  try {
    return ghost ? writeGhost(ghost) : null;
  } catch {
    return null;
  }
}

/** A ghost read back from its text, or null for a damaged one. */
export function ghostFromText(text) {
  try {
    return text ? parseGhost(text) : null;
  } catch {
    return null;
  }
}
