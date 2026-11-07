/*
  Deathmatch (docs/EXTENSIONS.md): any track, a timed round, a wreck dealt scores and one of its own costs, places by
  score, the spawn spots (along a course, on the start slots or at random), the start spread out, the respawn with its
  hold and protection, credits only for attacking and repairs off by default, the computer hunters, the HUD and the
  results, the network mapping, and a worker session played through the generic extension payload.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEATHMATCH_EXTENSION, DM_REWARDS, HELI, RESPAWN, SPAWN, heliRefusal, coursePoints, deathmatchFromWire, deathmatchOwnFromWire, deathmatchOwnToWire,
  deathmatchPlaces, deathmatchToWire, goodSpot, levelRect, pickSpawn, scoreOf, spawnSpots, startSpots, thin,
} from "../src/game/extensions/deathmatch.js";
import { DM_AI, backPoint, createHunter, hunterHit, hunterStep, pickPrey } from "../src/game/extensions/deathmatch-ai.js";
import { COMBAT_EXTENSION, COMBAT_HP, combatTruckView, createCombat, creditDamage, creditProgress, revive, wreck } from "../src/game/extensions/combat.js";
import { EXTENSIONS, extensionById, extensionSettingDefaults, usesCombatDamage } from "../src/game/extensions/loader.js";
import {
  extensionHud, extensionKeyAction, extensionNetOwnFromWire, extensionNetOwnToWire, extensionResult, extensionTruckOut, prepareExtensionRace,
} from "../src/game/extensions/race-loader.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

const t = (s, ...a) => a.reduce((x, v, i) => x.replace(`<<${i + 1}>>`, v), s);
const flat = () => 20;

test("Deathmatch is an extension on any track, timed in minutes, with Combat's damage and the X key", () => {
  assert.ok(EXTENSIONS.includes(DEATHMATCH_EXTENSION));
  for (const raceType of ["circuit", "rally", "summit", "drag", "freeroam"]) assert.equal(DEATHMATCH_EXTENSION.acceptsTrack({ raceType }), true, raceType);
  assert.equal(DEATHMATCH_EXTENSION.acceptsTrack({ raceType: "circuit", freeRoamOnly: true }), true);
  assert.equal(DEATHMATCH_EXTENSION.keepsRace, false);
  assert.equal(DEATHMATCH_EXTENSION.length.key, "minutes");
  assert.equal(DEATHMATCH_EXTENSION.length.default, 5);
  assert.equal(DEATHMATCH_EXTENSION.minEntrants, 2);
  assert.equal(DEATHMATCH_EXTENSION.damageKey, "repair");
  assert.equal(DEATHMATCH_EXTENSION.watchWhenOut, true);
  assert.equal(usesCombatDamage("deathmatch"), true);
  assert.equal(usesCombatDamage("combat"), true);
  assert.equal(usesCombatDamage("tag"), false);
  assert.equal(extensionById("deathmatch"), DEATHMATCH_EXTENSION);
  // Respawn on and repairs off by default.
  const defaults = extensionSettingDefaults().deathmatch;
  assert.equal(defaults.respawn, true);
  assert.equal(defaults.repairs, false);
  assert.equal(defaults.minutes, 5);
  assert.equal(defaults.toughness, "normal");
  assert.equal(defaults.helicopter, false, "the Helicopter key is off by default");
  assert.equal(COMBAT_EXTENSION.combatDamage, true);
  // The computer trucks' repairs can only be switched on with repairs (Combat: with credits) on.
  assert.equal(DEATHMATCH_EXTENSION.settings.find((s) => s.key === "cpuRepairs").enabledBy, "repairs");
  assert.equal(COMBAT_EXTENSION.settings.find((s) => s.key === "cpuRepairs").enabledBy, "credits");
});

test("the Helicopter key: off by default; on, only for a truck stuck that no one is attacking", () => {
  const stuck = { running: true, stillS: HELI.stuckS, overS: 0, lastTouchS: Infinity, nearestFt: Infinity };
  assert.equal(heliRefusal(false, stuck), "off");
  assert.equal(heliRefusal(true, stuck), null);
  assert.equal(heliRefusal(true, { ...stuck, stillS: 1 }), "moving", "driving along is not stuck");
  assert.equal(heliRefusal(true, { ...stuck, stillS: 0, overS: HELI.overS }), null, "on its roof is stuck");
  assert.equal(heliRefusal(true, { ...stuck, lastTouchS: 2 }), "attacked", "touched by a truck lately");
  assert.equal(heliRefusal(true, { ...stuck, nearestFt: 50 }), "attacked", "a truck close by");
  assert.equal(heliRefusal(true, { ...stuck, running: false }), "out");
});

test("the score: a wreck dealt counts one, a wreck of its own takes one off; places by score, damage dealt, fewest wrecked", () => {
  assert.equal(scoreOf(3, 1), 2);
  assert.equal(scoreOf(0, 2), -2, "a score can go under nothing");
  const places = deathmatchPlaces([
    { score: 1, dealt: 900, deaths: 2 },
    { score: 2, dealt: 100, deaths: 5 },
    { score: 1, dealt: 900, deaths: 1 },
    { score: 1, dealt: 1200, deaths: 4 },
    { score: 1, dealt: 900, deaths: 1 },
  ]);
  assert.deepEqual(places, [5, 1, 3, 2, 4]);
});

test("credits only for attacking: none for checkpoints or laps, 1 a hit point and 250 a wreck; a truck comes back whole", () => {
  const c = createCombat(2, { credits: true, startCredits: 0, rewards: DM_REWARDS });
  creditProgress(c, 0, 5, 1);
  assert.equal(c.trucks[0].credits, 0);
  creditDamage(c, 0, 120, true);
  assert.equal(c.trucks[0].credits, 120 + 250);
  assert.equal(c.trucks[0].wrecks, 1);
  // Combat's own table is unchanged.
  const combat = createCombat(1, { startCredits: 0 });
  creditProgress(combat, 0, 1, 1);
  assert.equal(combat.trucks[0].credits, 250);
  // A wreck comes back with every pool full and every wheel on; what it earned is kept.
  const v = c.trucks[1];
  Object.assign(v, { global: 0, engine: 10, gearbox: 0, wheels: [0, 0, 5, 5], lost: [true, true, false, false], credits: 40, dealt: 70, wrecks: 2 });
  wreck(c, 1, 0);
  revive(c, 1);
  assert.equal(v.wrecked, false);
  assert.equal(v.global, COMBAT_HP.global);
  assert.deepEqual(v.lost, [false, false, false, false]);
  assert.deepEqual(v.wheels, [COMBAT_HP.wheel, COMBAT_HP.wheel, COMBAT_HP.wheel, COMBAT_HP.wheel]);
  assert.equal(v.credits, 40);
  assert.equal(v.dealt, 70);
  assert.equal(v.wrecks, 2);
  assert.ok(!c.order.includes(1));
  assert.equal(c.log.at(-1).kind, "revive");
});

test("spawn spots along a course, every 120 ft of its straights, facing along them; on start slots; at random elsewhere", () => {
  const course = [{ startFt: [1000, 20, 1000], endFt: [1000, 20, 1600] }, { startFt: [1000, 20, 1600], endFt: [1600, 20, 1600] }];
  const along = coursePoints(course);
  assert.equal(along.length, 10);
  assert.ok(Math.abs(along[0].heading) < 1e-9, "the first straight runs along +z");
  assert.ok(Math.abs(along[9].heading - Math.PI / 2) < 1e-9);
  const onCourse = spawnSpots({ kind: "course", course, heightAt: flat });
  assert.equal(onCourse.length, 10);
  assert.ok(onCourse.every((s) => s.pos[1] === 20 + SPAWN.rideFt), "set down over the ground");
  const slots = [{ pos: [100, 30, 100], heading: 1 }, { pos: [300, 30, 100], heading: 2 }];
  assert.deepEqual(spawnSpots({ kind: "slots", slots, heightAt: flat }).map((s) => s.heading), [1, 2]);
  // No course: at random over the level, the same for the same seed.
  const a = spawnSpots({ kind: "random", slots: [{ pos: [4000, 0, 4000], heading: 0 }], heightAt: flat, seed: 7 });
  const b = spawnSpots({ kind: "random", slots: [{ pos: [4000, 0, 4000], heading: 0 }], heightAt: flat, seed: 7 });
  assert.equal(a.length, SPAWN.randomCount);
  assert.deepEqual(a, b);
  // A course with too few straights falls back to the level.
  assert.equal(spawnSpots({ kind: "course", course: [], heightAt: flat, seed: 3 }).length, SPAWN.randomCount);
  assert.ok(thin(a, 10).length === 10);
});

test("a spawn spot is on ground no steeper than 0.6, dry, and clear of the level's objects", () => {
  assert.equal(goodSpot([500, 0, 500], flat, null), true);
  assert.equal(goodSpot([500, 0, 500], (x) => x * 0.8, null), false, "too steep");
  assert.equal(goodSpot([500, 0, 500], flat, 20), false, "under water");
  assert.equal(goodSpot([500, 0, 500], flat, 10), true);
  assert.equal(goodSpot([500, 0, 500], flat, null, [{ pos: [510, 0, 500], reach: 10 }]), false, "beside an object");
  assert.equal(goodSpot([500, 0, 500], flat, null, [{ pos: [560, 0, 500], reach: 10 }]), true);
  // The level's rectangle: its objects and slots with a margin, at least 1200 ft; the terrain with none.
  const r = levelRect([[1000, 0, 1000], [1100, 0, 1100]]);
  assert.ok(r.maxX - r.minX >= 1200 && r.maxZ - r.minZ >= 1200);
  assert.deepEqual(levelRect([]), { minX: 64, maxX: 8128, minZ: 64, maxZ: 8128 });
});

test("the start: each grid slot on its own spot, as far apart as they go, facing the middle; the same every time", () => {
  const spots = Array.from({ length: 20 }, (_, k) => ({ pos: [k * 100, 0, 0], heading: 0 }));
  const starts = startSpots(spots, 4, [0, 0, 0]);
  assert.equal(starts.length, 4);
  // 1400 is 500 ft from those taken, 400 only 400 ft.
  assert.deepEqual(starts.map((s) => s.pos[0]), [0, 1900, 900, 1400]);
  assert.ok(Math.abs(starts[0].heading - Math.PI / 2) < 1e-9, "the first faces the middle, toward +x");
  assert.deepEqual(startSpots(spots, 4, [0, 0, 0]), starts);
  // More slots than spots: the rest stand beside them.
  assert.equal(startSpots(spots.slice(0, 2), 3, null).length, 3);
});

test("a respawn takes a spot 400 ft from every truck, else the farthest, and faces the nearest truck", () => {
  const spots = [{ pos: [0, 0, 0], heading: 0 }, { pos: [300, 0, 0], heading: 0 }, { pos: [1000, 0, 0], heading: 0 }];
  const far = pickSpawn(spots, [[100, 0, 0]], 0);
  assert.deepEqual(far.pos, [1000, 0, 0]);
  assert.ok(Math.abs(far.heading + Math.PI / 2) < 1e-9, "turned toward the truck, to -x");
  // None far enough: the one farthest from its nearest truck.
  assert.deepEqual(pickSpawn(spots, [[0, 0, 0], [1000, 0, 0]], 0).pos, [300, 0, 0]);
  assert.equal(pickSpawn([], [], 0), null);
  assert.ok(RESPAWN.lieS === 5 && RESPAWN.holdS === 1 && RESPAWN.protectS === 3 && RESPAWN.farFt === 400);
});

test("a computer hunter picks the weakest prey in reach, never a protected one, keeps it, rams close in and backs off after a hit", () => {
  const self = { pos: [0, 0, 0], hp: 1 };
  const o = (index, x, extra = {}) => ({ index, pos: [x, 0, 0], vel: [0, 0, 0], hp: 1, wheels: 4, leader: false, running: true, protected: false, ...extra });
  assert.equal(pickPrey(self, [o(1, 200), o(2, 300, { hp: 0.2 })]), 2, "the weaker one");
  assert.equal(pickPrey(self, [o(1, 200, { protected: true }), o(2, 300)]), 2, "not a truck just set down");
  assert.equal(pickPrey(self, [o(1, 5000), o(2, 3000)]), 2, "out of reach: the nearest");
  assert.equal(pickPrey(self, [o(1, 200, { running: false })]), -1);
  const m = createHunter();
  let step = hunterStep(m, self, [o(1, 600), o(2, 700)], { now: 0, roll: 0 });
  assert.deepEqual(step, { mode: "chase", target: 1 });
  // Kept for a while though another is a little better.
  step = hunterStep(m, self, [o(1, 600), o(2, 590)], { now: 1, roll: 0 });
  assert.equal(step.target, 1);
  step = hunterStep(m, self, [o(1, 100), o(2, 590)], { now: 2 });
  assert.equal(step.mode, "ram");
  hunterHit(m, 2);
  assert.equal(hunterStep(m, self, [o(1, 100), o(2, 590)], { now: 3 }).mode, "back");
  assert.equal(hunterStep(m, self, [o(1, 100), o(2, 590)], { now: 2 + DM_AI.backS.normal + 0.1 }).mode, "ram");
  assert.deepEqual(backPoint([0, 0, 0], [10, 0, 0]), [-DM_AI.backFt, 0, 0]);
  // Hurt, it runs from the nearest truck, except at High.
  assert.equal(hunterStep(createHunter(), { pos: [0, 0, 0], hp: 0.2 }, [o(1, 300)], { now: 0 }).mode, "flee");
  assert.equal(hunterStep(createHunter(), { pos: [0, 0, 0], hp: 0.2 }, [o(1, 300)], { now: 0, aggression: "high" }).mode, "chase");
  assert.equal(hunterStep(createHunter(), self, [], { now: 0 }).mode, "wander");
});

const dmState = (c, extra = {}) => ({
  mode: "deathmatch", credits: true, repairs: false, respawn: true, left: 200, trucks: [combatTruckView(c, 0), combatTruckView(c, 1)],
  scores: [0, 0], selfWrecks: [0, 0], deaths: [0, 0], respawns: [0, 0], respawnIn: [null, null], protected: [0, 0],
  log: [], events: 0, out: [false, false], over: false, winner: -1, ...extra,
});
const race2 = { trucks: [{ place: 1 }, { place: 2 }] };
const names = [{ name: "Me" }, { name: "Bob" }];

test("the HUD: time, score and place, the truck's state, credits; every wreck told, a wreck of its own as -1; repairs off by default", () => {
  const c = createCombat(2, { startCredits: 0, rewards: DM_REWARDS });
  creditDamage(c, 0, 80, true);
  const state = dmState(c, {
    scores: [1, -1], selfWrecks: [0, 1], deaths: [0, 2], out: [false, true], respawnIn: [null, 3.2],
    log: [{ id: 1, kind: "wreck", truck: 1, by: 0 }, { id: 2, kind: "revive", truck: 1 }, { id: 3, kind: "wreck", truck: 1, by: -1 }], events: 3,
  });
  const hud = extensionHud(state, race2, names, { t, formatRaceTime: String, watched: 0 }, { events: 0 });
  const row = (label) => hud.rows.find(([l]) => l === label)?.[1];
  assert.equal(row("Time Remaining:"), "200");
  assert.equal(row("Score:"), "1");
  assert.equal(row("Place:"), "1/2");
  assert.equal(row("Credits:"), String(80 + 250));
  assert.equal(row("Repair (X):"), undefined, "no repair cost with repairs off");
  assert.ok(hud.flashes.includes("You wrecked Bob! +1"));
  assert.ok(hud.flashes.includes("Bob wrecked itself! -1"));
  assert.deepEqual(hud.sounds, [{ kind: "yeehaw", truck: 0 }]);
  assert.deepEqual(hud.repaired, [1], "a truck back whole loses its dents");
  // Watching the wreck: it comes back in a few seconds; a wreck is not out of the fight while it comes back.
  const wrecked = { ...state, trucks: [state.trucks[0], { ...state.trucks[1], wrecked: true }] };
  const bob = extensionHud(wrecked, race2, names, { t, formatRaceTime: String, watched: 1 }, { events: 3, phase: "started" });
  assert.deepEqual(bob.rows.find(([l]) => l === "Truck:")[1][0].text, "Back in 4");
  assert.equal(extensionTruckOut(state, 1), false);
  assert.equal(extensionTruckOut({ ...state, respawn: false }, 1), true, "without respawns a wreck is out");
  // X: no repairs unless they are on.
  c.trucks[0].global = 500;
  const hurt = dmState(c);
  assert.equal(extensionKeyAction(hurt, 0).message, "No repairs: they are off in Options");
  assert.deepEqual(extensionKeyAction({ ...hurt, repairs: true }, 0), { action: "repair" });
  const withRepairs = extensionHud({ ...hurt, repairs: true }, race2, names, { t, formatRaceTime: String }, { events: 0 });
  assert.ok(withRepairs.rows.some(([l]) => l === "Repair (X):"));
  // The Helicopter key's row only when Options allow it: ready when stuck and alone.
  assert.ok(!withRepairs.rows.some(([l]) => l === "Helicopter (H):"));
  const heli = extensionHud({ ...hurt, helicopter: true, heli: [null, "moving"] }, race2, names, { t, formatRaceTime: String }, { events: 0 });
  assert.deepEqual(heli.rows.find(([l]) => l === "Helicopter (H):")[1][0].text, "Ready");
  const attacked = extensionHud({ ...hurt, helicopter: true, heli: ["attacked", null] }, race2, names, { t, formatRaceTime: String }, { events: 0 });
  assert.deepEqual(attacked.rows.find(([l]) => l === "Helicopter (H):")[1][0].text, "Under attack");
  // The last minute is warned, the end names the winner.
  const late = extensionHud({ ...hurt, left: 50 }, race2, names, { t, formatRaceTime: String }, { events: 0, phase: "started" });
  assert.ok(late.flashes.includes("One minute left!"));
  const over = extensionHud({ ...hurt, over: true, winner: 1, scores: [0, 4] }, race2, names, { t, formatRaceTime: String }, { events: 0, phase: "minute" });
  assert.ok(over.flashes.includes("Bob wins with a score of 4!"));
});

test("the results: the score in the Points column, its parts and the damage dealt under the table", () => {
  const c = createCombat(2, { startCredits: 0, rewards: DM_REWARDS });
  creditDamage(c, 0, 432.4, true);
  creditDamage(c, 0, 0, true);
  const state = dmState(c, { scores: [1, 0], selfWrecks: [1, 0], deaths: [3, 2] });
  const mine = extensionResult(state, 0, t);
  assert.equal(mine.scoreText, "1");
  assert.deepEqual(mine.detail, ["Wrecks: 2", "Wrecked yourself: 1", "Times wrecked: 3", "Damage dealt: 432"]);
  assert.equal(extensionResult(state, 1, t).detail, undefined);
});

test("the race data: the spawn spots go to the simulation, and each truck starts on its own by its grid slot", () => {
  const course = [{ startFt: [1000, 20, 1000], endFt: [1000, 20, 3000] }];
  const grid = Array.from({ length: 4 }, (_, k) => ({ pos: [1000 + k * 10, 26, 1000], heading: 0 }));
  const build = { sim: { course, grid, boxes: [] }, waterLevelFt: null };
  const entrants = [{ slot: 2 }, { slot: 0 }];
  const settings = extensionSettingDefaults().deathmatch;
  const prepared = prepareExtensionRace(DEATHMATCH_EXTENSION, { build, entrants, length: 7, settings, groundHeightAt: flat, raceType: "circuit", grid });
  const sim = prepared.simulation;
  assert.equal(sim.mode, "deathmatch");
  assert.equal(sim.minutes, 7);
  assert.equal(sim.respawn, true);
  assert.equal(sim.repairs, false);
  assert.equal(sim.cpuRepairs, false, "no computer repairs with repairs off, whatever their own switch");
  assert.equal(sim.helicopter, false);
  const on = prepareExtensionRace(DEATHMATCH_EXTENSION, { build, entrants, length: 7, settings: { ...settings, repairs: true }, groundHeightAt: flat, raceType: "circuit", grid });
  assert.equal(on.simulation.cpuRepairs, true);
  assert.ok(sim.spots.length >= 10 && sim.spots.every((s) => s.pos[0] === 1000), "along the course");
  const starts = startSpots(sim.spots, 4, grid[0].pos);
  assert.deepEqual(prepared.start(0, null), starts[2]);
  assert.deepEqual(prepared.start(1, null), starts[0]);
  assert.ok(Math.abs(prepared.start(0).pos[2] - prepared.start(1).pos[2]) > 500, "spread out, not on the grid");
  // A Summit Rumble's spots are its start slots; a free roam level's are at random.
  const summit = prepareExtensionRace(DEATHMATCH_EXTENSION, { build, entrants, length: 5, settings, groundHeightAt: flat, raceType: "summit", grid });
  assert.equal(summit.simulation.spots.length, 4);
  const roam = prepareExtensionRace(DEATHMATCH_EXTENSION, { build: { sim: { grid: grid.slice(0, 1) } }, entrants, length: 5, settings, groundHeightAt: flat, raceType: "freeroam", grid });
  assert.equal(roam.simulation.spots.length, SPAWN.randomCount);
});

test("over the network: the owner's end and rules, and each machine's trucks with their wrecks of their own and respawns", () => {
  const vehicleOf = (i) => i + 1, localOf = (v) => v - 1;
  const wire = deathmatchToWire({ over: true, winner: 1, rules: { toughness: "tough", respawn: false, repairs: true, helicopter: true } }, vehicleOf);
  assert.deepEqual(deathmatchFromWire(wire, localOf), { over: true, winner: 1, rules: { toughness: "tough", respawn: false, repairs: true, helicopter: true } });
  const own = {
    trucks: [{ g: 0.5, e: 1, b: 1, w: [1, 1, 1, 1], l: [false, false, false, false], cr: 300, d: 120, wk: 2, rp: 0, wr: false, q: false, by: -1, sw: 1, dt: 3, rs: 2 }, null],
    owed: [null, { hp: 40, wrecks: 1 }],
  };
  const back = extensionNetOwnFromWire("deathmatch", extensionNetOwnToWire("deathmatch", own, vehicleOf), localOf, 2);
  assert.equal(back.trucks[0].sw, 1);
  assert.equal(back.trucks[0].dt, 3);
  assert.equal(back.trucks[0].rs, 2);
  assert.equal(back.trucks[1], null);
  assert.deepEqual(back.owed[1], { hp: 40, wrecks: 1 });
  assert.deepEqual(deathmatchOwnFromWire(deathmatchOwnToWire(own, vehicleOf), localOf, 2), back);
});

/** A two-truck Deathmatch session on Tamarack Park through the generic extension payload. */
async function stockSession(extension, autopilot = [true, true]) {
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const { createSession } = await import("../src/worker/sim-worker.js");
  const { terrainOfBuild } = await import("../src/shared/build-terrain.js");
  const S = await import("../src/vendor/openphotex/sim/mtm2/index.js");
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const files = Object.keys(build.truckModels);
  const grid = build.sim.grid;
  const terrain = terrainOfBuild(build);
  const prepared = prepareExtensionRace(DEATHMATCH_EXTENSION, {
    build, entrants: [{ slot: 0 }, { slot: 4 }], length: extension.minutes ?? 1, settings: { ...extensionSettingDefaults().deathmatch, ...extension },
    groundHeightAt: (x, z) => S.groundHeightAt(terrain, x, z), raceType: "circuit", grid,
  });
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0?.buffer, ra1: build.sim.ra1?.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, course: build.sim.course,
    trucks: [0, 1].map((i) => ({
      truck: { anchors: build.truckModels[files[i]].anchors, scrapePoints: build.truckModels[files[i]].scrapePoints },
      start: prepared.start(i, { pos: grid[i * 4].pos, heading: grid[i * 4].heading }), autopilot: autopilot[i],
    })),
    race: { checkpoints: [], laps: 1, mode: "circuit" },
    extension: prepared.simulation,
  });
  return session;
}

