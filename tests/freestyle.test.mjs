import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, FREESTYLE_EXTENSION, JUDGE, createFreestyle, freestyleEnd, freestyleScore, freestyleStep, momentText } from "../src/game/extensions/freestyle.js";
import { extensionById, opponentsFor, soloExtension } from "../src/game/extensions/loader.js";
import { extensionHud, extensionResult, extensionResultTime } from "../src/game/extensions/race-loader.js";
import { createStrings } from "../src/game/strings.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

const DT = 1 / 60;
const t = createStrings();
const ALL = [true, true, true, true], NONE = [false, false, false, false];
/** A truck driving level at `speed` ft/s: the base of every sample, with the parts a test changes. */
const sample = (over = {}) => ({ pos: [0, 0, 0], up: 1, forwardY: 0, rightY: 0, speed: 40, forward: 40, rates: [0, 0, 0], wheels: ALL, reverse: false, heli: false, hit: null, ...over });
/** Run `seconds` of samples, `make(time)` giving each. */
const run = (g, seconds, make) => { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) freestyleStep(g, DT, make(i * DT)); };
const kinds = (g) => g.moments.map((m) => m.kind);
/** The last trick judged, past a combo it may have completed. */
const lastTrick = (g) => g.moments.filter((m) => m.kind !== "combo").at(-1)?.kind;

test("freestyle: the manifest is a solo mode on any track, minutes long", () => {
  assert.equal(extensionById("freestyle"), FREESTYLE_EXTENSION);
  assert.equal(FREESTYLE_EXTENSION.acceptsTrack({ file: "ANY.SIT" }), true);
  assert.equal(soloExtension(FREESTYLE_EXTENSION), true);
  assert.equal(soloExtension(extensionById("tag")), false);
  assert.deepEqual(opponentsFor(FREESTYLE_EXTENSION, ["A.TRK", "B.TRK"]), []);
  assert.deepEqual(opponentsFor(FREESTYLE_EXTENSION, 3), []);
  assert.deepEqual(opponentsFor(extensionById("tag"), ["A.TRK"]), ["A.TRK"]);
  assert.equal(FREESTYLE_EXTENSION.length.default, 2);
});

test("freestyle: the seven categories share the 10 points", () => {
  assert.equal(CATEGORIES.reduce((sum, c) => sum + c.weight, 0), 10);
  assert.deepEqual(CATEGORIES.map((c) => c.key), ["time", "momentum", "aggression", "air", "tricks", "saves", "spectacular"]);
});

test("freestyle: a jump scores by airtime, height, length and verticality; a huge one is spectacular", () => {
  const g = createFreestyle(120);
  run(g, 1, (time) => sample({ wheels: NONE, pos: [0, 10 * Math.sin(Math.PI * time), 60 * time] }));
  freestyleStep(g, DT, sample({ pos: [0, 0, 60] }));
  assert.deepEqual(kinds(g), ["jump"]);
  const jump = g.moments[0];
  assert.ok(jump.time >= 0.99 && jump.height > 9.9 && jump.length > 59, JSON.stringify(jump));
  assert.ok(Math.abs(g.raw.air - (JUDGE.airPerS * jump.time + JUDGE.airPerHeightFt * jump.height + JUDGE.airPerLengthFt * jump.length)) < 1e-9);
  assert.equal(g.raw.spectacular, 0);
  // Under half a second aloft is no jump.
  run(g, 0.3, () => sample({ wheels: NONE }));
  freestyleStep(g, DT, sample());
  assert.equal(g.moments.length, 1);
  // 50 ft up: huge air.
  run(g, 2, (time) => sample({ wheels: NONE, pos: [0, 50 * Math.sin(Math.PI * time / 2), 0] }));
  freestyleStep(g, DT, sample());
  assert.equal(g.moments.at(-1).kind, "hugeAir");
  assert.equal(g.raw.spectacular, 1);
});

test("freestyle: a wheelie held a second scores, a short one does not; a slap wheelie follows a landing", () => {
  const g = createFreestyle(120);
  const up = [false, false, true, true];
  run(g, 0.5, () => sample({ wheels: up, forwardY: 0.5 }));
  freestyleStep(g, DT, sample());
  assert.equal(g.raw.tricks, 0);
  run(g, 1.5, () => sample({ wheels: up, forwardY: 0.5 }));
  freestyleStep(g, DT, sample());
  assert.equal(lastTrick(g), "wheelie");
  assert.ok(g.raw.tricks > JUDGE.wheeliePoints);
  // A jump, then straight up on the rear wheels.
  run(g, 0.6, () => sample({ wheels: NONE }));
  run(g, 1.2, () => sample({ wheels: up, forwardY: 0.5 }));
  freestyleStep(g, DT, sample());
  assert.equal(lastTrick(g), "slapWheelie");
});

