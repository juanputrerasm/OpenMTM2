/*
  Community Patch 4's fog volumes (docs/CP4_EXE_ANALYSIS.md 4): which are drawn in a frame and the
  numbers the engine hands its renderer for each. Pure: no three.js, so the worker and the tests use it.

  The density itself is worked out in the renderer DLLs, which are not in the CP4 beta: the port
  reads it as Fila's own description of the feature has it (Traxx 1.7): `vis` is how far one sees
  into the fog before it is about 95 % opaque, the density halves every `half` ft upward from the
  bottom, the sides, top and bottom soften over `edge`, `top` and `bot`, and `round` takes the
  footprint from a rectangle (0) to an ellipse (1). render/fog-volumes.js integrates that along
  each line of sight. Wisps are not drawn.
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

const wrap = (d) => d - Math.round(d / WORLD_FT) * WORLD_FT;

/**
 * The volumes drawn this frame (`FUN_1401b7610`): those the weather allows, not too thin, and not further than the
 * draw range plus a tile (horizontal distance, wrapped, less the volume's radius); the nearest `most`, nearest first.
 * `eye` is game [x, z]. Returns `{ volume, dx, dz }`, dx and dz the shortest way from the eye to the volume.
 */
export function fogVolumesShown(volumes, eye, weather, rangeFt, most = FOG_VOLUMES_DRAWN) {
  const shown = [];
  for (const volume of volumes) {
    if (!volume.usable || !fogVolumeInWeather(volume, weather)) continue;
    const dx = wrap(volume.centre[0] - eye[0]), dz = wrap(volume.centre[2] - eye[1]);
    const dist = Math.hypot(dx, dz);
    if (dist - Math.hypot(volume.half[0], volume.half[2]) > rangeFt + TILE_FT) continue;
    shown.push({ volume, dx, dz, dist });
  }
  shown.sort((a, b) => a.dist - b.dist);
  return shown.slice(0, Math.min(FOG_VOLUMES_DRAWN, Math.max(1, most)));
}
