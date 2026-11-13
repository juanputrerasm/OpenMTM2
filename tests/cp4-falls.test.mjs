/*
  Community Patch 4 beta 0.53's waterfalls in OpenMTM2 (docs/CP4_EXE_ANALYSIS.md 12; worker/cp4-falls.js,
  game/waterfalls.js, game/fog-volumes.js `withFallMists`, worker/level-load.js `readLevelFalls`): the build glue on a
  synthetic track, the mist's fog slots, the sounds' order and room, the on-screen messages, the texture choice, the
  look, and the option. Then, opt-in with OPENMTM2_STOCK=1, Fila's beta 0.53 sandbox (~/games/cp4sandbox053/fog_test.pod,
  or OPENMTM2_CP4_053) through the whole track build.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeWfl } from "../src/vendor/openphotex/mtm/wfl.js";
import { FALL_FILE_STATUS_TEXT, FALL_MIST_WEATHER_NO_SNOW, fallGround, readFallFile } from "../src/vendor/openphotex/sim/cp4/falls.js";
import { parsePod } from "../src/vendor/openphotex/pod/parse.js";
import { readPodEntry } from "../src/vendor/openphotex/pod/lookup.js";
import {
  FALL_STATUS_TAGS, buildTrackFalls, fallBuildNotices, fallHeights, fallReadNotices, fallSoundObjects, fallTextures,
} from "../src/worker/cp4-falls.js";
import { readLevelFalls, fallStem } from "../src/worker/level-load.js";
import { FOG_VOLUMES_KEPT, fallMistVolume, withFallMists } from "../src/game/fog-volumes.js";
import {
  FALL_LOOK_ICE, FALL_LOOK_ORIGINAL, advanceWaterfallClock, waterfallAnimationFrame, waterfallInRange, waterfallLook, waterfallRippleFrame,
  waterfallShaderTime, WATERFALL_TUNING,
} from "../src/game/waterfalls.js";
import { createVfs } from "../src/worker/vfs.js";
import { transferablesOf } from "../src/worker/track-build.js";
import { GAMES, skipLocal } from "./helpers/stock.mjs";

const FREEZE = 1, SPLASH = 2, SOUND = 4;
const ft16 = (x, z) => ({ x: x * 16, z: z * 16 });

/** Two falls on flat ground at 0 ft with the .LVL's water at 10 ft: lake 1 (50 ft, tiles x < 32) feeds the first. */
function synthetic({ falls = null } = {}) {
  const records = falls ?? [
    { source: 1, flags: FREEZE | SPLASH | SOUND, speed: 96, height: 100, points: [ft16(1000, 1000), ft16(1000, 1040)], opacity: 80, mist: 100, volume: 100, soundName: "ROAR" },
    { source: 0, flags: SPLASH | SOUND, speed: 64, height: 120, points: [ft16(3000, 3000), ft16(3000, 3030)], opacity: 100, mist: 0, volume: 50, soundName: "HISS" },
  ];
  const bytes = writeWfl(records);
  const tileMap = new Uint8Array(65536);
  for (let z = 0; z < 64; z++) for (let x = 0; x < 32; x++) tileMap[z * 256 + x] = 1;
  const level = { heights: new Uint8Array(65536), heightsFt: null, fineFt: null, terrainMode: "classic8", falls: { size: bytes.length, ...readFallFile(bytes) } };
  return { level, opts: { heights: fallHeights(level), tileMap, lakes: [{ id: 1, height: 100 }], waterLevelFt: 10 } };
}

const fakeImage = (v) => ({ width: 2, height: 2, rgba: new Uint8Array(16).fill(v) });
const ripple = async () => Array.from({ length: 8 }, (_, i) => fakeImage(i));

test("the build glue: both falls on the track's ground and water, one vertex and index buffer, transferable", async () => {
  const { level, opts } = synthetic();
  const out = await buildTrackFalls(level, { ...opts, loadRipple: ripple });
  assert.deepEqual(out.notices, []);
  const [a, b] = out.falls.list;
  assert.equal(out.falls.list.length, 2);
  assert.deepEqual([a.columns, a.spacing, b.columns], [Math.ceil(40 / 2) + 1, 2, Math.ceil(30 / 2) + 1]);
  assert.deepEqual(a.anchorFt, [1000, 50, 1000]);
  assert.equal(a.opacity, 0.8);
  assert.equal(a.crestSpeed, 6);
  assert.deepEqual([a.texture, b.texture], [-1, -1], "no stem: the ripple");
  assert.equal(out.falls.ripple.length, 8);
  assert.ok(out.falls.vertices instanceof Float32Array && out.falls.indices instanceof Uint32Array);
  assert.equal(out.falls.vertices.length, (a.vertexCount + b.vertexCount) * 16);
  assert.equal(b.firstIndex, a.indexCount);
  assert.equal(out.falls.indices.length, a.indexCount + b.indexCount);
  const moved = transferablesOf({ falls: out.falls });
  assert.ok(moved.includes(out.falls.vertices.buffer) && moved.includes(out.falls.indices.buffer));
});

