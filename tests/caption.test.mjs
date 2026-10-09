import test from "node:test";
import assert from "node:assert/strict";
import { captionPose, IN_TRANSITIONS, OUT_TRANSITIONS } from "../src/render/caption.js";

const bar = { width: 280, height: 30 };
const rest = captionPose("hold", 1, 0, bar);

test("the bar rests centred with its bottom edge at 98% of the height", () => {
  assert.equal(rest.x, (640 - 280) / 2);
  assert.equal(rest.y + bar.height, 480 * 0.98);
});

test("every transition starts away from rest or hidden and ends at rest", () => {
  for (let kind = 0; kind < IN_TRANSITIONS; kind++) {
    const start = captionPose("in", 0, kind, bar), end = captionPose("in", 1, kind, bar);
    assert.ok(Math.abs(end.x - rest.x) < 1e-6 && Math.abs(end.y - rest.y) < 1e-6, `in ${kind} ends at rest`);
    assert.ok(Math.abs(end.letter(3, 10).alpha - 1) < 1e-9 && end.letter(3, 10).dx === 0 || kind < 6, `in ${kind} letters whole`);
    const moved = start.x !== rest.x || start.y !== rest.y || start.letter(5, 10).alpha < 1 || start.letter(1, 10).dx !== 0;
    assert.ok(moved, `in ${kind} starts away`);
  }
  for (let kind = 0; kind < OUT_TRANSITIONS; kind++) {
    const start = captionPose("out", 0, kind, bar), end = captionPose("out", 1, kind, bar);
    assert.ok(Math.abs(start.x - rest.x) < 1e-6 && Math.abs(start.y - rest.y) < 1e-6);
    assert.ok(end.x !== rest.x || end.y !== rest.y || end.letter(0, 5).alpha === 0, `out ${kind} ends away`);
  }
});

test("slides: 0 comes from the right, 1 from the left, 2 from below, all easing out", () => {
  assert.ok(captionPose("in", 0, 0, bar).x > rest.x);
  assert.ok(captionPose("in", 0, 1, bar).x < rest.x);
  assert.ok(captionPose("in", 0, 2, bar).y > rest.y);
  const half = captionPose("in", 0.5, 0, bar).x - rest.x, start = captionPose("in", 0, 0, bar).x - rest.x;
  assert.ok(half < start / 2, "most of the distance is covered early");
});

test("letter reveals run left to right (3, 4) and right to left (5)", () => {
  const a = captionPose("in", 0.3, 3, bar);
  assert.ok(a.letter(0, 10).alpha > a.letter(9, 10).alpha);
  const b = captionPose("in", 0.3, 5, bar);
  assert.ok(b.letter(9, 10).alpha > b.letter(0, 10).alpha);
});

test("the interlaced slide sends odd rows and letters the other way", () => {
  const p = captionPose("in", 0.2, 6, bar);
  assert.ok(p.rowOffset(0) < 0 && p.rowOffset(1) > 0);
  assert.ok(p.letter(0).dx < 0 && p.letter(1).dx > 0);
});
