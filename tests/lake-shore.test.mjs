/*
  A lake's shore (worker/cp4-world.js `lakeShore`, render/lakes.js, render/water-surface.js; OpenMTM2's own): the water
  goes on past the lake's tiles where the ground is under its surface, fading out within two tiles, so the outline is
  not the tiles' steps. Only the drawing; the tiles stay dry for the trucks.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAKE_SHORE, buildLakeSheets, lakeShore } from "../src/worker/cp4-world.js";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const N = 256, T = 32;

/** One lake of `id` over the tiles x0..x1, z0..z1, at `levelFt`. */
function lakeOver(x0, x1, z0, z1, levelFt = 100, id = 1) {
  const tileMap = new Uint8Array(N * N);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) tileMap[z * N + x] = id;
  return { tileMap, cells: N, bodies: [{ id, levelFt }] };
}

test("the shore: the tiles within two of the lake with ground under its surface, none of a lake's, none over the track's water", () => {
  const lakes = lakeOver(100, 103, 100, 103);
  const low = () => 90, high = () => 120;
  const shore = lakeShore(lakes, lakes.bodies[0], low);
  // A 4 x 4 lake and two tiles round it: 8 x 8 less the 16 lake tiles.
  assert.equal(shore.tiles, 64 - 16);
  assert.equal(LAKE_SHORE.reachTiles, 2);
  assert.equal(lakeShore(lakes, lakes.bodies[0], high), null, "ground over the surface everywhere: no shore");
  // Ground under the surface only east of x = 104 * 32 + 16: the tiles that reach there.
  const east = lakeShore(lakes, lakes.bodies[0], (x) => (x > 104 * T + 16 ? 90 : 120));
  assert.ok(east.tiles > 0 && east.tiles < shore.tiles);
  // Another lake's tile is left to it.
  lakes.tileMap[101 * N + 104] = 2;
  assert.equal(lakeShore(lakes, lakes.bodies[0], low).tiles, 64 - 16 - 1);
  // Ground that dips to the track's own water is that water's.
  assert.equal(lakeShore(lakeOver(100, 103, 100, 103), { id: 1, levelFt: 100 }, low, 95), null);
});

test("the shore's sheet: 16 ft cells at the lake's surface, dry 0 at the lake's tiles to 1 at the reach", () => {
  const lakes = lakeOver(100, 100, 100, 100, 50);
  const shore = lakeShore(lakes, lakes.bodies[0], () => 40);
  assert.equal(shore.indices.length / 6, shore.tiles * 4, "four cells a tile");
  for (let v = 0; v < shore.positions.length / 3; v++) {
    const x = shore.positions[v * 3], y = shore.positions[v * 3 + 1], z = -shore.positions[v * 3 + 2];
    assert.equal(y, 50);
    const ex = Math.max(100 * T - x, 0, x - 101 * T), ez = Math.max(100 * T - z, 0, z - 101 * T);
    assert.ok(Math.abs(shore.dry[v] - Math.min(1, Math.hypot(ex, ez) / 64)) < 1e-6, `${x},${z}`);
  }
  assert.ok(shore.dry.some((d) => d === 0) && shore.dry.some((d) => d === 1));
  // Through buildLakeSheets with the ground; without it, no shore.
  assert.ok(buildLakeSheets(lakes, { heightAt: () => 40 })[0].shore);
  assert.equal(buildLakeSheets(lakes)[0].shore, null);
});

test("the shore is drawn by the Reflective water only, which fades it; the track build gives it the drawn ground", () => {
  const lakesJs = source("render/lakes.js"), water = source("render/water-surface.js");
  assert.match(lakesJs, /mesh\.visible = false;\n  mesh\.userData\.levelFt/);
  assert.match(lakesJs, /geometry\.setAttribute\("aDry"/);
  assert.match(water, /for \(const mesh of lakes\) if \(mesh\.userData\.shore\) mesh\.visible = true;/);
  assert.match(water, /if \( vDry > 0\.0 \) alpha \*= 1\.0 - smoothstep\(/);
  assert.match(source("worker/track-build.js"), /lakes: withSheets\(keptLakes, drawnGround\.heightAt, level\.waterLevelFt \?\? null\),/);
});
