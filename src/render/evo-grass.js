/*
  4x4 Evolution's grass (docs/EVO2_EXE_ANALYSIS.md 2.4), drawn around the camera.

  Each terrain cell whose texture has vegetation class c > 0 draws 1 << c tufts from the level's
  pattern (worker/evo-track-build.js `grass`, OpenPhotex evoGrassPattern): at the cell's corner
  plus the tuft's offset, a quad facing the camera with half-size the tuft's size, centred
  vegBias * size * 0.5 under the ground (over it, for the stock negative biases), textured from
  the grass texture's quadrant of the tuft's slot (bit 0 moves u by a half, bit 1 v). A tuft under
  the water is not drawn. A truck presses the tufts under it down to ground + vegBias * size * 0.25.

  The game draws the cells within its vegetation distance (not traced); the port draws a square
  of cells around the camera, as many each way as the Evo grass slider asks (`GRASS_RADII`; Near
  is the port's first guess at the game's), the tufts shrinking away over the outer fifth.

  The tufts are written only when the camera moves into another cell: each quad's four corners
  hold its centre, and the vertex shader turns the quad to the camera and presses it under the
  trucks (`PRESSERS` of them, as uniforms), so a frame uploads nothing.
*/
import * as THREE from "three";
import * as mtm2Sim from "../vendor/openphotex/sim/mtm2/index.js";
import { msg } from "../game/strings.js";

const CELL_FT = 32;
/** The Evo grass slider: how many cells each way around the camera, by level; 0 draws none. */
export const GRASS_RADII = Object.freeze([0, 8, 16, 24, 32]);
export const GRASS_LEVEL_NAMES = Object.freeze([msg("None"), msg("Near"), msg("Medium"), msg("Far"), msg("Very far")]);
export const DEFAULT_GRASS_LEVEL = 2;

/** The level the settings ask for: `evoGrassRange` 0..4, or 0 when the Evo grass switch of before is off. */
export function grassLevel(settings) {
  if (settings?.evoGrass === false) return 0;
  const level = settings?.evoGrassRange;
  return Number.isInteger(level) && level >= 0 && level < GRASS_RADII.length ? level : DEFAULT_GRASS_LEVEL;
}
/** The most trucks that press the grass: a race has eight at most. */
const PRESSERS = 16;
/** The quadrant UVs inside a slot (0x6356fc, 0x635700): an inset of 1/128 from each edge. */
const UV_LO = 0.0078125, UV_HI = 0.4921875;

function grassTexture({ rgba, width, height }) {
  const texture = new THREE.DataTexture(new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)), width, height, THREE.RGBAFormat);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** The quad about its centre (`position`): `grassCorner` across and up the view, `grassTuft` its half-size and how far it is pressed down. */
const VERTEX_PARS = /* glsl */ `
attribute vec2 grassCorner;
attribute vec2 grassTuft;
// each truck that presses the grass: scene x, z and its reach; a reach of 0 is no truck
uniform vec3 grassPressers[${PRESSERS}];
// how far the grass reaches from the camera, scene feet: the tufts shrink away over the outer fifth
uniform float grassFar;
`;
const BEGIN_VERTEX = /* glsl */ `
vec3 transformed = position;
for ( int i = 0; i < ${PRESSERS}; i ++ ) {
  vec3 presser = grassPressers[ i ];
  vec2 off = position.xz - presser.xy;
  if ( presser.z > 0.0 && dot( off, off ) < presser.z * presser.z ) { transformed.y += grassTuft.y; break; }
}
// The view's right and up, in the world: the quad faces the camera.
vec3 grassRight = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
vec3 grassUp = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
vec2 grassFromEye = position.xz - cameraPosition.xz;
float grassFade = 1.0 - smoothstep( grassFar * 0.8, grassFar, max( abs( grassFromEye.x ), abs( grassFromEye.y ) ) );
transformed += ( grassRight * grassCorner.x + grassUp * grassCorner.y ) * grassTuft.x * grassFade;
`;

/**
 * @param grass the build's `grass` (worker/evo-track-build.js)
 * @param terrain the main thread's terrain (shared/build-terrain.js `terrainOfBuild`)
 * @param radius cells each way around the camera (`GRASS_RADII`)
 */
