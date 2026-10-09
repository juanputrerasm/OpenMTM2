/*
  Community Patch 3 track lights (box type 12; ENGINE_LIMITS.md, AUTHORING_HD_ART.md §6). They are night features: they show
  when the weather lights the trucks' lamps, and do nothing by day.
  - The lit pool: a light from the lamp head aimed down at the pool (`aimOff` along the box's facing), opened so it covers
    `rad` feet of ground, with a soft edge and no fall-off with distance, its strength `bright` (1 is a truck headlight). The
    engine lights at most 128 at once, the nearest; a browser pays for every light on every lit pixel, so the port lights the
    POOL_LIGHTS nearest the camera and moves them as the camera goes.
  - The glow (`glow` 1 or 2): a soft sprite `glowRad` feet across at the lamp head, in the light's colour.
  - The cone (`glow` 2): a beam from the lamp head along the box's facing, `coneLen` long, `coneBase` to `coneRim` wide.
*/
import * as THREE from "three";
import { BEAM_AXIS, BEAM_INTENSITY, beamGeometry, beamMaterial } from "./light-beam.js";

const POOL_LIGHTS = 8;
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

/** `lights` is the track build's `trackLights`; `ground(x, z)` the terrain height in game feet. */
export function createTrackLights(scene, lights, ground) {
  if (!lights?.length) return null;
  const root = new THREE.Group();
  root.name = "trackLights";
  root.visible = false;
  scene.add(root);
  const glowMap = glowTexture();
  const items = lights.map((l) => {
    const color = new THREE.Color(l.color[0], l.color[1], l.color[2]);
    let glow = null, cone = null;
    if (l.glow >= 1) {
      glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      glow.scale.setScalar(l.glowRad * 2);
      glow.position.set(l.head[0], l.head[1], -l.head[2]);
      glow.renderOrder = 2;
      root.add(glow);
    }
    if (l.glow >= 2 && l.coneLen > 0) {
      cone = new THREE.Mesh(beamGeometry(l.coneLen, l.coneBase, l.coneRim), beamMaterial(null, l.coneLen, l.color));
      cone.material.uniforms.intensity.value = BEAM_INTENSITY * 1.5;
      cone.position.set(l.head[0], l.head[1], -l.head[2]);
      cone.quaternion.setFromUnitVectors(BEAM_AXIS, new THREE.Vector3(l.facing[0], l.facing[1], -l.facing[2]).normalize());
      cone.frustumCulled = false;
      cone.renderOrder = 1;
      root.add(cone);
    }
    // Where the pool lands, and how far down it is from the lamp head.
    const poolY = ground(l.pool[0], l.pool[1]);
    return { l, color, poolY, glow, cone };
  });
  const spots = Array.from({ length: Math.min(POOL_LIGHTS, items.length) }, () => {
    const spot = new THREE.SpotLight(0xffffff, 0, 1, 0.5, 0.6, 0);
    root.add(spot, spot.target);
    return spot;
  });
  return {
    /** Per frame: `night` is whether the weather lights the lamps; `camera` the scene camera. */
    update(camera, night) {
      root.visible = night;
      if (!night) return;
      const cx = camera.position.x, cz = -camera.position.z;
      const nearest = items.map((item) => ({ item, d: Math.hypot(item.l.pool[0] - cx, item.l.pool[1] - cz) }))
        .sort((a, b) => a.d - b.d).slice(0, spots.length);
      spots.forEach((spot, i) => {
        const near = nearest[i]?.item;
        if (!near) { spot.intensity = 0; return; }
        const { l } = near;
        const drop = Math.max(1, l.head[1] - near.poolY);
        spot.color.copy(near.color);
        spot.position.set(l.head[0], l.head[1], -l.head[2]);
        spot.target.position.set(l.pool[0], near.poolY, -l.pool[1]);
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
