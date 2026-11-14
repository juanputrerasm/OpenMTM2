/*
  Community Patch 4 beta 0.53's waterfalls (docs/CP4_EXE_ANALYSIS.md 12; docs/VISUALS.md, "Waterfalls") as the track
  build hands them on, beside worker/cp4-world.js's lakes. The .WFL is read in worker/level-load.js by the engine's
  parser; the sheets are built by OpenPhotex (sim/cp4/falls.ts: the walk, the budget, the vertices, the mist, the sound)
  on the track's own terrain and water; this picks what the engine picks at load: the ground the walk runs on, the
  on-screen messages, each fall's texture, which falls' sounds find room, and the mist's fog slots. The drawing is
  render/waterfalls.js. Falls never touch the simulation (12.10).
*/
import {
  FALL_SOUND_LOOP_ROOM, FALL_WEATHER_SNOW, buildFallMeshes, fallGround, fallHeightRange, fallMists, fallSound, fallTextureName, fallWater,
} from "../vendor/openphotex/sim/cp4/falls.js";
import { parseAnimations } from "../vendor/openphotex/tv/ani.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import { withFallMists } from "../game/fog-volumes.js";
import { msg } from "../game/strings.js";
import { mapWrap } from "../shared/scene-frame.js";

/** The parser's status texts the "damaged" message names (12.1.3; OpenPhotex `FALL_FILE_STATUS_TEXT`), as tags. */
export const FALL_STATUS_TAGS = Object.freeze({
  1: msg("empty file"),
  2: msg("not a waterfall file (bad magic)"),
  3: msg("file truncated (header)"),
  5: msg("bad header size or chunk directory runs past the end"),
  6: msg("authored for a different terrain size"),
  7: msg("no usable waterfall list"),
});

/** An animation holds at most 8 frames, a track at most 64 animations (the engine's `Animate.cpp`, 12.8.2). */
const ANIMATION_FRAMES = 8, ANIMATIONS = 64;

/**
 * The walk's ground (12.2.3) from a loaded level (worker/level-load.js): its heights as the engine holds them, in 1/128 ft
 * a step (v >> 1 at 1/64 ft is what the engine reads), on the 8 ft grid for a Spline or Full Map track and on the 32 ft
 * corners otherwise, for OpenPhotex `fallGround`. The level's feet are exact multiples of 1/64, so nothing is lost.
 *
 * A track format version 6 track with a terrainHeightMap holds its heights as the specification's 7.3 does (the h128
 * store, 1/128 ft in 32 bits, `h128: true`) on its N x N or 4N x 4N grid (9.3): the level's feet are that store over
 * 128 exactly (OpenPhotex `mtm2V6HeightsFt`), so nothing is lost either.
 */
export function fallHeights(level) {
  if (level.v6?.terrainHeightMap) {
    const h128 = (feet) => Int32Array.from(feet, (ft) => Math.round(ft * 128));
    const mode = level.fineFt ? (level.terrainMode === "fine" ? "fine" : "spline") : "classic16";
    return { mode, coarse: h128(level.heightsFt), fine: level.fineFt ? h128(level.fineFt) : null, h128: true };
  }
  const units = (feet) => Uint16Array.from(feet, (ft) => Math.round(ft * 128));
  if (level.fineFt) return { mode: level.terrainMode === "fine" ? "fine" : "spline", coarse: units(level.heightsFt), fine: units(level.fineFt) };
  if (level.heights) return { mode: "classic8", coarse: Uint16Array.from(level.heights, (b) => b << 8), fine: null };
  return { mode: "classic16", coarse: units(level.heightsFt), fine: null };
}

/**
 * The messages the loader shows when the file itself fails (12.1.3), `{ text, args }` (an arg `{ tag }` is translated
 * too): none when it was read. `file` is worker/level-load.js's `falls`.
 */
export function fallReadNotices(file) {
  if (!file) return [];
  if (!(file.size > 0)) return [{ text: msg("This track's waterfalls file could not be read."), args: [] }];
  if (file.status === 4) return [{ text: msg("This track's waterfalls need a newer build."), args: [] }];
  if (file.status !== 0) return [{ text: msg("This track's waterfalls file is damaged (<<1>>) and was not loaded."), args: [{ tag: FALL_STATUS_TAGS[file.status] ?? msg("no usable waterfall list") }] }];
  return [];
}

/** The messages after the build (12.1.3): "skipped" for a record the parser dropped or a fall refused, "too big" for one the budget dropped. */
export function fallBuildNotices(meshes) {
  const out = [];
  if (meshes?.skipped) out.push({ text: msg("Some of this track's waterfalls were skipped."), args: [] });
  if (meshes?.tooBig) out.push({ text: msg("Some of this track's waterfalls were too big and were left out."), args: [] });
  return out;
}

