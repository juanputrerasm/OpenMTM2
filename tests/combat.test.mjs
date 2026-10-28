/*
  Combat (docs/EXTENSIONS.md): the hit points and where hits go, wheels coming off last, wrecks, credits and repairs,
  the hurt engine and gearbox, the places, the ground that hides a lost wheel, the debris, the computer drivers' rams,
  and a worker session played through the generic extension payload.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMBAT_EXTENSION, COMBAT_HP, CRAWL, CREDITS, ENGAGE, closingSpeed, engageShare, ENGINE_FLOOR, ROLL, crawling, rollCost, truckShare, IMPACT, REPAIR, WHEEL_CAP, applyHit, combatPlaces, combatTruckView, createCombat,
  creditDamage, creditProgress, enginePower, gearboxStep, impactOf, lastStanding, quit, ramShares, repair, repairCost, running, wheelAt, wreck,
} from "../src/game/extensions/combat.js";
import { STUB_RADIUS_FT, lostWheelGround } from "../src/game/extensions/combat-ground.js";
import { debrisCount, debrisShards, stepShard } from "../src/game/extensions/combat-debris.js";
import { COMBAT_AI, createCombatDriver, pickTarget, ramPoint, ramStep, wantsRepair } from "../src/game/extensions/combat-ai.js";
import { courseSegmentOf, droveThrough, pastCheckpoint } from "../src/game/extensions/combat-session.js";
import { extensionKeyAction, extensionHud, extensionTruckLabels, extensionTruckOut } from "../src/game/extensions/race-loader.js";
import { EXTENSIONS } from "../src/game/extensions/loader.js";
import { createSession } from "../src/worker/sim-worker.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { mtm2Sim as S } from "../src/vendor/openphotex/index.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

const GEARS = S.GEAR;
const hit = (kind, amount, side = 1, end = 1) => ({ kind, amount, side, end });

test("Combat is an extension on checkpoint tracks: damage always on, the X key repairs, a player who is out watches on", () => {
  assert.ok(EXTENSIONS.includes(COMBAT_EXTENSION));
  assert.equal(COMBAT_EXTENSION.acceptsTrack({ raceType: "circuit" }), true);
  assert.equal(COMBAT_EXTENSION.acceptsTrack({ raceType: "rally" }), true);
  assert.equal(COMBAT_EXTENSION.acceptsTrack({ raceType: "summit" }), false);
  assert.equal(COMBAT_EXTENSION.acceptsTrack({ raceType: "freeroam" }), false);
  assert.equal(COMBAT_EXTENSION.acceptsTrack({ raceType: "circuit", freeRoamOnly: true }), false);
  assert.equal(COMBAT_EXTENSION.keepsRace, true);
  assert.equal(COMBAT_EXTENSION.damageKey, "repair");
  assert.equal(COMBAT_EXTENSION.watchWhenOut, true);
});

test("where a hit came from: pushed back is a hit in front, pushed up a landing, the other truck's place when there is one", () => {
  assert.equal(impactOf([0, 0, -30], 20).kind, "front");
  assert.equal(impactOf([0, 0, 30], 20).kind, "rear");
  assert.equal(impactOf([30, 0, 2], 20).kind, "side");
  assert.equal(impactOf([30, 0, 2], 20).side, -1, "pushed right: struck on the left");
  assert.equal(impactOf([0, 40, 5], 20).kind, "landing");
  // Against a truck, where it was decides, and a hit with a truck counts in full.
  const met = impactOf([0, 0, 30], 20, [-6, 0, 1]);
  assert.equal(met.kind, "side");
  assert.equal(met.side, -1);
  assert.equal(met.amount, 20 * IMPACT.perFtS);
  // A truck is built for knocks: an object, a wall or a jump counts only when it is big.
  assert.equal(impactOf([0, 0, -25], 20).amount, 0, "a fence or a light knock: nothing");
  assert.equal(impactOf([0, 0, -(IMPACT.aloneFreeFtS + 20)], 40).amount, 20 * IMPACT.perFtS * IMPACT.alone);
  assert.equal(impactOf([0, 30, 0], 26).amount, 0, "an ordinary jump's landing: nothing");
  const big = impactOf([0, IMPACT.landingFreeFtS + 20, 0], 60);
  assert.equal(big.amount, 20 * IMPACT.perFtS * IMPACT.landing, "a big jump's landing: hard");
  assert.ok(impactOf([0, 0, -20], 16, [0, 0, 5]).amount > impactOf([0, 0, -50], 46).amount, "trucks meeting count most");
  assert.equal(wheelAt(1, 1), 0);
  assert.equal(wheelAt(1, -1), 1);
  assert.equal(wheelAt(-1, 1), 2);
  assert.equal(wheelAt(-1, -1), 3);
});

test("a head-on hurts the engine, a hit from behind the gearbox, a side hit the wheels on that side", () => {
  const c = createCombat(1);
  applyHit(c, 0, hit("front", 100));
  assert.ok(c.trucks[0].engine < COMBAT_HP.engine);
  assert.equal(c.trucks[0].gearbox, COMBAT_HP.gearbox);
  assert.equal(c.trucks[0].global, COMBAT_HP.global - 100);
  const r = createCombat(1);
  applyHit(r, 0, hit("rear", 100));
  assert.ok(r.trucks[0].gearbox < COMBAT_HP.gearbox);
  assert.equal(r.trucks[0].engine, COMBAT_HP.engine);
  const s = createCombat(1);
  applyHit(s, 0, hit("side", 100, -1, 1));
  assert.ok(s.trucks[0].wheels[1] < COMBAT_HP.wheel && s.trucks[0].wheels[3] < COMBAT_HP.wheel, "the left side");
  assert.equal(s.trucks[0].wheels[0], COMBAT_HP.wheel);
  // A scrape does nothing to the parts.
  const scrape = createCombat(1);
  applyHit(scrape, 0, hit("front", IMPACT.least - 1));
  assert.equal(scrape.trucks[0].engine, COMBAT_HP.engine);
});

test("a wheel never comes off in one hit: it is worn down first, and goes only when the truck is half gone", () => {
  const c = createCombat(1);
  const t = c.trucks[0];
  // The hardest hit there is: a share of the whole truck, and a wheel loses at most WHEEL_CAP of its pool.
  const big = applyHit(c, 0, hit("side", 1e6));
  assert.equal(big.taken, COMBAT_HP.global * IMPACT.cap);
  assert.deepEqual(big.wheelsOff, []);
  assert.equal(t.wheels[0], COMBAT_HP.wheel * (1 - WHEEL_CAP));
  // Its pool empty with the truck still strong: the wheel stays.
  t.wheels[0] = 0;
  assert.deepEqual(applyHit(c, 0, hit("side", 50)).wheelsOff, []);
  // Half gone, and the corner struck again: off.
  t.global = COMBAT_HP.global * 0.45;
  assert.deepEqual(applyHit(c, 0, hit("side", 50)).wheelsOff, [0]);
  assert.equal(t.lost[0], true);
  // A landing wears the wheels but never takes one off.
  t.wheels[1] = 0;
  assert.deepEqual(applyHit(c, 0, hit("landing", 80)).wheelsOff, []);
});

test("a truck is out with no hit points left, or with no wheel left and no credits to put one back", () => {
  const c = createCombat(2, { startCredits: 0 });
  c.trucks[0].global = 10;
  assert.equal(applyHit(c, 0, hit("front", 50)).wrecked, true);
  assert.deepEqual(c.trucks[0].lost, [true, true, false, false], "the wreck tore off the front axle and its wheels");
  const t = c.trucks[1];
  t.lost = [true, true, true, false];
  t.wheels[3] = 0;
  t.global = COMBAT_HP.global * 0.4;
  const last = applyHit(c, 1, hit("rear", 40, -1, -1));
  assert.deepEqual(last.wheelsOff, [3]);
  assert.equal(last.wrecked, true);
  assert.equal(applyHit(c, 1, hit("front", 50)).taken, 0, "a wreck takes nothing more");
  // With the credits for a wheel, a truck on none waits for its repair.
  const rich = createCombat(1, { startCredits: REPAIR.wheel });
  const r = rich.trucks[0];
  r.lost = [true, true, true, false];
  r.wheels[3] = 0;
  r.global = COMBAT_HP.global * 0.4;
  const stuck = applyHit(rich, 0, hit("rear", 40, -1, -1));
  assert.deepEqual(stuck.wheelsOff, [3]);
  assert.equal(stuck.wrecked, false);
  assert.deepEqual(repair(rich, 0, 100).wheelsBack, [0]);
});

test("the gearbox is out of the way until a wheel is gone; a dead engine or gearbox never ends the race", () => {
  const c = createCombat(2);
  applyHit(c, 0, hit("side", 100));
  assert.equal(c.trucks[0].gearbox, COMBAT_HP.gearbox, "a side hit misses it");
  applyHit(c, 0, hit("rear", 100));
  const shielded = COMBAT_HP.gearbox - c.trucks[0].gearbox;
  c.trucks[1].lost[0] = true;
  applyHit(c, 1, hit("rear", 100));
  assert.ok(COMBAT_HP.gearbox - c.trucks[1].gearbox > shielded * 2, "bared by the lost wheel");
  c.trucks[0].engine = 0;
  c.trucks[0].gearbox = 0;
  assert.equal(running(c.trucks[0]), true);
  assert.equal(crawling(c, 0), true);
  assert.equal(crawling(c, 1), false);
});

test("a rammer takes a quarter of the damage and is credited; an even meeting hurts both and credits both", () => {
  assert.deepEqual(ramShares(80, 10), { a: 0.25, b: 1, creditA: true, creditB: false });
  assert.deepEqual(ramShares(10, 80), { a: 1, b: 0.25, creditA: false, creditB: true });
  assert.deepEqual(ramShares(50, 45), { a: 1, b: 1, creditA: true, creditB: true });
});

test("credits for checkpoints, laps, hit points dealt and wrecks; none with credits off", () => {
  const c = createCombat(2, { startCredits: 0 });
  creditProgress(c, 0, 3, 1);
  assert.equal(c.trucks[0].credits, 3 * CREDITS.checkpoint + CREDITS.lap);
  creditDamage(c, 1, 100, true);
  assert.equal(c.trucks[1].credits, 100 * CREDITS.perHp + CREDITS.wreck);
  assert.equal(c.trucks[1].wrecks, 1);
  const off = createCombat(1, { credits: false, startCredits: 900 });
  creditProgress(off, 0, 5, 1);
  assert.equal(off.trucks[0].credits, 0);
});

test("a repair puts a lost wheel back first, then spreads the credits evenly over the damage, and not twice within its pause", () => {
  const c = createCombat(1, { startCredits: 0 });
  const t = c.trucks[0];
  t.lost[2] = true; t.wheels[2] = 0; t.wheels[0] = 200; t.global = 500; t.engine = 100;
  assert.equal(repair(c, 0, 10).reason, "credits");
  // However few the credits, they buy some: the same share of every pool's damage.
  t.credits = 100;
  assert.equal(repair(c, 0, 10).spent, 100);
  assert.equal(t.lost[2], true, "too few for the lost wheel");
  const share = (now, before, full) => (now - before) / (full - before);
  const s = share(t.global, 500, COMBAT_HP.global);
  assert.ok(s > 0);
  assert.ok(Math.abs(share(t.engine, 100, COMBAT_HP.engine) - s) < 1e-9, "the engine by the same share");
  assert.ok(Math.abs(share(t.wheels[0], 200, COMBAT_HP.wheel) - s) < 1e-9, "the worn wheel by the same share");
  assert.equal(t.gearbox, COMBAT_HP.gearbox, "the gearbox is whole");
  // With a wheel's price, the wheel goes back on first.
  const g = t.global;
  t.credits = REPAIR.wheel + 200;
  const done = repair(c, 0, 20);
  assert.deepEqual(done.wheelsBack, [2]);
  assert.equal(t.lost[2], false);
  assert.equal(done.spent, REPAIR.wheel + 200);
  assert.ok(t.wheels[2] > COMBAT_HP.wheel * REPAIR.wheelBack, "the wheel put back, then mended with the rest");
  assert.ok(t.global > g && t.global < COMBAT_HP.global);
  t.credits = 1e6;
  assert.equal(repair(c, 0, 21).reason, "cooling");
  repair(c, 0, 20 + REPAIR.coolS);
  assert.ok(repairCost(c, 0) <= 0);
  assert.equal(repair(c, 0, 99).reason, "whole");
  wreck(c, 0);
  assert.equal(repair(c, 0, 200).reason, "wrecked");
});

test("a hit between trucks goes by their speed into each other, and a fight pushed on fades out", () => {
  // Same way, same speed: nothing; a fast truck into a slower one: the difference; head on: both.
  assert.equal(closingSpeed(90, -90), 0);
  assert.equal(closingSpeed(90, -60), 30);
  assert.equal(closingSpeed(40, 40), 80);
  assert.equal(truckShare(closingSpeed(90, -80)), 0);
  assert.equal(truckShare(closingSpeed(90, 0)), 1);
  assert.equal(engageShare(0), 1);
  assert.equal(engageShare(ENGAGE.fullS), 1);
  assert.ok(engageShare((ENGAGE.fullS + ENGAGE.goneS) / 2) > 0.4 && engageShare((ENGAGE.fullS + ENGAGE.goneS) / 2) < 0.6);
  assert.equal(engageShare(ENGAGE.goneS), 0);
  assert.equal(engageShare(10), 0);
  assert.equal(engageShare(-0.1), 1);
});

test("trucks leaning on each other cost nothing, a hit at speed all of it; a flip at speed a little", () => {
  assert.equal(truckShare(5), 0);
  assert.equal(truckShare(IMPACT.truckFreeFtS), 0);
  assert.equal(truckShare(IMPACT.truckFullFtS), 1);
  assert.equal(truckShare(100), 1);
  assert.equal(rollCost(20), 0);
  assert.ok(rollCost(100) > 0 && rollCost(100) <= ROLL.most);
  const c = createCombat(1);
  const r = applyHit(c, 0, { kind: "roll", amount: rollCost(100), side: 1, end: 1 });
  assert.ok(r.taken > 0 && r.taken < COMBAT_HP.global * 0.06);
  assert.equal(c.trucks[0].engine, COMBAT_HP.engine);
  assert.deepEqual(c.trucks[0].wheels, [COMBAT_HP.wheel, COMBAT_HP.wheel, COMBAT_HP.wheel, COMBAT_HP.wheel]);
});

test("a hurt engine gives less power, a dead one a crawl; a hurt gearbox misses shifts, and with none left keeps to first", () => {
  const c = createCombat(1);
  assert.equal(enginePower(c, 0), 1);
  c.trucks[0].engine = 1e-6;
  assert.ok(Math.abs(enginePower(c, 0) - ENGINE_FLOOR) < 1e-6);
  c.trucks[0].engine = 0;
  assert.equal(enginePower(c, 0), CRAWL.throttle);
  // A healthy gearbox shifts.
  const healthy = createCombat(1), memory = { last: GEARS.FIRST, missUntil: 0, target: null };
  const ctl = { gear: GEARS.SECOND };
  gearboxStep(healthy, 0, ctl, GEARS, memory, 1, 0);
  assert.equal(ctl.gear, GEARS.SECOND);
  // A worn one misses (the roll low), out of gear for a moment, then the gear goes in, and that is not another shift.
  const worn = createCombat(1);
  worn.trucks[0].gearbox = 30;
  const m2 = { last: GEARS.FIRST, missUntil: 0, target: null }, c2 = { gear: GEARS.SECOND };
  gearboxStep(worn, 0, c2, GEARS, m2, 1, 0);
  assert.equal(c2.gear, GEARS.NEUTRAL);
  gearboxStep(worn, 0, c2, GEARS, m2, 1.2, 0);
  assert.equal(c2.gear, GEARS.NEUTRAL);
  c2.gear = GEARS.NEUTRAL;
  gearboxStep(worn, 0, c2, GEARS, m2, 2, 0);
  assert.equal(c2.gear, GEARS.SECOND);
  gearboxStep(worn, 0, c2, GEARS, m2, 2.1, 0);
  assert.equal(c2.gear, GEARS.SECOND, "it stays in");
  // None left: never past first.
  worn.trucks[0].gearbox = 0;
  const c3 = { gear: GEARS.THIRD };
  gearboxStep(worn, 0, c3, GEARS, { last: GEARS.THIRD, missUntil: 0, target: null }, 5, 0.99);
  assert.equal(c3.gear, GEARS.FIRST);
});

test("the places: those home, then the trucks running, then the wrecks, the last wrecked first; the last truck standing", () => {
  const c = createCombat(4);
  const race = [{ place: 2, finished: false }, { place: 1, finished: false }, { place: 3, finished: false }, { place: 4, finished: false }];
  wreck(c, 1);
  wreck(c, 3);
  assert.deepEqual(combatPlaces(c, race), [1, 4, 2, 3]);
  assert.equal(lastStanding(c, race), -1);
  quit(c, 2);
  assert.equal(running(c.trucks[2]), false);
  assert.equal(lastStanding(c, race), 0);
  // One home and still running: the race decides, not the last standing.
  assert.equal(lastStanding(c, [{ finished: true }, {}, {}, {}]), -1);
});

test("the ground under a lost wheel is lowered to its stub; everywhere else it is the ground", () => {
  const base = { height: () => 10, normal: (x, z, out) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; }, surface: () => 1, weather: 0 };
  const params = { hubs: [[4, -3, 6], [-4, -3, 6], [4, -3, -6], [-4, -3, -6]], tireWidthFt: 2, tireRadiusFt: 3, scrapePoints: [[5, 0, 9], [-5, 0, 9]] };
  const state = { pos: [100, 20, 200], matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const lost = [false, false, false, false];
  const ground = lostWheelGround(base, () => state, params, lost);
  // The front right wheel's probe: half a tire inward of its anchor.
  const probe = [100 + 4 - 1, 200 + 6];
  assert.equal(ground.height(...probe), 10);
  lost[0] = true;
  assert.equal(ground.height(...probe), 10 - (3 - STUB_RADIUS_FT));
  assert.equal(ground.height(100 - 3, 206), 10, "the other wheels' ground is the ground");
  assert.equal(ground.height(105, 209), 10, "and so is the body's");
  assert.equal(ground.weather, 0, "the rest is the truck's ground's");
});

test("debris: none for a scrape, more and the same each time for a harder hit; a shard falls and lies still", () => {
  assert.equal(debrisCount(2), 0);
  assert.ok(debrisCount(200) > debrisCount(40));
  const a = debrisShards({ pos: [0, 5, 0], force: 120, seed: 7 }), b = debrisShards({ pos: [0, 5, 0], force: 120, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.length, debrisCount(120));
  const shard = a[0];
  for (let i = 0; i < 600; i++) stepShard(shard, 1 / 60, 0);
  assert.equal(shard.still, true);
  assert.ok(Math.abs(shard.pos[1] - 0.05) < 1e-9);
});

test("a computer truck rams a truck ahead on its line when it is fit, never off the grid, and breaks off", () => {
  const self = { pos: [0, 0, 0], heading: 0, hp: 1, engine: 1 };
  const ahead = { index: 1, pos: [0, 0, 100], hp: 0.5, wheels: 3, place: 2, running: true, onLine: true };
  const roll0 = { aggression: "normal", dt: 1, roll: 0 };
  assert.equal(pickTarget(self, [ahead], roll0), 1);
  assert.equal(pickTarget(self, [{ ...ahead, pos: [0, 0, -100] }], roll0), -1, "behind");
  assert.equal(pickTarget(self, [{ ...ahead, onLine: false }], roll0), -1, "off its line");
  assert.equal(pickTarget({ ...self, hp: 0.2 }, [ahead], roll0), -1, "too hurt");
  assert.equal(pickTarget(self, [ahead], { ...roll0, roll: 0.99 }), -1, "the dice");
  // The weakest first.
  const weak = { ...ahead, index: 2, pos: [10, 0, 120], hp: 0.2, wheels: 2 };
  assert.equal(pickTarget(self, [ahead, weak], roll0), 2);
  const memory = createCombatDriver();
  assert.equal(ramStep(memory, self, [ahead], { now: COMBAT_AI.startS - 1, dt: 1, roll: 0 }), -1, "off the grid");
  assert.equal(ramStep(memory, self, [ahead], { now: COMBAT_AI.startS + 1, dt: 1, roll: 0 }), 1);
  assert.equal(ramStep(memory, self, [ahead], { now: COMBAT_AI.startS + 1 + COMBAT_AI.ramS + 0.1, dt: 1, roll: 0 }), -1, "time up");
  assert.ok(memory.restUntil > COMBAT_AI.startS + 1);
  // Aimed where the target will be.
  const point = ramPoint([0, 0, 0], { pos: [0, 0, 100], vel: [0, 0, 50], heading: 0 });
  assert.ok(point[2] > 100);
});

test("a computer truck repairs with a wheel gone or badly hurt, when it can", () => {
  const view = { wrecked: false, quit: false, cost: 900, wheels: [1, 1, -1, 1], hp: 0.8, engine: 1, credits: 600 };
  assert.equal(wantsRepair(view), true);
  assert.equal(wantsRepair({ ...view, credits: 100 }), false);
  assert.equal(wantsRepair({ ...view, wheels: [1, 1, 1, 1] }), false);
  assert.equal(wantsRepair({ ...view, wheels: [1, 1, 1, 1], hp: 0.2 }), true);
});

test("a checkpoint's stretch of course, and a truck past it", () => {
  const course = [
    { ctype: 1, start: [0, 0, 0], end: [0, 0, 100] },
    { ctype: 1, start: [0, 0, 100], end: [100, 0, 100] },
    { ctype: 1, start: [100, 0, 100], end: [100, 0, 0] },
    { ctype: 1, start: [100, 0, 0], end: [0, 0, 0] },
  ];
  assert.equal(courseSegmentOf(course, [50, 0, 103]), 1);
  assert.equal(pastCheckpoint(2, 1, 4), true);
  assert.equal(pastCheckpoint(1, 1, 4), false);
  assert.equal(pastCheckpoint(0, 1, 4), false, "short of it");
});

test("the HUD tells the truck's state, a wheel lost and a wreck; X repairs when it can", () => {
  const c = createCombat(2);
  const state = {
    mode: "combat", credits: true, trucks: [combatTruckView(c, 0), combatTruckView(c, 1)],
    log: [{ id: 1, kind: "wheel", truck: 1, wheel: 2, by: 0 }, { id: 2, kind: "wreck", truck: 1, by: 0 }], events: 2, out: [false, true],
  };
  const race = { laps: 3, trucks: [{ lap: 1, place: 1, lapTime: 0, best: 0 }, { lap: 1, place: 2, lapTime: 0, best: 0 }] };
  const view = extensionHud(state, race, [{ name: "Me" }, { name: "Bob" }], { t: (s, ...a) => a.reduce((x, v, i) => x.replace(`<<${i + 1}>>`, v), s), formatRaceTime: String, watched: 0 }, { events: 0 });
  assert.ok(view.rows.some(([label]) => label === "Engine:"));
  // The damage in colour; a space before the credits.
  const engine = view.rows.find(([label]) => label === "Engine:")[1];
  assert.deepEqual(engine, [{ text: "100%", color: "#4fe05a" }]);
  const credits = view.rows.findIndex(([label]) => label === "Credits:");
  assert.deepEqual(view.rows[credits - 1], ["", ""]);
  assert.ok(view.flashes.some((f) => f.includes("lost its rear right wheel")));
  assert.ok(view.flashes.some((f) => f === "You wrecked Bob!"));
  assert.deepEqual(view.sounds, [{ kind: "yeehaw", truck: 0 }]);
  assert.equal(extensionTruckOut(state, 1), true);
  assert.equal(extensionTruckOut(state, 0), false);
  assert.equal(extensionKeyAction(state, 0).message, "Your truck needs no repair");
  c.trucks[0].global = 500;
  assert.deepEqual(extensionKeyAction({ ...state, trucks: [combatTruckView(c, 0)] }, 0), { action: "repair" });
  // The names over the trucks carry the hit points in colour; a wreck's says so.
  const labels = extensionTruckLabels(state, [{ name: "Me" }, { name: "Bob" }], (e) => e.name);
  assert.deepEqual(labels[0], [[{ text: "Me " }, { text: "100%", color: "#4fe05a" }]]);
  assert.deepEqual(labels[1], ["Bob", "Wrecked"]);
});

test("a Combat race in the worker: a hit takes a wheel off and throws it loose, a wreck leaves the race, the last truck wins", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const files = Object.keys(build.truckModels);
  const grid = build.sim.grid;
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0?.buffer, ra1: build.sim.ra1?.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, course: build.sim.course,
    trucks: [0, 1].map((i) => ({
      truck: { anchors: build.truckModels[files[i]].anchors, scrapePoints: build.truckModels[files[i]].scrapePoints },
      start: { pos: grid[i * 4].pos, heading: grid[i * 4].heading }, autopilot: true,
    })),
    race: { checkpoints: build.sim.checkpoints, laps: 3, mode: "circuit" },
    // No credits: a computer truck would buy its wheel straight back.
    extension: { mode: "combat", laps: 3, toughness: "normal", credits: true, startCredits: 0, aggression: "low" },
  });
  const { combat: c, per } = session.extension;
  assert.ok(session.trucks.every((t) => t.ctx.ground.lostWheels), "each truck drives on its own ground");
  let r;
  for (let t = 0; t < 5; t += 0.25) r = session.advance(t, {});
  assert.ok(r.race.started);
  // Truck 1, half gone with its front right wheel worn out, is struck hard in front.
  const t1 = c.trucks[1];
  t1.global = COMBAT_HP.global * 0.45;
  t1.wheels[0] = 0;
  const kick = () => { per[1].prevVel = [0, 0, 0]; session.trucks[1].state.bvel.set([0, 0, -60]); session.trucks[1].state.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); };
  kick();
  for (let k = 0; k < 4; k++) session.step({});
  assert.equal(t1.lost.some(Boolean), true, `a wheel off: ${t1.lost}`);
  const view = session.raceView().extension;
  assert.equal(view.loose.length, 1);
  assert.equal(view.lost[1].some(Boolean), true);
  assert.ok(view.log.some((e) => e.kind === "wheel" && e.truck === 1));
  // A lost wheel gives no grip.
  session.step({});
  const w = view.loose[0].wheel;
  assert.equal(session.trucks[1].state.tires[w].grip, 0);
  // Wrecked: out of the race, and the last truck running wins it.
  t1.global = 1;
  kick();
  for (let k = 0; k < 4; k++) session.step({});
  assert.equal(t1.wrecked, true);
  assert.equal(session.race.trucks[1].outOfRace, true);
  const after = session.raceView();
  assert.equal(after.extension.out[1], true);
  assert.equal(after.extension.over, true);
  assert.equal(after.extension.winner, 0);
  assert.equal(after.trucks[0].place, 1);
});

test("the repair key in the worker: the player's credits buy its repair", { skip: skipWithoutStock("POD.INI") }, async () => {
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const files = Object.keys(build.truckModels);
  const grid = build.sim.grid;
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0?.buffer, ra1: build.sim.ra1?.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, course: build.sim.course,
    trucks: [0, 1].map((i) => ({
      truck: { anchors: build.truckModels[files[i]].anchors, scrapePoints: build.truckModels[files[i]].scrapePoints },
      start: { pos: grid[i * 4].pos, heading: grid[i * 4].heading }, autopilot: i === 1,
    })),
    race: { checkpoints: build.sim.checkpoints, laps: 3, mode: "circuit" },
    extension: { mode: "combat", laps: 3, toughness: "normal", credits: true, startCredits: 2000, aggression: "low" },
  });
  for (let t = 0; t < 5; t += 0.25) session.advance(t, {});
  const c = session.extension.combat;
  c.trucks[0].global = 400;
  session.step({ modeAction: "repair" });
  assert.equal(c.trucks[0].global, COMBAT_HP.global);
  assert.ok(c.trucks[0].credits < 2000);
  assert.ok(c.log.some((e) => e.kind === "repair" && e.truck === 0));
  // Leaving the fight: out, and the other truck is the last standing.
  session.step({ modeAction: "quit" });
  assert.equal(c.trucks[0].quit, true);
  session.step({});
  assert.equal(session.raceView().extension.winner, 1);
});

test("a wreck tears off the struck end's axle: its wheels still on fly, one or two, and the axle counts as lost", async () => {
  const { applyHit, axlesLost, combatTruckView, createCombat, wreckShed } = await import("../src/game/extensions/combat.js");
  const c = createCombat(1);
  const t = c.trucks[0];
  t.global = 1;
  const out = applyHit(c, 0, { kind: "front", amount: 50, side: 1, end: 1 });
  assert.ok(out.wrecked);
  assert.deepEqual(out.wheelsOff.sort(), [0, 1], "both front wheels");
  assert.deepEqual(axlesLost(combatTruckView(c, 0)), [true, false]);
  // The struck axle already bare: the other one goes, with the one wheel it has left.
  const bare = { lost: [true, true, false, true] };
  assert.deepEqual(wreckShed(bare, 1), [2]);
  assert.deepEqual(bare.lost, [true, true, true, true]);
  assert.deepEqual(wreckShed(bare, 1), [], "nothing left to tear off");
  assert.deepEqual(axlesLost({ wrecked: false, wheels: [-1, -1, 1, 1] }), [false, false], "only a wreck loses an axle");
});

test("Combat's lift back to a checkpoint: only for a truck that drove through its stretch, never one at the start", () => {
  // Castle Nugget: 90 stretches, the first checkpoint on stretch 88, the grid on stretch 0.
  assert.equal(pastCheckpoint(0, 88, 90), true, "by the numbers alone, stretch 0 is past 88");
  assert.equal(droveThrough(0, 0, 88, 90), false, "at the start it has driven nowhere");
  assert.equal(droveThrough(0, 81, 88, 90), false, "the off-course re-pick to stretch 81 is still short of it");
  assert.equal(droveThrough(0, 89, 88, 90), true, "on past stretch 88 without the gate");
  // From a checkpoint on stretch 10 to the next on 14.
  assert.equal(droveThrough(10, 4, 14, 90), false);
  assert.equal(droveThrough(10, 5, 14, 90), true);
});
