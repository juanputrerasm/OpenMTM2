/*
  The newer extension modes (docs/EXTENSIONS.md): Soccer's pitch and goals, Cops & Robbers' captures,
  Race & Rumble's teams and places, and the race adapter they all share. Pure rules only.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { hockeySpot, hockeyStep, createHockey, toLocal } from "../src/game/extensions/hockey.js";
import { BALL_WALL_HEIGHT_FT, PITCH_HALF_WIDTH_FT, isSoccerTrack, soccerPitch } from "../src/game/extensions/soccer.js";
import {
  CAPTURE_POINTS, ESCAPE_FT, GRACE_S, STUCK_S, cnrHeld, cnrHeliAllowed, cnrPlaces, cnrStep, createCnr, escapeSpot, offWheels,
} from "../src/game/extensions/cops-robbers.js";
import { BLOCKER, RACER, blockTarget, racerHome, rnrPlaces, rnrTeamPlaces, rnrTeams, rnrWinner } from "../src/game/extensions/race-rumble.js";
import { extensionFinderTarget, extensionMapMarks, extensionNetFromWire, extensionNetToWire } from "../src/game/extensions/race-loader.js";
import { teamsOf, twoTeams } from "../src/game/extensions/teams.js";

/** Highlands Rally's ball and goal posts as CASTLE.SIT places them (MTM1 GAME.POD). */
const CASTLE = [
  { modelName: "SOCCER.BIN", type: 4, positionFt: [4419.6, 263, 4991.5], sitIndex: 10, bounds: { min: [-6, -6, -6], max: [6, 6, 6] } },
  { modelName: "GOALTEST.BIN", type: 0, positionFt: [4437.3, 266, 5114.4], sitIndex: 11, bounds: { min: [-3, -12, -3], max: [3, 12, 3] } },
  { modelName: "GOALTEST.BIN", type: 0, positionFt: [4397.7, 266, 5114.4], sitIndex: 12, bounds: { min: [-3, -12, -3], max: [3, 12, 3] } },
  { modelName: "GOALTEST.BIN", type: 0, positionFt: [4398.7, 266, 4868.3], sitIndex: 13, bounds: { min: [-3, -12, -3], max: [3, 12, 3] } },
  { modelName: "GOALTEST.BIN", type: 0, positionFt: [4438.4, 266, 4868.3], sitIndex: 14, bounds: { min: [-3, -12, -3], max: [3, 12, 3] } },
];
const pitchGround = () => 262;

test("Soccer runs only on Monster Truck Madness's Highlands Rally", () => {
  assert.ok(isSoccerTrack({ file: "CASTLE.SIT", game: "MTM1" }));
  assert.ok(!isSoccerTrack({ file: "CASTLE.SIT", game: "MTM2" }));
  assert.ok(!isSoccerTrack({ file: "ROCKQRY.SIT", game: "MTM2" }));
});

test("the pitch is read from the ball and the four posts: two goals along z, the ball at the centre", () => {
  const pitch = soccerPitch(CASTLE, pitchGround);
  assert.ok(pitch);
  assert.ok(Math.abs(pitch.centre[0] - 4418) < 1 && Math.abs(pitch.centre[1] - 4991.35) < 1);
  const [g0, g1] = pitch.goals;
  assert.ok(g0.pos[1] < g1.pos[1], "goal 0 is the one at the lower z");
  assert.ok(Math.abs(g1.along - g0.along - 246.1) < 0.5, "the goal lines are 246 ft apart");
  assert.ok(g0.mouth[1] - g0.mouth[0] > 30 && g0.mouth[1] - g0.mouth[0] < 40, "the mouth is the gap between the posts' inner faces");
  assert.equal(g0.top, 278);
  assert.deepEqual([...g0.tint].sort(), [13, 14]);
  assert.equal(pitch.puck.sitIndex, 10);
  assert.equal(pitch.iceFt, 262);
  assert.equal(pitch.extent.maxB, PITCH_HALF_WIDTH_FT);
  assert.equal(pitch.boards.length, 0, "the trucks are free to leave the pitch");
  assert.equal(pitch.ballWalls.length, 2 + 2 * 5, "two touchlines, and each goal line in two parts with a three-sided net");
  assert.ok(pitch.ballWalls.every((w) => w.size[1] >= BALL_WALL_HEIGHT_FT));
  assert.equal(soccerPitch(CASTLE.slice(0, 3), pitchGround), null, "without its four posts there is no pitch");
});

