/*
  Weather in the scene (src/game/weather.js has the numbers): fog and its colour, the light
  level, the sky, rain and snow falling around the camera, lightning, and the trucks' headlights
  in Dusk, Night and Pitch Black.

  Lights. The models are lit by the scene's sun and ambient light; the classic terrain is unlit,
  so in the dark weathers it is swapped for a lit material (keeping its baked shade) and the
  headlights, four spot lights on the trucks nearest the camera, light it.
*/
import * as THREE from "three";
import { WEATHER_LOOK } from "../game/weather.js";

const SUN_BASE = 2.2, AMBIENT_BASE = 0.9;
const BOX_FT = 90, RAIN_COUNT = 1800, SNOW_COUNT = 1600, SPOTS = 4;

function sprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/**
 * @param {{ scene: THREE.Scene, camera: THREE.Camera, world: THREE.Group, sun: THREE.DirectionalLight,
 *   ambient: THREE.AmbientLight, skyAverage: THREE.Color, look: string, random?: () => number,
 *   onSun?: (intensity: number) => void, onLightning?: () => void }} env
 */
export function createWeatherScene(env) {
  const { scene, camera, world, sun, ambient, skyAverage, look, random = Math.random } = env;
  const root = new THREE.Group();
  root.name = "weather";
  scene.add(root);
  let current = 0, flash = 0, nextBolt = 0, time = 0;

  // Terrain materials, unlit and lit, swapped for the dark weathers.
  const surfaces = [];
  world.traverse((o) => {
    if ((o.name === "terrain" || o.name === "groundBoxes") && o.material?.isMeshBasicMaterial) {
      const m = o.material;
      surfaces.push({ mesh: o, unlit: m, lit: new THREE.MeshLambertMaterial({ map: m.map, vertexColors: m.vertexColors }) });
    }
  });

  // Precipitation: points or streaks in a box that follows the camera.
  const flakeTexture = sprite();
  const rain = (() => {
    const positions = new Float32Array(RAIN_COUNT * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0.45, fog: false, depthWrite: false }));
    lines.frustumCulled = false;
    const heads = Float32Array.from({ length: RAIN_COUNT * 3 }, () => random() * BOX_FT);
    return { object: lines, positions, heads };
  })();
  const snow = (() => {
    const positions = new Float32Array(SNOW_COUNT * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ map: flakeTexture, size: 1.1, transparent: true, depthWrite: false, fog: false }));
    points.frustumCulled = false;
    const heads = Float32Array.from({ length: SNOW_COUNT * 3 }, () => random() * BOX_FT);
    return { object: points, positions, heads };
  })();
  rain.object.visible = snow.object.visible = false;
  root.add(rain.object, snow.object);

  // Headlights: a few spot lights, moved to the trucks nearest the camera.
  const spots = Array.from({ length: SPOTS }, () => {
    const light = new THREE.SpotLight(0xfff2d0, 0, 420, 0.55, 0.7, 1);
    light.visible = false;
    root.add(light, light.target);
    return light;
  });

  const lightLevel = () => WEATHER_LOOK[current].light;
  function applyLight(extra = 0) {
    const w = WEATHER_LOOK[current];
    const k = Math.min(3, w.light + extra);
    sun.intensity = SUN_BASE * k * w.sun;
    ambient.intensity = AMBIENT_BASE * k;
    env.onSun?.(sun.intensity);
    for (const { unlit } of surfaces) unlit.color.setScalar(Math.min(1, k));
  }

  function set(weather) {
    current = WEATHER_LOOK[weather] ? weather : 0;
    const w = WEATHER_LOOK[current];
    const color = new THREE.Color().setRGB(w.fogColor[0] / 255, w.fogColor[1] / 255, w.fogColor[2] / 255, THREE.SRGBColorSpace);
    if (w.fogEndFt) {
      scene.fog = new THREE.Fog(color, w.fogStartFt ?? 0, w.fogEndFt);
      scene.background = color;
    } else {
      scene.fog = new THREE.Fog(skyAverage, 2500, 7000);
      scene.background = skyAverage;
    }
    const lit = w.headlights || look === "enhanced";
    for (const s of surfaces) s.mesh.material = lit ? s.lit : s.unlit;
    rain.object.visible = w.precipitation === "rain";
    snow.object.visible = w.precipitation === "snow";
    for (const light of spots) { light.visible = w.headlights; light.intensity = w.headlights ? 90 : 0; }
    nextBolt = time + 6 + random() * 14;
    flash = 0;
    applyLight();
  }

  function fall(group, count, dt, speed, drift, streak) {
    const { positions, heads } = group;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < count; i++) {
      let x = heads[i * 3], y = heads[i * 3 + 1] - speed * dt, z = heads[i * 3 + 2];
      x += drift * dt * (streak ? 1 : Math.sin(time + i));
      if (y < 0) { y += BOX_FT; x = random() * BOX_FT; z = random() * BOX_FT; }
      heads[i * 3] = x; heads[i * 3 + 1] = y; heads[i * 3 + 2] = z;
      // The box is wrapped around the camera.
      const px = cx + ((((x - cx) % BOX_FT) + BOX_FT * 1.5) % BOX_FT) - BOX_FT / 2;
      const pz = cz + ((((z - cz) % BOX_FT) + BOX_FT * 1.5) % BOX_FT) - BOX_FT / 2;
      const py = cy - BOX_FT / 2 + y;
      if (streak) {
        positions.set([px, py, pz, px - drift * 0.05, py + 3.2, pz], i * 6);
      } else {
        positions.set([px, py, pz], i * 3);
      }
    }
    group.object.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Per frame. `trucks` are `{ x, y, z, heading }` in game feet, heading in radians (the
   * headlights shine along it).
   */
  function update(dt, trucks = []) {
    time += dt;
    const w = WEATHER_LOOK[current];
    if (w.precipitation === "rain") fall(rain, RAIN_COUNT, dt, 70, 12, true);
    if (w.precipitation === "snow") fall(snow, SNOW_COUNT, dt, 9, 2, false);
    if (w.lightning) {
      if (time >= nextBolt) { flash = 0.28; nextBolt = time + 6 + random() * 18; env.onLightning?.(); }
      if (flash > 0) {
        flash = Math.max(0, flash - dt);
        // A double flash.
        const level = flash > 0.14 || (flash > 0.06 && flash < 0.1) ? 1.6 : 0.2;
        applyLight(level);
      } else applyLight();
    }
    if (w.headlights) {
      const nearest = trucks
        .map((t) => ({ t, d: Math.hypot(t.x - camera.position.x, t.z + camera.position.z) }))
        .sort((a, b) => a.d - b.d).slice(0, SPOTS);
      spots.forEach((light, i) => {
        const near = nearest[i]?.t;
        light.visible = !!near;
        if (!near) return;
        const fx = Math.sin(near.heading), fz = Math.cos(near.heading);
        light.position.set(near.x + fx * 6, near.y + 3, -(near.z + fz * 6));
        light.target.position.set(near.x + fx * 90, near.y - 2, -(near.z + fz * 90));
      });
    }
  }

  return {
    get weather() { return current; },
    set, update, lightLevel,
    dispose() {
      scene.remove(root);
      flakeTexture.dispose();
      rain.object.geometry.dispose(); snow.object.geometry.dispose();
      for (const { lit } of surfaces) lit.dispose();
    },
  };
}
