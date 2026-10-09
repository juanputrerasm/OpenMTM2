import test from "node:test";
import assert from "node:assert/strict";
import { END_COOLDOWN_SECONDS, WAIT_LIMIT_SECONDS, createRaceEnd } from "../src/game/race-end.js";

const view = (clock, ...finished) => ({ clock, trucks: finished.map((f, i) => ({ finished: !!f, place: i + 1 })) });

test("nothing happens while the player is still racing, even if a CPU truck has finished", () => {
  const end = createRaceEnd();
  const r = end.update(view(100, 0, 1, 0));
  assert.deepEqual([r.done, r.playerFinished, r.target], [false, false, 0]);
});

test("the player finishing sends the camera to the RaceCam once, and the race goes on", () => {
  const end = createRaceEnd();
  end.update(view(50, 0, 0, 0));
  const first = end.update(view(60, 1, 0, 0));
  assert.deepEqual([first.justFinished, first.playerFinished, first.done], [true, true, false]);
  assert.equal(end.update(view(61, 1, 0, 0)).justFinished, false);
});

test("when another truck finishes the camera moves to the best-placed truck still racing", () => {
  const end = createRaceEnd();
  end.update(view(60, 1, 0, 0, 0));
  const r = end.update(view(70, 1, 0, 1, 0));
  assert.equal(r.target, 1);
  assert.equal(end.update(view(80, 1, 1, 1, 0)).target, 3);
});

test("five seconds after the last truck finishes the results come, not before", () => {
  const end = createRaceEnd();
  end.update(view(60, 1, 0));
  assert.equal(end.update(view(62, 1, 1)).done, false);
  assert.equal(end.update(view(62 + END_COOLDOWN_SECONDS - 0.1, 1, 1)).done, false);
  assert.equal(end.update(view(62 + END_COOLDOWN_SECONDS, 1, 1)).done, true);
});

test("a stuck CPU truck cannot hold the results back for more than the guard's wait", () => {
  const end = createRaceEnd();
  end.update(view(60, 1, 0));
  assert.equal(end.update(view(60 + WAIT_LIMIT_SECONDS - 1, 1, 0)).done, false);
  assert.equal(end.update(view(60 + WAIT_LIMIT_SECONDS, 1, 0)).done, true);
});

test("a Summit Rumble ends with its round, with no cooldown", () => {
  const end = createRaceEnd({ summit: true });
  assert.equal(end.update(view(100, 0, 0)).done, false);
  assert.equal(end.update(view(200, 1, 0)).done, true);
});