export function createEvoGrass(grass, terrain, radius = GRASS_RADII[DEFAULT_GRASS_LEVEL]) {
  const CAPACITY = (2 * radius + 1) ** 2 * 32;
  const positions = new Float32Array(CAPACITY * 4 * 3);
  const uvs = new Float32Array(CAPACITY * 4 * 2);
  const tufts = new Float32Array(CAPACITY * 4 * 2);
  const corners = new Float32Array(CAPACITY * 4 * 2);
  const indices = new Uint32Array(CAPACITY * 6);
  for (let q = 0; q < CAPACITY; q++) {
    indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    corners.set([-1, -1, 1, -1, 1, 1, -1, 1], q * 8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("grassTuft", new THREE.BufferAttribute(tufts, 2));
  geometry.setAttribute("grassCorner", new THREE.BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const pressers = { value: Array.from({ length: PRESSERS }, () => new THREE.Vector3()) };
  const far = { value: radius * CELL_FT };
  const material = new THREE.MeshBasicMaterial({ map: grassTexture(grass.texture), alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassPressers = pressers;
    shader.uniforms.grassFar = far;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <begin_vertex>", BEGIN_VERTEX);
  };
  material.customProgramCacheKey = () => "evo-grass";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "evoGrass";
  mesh.frustumCulled = false;
  const height = (x, z) => mtm2Sim.terrainHeightAt(terrain, x, z);
  return { mesh, grass, height, pressers, radius, capacity: CAPACITY, cell: null };
}

/** Write the tufts of the cells around cell (cx, cz), game feet, into the mesh. */
function refill(state, cx, cz) {
  const { grass, height, mesh, radius: RADIUS_CELLS, capacity: CAPACITY } = state;
  const attributes = mesh.geometry.attributes;
  const pos = attributes.position.array, uv = attributes.uv.array, tuft = attributes.grassTuft.array;
  let n = 0;
  for (let dz = -RADIUS_CELLS; dz <= RADIUS_CELLS; dz++) {
    for (let dx = -RADIUS_CELLS; dx <= RADIUS_CELLS; dx++) {
      const x0 = (cx + dx) * CELL_FT, z0 = (cz + dz) * CELL_FT;
      const c = grass.vegClass[(((cz + dz) & 255) << 8) | ((cx + dx) & 255)];
      if (!c) continue;
      const count = 1 << c;
      for (let t = 0; t < count && n < CAPACITY; t++) {
        const i = t + 32 * ((cx + dx) & 7) + 256 * ((cz + dz) & 7);
        const x = x0 + grass.x[i], z = z0 + grass.z[i];
        const size = grass.size[i], slot = grass.slot[i], bias = grass.bias[slot] ?? 0;
        const ground = height(x, z);
        const y = ground - bias * size * 0.5;
        if (grass.waterLevelFt !== null && !(y > grass.waterLevelFt)) continue;
        // Pressed, the tuft's centre is at ground + bias * size * 0.25.
        const drop = ground + bias * size * 0.25 - y;
        const u0 = (slot & 1 ? 0.5 : 0), v0 = (slot & 2 ? 0.5 : 0);
        for (let k = 0; k < 4; k++) {
          const p = (n * 4 + k) * 3, q = (n * 4 + k) * 2;
          // The scene mirrors z.
          pos[p] = x; pos[p + 1] = y; pos[p + 2] = -z;
          tuft[q] = size; tuft[q + 1] = drop;
        }
        // Rows of the art run from the top (the texture is not flipped): v grows downward.
        uv.set([u0 + UV_LO, v0 + UV_HI, u0 + UV_HI, v0 + UV_HI, u0 + UV_HI, v0 + UV_LO, u0 + UV_LO, v0 + UV_LO], n * 8);
        n++;
      }
    }
  }
  for (const name of ["position", "uv", "grassTuft"]) {
    attributes[name].clearUpdateRanges();
    attributes[name].addUpdateRange(0, n * 4 * attributes[name].itemSize);
    attributes[name].needsUpdate = true;
  }
  mesh.geometry.setDrawRange(0, n * 6);
}

/**
 * Once a frame. `camera` is the scene camera; `pressers`, when given, are `[x, z, radius]` in game
 * feet for each truck, whose tufts are pressed down.
 */
export function updateEvoGrass(state, camera, pressers = null) {
  // The camera in game feet (the scene mirrors z).
  const cx = Math.floor(camera.position.x / CELL_FT), cz = Math.floor(-camera.position.z / CELL_FT);
  if (!state.cell || state.cell[0] !== cx || state.cell[1] !== cz) {
    refill(state, cx, cz);
    state.cell = [cx, cz];
  }
  const list = state.pressers.value;
  for (let i = 0; i < PRESSERS; i++) {
    const p = pressers?.[i];
    if (p) list[i].set(p[0], -p[1], p[2]); else list[i].set(0, 0, 0);
  }
}

export function disposeEvoGrass(state) {
  state.mesh.geometry.dispose();
  state.mesh.material.map?.dispose();
  state.mesh.material.dispose();
}
