/*
  Community Patch 4's additions to an MTM2 track, as the drawing and the simulation take them
  (docs/CP4_EXE_ANALYSIS.md 2 and 3): each lake's water sheet, built from the .WTR's tile map, and
  the .VEG's trees and grass as instances by species, with the trunks the trucks run into. The
  files themselves are read by OpenPhotex (mtm/wtr.ts, mtm/veg.ts) in worker/level-load.js.
  No three.js: the arrays are in scene coordinates (shared/scene-frame.js: x, y, -z), feet.
*/
import { vegClumpAt, vegTreeAt } from "../vendor/openphotex/mtm/veg.js";
import { VEG_CAST_SHADOW, VEG_FAR_SHADOW, VEG_KIND_GRASS, VEG_KIND_TREE, VEG_NO_FAR_CARD, grassKept, treeShown, trunkOf, vegDistances } from "../game/vegetation.js";

const TILES = 256, TILE_FT = 32, WORLD_FT = 8192;

/**
 * One flat sheet per lake at its surface (`lakes`: worker/track-build.js `lakesOf`), over the 32 ft tiles the tile map
 * gives it: each row's runs of the lake's tiles merged into one quad, facing up. `positions` (scene feet), `uvs` the
 * world's x / 8192 and z / 8192 as the track's water plane has them (render/track-scene.js `createWater`), `indices`.
 * Returns the bodies with their sheet added (`sheet`), those without a tile left out.
 */
export function buildLakeSheets(lakes) {
  if (!lakes?.tileMap) return [];
  const runs = new Map();
  for (let z = 0; z < TILES; z++) {
    let x = 0;
    while (x < TILES) {
      const id = lakes.tileMap[z * TILES + x];
      if (!id) { x++; continue; }
      let end = x + 1;
      while (end < TILES && lakes.tileMap[z * TILES + end] === id) end++;
      if (!runs.has(id)) runs.set(id, []);
      runs.get(id).push([x, end, z]);
      x = end;
    }
  }
  const out = [];
  for (const body of lakes.bodies ?? []) {
    const list = runs.get(body.id);
    if (!list) continue;
    const positions = new Float32Array(list.length * 12), uvs = new Float32Array(list.length * 8), indices = new Uint32Array(list.length * 6);
    list.forEach(([x0, x1, z], k) => {
      // Game corners (x, z): (x0, z), (x1, z), (x1, z + 1), (x0, z + 1), in tiles.
      const corners = [[x0, z], [x1, z], [x1, z + 1], [x0, z + 1]];
      corners.forEach(([cx, cz], c) => {
        const xf = cx * TILE_FT, zf = cz * TILE_FT, v = k * 4 + c;
        positions[v * 3] = xf; positions[v * 3 + 1] = body.levelFt; positions[v * 3 + 2] = -zf;
        uvs[v * 2] = xf / WORLD_FT; uvs[v * 2 + 1] = zf / WORLD_FT;
      });
      // Counter-clockwise seen from above in the scene (z mirrored), so the face looks up.
      const v = k * 4, i = k * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
    });
    out.push({ ...body, sheet: { positions, uvs, indices } });
  }
  return out;
}

/**
 * A yaw's scene rotation entries, three.js Matrix4 elements 0, 2, 8 and 10: shared/scene-frame.js `toSceneMatrix` of the
 * game's turn about y (OpenPhotex `eulerToMatrix(0, 0, psi)` = [c 0 s; 0 1 0; -s 0 c]).
 */
export function sceneTurn(psi) {
  const c = Math.cos(psi), s = Math.sin(psi);
  return [c, s, -s, c];
}

/** Eight numbers an instance in `place`: scene x, y, z, the turn's matrix elements 0, 2, 8 and 10 (`sceneTurn`), and the scale. */
export const VEG_PLACE_STRIDE = 8;

function pushPlace(list, x, y, z, psi, scale) {
  const [e0, e2, e8, e10] = sceneTurn(psi);
  list.push(x, y, -z, e0, e2, e8, e10, scale);
}

/**
 * The .VEG's species as the drawing takes them, `veg` OpenPhotex's `parseMtm2Veg` result: per species its model and far
 * card (bare names, as `MODELS\<name>` holds them), kind, distances (game/vegetation.js `vegDistances`), shadow flags and
 * its instances (`place`, VEG_PLACE_STRIDE numbers each). Trees above the scenery `detail` are left out; grass only
 * with `grass`, thinned by `grassDensity` per tile. `hasModel(name)` says whether a model could be read (a far card
 * that is missing is not drawn); `titleOf` names a model as the build's `models` keys it.
 */