test("the walk's ground is the level's heights as the engine holds them (v >> 1 at 1/64 ft)", () => {
  const heights = new Uint8Array(65536);
  heights[3 * 256 + 5] = 7;
  const classic = fallHeights({ heights, heightsFt: null, fineFt: null, terrainMode: "classic8" });
  assert.equal(classic.mode, "classic8");
  assert.equal(fallGround(classic)(5 * 32, 3 * 32), 14, "a byte is 2 ft");
  const heightsFt = Float32Array.from({ length: 65536 }, (_, i) => (i % 97) * 0.515625);
  const c16 = fallHeights({ heights: null, heightsFt, fineFt: null, terrainMode: "classic16" });
  for (const i of [0, 96, 1234]) assert.equal((c16.coarse[i] >> 1) / 64, heightsFt[i]);
  const fineFt = new Float32Array(1024 * 1024).fill(3.25);
  const fine = fallHeights({ heights: null, heightsFt, fineFt, terrainMode: "spline" });
  assert.equal(fine.mode, "spline");
  assert.equal(fallGround(fine)(100.5, 200.25), 3.25, "a Spline track walks the 8 ft grid");
});

test("the mist goes after the SIT's fog volumes, with FREEZE's weather mask, while the 64 slots last (12.4)", async () => {
  const { level, opts } = synthetic();
  const sit = [{ wmask: 0x1ff, centre: [0, 0, 0], half: [1, 1, 1] }];
  const out = await buildTrackFalls(level, { ...opts, sitVolumes: sit });
  assert.equal(out.fogVolumes.length, 2, "the spring has no mist (mist 0)");
  assert.equal(out.fogVolumes[0], sit[0]);
  const mist = out.fogVolumes[1];
  assert.equal(mist.fall, 0);
  assert.equal(mist.wmask, FALL_MIST_WEATHER_NO_SNOW, "not in Snow on a FREEZE fall");
  // The landing is the LVL water, 10 ft: the floor 2 ft under it.
  assert.equal(mist.centre[1] - mist.half[1], 8);
  const full = Array.from({ length: FOG_VOLUMES_KEPT }, () => sit[0]);
  const none = await buildTrackFalls(level, { ...opts, sitVolumes: full });
  assert.equal(none.fogVolumes.length, FOG_VOLUMES_KEPT, "no fog slot free");
  const one = await buildTrackFalls(level, { ...opts, sitVolumes: full.slice(1) });
  assert.equal(one.fogVolumes.length, FOG_VOLUMES_KEPT);
  assert.equal(one.fogVolumes.at(-1).fall, 0);
});

test("a mist volume lies W across the landing and L along it", () => {
  const mist = {
    widthFt: 60, lengthFt: 30, heightFt: 20, centre: [100, 200], floorFt: 5, axisW: [0, 1], axisL: [-1, 0],
    fog: { w: 60, l: 30, h: 20, base: 0, vis: 100, color: [0.75, 0.78, 0.82], half: 10, edge: 20, top: 5, bot: 0, maxOp: 1, wmask: 0x1ff, round: 1, wisp: 0.6, wsize: 25, wspd: 2 },
  };
  const v = fallMistVolume(mist);
  assert.deepEqual(v.centre, [100, 15, 200]);
  assert.deepEqual(v.half, [30, 10, 15]);
  // A box's width runs along the game's (cos psi, -sin psi).
  assert.ok(Math.abs(Math.cos(v.heading) - 0) < 1e-12 && Math.abs(-Math.sin(v.heading) - 1) < 1e-12);
  assert.equal(v.extinction, 3 / 100);
  const { volumes, noSlot } = withFallMists([], [{ slot: 3, mist }]);
  assert.deepEqual([volumes.length, volumes[0].fall, noSlot], [1, 3, []]);
});

