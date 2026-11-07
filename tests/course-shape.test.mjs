import test from "node:test";
import assert from "node:assert/strict";
import { COURSE_CORNER_RADIUS_FT, courseSegments, smoothCoursePath } from "../src/game/course-shape.js";

const square = [[[0, 0], [1000, 0]], [[1000, 0], [1000, 1000]], [[1000, 1000], [0, 1000]], [[0, 1000], [0, 0]]];

test("the course's straights are its type 1 entries, flat", () => {
  const course = [{ ctype: 1, startFt: [0, 5, 0], endFt: [10, 5, 20] }, { ctype: 2, startFt: [0, 0, 0], endFt: [1, 0, 1] }, { startFt: [10, 0, 20], endFt: [30, 0, 40] }];
  assert.deepEqual(courseSegments(course), [[[0, 0], [10, 20]], [[10, 20], [30, 40]]]);
});

test("a corner is rounded from the corner radius back along both runs, never through the corner itself", () => {
  const path = smoothCoursePath(square, true);
  assert.ok(path.length > 4 * 2, "curves between the runs");
  assert.deepEqual(path[0], path[path.length - 1], "a loop ends where it began");
  assert.ok(!path.some(([x, z]) => x === 1000 && z === 0), "the sharp corner is cut");
  assert.ok(path.some(([x, z]) => Math.abs(x - (1000 - COURSE_CORNER_RADIUS_FT)) < 1e-6 && Math.abs(z) < 1e-6), "the curve leaves the run at the radius");
  // Every point stays inside the square: a rounded corner cuts inside it.
  assert.ok(path.every(([x, z]) => x >= -1e-6 && x <= 1000 + 1e-6 && z >= -1e-6 && z <= 1000 + 1e-6));
});

test("a one-way course keeps its two ends", () => {
  const path = smoothCoursePath(square.slice(0, 2), false);
  assert.deepEqual(path[0], [0, 0]);
  assert.deepEqual(path[path.length - 1], [1000, 1000]);
});

test("a corner on short runs reaches back at most half of each", () => {
  const short = [[[0, 0], [100, 0]], [[100, 0], [100, 100]], [[100, 100], [0, 100]], [[0, 100], [0, 0]]];
  const path = smoothCoursePath(short, true);
  assert.ok(path.some(([x, z]) => Math.abs(x - 50) < 1e-6 && Math.abs(z) < 1e-6));
});
