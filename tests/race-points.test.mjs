import test from "node:test";
import assert from "node:assert/strict";
import { racePoints } from "../src/game/race-points.js";

test("a two lap race: the winner with the fastest lap gets 900 + 100 + 50, the rest their base", () => {
  const rows = [{ place: 1, best: 184.23 }, { place: 2, best: 223.25 }, { place: 3, best: 227.51 }, { place: 4, best: 227.17 }];
  assert.deepEqual(racePoints(rows, 2), [1050, 700, 500, 400]);
});

test("a single lap race gives the base only", () => {
  assert.deepEqual(racePoints([{ place: 1, best: 320 }, { place: 2, best: 330 }], 1), [900, 700]);
});

test("the fastest lap bonus goes to the fastest alone; a tie or no times give none", () => {
  assert.deepEqual(racePoints([{ place: 1, best: 200 }, { place: 2, best: 190 }], 3), [933, 800]);
  assert.deepEqual(racePoints([{ place: 1, best: 200 }, { place: 2, best: 200 }], 3), [933, 700]);
  assert.deepEqual(racePoints([{ place: 1, best: 0 }, { place: 9, best: 0 }], 3), [933, 0]);
});