test("sounds: silent without a stem and frozen in Snow, nearest the player first, in the room the track's loops leave (12.7)", async () => {
  const { level, opts } = synthetic();
  const out = await buildTrackFalls(level, { ...opts, player: [3000, 0, 3100] });
  assert.deepEqual(out.sounds.map((s) => s.sound), ["HISS", "ROAR"]);
  const roar = out.sounds[1];
  assert.equal(roar.sitIndex, -1);
  assert.equal(roar.fall, 0);
  assert.equal(roar.positionFt[1], 10, "from the landing, not the crest");
  assert.ok(roar.hearing >= 1 && roar.hearing <= 2 && roar.volume > 0);
  const wrapped = await buildTrackFalls(level, { ...opts, player: [8000, 0, 900] });
  assert.equal(wrapped.sounds[0].sound, "ROAR", "the distance is taken across the world's edge");
  const snow = await buildTrackFalls(level, { ...opts, weather: 5 });
  assert.deepEqual(snow.sounds.map((s) => s.sound), ["HISS"]);
  const full = await buildTrackFalls(level, { ...opts, used: 29, player: [3000, 0, 3100] });
  assert.deepEqual(full.sounds.map((s) => s.sound), ["HISS"]);
  assert.deepEqual(full.notices, [{ text: "Too many looping sounds on this track; '<<1>>' is silent.", args: ["ROAR"] }]);
  const silent = fallSoundObjects({ falls: [] }, { used: 40 });
  assert.deepEqual(silent, { sounds: [], noRoom: [] });
  const noStem = synthetic({ falls: [{ source: 0, flags: SOUND, speed: 64, height: 120, points: [ft16(3000, 3000), ft16(3000, 3030)], opacity: 100, mist: 0, volume: 50, soundName: "" }] });
  assert.deepEqual((await buildTrackFalls(noStem.level, noStem.opts)).sounds, [], "no default roar");
});

test("the loader's on-screen messages (12.1.3)", async () => {
  assert.deepEqual(fallReadNotices(null), []);
  assert.deepEqual(fallReadNotices({ size: 0, status: 1 }).map((n) => n.text), ["This track's waterfalls file could not be read."]);
  assert.deepEqual(fallReadNotices({ size: 40, status: 4 }).map((n) => n.text), ["This track's waterfalls need a newer build."]);
  const damaged = fallReadNotices({ size: 40, status: 6 });
  assert.equal(damaged[0].text, "This track's waterfalls file is damaged (<<1>>) and was not loaded.");
  assert.deepEqual(damaged[0].args, [{ tag: "authored for a different terrain size" }]);
  for (const s of [1, 2, 3, 5, 6, 7]) assert.equal(FALL_STATUS_TAGS[s], FALL_FILE_STATUS_TEXT[s], "the tags are the engine's status texts");
  assert.deepEqual(fallBuildNotices({ skipped: true, tooBig: true }).map((n) => n.text),
    ["Some of this track's waterfalls were skipped.", "Some of this track's waterfalls were too big and were left out."]);
  // A lake-fed fall whose height is not its lake's is refused: "skipped", and the other is still built.
  const { level, opts } = synthetic();
  const out = await buildTrackFalls(level, { ...opts, lakes: [{ id: 1, height: 101 }] });
  assert.deepEqual(out.notices.map((n) => n.text), ["Some of this track's waterfalls were skipped."]);
  assert.deepEqual(out.falls.list.map((f) => f.id), [2]);
  const bad = { size: 4, status: 2, falls: [] };
  const read = await buildTrackFalls({ falls: bad }, opts);
  assert.equal(read.falls, null);
  assert.equal(read.notices.length, 1);
});

test("the .WFL is read only from the level's own archive (12.1.1)", async () => {
  const bytes = writeWfl([{ source: 0, flags: 0, speed: 64, height: 120, points: [ft16(10, 10), ft16(10, 40)], opacity: 100, mist: 0, volume: 0 }]);
  const mount = (name, files) => ({
    name, archive: { entries: Object.keys(files).map((path) => ({ normalizedName: path })) },
    readEntry: async (entry) => files[entry.normalizedName],
  });
  const lvl = new Uint8Array([1]);
  const same = createVfs([mount("A.POD", { "LEVELS/X.LVL": lvl, "WORLD/X.WFL": bytes })]);
  const read = await readLevelFalls(same, ["X"], same.find("LEVELS\\X.LVL"));
  assert.deepEqual([read.status, read.falls.length, read.size], [0, 1, bytes.length]);
  const apart = createVfs([mount("A.POD", { "LEVELS/X.LVL": lvl }), mount("B.POD", { "WORLD/X.WFL": bytes })]);
  assert.equal(await readLevelFalls(apart, ["X"], apart.find("LEVELS\\X.LVL")), null, "another archive's falls are ignored");
  assert.equal(await readLevelFalls(same, ["Y"], same.find("LEVELS\\X.LVL")), null);
  assert.equal(fallStem("FOG.TEST.LVL"), "FOG", "the stem ends at the first '.'");
});

