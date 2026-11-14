/*
  Track format version 6 (docs/EXTENSIONS.md "Track format version 6"; the open specification at
  https://openmtm2.github.io/proposals/track-format-v6): a `.SI3` track of 256 or 512 cells, its heights on a step and
  a base of its own. The pure parts run on synthetic data; the whole load runs on a local test track
  (~/games/mtm2-v6-test/CRAZY4X.POD, never committed) beside the retail install, when both are there.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parsePod, readPodEntry, writePod1 } from "../src/vendor/openphotex/index.js";
import * as S from "../src/vendor/openphotex/sim/mtm2/index.js";
import { WORLD_FT, mapWrap, nearestCopy, worldFtOf, wrapFt } from "../src/shared/scene-frame.js";
import { blockShift } from "../src/shared/object-chunks.js";
import { createGroundBoxCache } from "../src/worker/sim-worker.js";
import { groundBoxWalls } from "../src/game/obstacle-avoid.js";
import { createBoxSolid, groundBoxGrids } from "../src/game/ground-boxes.js";
import { lakeAt, waterLevelAt } from "../src/game/lakes.js";
import { buildLakeSheets } from "../src/worker/cp4-world.js";
import { fogVolumesShown } from "../src/game/fog-volumes.js";
import { readLevelFalls, readLevelLakes, readV6World } from "../src/worker/level-load.js";
import { buildTrackFalls, fallHeights, fallReadNotices } from "../src/worker/cp4-falls.js";
import { writeWfl } from "../src/vendor/openphotex/mtm/wfl.js";
import { writeWtr } from "../src/vendor/openphotex/mtm/wtr.js";
import { createVfs } from "../src/worker/vfs.js";
import { buildTerrainAtlas, buildTerrainMesh, fineTerrainLevel } from "../src/worker/terrain-mesh.js";
import { terrainMaskShares } from "../src/shared/terrain-mask.js";
import { toMapFrame, wrapRuns } from "../src/render/minimap.js";
import { levelRect } from "../src/game/extensions/deathmatch.js";
import { GAMES, RETAIL_PODS, readStock, skipLocal } from "./helpers/stock.mjs";

const W512 = 16384;

test("the world's helpers take its size and default to the retail 8192 ft (8.1)", () => {
  assert.equal(worldFtOf(null), WORLD_FT);
  assert.equal(worldFtOf({ worldFt: W512 }), W512);
  // Unchanged without a size.
  assert.equal(wrapFt(-5), 8187);
  assert.equal(mapWrap(5000), 5000 - 8192);
  // A 512-cell world wraps at 16384 ft, its nearest copy at half of it.
  assert.equal(wrapFt(-5, W512), W512 - 5);
  assert.equal(wrapFt(9000, W512), 9000);
  assert.equal(mapWrap(5000, W512), 5000);
  assert.equal(mapWrap(9000, W512), 9000 - W512);
  assert.deepEqual(nearestCopy([100, 0, 100], [8000, 0, 100], W512), [100, 0, 100]);
  assert.deepEqual(nearestCopy([100, 0, 100], [8000, 0, 100]), [8292, 0, 100]);
  assert.deepEqual(nearestCopy([100, 0, 100], [16000, 0, 100], W512), [100 + W512, 0, 100]);
  assert.deepEqual(blockShift(100, 100, 8000, 100, W512), [0, 0]);
  assert.deepEqual(blockShift(100, 100, 8000, 100), [8192, 0]);
  // The map folds at the world's half.
  assert.deepEqual(toMapFrame(9000, 0, 0, 0, 0, true, W512), [9000 - W512, 0].map((v, i) => (i ? 0 : v)));
  assert.equal(wrapRuns([[0, 0], [9000, 0]], false, 0, 0, W512)[0][1].x, 9000 - W512);
});

test("the kept ground boxes on a 512-cell world of 16-bit layers are OpenPhotex's (8.1, 8.3)", () => {
  const N = 512, step = 32, base = -40;
  const ra0 = new Uint16Array(N * N), ra1 = new Uint16Array(N * N);
  for (let i = 0; i < N * N; i++) if ((i % N) < 2 || (i % N) > 508 || ((i / N) | 0) % 9 === 0) { ra0[i] = (i % 7) * 100; ra1[i] = ra0[i] + 300 + (i % 5) * 17; }
  const cache = createGroundBoxCache(ra0, ra1, 1 / step, N, base);
  for (const [x, z] of [[10, 10], [16380, 9000], [-5, 16400], [8192 + 40, 31.9], [W512 * 2 + 3, -70]]) {
    const fresh = S.groundBoxesAround(ra0, ra1, x, z, [], 1 / step, N, base);
    const kept = cache.around(x, z, []);
    assert.equal(kept.length, fresh.length, `${x}, ${z}`);
    kept.forEach((box, k) => assert.deepEqual(box.pos, fresh[k].pos, `${x}, ${z}`));
  }
  // A cell past 8192 ft is its own, not the first world's again: the box's height is base + value / step.
  const i = 300 * N + 400;
  ra0[i] = 640; ra1[i] = 1280;
  const solid = createBoxSolid({ ra0, ra1, stepFt: 1 / step, baseFt: base, cells: N }, 0);
  const x = 400 * 32 + 16, z = 300 * 32 + 16;
  assert.equal(solid(x, base + 30, z), true);
  assert.equal(solid(x, base + 19, z), false);
  assert.equal(solid(x - 8192, base + 30, z), false);
  const walls = groundBoxWalls([x, base + 15, z - 60], 0, 120, { ra0, ra1, stepFt: 1 / step, baseFt: base, cells: N });
  assert.ok(walls.some((w) => w.pos[1] === base + 40 && Math.abs(w.pos[0] - x) < 1));
});

test("a build's 16-bit layers stay 16-bit for the readers on the main thread (8.3)", () => {
  const ra0 = new Uint16Array([1, 2]), ra1 = new Uint16Array([3, 4]);
  const g = groundBoxGrids({ ra0, ra1, groundBoxDepth: 16, groundBoxStepFt: 1 / 64, groundBoxBaseFt: 12, worldCells: 512 });
  assert.equal(g.ra0, ra0);
  assert.deepEqual([g.stepFt, g.baseFt, g.cells], [1 / 64, 12, 512]);
  // Any other track's: bytes, 2 ft, no base, 256 cells, as before.
  const old = groundBoxGrids({ ra0: new Uint8Array(4), ra1: new Uint8Array(4), groundBoxStepFt: 1.5 });
  assert.deepEqual([old.ra0.constructor, old.stepFt, old.baseFt, old.cells], [Uint8Array, 2, 0, 256]);
});

test("lakes on a 512 tile map: looked up and sheeted at N, a surface at or below 0 ft kept (9.1)", () => {
  const N = 512, tileMap = new Uint8Array(N * N);
  tileMap[400 * N + 300] = 1; tileMap[400 * N + 301] = 1;
  const levelFt = new Float32Array(256); levelFt[1] = -12;
  const lakes = { tileMap, levelFt, cells: N, bodies: [{ id: 1, levelFt: -12 }] };
  assert.equal(lakeAt(lakes, 300 * 32 + 5, 400 * 32 + 5), 1);
  assert.equal(lakeAt(lakes, 300 * 32 + 5 - 8192, 400 * 32 + 5), 0);
  assert.equal(lakeAt(lakes, 300 * 32 + 5 + W512, 400 * 32 + 5), 1);
  assert.equal(waterLevelAt(lakes, 300 * 32 + 5, 400 * 32 + 5, 3), -12);
  const [sheet] = buildLakeSheets(lakes);
  assert.equal(sheet.sheet.positions[0], 300 * 32);
  assert.equal(sheet.sheet.positions[2], -400 * 32);
});

test("a fog volume's distance wraps at the world's size (9.3)", () => {
  // 8900 ft east of the eye: 708 ft away the short way round an 8192 ft world, 7484 ft round a 16384 ft one.
  const volume = { usable: true, centre: [9000, 50, 100], half: [10, 10, 10], wmask: 0xffff };
  assert.deepEqual(fogVolumesShown([volume], [100, 100], 0, 1000).map((s) => s.dx), [708]);
  assert.deepEqual(fogVolumesShown([volume], [100, 100], 0, 1000, 64, W512), []);
  assert.deepEqual(fogVolumesShown([volume], [100, 100], 0, 8000, 64, W512).map((s) => s.dx), [-7484]);
});

/** A one-archive VFS holding a level and its WORLD\\X.WFL, and the level's hit, for `readLevelFalls`. */
function wflVfs(bytes) {
  const files = { "LEVELS/X.LVL": new Uint8Array([1]), "WORLD/X.WFL": bytes };
  const vfs = createVfs([{
    name: "A.POD", archive: { entries: Object.keys(files).map((path) => ({ normalizedName: path })) },
    readEntry: async (entry) => files[entry.normalizedName],
  }]);
  return { vfs, hit: vfs.find("LEVELS\\X.LVL") };
}
/** A copy of a .WFL or .WTR with its header's tile size patched to `side` x `side` (writers never make such a file). */
const withHeaderSide = (bytes, side) => {
  const out = bytes.slice();
  new DataView(out.buffer).setUint16(0x10, side, true);
  new DataView(out.buffer).setUint16(0x12, side, true);
  return out;
};
const wflFall = (points, height, source = 0) => ({
  source, flags: 6, speed: 96, height, points: points.map(([x, z]) => ({ x: x * 16, z: z * 16 })), opacity: 100, mist: 100, volume: 100, soundName: "ROAR",
});

