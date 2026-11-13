/*
  Water and snow effects with the art from STARTUP.POD (MONSTER_EXE_ANALYSIS.md 13):

  - Ice. In Snow weather the water is covered with the `SNOW0-3` cloud noise, one texture per
    cell parity, drawn over the water with a translucency that grows from nothing to a half over
    100 seconds (0x4f78d0: the level `0x64cfc8` gains 1/200 of a second's worth of 65536 a
    second, up to 0x7fff).
  - Spray and ripples. A wheel in the water, or any wheel in Rain, throws `WAKEBLOB` blobs
    (0x54afd0 spawns them from the tires, 0x560600 stores them: a particle with a three second
    life, gravity of 32 ft/s squared, moving about as fast as the truck). A blob that falls back
    to the water leaves a `SPLATRIP` ripple (0x560740, 0x5609c0). The port gives the blobs an upward
    kick and the ripples a short life that widens and fades: the game's constants for both are not
    all read. In Snow the water is ice, which the game does not count as water (MTM2_PHYSICS.md
    2.3): nothing there throws blobs, and no ripple spreads on it.
*/
import * as THREE from "three";
import { iceMosaic } from "../game/sheets.js";
import { WATER_FRAME_SEQUENCE, waterFrameStep, waterOpacity } from "../game/weather.js";
import { createBillboards } from "./billboards.js";
import { steadyMipmaps } from "../shared/steady-mips.js";

const GRAVITY = 32, BLOB_LIFE = 3, RIPPLE_LIFE = 0.9, BLOBS = 256, RIPPLES = 64;
const SPAWN_EVERY = 0.045, MIN_SPEED = 4, NEAR_FT = 700, ICE_FULL_SECONDS = 100, ICE_START = 0.25, ICE_MAX = 0.5;
/** A wheel's place on the truck, feet: right, forward. */
const WHEELS = [[3.5, 6], [-3.5, 6], [3.5, -6], [-3.5, -6]];

/** The ice's opacity after `seconds` of Snow. */
export const iceOpacity = (seconds) => Math.min(ICE_MAX, ICE_START + Math.max(0, seconds / ICE_FULL_SECONDS) * ICE_MAX);

/**
 * `legacyIce` false leaves out the game's ice overlay: the port's own water freezes by itself (render/water-surface.js).
 * `blobs` false leaves the blobs undrawn: with "Rich particles" the spray is drops of the port's own
 * (render/tire-effects.js). `rings` false leaves out the ripples: the port's own water, and the port's own particles,
 * stir rings in the water itself (render/water-ripples.js). With neither, nothing is thrown.
 */
export function createWaterEffects({ scene, art, levelFt, ground, random = Math.random, legacyIce = true, blobs: showBlobs = true, rings: showRings = true }) {
  const root = new THREE.Group();
  root.name = "waterEffects";
  scene.add(root);

  let ice = null;
  if (legacyIce && art?.ice?.every(Boolean) && levelFt !== null && levelFt !== undefined) {
    const mosaic = iceMosaic(art.ice);
    const texture = new THREE.DataTexture(new Uint8Array(mosaic.rgba), mosaic.width, mosaic.height, THREE.RGBAFormat);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8192 / 64, 8192 / 64);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const geometry = new THREE.PlaneGeometry(8192, 8192);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(4096, 0.04, -4096);
    ice = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    ice.name = "ice";
    ice.visible = false;
    root.add(ice);
  }

  const blobs = art?.blob && (showBlobs || showRings) ? createBillboards({ sheet: art.blob, grid: [1, 1], capacity: BLOBS }) : null;
  const ripples = art?.ripple && showRings ? createBillboards({ sheet: art.ripple, grid: [1, 1], capacity: RIPPLES, flat: true }) : null;
  if (blobs) { blobs.object.visible = showBlobs; root.add(blobs.object); }
  if (ripples) root.add(ripples.object);

  const spray = [];
  const rings = [];
  const previous = new Map();
  let iceSeconds = 0, clock = 0, wheel = 0;
  const lastSpawn = new Map();

  function spawn(index, truck, level, rain, frozen) {
    const [right, forward] = WHEELS[wheel++ % 4];
    const s = Math.sin(truck.yaw), c = Math.cos(truck.yaw);
    const x = truck.pos[0] + right * c + forward * s, z = truck.pos[2] - right * s + forward * c;
    const bed = ground(x, z);
    const inWater = level !== null && bed < level && !frozen;
    if (!inWater && !rain) return;
    if (truck.pos[1] - bed > 8) return;
    const speed = Math.hypot(truck.vel[0], truck.vel[2]);
    const lateral = (random() - 0.5) * 6;
    spray.push({
      x, y: inWater ? level : bed + 0.3, z,
      vx: truck.vel[0] * (0.9 + random() * 0.2) + lateral * c, vz: truck.vel[2] * (0.9 + random() * 0.2) - lateral * s,
      vy: 4 + random() * 8 + Math.min(6, speed * 0.05), life: BLOB_LIFE, water: inWater,
    });
    if (spray.length > BLOBS) spray.shift();
  }

  return {
    /** `trucks`: `{ pos, yaw }` in game feet; `level` the water's level now (bob included), or null; `weather` the weather number. */
    update(dt, { trucks, camera, level, weather }) {
      clock += dt;
      const snowing = weather === 5;
      if (ice) {
        iceSeconds = snowing ? iceSeconds + dt : 0;
        ice.visible = snowing;
        ice.position.y = level ?? levelFt;
        ice.material.opacity = iceOpacity(iceSeconds);
      }
      if (!blobs) return;
      // New blobs from the wheels of trucks near the camera.
      trucks.forEach((truck, i) => {
        const before = previous.get(i);
        previous.set(i, truck.pos.slice());
        if (!before || dt <= 0) return;
        truck.vel = [(truck.pos[0] - before[0]) / dt, (truck.pos[1] - before[1]) / dt, (truck.pos[2] - before[2]) / dt];
        if (Math.hypot(truck.vel[0], truck.vel[2]) < MIN_SPEED) return;
        if (Math.hypot(truck.pos[0] - camera[0], truck.pos[2] - camera[2]) > NEAR_FT) return;
        const due = (lastSpawn.get(i) ?? 0) + dt;
        if (due >= SPAWN_EVERY) { lastSpawn.set(i, due - SPAWN_EVERY); spawn(i, truck, level, weather === 4, snowing); } else lastSpawn.set(i, due);
      });
      // Blobs fly; one that falls to the water leaves a ripple.
      for (let n = spray.length - 1; n >= 0; n--) {
        const p = spray[n];
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.life -= dt;
        const floor = p.water && level !== null ? level : ground(p.x, p.z);
        if (p.vy < 0 && p.y < floor) {
          if (p.water && ripples && rings.length < RIPPLES) rings.push({ x: p.x, y: floor, z: p.z, age: 0 });
          p.life = 0;
        }
        if (p.life <= 0) spray.splice(n, 1);
      }
      spray.forEach((p, i) => blobs.set(i, p.x, p.y, -p.z, 1.4 + (BLOB_LIFE - p.life) * 0.7, 1.4 + (BLOB_LIFE - p.life) * 0.7, 0, 0.55 * Math.min(1, p.life)));
      blobs.commit(spray.length);
      if (!ripples) return;
      for (let n = rings.length - 1; n >= 0; n--) { rings[n].age += dt; if (rings[n].age >= RIPPLE_LIFE) rings.splice(n, 1); }
      rings.forEach((r, i) => {
        const k = r.age / RIPPLE_LIFE, size = 2 + 5 * k;
        ripples.set(i, r.x, (level ?? r.y) + 0.06, -r.z, size, size, 0, 0.9 * (1 - k) ** 1.5);
      });
      ripples.commit(rings.length);
    },
    dispose() { scene.remove(root); blobs?.dispose(); ripples?.dispose(); ice?.geometry.dispose(); ice?.material.map.dispose(); ice?.material.dispose(); },
  };
}


