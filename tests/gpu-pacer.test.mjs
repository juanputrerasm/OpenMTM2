/*
  Frames held back while the graphics card is behind (render/gpu-pacer.js; docs/ARCHITECTURE.md,
  "Frame pacing"), against a stand-in WebGL 2 context whose fences pass when the test says.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_WAIT_MS, PACE_DEPTH, createGpuPacer } from "../src/render/gpu-pacer.js";

/** A context whose fences pass only when `pass(n)` says the card has finished the oldest n frames. */
function fakeGl({ fences = true } = {}) {
  const status = new Map();
  let made = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, SYNC_STATUS: 0x9114, SIGNALED: 0x9119, UNSIGNALED: 0x9118,
    flushes: 0, lost: false, deleted: 0,
    fenceSync(condition, flags) {
      assert.equal(condition, gl.SYNC_GPU_COMMANDS_COMPLETE);
      assert.equal(flags, 0);
      const sync = { n: made++ };
      status.set(sync, false);
      return sync;
    },
    getSyncParameter(sync, name) {
      assert.equal(name, gl.SYNC_STATUS);
      if (!status.has(sync)) return null;
      return status.get(sync) ? gl.SIGNALED : gl.UNSIGNALED;
    },
    deleteSync(sync) { status.delete(sync); gl.deleted++; },
    flush() { gl.flushes++; },
    isContextLost() { return gl.lost; },
    /** The card has finished the oldest `count` frames not yet finished. */
    pass(count = 1) {
      for (const [sync, done] of [...status].sort((a, b) => a[0].n - b[0].n)) {
        if (count <= 0) break;
        if (!done) { status.set(sync, true); count--; }
      }
    },
  };
  if (!fences) { delete gl.fenceSync; delete gl.getSyncParameter; }
  return gl;
}

test("two frames may wait on the graphics card; a third is held back until the oldest is finished", () => {
  assert.equal(PACE_DEPTH, 2);
  const gl = fakeGl();
  const pacer = createGpuPacer(gl);
  assert.equal(pacer.behind(0), false);
  pacer.drawn(0);
  assert.equal(pacer.behind(16), false, "one frame unfinished");
  pacer.drawn(16);
  assert.equal(pacer.pending, 2);
  assert.equal(pacer.behind(33), true, "two frames unfinished: this one is skipped");
  assert.equal(pacer.behind(50), true, "and the next, while the card is still on them");
  gl.pass(1);
  assert.equal(pacer.behind(66), false, "the oldest has passed: a frame is drawn");
  assert.equal(pacer.pending, 1);
  assert.equal(gl.deleted, 1, "a fence that has passed is let go");
  pacer.drawn(66);
  gl.pass(2);
  assert.equal(pacer.behind(83), false);
  assert.equal(pacer.pending, 0);
});

test("each frame's fence is sent to the card at once, so it passes as soon as the frame is drawn", () => {
  const gl = fakeGl();
  const pacer = createGpuPacer(gl);
  pacer.drawn(0);
  pacer.drawn(16);
  assert.equal(gl.flushes, 2);
});

test("a fence that never passes holds frames back for no longer than MAX_WAIT_MS", () => {
  assert.equal(MAX_WAIT_MS, 1000);
  const gl = fakeGl();
  const pacer = createGpuPacer(gl);
  pacer.drawn(0);
  pacer.drawn(10);
  assert.equal(pacer.behind(MAX_WAIT_MS), true, "at the limit it is still waited on");
  assert.equal(pacer.behind(MAX_WAIT_MS + 1), false, "past it the oldest is given up on");
  assert.equal(pacer.pending, 1);
});

test("without fences (WebGL 1), or once the context is lost, nothing is held back", () => {
  const old = createGpuPacer(fakeGl({ fences: false }));
  old.drawn(0);
  old.drawn(1);
  old.drawn(2);
  assert.equal(old.behind(3), false);
  assert.equal(old.pending, 0);
  assert.equal(createGpuPacer(null).behind(0), false);
  const gl = fakeGl();
  const pacer = createGpuPacer(gl);
  pacer.drawn(0);
  pacer.drawn(16);
  gl.lost = true;
  assert.equal(pacer.behind(33), false);
  assert.equal(pacer.pending, 0, "the lost context's fences are forgotten");
  pacer.drawn(33);
  assert.equal(pacer.pending, 0, "and none are set while it is lost");
});

test("reset forgets every fence: frames drawn elsewhere (a headset's) are not waited on", () => {
  const gl = fakeGl();
  const pacer = createGpuPacer(gl);
  pacer.drawn(0);
  pacer.drawn(16);
  assert.equal(pacer.behind(20), true);
  pacer.reset();
  assert.equal(pacer.pending, 0);
  assert.equal(pacer.behind(20), false);
});

test("the window's frames are paced and a headset's never are", () => {
  const host = readFileSync(new URL("../src/render/xr/xr-host.js", import.meta.url), "utf8");
  assert.match(host, /const pacer = createGpuPacer\(renderer\.getContext\(\)\);/);
  assert.match(host, /const paced = loop && !xr\.isPresenting;/);
  // A frame held back returns before the frame's time is taken, so the next one is given all of it.
  assert.match(host, /if \(paced && pacer\.behind\(now\)\) return;\n\s*const dt = /);
  assert.match(host, /if \(paced\) pacer\.drawn\(now\);/);
  assert.match(host, /session = xr\.getSession\(\);\n\s*pacer\.reset\(\);/);
});

test("the replay screen's own renderer is paced the same way, and has samples only where its scene is drawn onto them", () => {
  const replay = readFileSync(new URL("../src/ui/screens/replay.js", import.meta.url), "utf8");
  assert.match(replay, /const pacer = createGpuPacer\(renderer\.getContext\(\)\);/);
  assert.match(replay, /frameId = requestAnimationFrame\(loop\);\n(\s*\/\/.*\n)*\s*if \(pacer\.behind\(now\)\) return;\n\s*const dt = /);
  assert.match(replay, /scenery\.draw\(camera\);\n\s*pacer\.drawn\(now\);/);
  assert.match(replay, /new THREE\.WebGLRenderer\(\{ canvas, antialias: screenSampled\(context\.settings\) \}\)/);
});
