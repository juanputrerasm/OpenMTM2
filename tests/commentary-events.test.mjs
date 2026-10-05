import test from "node:test";
import assert from "node:assert/strict";
import { createCommentaryWatcher } from "../src/game/commentary-events.js";

const truck = (over = {}) => ({ pos: [0, 0, 0], up: 1, sound: { airborne: 0, clearance: 6, impact: 0, splash: false, heli: false }, ...over });
const frame = (now, places, over = {}, truckOver = {}) => ({
  now,
  race: { started: now >= 3, countdown: Math.max(0, 3 - now), over: false, trucks: places.map((p) => ({ place: p, finished: false, missed: false, ...over })) },
  trucks: places.map((_, i) => (i === 0 ? truck(truckOver) : truck({ pos: [200 * i, 0, 0] }))),
});
const groups = (events) => events.map((e) => e.group);

test("the start: an intro while the lights are red, GO as they go green, each once", () => {
  const w = createCommentaryWatcher({ drivers: 3 });
  assert.deepEqual(groups(w.update(frame(0.5, [1, 2, 3]))), ["introRace"]);
  assert.deepEqual(groups(w.update(frame(1.5, [1, 2, 3]))), []);
  assert.deepEqual(groups(w.update(frame(3.1, [1, 2, 3]))), ["go"]);
  assert.deepEqual(groups(w.update(frame(3.2, [1, 2, 3]))), []);
  assert.deepEqual(groups(createCommentaryWatcher({ drivers: 3, summit: true }).update(frame(0.5, [1, 2, 3]))), ["introSummit"]);
});

test("places: gaining one passes the truck now behind, the lead is a lead change, losing one names the passer", () => {
  const w = createCommentaryWatcher({ drivers: 3 });
  w.update(frame(0.5, [3, 1, 2]));
  w.update(frame(3.1, [3, 1, 2]));
  const passed = w.update(frame(12, [2, 1, 3]));
  assert.deepEqual(passed.map((e) => [e.group, e.args]), [["pass", [1, 3]]]);
  const lead = w.update(frame(20, [1, 2, 3]));
  assert.deepEqual(lead.map((e) => [e.group, e.args]), [["takeLead", [1]]]);
  const lost = w.update(frame(30, [2, 1, 3]));
  assert.deepEqual(lost.map((e) => [e.group, e.args]), [["takeLead", [2]]]);
  const lost2 = w.update(frame(40, [3, 1, 2]));
  assert.deepEqual(lost2.map((e) => [e.group, e.args]), [["pass", [3, 1]]]);
  // Too soon after the last change: nothing.
  assert.deepEqual(groups(w.update(frame(42, [2, 1, 3]))), []);
});

test("the player's truck: hard hits, air, water, a flip, the helicopter, a missed checkpoint", () => {
  const w = createCommentaryWatcher({ drivers: 2 });
  w.update(frame(3.1, [1, 2]));
  const sound = (over) => ({ airborne: 0, clearance: 6, impact: 0, splash: false, heli: false, ...over });
  assert.deepEqual(groups(w.update(frame(4, [1, 2], {}, { sound: sound({ impact: 20000 }) }))), ["wipeout"]);
  // Another truck close by: a clash.
  const near = frame(5, [1, 2], {}, { sound: sound({ impact: 5000 }) });
  near.trucks[1].pos = [10, 0, 0];
  assert.deepEqual(near.trucks.length && groups(w.update(near)), ["clash"]);
  assert.deepEqual(groups(w.update(frame(6, [1, 2], {}, { sound: sound({ splash: true }) }))), ["water"]);
  let events = [];
  for (let t = 7; t < 8.6; t += 0.2) events = events.concat(w.update(frame(t, [1, 2], {}, { sound: sound({ airborne: 4, clearance: 30 }) })));
  assert.ok(groups(events).includes("air") && groups(events).every((g) => g === "air"));
  for (let t = 9; t < 11.6; t += 0.5) events = events.concat(w.update(frame(t, [1, 2], {}, { up: -1 })));
  assert.ok(groups(events).includes("flipped"));
  assert.deepEqual(groups(w.update(frame(12, [1, 2], {}, { sound: sound({ heli: true }) }))), ["helicopter"]);
  assert.deepEqual(groups(w.update(frame(13, [1, 2], { missed: true }))), ["missedCheckpoint"]);
  assert.deepEqual(groups(w.update(frame(14, [1, 2], { missed: true }))), [], "once");
});

test("finishes: the first truck home is the winner, then the player's own finish if it was not first", () => {
  const w = createCommentaryWatcher({ drivers: 3 });
  w.update(frame(3.1, [1, 2, 3]));
  const f = frame(60, [1, 2, 3]);
  f.race.trucks[1].finished = true;
  assert.deepEqual(w.update(f).map((e) => [e.group, e.args]), [["finishWinner", [2, 2]]]);
  const g = frame(65, [1, 2, 3]);
  g.race.trucks[1].finished = g.race.trucks[0].finished = true;
  assert.deepEqual(w.update(g).map((e) => e.group), ["hasFinished"]);
});
