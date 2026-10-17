/*
  Noise as textures, made once and shared by the port's own scenery (docs/VISUALS.md): the fog's
  drifting banks, the water's waves, the ragged edges of puddles and of settled snow, the
  ground's grain.

  Each repeats at its edges, so it can be laid across the world at any scale without a seam.
*/
import * as THREE from "three";
import { WORLD_FT, worldNoise } from "../game/terrain-relief.js";
import { waveTile } from "../game/water-waves.js";
import { puffNoiseBytes } from "./puff-noise.js";

const SIDE = 256;

/**
 * The two noises most of the ground's lines read, cloud (`cloudNoise`) and detail (`detailNoise`), as two samplers that
 * every part of a shader shares: a graphics card may give one shader as few as sixteen textures (a headset's does), and
 * a part declaring its own for the same noise would spend one more of them each. A part includes this and calls them
 * what it likes with `#define`; the guard declares them once however many parts include it.
 */
export const SHARED_NOISE_GLSL = /* glsl */ `
#ifndef MTM_SHARED_NOISE
#define MTM_SHARED_NOISE
uniform sampler2D mtmCloudNoise, mtmDetailNoise;
#endif
`;
/** The uniforms `SHARED_NOISE_GLSL` declares. */
export const sharedNoiseUniforms = () => ({ mtmCloudNoise: { value: cloudNoise() }, mtmDetailNoise: { value: detailNoise() } });
let cloud = null, waves = null, detail = null, billows = null;

/** Noise over a texture's square from the world's own (which repeats with the world), `periods` lattice cells across. */
const tile = (x, y, periods, seed) => worldNoise((x / SIDE) * WORLD_FT, (y / SIDE) * WORLD_FT, periods, seed);

function texture(data) {
  const made = new THREE.DataTexture(data, SIDE, SIDE, THREE.RGBAFormat);
  made.wrapS = made.wrapT = THREE.RepeatWrapping;
  made.magFilter = THREE.LinearFilter;
  made.minFilter = THREE.LinearMipmapLinearFilter;
  made.generateMipmaps = true;
  made.needsUpdate = true;
  return made;
}

/**
 * Four fields of soft noise, one a channel, each 0 to 1 around a half: red and green are broad
 * (clouds, banks of fog), blue is finer (ragged edges), alpha finer still (grain).
 */
export function cloudNoise() {
  if (cloud) return cloud;
  const data = new Uint8Array(SIDE * SIDE * 4);
  const byte = (v) => Math.max(0, Math.min(255, Math.round((0.5 + v * 0.5) * 255)));
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const o = (y * SIDE + x) * 4;
      data[o] = byte(tile(x, y, 4, 101) * 0.6 + tile(x, y, 9, 102) * 0.3 + tile(x, y, 19, 103) * 0.15);
      data[o + 1] = byte(tile(x, y, 5, 111) * 0.6 + tile(x, y, 11, 112) * 0.3 + tile(x, y, 23, 113) * 0.15);
      data[o + 2] = byte(tile(x, y, 13, 121) * 0.55 + tile(x, y, 29, 122) * 0.3 + tile(x, y, 61, 123) * 0.2);
      data[o + 3] = byte(tile(x, y, 31, 131) * 0.55 + tile(x, y, 67, 132) * 0.45);
    }
  }
  cloud = texture(data);
  return cloud;
}

/**
 * Waves: red and green are the slope of a field of ripples along x and y (0.5 is level), blue
 * its height. Laid over the water at two scales moving two ways, their slopes add up to a
 * surface that never repeats to the eye.
 */
export function waveNoise() {
  if (waves) return waves;
  const height = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      height[y * SIDE + x] = tile(x, y, 6, 201) * 0.5 + tile(x, y, 13, 202) * 0.28 + tile(x, y, 27, 203) * 0.15 + tile(x, y, 55, 204) * 0.07;
    }
  }
  const data = new Uint8Array(SIDE * SIDE * 4);
  const at = (x, y) => height[((y + SIDE) % SIDE) * SIDE + ((x + SIDE) % SIDE)];
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const o = (y * SIDE + x) * 4;
      // Slopes across two texels, scaled so the steepest ripples nearly fill the byte.
      data[o] = Math.max(0, Math.min(255, Math.round(127.5 + (at(x + 1, y) - at(x - 1, y)) * 900)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(127.5 + (at(x, y + 1) - at(x, y - 1)) * 900)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round((0.5 + height[y * SIDE + x] * 0.5) * 255)));
      data[o + 3] = 255;
    }
  }
  waves = texture(data);
  return waves;
}

let waveField = null;
/**
 * The water's own waves (game/water-waves.js `waveTile`): a square that repeats every way, its
 * pictures in a loop along the third axis, filtered between pictures and mipmapped, so that far
 * off it holds the mean of the slopes and of their squares. Made once.
 */
