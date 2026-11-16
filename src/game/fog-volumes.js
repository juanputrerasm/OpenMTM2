/*
  Community Patch 4's fog volumes (docs/CP4_EXE_ANALYSIS.md 4): which are drawn in a frame and the
  numbers the engine hands its renderer for each. Pure: no three.js, so the worker and the tests use it.

  The density is worked out in the renderer DLL (trid3d11.dll, beta 0.53 hotfix 3; docs/CP4_EXE_ANALYSIS.md 15.11):
  `vis` is how far one sees into the fog before it is about 95 % opaque (extinction 3 / vis), the density halves every
  `half` ft upward from the floor, the sides, top and bottom soften over `edge`, `top` and `bot`, `round` takes the
  footprint from a near rectangle to an ellipse, and `wisp` breaks it up with a 3D noise `wsize` x 8 ft across that
  drifts through the box at `wspd` ft/s. render/fog-volumes.js integrates that along each line of sight, up to the
  ground (`fogVolumeGround`).
*/

/** Weather ids, which are the wmask's bit order. */
export const FOG_WEATHERS = Object.freeze(["Clear", "Cloudy", "Foggy", "Dense Fog", "Rain", "Snow", "Dusk", "Night", "Pitch Black"]);
/** The most volumes a track keeps, and the most drawn in a frame (`fogVolumeMax`'s default and ceiling). */
export const FOG_VOLUMES_KEPT = 64, FOG_VOLUMES_DRAWN = 16;
const TILE_FT = 32, WORLD_FT = 8192;
/** The light on a volume's colour by weather (`FUN_1403e6370`), floored at 0.05. */
const LIGHT = Object.freeze({ 1: 0.7, 4: 0.3, 6: 0.375, 7: 0.25, 8: 0 });

/** The light factor on a fog volume's colour in `weather`. */
export const fogVolumeLight = (weather) => Math.max(0.05, LIGHT[weather] ?? 1);

/** Whether a volume's wmask lets it be drawn in `weather`. */
export const fogVolumeInWeather = (fog, weather) => ((fog.wmask >>> 0) & (1 << weather)) !== 0;

/**
 * A SIT box's fog (OpenPhotex `parseMtmSit`: a type 14 box's `fog`) as a volume, game feet: `centre` (the box position,
 * raised by base + h / 2, so base is the bottom face), `half` extents [w, h, l] / 2, `heading` the box's (psi), and the
 * shader's inputs. A zero w, l or h falls back to the box's own width, length or height. Null for a box without fog
 * or position.
 */
export function fogVolumeOf(box) {
  const fog = box?.fog;
  if (!fog || !box.positionFt) return null;
  const [length = 0, width = 0, height = 0] = box.sizeFt ?? [];
  const w = fog.w > 0 ? fog.w : width, l = fog.l > 0 ? fog.l : length, h = fog.h > 0 ? fog.h : height;
  const [x, y, z] = box.positionFt;
  return {
    centre: [x, y + fog.base + h * 0.5, z], half: [w * 0.5, h * 0.5, l * 0.5], heading: box.psi ?? 0,
    color: [...fog.color],
    extinction: 3 / Math.max(fog.vis, 1e-3),
    falloff: fog.half > 0 ? 1 / fog.half : 0,
    edge: Math.max(0, Math.min(fog.edge, 0.5 * Math.min(w, l))),
    top: Math.max(0, Math.min(fog.top, h)),
    bottom: Math.max(0, Math.min(fog.bot, h)),
    maxOpacity: Math.min(1, Math.max(0, fog.maxOp)),
    round: Math.min(1, Math.max(0, fog.round)),
    wisp: Math.min(1, Math.max(0, fog.wisp)),
    // The wisps' noise: one tile of it is wsize x 8 ft across (at least 8), and it drifts at wspd ft/s (15.11).
    noiseTileFt: 8 * Math.max(fog.wsize ?? 0, 1),
    driftFtPerS: Number.isFinite(fog.wspd) ? fog.wspd : 0,
    wmask: fog.wmask >>> 0,
    // Too thin a side and the engine skips it.
    usable: w > 0.5 && l > 0.5 && h > 0.5,
  };
}

/** A SIT's fog volumes, in its order: its type 14 boxes with fog, at most FOG_VOLUMES_KEPT. */
export function fogVolumesOf(boxes) {
  const out = [];
  for (const box of boxes ?? []) {
    if (box.type !== 14) continue;
    const v = fogVolumeOf(box);
    if (v) out.push(v);
    if (out.length === FOG_VOLUMES_KEPT) break;
  }
  return out;
}