export function buildVegetation(veg, { detail = 2, grass = true, grassDensity = 100, lodScale = 100, hasModel = () => true, titleOf = (name) => name } = {}) {
  if (!veg) return null;
  const places = veg.species.map(() => []);
  const t = veg.trees;
  for (let i = 0; i < t.count; i++) {
    const s = t.species[i], spec = veg.species[s];
    if (!spec || spec.kind !== VEG_KIND_TREE || !treeShown(t.tier[i], detail)) continue;
    const at = vegTreeAt(t, i);
    pushPlace(places[s], at.x, at.y, at.z, at.headingTurns * 2 * Math.PI, at.scale);
  }
  const c = veg.clumps;
  if (grass) {
    for (const tile of c.tiles) {
      const kept = grassKept(tile.count, grassDensity);
      for (let i = tile.first; i < tile.first + kept && i < c.count; i++) {
        const s = c.species[i], spec = veg.species[s];
        if (!spec || spec.kind !== VEG_KIND_GRASS) continue;
        const at = vegClumpAt(c, tile, i);
        pushPlace(places[s], at.x, at.y, at.z, at.headingTurns * 2 * Math.PI, at.scale);
      }
    }
  }
  const species = [];
  veg.species.forEach((spec, index) => {
    if (!places[index].length || !spec.model || !hasModel(spec.model)) return;
    const card = spec.kind === VEG_KIND_TREE && !(spec.flags & VEG_NO_FAR_CARD) && spec.farModel && hasModel(spec.farModel) ? spec.farModel : null;
    const distances = vegDistances(spec, { lodScale, hasCard: !!card });
    species.push({
      index, kind: spec.kind === VEG_KIND_GRASS ? "grass" : "tree", model: titleOf(spec.model), card: distances.card ? titleOf(card) : null,
      modelBand: distances.model, cardBand: distances.card,
      castShadow: !!(spec.flags & VEG_CAST_SHADOW), cardShadow: !!(spec.flags & VEG_FAR_SHADOW),
      place: Float32Array.from(places[index]),
    });
  });
  return species.length ? { species } : null;
}

/**
 * The trees the trucks run into (docs/CP4_EXE_ANALYSIS.md 3), as the simulation's static walls take them
 * (worker/sim-worker.js `init.walls`: upright boxes, `{ pos, size: [w, h, l], psi }`, game feet): collide 1 the trunk,
 * collide 2 the model's bounds, each times the tree's scale. The trunk's cylinder stands as the upright square box
 * whose side is its width: the simulation (OpenPhotex) has no cylinder against a truck. Trees above the scenery `detail`
 * do not collide; grass never does. `modelOf(name)` gives a decoded model or null.
 */
export function vegetationWalls(veg, modelOf, { detail = 2 } = {}) {
  if (!veg?.trees?.count) return [];
  const shapes = veg.species.map((spec) => {
    if (spec.kind !== VEG_KIND_TREE || !spec.collide || !spec.model) return null;
    const model = modelOf(spec.model);
    if (!model?.bounds) return null;
    if (spec.collide === 1) {
      const trunk = trunkOf(spec, model);
      return { width: trunk.widthFt, length: trunk.widthFt, height: trunk.heightFt, base: trunk.baseFt, cx: 0, cz: 0 };
    }
    const b = model.bounds;
    return {
      width: b.max[0] - b.min[0], length: b.max[2] - b.min[2], height: b.max[1] - b.min[1], base: b.min[1],
      cx: (b.max[0] + b.min[0]) / 2, cz: (b.max[2] + b.min[2]) / 2,
    };
  });
  const walls = [];
  const t = veg.trees;
  for (let i = 0; i < t.count; i++) {
    const shape = shapes[t.species[i]];
    if (!shape || !treeShown(t.tier[i], detail)) continue;
    const at = vegTreeAt(t, i), psi = at.headingTurns * 2 * Math.PI, s = at.scale;
    // The model's centre across, turned with the tree (game R = [c 0 s; 0 1 0; -s 0 c]).
    const c = Math.cos(psi), sn = Math.sin(psi);
    const ox = (shape.cx * c + shape.cz * sn) * s, oz = (-shape.cx * sn + shape.cz * c) * s;
    walls.push({
      pos: [at.x + ox, at.y + (shape.base + shape.height / 2) * s, at.z + oz],
      size: [shape.width * s, shape.height * s, shape.length * s], psi,
    });
  }
  return walls;
}
