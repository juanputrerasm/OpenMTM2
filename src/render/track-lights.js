/*
  Community Patch 3 track lights (box type 12; ENGINE_LIMITS.md, AUTHORING_HD_ART.md §6), with Community Patch 4's rules for
  the glow and cone (beta 0.53 hotfix 4 and Traxx 1.8's engine rules, CP4_EXE_ANALYSIS.md 17.3). They are night features:
  they show when the weather lights the trucks' lamps (rain, fog, dusk, night, pitch black), and do nothing by day, except
  that a light with `allWx` set shows its glow and cone in every weather (stadium lights); its pool keeps to the lamp weather.
  The first 128 in the SIT's order are kept (worker/track-build.js `TRACK_LIGHTS_MAX`).
  - The lit pool: a light from the lamp head aimed down at the pool (`aimOff` along the box's facing), opened so it covers
    `rad` feet of ground, with a soft edge and no fall-off with distance, its strength `bright` (1 is a truck headlight). The
    engine lights at most 128 at once, the nearest; a browser pays for every light on every lit pixel, so the port lights the
    POOL_LIGHTS nearest the camera and moves them as the camera goes.
    A light whose `rad` is under 1 ft has no pool (hotfix 4).
  - The glow (`glow` 1 or 2): as the engine draws it, a square `2 glowRad` a side in the box's own XY plane at the lamp head,
    facing the box's +Z, not a sprite turned to the eye: seen only from in front, fading as it turns edge-on (its
    brightness times the eye's direction along +Z), added to the view in the light's colour.
  - The cone (`glow` 2, `coneLen` over 0 and a base or rim): from the lamp head along the box's facing, `coneLen` long,
    `coneBase` across at the lamp (a diameter) to `coneRim` from its axis at the far end (a radius).
  - Both take the engine's distance step: full brightness while the lamp is nearer than BRIGHT_STEP_FT along the view,
    a fifth past it (the engine's integer division; 3840 ft at its default view range).
  OpenMTM2's own: the glow's soft round texture (the engine's HEADLITE.RAW is not read) and the cone's look
  (render/light-beam.js), and the pools as the nearest POOL_LIGHTS spot lights.
*/
import * as THREE from "three";
import { BEAM_AXIS, BEAM_INTENSITY, SHAFT_INTENSITY, aimShaft, beamGeometry, beamMaterial, shaftGeometry, shaftMaterial } from "./light-beam.js";
import { blockShift } from "../shared/object-chunks.js";
import { classicFogDims } from "./atmosphere.js";

const POOL_LIGHTS = 8;
/** The engine's brightness step: groundVisX (120 at its default visibleTiles) x 32 ft along the view; past it 0.2. */
export const BRIGHT_STEP_FT = 120 * 32;
/** The glow and cone's brightness at `zViewFt` along the camera's forward (CP4_EXE_ANALYSIS.md 17.3). */
export const lampBrightness = (zViewFt) => (Math.trunc((zViewFt * 256) / (BRIGHT_STEP_FT * 256)) === 0 ? 1 : 0.2);
/** A headlight's pool strength in this scene (render/weather-scene.js SPOT_INTENSITY); `bright` scales it. */
const HEADLIGHT_POOL = 2.4;

function glowTexture() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
    const v = Math.round(255 * Math.max(0, 1 - r) ** 2);
    data.set([v, v, v, 255], (y * size + x) * 4);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * `lights` is the track build's `trackLights`; `ground(x, z)` the terrain height in game feet. `shafts` draws each
 * cone as light in the air ("Truck lamps", render/light-beam.js) instead of as a skin.
 */
