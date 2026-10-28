/*
  A computer racer cut off from its course takes another of the SIT's courses (game/course-route.js). Pure rules only.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { HALF_WIDTH_FT, OFF_COURSE_FT, PROBE_FT, joinedSegment, obstacleAhead, offCourse, pickRoute } from "../src/game/course-route.js";

const straight = (start, end, trackWidth = 16) => ({ ctype: 1, start, end, trackWidth });
const flat = () => 100;

test("off the course: more than the game's 160 ft from the truck's segment", () => {
  const seg = straight([0, 0, 0], [0, 0, 400]);
  assert.equal(offCourse(seg, [OFF_COURSE_FT - 1, 0, 200]), false);
  assert.equal(offCourse(seg, [OFF_COURSE_FT + 1, 0, 200]), true);
  assert.equal(offCourse(seg, [0, 0, -1300]), true, "Castle Nugget's grid, far behind the segment's start");
  assert.equal(offCourse(null, [9999, 0, 9999]), false);
});

test("an unmovable obstacle in the way: a cliff face or a still object, not a slope or a thing beside the way", () => {
  // Heading +z. A slope of 0.5 is climbed; a face rising 20 ft in one 8 ft step at 32 ft is a wall.
  const slope = (x, z) => 100 + Math.max(0, z) * 0.5;
  assert.equal(obstacleAhead([0, 100, 0], 0, { height: slope }), null);
  const cliff = (x, z) => (z >= 32 ? 120 : 100);
  assert.equal(obstacleAhead([0, 100, 0], 0, { height: cliff }), 24, "the last sample before the face");
  // A ground box or level box as a circle: in the way, beside it, behind, beyond the look.
  const box = (x, z, r = 5) => ({ pos: [x, 100, z], radius: r });
  assert.ok(obstacleAhead([0, 100, 0], 0, { height: flat, circles: [box(0, 40)] }) < 40);
  assert.equal(obstacleAhead([0, 100, 0], 0, { height: flat, circles: [box(5 + HALF_WIDTH_FT + 1, 40)] }), null);
  assert.equal(obstacleAhead([0, 100, 0], 0, { height: flat, circles: [box(0, -30)] }), null);
  assert.equal(obstacleAhead([0, 100, 0], 0, { height: flat, circles: [box(0, PROBE_FT + 30)] }), null);
});

test("the course to take: the nearest straight of another course within reach; none out of reach", () => {
  const far = [straight([2000, 0, 0], [2000, 0, 500])];
  const castle = [straight([3455, 274, 1224], [3432, 228, 1281]), { ctype: 2, centre: [3400, 0, 1300], radius: 30, entryAngle: 0, exitAngle: 1 },
    straight([3424, 200, 1318], [3454, 134, 2341])];
  assert.deepEqual(pickRoute([far, castle], [3415, 309, 1191]), { route: 1, segment: 0 });
  assert.deepEqual(pickRoute([far, castle], [3440, 150, 1800]), { route: 1, segment: 2 });
  assert.equal(pickRoute([far], [3415, 309, 1191]), null, "none in reach: the helicopter");
});

test("joining the raced course: on a straight's way, within its track width", () => {
  const course = [straight([3523, 208, 2457], [3285, 202, 2465]), { ctype: 2, centre: [0, 0, 0], radius: 10, entryAngle: 0, exitAngle: 1 }];
  assert.equal(joinedSegment(course, [3410, 214, 2445]), 0);
  assert.equal(joinedSegment(course, [3410, 214, 2400]), -1);
});