test("freestyle: a nose wheelie, a sky wheelie and a moonwalk", () => {
  const g = createFreestyle(120);
  run(g, 1, () => sample({ wheels: [true, true, false, false], forwardY: -0.5 }));
  freestyleStep(g, DT, sample());
  assert.equal(lastTrick(g), "stoppie");
  run(g, 1.2, () => sample({ wheels: [false, false, true, true], forwardY: 0.9 }));
  freestyleStep(g, DT, sample());
  assert.equal(lastTrick(g), "skyWheelie");
  run(g, 1.2, () => sample({ wheels: [false, false, true, true], forwardY: 0.5, forward: -8, reverse: true }));
  freestyleStep(g, DT, sample());
  assert.equal(lastTrick(g), "moonwalk");
  // A moonwalk is reversing with a purpose.
  freestyleEnd(g, 120);
  assert.equal(freestyleScore(g).deductions.reverse, 0);
});

test("freestyle: donuts count whole turns", () => {
  const g = createFreestyle(120);
  // 2.5 rad/s for 6 s: 15 rad, two whole turns.
  run(g, 6, () => sample({ speed: 15, rates: [0, 0, 2.5] }));
  assert.equal(g.donut.turns, 2);
  assert.equal(g.raw.tricks, 2 * JUDGE.donutPoints);
  assert.equal(momentText(t, g.moments.at(-1)), "Donuts x2!");
  // Too slow a turn is no donut.
  const slow = createFreestyle(120);
  run(slow, 6, () => sample({ speed: 15, rates: [0, 0, 1] }));
  assert.equal(slow.raw.tricks, 0);
});

test("freestyle: a back flip landed on the wheels scores and is spectacular; one landed on the roof is a crash", () => {
  const g = createFreestyle(120);
  // A full turn about the pitch axis in 1.2 s, the nose going up first.
  run(g, 1.2, (time) => sample({ wheels: NONE, rates: [0, -2 * Math.PI / 1.2, 0], forwardY: Math.sin(2 * Math.PI * time / 1.2), up: Math.cos(2 * Math.PI * time / 1.2) }));
  freestyleStep(g, DT, sample());
  assert.ok(kinds(g).includes("backFlip"), kinds(g).join());
  assert.equal(g.raw.tricks, JUDGE.flipPoints);
  assert.ok(g.raw.spectacular >= 1);
  // The same turn ending upside down.
  const c = createFreestyle(120);
  run(c, 1.2, (time) => sample({ wheels: NONE, rates: [0, -2 * Math.PI / 1.2, 0], forwardY: Math.sin(2 * Math.PI * time / 1.2) }));
  run(c, 2, () => sample({ wheels: NONE, up: -1 }));
  assert.equal(c.crashes, 1);
  assert.ok(!kinds(c).includes("backFlip"));
});

test("freestyle: a save is getting back on four wheels from the edge without going over", () => {
  const g = createFreestyle(120);
  run(g, 0.5, () => sample({ wheels: [true, false, true, false], up: 0.25, rightY: 0.9 }));
  freestyleStep(g, DT, sample());
  assert.equal(kinds(g).at(-1), "save");
  assert.equal(g.raw.saves, 1);
  run(g, 0.5, () => sample({ wheels: [true, false, true, false], up: 0.1, rightY: 0.99 }));
  freestyleStep(g, DT, sample());
  assert.equal(kinds(g).at(-1), "bigSave");
  assert.equal(g.raw.saves, 2.5);
});

test("freestyle: hits score by speed, one object again only after a while", () => {
  const g = createFreestyle(120);
  freestyleStep(g, DT, sample({ hit: { id: 7, force: 30 } }));
  freestyleStep(g, DT, sample({ hit: { id: 7, force: 30 } }));
  assert.equal(g.raw.aggression, 3);
  freestyleStep(g, DT, sample({ hit: { id: 8, force: 5 } }));
  assert.equal(g.raw.aggression, 3, "a touch is no hit");
  run(g, JUDGE.hitGapS, () => sample());
  freestyleStep(g, DT, sample({ hit: { id: 7, force: 100 } }));
  assert.equal(g.raw.aggression, 3 + JUDGE.hitMostFtS / 10);
});

test("freestyle: reversing costs points, unless a jump follows", () => {
  const g = createFreestyle(120);
  run(g, 4, () => sample({ reverse: true, forward: -10, speed: 10 }));
  run(g, 4, () => sample());
  freestyleEnd(g, 120);
  assert.equal(freestyleScore(g).deductions.reverse, 0.2);
  const jumped = createFreestyle(120);
  run(jumped, 4, () => sample({ reverse: true, forward: -10, speed: 10 }));
  run(jumped, 1, () => sample());
  run(jumped, 1, () => sample({ wheels: NONE }));
  run(jumped, 3, () => sample());
  freestyleEnd(jumped, 120);
  assert.equal(freestyleScore(jumped).deductions.reverse, 0);
});

