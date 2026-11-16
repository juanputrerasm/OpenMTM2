/*
  Community Patch 4's additions to an MTM2 track, as the drawing and the simulation take them
  (docs/CP4_EXE_ANALYSIS.md 2 and 3): each lake's water sheet, built from the .WTR's tile map, and
  the .VEG's trees and grass as instances by species, with the trunks the trucks run into. The
  files themselves are read by OpenPhotex (mtm/wtr.ts, mtm/veg.ts) in worker/level-load.js.
  No three.js: the arrays are in scene coordinates (shared/scene-frame.js: x, y, -z), feet.
*/
import { vegClumpAt, vegTreeAt } from "../vendor/openphotex/mtm/veg.js";
import { VEG_CAST_SHADOW, VEG_FAR_SHADOW, VEG_KIND_GRASS, VEG_KIND_TREE, VEG_NO_FAR_CARD, grassKept, treeShown, trunkOf, vegDistances } from "../game/vegetation.js";
import { isShadowShell, levelShells } from "../game/shadow-shells.js";
import { collisionSoupOfModel } from "./models.js";

const TILES = 256, TILE_FT = 32;
/** The water texture's repeat on the ground plane, feet: one retail world (render/track-scene.js `createWater`). */
const WATER_TEXTURE_FT = 8192;

/**
 * One flat sheet per lake at its surface (`lakes`: worker/track-build.js `lakesOf`), over the 32 ft tiles the tile map
 * gives it: each row's runs of the lake's tiles merged into one quad, facing up. `positions` (scene feet), `uvs` the
 * world's x / 8192 and z / 8192 as the track's water plane has them (render/track-scene.js `createWater`), `indices`.
 * The tile map is `lakes.cells` a side (256, or a track format version 6 world's N); the texture repeats every 8192 ft
 * whatever the world's size, as the water plane's does.
 * Returns the bodies with their sheet added (`sheet`), those without a tile left out. With `heightAt` (the drawn ground at
 * game feet) each also has its shore (`shore`, `lakeShore`), null where it has none.
 */
export function buildLakeSheets(lakes, { heightAt = null, waterLevelFt = null } = {}) {
  if (!lakes?.tileMap) return [];
  const runs = new Map();
  const tiles = lakes.cells ?? TILES;
  for (let z = 0; z < tiles; z++) {
    let x = 0;
    while (x < tiles) {
      const id = lakes.tileMap[z * tiles + x];
      if (!id) { x++; continue; }
      let end = x + 1;
      while (end < tiles && lakes.tileMap[z * tiles + end] === id) end++;
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
        uvs[v * 2] = xf / WATER_TEXTURE_FT; uvs[v * 2 + 1] = zf / WATER_TEXTURE_FT;
      });
      // Counter-clockwise seen from above in the scene (z mirrored), so the face looks up.
      const v = k * 4, i = k * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
    });
    out.push({ ...body, sheet: { positions, uvs, indices }, shore: heightAt ? lakeShore(lakes, body, heightAt, waterLevelFt) : null });
  }
  return out;
}

/**
 * OpenMTM2's own, not the engine's (Community Patch 4 draws a lake over its tiles only, CP4_EXE_ANALYSIS.md 16.8): how far
 * a lake's water reaches past its tiles, in tiles, and the cells of that shore, feet.
 */
export const LAKE_SHORE = Object.freeze({ reachTiles: 2, cellFt: 16 });

/**
 * A lake's shore (`buildLakeSheets` with `heightAt`): the water going on past the lake's tiles where the ground is still
 * under its surface, so its outline follows the ground and the meshes (the depth test cuts it where they rise over it,
 * as it cuts the track's water) rather than the tiles' steps, and fades out within LAKE_SHORE.reachTiles of the lake.
 * Over the tiles within that reach that are no lake's and have ground under the surface somewhere (sampled at the
 * cells' corners): a sheet at the lake's surface of LAKE_SHORE.cellFt cells, each corner with `dry`, its distance from
 * the lake's tiles over the reach (0 at the lake, 1 at the reach). Only the drawing: the tiles stay dry for the trucks.
 * `heightAt(x, z)` is the drawn ground at game feet; a tile whose ground dips to the track's own water (`waterLevelFt`,
 * null for none) is left to that water. Null when the lake has no such tile.
 */