test("a fall's texture: the track's animation, else the still, else the ripple (12.8.2)", async () => {
  const falls = [{ textureName: "" }, { textureName: "fan" }, { textureName: "ROCK" }, { textureName: "GONE" }, { textureName: "BROKEN" }, { textureName: "fan.raw" }];
  const animations = [
    { baseName: "FAN.RAW", frames: ["FAN1.RAW", "FAN2.RAW"], rate: 9830 },
    { baseName: "BROKEN.RAW", frames: ["B1.RAW", "MISSING.RAW"], rate: 16384 },
  ];
  const have = new Set(["FAN1.RAW", "FAN2.RAW", "ROCK.RAW", "B1.RAW", "BROKEN.RAW"]);
  const { textures, textureOf } = await fallTextures(falls, { animations, loadImage: async (name) => (have.has(name) ? fakeImage(1) : null) });
  assert.deepEqual(textureOf, ["ripple", 0, 1, "ripple", 2, 0]);
  assert.deepEqual(textures.map((t) => [t.name, t.frames.length, t.delay]), [["FAN.RAW", 2, 9830], ["ROCK.RAW", 1, 0], ["BROKEN.RAW", 1, 0]]);
});

test("the look: Original under any water, Ice in Snow on a FREEZE fall (12.8.3)", () => {
  assert.equal(waterfallLook(0, FREEZE | SPLASH), FALL_LOOK_ORIGINAL);
  assert.equal(waterfallLook(5, SPLASH), FALL_LOOK_ORIGINAL);
  assert.equal(waterfallLook(5, FREEZE), FALL_LOOK_ICE);
  assert.equal(waterfallLook(4, FREEZE), FALL_LOOK_ORIGINAL);
});

test("the shader's clock, the ripple's frames and an animation's (12.8, 12.9)", () => {
  assert.equal(waterfallShaderTime(0), 0);
  assert.ok(Math.abs(waterfallShaderTime(1) - 65536 * Math.fround(1.5254237e-05)) < 1e-9);
  assert.ok(waterfallShaderTime(700) < 600, "wraps at 600 s");
  assert.deepEqual(Array.from({ length: 15 }, (_, i) => waterfallRippleFrame(i * 0.25)), [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.equal(waterfallAnimationFrame(9830 * 3, 2, 9830), 1);
  assert.equal(advanceWaterfallClock(0, 1, 2, 16384), 0, "four frames of a quarter second in a second: back to the start");
  assert.deepEqual(WATERFALL_TUNING, { edge: 1, liftFt: 0.4, depthPull: 0.004 });
  const bounds = { min: [0, -256 * 40, 0], max: [256 * 30, 0, 256 * 40] };
  // Half its diagonal is 32 ft: 968 ft to its nearest reach, against the range plus a 32 ft tile.
  assert.equal(waterfallInRange(1000, 0, bounds, 940), true, "within the range plus a tile of its nearest reach");
  assert.equal(waterfallInRange(1000, 0, bounds, 930), false);
});

test("Waterfalls is on by default, and on for saves before version 16", async () => {
  const { DEFAULT_SETTINGS, SETTINGS_VERSION, migrateSettings } = await import("../src/app/settings.js");
  assert.ok(SETTINGS_VERSION >= 16);
  assert.equal(DEFAULT_SETTINGS.cp4Waterfalls, true);
  assert.equal(migrateSettings({ version: 15, cp4Waterfalls: false }).cp4Waterfalls, true);
  assert.equal(migrateSettings({ version: 16, cp4Waterfalls: false }).cp4Waterfalls, false);
});

// ---- Fila's beta 0.53 sandbox ----

const SANDBOX_053 = process.env.OPENMTM2_CP4_053 ?? join(GAMES, "cp4sandbox053", "fog_test.pod");

test("the 0.53 sandbox's two falls reach the track build", { skip: skipLocal(SANDBOX_053) }, async () => {
  const { buildTrackRender } = await import("../src/worker/track-build.js");
  const bytes = new Uint8Array(readFileSync(SANDBOX_053));
  const vfs = createVfs([{ name: "FOG_TEST.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) }]);
  const build = await buildTrackRender(vfs, "WORLD\\FOGTEST.SI2", {});
  const [a, b] = build.falls.list;
  assert.equal(build.falls.list.length, 2);
  assert.deepEqual([a.columns, a.spacing, a.vertexCount], [48, 2, 2913]);
  assert.deepEqual([b.columns, b.vertexCount], [25, 2506]);
  assert.ok(build.fogVolumes.some((v) => v.fall === 0), "fall 1 has its mist");
  assert.ok(!build.fogVolumes.some((v) => v.fall === 1), "fall 2 has none");
  assert.ok(!build.soundObjects.some((s) => s.fall !== undefined), "both sounds are silent: empty stems");
  assert.deepEqual(build.notices, []);
  const off = await buildTrackRender(vfs, "WORLD\\FOGTEST.SI2", { waterfalls: false });
  assert.equal(off.falls, null, "Waterfalls off: the file is not read");
});
