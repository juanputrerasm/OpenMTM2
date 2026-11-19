import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { END_COOLDOWN_SECONDS, WAIT_LIMIT_SECONDS, cameraAfterEnd, createRaceEnd } from "../src/game/race-end.js";

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

test("in a headset the seat stays with the player's truck: the RaceCam's truck is the flat camera's only", () => {
  const race = readFileSync(new URL("../src/ui/screens/race.js", import.meta.url), "utf8");
  assert.match(race, /if \(host\.presenting\) vr\.place\(shown\[0\], dt, camera\);/);
  assert.match(race, /else placeCamera\(shown\[cameraTarget\] \?\? shown\[0\], dt\);/);
  assert.doesNotMatch(race, /vr\.place\([^)]*cameraTarget/);
});

test("the Camera key's truck stands while the race runs, and the finish takes the camera back (MONSTER_EXE_ANALYSIS.md 11)", () => {
  const end = createRaceEnd();
  const trucks = (finished) => [0, 1, 2].map((i) => ({ finished: finished.includes(i), place: i + 1 }));
  let camera = 0, last = 0;
  const tick = (clock, finished) => { const e = end.update({ clock, trucks: trucks(finished) }); camera = cameraAfterEnd(camera, e, last); last = e.target; };
  // K puts the camera on truck 2 mid-race; tick after tick it stays there.
  camera = 2;
  for (let c = 1; c <= 5; c++) tick(c, []);
  assert.equal(camera, 2);
  // The player finishes: the camera comes back to the player's truck.
  tick(6, [0]);
  assert.equal(camera, 0);
  // K again after the finish, then another truck finishes: the race end moves it to the best-placed truck still racing.
  camera = 1;
  tick(7, [0]);
  assert.equal(camera, 1);
  tick(8, [0, 1]);
  assert.equal(camera, 2);
});
