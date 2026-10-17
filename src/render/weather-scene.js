/*
  Weather in the scene (src/game/weather.js has the numbers): fog and its colour, the light
  level, the sky, rain and snow falling around the camera, lightning, and the trucks' headlights
  in Dusk, Night and Pitch Black.

  Lights. The models are lit by the scene's sun and ambient light; the classic terrain is unlit,
  so in the dark weathers it is swapped for a lit material (keeping its baked shade) and the
  headlights, four spot lights on the trucks nearest the camera, light it.

  With "Volumetric weather" (`env.volume`, render/weather-volume.js) the fog set here is drawn
  as a layer the eye looks through, and the rain and snow as fields in the air, instead of the
  sprites below; with it off everything here is as it was. `env.groundSurface`
  (render/ground-surface.js) wets the ground in Rain and whitens it in Snow. With "Natural
  light" (`env.lightRig`, render/light-rig.js) the sun and the sky's light are that rig's, in
  the weather's colours, instead of the white sun and white ambient light set here.
*/
import * as THREE from "three";
import { setBackdropWeather } from "./track-scene.js";
import { UNDERWATER_FOG_FT, WEATHER_LOOK } from "../game/weather.js";
import { UNDERWATER, lightAtDepth } from "../game/water.js";
import { BACKDROP_DARK } from "../game/atmosphere.js";
import { DEFAULT_POOL, placeHeadlightPools } from "../game/truck-lights.js";
import { atmosphere } from "./atmosphere.js";
import { joinSheets } from "../game/sheets.js";
import { createBillboards } from "./billboards.js";

const SUN_BASE = 2.2, AMBIENT_BASE = 0.9;
/** A headlight's pool: about the irradiance of a clear day's sun on the ground it meets. */
const SPOT_INTENSITY = 2.4;
const BOX_FT = 90, RAIN_COUNT = 1800, SNOW_COUNT = 1600, SPOTS = 4;
/*
  A flake's size. three.js sizes points as if every view were 90 degrees tall, so the same size
  fills a different angle at another field of view. The size was chosen on the flat screen's 60
  degrees; it is scaled by the view's vertical focal length against that one, so flakes look
  the same in a headset, whose view is much taller.
*/
const SNOW_SIZE = 1.1, FLAT_FOCAL = 1 / Math.tan(Math.PI / 6);

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
 *   art?: object|null (the effect art: its snowflake sheet and raindrops draw the precipitation),
 *   onSun?: (intensity: number, shadow: number) => void (the sun's strength, and how dark its shadows are, 0 to 1),
 *   onLightning?: () => void,
 *   volume?: object|null (render/weather-volume.js), groundSurface?: object|null (render/ground-surface.js),
 *   lightRig?: object|null (render/light-rig.js), groundDetail?: object|null (render/ground-detail.js), gloss?: object|null (render/gloss.js),
 *   dressGround?: (material) => material (render/scenery.js: what the ground's own material was given),
 *   richLamps?: boolean ("Truck lamps": the headlights' pools follow each truck's lamp switch, game/truck-lights.js),
 *   water?: object|null (render/water-surface.js: under it the scene's fog is the water's) }} env
 */