test("a goal between the posts scores; over the bar it is out at once and the ball comes back", () => {
  const pitch = soccerPitch(CASTLE, pitchGround);
  const game = createHockey(pitch, [0, 1], 3);
  const g1 = pitch.goals[1];
  const at = (a, b, y = 266) => {
    const { u, v, centre } = pitch.frame;
    return [centre[0] + u[0] * a + v[0] * b, y, centre[1] + u[1] * a + v[1] * b];
  };
  const mid = (g1.mouth[0] + g1.mouth[1]) / 2;
  game.lastTouch = 0;
  hockeyStep(game, at(g1.along - 20, mid), 0.02);
  hockeyStep(game, at(g1.along + 8, mid), 0.02);
  assert.deepEqual(game.score, [1, 0], "team 0 scores in goal 1");
  const over = createHockey(pitch, [0, 1], 3);
  hockeyStep(over, at(g1.along - 20, mid, 300), 0.02);
  assert.equal(hockeyStep(over, at(g1.along + 12, mid, 300), 0.02), "reset", "over the bar is out of play");
  assert.equal(over.event.kind, "out");
  const spot = hockeySpot(pitch, [0, 1], 1);
  assert.ok(toLocal(pitch.frame, spot.pos[0], spot.pos[2]).a > 0, "team 1 kicks off on its own half");
});

test("Cops & Robbers: a capture needs the robber off its wheels or stuck, and a cop's touch", () => {
  const g = createCnr(3, () => 0.5);
  assert.equal(g.robber, 1);
  assert.ok(cnrHeld(g, 0, 1) && !cnrHeld(g, 1, 1), "the cops wait at the start, the robber gets away");
  const upright = { up: 1, speed: 40 };
  assert.equal(cnrStep(g, 6, 1, [[0, 1]], upright), null, "a robber driving away is not captured by a touch");
  assert.ok(offWheels(0.2) && !offWheels(0.9));
  const capture = cnrStep(g, 7, 0.1, [[1, 2]], { up: 0.1, speed: 0 });
  assert.deepEqual(capture, { kind: "capture", by: 2 });
  assert.equal(g.points[2], CAPTURE_POINTS);
  assert.equal(cnrStep(g, 7 + GRACE_S - 0.5, 0.1, [[0, 1]], { up: 0.1, speed: 0 }), null, "safe for a while after a capture");
  // Stuck: slow for STUCK_S.
  const h = createCnr(2, () => 0);
  for (let t = 6; t < 6 + STUCK_S + 0.05; t += 0.1) cnrStep(h, t, 0.1, [], { up: 1, speed: 1 });
  assert.deepEqual(cnrStep(h, 10, 0.1, [[1, 0]], { up: 1, speed: 1 }), { kind: "capture", by: 1 });
  assert.deepEqual(cnrPlaces(g), [2, 3, 1].map((_, i) => cnrPlaces(g)[i]));
  assert.equal(cnrPlaces(g)[2], 1);
});

test("Cops & Robbers: the robber scores its free seconds, calls the helicopter only from deep water, and escapes far", () => {
  const g = createCnr(2, () => 0);
  cnrStep(g, 5, 3, [], { up: 1, speed: 50 });
  assert.equal(g.points[0], 3);
  assert.ok(cnrHeliAllowed(g, 1, false), "a cop may always call it");
  assert.ok(!cnrHeliAllowed(g, 0, false) && cnrHeliAllowed(g, 0, true));
  const far = escapeSpot([[0, 0, 0], [500, 0, 0], [900, 0, 0]], [[100, 0, 0]]);
  assert.deepEqual(far, [500, 0, 0], "the first place at least ESCAPE_FT from every cop");
  assert.ok(ESCAPE_FT === 400);
  assert.deepEqual(escapeSpot([[0, 0, 0], [200, 0, 0]], [[50, 0, 0]]), [200, 0, 0], "else the farthest");
});