/**
 * A waterfall's mist (Community Patch 4 beta 0.53 hotfix 3, docs/CP4_EXE_ANALYSIS.md 16.4; OpenPhotex `fallMist`) as a
 * volume: one landing stream's box W across the landing (the box's own width), L along it, H up from the floor, turned so its width lies along
 * `axisW`, with the fog the engine sets for it.
 */
export function fallMistVolume(mist) {
  const [wx, wz] = mist.axisW;
  // A box's width lies along the game's (cos psi, -sin psi) (OpenPhotex eulerToMatrix), so psi turns it onto axisW.
  const psi = Math.atan2(-wz, wx);
  const volume = fogVolumeOf({ fog: mist.fog, positionFt: [mist.centre[0], mist.floorFt, mist.centre[1]], sizeFt: [mist.lengthFt, mist.widthFt, mist.heightFt], psi });
  return volume && softenFallMist(volume);
}

/**
 * OpenMTM2's own, not the engine's: how much of a waterfall mist's box its fades take. The engine fades the sides over 20
 * ft and the top over 5 ft (16.4), and a mist is dense (vis down to 20 ft), so a line of sight that grazes a side or the
 * top still gathers nearly all the fog it can and the box's outline shows. Here the sides fade over `edgeShare` of the
 * footprint's smaller half extent (the outline is a superellipse, so the ends too) and the top over `topShare` of the
 * box's height: the mist thickest at its middle and low, thinning out to every face. A SIT's own fog volumes keep theirs.
 */
export const FALL_MIST_SOFTEN = Object.freeze({ edgeShare: 0.85, topShare: 0.6 });

function softenFallMist(volume) {
  const [hx, hy, hz] = volume.half;
  return {
    ...volume,
    edge: Math.max(volume.edge, FALL_MIST_SOFTEN.edgeShare * Math.min(hx, hz)),
    top: Math.max(volume.top, FALL_MIST_SOFTEN.topShare * 2 * hy),
  };
}

/**
 * The SIT's fog volumes (`fogVolumesOf`) with the waterfalls' mist after them, as the engine appends them to the same
 * list (12.4, 16.4): one volume a landing stream, every fall's first stream before any second, each taking a slot
 * while the SIT's volumes and the mist so far are fewer than FOG_VOLUMES_KEPT and left without one after (the engine's
 * "NO mist for stream %d (no fog slot free)"). `mists` is OpenPhotex `fallMists(built, { sitFogVolumes:
 * volumes.length })`'s list (`{ slot, stream, mist }`, in that order). Returns `{ volumes, noSlot }`, the streams that
 * found none in `noSlot` as `{ slot, stream }`.
 */
export function withFallMists(volumes, mists) {
  const out = [...volumes], noSlot = [];
  for (const { slot, stream = 0, mist } of mists) {
    if (out.length >= FOG_VOLUMES_KEPT) { noSlot.push({ slot, stream }); continue; }
    const volume = fallMistVolume(mist);
    if (volume) out.push({ ...volume, fall: slot, stream });
  }
  return { volumes: out, noSlot };
}

const wrap = (d, worldFt = WORLD_FT) => d - Math.round(d / worldFt) * worldFt;

/**
 * The volumes drawn this frame (`FUN_1401b7610`): those the weather allows, not too thin, and not further than the
 * draw range plus a tile (horizontal distance, wrapped, less the volume's radius); the nearest `most`, nearest first.
 * `eye` is game [x, z]. Returns `{ volume, dx, dz }`, dx and dz the shortest way from the eye to the volume. The distance
 * wraps at `worldFt`, the world's size (track format version 6's 9.3: W).
 */
export function fogVolumesShown(volumes, eye, weather, rangeFt, most = FOG_VOLUMES_DRAWN, worldFt = WORLD_FT) {
  const shown = [];
  for (const volume of volumes) {
    if (!volume.usable || !fogVolumeInWeather(volume, weather)) continue;
    const dx = wrap(volume.centre[0] - eye[0], worldFt), dz = wrap(volume.centre[2] - eye[1], worldFt);
    const dist = Math.hypot(dx, dz);
    if (dist - Math.hypot(volume.half[0], volume.half[2]) > rangeFt + TILE_FT) continue;
    shown.push({ volume, dx, dz, dist });
  }
  shown.sort((a, b) => a.dist - b.dist);
  return shown.slice(0, Math.min(FOG_VOLUMES_DRAWN, Math.max(1, most)));
}

/**
 * The wisps' drift phase (15.11): how far through one tile of the noise the volume's drift has carried it after
 * `seconds`, 0 to 1.
 */
