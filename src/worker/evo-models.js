/*
  4x4 Evolution models and art, in the shapes the renderer already draws (worker/models.js).

  A `.SMF` is read by OpenPhotex (`parseSmf`) in the game's own axes: x, height, z, in feet, the
  same frame MTM2's models use here. Each group is one mesh with one material; frame 0 is drawn.
  As in models.js the scene mirrors z, so a vertex becomes (x, y, -z) and every triangle is
  emitted in reverse to keep its facing. The file's own normals are kept (they are smooth).
  Frame 0 is the mesh; a model whose groups have more frames carries them all as `keyframes`.
  V runs top-down in the file and in the textures as they are uploaded, so it is used as written.

  Reduced-detail groups (a trailing L, `lodGroup`) and hidden ones are left out, unless that
  would leave nothing to draw.

  A texture is an indexed `.RAW` with its own same-stem `.ACT` (Evo has no level palette) and an
  optional `.OPA` opacity plane, or on Evo 2 a `.TIF` that carries its palette and opacity. Art
  with an opacity plane is drawn as a cutout, whatever the model's own transparency flag says:
  every stock tree writes that flag as 0 (JSTrackViewer, 4X4_EVO_TRACK_RENDERING_ANALYSIS.md).
  The exception is a group that calls itself opaque (named OPAQUE, its flag 0) under a plane that
  was not made for it: fewer than a quarter of its triangles sit, at their middles, on art the
  plane keeps. VULTURE's start gate (CC4SF) is one: its .OPA is
  an older picture of the lettering, and as a cutout the posts and the banner would be gone.
*/
import { applyOpacityPlane, decodeRawTexture, rawTextureSide } from "../vendor/openphotex/texture/raw.js";
import { decodeActPalette } from "../vendor/openphotex/texture/act.js";
import { decodeTiff, isTiff } from "../vendor/openphotex/texture/tiff.js";
import { parseSmf, smfTextureReference } from "../vendor/openphotex/evo/smf.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";

const stemOf = (name) => podPathTitle(name).toUpperCase().replace(/\.[^.]*$/, "");

/**
 * Decode a model: `{ name, meshes, textureNames, frameNames: null, bounds }`, `bounds` the vertex extents in game feet.
 * `meshes` carry `textureName` as the file names it (upper case), for `loadEvoTexture`.
 */
export function decodeSmfModel(bytes, name) {
  const smf = parseSmf(bytes, name);
  const usable = smf.groups.filter((g) => g.indices.length >= 3 && g.frames[0]);
  const preferred = usable.filter((g) => g.visible !== false && !g.lodGroup);
  const groups = preferred.length ? preferred : usable;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const textureNames = new Set();
  /** A group's triangles at one of its frames: positions and normals, mirrored z and reversed winding. */
  const emit = (group, frame, bounds) => {
    const { positions: p, normals: n } = frame;
    const count = group.indices.length - (group.indices.length % 3);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 3) {
      // Reversed winding for the mirrored z.
      const corners = [group.indices[i], group.indices[i + 2], group.indices[i + 1]];
      corners.forEach((v, k) => {
        const o = (i + k) * 3;
        positions[o] = p[v * 3]; positions[o + 1] = p[v * 3 + 1]; positions[o + 2] = -p[v * 3 + 2];
        normals[o] = n?.[v * 3] ?? 0; normals[o + 1] = n?.[v * 3 + 1] ?? 1; normals[o + 2] = -(n?.[v * 3 + 2] ?? 0);
        if (bounds) {
          for (let a = 0; a < 3; a++) {
            const value = p[v * 3 + a];
            if (value < lo[a]) lo[a] = value;
            if (value > hi[a]) hi[a] = value;
          }
        }
      });
    }
    // A vertex the file gives no normal (0, 0, 0; BJCK1.SMF's banner) takes its face's: normalised to nothing it would
    // light the face black.
    for (let i = 0; i < count; i += 3) {
      const face = faceNormal(positions, i);
      for (let k = 0; k < 3; k++) {
        const o = (i + k) * 3;
        if (Math.hypot(normals[o], normals[o + 1], normals[o + 2]) < 1e-3) normals.set(face, o);
      }
    }
    return { positions, normals };
  };
  const meshes = [];
  for (const group of groups) {
    const { positions, normals } = emit(group, group.frames[0], true);
    const t = group.frames[0].uvs;
    const count = positions.length / 3;
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 3) {
      [group.indices[i], group.indices[i + 2], group.indices[i + 1]].forEach((v, k) => {
        uvs[(i + k) * 2] = t?.[v * 2] ?? 0; uvs[(i + k) * 2 + 1] = t?.[v * 2 + 1] ?? 0;
      });
    }
    const textureName = smfTextureReference(group.material?.textureName) ?? "";
    if (textureName) textureNames.add(textureName);
    meshes.push({
      groupName: group.name ?? "", textureName, textureFrames: null, color: textureName ? null : 0x808080,
      // The material's own transparent flag and, in Evo 2's `v1` form, its bump texture: a truck uses both
      // (worker/foreign-truck-build.js `evoTruckMaterials`; EVO2_EXE_ANALYSIS.md 6.6).
      transparent: !!group.material?.transparent, bumpTextureName: smfTextureReference(group.material?.bumpTextureName),
      // Settled once the art is decoded (`markCutouts`): whether it has an opacity plane.
      // A solid group modelled with a back of its own (faces back to back in one plane: a board, a banner) is drawn
      // one-sided, as the game culls it; drawn from both sides its two faces would fight in the one plane. Cut-outs
      // (leaves) stay two-sided: a card without a back must show from behind.
      cutout: !!group.material?.transparent, blended: false, emissive: false, material: null, normalStrength: 1,
      doubleSided: !!group.material?.transparent || !hasBackToBackFaces(positions),
      positions, normals, uvs,
    });
  }
  // Frame animation (a rotor, a bird, a pump jack): every frame of the groups that have more than one, as morph targets
  // (render/track-scene.js); a group of one frame holds it throughout. The SIT gives each placement its time a frame.
  const frameCount = Math.max(1, ...groups.map((g) => g.frames.length));
  const keyframes = frameCount > 1 ? Array.from({ length: frameCount }, (_, f) => ({
    meshes: groups.map((group, i) => (group.frames.length > 1 ? emit(group, group.frames[f % group.frames.length], false) : { positions: meshes[i].positions, normals: meshes[i].normals })),
  })) : null;
  return { name, meshes, textureNames: [...textureNames], frameNames: null, bounds: meshes.length ? { min: lo, max: hi } : null, ...(keyframes ? { keyframes } : {}) };
}