/**
 * Build the falls of a read file (12.1.5, 12.2) on the level's terrain and water: `heights` as `fallHeights` gives them,
 * `tileMap` the .WTR's tile map, `lakes` the lakes the WTR loader kept (`{ id, height }`, height in half feet, the
 * engine's lake table), `waterLevelFt` the .LVL's water. Null for a file that was not read.
 *
 * `cells` is the world's N and `terrain` its height step and base (`{ step, base }`, none without a terrainHeightMap):
 * a track format version 6 track's falls are built in its world (the specification's 9.3), the crest heights of a
 * version 2 file checked against the terrain's range (OpenPhotex `fallHeightRange`). The defaults are the 256 world's.
 */
export function buildFalls(file, { heights, tileMap = null, lakes = [], waterLevelFt = null, cells = 256, terrain = {} }) {
  if (!file || !(file.size > 0) || file.status !== 0) return null;
  const table = { lakes, tileMap, cells };
  return buildFallMeshes(file.falls, {
    ...table, heightRange: fallHeightRange(file.major, terrain),
    ground: fallGround(heights, { cells, h128: !!heights.h128 }), water: fallWater(table, waterLevelFt),
  });
}

/**
 * The falls' looping sounds (12.7), as worker/track-build.js's `soundObjects` carry them: each built fall's
 * (OpenPhotex `fallSound`: silent without the SOUND flag, with an empty stem, or on a FREEZE fall in Snow), nearest the
 * player's truck at load first (`player` its game feet, null for file order), while the track's 30 looping sounds
 * (`FALL_SOUND_LOOP_ROOM`) have room after its own `used`. `{ sounds, noRoom }`, `noRoom` the stems left silent.
 */
export function fallSoundObjects(meshes, { weather = 0, used = 0, player = null } = {}) {
  const loud = [];
  for (const fall of meshes?.falls ?? []) {
    const s = fallSound(fall, fall, { snow: weather === FALL_WEATHER_SNOW });
    if (s.silent === null) loud.push({ fall, s });
  }
  if (player) {
    const d2 = ({ fall, s }) => mapWrap(s.position[0] - player[0], fall.worldFt) ** 2 + mapWrap(s.position[2] - player[2], fall.worldFt) ** 2;
    loud.sort((a, b) => d2(a) - d2(b));
  }
  const room = Math.max(0, FALL_SOUND_LOOP_ROOM - used);
  const sounds = [], noRoom = [];
  for (const [i, { fall, s }] of loud.entries()) {
    if (i >= room) { noRoom.push(s.stem); continue; }
    sounds.push({ sitIndex: -1, fall: fall.slot, positionFt: s.position, sound: s.stem, moving: false, train: false, model: "", volume: s.volume, hearing: s.hearing });
  }
  return { sounds, noRoom };
}

/**
 * Each built fall's texture (12.8): an empty stem the ripple (`"ripple"`); else the track's animation of that name (its
 * .ANI, `animations` as OpenPhotex `parseAnimations` reads them; matched without case, as given and with ".RAW") when it
 * has frames and a delay and every frame loads; else the stem as a still (".RAW" added when it has no '.'); else the
 * ripple. `loadImage(name)` gives `ART\<name>` (or its HD picture) or null. Returns `{ textures, textureOf }`:
 * `textures[k]` is `{ name, frames: [image], delay }` (delay in ticks, 0 for a still), `textureOf[i]` fall i's index
 * there or "ripple".
 */
export async function fallTextures(falls, { animations = [], loadImage }) {
  const textures = [], byName = new Map();
  const anims = animations.slice(0, ANIMATIONS);
  const textureOf = [];
  for (const fall of falls) {
    const stem = fall.textureName ?? "";
    if (!stem) { textureOf.push("ripple"); continue; }
    const given = stem.toUpperCase(), name = fallTextureName(stem).toUpperCase();
    if (!byName.has(name)) {
      byName.set(name, (async () => {
        const anim = anims.find((a) => a.baseName === given || a.baseName === name);
        if (anim && anim.frames.length >= 1 && anim.rate >= 1) {
          const frames = await Promise.all(anim.frames.slice(0, ANIMATION_FRAMES).map((frame) => loadImage(frame)));
          if (frames.every(Boolean)) return { name, frames, delay: anim.rate };
          console.info(`Waterfall texture ${name}: an animation frame cannot be loaded - not animated`);
        }
        const still = await loadImage(name);
        if (still) return { name, frames: [still], delay: 0 };
        console.info(`Waterfall texture ${name} cannot be loaded - the ripple is used`);
        return null;
      })());
    }
    const texture = await byName.get(name);
    if (!texture) { textureOf.push("ripple"); continue; }
    let k = textures.indexOf(texture);
    if (k < 0) k = textures.push(texture) - 1;
    textureOf.push(k);
  }
  return { textures, textureOf };
}

