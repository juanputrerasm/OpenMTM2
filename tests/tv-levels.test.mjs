// Terminal Velocity, Fury3 and Hellbender levels as places to drive and fly about in (worker/tv-track-build.js,
// docs/CHANGELOG.md Stage 3.2). The tests with real files skip without the games under ~/games.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../src/vendor/openphotex/index.js";
import { createVfs } from "../src/worker/vfs.js";
import { buildCatalog } from "../src/worker/catalog.js";
import { buildSky, buildTrackRender } from "../src/worker/track-build.js";
import { SKY_CEILING_FT, TV_SCALES, drivableTvLevel, settleTvPlacement, tvClrWords, tvEditorToFeet } from "../src/worker/tv-track-build.js";
import { createSession } from "../src/worker/sim-worker.js";

const GAMES = process.env.OPENMTM2_GAMES ?? join(process.env.HOME ?? "", "games");
const ARCHIVES = { TV: ["tv", "CDROM.POD"], HB: ["hb", "GAME.POD"] };
const mount = (game) => {
  const [dir, file] = ARCHIVES[game];
  const bytes = new Uint8Array(readFileSync(join(GAMES, dir, file)));
  return { name: file, family: game, archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) };
};
const skipFor = (game) => (existsSync(join(GAMES, ...ARCHIVES[game])) ? false : `${ARCHIVES[game].join("/")} is not under ${GAMES}`);

test("positions: a cell is 32 ft; a height step 1 ft in Terminal Velocity (1/32 of a cell) and 2 ft in Hellbender (1/16)", () => {
  assert.deepEqual(tvEditorToFeet([64, 128, 10], TV_SCALES["TV/F3"].heightFt), [32, 10, 64]);
  assert.deepEqual(tvEditorToFeet([32, 0, 10], TV_SCALES.HB.heightFt), [16, 20, 0]);
  assert.equal(TV_SCALES["TV/F3"].model, 1 / 128);
  assert.equal(TV_SCALES.HB.model, 1 / 64);
});

test("placements settle where each engine puts them", () => {
  const flat = () => 10;
  const tv = { origin: "TV/F3", heightFt: 1, groundAt: flat };
  const def = (logic, y = 0, x = 0) => ({ logic, groundOffsetX: x, groundOffsetY: y, groundOffsetZ: 0 });
  // Terminal Velocity: on the ground whatever the file says, plus the Y offset, plus half the radius for a flyer.
  assert.deepEqual(settleTvPlacement([5, 99, 5], def(0), 65536, tv), [5, 10, 5]);
  assert.deepEqual(settleTvPlacement([5, 99, 5], def(0, 1 << 15), 65536, tv), [5, 11, 5]);
  assert.deepEqual(settleTvPlacement([5, 99, 5], def(4), 65536, tv), [5, 11, 5]);
  assert.deepEqual(settleTvPlacement([5, 99, 5], def(0, 0, 1 << 20), null, tv), [37, 10, 5], "an X offset of a cell is 32 ft");
  // Hellbender: the stored height, raised to the ground or onto a box it is inside; no Y offset, no lift.
  const hb = { origin: "HB", heightFt: 2, groundAt: flat, boxAt: () => ({ lowerFt: 10, upperFt: 30 }) };
  assert.deepEqual(settleTvPlacement([5, 4, 5], def(4, 1 << 20), 65536, hb), [5, 10, 5]);
  assert.deepEqual(settleTvPlacement([5, 20, 5], def(0), null, hb), [5, 30, 5]);
  assert.deepEqual(settleTvPlacement([5, 50, 5], def(0), null, hb), [5, 50, 5]);
});

test("the tile grid: one byte is six bits of tile and two of turn, Terminal Velocity's a step back; two bytes are MTM's word", () => {
  const one = new Uint8Array(65536);
  one[0] = 5;                 // tile 5, no turn
  one[1] = 5 | (1 << 6);      // tile 5, one turn
  one[2] = 200;               // past a 64-tile table's six bits when the table is larger
  assert.equal(tvClrWords(one, 40, "TV/F3")[0], 5 | (3 << 14));
  assert.equal(tvClrWords(one, 40, "TV/F3")[1], 5 | (0 << 14));
  assert.equal(tvClrWords(one, 40, "HB")[1], 5 | (1 << 14));
  assert.equal(tvClrWords(one, 100, "TV/F3")[2], 99, "more than 64 tiles: the byte is the tile, held to the table");
  const two = new Uint8Array(131072);
  two[0] = 0x34; two[1] = 0xc1;
  assert.equal(tvClrWords(two, 40, "HB")[0], 0xc134);
  assert.equal(tvClrWords(null, 40, "HB").length, 65536);
});

