import test from "node:test";
import assert from "node:assert/strict";
import {
  ROOF_GRID, ROOF_MIN_HEIGHT_FT, SHELLS_LISTED, SHELL_FLOOR_FT, SHELL_MIN_FT, SHELL_ROOF_PCT,
  boundsOf, isShadowShell, levelShells, roofCover, shellModelOf, shellsHolding,
} from "../src/game/shadow-shells.js";
import { buildShadowShells } from "../src/worker/cp4-world.js";

// docs/CP4_EXE_ANALYSIS.md 13: Community Patch 4 beta 0.53's shadow shells.

/** A flat quad at height y over x0..x1, z0..z1, as two triangles. */
const flat = (x0, x1, z0, z1, y) => [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
/** A wall at x = x0 from z0 to z1 (or, with `alongX`, at z = x0 from x = z0 to z1), from y0 to y1. */
const wall = (at, a, b, y0, y1, alongX = false) => {
  const p = alongX ? (u, y) => [u, y, at] : (u, y) => [at, y, u];
  return [...p(a, y0), ...p(b, y0), ...p(b, y1), ...p(a, y0), ...p(b, y1), ...p(a, y1)];
};
/** Four walls round x0..x1, z0..z1 from y0 to y1. */
const walls = (x0, x1, z0, z1, y0, y1) => [
  ...wall(x0, z0, z1, y0, y1), ...wall(x1, z0, z1, y0, y1), ...wall(z0, x0, x1, y0, y1, true), ...wall(z1, x0, x1, y0, y1, true),
];
const tris = (list) => Float32Array.from(list);

test("the shell's defaults are CP4 0.53's: 500 ft across, 70% roof, a 12 x 12 grid, 30 ft tall, the box 10 ft lower, 8 listed", () => {
  assert.equal(SHELL_MIN_FT, 500);
  assert.equal(SHELL_ROOF_PCT, 70);
  assert.equal(ROOF_GRID, 12);
  assert.equal(ROOF_MIN_HEIGHT_FT, 30);
  assert.equal(SHELL_FLOOR_FT, 10);
  assert.equal(SHELLS_LISTED, 8);
});

test("a flat-roofed box scores 100, an open bowl 0", () => {
  const box = tris([...flat(0, 600, 0, 600, 0), ...walls(0, 600, 0, 600, 0, 60), ...flat(0, 600, 0, 600, 60)]);
  assert.equal(roofCover(box), 100);
  // Walls and a floor, no roof: the rays meet only the floor, low in the model.
  const bowl = tris([...flat(0, 600, 0, 600, 0), ...walls(0, 600, 0, 600, 0, 60)]);
  assert.equal(roofCover(bowl), 0);
});

test("roof cover is hits x 100 / 144, a ray counting only on a triangle in the top 40% of the height", () => {
  // A roof over half the width: 6 of the 12 columns of rays.
  const half = tris([...flat(0, 600, 0, 600, 0), ...flat(0, 300, 0, 600, 100)]);
  assert.equal(roofCover(half), 50);
  // A single row of cells: 12 of 144.
  const strip = tris([...flat(0, 600, 0, 600, 0), ...flat(0, 600, 0, 50, 100)]);
  assert.equal(roofCover(strip), (12 * 100) / 144);
  // A deck at 59% of the height is below the top 40%; at 61% it is in it.
  const low = tris([...flat(0, 600, 0, 600, 0), ...flat(0, 600, 0, 600, 59), ...flat(0, 1, 0, 1, 100)]);
  const high = tris([...flat(0, 600, 0, 600, 0), ...flat(0, 600, 0, 600, 61), ...flat(0, 1, 0, 1, 100)]);
  assert.equal(roofCover(low), 0);
  assert.equal(roofCover(high), 100);
});

test("a model under 30 ft tall scores 0, whatever its roof", () => {
  const shed = tris([...flat(0, 600, 0, 600, 0), ...walls(0, 600, 0, 600, 0, 29), ...flat(0, 600, 0, 600, 29)]);
  assert.equal(roofCover(shed), 0);
  const hall = tris([...flat(0, 600, 0, 600, 0), ...walls(0, 600, 0, 600, 0, 30), ...flat(0, 600, 0, 600, 30)]);
  assert.equal(roofCover(hall), 100);
});

test("the shell test: at least 500 ft wide and long, and a roof of at least 70%", () => {
  const sized = (w, l) => ({ min: [0, 0, 0], max: [w, 100, l] });
  assert.equal(isShadowShell(sized(500, 500), 70), true);
  assert.equal(isShadowShell(sized(499, 800), 100), false);
  assert.equal(isShadowShell(sized(800, 499), 100), false);
  assert.equal(isShadowShell(sized(800, 800), 69.9), false);
  assert.equal(isShadowShell(sized(400, 400), 100, { minFt: 300 }), true);
  // A tall thin tower, roofed all over, is too small to be one.
  const tower = tris([...flat(0, 50, 0, 50, 0), ...walls(0, 50, 0, 50, 0, 400), ...flat(0, 50, 0, 50, 400)]);
  assert.equal(roofCover(tower), 100);
  assert.equal(shellModelOf(boundsOf(tower), tower), null);
  const arena = tris([...flat(0, 600, 0, 700, 0), ...walls(0, 600, 0, 700, 0, 80), ...flat(0, 600, 0, 700, 80)]);
  assert.deepEqual(shellModelOf(boundsOf(arena), arena), { min: [0, 0, 0], max: [600, 80, 700], roofPct: 100 });
  const open = tris([...flat(0, 600, 0, 700, 0), ...walls(0, 600, 0, 700, 0, 80)]);
  assert.equal(shellModelOf(boundsOf(open), open), null);
});

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const shellAt = (pos, rot = identity, min = [-300, 0, -300], max = [300, 60, 300]) => ({ model: "ARENA.BIN", pos, rot, min, max });

test("the camera is inside a shell's box, its bottom 10 ft lower", () => {
  const shells = [shellAt([1000, 0, 1000])];
  const out = new Int32Array(SHELLS_LISTED);
  assert.equal(shellsHolding(shells, 1000, 30, 1000, out), 1);
  assert.equal(out[0], 0);
  assert.equal(shellsHolding(shells, 1000, -10, 1000, out), 1);
  assert.equal(shellsHolding(shells, 1000, -10.5, 1000, out), 0);
  assert.equal(shellsHolding(shells, 1000, 60.5, 1000, out), 0);
  assert.equal(shellsHolding(shells, 1300, 30, 700, out), 1);
  assert.equal(shellsHolding(shells, 1301, 30, 1000, out), 0);
  assert.equal(shellsHolding(shells, 1000, 30, 699, out), 0);
});

test("a shell's box turns with it", () => {
  // OpenPhotex eulerToMatrix(0, 0, pi / 2): [c 0 s; 0 1 0; -s 0 c]. The long side, body x, lies along the world's z.
  const shells = [shellAt([1000, 0, 1000], [0, 0, 1, 0, 1, 0, -1, 0, 0], [-300, 0, -50], [300, 60, 50])];
  const out = new Int32Array(SHELLS_LISTED);
  assert.equal(shellsHolding(shells, 1000, 30, 1200, out), 1);
  assert.equal(shellsHolding(shells, 1200, 30, 1000, out), 0);
});

test("the world wraps at 8192 ft: the camera's copy nearest the shell is tested", () => {
  const shells = [shellAt([8100, 0, 4000])];
  const out = new Int32Array(SHELLS_LISTED);
  // 100 ft is 192 ft past the edge from 8100.
  assert.equal(shellsHolding(shells, 100, 30, 4000, out), 1);
  // A camera that went on past the edge without wrapping (the trucks are drawn where they went).
  assert.equal(shellsHolding(shells, 8192 + 8100, 30, 4000 - 8192, out), 1);
  assert.equal(shellsHolding(shells, 100, 30, 4000, out, { wraps: false }), 0);
});

test("at most 8 shells are listed, in their order", () => {
  const shells = Array.from({ length: 10 }, () => shellAt([1000, 0, 1000]));
  const out = new Int32Array(SHELLS_LISTED);
  assert.equal(shellsHolding(shells, 1000, 30, 1000, out), 8);
  assert.deepEqual([...out], [0, 1, 2, 3, 4, 5, 6, 7]);
  // Shells that do not hold the camera are passed over.
  const mixed = [shellAt([5000, 0, 5000]), ...shells];
  assert.equal(shellsHolding(mixed, 1000, 30, 1000, out), 8);
  assert.equal(out[0], 1);
});

test("a level's shells: each model measured once, every placement of a shell model kept", () => {
  const arena = tris([...flat(0, 600, 0, 600, 0), ...walls(0, 600, 0, 600, 0, 80), ...flat(0, 600, 0, 600, 80)]);
  const asked = [];
  const modelOf = (name) => {
    asked.push(name);
    return name === "ARENA.BIN" ? { bounds: boundsOf(arena), positions: arena } : { bounds: { min: [0, 0, 0], max: [10, 10, 10] }, positions: tris(flat(0, 10, 0, 10, 10)) };
  };
  const shells = levelShells([
    { model: "ARENA.BIN", pos: [100, 0, 100], rot: identity, sitIndex: 3 },
    { model: "CONE.BIN", pos: [0, 0, 0], rot: identity, sitIndex: 4 },
    { model: "ARENA.BIN", pos: [4000, 0, 100], rot: identity, sitIndex: 9 },
  ], modelOf);
  assert.deepEqual(asked, ["ARENA.BIN", "CONE.BIN"]);
  assert.deepEqual(shells.map((s) => s.sitIndex), [3, 9]);
  assert.deepEqual(shells[1].max, [600, 80, 600]);
  assert.equal(shells[1].roofPct, 100);
});

test("the track build's shells: placed SIT objects only, the stadium left out", () => {
  // A decoded model's meshes are in the scene frame (z mirrored), its bounds in the game frame (worker/models.js).
  const game = [...flat(0, 600, 0, 600, 0), ...walls(0, 600, 0, 600, 0, 80), ...flat(0, 600, 0, 600, 80)];
  const scene = Float32Array.from(game, (v, i) => (i % 3 === 2 ? -v : v));
  const models = {
    "ARENA.BIN": { meshes: [{ positions: scene, textureName: "" }], bounds: { min: [0, 0, 0], max: [600, 80, 600] } },
    "SIGN.BIN": { meshes: [{ positions: Float32Array.from(flat(0, 5, 0, 5, 5)), textureName: "" }], bounds: { min: [0, 0, 0], max: [5, 5, 5] } },
  };
  const boxes = [{ positionFt: [1000, 0, 2000], theta: 0, phi: 0, psi: 0 }, { positionFt: [10, 0, 10], theta: 0, phi: 0, psi: 0 }];
  const objects = [
    { model: "ARENA.BIN", type: 0, sitIndex: 0 },
    { model: "SIGN.BIN", type: 0, sitIndex: 1 },
    { model: "ARENA.BIN", type: "stadium" },
  ];
  const shells = buildShadowShells(objects, boxes, models, () => identity);
  assert.equal(shells.length, 1);
  assert.deepEqual({ model: shells[0].model, sitIndex: shells[0].sitIndex, pos: shells[0].pos, roofPct: shells[0].roofPct }, { model: "ARENA.BIN", sitIndex: 0, pos: [1000, 0, 2000], roofPct: 100 });
});

test("Roofed arenas lit as outdoors is on by default, and on for saves before version 15", async () => {
  const { DEFAULT_SETTINGS, SETTINGS_VERSION, migrateSettings } = await import("../src/app/settings.js");
  assert.ok(SETTINGS_VERSION >= 15);
  assert.equal(DEFAULT_SETTINGS.cp4ShadowShells, true);
  assert.equal(migrateSettings({ version: 14, cp4ShadowShells: false }).cp4ShadowShells, true);
  assert.equal(migrateSettings({ version: 14 }).cp4ShadowShells, true);
  assert.equal(migrateSettings({ version: 15, cp4ShadowShells: false }).cp4ShadowShells, false);
  assert.equal(migrateSettings({ version: 15 }).cp4ShadowShells, true);
});