test("Deathmatch in the worker: a wreck dealt scores, a wreck of its own costs one, the wreck comes back whole and protected", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await stockSession({ minutes: 1 });
  const { combat: c, per, selfWrecks, deaths, respawns, protectUntil } = session.extension;
  let r;
  for (let time = 0; time < 5; time += 0.25) r = session.advance(time, {});
  assert.ok(r.race.started);
  // Truck 1 is struck hard by nothing (a wall): it wrecked itself.
  const kick = () => { per[1].prevVel = [0, 0, 0]; per[1].met = null; session.trucks[1].state.bvel.set([0, 0, -90]); session.trucks[1].state.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); };
  c.trucks[1].global = 1;
  kick();
  for (let k = 0; k < 4; k++) session.step({});
  assert.equal(c.trucks[1].wrecked, true);
  assert.equal(selfWrecks[1], 1);
  assert.equal(deaths[1], 1);
  assert.equal(session.raceView().extension.scores[1], -1);
  assert.equal(session.raceView().trucks[1].score, -1);
  // It lies 5 s, then comes back whole, held a second and protected.
  for (let k = 0; k < 60 * (RESPAWN.lieS - 0.5); k++) session.step({});
  assert.equal(c.trucks[1].wrecked, true, "still lying there");
  for (let k = 0; k < 60; k++) session.step({});
  assert.equal(c.trucks[1].wrecked, false);
  assert.equal(respawns[1], 1);
  assert.equal(c.trucks[1].global, COMBAT_HP.global);
  assert.ok(protectUntil[1] > session.race.clock - session.race.startTime);
  const view = session.raceView().extension;
  assert.ok(view.protected[1] > 0);
  assert.ok(view.log.some((e) => e.kind === "revive" && e.truck === 1));
  // Protected: a hit takes nothing.
  kick();
  for (let k = 0; k < 4; k++) session.step({});
  assert.equal(c.trucks[1].global, COMBAT_HP.global);
  // A wreck dealt by truck 0 scores it one.
  for (let k = 0; k < 60 * (RESPAWN.protectS + 0.5); k++) session.step({});
  c.trucks[1].global = 1;
  wreck(c, 1, 0);
  creditDamage(c, 0, 1, true);
  assert.equal(session.raceView().extension.scores[0], 1);
});

