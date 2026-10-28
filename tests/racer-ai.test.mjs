/*
  Computer drivers getting out of trouble without the helicopter (game/racer-recovery.js), Race & Rumble's racers and
  blockers (game/extensions/race-rumble.js, its HUD in race-loader.js), and the chase modes' routes round steep
  ground, water and movable objects (game/extensions/tag.js). Pure rules only.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  BACK_S, ESCAPE_LIMIT_S, ESCAPE_TRIES, PUSH_S, ROUND_S, STUCK_S, createRacerRecovery, racerRecovering, racerRecoveryBefore, racerRecoveryStep,
  returnPlan,
} from "../src/game/racer-recovery.js";
import { AROUND_S, createRumbleDriver, driveToPoint } from "../src/game/rumble-ai.js";
import {
  BLOCKER, LEAD_FAR_FT, RACER, RNR_CLASSIC, RNR_TIMED, blockOutcome, blockerTarget, blocksRacer, racerPlaces, rnrTeams, timingTruck,
} from "../src/game/extensions/race-rumble.js";
import { extensionHud, extensionNetFromWire, extensionNetToWire } from "../src/game/extensions/race-loader.js";
import { DETOUR_TURNS, movableOf, probeLine, routePoint } from "../src/game/extensions/tag.js";

const GEARS = { FIRST: 4, REVERSE: 2 };
const DT = 1 / 60;

/** A truck at `pos` facing `heading` (radians, 0 along +z), still, with its controls. */
function truck(pos = [0, 0, 0], heading = 0, forward = 0) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return {
    pos: [...pos], euler: [0, 0, heading], bvel: [0, 0, forward],
    // Body to world, row-major: x right, y up, z forward.
    matrix: [c, 0, s, 0, 1, 0, -s, 0, c],
    controls: { steer: 0, rearSteer: 0, throttle: 1, brakeFront: 0, brakeRear: 0, gear: GEARS.FIRST },
  };
}

test("a racer that missed a checkpoint drives back round and through it", () => {
  const r = createRacerRecovery({ returns: true, unsticks: true });
  const s = truck([0, 0, 30], 0, 40);
  const missed = { pos: [0, 0, 0], psi: 0, half: [20, 10, 2] };
  assert.equal(racerRecoveryStep(r, { state: s, dt: DT, gears: GEARS, missed }), "own", "it takes the wheel");
  assert.ok(racerRecovering(r));
  assert.equal(r.phase, "approach", "first back to the gate's approach side");
  s.pos = [0, 0, -60];
  racerRecoveryStep(r, { state: s, dt: DT, gears: GEARS, missed });
  assert.equal(r.phase, "through", "lined up behind the gate: through it");
  assert.equal(racerRecoveryStep(r, { state: s, dt: DT, gears: GEARS, missed: null }), "course", "through: back to the course");
  assert.ok(!racerRecovering(r));
});

test("the way back to a missed gate: reverse when it is just behind, turn round when it is not, the helicopter when far", () => {
  const gate = { pos: [0, 0, 0], psi: 0 };
  assert.equal(returnPlan(truck([0, 0, 30], 0), gate).kind, "reverse", "just past it and still facing the course's way");
  assert.equal(returnPlan(truck([0, 0, 30], Math.PI), gate).kind, "turn", "already turned back");
  assert.equal(returnPlan(truck([90, 0, 200], 0), gate).kind, "turn", "well past it and off to the side");
  assert.equal(returnPlan(truck([0, 0, 1500], 0), gate).kind, "heli", "far past it: the helicopter is quicker");
  // Reversing backs the truck in reverse gear toward the approach side.
  const r = createRacerRecovery({ returns: true, unsticks: true });
  const s = truck([0, 0, 30], 0, 0);
  racerRecoveryStep(r, { state: s, dt: DT, gears: GEARS, missed: { ...gate, half: [20, 10, 2] } });
  assert.equal(r.plan, "reverse");
  assert.equal(s.controls.gear, GEARS.REVERSE);
});