test("a tunnel level, an unfinished manifest and an MTM level are not levels to drive", () => {
  const enc = (lines) => new TextEncoder().encode(lines.join("\r\n"));
  const lines = Array.from({ length: 24 }, () => "NULL.XXX");
  lines[0] = "4"; lines[2] = "CITY.RAW";
  assert.ok(drivableTvLevel(enc(lines)));
  assert.equal(drivableTvLevel(enc(["1", ...lines.slice(1)])), null, "a tunnel by its first line");
  assert.equal(drivableTvLevel(enc([...lines.slice(0, 2), "CITY.TNL", ...lines.slice(3)])), null, "a tunnel by its spine");
  assert.equal(drivableTvLevel(enc(lines.slice(0, 8))), null);
});

for (const [game, label, sample] of [["TV", "TV/F3", null], ["HB", "HB", null]]) {
  test(`${game}: the surface levels are listed as free roam only, and one builds and can be driven on`, { skip: skipFor(game) }, async () => {
    const vfs = createVfs([mount(game)]);
    const { tracks, problems } = await buildCatalog(vfs);
    assert.deepEqual(problems, []);
    const levels = tracks.filter((t) => t.game === game);
    assert.ok(levels.length > 5, `${levels.length} levels`);
    for (const level of levels) {
      assert.equal(level.typeLabel, `Level (${label})`);
      assert.ok(level.freeRoamOnly && level.noTournament && level.raceType === "freeroam" && level.scope === game);
    }
    const level = levels.find((t) => t.file === sample) ?? levels[0];
    const build = await buildTrackRender(vfs.scoped(game), level.path, { truckFiles: [] });
    assert.ok(build.terrain.positions.length > 0 && build.terrain.atlas.rgba.length > 0, "a ground with its tiles");
    assert.ok(build.objects.length > 0 && Object.keys(build.models).length > 0, `${build.objects.length} objects`);
    assert.ok(Object.keys(build.modelTextures).length > 0, "model art decoded");
    assert.ok(build.skyReachable && build.sky.flat.ceilingFt >= SKY_CEILING_FT, "the sky is a ceiling fixed in the world");
    assert.deepEqual(build.sim.course, []);
    assert.deepEqual(build.sim.checkpoints, []);
    const missingShare = build.problems.length / (Object.keys(build.models).length + Object.keys(build.modelTextures).length + build.problems.length);
    assert.ok(missingShare < 0.25, `missing: ${build.problems.slice(0, 8).join(", ")}`);
    // Objects stand inside the world, at heights a heightfield can have.
    for (const o of build.originals.filter((p) => p.some((v) => v !== 0))) {
      assert.ok(o[0] >= 0 && o[0] <= 8192 && o[2] >= 0 && o[2] <= 8192 && o[1] >= 0 && o[1] < 2000, `object at ${o.slice(0, 3)}`);
    }
    const sky = await buildSky(vfs.scoped(game), level.path, 0);
    assert.ok(sky?.flat, "its own sky whatever the weather");
    // A truck set down at the start point comes to rest on the ground, and is not slowed as if in water.
    const { start } = build.sim;
    const session = createSession({
      heights: build.heights ? build.heights.buffer : null, heightsFt: build.heightsFt ? build.heightsFt.buffer : null,
      clr: build.sim.clr.buffer, textureValues: build.sim.textureValues.buffer, waterLevelFt: build.sim.waterLevelFt,
      boxes: [], ramps: [], course: [], weather: 0, difficulty: 1,
      trucks: [{ truck: {}, start: { pos: start.pos, heading: start.heading }, autopilot: false }],
    });
    for (let i = 0; i < 240; i++) session.step({});
    const s = session.state, ground = session.ground.height(s.pos[0], s.pos[2]);
    assert.ok(Number.isFinite(s.pos[1]) && s.pos[1] - ground > 1 && s.pos[1] - ground < 12, `rests ${s.pos[1] - ground} ft over the ground`);
    assert.notEqual(Math.floor(session.ground.surface(s.pos[0], s.pos[1], s.pos[2]) / 100), 13, "no deep water");
  });
}

