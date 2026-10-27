/*
  The newer extension modes (docs/EXTENSIONS.md): Soccer's pitch and goals, Cops & Robbers' captures,
  Race & Rumble's teams and places, and the race adapter they all share. Pure rules only.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { hockeySpot, hockeyStep, hockeyTimeLeft, hockeyWinner, createHockey, toLocal } from "../src/game/extensions/hockey.js";
import { BALL_WALL_HEIGHT_FT, PITCH_HALF_WIDTH_FT, isSoccerTrack, soccerPitch } from "../src/game/extensions/soccer.js";
import {
  COP_COLOUR, ROBBER_COLOUR, CAPTURE_POINTS, ESCAPE_FT, GRACE_S, STUCK_S, cnrHeld, cnrHeliAllowed, cnrPlaces, cnrStep, createCnr, escapeSpot, offWheels,
} from "../src/game/extensions/cops-robbers.js";
import {
  BLOCKER, CHASE_BUST_FT, CHASE_COOLDOWN_S, RACER, RNR_CHASE, RNR_CLASSIC, RNR_TIMED, blockTarget, blockerTarget, chaseBust, createChase,
  racerHome, rnrPlaces, rnrTeamPlaces, rnrTeams, rnrWinner,
} from "../src/game/extensions/race-rumble.js";
import {
  extensionFinderTarget, extensionMapMarks, extensionMarkerTarget, extensionNetFromWire, extensionNetToWire, extensionTruckLabels,
  extensionTruckMarks, prepareExtensionRace,
} from "../src/game/extensions/race-loader.js";
import {
  TAG64_BONUS, TAG64_COOLDOWN_S, TAG_MTM64, createTag, tag64Outside, tag64Rate, tagHeld, tagScoring, tagShadowBand, tagStep,
} from "../src/game/extensions/tag.js";
import { PLAYER_PICK, entrantTeamPicks, extensionById, setTeamPick, teamPickerFor } from "../src/game/extensions/loader.js";
import { pickedTeams, teamsOf, twoTeams } from "../src/game/extensions/teams.js";
import { fillGrid } from "../src/game/race-setup.js";

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

test("Race & Rumble, timed block: two sides, Racers and Blockers; the first racer home wins for the Racers, else the Blockers", () => {
  const { teams, roles } = rnrTeams(6, false, { variant: RNR_TIMED });
  assert.deepEqual(roles, [RACER, BLOCKER, RACER, BLOCKER, RACER, BLOCKER]);
  assert.deepEqual(teams, roles, "the side is the role");
  assert.deepEqual(rnrTeams(5, true, { variant: RNR_TIMED }).roles, [BLOCKER, RACER, BLOCKER, RACER, BLOCKER], "the player may block");
  assert.deepEqual(rnrTeams(4, false, { variant: RNR_TIMED, picks: [null, { role: RACER }, null, null] }).roles, [RACER, RACER, BLOCKER, BLOCKER],
    "picked sides kept, the others even them out");
  const trucks = [
    { finished: false, raceTime: 0, place: 2 }, { finished: false, raceTime: 0, place: 1 },
    { finished: false, raceTime: 0, place: 3 }, { finished: false, raceTime: 0, place: 4 },
    { finished: false, raceTime: 0, place: 6 }, { finished: false, raceTime: 0, place: 5 },
  ];
  assert.ok(!racerHome(roles, trucks), "a blocker ahead on laps ends nothing");
  assert.equal(rnrWinner(roles, trucks, teams, RNR_TIMED), BLOCKER, "the time up with no racer home: the Blockers'");
  trucks[2].finished = true; trucks[2].raceTime = 290;
  assert.ok(racerHome(roles, trucks), "one racer home is enough; the blockers need not finish");
  assert.equal(rnrWinner(roles, trucks, teams, RNR_TIMED), RACER);
  const places = rnrPlaces(teams, roles, trucks, RNR_TIMED);
  assert.deepEqual(places, [2, 4, 1, 5, 3, 6], "the Racers first, the one home ahead, then the Blockers by race place");
  assert.deepEqual([...rnrTeamPlaces(teams, places)], [[RACER, 1], [BLOCKER, 2]]);
  const target = blockTarget(BLOCKER, [0, 0, 0], [{ index: 2, team: RACER, pos: [50, 0, 0], finished: false }, { index: 0, team: RACER, pos: [500, 0, 0], finished: false }]);
  assert.equal(target.index, 2, "a blocker goes for the nearest racer");
});

test("Race & Rumble, classic: teams of a racer and a blocker; the first racer home wins it for its team", () => {
  const { teams, roles } = rnrTeams(6, false, { variant: RNR_CLASSIC });
  assert.deepEqual(teams, [0, 1, 2, 0, 1, 2], "three teams of two");
  assert.deepEqual(roles, [RACER, RACER, RACER, BLOCKER, BLOCKER, BLOCKER], "each with its racer and its blocker");
  const picked = rnrTeams(4, false, { picks: [{ team: 1, role: BLOCKER }, { team: 1, role: RACER }, null, null] });
  assert.deepEqual(picked, { teams: [1, 1, 0, 0], roles: [BLOCKER, RACER, RACER, BLOCKER] }, "the dialog's picks kept, the rest filled in");
  assert.equal(rnrTeams(8, false).teams.filter((t) => t === 3).length, 2, "eight trucks: four teams");
  const trucks = [
    { finished: false, place: 3 }, { finished: true, raceTime: 300, place: 1 }, { finished: false, place: 2 },
    { finished: false, place: 4 }, { finished: false, place: 6 }, { finished: false, place: 5 },
  ];
  assert.equal(rnrWinner(roles, trucks, teams, RNR_CLASSIC), 1, "truck 1's team: its racer home first");
  assert.deepEqual(rnrPlaces(teams, roles, trucks, RNR_CLASSIC), [5, 1, 3, 6, 2, 4], "the winning team first, then by each team's racer, racer ahead of blocker");
  // A blocker goes for the other teams' racer, unless an enemy blocker is on its own racer and nearer.
  const field = [
    { index: 0, team: 0, role: RACER, pos: [0, 0, 0], vel: [0, 0, 0], finished: false },
    { index: 1, team: 1, role: RACER, pos: [400, 0, 0], vel: [0, 0, 0], finished: false },
    { index: 2, team: 0, role: BLOCKER, pos: [100, 0, 0], vel: [0, 0, 0], finished: false },
    { index: 3, team: 1, role: BLOCKER, pos: [40, 0, 0], vel: [0, 0, 0], finished: false },
  ];
  assert.equal(blockerTarget(2, field).index, 3, "the enemy blocker on its racer, and nearer: fight it");
  field[3].pos = [1000, 0, 0];
  assert.equal(blockerTarget(2, field).index, 1, "no threat: block the other racer");
  assert.equal(blockerTarget(3, field).index, 0, "the other team's blocker goes for team 0's racer");
});

test("Race & Rumble's labels say who races and who blocks; the race takes the dialog's picks", () => {
  const entrants = [{ name: "You", file: "A", player: true }, { name: "Mark", file: "B" }, { name: "Greg", file: "C" }, { name: "Rich", file: "D" }];
  const extension = extensionById("race-rumble");
  const race = prepareExtensionRace(extension, { entrants, length: 3, settings: { variant: "classic" }, picks: [{ team: 0, role: BLOCKER }, null, null, null] });
  assert.equal(race.simulation.roles[0], BLOCKER);
  assert.equal(race.simulation.variant, "classic");
  const labels = extensionTruckLabels(race.dress, entrants, (entrant) => entrant.name);
  assert.deepEqual(labels[0], ["You", "Blocker"]);
  assert.deepEqual(labels.map((label) => label[1]).sort(), ["Blocker", "Blocker", "Racer", "Racer"]);
  const timed = prepareExtensionRace(extension, { entrants, length: 3, settings: { variant: "timed", minutes: 4 } });
  assert.equal(timed.simulation.minutes, 4);
  assert.deepEqual(timed.simulation.teams, timed.simulation.roles);
});

test("the Computer Opponents dialog's picks: what each team mode asks, kept by player and truck file", () => {
  assert.equal(teamPickerFor({}, "tag"), null, "Tag has no teams");
  assert.equal(teamPickerFor({}, "hockey").teams, 2);
  assert.deepEqual([teamPickerFor({}, "race-rumble").teams, teamPickerFor({}, "race-rumble").roles.length], [4, 2], "classic: a team and a role");
  const timed = teamPickerFor({ extensions: { "race-rumble": { variant: "timed" } } }, "race-rumble");
  assert.deepEqual([timed.teams, timed.roles.length], [0, 2], "timed block: the side alone");
  const settings = {};
  setTeamPick(settings, "hockey", PLAYER_PICK, { team: 1 });
  setTeamPick(settings, "hockey", "B", { team: 7 });
  const picks = entrantTeamPicks(settings, "hockey", [{ file: "A", player: true }, { file: "B" }, { file: "C" }]);
  assert.deepEqual(picks, [{ team: 1 }, null, null], "a team out of range is not a pick");
  assert.deepEqual(pickedTeams(4, [1, null, null, null], 2), [1, 0, 0, 1], "the rest even the teams out");
  assert.deepEqual(pickedTeams(3, [null, null, null], 2, () => 0.9), twoTeams(3, () => 0.9), "no picks: the random split");
});

test("Hockey and Soccer: when the time runs out the side ahead wins; tied, sudden death, the next goal wins", () => {
  const pitch = soccerPitch(CASTLE, pitchGround);
  const at = (a, b, y = 266) => {
    const { u, v, centre } = pitch.frame;
    return [centre[0] + u[0] * a + v[0] * b, y, centre[1] + u[1] * a + v[1] * b];
  };
  const centre = at(0, 0);
  const ahead = createHockey(pitch, [0, 1], 5, { minutes: 1 });
  assert.equal(hockeyTimeLeft(ahead), 60);
  ahead.score = [1, 0];
  assert.equal(hockeyStep(ahead, centre, 59), null);
  assert.equal(hockeyStep(ahead, centre, 1), "over", "time: the side ahead wins");
  assert.equal(hockeyWinner(ahead), 0);
  const tied = createHockey(pitch, [0, 1], 5, { minutes: 1 });
  hockeyStep(tied, centre, 60);
  assert.ok(tied.suddenDeath && tied.phase !== "over", "time, level: sudden death");
  assert.equal(tied.event.kind, "sudden");
  hockeyStep(tied, centre, 30);
  assert.ok(tied.phase !== "over", "sudden death has no clock");
  const g1 = pitch.goals[1], mid = (g1.mouth[0] + g1.mouth[1]) / 2;
  tied.lastTouch = 0;
  hockeyStep(tied, at(g1.along - 20, mid), 0.02);
  hockeyStep(tied, at(g1.along + 8, mid), 0.02);
  assert.deepEqual(tied.score, [1, 0]);
  assert.equal(hockeyStep(tied, centre, 3), "over", "the goal in sudden death ends it after the celebration");
  const draw = createHockey(pitch, [0, 1], 5, { minutes: 1, suddenDeath: false });
  assert.equal(hockeyStep(draw, centre, 60), "over", "sudden death off: a draw");
  assert.equal(hockeyWinner(draw), -1);
  const untimed = createHockey(pitch, [0, 1], 5);
  assert.equal(hockeyTimeLeft(untimed), null);
  assert.equal(hockeyStep(untimed, centre, 6000), null, "no limit: first to the goals");
});

test("a party mode on a track with too few start slots gets a grid round the first", () => {
  const grid = fillGrid([{ file: "", pos: [100, 16, 100], heading: 0 }], 6, () => 10);
  assert.equal(grid.length, 6);
  assert.ok(grid.every((slot) => slot.pos[1] === 16 && slot.heading === 0), "riding as high as the first, facing its way");
  for (let i = 0; i < grid.length; i++) for (let j = i + 1; j < grid.length; j++) {
    assert.ok(Math.hypot(grid[i].pos[0] - grid[j].pos[0], grid[i].pos[2] - grid[j].pos[2]) >= 20, "no two slots on each other");
  }
  assert.ok(grid.slice(1).every((slot) => slot.pos[2] <= 100), "behind or beside the first slot");
  assert.equal(fillGrid([], 4, () => 10, { pos: [0, 16, 0], heading: 0 }).length, 4, "no slot: round the start");
  const full = [{ pos: [0, 0, 0] }, { pos: [50, 0, 0] }];
  assert.equal(fillGrid(full, 2), full, "a grid big enough is kept");
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

// ---- Monster Truck Madness 64's Tag and Chase (docs/EXTENSIONS.md) ----

test("Tag with MTM64's rules: free trucks score by closeness, 1 a second from 100 ft, 10 beside It", () => {
  assert.equal(tag64Rate(0), 10);
  assert.equal(tag64Rate(50), 7.5);
  assert.ok(Math.abs(tag64Rate(99) - 0.199) < 1e-9, "the game's formula dips under 1 near 100 ft");
  assert.equal(tag64Rate(100), 1);
  assert.equal(tag64Rate(150), 1);
  assert.equal(tag64Rate(Infinity), 1);
  const settings = tagScoring({ rules: "mtm64" });
  assert.equal(settings.rules, TAG_MTM64);
  assert.equal(tagScoring({}).rules, "openmtm2", "OpenMTM2's rules by default");
  assert.equal(extensionById("tag").settings.find((s) => s.key === "rules").default, "openmtm2");
  const tag = createTag(3, () => 0, settings);
  assert.deepEqual(tag.points, [0, 0, 0], "everyone starts at 0");
  assert.equal(tag.holdUntil, 0, "It is not held");
  assert.ok(!tagHeld(tag, 0, 0.1));
  // It at 1000, truck 1 50 ft off, truck 2 200 ft off: 7.5 and 1 a second, It nothing.
  const P = [[1000, 0, 1000], [1050, 0, 1000], [1200, 0, 1000]];
  assert.equal(tagStep(tag, 0, 2, [[0, 1]], P), null, "touches do not tag");
  assert.deepEqual(tag.points, [0, 15, 2]);
  assert.deepEqual(tagShadowBand(settings), [35, 70]);
});

test("Tag with MTM64's rules: the nearest truck within 25 ft takes It, +50 to the old It, no pass for 3 s; out of bounds is It", () => {
  const tag = createTag(4, () => 0, tagScoring({ rules: "mtm64" }));
  const P = [[1000, 0, 1000], [1020, 0, 1000], [1010, 0, 1000], [1300, 0, 1000]];
  const pass = tagStep(tag, 1, 0, [], P);
  assert.deepEqual(pass, { kind: "tag", from: 0, to: 2, points: TAG64_BONUS }, "the nearest of the two within 25 ft");
  assert.equal(tag.it, 2);
  assert.equal(tag.points[0], 50);
  assert.equal(tagStep(tag, 1 + TAG64_COOLDOWN_S - 0.01, 0, [], P), null, "no pass during the cooldown");
  assert.equal(tagStep(tag, 1 + TAG64_COOLDOWN_S, 0, [], P).to, 0, "then It passes again");
  // Truck 3 drives within 32 ft of the level's edge: It, no bonus.
  const out = [[1000, 0, 1000], [2000, 0, 2000], [3000, 0, 3000], [20, 0, 4000]];
  const before = [...tag.points];
  assert.deepEqual(tagStep(tag, 10, 0, [], out), { kind: "out", from: 0, to: 3, points: 0 });
  assert.deepEqual(tag.points, before);
  assert.ok(tag64Outside([4000, 0, 8170]) && !tag64Outside([4000, 0, 8150]));
  const tagged = createTag(2, () => 0, tagScoring({ rules: "mtm64" }));
  tagStep(tagged, 1, 0, [], [[1000, 0, 1000], [1024, 0, 1000]]);
  const wire = extensionNetFromWire("tag", extensionNetToWire("tag", { ...tagged, over: false }, (i) => i + 1), (v) => v - 1, 2);
  assert.equal(wire.passUntil, 1 + TAG64_COOLDOWN_S);
  assert.equal(wire.scoring.rules, TAG_MTM64);
});

test("Tag with MTM64's rules plays a 5 minute round whatever the length set", () => {
  const race = prepareExtensionRace(extensionById("tag"), { length: 12, settings: { rules: "mtm64" } });
  assert.equal(race.simulation.minutes, 5);
  assert.equal(prepareExtensionRace(extensionById("tag"), { length: 12, settings: {} }).simulation.minutes, 12);
});

test("Chase: exactly one suspect, from the dialog or the player; the rest are cops", () => {
  assert.deepEqual(rnrTeams(4, false, { variant: RNR_CHASE }).roles, [RACER, BLOCKER, BLOCKER, BLOCKER], "the player by default");
  assert.deepEqual(rnrTeams(4, true, { variant: RNR_CHASE }).roles, [BLOCKER, RACER, BLOCKER, BLOCKER], "Play as cop: the first computer truck");
  assert.deepEqual(rnrTeams(4, false, { variant: RNR_CHASE, picks: [null, null, { role: RACER }, null] }).roles, [BLOCKER, BLOCKER, RACER, BLOCKER]);
  assert.deepEqual(rnrTeams(4, false, { variant: RNR_CHASE, picks: [null, { role: RACER }, { role: RACER }, null] }).roles, [BLOCKER, RACER, BLOCKER, BLOCKER],
    "a second Suspect pick is a cop");
  assert.deepEqual(rnrTeams(3, true, { variant: RNR_CHASE, picks: [null, { role: BLOCKER }, null] }).roles, [BLOCKER, BLOCKER, RACER], "the first on Auto");
  const { teams, roles } = rnrTeams(3, false, { variant: RNR_CHASE });
  assert.deepEqual(teams, roles);
  const picker = teamPickerFor({ extensions: { "race-rumble": { variant: "chase" } } }, "race-rumble");
  assert.deepEqual([picker.teams, picker.roles.length], [0, 2]);
  assert.equal(picker.roles[RACER], "Suspect");
});

test("Chase: a cop within 30 ft busts the suspect, the nearest credited, none for 3 s after; the suspect home in time wins", () => {
  assert.deepEqual([CHASE_BUST_FT, CHASE_COOLDOWN_S], [30, 3]);
  const roles = [RACER, BLOCKER, BLOCKER];
  const chase = createChase(3);
  assert.equal(chaseBust(chase, 1, roles, [[0, 0, 0], [31, 0, 0], [500, 0, 0]]), null, "31 ft is too far");
  assert.deepEqual(chaseBust(chase, 1, roles, [[0, 0, 0], [29, 0, 0], [20, 0, 0]]), { kind: "bust", by: 2, racer: 0 });
  assert.equal(chaseBust(chase, 3.9, roles, [[0, 0, 0], [5, 0, 0], [20, 0, 0]]), null, "the cooldown");
  assert.equal(chaseBust(chase, 4, roles, [[0, 0, 0], [5, 0, 0], [20, 0, 0]]).by, 1);
  assert.equal(chaseBust(chase, 9, roles, [[0, 0, 0], [5, 0, 0], [20, 0, 0]], true), null, "the suspect is home");
  chaseBust(chase, 9, roles, [[0, 0, 0], [50, 0, 0], [20, 0, 0]]);
  assert.deepEqual(chase.busts, [0, 1, 2]);
  const trucks = [{ finished: false, place: 1 }, { finished: false, place: 2 }, { finished: false, place: 3 }];
  assert.equal(rnrWinner(roles, trucks, roles, RNR_CHASE), BLOCKER, "time up: the cops");
  assert.deepEqual(rnrPlaces(roles, roles, trucks, RNR_CHASE, chase.busts), [3, 2, 1], "the cops first, by busts");
  trucks[0].finished = true; trucks[0].raceTime = 250;
  assert.equal(rnrWinner(roles, trucks, roles, RNR_CHASE), RACER);
  assert.deepEqual(rnrPlaces(roles, roles, trucks, RNR_CHASE, chase.busts), [1, 3, 2]);
});

test("Chase's labels, colours and arrow: the suspect red with the arrow, the cops blue and pointed at it", () => {
  const entrants = [{ name: "You", file: "A", player: true }, { name: "Mark", file: "B" }, { name: "Greg", file: "C" }];
  const race = prepareExtensionRace(extensionById("race-rumble"), { entrants, length: 2, settings: { variant: "chase", minutes: 5 } });
  assert.equal(race.dress.marker, ROBBER_COLOUR);
  assert.deepEqual(extensionTruckLabels(race.dress, entrants, (e) => e.name).map((l) => l[1]), ["Suspect", "Cop", "Cop"]);
  assert.equal(extensionMarkerTarget(race.dress), 0);
  assert.equal(extensionMapMarks(race.dress, 3)[0].marker, "arrow");
  assert.equal(extensionTruckMarks(race.dress, 3)[1].color, COP_COLOUR);
  assert.deepEqual(extensionFinderTarget(race.dress, 1, [[0, 0, 0], [9, 0, 9], [5, 0, 5]]), [0, 0, 0], "a cop's finder at the suspect");
  assert.equal(extensionFinderTarget(race.dress, 0, [[0, 0, 0], [9, 0, 9], [5, 0, 5]]), undefined, "the suspect's at the checkpoints");
  assert.equal(extensionMarkerTarget({ mode: "race-rumble", variant: "timed", roles: [RACER, BLOCKER] }), -1);
  const wire = extensionNetFromWire("race-rumble", extensionNetToWire("race-rumble",
    { teams: [0, 1, 1], roles: [0, 1, 1], variant: "chase", events: 2, busts: [0, 1, 1], coolUntil: 7 }, (i) => i + 1), (v) => v - 1, 3);
  assert.deepEqual([wire.busts, wire.coolUntil, wire.variant], [[0, 1, 1], 7, "chase"]);
});