test("driving back, a truck that makes headway is never fetched; one jammed calls the helicopter after its tries or about 15 s", () => {
  const missed = { pos: [0, 0, 0], psi: 0, half: [20, 10, 2] };
  // Turned round and closing on the gate's approach side, slowly: no helicopter however long it takes.
  const r = createRacerRecovery({ returns: true, unsticks: true });
  const s = truck([300, 0, 300], Math.PI, 20);
  let verdict = null;
  for (let t = 0; t < 40 && verdict !== "heli"; t += 0.25) {
    verdict = racerRecoveryStep(r, { state: s, dt: 0.25, gears: GEARS, missed, trucks: [] });
    // Moves 5 ft toward the approach point each quarter second.
    const to = [0 - s.pos[0], -70 - s.pos[2]], d = Math.hypot(...to);
    if (d > 6) { s.pos[0] += (to[0] / d) * 5; s.pos[2] += (to[1] / d) * 5; }
  }
  assert.notEqual(verdict, "heli", "no clock while it gets somewhere");
  // Jammed: it never moves.
  const jam = createRacerRecovery({ returns: true, unsticks: true });
  const stuck = truck([300, 0, 300], Math.PI, 0);
  let at = null;
  for (let t = 0; t < 60 && at === null; t += 0.25) {
    stuck.controls.throttle = 1;
    if (racerRecoveryStep(jam, { state: stuck, dt: 0.25, gears: GEARS, missed, trucks: [] }) === "heli") at = t;
  }
  assert.ok(at !== null, "the helicopter in the end");
  assert.ok(at <= ESCAPE_LIMIT_S + 6, `after about ${ESCAPE_LIMIT_S} s jammed (${at} s)`);
});

test("a stuck racer shoves the truck in its way, backs out, goes round, and calls the helicopter only after its tries", () => {
  const r = createRacerRecovery({ unsticks: true });
  const s = truck([0, 0, 0], 0, 0);
  const ctx = { state: s, dt: DT, gears: GEARS, missed: null, aim: [100, 0, 300], trucks: [[0, 0, 15]] };
  let verdict;
  for (let t = 0; t < STUCK_S + 0.1; t += DT) { s.controls.throttle = 1; s.controls.gear = GEARS.FIRST; verdict = racerRecoveryStep(r, ctx); }
  assert.equal(verdict, "own");
  assert.equal(r.mode, "push", "a truck right in front: fight back first");
  assert.equal(s.controls.throttle, 1);
  for (let t = 0; t < PUSH_S + 0.05; t += DT) racerRecoveryStep(r, ctx);
  assert.equal(r.mode, "back", "then back out");
  assert.equal(s.controls.gear, GEARS.REVERSE);
  for (let t = 0; t < BACK_S + 0.05; t += DT) racerRecoveryStep(r, ctx);
  assert.equal(r.mode, "round", "then round it");
  for (let t = 0; t < ROUND_S + 0.05; t += DT) racerRecoveryStep(r, ctx);
  assert.equal(r.mode, "course", "then back on the course");
  assert.equal(s.controls.gear, GEARS.FIRST);
  // Still going nowhere: try after try, then the helicopter.
  let tries = r.tries;
  for (let k = 0; k < 400 && verdict !== "heli"; k++) {
    s.controls.throttle = 1;
    if (r.mode === "course") s.controls.gear = GEARS.FIRST;
    verdict = racerRecoveryStep(r, { ...ctx, dt: 0.25 });
    tries = Math.max(tries, r.tries);
  }
  assert.equal(verdict, "heli");
  assert.ok(tries >= ESCAPE_TRIES || r.tries === 0, "after its tries, or its time");
});

test("a racer lying over calls the helicopter after 3 s", () => {
  const r = createRacerRecovery({ unsticks: true });
  const s = truck([0, 0, 0], 0, 0);
  s.matrix[4] = -1;
  let verdict = null;
  for (let t = 0; t < 3.2 && verdict !== "heli"; t += 0.1) verdict = racerRecoveryStep(r, { state: s, dt: 0.1, gears: GEARS, trucks: [] });
  assert.equal(verdict, "heli");
});

test("a racer steers off a blocker closing on it and keeps its foot down; the dodge is taken back before the autopilot", () => {
  const r = createRacerRecovery({ unsticks: true });
  const s = truck([0, 0, 0], 0, 60);
  s.controls.throttle = 0.5;
  s.controls.brakeFront = 0.3;
  // A blocker ahead on the right, coming at the racer.
  racerRecoveryStep(r, { state: s, dt: DT, gears: GEARS, trucks: [], threats: [{ pos: [12, 0, 80], vel: [-5, 0, -40] }] });
  assert.ok(s.controls.steer < 0, "away from the side it comes from");
  assert.ok(s.controls.throttle >= 0.9 && s.controls.brakeFront === 0);
  racerRecoveryBefore(r, s.controls);
  assert.ok(Math.abs(s.controls.steer) < 1e-9, "the autopilot steers from its own value");
  const calm = truck([0, 0, 0], 0, 60);
  racerRecoveryStep(r, { state: calm, dt: DT, gears: GEARS, trucks: [], threats: [{ pos: [12, 0, 80], vel: [0, 0, 60] }] });
  assert.equal(calm.controls.steer, 0, "one keeping its distance is no threat");
});