test("a .WFL version 2 on a 512-cell world is read at N and its falls built in that world (9.3)", async () => {
  const N = 512, fine = 4 * N, step = 16, base = 1000;
  // A spring on a shelf at 4,500 ft north of z = 12,000 ft (beyond 8,192 ft on both axes), the ground dropping to 4,300
  // ft, into lake 1 at 4,350 ft on the N x N tile map: heights a version 1 file cannot hold, in this track's range.
  const bytes = writeWfl([wflFall([[15000, 12000], [15040, 12000]], 9000)], { cells: N });
  assert.equal(bytes[4], 2, "written as version 2");
  const { vfs, hit } = wflVfs(bytes);
  const file = await readLevelFalls(vfs, ["X"], hit, { cells: N, v6: true });
  assert.deepEqual([file.status, file.major, file.falls[0].height], [0, 2, 9000]);
  assert.equal(file.falls[0].points[0].x, 15000 * 16);
  const fineFt = new Float32Array(fine * fine);
  for (let z = 0; z < fine; z++) fineFt.fill(z * 8 >= 12000 ? 4500 : 4300, z * fine, (z + 1) * fine);
  const heightsFt = new Float32Array(N * N);
  for (let z = 0; z < N; z++) heightsFt.fill(z * 32 >= 12000 ? 4500 : 4300, z * N, (z + 1) * N);
  const level = {
    cells: N, worldFt: W512, heights: null, heightsFt, fineFt, terrainMode: "spline", falls: file,
    v6: { worldCells: N, worldFt: W512, terrainHeightMap: "X.PNG", terrainHeightStep: step, terrainHeightBase: base, warnings: [] },
  };
  const heights = fallHeights(level);
  assert.equal(heights.h128, true);
  assert.equal(heights.fine[0], 4300 * 128, "the 32-bit h128 store (7.3)");
  const tileMap = new Uint8Array(N * N);
  for (let z = 300; z < 375; z++) for (let x = 460; x < 480; x++) tileMap[z * N + x] = 1;
  const out = await buildTrackFalls(level, { heights, tileMap, lakes: [{ id: 1, height: 8700 }], waterLevelFt: null });
  assert.deepEqual(out.notices, []);
  assert.equal(out.falls.list.length, 1);
  const [f] = out.falls.list;
  assert.deepEqual(f.anchorFt.map((v) => Math.round(v)), [15000, 4500, 12000]);
  // Its mist and its sound lie in [0, W), past 8192 ft, on lake 1's surface.
  const mist = out.fogVolumes.find((v) => v.fall === 0);
  assert.ok(mist && mist.centre[0] > 8192 && mist.centre[0] < W512 && mist.centre[2] > 8192 && mist.centre[2] < W512);
  assert.equal(out.sounds.length, 1);
  assert.equal(out.sounds[0].positionFt[1], 4350, "lands in lake 1, found on the N x N map");
  assert.ok(out.sounds[0].positionFt[0] > 8192 && out.sounds[0].positionFt[0] < W512);
  // The same crest above the terrain's range (base + 65536 / step = 5096 ft) is refused as a record: "skipped".
  const high = await readLevelFalls(wflVfs(writeWfl([wflFall([[15000, 12000], [15040, 12000]], 10194)], { cells: N })).vfs, ["X"], null, { cells: N, v6: true });
  const refused = await buildTrackFalls({ ...level, falls: high }, { heights, tileMap, lakes: [{ id: 1, height: 8700 }], waterLevelFt: null });
  assert.deepEqual(refused.notices.map((n) => n.text), ["Some of this track's waterfalls were skipped."]);
});

