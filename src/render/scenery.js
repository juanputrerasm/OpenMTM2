/*
  The port's own scenery for a track being drawn (docs/VISUALS.md), each part made only when
  its switch is on (game/visuals.js): the weather as a volume, the ground in the weather, the
  water and the light. A screen that draws a track makes this once the track's world exists,
  hands `volume`, `groundSurface` and `lightRig` to the weather scene (render/weather-scene.js),
  and uses `water` in place of the game's water surface (render/water-effects.js) when there is
  one.
*/
import { aaChoice } from "../game/aa.js";
import { createDrawnGround } from "../game/drawn-ground.js";
import { createDecks } from "../game/ground-boxes.js";
import { FOG_AMOUNTS, weatherLevel } from "../game/atmosphere.js";
import { buildFogFloor } from "../game/fog-floor.js";
import { DEFAULT_GROUND, meanTone, tileTones } from "../game/lighting.js";
import { groundDust } from "../game/particles.js";
import { SNOW_LINE, SNOW_MAX_FT, createSnowCover, snowDrift } from "../game/snow-cover.js";
import { CELL_FT, GRID, createRelief } from "../game/terrain-relief.js";
import { visualSettings } from "../game/visuals.js";
import { createAntiAlias } from "./aa.js";
import { createContactShade } from "./contact-shade.js";
import { createGloss } from "./gloss.js";
import { createGroundDetail, createGroundTiles } from "./ground-detail.js";
import { createGroundSurface } from "./ground-surface.js";
import { createGroundTexture, createPuddleTexture, createShelterTexture } from "./ground-textures.js";
import { createLens } from "./lens.js";
import { createLightRig } from "./light-rig.js";
import { createOverScene } from "./over-scene.js";
import { createWaterReflection } from "./water-reflection.js";
import { createWaterRipples } from "./water-ripples.js";
import { createUnderwater } from "./underwater.js";
import { createWaterSystem } from "./water-surface.js";
import { createWeatherVolume } from "./weather-volume.js";

/**
 * @param {{ scene: object, camera: object, world: object, sun: object, build: object, settings: object,
 *   ground?: (x: number, z: number) => number, relief?: object|null, random?: () => number,
 *   ambient?: object|null, renderer?: object|null, look?: string }} env
 *   `build` is the asset worker's track (worker/track-build.js), whose `groundMap`, `puddles` and
 *   `snowCover` are there when the settings asked for them; `ground` the drawn ground's height in
 *   game feet and `relief` the drawn ground itself (game/terrain-relief.js) when the screen has
 *   made it. `ambient` (the scene's ambient light), `renderer` and `look` are what the light
 *   needs: it is made only in the enhanced look, which lights the ground.
 * @returns {{ volume: object|null, groundSurface: object|null, groundDetail: object|null, water: object|null, lightRig: object|null, gloss: object|null,
 *   particles: object|null, surfaceAt: (x: number, z: number) => number, floorAt: (x: number, z: number, y?: number) => number,
 *   dispose: () => void }}
 */