export function lakeShore(lakes, body, heightAt, waterLevelFt = null) {
  const tiles = lakes.cells ?? TILES, map = lakes.tileMap;
  const reach = LAKE_SHORE.reachTiles, per = TILE_FT / LAKE_SHORE.cellFt, step = LAKE_SHORE.cellFt;
  const wrap = (t) => ((t % tiles) + tiles) % tiles;
  const own = (tx, tz) => map[wrap(tz) * tiles + wrap(tx)] === body.id;
  // The tiles of the shore: no lake's, within the reach of this one's (Chebyshev), with ground under the surface.
  const shore = [];
  const seen = new Uint8Array(tiles * tiles);
  for (let tz = 0; tz < tiles; tz++) for (let tx = 0; tx < tiles; tx++) {
    if (map[tz * tiles + tx] !== body.id) continue;
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      const x = tx + dx, z = tz + dz;
      if (x < 0 || z < 0 || x >= tiles || z >= tiles) continue;
      const k = z * tiles + x;
      if (seen[k] || map[k]) continue;
      seen[k] = 1;
      let wet = false, low = Infinity;
      for (let j = 0; j <= per; j++) for (let i = 0; i <= per; i++) {
        const h = heightAt(x * TILE_FT + i * step, z * TILE_FT + j * step);
        if (h < body.levelFt) wet = true;
        low = Math.min(low, h);
      }
      // Not over the track's own water: there the lake's sheet would float over it.
      if (wet && !(waterLevelFt !== null && low <= waterLevelFt)) shore.push([x, z]);
    }
  }
  if (!shore.length) return null;
  // How far a point is from the lake's own tiles, feet (searched within the reach and a tile).
  const distance = (x, z) => {
    const cx = Math.floor(x / TILE_FT), cz = Math.floor(z / TILE_FT);
    let best = Infinity;
    for (let dz = -reach - 1; dz <= reach + 1; dz++) for (let dx = -reach - 1; dx <= reach + 1; dx++) {
      const tx = cx + dx, tz = cz + dz;
      if (!own(tx, tz)) continue;
      const ex = Math.max(tx * TILE_FT - x, 0, x - (tx + 1) * TILE_FT), ez = Math.max(tz * TILE_FT - z, 0, z - (tz + 1) * TILE_FT);
      best = Math.min(best, Math.hypot(ex, ez));
    }
    return best;
  };
  // Corners shared between the shore's cells.
  const index = new Map(), positions = [], uvs = [], dry = [], indices = [];
  const corner = (x, z) => {
    const key = `${x},${z}`;
    let v = index.get(key);
    if (v === undefined) {
      v = positions.length / 3;
      index.set(key, v);
      positions.push(x, body.levelFt, -z);
      uvs.push(x / WATER_TEXTURE_FT, z / WATER_TEXTURE_FT);
      dry.push(Math.min(1, distance(x, z) / (reach * TILE_FT)));
    }
    return v;
  };
  for (const [tx, tz] of shore) {
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const x0 = tx * TILE_FT + i * step, z0 = tz * TILE_FT + j * step;
      const a = corner(x0, z0), b = corner(x0 + step, z0), c = corner(x0 + step, z0 + step), d = corner(x0, z0 + step);
      // Counter-clockwise seen from above in the scene (z mirrored), as the lake's own quads.
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions: Float32Array.from(positions), uvs: Float32Array.from(uvs), dry: Float32Array.from(dry), indices: Uint32Array.from(indices), tiles: shore.length };
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

/**
 * Community Patch 4 beta 0.53's shadow shells (docs/CP4_EXE_ANALYSIS.md 13, game/shadow-shells.js): the level's placed
 * objects (`objects`, worker/track-build.js, each with its SIT box's `sitIndex`; the stadium and the ground boxes are not
 * among them) whose model is a roofed building at least 500 ft wide and long, each model's roof measured once.
 * `boxes` the SIT's boxes, `models` the decoded models by name, `turnOf(box)` a box's turn (row-major, body to world).
 * `[{ model, sitIndex, pos, rot, min, max, roofPct }]`, game feet.
 */
export function buildShadowShells(objects, boxes, models, turnOf) {
  const placed = [];
  for (const object of objects) {
    const box = boxes[object.sitIndex];
    if (object.type === "stadium" || !box?.positionFt || !object.model) continue;
    placed.push({ model: object.model, sitIndex: object.sitIndex, pos: box.positionFt, rot: turnOf(box) });
  }
  return levelShells(placed, (name) => {
    const model = models[name];
    // The size first: a model too small is never measured, nor its triangles gathered.
    const soup = model?.bounds && isShadowShell(model.bounds, Infinity) ? collisionSoupOfModel(model) : null;
    return soup ? { bounds: model.bounds, positions: soup.positions } : null;
  });
}
