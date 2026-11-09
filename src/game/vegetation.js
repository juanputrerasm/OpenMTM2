/*
  Community Patch 4's vegetation rules (docs/CP4_EXE_ANALYSIS.md 3): how far each species is drawn
  as its model and as its far card, how far grass reaches and how much of it is kept, which trees
  the scenery detail keeps, and a tree's trunk for collision. Pure: no three.js, so the worker
  and the tests use it.
*/

export const VEG_KIND_TREE = 0, VEG_KIND_GRASS = 1;
/** SPEC flags as the engine reads them: 0x04 a separate far-card band (a crossfade), 0x08 no far card. */
export const VEG_CROSSFADE = 0x04, VEG_NO_FAR_CARD = 0x08;
/** SPEC flags as Traxx 1.7 writes them (OpenPhotex mtm/veg.ts), which the engine was not seen reading: shadows, the port's own. */
export const VEG_CAST_SHADOW = 0x01, VEG_FAR_SHADOW = 0x02;

/** The engine's defaults: model fade and far-card band 900..1000 ft, grass 1000 ft, `vegLodScale` and `vegGrassDensity` 100 %. */
export const VEG_DEFAULTS = Object.freeze({ fadeStartFt: 900, fadeEndFt: 1000, grassFt: 1000, lodScale: 100, grassDensity: 100 });
/** Distances are capped here after the scale. */
const MOST_FT = 60000;

const scaled = (ft, lodScale) => Math.min(MOST_FT, ft * Math.min(1000, Math.max(10, lodScale)) / 100);

/**
 * How a species is drawn by distance (feet from the eye): `model` and `card` each `[in0, in1, out0, out1]`, shown fully
 * from in1 to out0, fading in over in0..in1 and out over out0..out1 (a band of zero width is a hard switch). A tree
 * without the crossfade flag swaps at X = floor((start + end) / 2), the model drawn to X + 1 and the card from X; with it
 * the model fades out over 900..1000 ft while the card fades in over the same. Grass fades from 0.75 x its distance to
 * its distance. `card` is null where there is no far card to draw (flag 0x08, or none named): the model is then drawn as
 * far as anything is (the engine's rule for that case is not traced; the port's reading). The SPEC's own distances
 * (+0x88..+0x90) are not read by OpenPhotex, so the engine's defaults for a zero stand.
 */
export function vegDistances(species, { lodScale = VEG_DEFAULTS.lodScale, grassFt = VEG_DEFAULTS.grassFt, hasCard = true } = {}) {
  if (species.kind === VEG_KIND_GRASS) {
    const d = scaled(species.grassFt || grassFt, lodScale);
    return { model: [0, 0, d * 0.75, d], card: null };
  }
  const a = scaled(species.fadeStartFt || VEG_DEFAULTS.fadeStartFt, lodScale), b = scaled(species.fadeEndFt || VEG_DEFAULTS.fadeEndFt, lodScale);
  const carded = hasCard && !(species.flags & VEG_NO_FAR_CARD) && !!species.farModel;
  if (!carded) return { model: [0, 0, Infinity, Infinity], card: null };
  if (species.flags & VEG_CROSSFADE) {
    const c = scaled(species.cardStartFt || VEG_DEFAULTS.fadeStartFt, lodScale), d = scaled(species.cardEndFt || VEG_DEFAULTS.fadeEndFt, lodScale);
    return { model: [0, 0, a, b], card: [c, d, Infinity, Infinity] };
  }
  const x = Math.floor((a + b) / 2);
  return { model: [0, 0, x + 1, x + 1], card: [x, x, Infinity, Infinity] };
}

/** How much a band `[in0, in1, out0, out1]` shows at `distFt`, 0 to 1 (linear over each ramp). */
export function bandShare([in0, in1, out0, out1], distFt) {
  const rise = in1 > in0 ? Math.min(1, Math.max(0, (distFt - in0) / (in1 - in0))) : distFt >= in0 ? 1 : 0;
  const fall = out1 > out0 ? 1 - Math.min(1, Math.max(0, (distFt - out0) / (out1 - out0))) : distFt < out0 ? 1 : 0;
  return rise * fall;
}

/** How many of a grass tile's `count` clumps `vegGrassDensity` (1..100 %) keeps: the first ceil(count * density / 100). */
export const grassKept = (count, density = VEG_DEFAULTS.grassDensity) => Math.ceil(count * Math.min(100, Math.max(1, density)) / 100);

/** Whether a tree of detail `tier` is drawn and collides at the scenery detail `detail`. */
export const treeShown = (tier, detail) => tier <= detail;

/**
 * A tree's trunk cylinder (collide 1), docs/CP4_EXE_ANALYSIS.md 3, before the tree's scale: `{ widthFt, heightFt }`.
 * `species.trunkDiameter` is in 1/64 ft and `trunkHeight` in 1/16 ft (0 derives them); `model` the decoded model
 * (`bounds`, `meshes[].positions`, game frame).
 */
export function trunkOf(species, model) {
  const b = model?.bounds;
  if (!b) return null;
  const radius = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2, tall = b.max[1] - b.min[1];
  let width;
  if (species.trunkDiameter) width = species.trunkDiameter / 64;
  else {
    width = radius * 0.3;
    // Refined from the vertices within 5 ft of the base: 65 % of their spread across, when more than two are there.
    let n = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const mesh of model.meshes ?? []) {
      const p = mesh.positions;
      for (let i = 0; i + 2 < p.length; i += 3) {
        if (p[i + 1] > b.min[1] + 5) continue;
        n++;
        x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
      }
    }
    if (n > 2) width = 0.65 * Math.max(x1 - x0, z1 - z0);
    width = Math.min(2 * radius, Math.max(1, width));
  }
  const heightFt = species.trunkHeight ? species.trunkHeight / 16 : Math.min(tall, Math.max(6, tall * 0.3));
  return { widthFt: width, heightFt, baseFt: b.min[1] };
}