/** The track's animation list (12.8.2): the .LVL's `.ANI` in DATA\ (or the level's own name), as `parseAnimations` reads it. */
export async function trackAnimations(vfs, level) {
  const named = level.lvl?.aniName && !/^NULL/i.test(level.lvl.aniName) ? `DATA\\${podPathTitle(level.lvl.aniName)}` : null;
  const lvlStem = podPathTitle(level.sit?.lvlName ?? `${level.stem}.LVL`).replace(/\.[^.]*$/, "");
  const bytes = (named ? await vfs.read(named) : null) ?? (await vfs.read(`DATA\\${lvlStem}.ANI`));
  try {
    return bytes ? parseAnimations(bytes) : [];
  } catch {
    return [];
  }
}

/**
 * Everything of the falls the track build hands on (`level` from worker/level-load.js):
 * - `falls`: for render/waterfalls.js, the track's one vertex buffer (16 floats a vertex, OpenPhotex `FALL_VERTEX`) and
 *   index buffer, `list` per built fall (its anchor, index range, bounds, flags, opacity 0..1, crest speed, texture (an
 *   index into `textures`, or -1 for the ripple) and its columns, spacing and vertices), `textures` and `ripple` (the
 *   eight RIPPL frames, or null); null
 *   when no fall was built;
 * - `fogVolumes`: `sitVolumes` with the mist volumes after them (12.4);
 * - `sounds`: the falls' entries for `soundObjects` (12.7), `used` being the track's own looping sounds;
 * - `notices`: the on-screen messages (12.1.3), `{ text, args }`.
 * `heights`, `tileMap`, `lakes` and `waterLevelFt` as `buildFalls` takes them; `weather` the race's; `player` where the
 * player's truck starts (game feet) or null; `loadImage(name)` an ART texture; `loadRipple()` the eight RIPPL frames.
 */
export async function buildTrackFalls(level, { heights, tileMap, lakes, waterLevelFt, sitVolumes = [], used = 0, weather = 0, player = null, animations = [], loadImage = async () => null, loadRipple = async () => null }) {
  const notices = fallReadNotices(level.falls);
  // A track format version 6 track's world and height range (9.3); without a terrainHeightMap, CP4's (step 128, base 0).
  const v6 = level.v6?.terrainHeightMap ? level.v6 : null;
  const terrain = v6 ? { step: v6.terrainHeightStep, base: v6.terrainHeightBase } : {};
  const meshes = buildFalls(level.falls, { heights, tileMap, lakes, waterLevelFt, cells: level.cells ?? 256, terrain });
  notices.push(...fallBuildNotices(meshes));
  if (!meshes) return { falls: null, fogVolumes: sitVolumes, sounds: [], notices };
  for (const r of meshes.refused) console.info(`Waterfall ${r.id}: REFUSED ${r.reason}`);
  for (const d of meshes.dropped) console.info(`Waterfall ${d.id}: DROPPED, nothing fits in the vertex budget (${d.left} left)`);
  const mist = fallMists(meshes.falls, { sitFogVolumes: sitVolumes.length });
  const { volumes, noSlot } = withFallMists(sitVolumes, mist.mists);
  for (const slot of [...mist.noSlot, ...noSlot]) console.info(`Waterfall ${meshes.falls[slot]?.id}: NO mist (no fog slot free, ${sitVolumes.length} volumes)`);
  const { sounds, noRoom } = fallSoundObjects(meshes, { weather, used, player });
  for (const stem of noRoom) notices.push({ text: msg("Too many looping sounds on this track; '<<1>>' is silent."), args: [stem] });
  if (!meshes.falls.length) return { falls: null, fogVolumes: volumes, sounds, notices };
  const { textures, textureOf } = await fallTextures(meshes.falls, { animations, loadImage });
  const ripple = textureOf.includes("ripple") ? await loadRipple() : null;
  const falls = {
    vertices: meshes.vertices, indices: meshes.indices, textures,
    ripple: ripple?.every(Boolean) ? ripple : null,
    list: meshes.falls.map((f, i) => ({
      slot: f.slot, id: f.id, flags: f.flags, anchorFt: f.anchorFt, firstIndex: f.firstIndex, indexCount: f.indexCount,
      // What the engine's log says of it (12.1.7), for a look at the build.
      columns: f.columns, spacing: f.spacing, vertexCount: f.vertexCount, shortened: f.shortened,
      bounds: f.bounds, opacity: Math.min(1, Math.max(0, f.opacity / 100)), crestSpeed: f.crestSpeedFtPerSec,
      texture: textureOf[i] === "ripple" ? -1 : textureOf[i],
    })),
  };
  return { falls, fogVolumes: volumes, sounds, notices };
}