test("a level of 128 cells is laid out twice each way to fill the world, as its wrapping repeats it", async () => {
  const { tileGrid } = await import("../src/worker/tv-track-build.js");
  const small = new Uint8Array(128 * 128);
  small[0] = 7; small[127] = 9; small[128 * 5 + 3] = 4;
  const big = tileGrid(small, 128);
  assert.equal(big.length, 65536);
  for (const [row, col] of [[0, 0], [0, 128], [128, 0], [128, 128]]) assert.equal(big[row * 256 + col], 7);
  assert.equal(big[127], 9);
  assert.equal(big[255], 9);
  assert.equal(big[(128 + 5) * 256 + 128 + 3], 4);
  const full = new Uint8Array(65536);
  assert.equal(tileGrid(full, 256), full);
});

test("Hellbender: a level's ground boxes are drawn and solid, at its own height step", { skip: skipFor("HB") }, async () => {
  const vfs = createVfs([mount("HB")]);
  const { tracks } = await buildCatalog(vfs);
  let found = null;
  for (const level of tracks.filter((t) => t.game === "HB")) {
    const build = await buildTrackRender(vfs.scoped("HB"), level.path, { truckFiles: [] });
    if (build.groundBoxes) { found = build; break; }
  }
  assert.ok(found, "a Hellbender level with ground boxes");
  assert.ok(found.groundBoxes.positions.length > 0 && found.sim.ra0.length === 65536 && found.sim.ra1.length === 65536);
  assert.equal(found.sim.groundBoxStepFt, TV_SCALES.HB.heightFt);
  // The level's own 128 cells are laid out twice each way, its boxes with it.
  const { ra0, ra1 } = found.sim;
  let boxes = 0;
  for (let i = 0; i < 65536; i++) {
    if (ra0[i] === ra1[i]) continue;
    boxes++;
    const row = i >> 8, col = i & 255;
    assert.equal(ra1[((row + 128) & 255) * 256 + ((col + 128) & 255)], ra1[i]);
  }
  assert.ok(boxes > 0);
  // A truck dropped over a box that stands clear of the ground comes to rest on its top, not on the ground under it.
  const terrainAt = (i) => (found.heightsFt ? found.heightsFt[i] : found.heights[i] * 2);
  let cell = -1;
  for (let i = 0; i < 65536 && cell < 0; i++) {
    const row = i >> 8, col = i & 255;
    if (row < 2 || col < 2 || row > 253 || col > 253 || ra1[i] === ra0[i]) continue;
    const top = ra1[i] * TV_SCALES.HB.heightFt;
    const flat = [-257, -256, -255, -1, 1, 255, 256, 257].every((d) => ra1[i + d] === ra1[i] && ra0[i + d] !== ra1[i + d]);
    if (flat && top - terrainAt(i) > 12) cell = i;
  }
  assert.ok(cell >= 0, "a flat roof of boxes to stand on");
  const top = ra1[cell] * TV_SCALES.HB.heightFt, x = (cell & 255) * 32 + 16, z = (cell >> 8) * 32 + 16;
  const session = createSession({
    heights: found.heights ? found.heights.buffer : null, heightsFt: found.heightsFt ? found.heightsFt.buffer : null,
    clr: found.sim.clr.buffer, textureValues: found.sim.textureValues.buffer, waterLevelFt: found.sim.waterLevelFt,
    ra0: ra0.buffer, ra1: ra1.buffer, groundBoxStepFt: found.sim.groundBoxStepFt, boxes: [], ramps: [], course: [], weather: 0, difficulty: 1,
    trucks: [{ truck: {}, start: { pos: [x, top + 8, z], heading: 0 }, autopilot: false }],
  });
  for (let i = 0; i < 240; i++) session.step({});
  const over = session.state.pos[1] - top;
  assert.ok(over > 3 && over < 8, `rests ${over} ft over the roof at ${top} ft`);
});
