/*
  Soccer (docs/EXTENSIONS.md): two teams of trucks and the ball on the pitch of Highlands Rally
  (Monster Truck Madness's CASTLE.SIT), first to a number of goals. An addition; the level has the
  ball (SOCCER.BIN) and four goal posts (GOALTEST.BIN) but no game on them.

  The pitch is read from the level (`soccerPitch`) in the shape Hockey's rink has (hockey.js), so
  Hockey's rules play it: goals, face-offs, places, the computer trucks and the Helicopter key. What
  differs: the trucks may leave the pitch, the ball may not (walls only the ball meets, with a net
  behind each goal), the ground keeps its own grip, and a ball over the goal line outside a goal is out
  at once. Positions are game feet; the pitch's frame is `a` from goal 0 to goal 1 and `b` across.
  Pure, so it runs under Node.
*/
import { msg } from "../strings.js";
import { toWorld } from "./hockey.js";

export const SOCCER_TRACK = "CASTLE.SIT";
/** Whether `track` (a catalogue entry) can host Soccer: Monster Truck Madness's Highlands Rally. */
export function isSoccerTrack(track) {
  return !!track && String(track.file ?? "").toUpperCase() === SOCCER_TRACK && track.game === "MTM1";
}
export const DEFAULT_SOCCER_GOALS = 3;
export const BALL_MODEL = "SOCCER.BIN";
export const POST_MODEL = "GOALTEST.BIN";
/** Half the pitch's width, feet: the level marks no touchlines, so this is a pitch about as wide as two thirds of its length. */
export const PITCH_HALF_WIDTH_FT = 80;
/** The walls that keep the ball on the pitch: their height and thickness, and the net's depth behind a goal, feet. */
export const BALL_WALL_HEIGHT_FT = 60;
export const BALL_WALL_THICK_FT = 2;
export const NET_DEPTH_FT = 14;
const POST_HALF_FT = 2;
/** Seconds the ball may hang still off the ground before it is called out. */
export const SOCCER_STUCK_S = 2;
const BALL_LIFT_FT = 0.3;

/**
 * How the computer trucks play on the pitch (hockey.js `hockeyAim`): on grass a truck turns and stops where it is
 * steered, so it stands closer behind the ball, drives through it from closer, and every truck the ball comes near plays
 * it. Distances are for the 246 x 160 ft pitch.
 */
export const SOCCER_TUNE = Object.freeze({
  standFt: 10, backPerMissFt: 25, defendFt: 45, wingBackFt: 45, wingWideFt: 35, carrySpeed: 45, directFt: 35, chaseFt: 45,
});
/** How the computer trucks drive on the pitch (game/rumble-ai.js `driveToPoint`): the grass's turn floor, backing up, and
 *  breaking out of circling round the ball. */
export const SOCCER_DRIVE = Object.freeze({ back: true, turnFloor: 0.35, orbitBreak: true });

export const SOCCER_EXTENSION = Object.freeze({
  id: "soccer",
  name: msg("Soccer"),
  description: msg("Two teams play for goals with the ball on Highlands Rally's pitch."),
  length: Object.freeze({ key: "goals", label: msg("Goals"), default: DEFAULT_SOCCER_GOALS, min: 1, max: 99 }),
  settings: Object.freeze([
    Object.freeze({ key: "goals", label: msg("Goals to win"), type: "number", min: 1, max: 99, default: DEFAULT_SOCCER_GOALS }),
  ]),
  acceptsTrack: isSoccerTrack,
  trackLocked: true,
  minEntrants: 2,
  weather: null,
  detailLevel: null,
});

const hyp = (x, z) => Math.hypot(x, z);

/**
 * The pitch from the level's collision boxes (`{ modelName, type, positionFt, bounds, sitIndex, psi }`,
 * worker/track-build.js `sim.boxes`) and the ground's height `groundAt(x, z)`, in Hockey's rink shape
 * plus `ballWalls` (`{ pos, size, psi }`, walls only the ball meets) and `outPast`. Null without the
 * ball and two pairs of posts.
 */