test("Race & Rumble: two sides, Racers and Blockers; the first racer home ends it and wins for the Racers", () => {
  const { teams, roles } = rnrTeams(6);
  assert.deepEqual(roles, [RACER, BLOCKER, RACER, BLOCKER, RACER, BLOCKER]);
  assert.deepEqual(teams, roles, "the side is the role");
  assert.deepEqual(rnrTeams(5, true).roles, [BLOCKER, RACER, BLOCKER, RACER, BLOCKER], "the player may block");
  const trucks = [
    { finished: false, raceTime: 0, place: 2 }, { finished: false, raceTime: 0, place: 1 },
    { finished: false, raceTime: 0, place: 3 }, { finished: false, raceTime: 0, place: 4 },
    { finished: false, raceTime: 0, place: 6 }, { finished: false, raceTime: 0, place: 5 },
  ];
  assert.ok(!racerHome(roles, trucks), "a blocker ahead on laps ends nothing");
  assert.equal(rnrWinner(roles, trucks), BLOCKER, "left early with no racer home: the Blockers'");
  trucks[2].finished = true; trucks[2].raceTime = 290;
  assert.ok(racerHome(roles, trucks), "one racer home is enough; the blockers need not finish");
  assert.equal(rnrWinner(roles, trucks), RACER);
  const places = rnrPlaces(teams, roles, trucks);
  assert.deepEqual(places, [2, 4, 1, 5, 3, 6], "the Racers first, the one home ahead, then the Blockers by race place");
  assert.deepEqual([...rnrTeamPlaces(teams, places)], [[RACER, 1], [BLOCKER, 2]]);
  const target = blockTarget(BLOCKER, [0, 0, 0], [{ index: 2, team: RACER, pos: [50, 0, 0], finished: false }, { index: 0, team: RACER, pos: [500, 0, 0], finished: false }]);
  assert.equal(target.index, 2, "a blocker goes for the nearest racer");
});

test("teams: two sides alternate from the player's; fixed teams in entry order", () => {
  assert.deepEqual(twoTeams(5, () => 0.2), [0, 1, 0, 1, 0]);
  assert.deepEqual(teamsOf(9, 2, 4), { teams: [0, 0, 1, 1, 2, 2, 3, 3, 3], slots: [0, 1, 0, 1, 0, 1, 0, 1, 2] });
});

test("the race adapter: finder targets, map marks and the network state", () => {
  const positions = [[0, 0, 0], [100, 0, 0], [300, 0, 0]];
  const tag = { mode: "tag", it: 1, safe: -1 };
  assert.deepEqual(extensionFinderTarget(tag, 0, positions), [100, 0, 0], "a free truck's finder points at It");
  assert.deepEqual(extensionFinderTarget(tag, 1, positions), [0, 0, 0], "It's finder at the nearest truck");
  assert.equal(extensionMapMarks(tag, 3)[1].marker, "arrow");
  assert.equal(extensionFinderTarget({ mode: "soccer", ball: [5, 6, 7] }, 0, positions)[2], 7);
  const rnr = { mode: "race-rumble", teams: [0, 0, 1, 1], roles: [RACER, BLOCKER, RACER, BLOCKER] };
  assert.equal(extensionFinderTarget(rnr, 0, positions), undefined, "a racer keeps the checkpoints");
  const cnr = { robber: 2, points: [60, 0, 9], captures: [1, 0, 0], safeUntil: 12, events: 1, resets: 1, spot: { pos: [1, 2, 3], heading: 0 }, event: { kind: "capture", by: 0 }, over: false };
  const vehicleOf = (i) => i + 1, localOf = (v) => v - 1;
  const back = extensionNetFromWire("cops-robbers", extensionNetToWire("cops-robbers", cnr, vehicleOf), localOf, 3);
  assert.equal(back.robber, 2);
  assert.deepEqual(back.points, [60, 0, 9]);
  assert.deepEqual(back.spot.pos, [1, 2, 3]);
});