test("the world's size picks the .WFL version: any other pairing was authored for a different terrain size (9.3)", async () => {
  const v1 = writeWfl([wflFall([[100, 100], [130, 100]], 200)]);
  const v2 = writeWfl([wflFall([[100, 100], [130, 100]], 200)], { cells: 512 });
  assert.deepEqual([v1[4], v2[4]], [1, 2]);
  const damaged = async (bytes, cells) => {
    const { vfs, hit } = wflVfs(bytes);
    const file = await readLevelFalls(vfs, ["X"], hit, { cells, v6: true });
    assert.equal(file.status, 6, `${cells} cells, major ${bytes[4]}, header ${bytes[0x10] | (bytes[0x11] << 8)}`);
    const [notice] = fallReadNotices(file);
    assert.equal(notice.text, "This track's waterfalls file is damaged (<<1>>) and was not loaded.");
    assert.deepEqual(notice.args, [{ tag: "authored for a different terrain size" }]);
  };
  // Version 1 on a 512-cell world; version 2 on a 256-cell one, with its 512 header or patched to 256.
  await damaged(v1, 512);
  await damaged(v2, 256);
  await damaged(withHeaderSide(v2, 256), 256);
  await damaged(withHeaderSide(v1, 512), 512);
  // The pairings the rule allows are read.
  for (const [bytes, cells] of [[v1, 256], [v2, 512]]) {
    const { vfs, hit } = wflVfs(bytes);
    const file = await readLevelFalls(vfs, ["X"], hit, { cells, v6: true });
    assert.deepEqual([file.status, file.major], [0, cells === 256 ? 1 : 2]);
  }
});