export function soccerPitch(boxes, groundAt) {
  const ballBox = boxes.find((b) => b.modelName === BALL_MODEL && b.positionFt);
  const posts = boxes.filter((b) => b.modelName === POST_MODEL && b.positionFt);
  if (!ballBox || posts.length !== 4) return null;
  // The goals: each post with the post nearest it.
  const [p0, ...rest] = posts;
  rest.sort((p, q) => hyp(p.positionFt[0] - p0.positionFt[0], p.positionFt[2] - p0.positionFt[2]) - hyp(q.positionFt[0] - p0.positionFt[0], q.positionFt[2] - p0.positionFt[2]));
  const pairs = [[p0, rest[0]], [rest[1], rest[2]]];
  const mid = (pair) => [(pair[0].positionFt[0] + pair[1].positionFt[0]) / 2, (pair[0].positionFt[2] + pair[1].positionFt[2]) / 2];
  // Goal 0 (team 0's, the red one) is the one at the lower z.
  pairs.sort((p, q) => mid(p)[1] - mid(q)[1]);
  const [g0, g1] = pairs.map(mid);
  const length = hyp(g1[0] - g0[0], g1[1] - g0[1]);
  if (!(length > 0)) return null;
  const centre = [(g0[0] + g1[0]) / 2, (g0[1] + g1[1]) / 2];
  const u = [(g1[0] - g0[0]) / length, (g1[1] - g0[1]) / length];
  const v = [-u[1], u[0]];
  const frame = { centre, u, v };
  const local = (x, z) => {
    const dx = x - centre[0], dz = z - centre[1];
    return { a: dx * u[0] + dz * u[1], b: dx * v[0] + dz * v[1] };
  };
  const groundFt = groundAt(centre[0], centre[1]);
  const goals = pairs.map((pair, team) => {
    const half = (box) => (box.bounds ? Math.min(box.bounds.max[0] - box.bounds.min[0], box.bounds.max[2] - box.bounds.min[2]) / 2 : POST_HALF_FT);
    const at = pair.map((box) => local(box.positionFt[0], box.positionFt[2]));
    const [lo, hi] = at[0].b < at[1].b ? [0, 1] : [1, 0];
    const top = Math.max(...pair.map((box) => box.positionFt[1] + (box.bounds?.max[1] ?? 20)));
    return {
      team, along: (at[0].a + at[1].a) / 2, out: team === 0 ? -1 : 1,
      mouth: [at[lo].b + half(pair[lo]), at[hi].b - half(pair[hi])],
      top, pos: mid(pair), sitIndex: pair[0].sitIndex, tint: pair.map((box) => box.sitIndex),
    };
  });
  const extent = { minA: goals[0].along, maxA: goals[1].along, minB: -PITCH_HALF_WIDTH_FT, maxB: PITCH_HALF_WIDTH_FT };

  const bounds = ballBox.bounds ?? { min: [-4, -4, -4], max: [4, 4, 4] };
  const ballHalf = [(bounds.max[0] - bounds.min[0]) / 2, (bounds.max[1] - bounds.min[1]) / 2, (bounds.max[2] - bounds.min[2]) / 2];
  const radius = Math.max(ballHalf[0], ballHalf[2]);
  return {
    frame, centre, iceFt: groundFt, goals, extent, boards: [],
    ballWalls: ballWalls(frame, extent, goals, groundFt),
    // Out just over a goal line outside the goal or over a touchline (the walls stand there), or hanging still in the
    // air for SOCCER_STUCK_S (caught on a wall): a face-off at the centre either way.
    outPast: radius + 4, sideOutPast: radius + 4, stuckS: SOCCER_STUCK_S,
    puck: {
      sitIndex: ballBox.sitIndex, radius, psi: ballBox.psi ?? 0,
      start: [centre[0], groundFt + ballHalf[1] + BALL_LIFT_FT, centre[1]],
    },
  };
}

/**
 * The walls that keep the ball on the pitch: the touchlines, the goal lines either side of each goal,
 * and a net behind each goal (its back and its two sides). Each is a wall as the simulation takes it
 * (`{ pos, size, psi, from, to }`), its inner face on the line.
 */
export function ballWalls(frame, extent, goals, groundFt) {
  const { minA, maxA, minB, maxB } = extent;
  const segments = [
    [[minA, minB], [maxA, minB]], [[maxA, maxB], [minA, maxB]],
  ];
  for (const g of goals) {
    const line = g.along, back = g.along + g.out * NET_DEPTH_FT;
    segments.push([[line, minB], [line, g.mouth[0]]], [[line, g.mouth[1]], [line, maxB]]);
    segments.push([[line, g.mouth[0]], [back, g.mouth[0]]], [[back, g.mouth[0]], [back, g.mouth[1]]], [[back, g.mouth[1]], [line, g.mouth[1]]]);
  }
  return segments.filter(([p, q]) => hyp(q[0] - p[0], q[1] - p[1]) > 0.5).map(([p, q]) => wall(frame, p, q, groundFt));
}

function wall(frame, p, q, groundFt) {
  const [x0, z0] = toWorld(frame, p[0], p[1]), [x1, z1] = toWorld(frame, q[0], q[1]);
  const length = hyp(x1 - x0, z1 - z0);
  const dir = [(x1 - x0) / length, (z1 - z0) / length];
  return {
    from: [x0, z0], to: [x1, z1],
    pos: [(x0 + x1) / 2, groundFt + BALL_WALL_HEIGHT_FT / 2 - 4, (z0 + z1) / 2],
    size: [BALL_WALL_THICK_FT, BALL_WALL_HEIGHT_FT + 8, length + BALL_WALL_THICK_FT],
    psi: Math.atan2(dir[0], dir[1]),
  };
}

/** The boxes `soccerPitch` reads, from a track build (worker/track-build.js). */
export function pitchBoxes(build) {
  return build.sim?.boxes ?? [];
}
