/*
  .BIN models as meshes in scene coordinates (feet; see shared/scene-frame.js).

  OpenPhotex's parseBin returns the vertex words and faces as stored. A vertex is three words
  (x, y, z) in the game frame (x right, y up, z forward), each `(word >> 1) / 128` feet at
  magnify 65536, scaled by 65536 / magnify otherwise. The model's own origin is kept: the game
  places a model by it.

  Faces are fans; each becomes triangles grouped by what one three.js material can draw:
  texture, cutout or blended, flat colour, and the material record in force.
*/
import { MRGL, MRGLMAT, parseBin } from "../vendor/openphotex/index.js";

const UV_SCALE = 0xff0000;
const CUTOUT_FACE_TYPES = new Set([0x11, 0x33]);
const FLAT_FACE_TYPE = 0x19;

/**
 * A fan's triangles as vertex-list positions. The z mirror into the scene reverses handedness,
 * so each triangle is emitted in reverse to keep its facing.
 */
export function fanTriangles(count) {
  const out = [];
  for (let t = 1; t < count - 1; t++) out.push([0, t + 1, t]);
  return out;
}

/** Feet per vertex unit at a magnify value. */
export function binScale(magnify) {
  return 65536 / ((magnify || 65536) * 128);
}

/**
 * Decode a model. Returns `{ name, meshes, textureNames, bounds }` or null for anything that is
 * not a plain MRGL model (animated BINs list frame models instead; see `frameNames`).
 */
export function decodeModel(bytes, name) {
  const bin = parseBin(bytes);
  if (bin.kind === "animated") return { name, meshes: [], textureNames: [], frameNames: bin.frameNames, bounds: null };
  if (bin.kind !== "mrgl" || !bin.vertexListValid) return null;
  const magnify = bin.magnifyRecords.length ? bin.magnifyRecords[bin.magnifyRecords.length - 1] : bin.magnify;
  const scale = binScale(magnify);
  const w = bin.vertices;
  const count = w.length / 3;
  // Scene-frame vertices: (x, y, -z).
  const vx = new Float32Array(count), vy = new Float32Array(count), vz = new Float32Array(count);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const x = (w[i * 3] >> 1) * scale, y = (w[i * 3 + 1] >> 1) * scale, z = (w[i * 3 + 2] >> 1) * scale;
    vx[i] = x; vy[i] = y; vz[i] = -z;
    const g = [x, y, z];
    for (let k = 0; k < 3; k++) { if (g[k] < lo[k]) lo[k] = g[k]; if (g[k] > hi[k]) hi[k] = g[k]; }
  }

  const groups = new Map();
  const textureNames = new Set();
  for (const face of bin.faces) {
    const idx = face.vertexIndices;
    if (!idx || idx.length < 3) continue;
    const textureName = (face.textureName ?? "").toUpperCase();
    const flags = face.material === null || face.material === undefined ? null : bin.materials[face.material]?.flags ?? 0;
    const blended = flags !== null && !!(flags & MRGLMAT.BLEND);
    const cutout = flags !== null ? !!(flags & (MRGLMAT.ALPHATEST | MRGLMAT.TEXSOLID)) : CUTOUT_FACE_TYPES.has(face.opcode);
    const flat = face.opcode === FLAT_FACE_TYPE || !textureName;
    const key = `${flat ? `#${face.solidColor ?? 0}` : textureName}|${blended ? "b" : cutout ? "c" : "o"}|${face.material ?? "-"}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        textureName: flat ? "" : textureName, color: flat ? (face.solidColor ?? 0) >>> 0 : null,
        cutout, blended, material: face.material === null || face.material === undefined ? null : bin.materials[face.material],
        positions: [], normals: [], uvs: [],
      };
      groups.set(key, g);
      if (!flat) textureNames.add(textureName);
    }
    for (const k of fanTriangles(idx.length)) {
      const tri = k.map((j) => idx[j]);
      if (tri.some((n) => n >= count)) continue;
      const [a, b, c] = tri;
      const e1 = [vx[b] - vx[a], vy[b] - vy[a], vz[b] - vz[a]];
      const e2 = [vx[c] - vx[a], vy[c] - vy[a], vz[c] - vz[a]];
      let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (let j = 0; j < 3; j++) {
        const n = tri[j];
        g.positions.push(vx[n], vy[n], vz[n]);
        g.normals.push(nx, ny, nz);
        g.uvs.push((face.u?.[k[j]] ?? 0) / UV_SCALE, (face.v?.[k[j]] ?? 0) / UV_SCALE);
      }
    }
  }
  const meshes = [...groups.values()].filter((g) => g.positions.length).map((g) => ({
    textureName: g.textureName, color: g.color, cutout: g.cutout, blended: g.blended,
    emissive: !!(g.material && g.material.flags & MRGLMAT.EMISSIVE),
    positions: new Float32Array(g.positions), normals: new Float32Array(g.normals), uvs: new Float32Array(g.uvs),
  }));
  return {
    name, meshes, textureNames: [...textureNames], frameNames: null,
    // Game-frame extents in feet (the game sizes boxes from these, MONSTER.EXE 0x5495e0).
    bounds: count ? { min: lo, max: hi } : null,
  };
}

export { MRGL };