test("the world's size picks the .WTR version: a 256-cell .SI3 refuses version 2, a 512-cell one version 1 (9.1)", () => {
  const lakes = [{ id: 1, flags: 0, height: 100, seeds: [{ x: 10, z: 10 }], box: { minX: 10, minZ: 10, maxX: 10, maxZ: 10 }, tileCount: 1 }];
  const map256 = new Uint8Array(256 * 256), map512 = new Uint8Array(512 * 512);
  map256[10 * 256 + 10] = 1; map512[10 * 512 + 10] = 1;
  const v1 = writeWtr(lakes, map256), v2 = writeWtr(lakes, map512);
  assert.deepEqual([v1[4], v2[4]], [1, 2]);
  assert.equal(readLevelLakes(v1, { cells: 256, v6: true }).major, 1);
  assert.equal(readLevelLakes(v2, { cells: 512, v6: true }).major, 2);
  assert.equal(readLevelLakes(v2, { cells: 256, v6: true }), null, "version 2 on a 256-cell world");
  assert.equal(readLevelLakes(withHeaderSide(v2, 256), { cells: 256, v6: true }), null, "version 2 patched to 256 x 256");
  assert.equal(readLevelLakes(v1, { cells: 512, v6: true }), null, "version 1 on a 512-cell world");
  // A track that is not .SI3 reads version 1 as before and refuses version 2 as Community Patch 4 does.
  assert.equal(readLevelLakes(v1).major, 1);
  assert.equal(readLevelLakes(v2), null);
});

