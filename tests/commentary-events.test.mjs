/*
  When the announcer speaks (game/commentary-events.js, MONSTER_EXE_ANALYSIS.md 12): the game's triggers, only for the
  player's truck and the one the camera follows.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { AIR_FT, createCommentaryWatcher } from "../src/game/commentary-events.js";

const tire = (onGround = true, surface = 200) => ({ onGround, surface });
const truck = (over = {}, sound = {}) => ({
  pos: [0, 0, 0], up: 1, forwardY: 0, ...over,
  sound: { airborne: 0, clearance: 6, collide: 0, hit: null, heli: false, speed: 40, tires: [tire(), tire(), tire(), tire()], ...sound },
});
const frame = (now, places, { rt = {}, me = {}, sound = {}, watched = 0, ...rest } = {}) => ({
  now, watched, checkpoints: 8, weather: 0, lamps: places.map(() => 2), ...rest,
  race: { started: now >= 3, trucks: places.map((p) => ({ place: p, finished: false, missed: false, laps: 1, checkpoint: 2, ...rt })) },
  trucks: places.map((_, i) => (i === 0 ? truck(me, sound) : truck({ pos: [200 * i, 0, 0] }))),
});
const groups = (out) => out.map((e) => e.group);

test("the start and GO, once each; a Summit Rumble's own start; nothing in a drag race", () => {
  const w = createCommentaryWatcher({ drivers: 3 });
  assert.deepEqual(groups(w.update(frame(0.5, [1, 2, 3]))), ["introRace"]);
  assert.deepEqual(groups(w.update(frame(3.1, [1, 2, 3]))), ["go"]);
  assert.deepEqual(groups(w.update(frame(3.2, [1, 2, 3]))), []);
  assert.deepEqual(groups(createCommentaryWatcher({ drivers: 3, summit: true }).update(frame(0.5, [1, 2, 3]))), ["introSummit"]);
  assert.deepEqual(createCommentaryWatcher({ drivers: 2, drag: true }).update(frame(0.5, [1, 2])), []);
});

test("places: a new truck ahead is a move (the leader: going for the lead), a place gained a pass", () => {
  const w = createCommentaryWatcher({ drivers: 3 });
  w.update(frame(0.5, [3, 1, 2]));
  w.update(frame(3.1, [3, 1, 2]));
  const passed = w.update(frame(12, [2, 1, 3]));
  assert.deepEqual(passed.map((e) => [e.group, e.args]), [["goingYourWay", [1]], ["pass", [1, 3]]]);
  assert.deepEqual(w.update(frame(13, [2, 1, 3])), [], "nothing new");
  const lead = w.update(frame(20, [1, 2, 3]));
  assert.equal(lead.find((e) => e.group === "pass").ctx.passedLeader, true, "the truck passed had the lead");
});

test("a CPU truck nobody watches is never talked about; the watched one is", () => {
  const w = createCommentaryWatcher({ drivers: 3 });
  w.update(frame(0.5, [1, 2, 3]));
  w.update(frame(3.1, [1, 2, 3]));
  const heli = (k) => ({ ...frame(10, [1, 2, 3], { watched: k }), trucks: [truck(), truck({ pos: [200, 0, 0] }, { heli: true }), truck({ pos: [400, 0, 0] })] });
  assert.deepEqual(groups(w.update(heli(0))), [], "truck 2's helicopter, the camera on the player");
  const v = createCommentaryWatcher({ drivers: 3 });
  v.update(frame(0.5, [1, 2, 3], { watched: 1 }));
  v.update(frame(3.1, [1, 2, 3], { watched: 1 }));
  assert.deepEqual(v.update(heli(1)).map((e) => [e.group, e.args, e.ctx.camera]), [["flipped", [2], true]]);
});

test("the player's truck: air, water, frozen water, snow, a clash, a roll, the helicopter, a missed checkpoint, finishing", () => {
  const w = createCommentaryWatcher({ drivers: 2 });
  w.update(frame(0.5, [1, 2]));
  w.update(frame(3.1, [1, 2]));
  const off = [tire(false), tire(false), tire(false), tire(false)];
  assert.deepEqual(groups(w.update(frame(5, [1, 2], { sound: { airborne: 4, clearance: AIR_FT + 5, tires: off } }))), ["air"]);
  assert.deepEqual(groups(w.update(frame(6, [1, 2], { sound: { tires: [tire(true, 300), tire(), tire(), tire()] } }))), ["water"]);
  assert.deepEqual(groups(w.update(frame(7, [1, 2], { sound: { tires: [tire(true, 800), tire(), tire(), tire()] } }))), ["spin"]);
  assert.deepEqual(groups(w.update(frame(8, [1, 2], { sound: { tires: [tire(true, 900), tire(), tire(), tire()] } }))), ["ice"]);
  const clash = w.update(frame(9, [1, 2], { sound: { collide: 5000 } }));
  assert.deepEqual(clash.map((e) => [e.group, e.args]), [["clash", [1, 2]]]);
  assert.deepEqual(groups(w.update(frame(10, [1, 2], { me: { up: -0.5 }, sound: { speed: 40 } }))), ["roll"]);
  assert.deepEqual(groups(w.update(frame(11, [1, 2], { sound: { heli: true } }))), ["flipped"]);
  assert.deepEqual(groups(w.update(frame(12, [1, 2], { rt: { missed: true } }))), ["missedCheckpoint"]);
  assert.deepEqual(groups(w.update(frame(13, [1, 2], { rt: { finished: true } }))), ["finishWinner"]);
});

test("in the dark with no lamps: stealth mode", () => {
  const w = createCommentaryWatcher({ drivers: 2 });
  w.update(frame(0.5, [1, 2], { weather: 7, lamps: [0, 2] }));
  assert.deepEqual(groups(w.update(frame(3.1, [1, 2], { weather: 7, lamps: [0, 2] }))), ["go", "stealth"]);
});
