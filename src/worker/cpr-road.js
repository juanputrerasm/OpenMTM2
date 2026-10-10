/*
  A CART Precision Racing track's road layer, for drawing and for driving.

  CPR's road, curbs, shoulders and walls are not in the heightfield: they are the `.TRK` beside
  the terrain `.RAW`, a cross section extruded along the lap, textured from the `.TTX` list.
  OpenPhotex reads both and lays the geometry out (`buildCprRoad`); this file finds the files,
  decodes the textures, and turns the geometry into

    render   one mesh per texture, in scene coordinates (feet; shared/scene-frame.js)
    sim      the road's triangles in game feet with a surface value each, and the walls as
             thin upright boxes (the simulation's truck-against-box test stops a truck on them)

  A `.TRK` point is `[x, altitude, along]` in feet, and `along` is the game's z: the road then
  lies a median 2 ft over the terrain at Laguna, as it should.

  The `.TTX` paints each texture as Road, Curb, Grass, Dirt or Rocks. The grip is MTM2's, by the
  nearest of its ground types (the port's mapping; CPR's own friction is not known).

  The catch fence on wall types 3 and 5 is not in the `.TTX`: it is ART\CATCH3D.RAW (or CATCH.RAW)
  from CPR's STARTUP.POD. Without it the fence is drawn as a grey veil.
*/
import {
  CPR_CATCH_FENCE_NAMES, buildCprRoad, decodeActPalette, decodeRawTexture, parseCprTrk, parseCprTtx, podPathTitle, rawTextureSide,
} from "../vendor/openphotex/index.js";

/** The road mask's texels a foot, and its largest side. */
const MASK_TEXELS_PER_FT = 1, MASK_MAX_SIDE = 4096;

/**
 * A road texture as CPR colours it: by its own palette (ART\<stem>.ACT) when it has one, else by the level's. The
 * road tiles each carry their own, and read by another they come out as different art.
 */
async function roadTexture(vfs, name, levelPalette, cutout = false) {
  const stem = stemOf(name);
  const raw = await vfs.read(`ART\\${stem}.RAW`);
  if (!raw || !rawTextureSide(raw.length)) return null;
  const act = await vfs.read(`ART\\${stem}.ACT`);
  const palette = (act && decodeActPalette(act)) || levelPalette;
  if (!palette) return null;
  try {
    const image = decodeRawTexture(raw, palette, { cutout });
    return { width: image.width, height: image.height, rgba: image.rgba };
  } catch {
    return null;
  }
}

/**
 * Where the road layer covers the ground, seen from above: one byte a texel (255 covered) over the road's own
 * bounding box, in game feet. The terrain is drawn behind everything inside it (render/track-scene.js): a 32 ft grid
 * rises through a banked or cut road between its corners, and the game gives the road precedence.
 */
function roadMask(quads) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const q of quads) for (const p of q.corners) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
  }
  if (!(maxX > minX) || !(maxZ > minZ)) return null;
  const scale = Math.min(MASK_TEXELS_PER_FT, MASK_MAX_SIDE / (maxX - minX), MASK_MAX_SIDE / (maxZ - minZ));
  const width = Math.max(1, Math.ceil((maxX - minX) * scale)), height = Math.max(1, Math.ceil((maxZ - minZ) * scale));
  const data = new Uint8Array(width * height);
  const fill = (a, b, c) => {
    const ax = (a[0] - minX) * scale, az = (a[2] - minZ) * scale, bx = (b[0] - minX) * scale, bz = (b[2] - minZ) * scale;
    const cx = (c[0] - minX) * scale, cz = (c[2] - minZ) * scale;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz, cz))), z1 = Math.min(height - 1, Math.ceil(Math.max(az, bz, cz)));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, pz = z + 0.5;
        const d1 = (px - ax) * (bz - az) - (pz - az) * (bx - ax);
        const d2 = (px - bx) * (cz - bz) - (pz - bz) * (cx - bx);
        const d3 = (px - cx) * (az - cz) - (pz - cz) * (ax - cx);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) data[z * width + x] = 255;
      }
    }
  };
  for (const q of quads) { fill(q.corners[0], q.corners[1], q.corners[2]); fill(q.corners[0], q.corners[2], q.corners[3]); }
  return { data, width, height, bounds: [minX, minZ, width / scale, height / scale] };
}