test("a track that is not .SI3 still refuses a .WFL version 2 as beta 0.53 does: it needs a newer build", async () => {
  const v2 = writeWfl([wflFall([[100, 100], [130, 100]], 200)], { cells: 512 });
  for (const bytes of [v2, withHeaderSide(v2, 256)]) {
    const { vfs, hit } = wflVfs(bytes);
    const file = await readLevelFalls(vfs, ["X"], hit);
    const side = bytes[0x10] | (bytes[0x11] << 8);
    assert.deepEqual([file.status, file.major, file.falls], [4, 2, []], `a ${side} x ${side} file`);
    assert.ok(Object.values(file.counters).every((v) => v === 0));
    assert.deepEqual(fallReadNotices(file).map((n) => n.text), ["This track's waterfalls need a newer build."]);
  }
  // Any later major as well, and a version 1 file reads as before.
  const v3 = v2.slice(); v3[4] = 3;
  assert.equal((await readLevelFalls(wflVfs(v3).vfs, ["X"], null)).status, 4);
  const { vfs, hit } = wflVfs(writeWfl([wflFall([[100, 100], [130, 100]], 200)]));
  assert.equal((await readLevelFalls(vfs, ["X"], hit)).status, 0);
});

test("a .SI3 track's .TXV keys are refused with the key named (5.2)", () => {
  const txv = (lines) => new TextEncoder().encode(lines.join("\r\n"));
  assert.throws(() => readV6World(null, "WORLD\\X.SI3"), /X\.SI3: TXV: a \.SI3 track needs/);
  assert.throws(() => readV6World(txv(["formatVersion=5"]), "WORLD\\X.SI3"), /formatVersion=5/);
  assert.throws(() => readV6World(txv(["formatVersion=6", "worldCells=300"]), "WORLD\\X.SI3"), /worldCells=300/);
  assert.throws(() => readV6World(txv(["formatVersion=6", "worldCells=512"]), "WORLD\\X.SI3"), /terrainHeightMap is required/);
  assert.throws(() => readV6World(txv(["formatVersion=6", "terrainHeightStep=3"]), "WORLD\\X.SI3"), /terrainHeightStep=3/);
  const later = readV6World(txv(["formatVersion=7"]), "WORLD\\X.SI3");
  assert.match(later.warnings[0], /newer build/);
  assert.deepEqual([later.worldCells, later.worldFt], [256, 8192]);
});

test("the ground's mesh, its chunks and the detail mask follow the world's cells", () => {
  const N = 512;
  const mesh = buildTerrainMesh({ heights: null, heightsFt: new Float32Array(N * N).fill(-30), clr: new Uint16Array(N * N), lte: null, atlas: buildTerrainAtlas([null]), grid: N });
  assert.equal(mesh.grid, N);
  assert.equal(mesh.indices.length, N * N * 6);
  assert.equal(mesh.positions[(N * N - 1) * 12 + 6], N * 32);
  assert.equal(mesh.positions[1], -30);
  assert.equal(fineTerrainLevel({ sub: 4, step: 4, grid: N }).chunks.length, (N / 64) ** 2);
  // A mask spans the whole world: its right half is past 8192 ft on a 512-cell one.
  const mask = { width: 2, height: 1, rgba: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) };
  assert.deepEqual([...terrainMaskShares(new Float32Array([12288, 0, 0]), mask, W512)], [255]);
});