export function waveFieldTexture() {
  if (waveField) return waveField;
  const tile = waveTile();
  const made = new THREE.Data3DTexture(tile.data, tile.side, tile.side, tile.frames);
  made.format = THREE.RGBAFormat;
  made.wrapS = made.wrapT = made.wrapR = THREE.RepeatWrapping;
  made.magFilter = THREE.LinearFilter;
  made.minFilter = THREE.LinearMipmapLinearFilter;
  made.generateMipmaps = true;
  made.unpackAlignment = 1;
  made.needsUpdate = true;
  waveField = made;
  return waveField;
}

/**
 * The ground's grain (render/ground-detail.js): red is the height of a field of clods and grit
 * (0.5 is its mean), green and blue its slope along x and y (0.5 is level), alpha a second,
 * broader field. Laid over the ground at a few scales it is the detail the game's 64 texel
 * tiles, half a foot a texel, cannot hold.
 */
export function detailNoise() {
  if (detail) return detail;
  const height = new Float32Array(SIDE * SIDE);
  // Clods: the broad octaves are smooth swells; only the finest is folded into rounded bumps (one less the noise's
  // distance from zero). Folded at every size, the folds join up into a net of creases that reads as a weave on a cliff.
  const bump = (x, y, periods, seed) => (periods < 60 ? 0.5 + 0.5 * tile(x, y, periods, seed) : 1 - Math.abs(tile(x, y, periods, seed)));
  let low = Infinity, high = -Infinity;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      // Nothing finer than four texels a bump: finer than that the noise's own lattice shows, as a weave.
      const v = bump(x, y, 7, 301) * 0.38 + bump(x, y, 15, 302) * 0.3 + bump(x, y, 31, 303) * 0.22 + bump(x, y, 63, 304) * 0.1;
      height[y * SIDE + x] = v;
      if (v < low) low = v;
      if (v > high) high = v;
    }
  }
  const data = new Uint8Array(SIDE * SIDE * 4);
  const at = (x, y) => (height[((y + SIDE) % SIDE) * SIDE + ((x + SIDE) % SIDE)] - low) / (high - low);
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const o = (y * SIDE + x) * 4;
      data[o] = byte(at(x, y));
      // Slopes across two texels, scaled so the steepest nearly fill the byte.
      data[o + 1] = byte(0.5 + (at(x + 1, y) - at(x - 1, y)) * 2.6);
      data[o + 2] = byte(0.5 + (at(x, y + 1) - at(x, y - 1)) * 2.6);
      data[o + 3] = byte(0.5 + (tile(x, y, 3, 311) * 0.6 + tile(x, y, 6, 312) * 0.3 + tile(x, y, 13, 313) * 0.15) * 0.5);
    }
  }
  detail = texture(data);
  detail.anisotropy = 8;
  return detail;
}

/**
 * Noise in a cube that repeats every way (a 3D texture, 64 texels a side), for the inside of a
 * puff of dust or smoke (render/particles.js): red is broad, four and eight lumps across, green
 * finer, eight and sixteen. Each is 0 to 1 about a half. The bytes are `puffNoiseBytes`.
 */
let puffs = null;
export function puffNoise() {
  if (puffs) return puffs;
  const side = 64;
  const made = new THREE.Data3DTexture(puffNoiseBytes(), side, side, side);
  made.format = THREE.RGFormat;
  made.wrapS = made.wrapT = made.wrapR = THREE.RepeatWrapping;
  made.magFilter = made.minFilter = THREE.LinearFilter;
  made.unpackAlignment = 1;
  made.needsUpdate = true;
  puffs = made;
  return puffs;
}

/**
 * The billows of a fog's top (render/atmosphere.js): red is their height, 0 to 1 about a half,
 * heaped as a cloud's top is, in rounded crowns with creases between (the noise's distance
 * from nothing, at three sizes); green is where its wisps lie thick or thin.
 */
export function billowNoise() {
  if (billows) return billows;
  const height = new Float32Array(SIDE * SIDE);
  let sum = 0, low = Infinity, high = -Infinity;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const v = Math.abs(tile(x, y, 5, 401)) * 0.55 + Math.abs(tile(x, y, 11, 402)) * 0.3 + Math.abs(tile(x, y, 23, 403)) * 0.15;
      height[y * SIDE + x] = v;
      sum += v;
      if (v < low) low = v;
      if (v > high) high = v;
    }
  }
  // Laid so that its mean is a half.
  const mean = (sum / height.length - low) / (high - low);
  const data = new Uint8Array(SIDE * SIDE * 4);
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const o = (y * SIDE + x) * 4, v = (height[y * SIDE + x] - low) / (high - low);
      data[o] = byte(0.5 + (v - mean) * 0.9);
      data[o + 1] = byte(0.5 + 0.5 * (tile(x, y, 7, 411) * 0.6 + tile(x, y, 15, 412) * 0.4));
      data[o + 2] = data[o + 3] = 255;
    }
  }
  billows = texture(data);
  return billows;
}