/** Crop two texels from every edge of a 64 x 64 image, as the game's cell UVs (8 to 248 of 256) do. */
export function cropWaterFrame({ width, rgba }) {
  const side = width - 4, out = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) out.set(rgba.subarray(((y + 2) * width + 2) * 4, ((y + 2) * width + 2 + side) * 4), y * side * 4);
  return { width: side, height: side, rgba: out };
}

/**
 * The water plane drawn as the game draws it (0x5043e0): the eight `RIPPL` frames in their
 * ping-pong order, one copy of the texture for each 32 ft cell, with the weather's translucency
 * and lit by the scene. The plane is seen from both sides. `water` is the track's water mesh, or
 * every one of them: each copy of the world has its own (render/track-scene.js), and all take the
 * surface.
 */
export function createWaterSurface(water, art, look = "enhanced") {
  const meshes = [water].flat().filter(Boolean);
  if (!meshes.length || !art?.water?.every(Boolean)) return null;
  // The frames' smaller pictures made the same far off (shared/steady-mips.js): filtered each by itself, the far water
  // was each frame's mean colour in turn, a sea that pulsed grey and blue with the ripples' clock.
  const cropped = art.water.map((image) => cropWaterFrame(image));
  const alike = cropped.every((frame) => frame.width === cropped[0].width && frame.height === cropped[0].height);
  const levels = alike ? steadyMipmaps(cropped) : null;
  const frames = cropped.map((frame, index) => {
    const texture = new THREE.DataTexture(frame.rgba, frame.width, frame.height, THREE.RGBAFormat);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8192 / 32, 8192 / 32);
    // Mipmapped in either picture: repeated 256 times over the level, unfiltered it shimmers off into the distance.
    texture.magFilter = look === "classic" ? THREE.NearestFilter : THREE.LinearFilter;
    texture.minFilter = look === "classic" ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
    if (levels) { texture.mipmaps = levels[index]; texture.generateMipmaps = false; } else texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  });
  const material = new THREE.MeshLambertMaterial({ map: frames[0], transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  for (const old of new Set(meshes.map((mesh) => mesh.material))) old.dispose();
  for (const mesh of meshes) mesh.material = material;
  let clock = 0;
  return {
    /** The water's one material (render/water-mirror.js dresses it). */
    material,
    update(dt, weather) {
      // Held still in Snow.
      if (weather !== 5) clock += dt;
      material.map = frames[WATER_FRAME_SEQUENCE[waterFrameStep(clock)]];
      material.opacity = waterOpacity(weather);
    },
    dispose() { for (const t of frames) t.dispose(); material.dispose(); },
  };
}