export function fogDriftPhase(volume, seconds) {
  const p = (volume.driftFtPerS * seconds) / volume.noiseTileFt;
  const f = p - Math.floor(p);
  return f >= 1 ? 0 : f;
}

/** The side of the wisps' noise volume, texels (the DLL's 64 x 64 x 64, one byte each). */
export const FOG_NOISE_SIDE = 64;
/** Its three octaves: lattice cells across the volume, hash seed and weight (15.11). */
const FOG_NOISE_OCTAVES = Object.freeze([[16, 2, 0.3], [8, 1, 0.5], [32, 3, 0.2]]);

function noiseHash(seed, x, y, z) {
  let h = Math.imul(seed, 0x9e3779b9) ^ Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

const quintic = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** One octave: value noise on a lattice of `cells` across the volume, wrapping, blended with the quintic fade. */
function noiseOctave(x, y, z, cells, seed, side) {
  const k = cells / side, m = cells - 1;
  const fx = x * k, fy = y * k, fz = z * k;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = quintic(fx - ix), ty = quintic(fy - iy), tz = quintic(fz - iz);
  const x0 = ix & m, x1 = (ix + 1) & m, y0 = iy & m, y1 = (iy + 1) & m, z0 = iz & m, z1 = (iz + 1) & m;
  const lerp = (a, b, t) => a + (b - a) * t;
  const plane = (zc) => lerp(
    lerp(noiseHash(seed, x0, y0, zc), noiseHash(seed, x1, y0, zc), tx),
    lerp(noiseHash(seed, x0, y1, zc), noiseHash(seed, x1, y1, zc), tx), ty);
  return lerp(plane(z0), plane(z1), tz);
}

let noiseVolume = null;
/**
 * The wisps' noise (15.11): a 64 x 64 x 64 volume of bytes that tiles, three octaves of value noise (8, 16 and 32 cells
 * across, weights 0.5, 0.3 and 0.2), stretched to the whole 0 to 255. Index (z * 64 + y) * 64 + x. Made once.
 */
export function fogNoiseVolume() {
  if (noiseVolume) return noiseVolume;
  const side = FOG_NOISE_SIDE, values = new Float32Array(side * side * side);
  let lo = Infinity, hi = -Infinity;
  for (let z = 0, i = 0; z < side; z++) {
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++, i++) {
        let v = 0;
        for (const [cells, seed, weight] of FOG_NOISE_OCTAVES) v += weight * noiseOctave(x, y, z, cells, seed, side);
        values[i] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  const scale = hi > lo ? 255 / (hi - lo) : 0;
  noiseVolume = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) noiseVolume[i] = Math.min(255, Math.max(0, (values[i] - lo) * scale + 0.5));
  return noiseVolume;
}

/** The side of a volume's ground map, texels. */
export const FOG_GROUND_SIDE = 32;

/**
 * The ground under a volume, for where its lines of sight end (OpenMTM2's stand-in for the DLL's scene depth, 15.11): a
 * `side` x `side` map over the box's footprint in its own turned frame (x across, z along, texel centres), each byte the
 * ground's height up the box, 0 at its floor (or below) to 255 at its top (or above). `heightAt(x, z)` is the drawn
 * ground's height at game feet.
 */
export function fogVolumeGround(volume, heightAt, side = FOG_GROUND_SIDE) {
  const out = new Uint8Array(side * side);
  const [cx, cy, cz] = volume.centre, [hx, hy, hz] = volume.half;
  // The box's local x and z in game feet (render/fog-volumes.js turns the scene by -heading; the game's z is the scene's -z).
  const c = Math.cos(volume.heading), s = Math.sin(volume.heading);
  const floor = cy - hy;
  for (let j = 0; j < side; j++) {
    const lz = ((j + 0.5) / side * 2 - 1) * hz;
    for (let i = 0; i < side; i++) {
      const lx = ((i + 0.5) / side * 2 - 1) * hx;
      const ground = heightAt(cx + c * lx - s * lz, cz - s * lx - c * lz);
      const up = Number.isFinite(ground) ? (ground - floor) / (2 * hy) : 0;
      out[j * side + i] = Math.round(Math.min(1, Math.max(0, up)) * 255);
    }
  }
  return out;
}

/** `volumes` each with its ground map (`fogVolumeGround`) as `ground`. */
export function withFogGround(volumes, heightAt) {
  if (!heightAt) return volumes;
  return volumes.map((volume) => ({ ...volume, ground: fogVolumeGround(volume, heightAt) }));
}
