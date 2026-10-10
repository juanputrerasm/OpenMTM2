/*
  4x4 Evolution models and art, in the shapes the renderer already draws (worker/models.js).

  A `.SMF` is read by OpenPhotex (`parseSmf`) in the game's own axes: x, height, z, in feet, the
  same frame MTM2's models use here. Each group is one mesh with one material; frame 0 is drawn.
  As in models.js the scene mirrors z, so a vertex becomes (x, y, -z) and every triangle is
  emitted in reverse to keep its facing. The file's own normals are kept (they are smooth).
  V runs top-down in the file and in the textures as they are uploaded, so it is used as written.

  Reduced-detail groups (a trailing L, `lodGroup`) and hidden ones are left out, unless that
  would leave nothing to draw.

  A texture is an indexed `.RAW` with its own same-stem `.ACT` (Evo has no level palette) and an
  optional `.OPA` opacity plane, or on Evo 2 a `.TIF` that carries its palette and opacity. Art
  with an opacity plane is drawn as a cutout, whatever the model's own transparency flag says:
  every stock tree writes that flag as 0 (JSTrackViewer, 4X4_EVO_TRACK_RENDERING_ANALYSIS.md).
*/
import {
  applyOpacityPlane, decodeActPalette, decodeRawTexture, decodeTiff, isTiff, parseSmf, podPathTitle, rawTextureSide, smfTextureReference,
} from "../vendor/openphotex/index.js";

const stemOf = (name) => podPathTitle(name).toUpperCase().replace(/\.[^.]*$/, "");

/**
 * Decode a model: `{ name, meshes, textureNames, frameNames: null, bounds }`, `bounds` the vertex extents in game feet.
 * `meshes` carry `textureName` as the file names it (upper case), for `loadEvoTexture`.
 */
export function decodeSmfModel(bytes, name) {
  const smf = parseSmf(bytes, name);
  const usable = smf.groups.filter((g) => g.indices.length >= 3 && g.frames[0]);
  const preferred = usable.filter((g) => g.visible !== false && !g.lodGroup);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const textureNames = new Set();
  const meshes = [];
  for (const group of preferred.length ? preferred : usable) {
    const { positions: p, normals: n, uvs: t } = group.frames[0];
    const count = group.indices.length - (group.indices.length % 3);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 3) {
      // Reversed winding for the mirrored z.
      const corners = [group.indices[i], group.indices[i + 2], group.indices[i + 1]];
      corners.forEach((v, k) => {
        const o = (i + k) * 3;
        positions[o] = p[v * 3]; positions[o + 1] = p[v * 3 + 1]; positions[o + 2] = -p[v * 3 + 2];
        normals[o] = n?.[v * 3] ?? 0; normals[o + 1] = n?.[v * 3 + 1] ?? 1; normals[o + 2] = -(n?.[v * 3 + 2] ?? 0);
        uvs[(i + k) * 2] = t?.[v * 2] ?? 0; uvs[(i + k) * 2 + 1] = t?.[v * 2 + 1] ?? 0;
        for (let a = 0; a < 3; a++) {
          const value = p[v * 3 + a];
          if (value < lo[a]) lo[a] = value;
          if (value > hi[a]) hi[a] = value;
        }
      });
    }
    const textureName = smfTextureReference(group.material?.textureName) ?? "";
    if (textureName) textureNames.add(textureName);
    meshes.push({
      groupName: group.name ?? "", textureName, textureFrames: null, color: textureName ? null : 0x808080,
      // Settled once the art is decoded (`markCutouts`): whether it has an opacity plane.
      cutout: !!group.material?.transparent, blended: false, emissive: false, material: null, normalStrength: 1, doubleSided: true,
      positions, normals, uvs,
    });
  }
  return { name, meshes, textureNames: [...textureNames], frameNames: null, bounds: meshes.length ? { min: lo, max: hi } : null };
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
      if (textures[name]?.hasAlpha) mesh.cutout = true;
    }
  }
  for (const name of Object.keys(textures)) if (!textures[name]) delete textures[name];
  return textures;
}