test("Race & Rumble: only the racers have places while the race runs, 1 to 4 of 4 with eight trucks", () => {
  const { teams, roles } = rnrTeams(8, false);
  const places = racerPlaces(roles, [3, 1, 8, 2, 5, 4, 7, 6]);
  const racers = roles.map((role, i) => i).filter((i) => roles[i] === RACER);
  assert.equal(racers.length, 4);
  assert.deepEqual(racers.map((i) => places[i]).sort(), [1, 2, 3, 4]);
  assert.ok(roles.every((role, i) => role === RACER || places[i] === null), "a blocker has none");
  assert.equal(timingTruck(roles.indexOf(BLOCKER), teams, roles, RNR_CLASSIC), roles.findIndex((role, i) => role === RACER && teams[i] === teams[roles.indexOf(BLOCKER)]),
    "a classic blocker's times are its racer's");
  const timed = rnrTeams(4, false, { variant: RNR_TIMED });
  const blocker = timed.roles.indexOf(BLOCKER);
  assert.equal(timingTruck(blocker, timed.teams, timed.roles, RNR_TIMED), blocker);
});

test("Race & Rumble: a blocker frees its own racer first, else goes for the leader, or a nearer racer when the leader is far", () => {
  const racer = (index, team, pos, place, speed = 60) => ({ index, team, role: RACER, pos, vel: [0, 0, 0], speed, place, finished: false });
  const blocker = (index, team, pos) => ({ index, team, role: BLOCKER, pos, vel: [0, 0, 0], speed: 0, place: null, finished: false });
  const field = [
    racer(0, 0, [0, 0, 0], 3), blocker(1, 0, [200, 0, 0]),
    racer(2, 1, [300, 0, 0], 1), blocker(3, 1, [600, 0, 0]),
    racer(4, 2, [250, 0, 0], 2), blocker(5, 2, [30, 0, 0]),
  ];
  assert.equal(blockerTarget(1, field).index, 2, "the leading racer, not the nearest");
  field[0].speed = 5;
  assert.equal(blockerTarget(1, field).index, 5, "its own racer held up by a truck beside it: that truck");
  field[0].speed = 60;
  field[5].pos = [400, 0, 0];
  assert.equal(blockerTarget(1, field).index, 2, "a blocker that is not on its racer is left alone");
  field[2].pos = [200 + LEAD_FAR_FT + 300, 0, 0];
  assert.equal(blockerTarget(1, field).index, 4, "the leader far off: the nearer racer");
  // Timed: the leader; never a blocker.
  const timed = [racer(0, RACER, [500, 0, 0], 2), racer(1, RACER, [900, 0, 0], 1), blocker(2, BLOCKER, [0, 0, 0]), blocker(3, BLOCKER, [10, 0, 0])];
  assert.equal(blockerTarget(2, timed).index, 1);
  timed[0].finished = timed[1].finished = true;
  assert.equal(blockerTarget(2, timed), null, "no racer left: no target, never the other blockers");
});

test("Race & Rumble: a blocker's hit counts when the racer is rolled over or held up", () => {
  assert.equal(blockOutcome({ at: 0, speed: 60 }, { speed: 40, up: 0.1 }, 0.5), "roll");
  assert.equal(blockOutcome({ at: 0, speed: 60 }, { speed: 3, up: 1 }, 1), "block");
  assert.equal(blockOutcome({ at: 0, speed: 5 }, { speed: 3, up: 1 }, 1), null, "a racer already slow was not stopped by it");
  assert.equal(blockOutcome({ at: 0, speed: 60 }, { speed: 50, up: 1 }, 3), "expired");
  assert.ok(blocksRacer(1, 2, [0, 0, 1], [RACER, BLOCKER, RACER]));
  assert.ok(!blocksRacer(1, 0, [0, 0, 1], [RACER, BLOCKER, RACER]), "never its own team's racer");
});