export function createTrackLights(scene, lights, ground, { shafts = false, worldFt = 8192 } = {}) {
  // `worldFt`: the world's size, for each lamp's copy nearest the camera (a track format version 6 world may be 16384 ft).
  if (!lights?.length) return null;
  const root = new THREE.Group();
  root.name = "trackLights";
  root.visible = false;
  scene.add(root);
  const glowMap = glowTexture();
  const forward = new THREE.Vector3(), toLamp = new THREE.Vector3();
  const items = lights.map((l) => {
    const color = new THREE.Color(l.color[0], l.color[1], l.color[2]);
    let glow = null, cone = null;
    // The box's frame in the scene (its z is the game's mirrored).
    const [ax, ay, az] = (l.axes ?? [[1, 0, 0], [0, 1, 0], l.facing]).map((v) => new THREE.Vector3(v[0], v[1], -v[2]).normalize());
    if (l.glow >= 1 && l.glowRad > 0) {
      // A glow is light added to the view: with "Volumetric weather" fog dims it (render/atmosphere.js `classicFogDims`).
      // The square faces the box's +Z (`lookAt` along it, up the box's y); both sides are drawn and the facing test is ours.
      glow = new THREE.Mesh(new THREE.PlaneGeometry(2 * l.glowRad, 2 * l.glowRad),
        classicFogDims(new THREE.MeshBasicMaterial({ map: glowMap, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
      glow.position.set(l.head[0], l.head[1], -l.head[2]);
      glow.up.copy(ay);
      glow.lookAt(glow.position.clone().add(az));
      glow.renderOrder = 2;
      root.add(glow);
    }
    if (l.glow >= 2 && l.coneLen > 0 && (l.coneBase > 0 || l.coneRim > 0)) {
      const base = l.coneBase / 2;
      cone = shafts
        ? new THREE.Mesh(shaftGeometry(l.coneLen, base, l.coneRim), shaftMaterial(l.coneLen, base, l.coneRim, l.color))
        : new THREE.Mesh(beamGeometry(l.coneLen, base, l.coneRim), beamMaterial(null, l.coneLen, l.color));
      cone.userData.intensity = shafts ? SHAFT_INTENSITY : BEAM_INTENSITY * 1.5;
      cone.material.uniforms.intensity.value = cone.userData.intensity;
      cone.position.set(l.head[0], l.head[1], -l.head[2]);
      cone.quaternion.setFromUnitVectors(BEAM_AXIS, az);
      cone.frustumCulled = false;
      cone.renderOrder = 1;
      root.add(cone);
    }
    // Where the pool lands, and how far down it is from the lamp head.
    const poolY = ground(l.pool[0], l.pool[1]);
    return { l, color, poolY, glow, cone, facing: az, allWx: (l.allWx ?? 0) !== 0 };
  });
  const spots = Array.from({ length: Math.min(POOL_LIGHTS, items.length) }, () => {
    const spot = new THREE.SpotLight(0xffffff, 0, 1, 0.5, 0.6, 0);
    root.add(spot, spot.target);
    return spot;
  });
  return {
    /**
     * Per frame: `night` is whether the weather lights the lamps (the pools, and every glow and cone); `camera` the
     * scene camera. A light with allWx shows its glow and cone whatever the weather.
     */
    update(camera, night) {
      const anyAllWx = items.some((item) => item.allWx);
      root.visible = night || anyAllWx;
      if (!root.visible) return;
      const cx = camera.position.x, cz = -camera.position.z;
      camera.getWorldDirection(forward);
      // The world is drawn as a window around the camera (track-scene.js `placeBlocks`): each lamp is lit at the copy
      // of its place nearest the camera, `shift` whole worlds from where the level has it (game feet: x, and z forward).
      for (const item of items) {
        const [sx, sz] = blockShift(item.l.head[0], item.l.head[2], cx, cz, worldFt);
        item.shift = [sx, sz];
        const shown = night || item.allWx;
        for (const part of [item.glow, item.cone]) if (part) {
          part.visible = shown;
          part.position.set(item.l.head[0] + sx, item.l.head[1], -(item.l.head[2] + sz));
        }
        if (!shown) continue;
        toLamp.copy(item.glow?.position ?? item.cone.position).sub(camera.position);
        const step = lampBrightness(toLamp.dot(forward));
        if (item.glow) {
          // The eye's direction along the box's +Z, from the lamp: the glow shows only from in front.
          const facingMe = toLamp.lengthSq() > 0 ? -toLamp.dot(item.facing) / toLamp.length() : 0;
          item.glow.visible = facingMe > 0;
          item.glow.material.opacity = step * Math.max(0, facingMe);
        }
        if (item.cone) item.cone.material.uniforms.intensity.value = item.cone.userData.intensity * step;
      }
      if (shafts) for (const { cone } of items) if (cone?.visible) aimShaft(cone, camera.position);
      if (!night) { for (const spot of spots) spot.intensity = 0; return; }
      const nearest = items.filter((item) => item.l.rad >= 1).map((item) => ({ item, d: Math.hypot(item.l.pool[0] + item.shift[0] - cx, item.l.pool[1] + item.shift[1] - cz) }))
        .sort((a, b) => a.d - b.d).slice(0, spots.length);
      spots.forEach((spot, i) => {
        const near = nearest[i]?.item;
        if (!near) { spot.intensity = 0; return; }
        const { l } = near;
        const drop = Math.max(1, l.head[1] - near.poolY);
        spot.color.copy(near.color);
        spot.position.set(l.head[0] + near.shift[0], l.head[1], -(l.head[2] + near.shift[1]));
        spot.target.position.set(l.pool[0] + near.shift[0], near.poolY, -(l.pool[1] + near.shift[1]));
        // Opened to the pool's radius on the ground; reaching max(2 x height, rad) as the engine bounds it, and past it.
        spot.angle = Math.min(Math.PI / 2.2, Math.max(0.05, Math.atan2(l.rad, drop)));
        spot.distance = Math.hypot(Math.max(2 * drop, l.rad), l.rad) * 1.2;
        spot.penumbra = 0.6;
        spot.intensity = HEADLIGHT_POOL * l.bright;
      });
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      glowMap.dispose();
    },
  };
}