/** MTM2 surface values (TTY: type * 100 + depth) by the `.TTX` surface type: Road, Curb, Grass, Dirt, Rocks. */
export const CPR_SURFACE_VALUES = Object.freeze([100, 100, 600, 200, 1200]);
/** How thick a wall is as a collision box, in feet. */
const WALL_THICKNESS_FT = 1;

const stemOf = (name) => podPathTitle(name).replace(/\.[^.]*$/, "");

/** One mesh per texture and kind: the road's surface (`wall` false) apart from the walls, which alone cast shadows. */
function bucket(buckets, texture, wall = false) {
  const key = `${wall ? "w" : "r"}:${texture}`;
  let b = buckets.get(key);
  if (!b) buckets.set(key, (b = { texture, wall, positions: [], normals: [], uvs: [], indices: [] }));
  return b;
}

/** A quad in scene coordinates, its normal the winding's; `up` turns it to face upwards. */
function addQuad(b, corners, uvs, up = false) {
  let order = [0, 1, 2, 3];
  const s = corners.map((p) => [p[0], p[1], -p[2]]);
  const normalOf = (o) => {
    const [a, c, d] = [s[o[0]], s[o[1]], s[o[2]]];
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return n.map((v) => v / len);
  };
  let n = normalOf(order);
  if (up && n[1] < 0) { order = [3, 2, 1, 0]; n = normalOf(order); }
  const base = b.positions.length / 3;
  for (const k of order) {
    b.positions.push(s[k][0], s[k][1], s[k][2]);
    b.normals.push(n[0], n[1], n[2]);
    b.uvs.push(uvs[k][0], uvs[k][1]);
  }
  b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs the track's own view of the archives
 * @param {object} level from level-load.js
 * @returns {Promise<null | { render: object, sim: object, lapLengthFt: number | null }>} null when the track has no road layer
 */
export async function buildCprRoadLayer(vfs, level) {
  const stems = [...new Set([stemOf(level.lvl.rawName ?? ""), level.stem].filter(Boolean))];
  let trkBytes = null, stem = null;
  for (const s of stems) {
    trkBytes = await vfs.read(`DATA\\${s}.TRK`);
    if (trkBytes) { stem = s; break; }
  }
  const trk = trkBytes ? parseCprTrk(trkBytes) : null;
  if (!trk || trk.surfaces.length < 2) return null;
  const ttxBytes = await vfs.read(`DATA\\${stem}.TTX`);
  const ttx = ttxBytes ? parseCprTtx(ttxBytes) : [];
  const road = buildCprRoad(trk.surfaces, ttx.length || 1);

  const missing = [];
  const textures = [];
  for (const { name } of ttx) {
    const title = podPathTitle(name);
    const image = await roadTexture(vfs, title, level.palette);
    if (!image) missing.push(`ART\\${title}`);
    textures.push(image);
  }
  let fence = null;
  if (road.walls.some((w) => w.panels.some((p) => p.fence))) {
    for (const name of CPR_CATCH_FENCE_NAMES) {
      fence = await roadTexture(vfs, podPathTitle(name), level.palette, true);
      if (fence) break;
    }
  }

  const buckets = new Map();
  const simPositions = [];
  const simValues = [];
  for (const quad of road.quads) {
    addQuad(bucket(buckets, quad.texture), quad.corners, quad.uvs, true);
    const [p0, p1, p2, p3] = quad.corners;
    simPositions.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    const value = CPR_SURFACE_VALUES[ttx[quad.texture]?.flags ?? 0] ?? CPR_SURFACE_VALUES[0];
    simValues.push(value, value);
  }

  const walls = [];
  for (const wall of road.walls) {
    const { from, to } = wall;
    // The face a driver sees: a wall seen from behind would show its art mirrored, so U runs the other way there.
    const section = trk.surfaces[wall.segment].points;
    const across = [section[section.length - 1][0] - section[0][0], -(section[section.length - 1][2] - section[0][2])];
    const normalX = -(-to[2] + from[2]), normalZ = to[0] - from[0];
    const behind = (normalX * across[0] + normalZ * across[1]) * wall.facing < 0;
    const uLo = behind ? wall.uRepeat : 0, uHi = behind ? 0 : wall.uRepeat;
    for (const panel of wall.panels) {
      const corners = [
        [from[0], from[1] + panel.baseFt, from[2]], [to[0], to[1] + panel.baseFt, to[2]],
        [to[0], to[1] + panel.topFt, to[2]], [from[0], from[1] + panel.topFt, from[2]],
      ];
      addQuad(bucket(buckets, panel.fence ? "fence" : panel.texture, true), corners,
        [[uLo, panel.vBottom], [uHi, panel.vBottom], [uHi, panel.vTop], [uLo, panel.vTop]]);
    }
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const low = Math.min(from[1], to[1]), high = Math.max(from[1], to[1]) + wall.heightFt;
    walls.push({
      pos: [(from[0] + to[0]) / 2, (low + high) / 2, (from[2] + to[2]) / 2],
      // Width (x), height (y), length (z); the box's z runs along the wall.
      size: [WALL_THICKNESS_FT, high - low, length], psi: Math.atan2(dx, dz),
    });
  }

  return {
    missing,
    lapLengthFt: trk.length ?? null,
    render: {
      textures, fence, mask: roadMask(road.quads),
      meshes: [...buckets.values()].map((b) => ({
        texture: b.texture, wall: b.wall, positions: new Float32Array(b.positions), normals: new Float32Array(b.normals),
        uvs: new Float32Array(b.uvs), indices: new Uint32Array(b.indices),
      })),
    },
    sim: { road: { positions: new Float32Array(simPositions), surfaceValues: new Int32Array(simValues) }, walls },
  };
}

/**
 * The lap's checkpoints of a CPR track, from its type 6 boxes in file order: the first three stand in the pit lane
 * (entry, speed limit, its end) and are left out, the fourth is the start and finish and closes the lap, the rest are
 * gates out on the circuit. A gate's stored heading is written either way round, so each is turned to face the way
 * the course runs past it (`course`: the SIT's straights in feet).
 */
export function cprLapCheckpointBoxes(boxes, course) {
  const all = boxes.filter((b) => b.type === 6 && b.positionFt);
  const lap = all.length >= 4 ? [...all.slice(4), all[3]] : all;
  return lap.map((box) => ({ ...box, psi: alongCourse(box, course) }));
}

/** `box.psi`, or that plus half a turn when the box faces against the nearest course straight. */
export function alongCourse(box, course) {
  let best = null, bestDistance = Infinity;
  for (const g of course) {
    if (!g.startFt || !g.endFt) continue;
    const ax = g.startFt[0], az = g.startFt[2], dx = g.endFt[0] - ax, dz = g.endFt[2] - az;
    const lengthSq = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((box.positionFt[0] - ax) * dx + (box.positionFt[2] - az) * dz) / lengthSq));
    const distance = Math.hypot(box.positionFt[0] - (ax + dx * t), box.positionFt[2] - (az + dz * t));
    if (distance < bestDistance) { bestDistance = distance; best = [dx, dz]; }
  }
  if (!best) return box.psi;
  return Math.sin(box.psi) * best[0] + Math.cos(box.psi) * best[1] < 0 ? box.psi + Math.PI : box.psi;
}

/** A closed course's length in feet, from one straight's start to the next's, round to the first. */
export function courseLengthFt(segments) {
  const starts = (segments ?? []).map((g) => g.startFt).filter(Boolean);
  let sum = 0;
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i], b = starts[(i + 1) % starts.length];
    sum += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  return sum;
}