test("Deathmatch in the worker: the round ends on time with places by score; without respawns the last truck ends it", { skip: skipWithoutStock("POD.INI") }, async () => {
  const session = await stockSession({ minutes: 1 });
  const c = session.extension.combat;
  let r;
  for (let time = 0; time < 5; time += 0.25) r = session.advance(time, {});
  creditDamage(c, 1, 50, true);
  for (let time = 5; time < 66; time += 0.25) r = session.advance(time, {});
  assert.ok(r.race.over, "the minute is up");
  assert.equal(r.race.extension.winner, 1);
  assert.equal(r.race.trucks[1].place, 1);
  // Respawn off: a wreck is out, and the last truck running ends the round.
  const once = await stockSession({ minutes: 5, respawn: false });
  for (let time = 0; time < 5; time += 0.25) once.advance(time, {});
  const oc = once.extension.combat;
  oc.trucks[1].global = 1;
  once.extension.per[1].prevVel = [0, 0, 0];
  once.trucks[1].state.bvel.set([0, 0, -90]);
  once.trucks[1].state.matrix.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (let k = 0; k < 4; k++) once.step({});
  assert.equal(oc.trucks[1].wrecked, true);
  for (let k = 0; k < 60 * 7; k++) once.step({});
  assert.equal(oc.trucks[1].wrecked, true, "no respawn");
  const end = once.raceView();
  assert.equal(end.extension.over, true);
  assert.equal(end.extension.out[1], true);
});