test("an extension's play area fits the world's size", () => {
  assert.equal(levelRect([]).maxX, 8192 - 64);
  assert.equal(levelRect([], W512).maxX, W512 - 64);
});

const V6_POD = join(GAMES, "mtm2-v6-test", "CRAZY4X.POD");
const skipV6 = skipLocal(V6_POD, `${V6_POD} is not present`) || skipLocal(join(GAMES, "mtm2", "POD.INI"), "no MTM2 install");

async function v6Vfs(overlay = []) {
  const { createVfs } = await import("../src/worker/vfs.js");
  const mount = (name, bytes) => ({ name, archive: parsePod(bytes), readEntry: async (e) => readPodEntry(bytes, e) });
  const extra = overlay.length ? [mount("OVER.POD", writePod1("over", overlay))] : [];
  return createVfs([...extra, mount("CRAZY4X.POD", new Uint8Array(readFileSync(V6_POD))), ...RETAIL_PODS.map((k) => mount(k, readStock(k)))]);
}

test("a .SI3 is a track of its own beside the .SIT of a like stem, and loads as a 512-cell world", { skip: skipV6 }, async () => {
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const vfs = await v6Vfs();
  const { tracks } = await buildCatalog(vfs);
  const v6 = tracks.find((t) => t.file === "CRAZY4X.SI3");
  assert.ok(v6);
  assert.equal(v6.formatVersion, 6);
  assert.equal(new Set(tracks.map((t) => t.file)).size, tracks.length, "every track's file is its own");
  const build = await buildTrackRender(vfs, v6.path, { visuals: { smoothing: true, groundMap: true, snow: true } });
  assert.deepEqual([build.worldCells, build.worldFt], [512, W512]);
  assert.equal(build.heightsFt.length, 512 * 512);
  assert.equal(build.terrain.grid, 512);
  // The drawn ground and the maps made for a 256-cell world are left out on it.
  assert.equal(build.relief, null);
  assert.equal(build.groundMap, null);
  assert.ok(build.lakes === null || build.lakes.cells === 512);
  if (build.sim.groundBoxDepth === 16) assert.ok(build.sim.ra0 instanceof Uint16Array);
});

test("a .SI3 track with a bad key or a grid file of the wrong size is refused with its message", { skip: skipV6 }, async () => {
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const text = (lines) => new TextEncoder().encode(lines.join("\r\n"));
  const bad = await v6Vfs([{ name: "DATA\\CRAZY4X.TXV", data: text(["formatVersion=6", "worldCells=300"]) }]);
  await assert.rejects(buildTrackRender(bad, "WORLD\\CRAZY4X.SI3"), /worldCells=300/);
  const clr = await v6Vfs([{ name: "DATA\\CRAZY4X.CLR", data: new Uint8Array(256 * 256 * 2) }]);
  await assert.rejects(buildTrackRender(clr, "WORLD\\CRAZY4X.SI3"), /CLR is 131072 bytes; a 512-cell world needs 524288/);
  const original = new TextDecoder().decode((await (await v6Vfs()).read("DATA\\CRAZY4X.TXV")));
  const later = await v6Vfs([{ name: "DATA\\CRAZY4X.TXV", data: text([original.replace(/formatVersion=6/i, "formatVersion=7")]) }]);
  const build = await buildTrackRender(later, "WORLD\\CRAZY4X.SI3");
  assert.match(build.notices[0].args[0], /newer build/);
});