test("freestyle: the helicopter is a crash, and the combo breaks", () => {
  const g = createFreestyle(120);
  freestyleStep(g, DT, sample({ heli: true }));
  freestyleStep(g, DT, sample({ heli: true }));
  assert.equal(g.crashes, 1);
  freestyleEnd(g, 120);
  assert.equal(freestyleScore(g).deductions.crashes, JUDGE.crashCost);
});

test("freestyle: the score is out of 10, using all the time counts, a stopped truck scores little", () => {
  // Driving fast the whole run and nothing else: time and momentum, 2.5.
  const cruise = createFreestyle(60);
  run(cruise, 60, () => sample());
  freestyleEnd(cruise, 60);
  assert.equal(freestyleScore(cruise).total, 2.5);
  // Half the time used: half the time points.
  const quit = createFreestyle(60);
  run(quit, 30, () => sample());
  freestyleEnd(quit, 30);
  assert.equal(freestyleScore(quit).categories.find((c) => c.key === "time").score, 0.5);
  // Parked: one stall, no momentum.
  const parked = createFreestyle(60);
  run(parked, 60, () => sample({ speed: 0, forward: 0 }));
  freestyleEnd(parked, 60);
  assert.equal(freestyleScore(parked).total, 1);
  // Every ceiling met: 10, and never more.
  const best = createFreestyle(60);
  Object.assign(best.raw, { aggression: 99, air: 999, tricks: 999, saves: 9, spectacular: 9 });
  run(best, 60, () => sample());
  freestyleEnd(best, 60);
  assert.equal(freestyleScore(best).total, 10);
});

test("freestyle: the HUD shows the clock, the score and the categories, and announces new moments", () => {
  const g = createFreestyle(120);
  run(g, 1, () => sample({ wheels: NONE }));
  freestyleStep(g, DT, sample());
  const score = freestyleScore(g);
  const state = { mode: "freestyle", left: 100, done: false, score: score.total, categories: score.categories, deductions: score.deductions, moments: g.moments, events: g.events };
  const race = { started: true, trucks: [{ place: 1 }] };
  const view = extensionHud(state, race, [{ name: "Me" }], { t, formatRaceTime: (s) => `${s}s` }, { events: 0, phase: "started" });
  assert.deepEqual(view.rows[0], ["Time Remaining:", "100s"]);
  assert.equal(view.rows[1][0], "Score:");
  assert.ok(view.flashes.includes("Big air!"));
  assert.equal(view.events, 1);
  // The results: one decimal, the breakdown, the time the run used.
  const result = extensionResult(state, 0, t);
  assert.equal(result.scoreText, score.total.toFixed(1));
  assert.equal(result.detail.length, 7);
  assert.equal(extensionResultTime("freestyle", 2, { extension: { left: 30 } }), 90);
});

test("Freestyle in the simulation worker: the clock runs out and the run is judged", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const { createSession } = await import("../src/worker/sim-worker.js");
  const build = await buildTrackRender(stockVfs(), "WORLD\\TPARK.SIT");
  const file = Object.keys(build.truckModels)[0];
  const grid = build.sim.grid;
  const session = createSession({
    heights: build.heights.buffer, clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer,
    ra0: build.sim.ra0?.buffer, ra1: build.sim.ra1?.buffer, boxes: build.sim.boxes, ramps: build.sim.ramps,
    waterLevelFt: build.waterLevelFt, weather: 0, difficulty: 1, course: build.sim.course,
    trucks: [{ truck: { anchors: build.truckModels[file].anchors, scrapePoints: build.truckModels[file].scrapePoints }, start: { pos: grid[0].pos, heading: grid[0].heading }, autopilot: false }],
    race: { checkpoints: [], laps: 1, mode: "circuit" }, extension: { mode: "freestyle", minutes: 1 },
  });
  let r;
  for (let time = 0; time < 30; time += 0.25) r = session.advance(time, { accelerate: true });
  assert.equal(r.race.extension.mode, "freestyle");
  assert.ok(r.race.extension.left < 60 && r.race.extension.left > 0);
  assert.ok(!r.race.over);
  for (let time = 30; time < 70; time += 0.25) r = session.advance(time, { accelerate: time % 8 < 6 });
  assert.ok(r.race.over && r.race.trucks.every((x) => x.finished));
  assert.ok(r.race.extension.done);
  assert.ok(r.race.extension.score > 0 && r.race.extension.score <= 10, `score ${r.race.extension.score}`);
  assert.equal(r.race.trucks[0].score, r.race.extension.score);
});