test("Deathmatch in the worker: the repair key works only with repairs on", { skip: skipWithoutStock("POD.INI") }, async () => {
  const off = await stockSession({ minutes: 1 }, [false, true]);
  for (let time = 0; time < 5; time += 0.25) off.advance(time, {});
  off.extension.combat.trucks[0].global = 400;
  off.extension.combat.trucks[0].credits = 5000;
  off.step({ modeAction: "repair" });
  assert.equal(off.extension.combat.trucks[0].global, 400);
  const on = await stockSession({ minutes: 1, repairs: true }, [false, true]);
  for (let time = 0; time < 5; time += 0.25) on.advance(time, {});
  on.extension.combat.trucks[0].global = 400;
  on.extension.combat.trucks[0].credits = 5000;
  on.step({ modeAction: "repair" });
  assert.equal(on.extension.combat.trucks[0].global, COMBAT_HP.global);
});

test("Deathmatch in the worker: the Helicopter key is refused by default, and on only when stuck and alone", { skip: skipWithoutStock("POD.INI") }, async () => {
  const off = await stockSession({ minutes: 1 }, [false, true]);
  for (let time = 0; time < 5; time += 0.25) off.advance(time, {});
  assert.equal(off.raceView().extension.heli[0], "off");
  off.step({ helicopter: true });
  assert.ok(!off.trucks[0].flight, "H does nothing with the helicopter off");
  const on = await stockSession({ minutes: 1, helicopter: true }, [false, false]);
  for (let time = 0; time < 5; time += 0.25) on.advance(time, {});
  const view = () => on.raceView().extension.heli[0];
  assert.equal(view(), "moving", "not stuck yet");
  // Standing still for longer than the stuck time, the other truck far off: it may be called.
  for (let k = 0; k < 60 * (HELI.stuckS + 0.5); k++) on.step({});
  const gap = Math.hypot(on.trucks[1].state.pos[0] - on.trucks[0].state.pos[0], on.trucks[1].state.pos[2] - on.trucks[0].state.pos[2]);
  assert.ok(on.extension.stillFor[0] >= HELI.stuckS, `still for ${on.extension.stillFor[0]}`);
  assert.equal(view(), gap < HELI.nearFt ? "attacked" : null, `gap ${gap}`);
  // A truck close by: refused.
  on.trucks[1].state.pos.set([on.trucks[0].state.pos[0] + 30, on.trucks[0].state.pos[1], on.trucks[0].state.pos[2]]);
  on.step({});
  assert.equal(view(), "attacked");
  on.step({ helicopter: true });
  assert.ok(!on.trucks[0].flight, "refused under attack");
  // Alone again (and not touched lately): H calls it, down on the nearest stretch of the course.
  on.trucks[1].state.pos.set([on.trucks[0].state.pos[0] + 2000, on.trucks[0].state.pos[1], on.trucks[0].state.pos[2]]);
  on.extension.per[0].met = null;
  on.step({});
  assert.equal(view(), null);
  on.step({ helicopter: true });
  assert.ok(on.trucks[0].flight, "the helicopter comes");
});