/** `{ width, height, rgba, hasAlpha }` for a texture a model or a level names, or null. */
export async function loadEvoTexture(vfs, name) {
  const title = podPathTitle(name).toUpperCase();
  const stem = stemOf(title);
  if (!stem) return null;
  let bytes = null;
  for (const candidate of [title, `${stem}.RAW`, `${stem}.TIF`]) {
    bytes = await vfs.read(`ART\\${candidate}`);
    if (bytes) break;
  }
  if (!bytes) return null;
  try {
    const opa = await vfs.read(`ART\\${stem}.OPA`);
    if (isTiff(bytes)) {
      const image = decodeTiff(bytes, title);
      const out = applyOpacityPlane({ name: title, width: image.width, height: image.height, rgba: image.rgba, hasAlpha: !!image.hasAlpha }, opa);
      return { width: out.width, height: out.height, rgba: out.rgba, hasAlpha: !!out.hasAlpha };
    }
    const act = await vfs.read(`ART\\${stem}.ACT`);
    const palette = act && decodeActPalette(act);
    if (!palette || !rawTextureSide(bytes.length, "evo")) return null;
    const image = decodeRawTexture(bytes, palette, { family: "evo" });
    const out = applyOpacityPlane({ name: title, width: image.width, height: image.height, rgba: image.rgba, hasAlpha: false }, opa);
    return { width: out.width, height: out.height, rgba: out.rgba, hasAlpha: !!out.hasAlpha };
  } catch {
    return null;
  }
}

/** Whether `image`'s opacity keeps the art under the middles of at least a quarter of the mesh's triangles. */
function planeFits(mesh, { width, height, rgba }) {
  const uv = mesh.uvs, triangles = Math.floor(uv.length / 6);
  if (!triangles) return true;
  let kept = 0;
  for (let t = 0; t < triangles; t++) {
    const u = (uv[t * 6] + uv[t * 6 + 2] + uv[t * 6 + 4]) / 3, v = (uv[t * 6 + 1] + uv[t * 6 + 3] + uv[t * 6 + 5]) / 3;
    const x = Math.min(width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * height)));
    if (rgba[(y * width + x) * 4 + 3] >= 128) kept++;
  }
  return kept * 4 >= triangles;
}

/** Every texture the models name, decoded once: `{ [name]: image }`; `missing` collects the names not found. */
export async function loadEvoModelTextures(vfs, models, missing = new Set()) {
  const textures = {};
  for (const model of Object.values(models)) {
    for (const mesh of model?.meshes ?? []) {
      const name = mesh.textureName;
      if (!name) continue;
      if (!(name in textures)) {
        textures[name] = await loadEvoTexture(vfs, name);
        if (!textures[name]) missing.add(`ART\\${name}`);
      }
      if (textures[name]?.hasAlpha) mesh.cutout = mesh.cutout || !/^OPAQUE/i.test(mesh.groupName) || planeFits(mesh, textures[name]);
      // A cut-out shows from behind: a card without a back of its own must not vanish (`decodeSmfModel`).
      if (mesh.cutout) mesh.doubleSided = true;
    }
  }
  for (const name of Object.keys(textures)) if (!textures[name]) delete textures[name];
  return textures;
}

/** The unit normal of the triangle at vertex `i` (its first corner) of `positions`, by its winding. */
function faceNormal(positions, i) {
  const o = i * 3;
  const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
  const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  return l ? [nx / l, ny / l, nz / l] : [0, 1, 0];
}

/** Whether a mesh has two faces back to back in one plane: the same plane with opposite normals. */
export function hasBackToBackFaces(positions) {
  const planes = new Set();
  const key = (n, d) => [...n.map((v) => Math.round(v * 50) / 50), Math.round(d * 10) / 10].map((v) => (Object.is(v, -0) ? 0 : v)).join(",");
  for (let i = 0; i + 2 < positions.length / 3; i += 3) {
    const n = faceNormal(positions, i);
    const d = n[0] * positions[i * 3] + n[1] * positions[i * 3 + 1] + n[2] * positions[i * 3 + 2];
    if (planes.has(key(n.map((v) => -v), -d))) return true;
    planes.add(key(n, d));
  }
  return false;
}