test("Race & Rumble's board: a classic blocker sees its racer's times, a timed blocker the clock, the racers' lap and the leader", () => {
  const t = (text, ...args) => text.replace(/<<(\d)>>/g, (_, n) => String(args[n - 1]));
  const helpers = { t, formatRaceTime: (s) => s.toFixed(1), watched: 0 };
  const entrants = [{ name: "You" }, { name: "Mark" }, { name: "Greg" }, { name: "Rich" }];
  const row = (place, lap, lapTime) => ({ place, lap, lapTime, best: 0, laps: lap - 1 });
  const race = { laps: 3, clock: 50, gap: { kind: "back", seconds: 2 }, trucks: [row(null, 1, 50), row(2, 2, 11), row(1, 2, 9), row(null, 1, 50)] };
  const classic = { mode: "race-rumble", variant: RNR_CLASSIC, teams: [0, 0, 1, 1], roles: [BLOCKER, RACER, RACER, BLOCKER], events: 0, left: null };
  const view = extensionHud(classic, race, entrants, helpers, { phase: "started", events: 0 });
  assert.ok(view.rows.some((r) => r[0] === "Lap:" && r[1] === "11.0"), "the racer's lap time");
  assert.deepEqual(view.rows.find((r) => r[0] === "Place:"), ["Place:", "[lap count]Lap: 2/3", "2/2"], "its place among the two racers");
  assert.deepEqual(view.rows.at(-1), ["Racer:", "Mark"]);
  const timed = { mode: "race-rumble", variant: RNR_TIMED, teams: [1, 0, 0, 1], roles: [BLOCKER, RACER, RACER, BLOCKER], events: 1, left: 90,
    event: { kind: "roll", by: 3, racer: 2 } };
  const block = extensionHud(timed, race, entrants, helpers, { phase: "started", events: 0 });
  assert.deepEqual(block.rows, [["Time Remaining:", "90.0"], ["Racers' lap:", "2/3"], ["Lead racer:", "Greg"]]);
  assert.deepEqual(block.sounds, [{ kind: "yeehaw", truck: 3 }], "a roll-over is cheered from the blocker's truck");
  assert.equal(extensionHud({ ...timed, event: { kind: "block", by: 3, racer: 2 }, events: 2 }, race, entrants, helpers, { phase: "started", events: 1 }).sounds[0].kind, "horn");
  assert.equal(extensionHud(timed, race, entrants, helpers, { phase: "started", events: 1 }).sounds.length, 0, "once");
  const back = extensionNetFromWire("race-rumble", extensionNetToWire("race-rumble", timed, (i) => i + 1), (v) => v - 1, 4);
  assert.deepEqual([back.events, back.event.by, back.event.racer], [1, 3, 2], "the cheer reaches the other machines");
});

test("the chase modes go round ground too steep to climb and round water, and through water when there is no other way", () => {
  const flat = () => 0;
  assert.equal(probeLine([0, 0, 0], Math.PI / 2, 140, flat), "clear");
  // A cliff across +x at x = 60.
  const cliff = (x) => (x > 60 ? 60 : 0);
  assert.equal(probeLine([0, 0, 0], Math.PI / 2, 140, cliff), "steep");
  const round = routePoint([0, 0, 0], [200, 0, 0], [], cliff);
  assert.ok(Math.abs(round[0]) < 60 + 1e-6 || Math.abs(round[2]) > 30, "the steer point keeps off the cliff");
  assert.notDeepEqual(round, [200, 0, 0]);
  // A pond on the straight line, dry ground beside it.
  const pond = (x, z) => (x > 50 && x < 150 && Math.abs(z) < 40 ? -10 : 0);
  const dry = routePoint([0, 0, 0], [200, 0, 0], [], pond, { water: -2 });
  assert.equal(probeLine([0, 0, 0], Math.atan2(dry[0], dry[2]), 112, pond, -2), "clear", "round the pond");
  assert.deepEqual(routePoint([0, 0, 0], [100, 0, 0], [], pond, { water: -2 }), [100, 0, 0], "a quarry in the water is followed in");
  const sea = (x) => (x > 20 ? -10 : 0);
  const shore = routePoint([0, 0, 0], [200, 0, 300], [], (x, z) => (x > 60 && z < 100 ? 60 : sea(x)), { water: -2 });
  assert.ok(shore, "a cliff with only water round it: the water");
  assert.ok(DETOUR_TURNS.length >= 6);
});

test("a movable object is driven round; a fixed one or a checkpoint is not counted as one", () => {
  const barrel = movableOf({ pos: [100, 0, 0], half: [2, 3, 2], mass: 5, type: 0 });
  assert.ok(barrel && barrel.reach > 2.8, "its reach grown by half a truck");
  assert.equal(movableOf({ pos: [0, 0, 0], half: [2, 3, 2], mass: 0, type: 0 }), null);
  assert.equal(movableOf({ pos: [0, 0, 0], half: [2, 3, 2], mass: 5, type: 7 }), null);
  const steered = routePoint([0, 0, 0], [200, 0, 0], [barrel], () => 0);
  assert.ok(Math.abs(steered[2]) > barrel.reach, "wide of the barrel");
});

test("a truck driven to a point backs out when pinned, then goes round to one side, the other side when pinned again soon", () => {
  const s = truck([0, 0, 0], 0, 0);
  const driver = createRumbleDriver(0.5);
  for (let t = 0; t < 1.6; t += DT) driveToPoint(s, driver, [0, 0, 200], 60, 0, GEARS, DT, { detour: true });
  assert.equal(driver.mode, "reverse");
  const side = driver.side;
  for (let t = 0; t < 1.5; t += DT) driveToPoint(s, driver, [0, 0, 200], 60, 0, GEARS, DT, { detour: true });
  assert.equal(driver.mode, "drive");
  assert.ok(driver.around, "going round");
  for (let t = 0; t < AROUND_S + 1.7; t += DT) driveToPoint(s, driver, [0, 0, 200], 60, 0, GEARS, DT, { detour: true });
  assert.equal(driver.side, -side, "pinned again: the other side");
});