export function createScenery({ scene, camera, world, sun, build, settings, ground = null, relief = null, random = Math.random, ambient = null, renderer = null, look = "classic" }) {
  const on = visualSettings(settings);
  /*
    The ground as it is drawn, read off its mesh (game/drawn-ground.js): where the trucks are seated, what dust and
    cameras follow, what tracks lie on. The surface the mesh was cut from (`ground`) is within inches of it and far
    slower to ask, since it is rounded from many points about each; it stands in where nothing is drawn.
  */
  const drawn = build.terrain?.relief?.fine ? createDrawnGround(build.terrain.relief.fine) : null;
  const surface = ground;
  if (drawn && surface) ground = (x, z) => drawn.heightAt(x, z) ?? surface(x, z);
  // The classic look's ground is the game's baked brightness, which no light changes: the light is the enhanced look's.
  const lightRig = on.light && look === "enhanced" && ambient && renderer
    ? createLightRig({ scene, sun, ambient, renderer, world, groundArt: build.terrain?.atlas ?? null, indoor: !!build.stadium }) : null;
  // Heights are kept against the water's level, so they are finest at the shore.
  // With what stands over the ground (bridges, tunnels), where there is any: nothing falls under it, and the ground there is dry and bare.
  const groundTexture = on.water || on.weather ? createGroundTexture(build.groundMap, build.waterLevelFt ?? 0, build.cover ?? null) : null;
  const puddleTexture = on.puddles ? createPuddleTexture(build.puddles) : null;
  const shelterTexture = on.puddles || on.snow ? createShelterTexture(build.cover ?? null) : null;
  // Where the fog lies: on the land taken broadly, and along the course on the course's own height (game/fog-floor.js).
  const fogFloor = on.weather && ground ? buildFogFloor({ heightAt: ground, segments: build.sim?.course ?? [] }) : null;
  // As thick as the Volumetric weather slider asks (game/atmosphere.js `FOG_AMOUNTS`).
  const volume = on.weather ? createWeatherVolume({ scene, camera, sun, ground, groundTexture, random, indoor: !!build.stadium, fogFloor, amount: FOG_AMOUNTS[weatherLevel(settings)] }) : null;
  // The waves the trucks stir, in the level's water and in the puddles alike (render/water-ripples.js).
  const levelFt = build.waterLevelFt ?? null;
  const hasWater = on.water && levelFt !== null && world.getObjectByName("water");
  const ripples = renderer && (hasWater || (puddleTexture && build.puddles))
    ? createWaterRipples({ renderer, groundTexture, levelFt: hasWater ? levelFt : null, puddles: build.puddles ?? null, puddleTexture, ground }) : null;
  // The snow the track was built with, for a race that began in Snow (game/snow-cover.js): how deep it lies, and how thin
  // the course keeps it.
  const settled = on.snow && build.snowCover
    ? createSnowCover({ relief: relief ?? createRelief({ heights: build.heights, ...(build.relief ?? {}) }), ...build.snowCover }) : null;
  // A ground box's top along the course is the course (a bridge's deck): its snow is as thin as the road's. Each point of
  // the boxes says how much of the open ground's snow lies there (render/ground-surface.js `snowShare`).
  if (settled) {
    world.traverse((object) => {
      const geometry = object.name === "groundBoxes" ? object.geometry : null;
      if (!geometry || geometry.attributes.snowShare) return;
      const p = geometry.attributes.position, share = new Float32Array(p.count);
      for (let v = 0; v < p.count; v++) share[v] = settled.courseShareAt(p.getX(v), -p.getZ(v));
      geometry.setAttribute("snowShare", new p.constructor(share, 1));
    });
  }
  // The ground's own colour taken broadly: the silt that clouds stirred water, in the lake and in a puddle.
  const groundTone = build.terrain?.atlas ? meanTone(build.terrain.atlas) : [...DEFAULT_GROUND];
  const groundSurface = on.puddles || on.snow
    ? createGroundSurface({ world, puddleTexture, shelterTexture, puddles: on.puddles, snow: on.snow, sun, ripples, puddleMap: build.puddles ?? null, groundTone }) : null;
  const groundDetail = on.detail && renderer && build.terrain?.atlas
    ? createGroundDetail({ world, atlas: build.terrain.atlas, textureValues: build.sim?.textureValues ?? null, renderer, sun, look }) : null;
  // Without the detail the ground is still mipmapped, in either picture: its tiles from a stack, each filtered down by itself.
  const groundTiles = !groundDetail && renderer && build.terrain?.atlas ? createGroundTiles({ world, atlas: build.terrain.atlas, renderer, look }) : null;
  // MSAA is what the picture already did, so that choice makes nothing more. The others draw one sample and a pass.
  const mode = aaChoice(settings.aa);
  const aa = renderer && mode !== "msaa" ? createAntiAlias({ renderer, mode }) : null;
  // What is drawn over the scene, the puffs of "Rich particles" (render/over-scene.js). Without the lens and with MSAA
  // the scene goes straight to the screen, and it is this that puts the frame there.
  const over = on.particles && renderer ? createOverScene({ renderer, plainScreen: !(on.lens || aa), soft: on.lens }) : null;
  const lens = on.lens && renderer ? createLens({ renderer, aa, over }) : null;
  const gloss = on.gloss ? createGloss({ world, sun, groundArt: build.terrain?.atlas ?? null }) : null;
  // The land the water mirrors, worked out once a frame from the map of the ground and the colours of its textures (render/water-reflection.js).
  const reflection = hasWater && renderer && build.groundMap && groundTexture
    ? createWaterReflection({
      renderer, groundMap: build.groundMap, groundTexture, clr: build.sim?.clr ?? null, wraps: !build.noWrap,
      tones: build.terrain?.atlas ? tileTones(build.terrain.atlas) : null, fallbackTone: groundTone,
    }) : null;
  const water = on.water ? createWaterSystem({
    world, groundTexture, lights: { sun, ambient, hemisphere: lightRig?.hemisphere ?? null }, ripples: hasWater ? ripples : null, reflection,
    groundTone,
  }) : null;
  /** How far under water the eye is, 0 to 1 (`underwater`), for the lens. */
  let under = 0;
  // What fills the water about the eye while it is under it: motes and the sun's shafts (render/underwater.js).
  const underwaterLook = water && hasWater ? createUnderwater({ scene, water, random }) : null;
  // Where the snow has depth (a race that began in Snow), the same depth the terrain's mesh was built with.
  const snowCover = groundSurface?.snowHasDepth ? settled : null;
  /*
    What "Rich particles" needs of the scene (render/tire-effects.js `rich`): the look, the ground's own colour for dust
    and ruts, the bare ground and the snow on it, and the ice to star.
  */
  /** The height of what is drawn at game (x, z), feet: the ground's mesh there and the snow that is down on it, as the mesh has it. */
  const surfaceAt = snowCover
    ? (x, z) => ground(x, z) + (groundSurface.snowDown > 0 ? (drawn?.hasSnow ? drawn.snowAt(x, z) : snowCover.depthAt(x, z)) * groundSurface.snowDown : 0)
    : ground;
  const laidAt = surfaceAt;
  /*
    The ground boxes' tops, a bridge's deck (game/ground-boxes.js): what is over one stands on it, not on the ground under
    the bridge. `deckAt(x, z, y)` is the top under something at game (x, y, z), or null where it is over the ground.
  */
  const decks = createDecks({ heights: build.heights, ra0: build.sim?.ra0 ?? null, ra1: build.sim?.ra1 ?? null });
  const deckAt = decks ? (x, z, y) => decks.topAt(x, z, y) : () => null;
  /** What something at game (x, y, z) stands over, feet: the deck it is over, else the drawn ground and the snow on it. */
  const floorAt = decks ? (x, z, y) => deckAt(x, z, y) ?? surfaceAt(x, z) : (x, z) => surfaceAt(x, z);
  /*
    What each of the level's ground textures is, for the dust raised off it: its mean colour, its `.TTY` type and how
    readily it gives dust (game/particles.js `groundDust`). The terrain's cell says which texture it wears (its `.CLR`
    word, bits 0-11: MTM2_PHYSICS.md 2.3).
  */
  const cells = on.particles && build.sim?.clr && build.terrain?.atlas ? build.sim.clr : null;
  const textures = cells ? tileTones(build.terrain.atlas).map((tone, slot) => {
    const type = Math.floor((build.sim.textureValues?.[slot] ?? 0) / 100);
    return Object.freeze({ tone, type, dust: groundDust(tone, type) });
  }) : null;
  const particles = on.particles ? {
    look,
    groundTone,
    /** The height a rut lies at, at game (x, z), feet, for a wheel at height `y`: the deck it is over, else the drawn mesh's, without its snow. */
    bareGround: (x, z, y) => deckAt(x, z, y) ?? ground(x, z),
    /**
     * How deep the snow settles at game (x, z) under a wheel at height `y`, feet, as the mesh has it: what lifts a rut
     * with the ground. None where the snow lies flat, as on a deck.
     */
    snowDepth: drawn?.hasSnow && snowCover ? (x, z, y) => (deckAt(x, z, y) === null ? drawn.snowAt(x, z) : 0) : () => 0,
    /**
     * How deep the snow that lies at game (x, z) will settle, under something at height `y`, feet, or less while the
     * first of a fall is still creeping out (game/snow-cover.js `SNOW_LINE`): what says whether a wheel stands on snow.
     * Snow without depth in the mesh (GOLD mode's) lies flat, about half as deep as the deepest. On a deck it lies flat
     * too, by its drift, and along the course as thin as the road's (render/ground-surface.js).
     */
    snowLying: (x, z, y) => {
      const down = Math.min(1, (groundSurface?.snowDown ?? 0) / SNOW_LINE.creepsUntil);
      if (down <= 0) return 0;
      if (deckAt(x, z, y) !== null) return (settled ? SNOW_MAX_FT * snowDrift(x, z) * settled.courseShareAt(x, z) : SNOW_MAX_FT * 0.5) * down;
      return (snowCover ? snowCover.depthAt(x, z) : SNOW_MAX_FT * 0.5) * down;
    },
    strikeIce: (x, z, speedFtPerS) => water?.strike(x, z, speedFtPerS, random) ?? 0,
    /** A truck's body dragged over the ice, `points` of it down on it this frame (render/water-surface.js `drag`). */
    dragIce: (chain, points) => water?.drag(chain, points, random),
    /** How deep the puddle that stands at game (x, z) is now, feet; nothing where none does (render/ground-surface.js). */
    puddleAt: (x, z) => groundSurface?.puddleAt(x, z) ?? 0,
    /** What draws the ploughed snow's map (render/tire-tracks.js), or null. */
    renderer: renderer ?? null,
    /** Where water stands on the ground, which a rut goes under (render/ground-surface.js `pools`), or null. */
    pools: groundSurface?.pools ?? null,
    /** Where the snow shows on the ground, which a rut ploughed in it goes by (render/ground-surface.js `snowLine`), or null. */
    snowLine: groundSurface?.snowLine ?? null,
    /** What is drawn over the scene, which the puffs are drawn in (render/over-scene.js), or null where there is nothing to draw it with. */
    over,
    /** The ground texture the terrain wears at game (x, z): `{ tone, type, dust }`, or null where that is not known. */
    groundAt: textures ? (x, z) => textures[cells[(Math.floor(z / CELL_FT) & (GRID - 1)) * GRID + (Math.floor(x / CELL_FT) & (GRID - 1))] & 0x0fff] ?? null : () => null,
  } : null;
  return {
    volume, groundSurface, groundDetail, water, lightRig, gloss, lens, particles,
    /**
     * Draw a frame: through the lens on the flat screen, plainly where there is no lens or
     * `plain` asks for it (a headset, which draws each eye straight to its own display).
     */
    draw(view, { plain = false } = {}) {
      // The waves run on by the time the wheels were stirred for, before the water and the puddles that show them are drawn.
      ripples?.step([view.position.x, view.position.y, -view.position.z]);
      water?.prepare(view);
      if (lens && !plain) lens.render(scene, view, { tone: !!lightRig, under: water ? under : 0 });
      else if (aa && !plain) aa.renderFlat(scene, view, { tone: !!lightRig, over });
      else {
        lens?.rest();
        // The plain screen's frame is the over-scene's to put there: thick dust is drawn another way (render/over-scene.js `present`).
        if (over && !plain && !lens) over.present(scene, view);
        else {
          renderer.render(scene, view);
          over?.plain(view, scene.fog);
        }
      }
    },
    /**
     * After the scene was drawn with `view` somewhere other than through `draw` (the rear-view mirror): what is drawn
     * over the scene, straight over it.
     */
    drawOver(view) { over?.plain(view, scene.fog); },
    /**
     * Build ahead of need the shaders the scene is drawn with as it stands now, its lights as they are, where `draw`
     * draws it with `view` on the flat screen: a shader is built for the picture it is drawn into as well as for the
     * lights. A light shown for the first time in the middle of a race would stop it to build them
     * (render/weather-scene.js `warmPools`).
     */
    compile(view) {
      const into = lens ? lens.target : aa ? aa.flat : null;
      // The anti-aliasing's picture is made by its first frame: before that there is nothing to build for.
      if (aa && !lens && !into) return;
      const before = renderer.getRenderTarget();
      renderer.setRenderTarget(into);
      renderer.compile(scene, view);
      renderer.setRenderTarget(before);
    },
    /**
     * The picture changed size, in the screen's own points. The lens tells the anti-aliasing
     * when both are on; without the lens this does.
     */
    setSize(width, height) {
      lens?.setSize(width, height);
      if (!lens) aa?.setSize(width, height);
    },
    /**
     * The shade under the trucks, with the light (render/contact-shade.js): `trucks` gives each
     * one's wheel anchors and tire radius. Returns it, or null without "Natural light". The
     * caller updates it each frame with the drawn poses (and the ice's level in Snow) and
     * disposes of it. It is laid on the ground's mesh as drawn, which the surface the trucks are
     * seated on can be some inches under or over, or on the ice.
     */
    contactShade(trucks) {
      return lightRig ? createContactShade({ scene, trucks, ground: laidAt }) : null;
    },
    /** Dress one more ground material as the terrain's is: the lit twin the classic look's ground takes in the dark weathers. */
    dressGround(material) {
      groundSurface?.dress(material);
      groundDetail?.dress(material);
      groundTiles?.dress(material);
      water?.dressBed(material);
      return material;
    },
    /**
     * The trucks' wheels this frame, for `dt` seconds (none while a race is paused), which stir
     * the water and the puddles (render/water-ripples.js): `trucks[i]` is `{ hubs: [[x, y, z], ...],
     * radiusFt }` in game feet, or null.
     */
    stir(trucks, dt) { ripples?.stir(trucks, dt); },
    /** The drawn ground's height at game (x, z), feet, without snow: its mesh's where there is one (`relief` given), else `ground`. */
    groundAt: ground,
    /**
     * Say how far under water the eye is, 0 to 1, once a frame: under it the lens takes the red out of the picture
     * (render/lens.js), and motes and the sun's shafts fill the water (render/underwater.js). `dt` the frame's seconds (none
     * while paused), `levelFt` the water's level now, `viewHeight` the picture's height in pixels.
     */
    underwater(amount, { dt = 0, levelFt = null, viewHeight = 900 } = {}) {
      under = Math.min(1, Math.max(0, amount));
      underwaterLook?.update(dt, { under: levelFt === null ? 0 : under, levelFt: levelFt ?? 0, viewHeight, fog: scene.fog?.color ?? null });
    },
    /**
     * The height of what a truck's dust, tracks and spray lie on, and a camera keeps clear of,
     * at game (x, z): the drawn ground, and on it the snow that is down.
     */
    surfaceAt,
    /**
     * What something at game (x, y, z) stands over, feet: a bridge's deck it is over (game/ground-boxes.js), else the
     * drawn ground and its snow (`surfaceAt`). What a truck leaves and throws follows it.
     */
    floorAt,
    /** The weather scene disposes of `volume` and `groundSurface`; this of the rest. */
    dispose() {
      lens?.dispose();
      over?.dispose();
      aa?.dispose();
      ripples?.dispose();
      underwaterLook?.dispose();
      reflection?.dispose();
      lightRig?.dispose();
      groundDetail?.dispose();
      groundTiles?.dispose();
      water?.dispose();
      groundTexture?.texture.dispose();
      puddleTexture?.dispose();
      shelterTexture?.dispose();
    },
  };
}