export function createWeatherScene(env) {
  const { scene, camera, world, sun, ambient, skyAverage, look, random = Math.random } = env;
  let drawDistance = env.drawDistance ?? 20000;
  const volume = env.volume ?? null, groundSurface = env.groundSurface ?? null, lightRig = env.lightRig ?? null;
  const root = new THREE.Group();
  root.name = "weather";
  scene.add(root);
  let current = 0, flash = 0, nextBolt = 0, time = 0, started = false, flashLevel = 0;

  // Terrain materials, unlit and lit, swapped for the dark weathers. The terrain's chunks and
  // the world's copies share one material, so each gets one lit twin.
  // The sky's dome, which wet ground and puddles mirror (render/ground-surface.js).
  const skyDome = world.getObjectByName("sky") ?? null;
  const surfaces = [], lit = new Map();
  world.traverse((o) => {
    if ((o.name === "terrain" || o.name === "groundBoxes") && o.material?.isMeshBasicMaterial) {
      const m = o.material;
      if (!lit.has(m)) {
        const twin = new THREE.MeshLambertMaterial({ map: m.map, vertexColors: m.vertexColors });
        lit.set(m, env.dressGround?.(twin) ?? groundSurface?.dress(twin) ?? twin);
      }
      surfaces.push({ mesh: o, unlit: m, lit: lit.get(m) });
    }
  });

  // Precipitation: the game's own sprites in a box that follows the camera (`SNOFLAKS`'s sixteen flakes,
  // `NDROP1-3`'s six raindrops), or without that art plain points and streaks.
  const art = env.art ?? null;
  const flakeTexture = art ? null : sprite();
  const rain = art?.drops?.every(Boolean) ? (() => {
    const sheet = joinSheets(art.drops, { halves: true });
    const layer = createBillboards({ sheet, grid: [sheet.cells, 1], capacity: RAIN_COUNT, tint: [0.78, 0.84, 0.95] });
    const heads = Float32Array.from({ length: RAIN_COUNT * 3 }, () => random() * BOX_FT);
    const cells = Uint8Array.from({ length: RAIN_COUNT }, () => Math.floor(random() * sheet.cells));
    return { object: layer.object, layer, heads, cells, sprite: [0.32, 0.7] };
  })() : (() => {
    const positions = new Float32Array(RAIN_COUNT * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0.45, fog: false, depthWrite: false }));
    lines.frustumCulled = false;
    const heads = Float32Array.from({ length: RAIN_COUNT * 3 }, () => random() * BOX_FT);
    return { object: lines, positions, heads };
  })();
  const snow = art?.flakes ? (() => {
    const layer = createBillboards({ sheet: art.flakes, grid: [4, 4], capacity: SNOW_COUNT });
    const heads = Float32Array.from({ length: SNOW_COUNT * 3 }, () => random() * BOX_FT);
    const cells = Uint8Array.from({ length: SNOW_COUNT }, () => Math.floor(random() * 16));
    return { object: layer.object, layer, heads, cells, sprite: [0.7, 0.7] };
  })() : (() => {
    const positions = new Float32Array(SNOW_COUNT * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ map: flakeTexture, size: SNOW_SIZE, transparent: true, depthWrite: false, fog: false }));
    points.frustumCulled = false;
    const heads = Float32Array.from({ length: SNOW_COUNT * 3 }, () => random() * BOX_FT);
    return { object: points, positions, heads };
  })();
  rain.object.visible = snow.object.visible = false;
  root.add(rain.object, snow.object);

  // Headlights: a few spot lights, moved to the trucks nearest the camera. As JSTrackViewer lights them: no fall-off with
  // distance (a 1/d pool is a glare at the bumper and nothing beyond), a soft edge, and a reach well past the drawn beam.
  // Shown and hidden all together, as any of them is lit or none (game/truck-lights.js `placeHeadlightPools`): every lit
  // shader sums each spot light shown, lit or put out, and is built anew for another number of them.
  const spots = Array.from({ length: SPOTS }, () => {
    const light = new THREE.SpotLight(0xfff2d8, 0, DEFAULT_POOL.distance, DEFAULT_POOL.angle, 0.65, 0);
    light.visible = false;
    root.add(light, light.target);
    return light;
  });

  const lightLevel = () => WEATHER_LOOK[current].light;
  function applyLight(extra = 0) {
    const w = WEATHER_LOOK[current];
    flashLevel = extra;
    const k = Math.min(3, w.light + extra);
    if (lightRig) env.onSun?.(sun.intensity, lightRig.apply(extra).shadow);
    else {
      sun.intensity = SUN_BASE * k * w.sun;
      ambient.intensity = AMBIENT_BASE * k;
      env.onSun?.(sun.intensity, 1);
    }
    for (const unlit of lit.keys()) unlit.color.setScalar(Math.min(1, k));
  }

  let underwater = false;
  const deep = new THREE.Color(), passing = new THREE.Color();
  /** The weather's fog and clear colour, or under water the 320 ft fog in the weather's fog colour (the game fills the screen with it instead of the sky). */
  function applyFog() {
    const w = WEATHER_LOOK[current];
    const shade = (w.fogShade ?? 1) / 255;
    const color = new THREE.Color().setRGB(w.fogColor[0] * shade, w.fogColor[1] * shade, w.fogColor[2] * shade, THREE.SRGBColorSpace);
    if (underwater) {
      // With the port's own water the eye is in water: it sees as far as water lets it, in the water's own colour as
      // the day lights it (render/water-surface.js). Without, the game's fog.
      const within = env.water?.underColor?.() ?? null;
      scene.fog = new THREE.Fog(within ?? color, 0, within ? UNDERWATER.sightFt : UNDERWATER_FOG_FT);
      scene.background = within ?? color;
    } else if (env.backdrops && !volume && !w.noSky) {
      // With the backdrop drawn the horizon is scenery, not haze: no distance fog (Foggy and Dense Fog keep theirs).
      // With the fog as a volume the backdrop is seen through it like everything else, and the fog stays.
      scene.fog = null;
      scene.background = w.fogEndFt ? color : skyAverage;
    } else if (w.fogEndFt) {
      scene.fog = new THREE.Fog(color, Math.min(w.fogStartFt ?? 0, drawDistance * 0.5), Math.min(w.fogEndFt, drawDistance));
      scene.background = color;
    } else {
      // The haze starts close and thickens slowly to the edge of what is drawn, so the far ground fades in and does not appear all at once.
      scene.fog = new THREE.Fog(skyAverage, Math.min(1200, drawDistance * 0.15), Math.min(7000, drawDistance * 0.97));
      scene.background = skyAverage;
    }
    // The fog as a volume, where the weather has fog of its own and the camera is above the water; a fog with a top is
    // seen beyond as far as a clear day's haze lets the eye see.
    volume?.fog({ underwater, clearRange: { startFt: Math.min(2500, drawDistance * 0.35), endFt: Math.min(7000, drawDistance * 0.9) } });
    // The backdrop's veil is the fog's colour: it follows the fog, also back out of the water.
    veilBackdrop();
  }

  /** Where the fog stays with the backdrop drawn and is no volume, the dark weathers' darkness takes the backdrop too. */
  let veiledAsLight = false;
  function veilBackdrop() {
    veiledAsLight = atmosphere.linear;
    setBackdropWeather(world, current, volume && scene.fog?.isFog && BACKDROP_DARK[current] ? { color: scene.fog.color, amount: BACKDROP_DARK[current] } : null);
  }

  function set(weather) {
    current = WEATHER_LOOK[weather] ? weather : 0;
    const w = WEATHER_LOOK[current];
    // At a race's start the weather has been as it is all along; a change during one comes on.
    volume?.set(current, { instant: !started });
    groundSurface?.set(current, { instant: !started });
    started = true;
    // Before the fog is set: the fog glows toward the sun, and the rig says where this weather's sun is.
    lightRig?.set(current);
    applyFog();
    const lit = w.headlights || look === "enhanced";
    for (const s of surfaces) s.mesh.material = lit ? s.lit : s.unlit;
    rain.object.visible = !volume && w.precipitation === "rain";
    snow.object.visible = !volume && w.precipitation === "snow";
    nextBolt = time + 6 + random() * 14;
    flash = 0;
    applyLight();
  }

  function fall(group, count, dt, speed, drift, streak) {
    const { positions = null, heads } = group;
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
      if (group.layer) {
        group.layer.set(i, px, py, pz, group.sprite[0], group.sprite[1], group.cells[i], streak ? 0.85 : 1);
      } else if (streak) {
        positions.set([px, py, pz, px - drift * 0.05, py + 3.2, pz], i * 6);
      } else {
        positions.set([px, py, pz], i * 3);
      }
    }
    if (group.layer) group.layer.commit(count);
    else group.object.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Per frame. `trucks` are `{ x, y, z, heading, lit }` in game feet, heading in radians (the
   * headlights shine along it; `lit` says they are on). For the volume: `floorFt` the water's level now or null (rain
   * and snow stop at it), `viewHeight` the picture's height in pixels. `lite` (a headset) asks
   * the parts that can for their lighter drawing.
   */
  function update(dt, trucks = [], { floorFt = null, viewHeight = 900, lite = false } = {}) {
    time += dt;
    const w = WEATHER_LOOK[current];
    // The lens came on or went off (render/lens.js): the veil's colour is encoded for where the picture goes now.
    if (atmosphere.linear !== veiledAsLight) veilBackdrop();
    if (!volume && w.precipitation === "rain") fall(rain, RAIN_COUNT, dt, 70, 12, true);
    if (!volume && w.precipitation === "snow") {
      snow.object.material.size = SNOW_SIZE * camera.projectionMatrix.elements[5] / FLAT_FOCAL;
      fall(snow, SNOW_COUNT, dt, 9, 2, false);
    }
    if (w.lightning) {
      if (time >= nextBolt) { flash = 0.28; nextBolt = time + 6 + random() * 18; env.onLightning?.(); }
      if (flash > 0) {
        flash = Math.max(0, flash - dt);
        // A double flash.
        const level = flash > 0.14 || (flash > 0.06 && flash < 0.1) ? 1.6 : 0.2;
        applyLight(level);
      } else applyLight();
    }
    volume?.update(dt, { flash: w.lightning ? flashLevel : 0, light: w.light, floorFt, viewHeight, lite });
    // Under the water its colour darkens with the eye's depth, and its red goes first: the light that lights the water about
    // the eye has come down through the water over it (game/water.js `lightAtDepth`).
    if (underwater && env.water?.underColor && scene.fog && floorFt !== null) {
      const passes = lightAtDepth(floorFt - camera.position.y);
      env.water.underColor(deep).multiply(passing.setRGB(passes[0], passes[1], passes[2]));
      scene.fog.color.copy(deep);
      if (scene.background?.isColor) scene.background.copy(deep);
    }
    groundSurface?.update(dt, { light: Math.min(1.6, w.light + (w.lightning ? flashLevel : 0)), fog: scene.fog, background: skyAverage, sky: skyDome, eyeY: camera.position.y });
    env.groundDetail?.update({ weather: current, lite });
    env.gloss?.update({ weather: current });
    // The pools of light on the ground: all hidden while none is lit, and while any is, the spare ones put out
    // (game/truck-lights.js `placeHeadlightPools`).
    placeHeadlightPools(spots, trucks, {
      rich: !!env.richLamps, headlights: w.headlights, daylight: w.light, strength: SPOT_INTENSITY,
      cameraX: camera.position.x, cameraZ: camera.position.z,
    });
  }

  return {
    get weather() { return current; },
    get underwater() { return underwater; },
    /**
     * Whether the sky is drawn: not under water, nor in the weathers that show fog alone (the game's way). With the fog as a
     * volume the sky is drawn in every weather and the fog veils it (render/weather-volume.js).
     */
    get skyShown() { return !underwater && (!!volume || !WEATHER_LOOK[current].noSky); },
    /** The camera went under the water or came up: the fog changes (the sky is hidden by the caller). */
    setUnderwater(on) { if (on !== underwater) { underwater = on; applyFog(); } },
    set, update, lightLevel,
    /**
     * Build the scene's shaders ahead of need: `build()` builds them for everything in the scene, drawn yet or not,
     * and for its lights as they stand when it is called (render/scenery.js `compile`). What is first shown in the
     * middle of a race (the helicopter that lifts a truck out) would otherwise stop the picture to build its own.
     * With "Truck lamps" they are built for both of the pools' states, shown and hidden (game/truck-lights.js
     * `placeHeadlightPools`): the Headlights key changes the state in any weather. Without it only a change of weather
     * does, which builds shaders of its own. Call it once the scene has been drawn and holds all it will hold.
     */
    warmPools(build) {
      const shown = spots[0].visible;
      try {
        for (const on of env.richLamps ? [!shown, shown] : [shown]) {
          for (const light of spots) light.visible = on;
          build();
        }
      } finally {
        for (const light of spots) light.visible = shown;
      }
    },
    /** A new draw distance (feet): the fog follows it. */
    setDrawDistance(feet) { drawDistance = feet; applyFog(); },
    dispose() {
      scene.remove(root);
      flakeTexture?.dispose();
      for (const g of [rain, snow]) { if (g.layer) g.layer.dispose(); else g.object.geometry.dispose(); }
      for (const material of lit.values()) material.dispose();
      volume?.dispose();
      groundSurface?.dispose();
    },
  };
}
