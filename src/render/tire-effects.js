/*
  Dust puffs, tire tracks and sparks (game/tire-effects.js has the rules).

  As the port first drew them, and still does with "Rich particles" off:
  - Puffs: a pool of camera-facing sprites that run through the twelve frames of PUFF2 or PUFF3.
  - Tracks: a ring of ribbons laid on the ground behind each tire on soft ground, textured with TREAD.RAW. A piece
    lasts `TRACK_LIFE_S`, fading over the end of it (game/tire-effects.js `trackOpacity`).
  - Sparks: a pool of bright points thrown from hull contacts, falling under gravity.

  With "Rich particles" (docs/VISUALS.md, "Particles"; game/particles.js) what a wheel throws follows what it stands on:
  dust that billows, powder and chips off snow, chips off ice, mist and drops out of water, clods out of mud, a burst
  of it all where a truck lands, and sparks that streak. They are drawn by render/particles.js, lit and fogged, and the
  tracks by render/tire-tracks.js, as ruts.
*/
import * as THREE from "three";
import {
  CONTACT_GAP_S, DUST_RANGE_FT, DUST_TICK_S, TRACK_RANGE_FT, SMOKE_AFTER_S, SMOKE_EVERY_S, PUFF_FRAMES, PUFF_POOL, SPARK_POOL, TRACK_BREAK_FT, CLASSIC_TRACK_POOL, TRACK_STEP_FT, TRACK_WIDTH_FT,
  SPARK_BURST_GAP_S, TIRE_SPARK_SHARE, manySparksForHit, sparkRules, CLASSIC_DUST, RICH_DUST, GREY_DUST_TONE, SPARK_HIT_SPEED, SPARK_MIN_SPEED, CLASSIC_SPARK_MIN_SPEED, TRACK_LIFE_S, TRACK_FADE_S, dustPuffs, keepsTread, puffFrame, puffLife, puffSize, puffsForHit, raisesDust, scrapeSparks, sparksForHit,
} from "../game/tire-effects.js";
import { iceHullContacts, standOnFt } from "../game/ice.js";
import {
  DUST, DUST_BY_TYPE, DUST_WEATHER, LANDING_AIR_S, LITE_SHARE, PUFF_KINDS, ROOSTER, RUT, SPRAY, STREAK_KINDS, TRACK_FADE_FT, TRACK_FADE_LITE_FT, TRACK_KINDS,
  BUBBLES, MIST, SPARKS, SPARK_LIGHT, SUBMERGED_FT, dustColour, footing, groundDust, landingThrows, mistSpacingFt, muddyWater, puddleRut, roosterDrops, roosterVelocity, roosterWading, sparkShower, sparkVelocity,
  scrapePuff, scrapeThrows, slideAmount, slideThrows, sprayDrops, sprayVelocity, tireThrows, trackKind,
} from "../game/particles.js";
import { bodyInSnow, scourShape, scourSteps } from "../game/snow-scour.js";
import { classicFogDims } from "./atmosphere.js";
import { createParticles } from "./particles.js";
import { addShaderHook } from "./shader-hooks.js";
import { createTireTracks } from "./tire-tracks.js";

const GRAVITY = 32.2, DROP_POOL = 1600;
const STILL = Object.freeze([0, 0, 0]);
const flatTexture = ({ rgba, width, height }, repeat = false) => {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

/**
 * A puff frame as tinted dust: the art's brightness becomes its opacity (at most 0.5), the colour a dull brown. A tint of
 * null keeps the art's own grey (MTM2's dust), brought up to the brightness the art has at its fullest.
 */
function dustPrint(art, tint = [128, 112, 92], top = 128) {
  const out = new Uint8ClampedArray(art.rgba.length);
  let most = 1;
  if (!tint) for (let i = 0; i < art.rgba.length; i += 4) most = Math.max(most, art.rgba[i], art.rgba[i + 1], art.rgba[i + 2]);
  for (let i = 0; i < art.rgba.length; i += 4) {
    const lum = Math.max(art.rgba[i], art.rgba[i + 1], art.rgba[i + 2]);
    const [r, g, b] = tint ?? [art.rgba[i] * 255 / most, art.rgba[i + 1] * 255 / most, art.rgba[i + 2] * 255 / most];
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
    out[i + 3] = Math.min(top, lum * 0.9);
  }
  return { rgba: out, width: art.width, height: art.height };
}

/** The tread art as a dark print: the lines are opaque brown, the black around them clear. */
function treadPrint(art) {
  const out = new Uint8ClampedArray(art.rgba.length);
  for (let i = 0; i < art.rgba.length; i += 4) {
    const lum = Math.max(art.rgba[i], art.rgba[i + 1], art.rgba[i + 2]);
    out[i] = 38; out[i + 1] = 30; out[i + 2] = 22;
    out[i + 3] = Math.min(255, lum * 3);
  }
  return { rgba: out, width: art.width, height: art.height };
}

/** The Sparks slider's level in the effect flags: a number 0..3, or the older true and false (Normal and None). */
const sparkLevelOf = (flags) => (flags.sparks === true ? 2 : Math.max(0, Math.min(3, Number(flags.sparks) || 0)));

/**
 * @param {{ scene: THREE.Scene, art: object|null, ground: (x: number, z: number) => number, count: number, random?: () => number,
 *   rich?: object|null, floor?: ((x: number, z: number, y: number) => number)|null }} options
 *   `ground` is the terrain's height in game feet; `floor` what something at game (x, y, z) stands over, which on a
 *   bridge's deck is the deck and not the ground under it (render/scenery.js `floorAt`), without which it is `ground`;
 *   `art` the effects art (worker/effects-art.js). `rich` is what "Rich particles" needs, or null with it off
 *   (render/scenery.js `particles`): `{ look, groundTone, bareGround(x, z, y), snowDepth(x, z, y), snowLying(x, z, y),
 *   strikeIce(x, z, speedFtPerS), dragIce(chain, points) }`.
 */

export function createTireEffects({ scene, art, ground, count, random = Math.random, rich = null, dark = false, floor = null, greyDust = false }) {
  const root = new THREE.Group();
  root.name = "tire-effects";
  scene.add(root);
  /** What something at game (x, y, z) stands over, feet: a bridge's deck it is over, else the ground. */
  // Decks are the port's own ("Rich particles"): without it everything follows the ground, as it first did.
  const floorUnder = (rich && floor) || ((x, z) => ground(x, z));
  // The port's own particles and ruts, in place of everything drawn below.
  const particles = rich ? createParticles({ scene, ground: floorUnder, random, over: rich.over ?? null }) : null;
  /*
    In the dark a shower of sparks lights what is about it, flickering: one light, at the shower nearest the eye, as
    bright as how many sparks have just flown there. Made only for a dark weather, and never hidden, only put out (a
    light hidden or shown changes what every lit material's shader is made with).
  */
  const sparkLight = rich && dark ? new THREE.PointLight(0xffffff, 0, SPARK_LIGHT.reachFt, 2) : null;
  if (sparkLight) { sparkLight.color.setRGB(...SPARKS.warm).multiplyScalar(1 / SPARKS.warm[0]); root.add(sparkLight); }
  const shower = { flash: 0, at: [0, 0, 0], near: Infinity };
  /** The weather, how much of the snow is down (0 to 1), and where the eye is. */
  let weatherNow = 0, snowNow = 0, listenerAt = [0, 0, 0];
  /** The water's level now in game feet, or null on a track without water. */
  let waterLevel = null;
  /** Whether ground at height `floor` lies under the ice: in Snow the level's water is solid (game/ice.js `standOnFt`). */
  const iced = (floor) => standOnFt(floor, weatherNow, waterLevel) > floor;
  /** What something at game (x, y, z) stands on: in Snow the ice over the level's water, else what is under it. */
  const standOn = (x, z, y) => standOnFt(floorUnder(x, z, y), weatherNow, waterLevel);
  // A rut is laid on what the tire stands on: on the ice, not on the bed under it, and with no snow of the bed's.
  const bare = rich?.bareGround ?? ground;
  const ruts = rich ? createTireTracks({
    scene, art, look: rich.look, pools: rich.pools ?? null, snowLine: rich.snowLine ?? null, renderer: rich.renderer ?? null, groundTone: rich.groundTone ?? null,
    ground: (x, z, y) => standOnFt(bare(x, z, y), weatherNow, waterLevel),
    snowDepth: (x, z, y) => (iced(bare(x, z, y)) ? 0 : rich.snowDepth?.(x, z, y) ?? 0),
    onIce: (x, z, y) => iced(bare(x, z, y)),
  }) : null;
  /** The trucks as last given to `update`, and what each stood on: a contact reported between frames asks where the bodies are. */
  let lastTrucks = [];
  const lastSurface = [];
  // With them, none of what follows is made: its pools are empty.
  const pool = (size) => (rich ? 0 : size);

  // Puffs.
  // The puff art is grey on black; it is drawn as a soft brown dust, clear where the art is black, not added to the view.
  // Kinds 0 and 1 are dust, 2 and 3 the dark grey smoke of a collision (denser).
  // MTM2 classic dust (Options, Advanced): both kinds in the art's own grey, as the game draws a wheel's dust and a hit's alike.
  const tints = greyDust ? [[null, 128], [null, 128]] : [[[128, 112, 92], 128], [[54, 54, 58], 110]];
  // The Dust slider's level (game/tire-effects.js `dustLevel`), as the last `update` was given it; and the sprites alive.
  let dustNow = 2, livePuffs = 0;
  const frames = tints.flatMap(([tint, top]) => [art?.puff2, art?.puff3].map((list) => (list ?? []).map((image) => image && new THREE.SpriteMaterial({
    map: flatTexture(dustPrint(image, tint, top)), transparent: true, depthWrite: false, opacity: 0.7,
  }))));
  let puffLight = 1;
  const puffs = Array.from({ length: pool(PUFF_POOL) }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
    sprite.visible = false;
    sprite.renderOrder = 3;
    sprite.userData = { age: 0, life: 0, size: 0, kind: 0, live: false };
    root.add(sprite);
    return sprite;
  });
  /**
   * Dust from a wheel starts 2.8 times the game's size, swells by 14 ft and lives 2.2 times as long; the smoke of a hit starts
   * 3 times and swells by 10. With "Rich particles" the smoke of a hit is a puff of the port's own, drifting with `vel`.
   */
  function puff(x, y, z, smoke = false, vel = STILL) {
    if (dustNow <= 0) return;
    if (particles) {
      const amount = RICH_DUST[dustNow] ?? RICH_DUST[2];
      particles.puff(smoke ? PUFF_KINDS.smoke : PUFF_KINDS.dust, x, y + 0.5, z, vel[0] * 0.2 + (random() - 0.5) * 3, 1 + random() * 2, vel[2] * 0.2 + (random() - 0.5) * 3,
        { scale: amount.scale, life: amount.life, ...(greyDust ? { tone: GREY_DUST_TONE } : {}) });
      return;
    }
    if (!frames[0].length) return;
    const level = CLASSIC_DUST[dustNow] ?? CLASSIC_DUST[2];
    if (livePuffs >= level.pool) return;
    const sprite = puffs.find((p) => !p.userData.live);
    if (!sprite) return;
    const { scale, growth, life } = smoke ? level.smoke : level.dust;
    livePuffs++;
    Object.assign(sprite.userData, {
      age: 0, life: puffLife(random()) * life, size: puffSize(random()) * scale, growth,
      kind: (smoke ? 2 : 0) + (random() < 0.5 ? 0 : 1), live: true,
    });
    sprite.position.set(x, y + 0.5, -z);
    sprite.visible = true;
  }

  /*
    Tracks: CLASSIC_TRACK_POOL quads in one dynamic geometry, written round like a ring. Each point keeps when its quad
    was laid, and the graphics card works out from the clock how much of it is shown (game/tire-effects.js
    `trackOpacity`): nothing is written again as tracks fade. Only what has been laid is drawn, until the ring has been
    round once.
  */
  const TRACKS = pool(CLASSIC_TRACK_POOL);
  const trackPositions = new Float32Array(TRACKS * 12), trackUvs = new Float32Array(TRACKS * 8), trackBorn = new Float32Array(TRACKS * 4), trackIndex = new Uint32Array(TRACKS * 6);
  for (let q = 0; q < TRACKS; q++) trackIndex.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
  const trackGeometry = new THREE.BufferGeometry();
  trackGeometry.setAttribute("position", new THREE.BufferAttribute(trackPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trackGeometry.setAttribute("uv", new THREE.BufferAttribute(trackUvs, 2).setUsage(THREE.DynamicDrawUsage));
  trackGeometry.setAttribute("born", new THREE.BufferAttribute(trackBorn, 1).setUsage(THREE.DynamicDrawUsage));
  trackGeometry.setIndex(new THREE.BufferAttribute(trackIndex, 1));
  trackGeometry.setDrawRange(0, 0);
  const trackMaterial = new THREE.MeshBasicMaterial({
    map: art?.tread ? flatTexture(treadPrint(art.tread), true) : null, transparent: true, depthWrite: false,
    // A ribbon on the ground faces one way all along: one pass, not three.js's two for what is see-through on both sides.
    side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // The clock the tracks are laid and aged by, seconds.
  const trackClock = { value: 0 };
  addShaderHook(trackMaterial, "classic-tracks", 10, (shader) => {
    shader.uniforms.uTrackClock = trackClock;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTrackClock;\nattribute float born;\nvarying float vTrackShown;")
      .replace("#include <project_vertex>", `#include <project_vertex>
  vTrackShown = clamp( ( ${TRACK_LIFE_S.toFixed(1)} - ( uTrackClock - born ) ) / ${TRACK_FADE_S.toFixed(1)}, 0.0, 1.0 );`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vTrackShown;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.a *= vTrackShown;");
  });
  const tracksMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  tracksMesh.frustumCulled = false;
  // First of the see-through things: dust, smoke, drops and sparks are drawn over the tracks, not under them.
  tracksMesh.renderOrder = 0;
  tracksMesh.visible = !rich;
  root.add(tracksMesh);
  /** The ring's next place, whether it has been round once, and how many quads have been laid since the last frame. */
  let trackHead = 0, trackWrapped = false, trackFresh = 0;
  let clock = 0, frameDt = 1 / 60;

  // Sparks.
  const sparkPositions = new Float32Array(pool(SPARK_POOL) * 3), sparkColors = new Float32Array(pool(SPARK_POOL) * 3);
  const sparks = Array.from({ length: pool(SPARK_POOL) }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 }));
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute("color", new THREE.BufferAttribute(sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
  // A spark is its own light, added to the picture: with "Volumetric weather" fog dims it (render/atmosphere.js `classicFogDims`).
  const sparkPoints = new THREE.Points(sparkGeometry, classicFogDims(new THREE.PointsMaterial({
    size: 0.22, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, sizeAttenuation: true,
  })));
  sparkPoints.frustumCulled = false;
  sparkPoints.renderOrder = 3;
  sparkPoints.visible = !rich;
  root.add(sparkPoints);
  /** A hit's burst of sparks, once for a contact that lasts (game/tire-effects.js SPARK_BURST_GAP_S). */
  function burst(state, force, share = 1, many = false) {
    if (clock - (state.lastBurst ?? -9) < SPARK_BURST_GAP_S) return 0;
    const thrown = many ? manySparksForHit(force) : sparksForHit(force, Math.random, share);
    if (thrown) state.lastBurst = clock;
    return thrown;
  }
  /**
   * A spark from (x, y, z). With "Rich particles" it is a streak, thrown from something moving at `vel`, and `kind` says
   * what the hull struck it from (game/particles.js `scrapeThrows`): a spark from what is hard, a clod from earth, a chip
   * from snow or ice, a bubble under water.
   */
  /**
   * With "Rich particles": `count` of the game's sparks struck at `at` (game feet) between a truck moving at `vel` and
   * what it strikes, moving at `other` (still, for the ground or a wall); `normal` the way off that surface
   * (game/particles.js `sparkVelocity`). Each is a few glowing dots (one, `single`, below the Sparks slider's Many); a
   * blow (`hit`) scatters them wider.
   */
  function sparkShowerAt(at, count, { vel, other = STILL, normal, hit = false, single = false }) {
    const speed = Math.hypot(vel[0] - other[0], vel[1] - other[1], vel[2] - other[2]);
    let thrown = 0;
    for (let n = 0; n < count; n++) {
      const flecks = single ? 1 : hit ? 1 + Math.floor(random() * 2) : sparkShower(speed, random);
      for (let f = 0; f < flecks; f++) {
        const v = sparkVelocity({ vel, other, normal, hit, random });
        if (particles.streak(STREAK_KINDS.spark, at[0], at[1], at[2], v[0], v[1], v[2])) thrown++;
      }
    }
    // The light in the dark: at the shower nearest the eye.
    if (sparkLight && thrown) {
      const away = Math.hypot(at[0] - listenerAt[0], at[1] - listenerAt[1], at[2] - listenerAt[2]);
      if (away < SPARK_LIGHT.withinFt && (away <= shower.near * 1.2 || shower.flash < 0.2)) {
        shower.at = [at[0], at[1] + 0.4, at[2]];
        shower.near = away;
      }
      if (away < SPARK_LIGHT.withinFt) shower.flash = Math.min(SPARK_LIGHT.most, shower.flash + thrown * SPARK_LIGHT.perFleck);
    }
  }
  function spark(x, y, z, speed, up = 6, vel = STILL, kind = "spark") {
    if (particles) {
      const spec = STREAK_KINDS[kind], a = random() * Math.PI * 2;
      if (kind === "bubble") {
        particles.streak(spec, x + (random() - 0.5) * 1.5, y + random() * 0.5, z + (random() - 0.5) * 1.5, Math.cos(a) * 2, 1 + random() * 2, Math.sin(a) * 2);
        return;
      }
      // Slower and lower for what is not a spark: earth and ice are heavy.
      const lively = kind === "spark" ? 1 : 0.55, v = speed * (0.4 + random() * 0.8) * lively;
      particles.streak(spec, x, y, z, Math.cos(a) * v + vel[0] * 0.35, up * (0.3 + random()) * lively + Math.max(0, vel[1]) * 0.3, Math.sin(a) * v + vel[2] * 0.35,
        spec.ground ? { tone: earthTone("dirt", 0, spec, x, z) } : {});
      return;
    }
    // No sparks under water.
    if (waterLevel !== null && y < waterLevel) return;
    const s = sparks.find((p) => p.life <= 0);
    if (!s) return;
    const a = random() * Math.PI * 2, v = speed * (0.4 + random() * 0.8);
    Object.assign(s, { x, y, z, vx: Math.cos(a) * v, vy: up * (0.3 + random()), vz: Math.sin(a) * v, life: 0.35 + random() * 0.5, max: 0.85 });
  }

  // Water drops: small points thrown up and out where a wheel runs through water, more and higher the faster the truck.
  const dropPositions = new Float32Array(pool(DROP_POOL) * 3);
  const drops = Array.from({ length: pool(DROP_POOL) }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
  const dropGeometry = new THREE.BufferGeometry();
  dropGeometry.setAttribute("position", new THREE.BufferAttribute(dropPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const dropPoints = new THREE.Points(dropGeometry, new THREE.PointsMaterial({
    size: 0.3, color: 0xd6ebff, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true,
  }));
  dropPoints.frustumCulled = false;
  dropPoints.renderOrder = 3;
  dropPoints.visible = !rich;
  root.add(dropPoints);
  function drop(x, y, z, vx, vy, vz) {
    const d = drops.find((q) => q.life <= 0);
    if (d) Object.assign(d, { x, y, z, vx, vy, vz, life: 0.6 + random() * 1.4 });
  }
  /** `count` drops from a wheel at (x, z), outward and up, with `forward` (unit x, z) the way the truck runs at `speed`. */
  function splash(x, z, forward, speed, count, big = 1) {
    for (let n = 0; n < count; n++) {
      const a = random() * Math.PI * 2, side = (1.5 + random() * (2 + speed * 0.12)) * big;
      drop(x, waterLevel, z,
        forward[0] * speed * 0.35 + Math.cos(a) * side, (4 + random() * (4 + speed * 0.28)) * big, forward[1] * speed * 0.35 + Math.sin(a) * side);
    }
  }

  const per = Array.from({ length: count }, () => ({
    contact: 0, sinceContact: 9, smokeTimer: 0, wet: [false, false, false, false], waterTimer: 0, timer: 0, last: [null, null, null, null], strip: [0, 0, 0, 0], scrape: new Map(),
    // For "Rich particles": each tire's rut, what it stands on, how long it has been off the ground and how fast it was
    // coming down, where its hub was a frame ago; and where the truck was, and its velocity from that.
    ruts: ruts ? [0, 1, 2, 3].map(() => ruts.strip()) : null, stood: [null, null, null, null], air: [0, 0, 0, 0], fall: [0, 0, 0, 0], hubY: [null, null, null, null],
    before: null, vel: [0, 0, 0],
    // Where each tire was on the last tick, and the share of a puff of dust it owes the ground it has rolled since; the
    // same for the mist off a wet tread.
    dustAt: [null, null, null, null], dustOwed: [0, 0, 0, 0], mistAt: [null, null, null, null], mistOwed: [0, 0, 0, 0],
    // For "Rich particles": the last hollow its body left in the snow while it is in it, and its lids (`pressBody`).
    scour: null, scourChain: {},
    // For "Rich particles": how far each point of its hull was over the ice a frame ago, and the band its body is
    // scoring in the ice (`hullOnIce`).
    iceHull: new Map(), iceDrag: {},
  }));

  /** What tire at `hub`, of `radius` feet, stands on (game/particles.js `footing`), on ground of `family` and `type`. */
  const stoodOn = (hub, radius, family, type) => footing({
    family, type, weather: weatherNow, snowFt: rich.snowLying?.(hub[0], hub[2], hub[1]) ?? 0,
    inWater: waterLevel !== null && floorUnder(hub[0], hub[2], hub[1]) < waterLevel && hub[1] - waterLevel < 5,
    submerged: waterLevel !== null && hub[1] + radius < waterLevel - SUBMERGED_FT,
    puddleFt: rich.puddleAt?.(hub[0], hub[2]) ?? 0,
  });
  /** The height of what a wheel that stands on `stood` stands on: the water's level over the level's water (or its ice), else the ground. */
  const floorAt = (hub, stood) => {
    const floor = floorUnder(hub[0], hub[2], hub[1]);
    return (stood === "water" || stood === "ice") && waterLevel !== null && floor < waterLevel ? waterLevel : floor;
  };
  /** Whether Options, Effects lets a puff or streak of `kind` be thrown: mist and drops are the water's, the rest the dust's. */
  const lets = (flags, kind) => (kind === "mist" || kind === "drop" ? flags.splash : flags.dust);
  /**
   * The ground texture under game (x, z) where it is soft ground (render/scenery.js `groundAt`), or null: a ground box,
   * say, which the simulation stands on and the terrain's texture does not show.
   */
  const softGround = (x, z) => { const under = rich.groundAt?.(x, z) ?? null; return under && DUST_BY_TYPE[under.type] ? under : null; };
  /**
   * How thick the dust off the ground at game (x, z) is, 0 to 1, of the simulation's ground `type` there: as dusty as
   * the texture under it looks (game/particles.js `groundDust`), or as its type alone says where that is not known, in
   * the weather.
   */
  const dustOff = (x, z, type) => (softGround(x, z)?.dust ?? groundDust(null, type)) * (DUST_WEATHER[weatherNow] ?? 1);
  /** The colour of dust and clods off ground of `family` and `type` at game (x, z): the ground type's own, half the ground's there (or the level's). */
  const earthTone = (family, type, kind, x = null, z = null) => {
    const ground = (x !== null ? softGround(x, z)?.tone : null) ?? rich.groundTone ?? null;
    if (kind !== STREAK_KINDS.clod) return dustColour(ground, family, type);
    const own = kind.tone, share = kind.ground, level = ground ?? own;
    return [own[0] + (level[0] - own[0]) * share, own[1] + (level[1] - own[1]) * share, own[2] + (level[2] - own[2]) * share];
  };
  /**
   * A puff of `kind` (its name) from a wheel at `hub`, whose foot is at `floor`, on a truck moving at `vel`; `out` is
   * the way out from the truck's side. `thick` is how thick it is against the kind's.
   */
  function throwPuff(kind, hub, floor, vel, out, family, type, scale = 1, thick = 1) {
    const spec = PUFF_KINDS[kind], jitter = () => (random() - 0.5) * 2;
    const dusty = kind === "dust", amount = RICH_DUST[dustNow] ?? RICH_DUST[2];
    const tone = dusty && greyDust ? GREY_DUST_TONE : spec.ground ? earthTone(family, type, spec, hub[0], hub[2]) : spec.tone;
    const life = dusty ? amount.life : 1;
    if (dusty) scale *= amount.scale;
    // Dust and a sliding tire's smoke hang where they were raised; powder and mist are flung up and out by the tire.
    const hangs = kind === "dust" || kind === "rubber", spread = kind === "rubber" ? 1.1 : 0.6;
    const carried = kind === "dust" ? 0.2 : kind === "rubber" ? 0.1 : 0.42, flung = hangs ? 0.8 : 2 + random() * 2.5, up = hangs ? 0.6 + random() * 1.4 : 2 + random() * 3.5;
    particles.puff(spec, hub[0] + jitter() * spread, floor + 0.5, hub[2] + jitter() * spread,
      vel[0] * carried + out[0] * flung + jitter() * 1.2, up, vel[2] * carried + out[1] * flung + jitter() * 1.2, { tone, scale, thick, life });
  }
  /**
   * A tire of radius `radius` on wet ground or wading (`stood`) lays the mist off its tread along the way it rolled since
   * the last tick, from `state.mistAt[k]` to `hub`, a puff every so many feet by how fast it goes (game/particles.js
   * `MIST`), `few` of them in a headset: each behind the tread, a little either side of it, carried a moment with the
   * truck moving at `vel` with heading `forward`, and stopped by the air at once. A truck far from the eye (`far`) lays
   * fewer, larger ones, as it does dust.
   */
  function layMist(state, k, hub, floor, vel, forward, speed, stood, radius, few, far) {
    const from = state.mistAt[k], spacing = mistSpacingFt(speed, stood) * (far ? DUST.farSpacing : 1), larger = far ? DUST.farScale : 1;
    if (!from || !Number.isFinite(spacing)) { state.mistOwed[k] = 0; return; }
    const dx = hub[0] - from[0], dz = hub[2] - from[1], rolled = Math.hypot(dx, dz);
    // (Not across a jump from one place to another.)
    if (rolled > 40) return;
    state.mistOwed[k] += (rolled / spacing) * few;
    const count = Math.floor(state.mistOwed[k]);
    state.mistOwed[k] -= count;
    const jitter = () => (random() - 0.5) * 2;
    for (let n = 0; n < count; n++) {
      const along = (n + random()) / count - 1, across = jitter() * 0.9, behind = radius * (0.4 + 0.6 * random());
      const up = MIST.upFtS[0] + (MIST.upFtS[1] - MIST.upFtS[0]) * random();
      particles.puff(PUFF_KINDS.mist, hub[0] + dx * along - forward[0] * behind + forward[1] * across, floor + 0.3 + random() * 0.9, hub[2] + dz * along - forward[1] * behind - forward[0] * across,
        vel[0] * MIST.carried + jitter(), up, vel[2] * MIST.carried + jitter(), { scale: (0.7 + 0.6 * random()) * larger });
    }
  }
  /**
   * A tire raising dust lays it along the way it rolled since the last tick, from `state.dustAt[k]` to `hub`: a puff
   * every `DUST.spacingFt` for each of the game's puffs this tick (`raised`), `few` of them in a headset, as thick as the
   * ground there is dusty. A truck far from the eye (`far`) lays fewer, larger ones.
   */
  function layDust(state, k, hub, floor, vel, out, family, type, raised, few, far) {
    const from = state.dustAt[k];
    if (!from) return;
    const thick = dustOff(hub[0], hub[2], type);
    if (thick < DUST.least) { state.dustOwed[k] = 0; return; }
    const dx = hub[0] - from[0], dz = hub[2] - from[1], rolled = Math.hypot(dx, dz);
    // (Not across a jump from one place to another.)
    if (rolled > 40) return;
    state.dustOwed[k] += (rolled / (DUST.spacingFt * (far ? DUST.farSpacing : 1))) * raised * few * (RICH_DUST[dustNow] ?? RICH_DUST[2]).count;
    const count = Math.floor(state.dustOwed[k]);
    state.dustOwed[k] -= count;
    for (let n = 0; n < count; n++) {
      const along = (n + 0.5) / count - 1;
      throwPuff("dust", [hub[0] + dx * along, hub[1], hub[2] + dz * along], floor, vel, out, family, type, far ? DUST.farScale : 1, thick);
    }
  }
  /**
   * A little cloud of `count` bubbles let go by a tire of radius `radius` under the water at `hub`, on a truck moving at
   * `vel` with heading `forward` (game/particles.js `BUBBLES`): behind its tread, between the bed and its middle, each
   * carried a moment by the water the tire drags along.
   */
  function throwBubbles(count, hub, floor, vel, forward, radius) {
    const back = radius * (0.4 + random() * 0.6), across = (random() - 0.5) * 1.6, up = random() * radius * 1.1;
    const x = hub[0] - forward[0] * back + forward[1] * across, z = hub[2] - forward[1] * back - forward[0] * across;
    const jitter = () => (random() - 0.5) * 2 * BUBBLES.jitterFtS;
    for (let n = 0; n < count; n++) {
      particles.streak(STREAK_KINDS.bubble, x + (random() - 0.5) * 0.6, floor + up + random() * 0.4, z + (random() - 0.5) * 0.6,
        vel[0] * BUBBLES.carried + jitter(), 0.5 + jitter(), vel[2] * BUBBLES.carried + jitter());
    }
  }
  /** A streak of `kind` (its name) thrown up and back off a tire at `hub`: the faster the truck, the higher and wider. */
  function throwStreak(kind, hub, floor, vel, speed, family, type) {
    const spec = STREAK_KINDS[kind], jitter = () => (random() - 0.5) * 2;
    const tone = spec.ground ? earthTone(family, type, spec, hub[0], hub[2]) : spec.tone;
    const carried = 0.3 + random() * 0.45, wide = 2 + speed * 0.06;
    particles.streak(spec, hub[0] + jitter() * 0.8, floor + 0.3, hub[2] + jitter() * 0.8,
      vel[0] * carried + jitter() * wide, 4 + random() * (4 + speed * 0.2), vel[2] * carried + jitter() * wide, { tone });
  }
  /**
   * Spray off standing water from a tire at `hub` (game/particles.js `SPRAY`), on a truck moving at `vel` with heading
   * `forward`: sheets to either side of it and drops off its tread. `surface` is the water's height and `depth` how deep
   * it is; a puddle's water is `muddy`. Each drop is given a moment of its own within the tick, as if it had left then,
   * so the sheets leave as sheets and not in bursts.
   */
  function throwSpray(hub, surface, depth, vel, forward, speed, radius, muddy, few) {
    const { sheet, tread } = sprayDrops(speed, depth, random);
    const spec = STREAK_KINDS.drop, right = [forward[1], -forward[0]];
    const tone = muddy ? muddyWater(rich.groundAt?.(hub[0], hub[2])?.tone ?? rich.groundTone ?? null) : spec.tone;
    const drop = (side) => {
      if (random() >= few) return;
      const v = sprayVelocity({ vel, forward, side, random }), since = random() * DUST_TICK_S;
      // A sheet leaves from the tire's side at the water; the tread's drops from behind it, half way up.
      const out = side * 1.1, back = side ? 0 : radius * 0.8, up = side ? 0.1 : radius * 0.5;
      const x = hub[0] + right[0] * out - forward[0] * back - vel[0] * since + v[0] * since;
      const z = hub[2] + right[1] * out - forward[1] * back - vel[2] * since + v[2] * since;
      const y = surface + up + v[1] * since - 0.5 * GRAVITY * since * since;
      // Most of a sheet's drops are drawn large and faint, together a veil of water; the rest small and plain.
      const veil = side !== 0 && random() < SPRAY.veil, [narrow, wide] = veil ? SPRAY.veilWidthFt : SPRAY.widthFt;
      particles.streak(spec, x, y, z, v[0], v[1] - GRAVITY * since, v[2], { tone, width: narrow + (wide - narrow) * random(), opacity: veil ? SPRAY.veilOpacity : SPRAY.opacity });
    };
    for (let n = 0; n < sheet; n++) { drop(1); drop(-1); }
    for (let n = 0; n < tread; n++) drop(0);
  }
  /**
   * A rooster tail off a tire at `hub` wading `wading` in the level's water, whose surface is at `surface` (game/particles.js
   * `ROOSTER`): drops flung up from behind it as its tread, running at `tread`, comes up out of the water.
   */
  function throwRooster(hub, surface, wading, tread, vel, forward, radius, few) {
    const spec = STREAK_KINDS.drop, count = roosterDrops(tread, wading, random);
    for (let n = 0; n < count; n++) {
      if (random() >= few) continue;
      const v = roosterVelocity({ vel, forward, treadFtS: tread, random }), since = random() * DUST_TICK_S;
      // Off the back of the tread, anywhere across its width and up from the water toward the hub.
      const back = radius * (0.6 + 0.4 * random()), across = (random() - 0.5) * 1.6;
      const x = hub[0] - forward[0] * back + forward[1] * across - vel[0] * since + v[0] * since;
      const z = hub[2] - forward[1] * back - forward[0] * across - vel[2] * since + v[2] * since;
      const y = surface + random() * radius * 0.7 + v[1] * since - 0.5 * GRAVITY * since * since;
      const veil = random() < ROOSTER.veil, [narrow, wide] = veil ? ROOSTER.veilWidthFt : SPRAY.widthFt;
      particles.streak(spec, x, y, z, v[0], v[1] - GRAVITY * since, v[2], { width: narrow + (wide - narrow) * random(), opacity: veil ? ROOSTER.veilOpacity : SPRAY.opacity });
    }
  }
  /** What a wheel throws as it lands at `fall` ft/s (game/particles.js `landingThrows`): a ring of puffs and a burst of streaks; ice stars. */
  function land(hub, stood, fall, vel, flags, family, type) {
    const thrown = landingThrows(stood, fall);
    if (!thrown) return;
    const floor = floorAt(hub, stood);
    // Only the level's frozen water stars: ground that is ice has no sheet to crack.
    if (stood === "ice" && floor === waterLevel) rich.strikeIce?.(hub[0], hub[2], fall);
    // Dust only as thick as the ground there gives it, and none off ground that gives none.
    const thick = thrown.puff === "dust" ? dustOff(hub[0], hub[2], type) : 1;
    for (let n = 0; n < thrown.puffs && lets(flags, thrown.puff) && thick >= DUST.least; n++) {
      const a = random() * Math.PI * 2, out = 3 + random() * (3 + fall * 0.2);
      throwPuff(thrown.puff, [hub[0] + Math.cos(a), hub[1], hub[2] + Math.sin(a)], floor, [vel[0] + Math.cos(a) * out * 2, 0, vel[2] + Math.sin(a) * out * 2], [0, 0], family, type, 1.15, thick);
    }
    // A puddle's water is muddy.
    const spec = STREAK_KINDS[thrown.streak];
    const tone = spec.ground ? earthTone(family, type, spec, hub[0], hub[2])
      : stood === "puddle" ? muddyWater(rich.groundAt?.(hub[0], hub[2])?.tone ?? rich.groundTone ?? null) : spec.tone;
    for (let n = 0; n < thrown.streaks && lets(flags, thrown.streak); n++) {
      const a = random() * Math.PI * 2, out = 4 + random() * (5 + fall * 0.35);
      particles.streak(spec, hub[0] + Math.cos(a) * 1.2, floor + 0.3, hub[2] + Math.sin(a) * 1.2,
        vel[0] * 0.4 + Math.cos(a) * out, 5 + random() * (4 + fall * 0.45), vel[2] * 0.4 + Math.sin(a) * out, { tone });
    }
  }
  /**
   * One truck for a frame, with "Rich particles": each tire's rut, what each throws on a tick, and what a landing throws.
   * `tick` is whether this frame is one on which tires throw; `lite` a headset, which throws fewer puffs.
   */
  function richTruck(state, t, dt, flags, tick, lite, near, far) {
    const hubs = t.pose.tires.map((_, k) => t.object.tireHub(k));
    const onGround = t.pose.tires.map((tire) => !!tire.onGround && !t.pose.heli);
    const family = t.surface?.family ?? "cement", type = t.surface?.type ?? 0;
    // The truck's own velocity over the ground, from where it was a frame ago; none across a jump from one place to another.
    const pos = t.pose.pos;
    if (state.before && dt > 0) {
      const v = [(pos[0] - state.before[0]) / dt, (pos[1] - state.before[1]) / dt, (pos[2] - state.before[2]) / dt];
      state.vel = Math.hypot(v[0], v[1], v[2]) < 400 ? v : [0, 0, 0];
    }
    if (dt > 0) state.before = [pos[0], pos[1], pos[2]];
    const vel = state.vel, speed = Math.hypot(vel[0], vel[2]);
    const yaw = t.pose.euler?.[2] ?? 0, forward = [Math.sin(yaw), Math.cos(yaw)];
    // How fast the truck goes forward and how fast it slips sideways, and from them and the simulation's tires how
    // hard each tire slides or spins (game/particles.js `slideAmount`).
    const forwardFtS = vel[0] * forward[0] + vel[2] * forward[1], sidewaysFtS = vel[0] * forward[1] - vel[2] * forward[0];
    // The game's rule for dust: which tires raise it this tick (game/tire-effects.js), counted by what each stands on.
    const dusty = tick && flags.dust
      ? dustPuffs({ speedFtS: t.pose.forward ?? t.pose.speed ?? 0, onGround: onGround.map((on, k) => on && state.stood[k] === "dust"), dusty: true, random }) : [];
    hubs.forEach((hub, k) => {
      if (state.hubY[k] !== null && dt > 0 && !onGround[k]) state.fall[k] = Math.max(0, (state.hubY[k] - hub[1]) / dt);
      if (dt > 0) state.hubY[k] = hub[1];
      if (!onGround[k]) {
        state.air[k] += dt;
        state.dustAt[k] = state.mistAt[k] = null;
        ruts.lift(state.ruts[k]);
        return;
      }
      const landed = state.air[k] > LANDING_AIR_S, was = state.stood[k];
      state.air[k] = 0;
      // What it stands on is looked at on a tick and when it lands, not every frame.
      if (tick || landed || was === null) state.stood[k] = stoodOn(hub, t.radius ?? 2.75, family, type);
      const stood = state.stood[k];
      const sliding = slideAmount({ tire: t.tires?.[k] ?? null, radiusFt: t.radius ?? 2.75, forwardFtS, sidewaysFtS });
      // Every tire leaves its own track. A tire that slides digs deeper into soft ground, and leaves rubber on hard.
      const kind = flags.tracks && near ? trackKind(stood, sliding) : null;
      if (kind === null) ruts.lift(state.ruts[k]);
      else {
        // Coming to a puddle, a rut runs out into the water.
        const wading = weatherNow === 4 && kind !== TRACK_KINDS.rubber ? puddleRut(rich.puddleAt?.(hub[0], hub[2]) ?? 0) : 1;
        ruts.lay(state.ruts[k], hub[0], hub[2], kind, (stood === "hard" ? sliding : 1 + RUT.slideDeeper * sliding) * wading, hub[1]);
      }
      if (landed) land(hub, stood, state.fall[k], vel, flags, family, type);
      // A wheel meeting water at speed throws a burst, as it always did (not one coming up from under it); one running
      // into a puddle, a smaller one.
      else if (stood === "water" && was !== "water" && was !== "under" && was !== null && speed > 12) land(hub, stood, 8 + speed * 0.5, vel, flags, family, type);
      else if (stood === "puddle" && was !== "puddle" && was !== null && speed > 15) land(hub, stood, 6 + speed * 0.35, vel, flags, family, type);
      state.fall[k] = 0;
      if (!tick) return;
      const floor = floorAt(hub, stood);
      // Out from the truck's side: the right wheels are the even ones.
      const side = k % 2 === 0 ? 1 : -1, out = [forward[1] * side, -forward[0] * side];
      const few = lite ? LITE_SHARE : 1;
      const raised = dusty.reduce((n, tire) => n + (tire === k ? 1 : 0), 0);
      if (raised) layDust(state, k, hub, floor, vel, out, family, type, raised, few, far);
      else state.dustOwed[k] = 0;
      state.dustAt[k] = [hub[0], hub[2]];
      // On wet ground, and wading in the level's water, the tread's finest spray hangs behind it as mist.
      if ((stood === "wet" || stood === "water") && flags.splash) layMist(state, k, hub, floor, vel, forward, speed, stood, t.radius ?? 2.75, few, far);
      else state.mistOwed[k] = 0;
      state.mistAt[k] = [hub[0], hub[2]];
      const thrown = tireThrows(stood, speed, random);
      if (thrown.puff && lets(flags, thrown.puff) && random() < few) throwPuff(thrown.puff, hub, floor, vel, out, family, type);
      // Standing water is thrown aside in sheets.
      if ((stood === "puddle" || stood === "water") && flags.splash) {
        const puddle = stood === "puddle", bed = floorUnder(hub[0], hub[2], hub[1]);
        const depth = puddle ? rich.puddleAt?.(hub[0], hub[2]) ?? 0 : waterLevel !== null ? waterLevel - bed : 0;
        throwSpray(hub, puddle ? bed + depth : floor, depth, vel, forward, speed, t.radius ?? 2.75, puddle, few);
        // Wading in the level's water, the tread paddles it up into a rooster tail behind the wheel. The tread runs as
        // fast as the simulation turns the wheel, as fast as the truck goes where it says nothing (a replay).
        if (!puddle && waterLevel !== null) {
          const radius = t.radius ?? 2.75, tread = Math.max(speed, Math.abs(t.tires?.[k]?.spin ?? 0) * radius);
          throwRooster(hub, waterLevel, roosterWading(waterLevel - (hub[1] - radius), radius), tread, vel, forward, radius, few);
        }
      }
      if (thrown.streak === "bubble") { if (thrown.streaks && lets(flags, "bubble")) throwBubbles(thrown.streaks, hub, floor, vel, forward, t.radius ?? 2.75); }
      else for (let n = 0; n < thrown.streaks && lets(flags, thrown.streak); n++) throwStreak(thrown.streak, hub, floor, vel, speed, family, type);
      // A tire that slides or spins: smoke off hard ground, and soft ground, snow and water dug out and flung. They
      // are flung the way the tire pushes the ground, which is against the force the ground gives the tire: back from
      // a tire that drives, forward from one that brakes, outward from one that slides sideways.
      if (sliding > 0) {
        const flung = slideThrows(stood, sliding, random);
        const tire = t.tires?.[k], fx = tire?.force?.[0] ?? 0, fz = tire?.force?.[2] ?? 0, pull = Math.hypot(fx, fz);
        const push = pull > 1
          ? [-(fx * forward[1] + fz * forward[0]) / pull, -(-fx * forward[0] + fz * forward[1]) / pull]
          : [-Math.sign(sidewaysFtS) * forward[1], Math.sign(sidewaysFtS) * forward[0]];
        const fast = 8 + 22 * sliding;
        const back = [vel[0] + push[0] * fast, vel[1], vel[2] + push[1] * fast];
        const thick = flung.puff === "dust" ? dustOff(hub[0], hub[2], type) : 1;
        if (flung.puff && thick >= DUST.least && lets(flags, flung.puff === "rubber" ? "dust" : flung.puff) && random() < few) throwPuff(flung.puff, hub, floor, back, out, family, type, 1 + 0.4 * sliding, thick);
        for (let n = 0; n < flung.streaks && lets(flags, flung.streak); n++) throwStreak(flung.streak, hub, floor, back, speed + fast, family, type);
      }
    });
  }

  /**
   * Truck `t`'s body in the snow (game/snow-scour.js): where it is through the snow's surface it leaves a hollow the shape
   * of what went in, and while it goes on through it, one long hollow as it goes. From the simulation's hull points,
   * the corners of the outline of the truck, so a replay's trucks leave them as the race's did.
   */
  function pressBody(state, t) {
    if (weatherNow !== 5 || !(snowNow > 0) || !t.object?.hullPoint) { state.scour = null; state.scourChain = {}; return; }
    const points = [];
    for (let zone = 1; zone <= 12; zone++) { const p = t.object.hullPoint(zone); if (p) points.push(p); }
    const body = bodyInSnow(points, (x, z, y) => {
      const thick = rich.snowDepth(x, z, y) * snowNow;
      return { surfaceFt: rich.bareGround(x, z, y) + thick, thickFt: thick };
    });
    if (!body) { state.scour = null; state.scourChain = {}; return; }
    for (const step of scourSteps(state.scour, scourShape(body.outline, body.depthFt))) {
      if (!step.drag) state.scourChain = {};
      ruts.scour(step, body.y, state.scourChain);
      state.scour = step;
    }
  }

  /**
   * Truck `t`'s hull on the ice, over `dt` seconds (game/ice.js `iceHullContacts`): a point of it that comes down on the
   * ice stars it as hard as it came down, as a wheel does, and while any stays down the body scores a band in it as it
   * goes. From the simulation's hull points where the drawn truck is, so a replay's trucks mark the ice as the race's did.
   */
  function hullOnIce(state, t, dt) {
    if (weatherNow !== 5 || waterLevel === null || !t.object?.hullPoint || !rich.strikeIce) {
      state.iceHull.clear();
      if (state.iceDrag.last) rich.dragIce?.(state.iceDrag, []);
      return;
    }
    if (!(dt > 0)) return;
    const hull = [];
    for (let zone = 1; zone <= 12; zone++) hull.push(t.object.hullPoint(zone));
    const { blows, down } = iceHullContacts({ hull, levelFt: waterLevel, overIce: (x, z, y) => iced(floorUnder(x, z, y)), last: state.iceHull, dt });
    for (const blow of blows) rich.strikeIce(blow.x, blow.z, blow.speedFtPerS);
    rich.dragIce?.(state.iceDrag, down);
  }

  /** A quad of track between two contact points, one tire's width across, under a hub at height `y`. */
  function mark(i, tire, x, z, y) {
    const state = per[i], last = state.last[tire];
    state.last[tire] = [x, z];
    if (!last) return;
    const dx = x - last[0], dz = z - last[1], length = Math.hypot(dx, dz);
    if (length < TRACK_STEP_FT || length > TRACK_BREAK_FT) { if (length > TRACK_BREAK_FT) state.last[tire] = [x, z]; else state.last[tire] = last; return; }
    const nx = (-dz / length) * (TRACK_WIDTH_FT / 2), nz = (dx / length) * (TRACK_WIDTH_FT / 2);
    const corners = [[last[0] - nx, last[1] - nz], [last[0] + nx, last[1] + nz], [x + nx, z + nz], [x - nx, z - nz]].map(([cx, cz]) => [cx, ground(cx, cz), cz]);
    const q = trackHead;
    trackHead = (trackHead + 1) % CLASSIC_TRACK_POOL;
    if (trackHead === 0) trackWrapped = true;
    trackFresh++;
    corners.forEach(([cx, cy, cz], k) => trackPositions.set([cx, cy + 0.07, -cz], (q * 4 + k) * 3));
    const v0 = state.strip[tire], v1 = v0 + length / 4;
    state.strip[tire] = v1;
    trackUvs.set([0, v0, 1, v0, 1, v1, 0, v1], q * 8);
    trackBorn.fill(clock, q * 4, q * 4 + 4);
  }

  return {
    /**
     * Per frame. `trucks[i]` is `{ object, pose, surface: { family, type } | null, tires, radius }` (the truck's drawn
     * object and pose, what it drives on, and for "Rich particles" the simulation's tires, `{ onGround, grip, force, spin }`
     * each, and a tire's radius, which say how hard each slides or spins; a replay has none and goes by the pose); `flags` `{ dust, tracks, sparks }`; `noDust` for Rain and Snow (the game raises none).
     * `light` is how bright dust and smoke are, 1 as drawn by day: with "Natural light" they dim with the weather, as the
     * game's puffs were fainter with the ground's light (MONSTER_EXE_ANALYSIS.md, "Dust puffs").
     */
    update({ dt, listener, flags, noDust = false, trucks, light = 1, weather = 0, camera = null, lights = null, snowDown = 0, viewHeight = 900, lite = false }) {
      weatherNow = weather;
      dustNow = flags.dust === true ? 2 : Math.max(0, Math.min(3, Number(flags.dust) || 0));
      snowNow = snowDown;
      lastTrucks = trucks;
      trucks.forEach((t, i) => { lastSurface[i] = t?.surface ?? null; });
      if (rich) {
        clock += dt;
        if (dt > 0) frameDt = Math.min(dt, 0.1);
        trucks.forEach((t, i) => {
          if (!t?.pose || !t.object || i >= per.length) return;
          const state = per[i];
          state.sinceContact += dt;
          if (state.sinceContact > CONTACT_GAP_S) state.contact = 0;
          state.timer += dt;
          const tick = state.timer >= DUST_TICK_S;
          if (tick) state.timer %= DUST_TICK_S;
          const away = Math.hypot(t.pose.pos[0] - listener[0], t.pose.pos[2] - listener[2]);
          richTruck(state, t, dt, flags, tick, lite, away < TRACK_RANGE_FT, away > DUST.farFt);
          // Its body in the snow, where it is in it, and on the ice.
          if (flags.tracks) pressBody(state, t); else state.scour = null;
          hullOnIce(state, t, dt);
        });
        ruts.update(dt, { snowDown, fadeFt: lite ? TRACK_FADE_LITE_FT : TRACK_FADE_FT, eye: listener, lite, ice: weather === 5 });
        listenerAt = listener;
        if (sparkLight) {
          // The sparks' light dies with them, and flickers while they fly.
          shower.flash *= Math.exp(-dt / SPARK_LIGHT.fadeS);
          if (shower.flash < 0.02) { shower.flash = 0; shower.near = Infinity; }
          sparkLight.position.set(shower.at[0], shower.at[1], -shower.at[2]);
          sparkLight.intensity = SPARK_LIGHT.strength * shower.flash * (0.7 + 0.6 * random());
        }
        if (camera) particles.update(dt, { camera, light: lights ?? {}, waterFt: waterLevel, frozen: weather === 5, viewHeight });
        return;
      }
      if (light !== puffLight) {
        puffLight = light;
        for (const material of frames.flat(2)) if (material) material.color.setScalar(light);
      }
      clock += dt;
      if (dt > 0) frameDt = Math.min(dt, 0.1);
      trucks.forEach((t, i) => {
        if (!t?.pose || !t.object || i >= per.length) return;
        const state = per[i];
        state.sinceContact += dt;
        if (state.sinceContact > CONTACT_GAP_S) state.contact = 0;
        const hubs = t.pose.tires.map((_, k) => t.object.tireHub(k));
        const onGround = t.pose.tires.map((tire) => !!tire.onGround && !t.pose.heli);
        const family = t.surface?.family ?? "cement", type = t.surface?.type ?? 0;
        const nearCamera = Math.hypot(t.pose.pos[0] - listener[0], t.pose.pos[2] - listener[2]) < TRACK_RANGE_FT;
        if (flags.tracks && nearCamera && keepsTread(family, type)) {
          hubs.forEach((hub, k) => { if (onGround[k]) mark(i, k, hub[0], hub[2], hub[1]); else state.last[k] = null; });
        } else state.last.fill(null);
        // Water drops: a wheel in water throws them (every tick, more with speed); a wheel meeting the water at speed throws a burst.
        const speed = Math.hypot(t.pose.speed ?? 0), yaw = t.pose.euler?.[2] ?? 0, forward = [Math.sin(yaw), Math.cos(yaw)];
        // Not a wheel wholly under the water, which throws nothing out of it.
        const wetNow = hubs.map((hub) => waterLevel !== null && floorUnder(hub[0], hub[2], hub[1]) < waterLevel && hub[1] - waterLevel < 5 && hub[1] + (t.radius ?? 2.75) >= waterLevel - SUBMERGED_FT);
        state.waterTimer += dt;
        const waterTick = state.waterTimer >= DUST_TICK_S;
        if (waterTick) state.waterTimer %= DUST_TICK_S;
        hubs.forEach((hub, k) => {
          if (flags.splash && wetNow[k] && speed > 4) {
            if (!state.wet[k] && speed > 12) splash(hub[0], hub[2], forward, speed, Math.min(40, 8 + Math.round(speed * 0.5)), 1.3);
            else if (waterTick) splash(hub[0], hub[2], forward, speed, Math.min(8, 1 + Math.floor(speed / 10)));
          }
          state.wet[k] = wetNow[k];
        });
        state.timer += dt;
        if (state.timer >= DUST_TICK_S) {
          state.timer %= DUST_TICK_S;
          if (flags.dust && !noDust && Math.hypot(hubs[0][0] - listener[0], hubs[0][2] - listener[2]) < DUST_RANGE_FT) {
            for (const k of dustPuffs({ speedFtS: t.pose.forward ?? t.pose.speed ?? 0, onGround, dusty: raisesDust(family), random })) {
              puff(hubs[k][0] + (random() - 0.5), floorUnder(hubs[k][0], hubs[k][2], hubs[k][1]), hubs[k][2] + (random() - 0.5));
            }
          }
        }
      });
      // Puffs age, change frame, grow and face the camera (sprites do).
      for (const sprite of puffs) {
        const u = sprite.userData;
        if (!u.live) continue;
        u.age += dt;
        const frame = puffFrame(u.age, u.life);
        const material = frame < 0 ? null : frames[u.kind][frame] ?? frames[u.kind][PUFF_FRAMES - 1];
        if (!material) { u.live = false; sprite.visible = false; livePuffs = Math.max(0, livePuffs - 1); continue; }
        sprite.material = material;
        const size = (u.size + Math.min(1, u.age / u.life) * u.growth) * 2;
        sprite.scale.set(size, size, 1);
      }
      // Only the quads laid since the last frame go to the graphics card, the newest before the ring's next place.
      if (trackFresh) {
        const count = Math.min(trackFresh, CLASSIC_TRACK_POOL), first = (trackHead - count + CLASSIC_TRACK_POOL) % CLASSIC_TRACK_POOL;
        const ranges = first + count <= CLASSIC_TRACK_POOL ? [[first, count]] : [[first, CLASSIC_TRACK_POOL - first], [0, first + count - CLASSIC_TRACK_POOL]];
        for (const attribute of [trackGeometry.attributes.position, trackGeometry.attributes.uv, trackGeometry.attributes.born]) {
          for (const [from, n] of ranges) attribute.addUpdateRange(from * 4 * attribute.itemSize, n * 4 * attribute.itemSize);
          attribute.needsUpdate = true;
        }
        trackGeometry.setDrawRange(0, trackWrapped ? Infinity : trackHead * 6);
        trackFresh = 0;
      }
      trackClock.value = clock;
      // Drops fly and fall back into the water.
      let wet = false;
      drops.forEach((d, n) => {
        if (d.life > 0) {
          d.life -= dt;
          d.vy -= GRAVITY * dt;
          d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
          if (d.y < (waterLevel ?? -1e9) || d.y < floorUnder(d.x, d.z, d.y)) d.life = 0;
          wet = true;
        }
        dropPositions.set(d.life > 0 ? [d.x, d.y, -d.z] : [0, -9999, 0], n * 3);
      });
      if (wet || dropPoints.userData.had) dropGeometry.attributes.position.needsUpdate = true;
      dropPoints.userData.had = wet;
      // Sparks fly.
      let any = false;
      sparks.forEach((s, n) => {
        if (s.life > 0) {
          s.life -= dt;
          s.vy -= GRAVITY * dt;
          s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
          if (waterLevel !== null && s.y < waterLevel) s.life = 0;
          const floor = floorUnder(s.x, s.z, s.y);
          if (s.y < floor) { s.y = floor; s.vy = Math.abs(s.vy) * 0.3; s.vx *= 0.6; s.vz *= 0.6; }
          any = true;
        }
        const fade = s.life > 0 ? Math.min(1, s.life / 0.3) : 0;
        sparkPositions.set(s.life > 0 ? [s.x, s.y, -s.z] : [0, -9999, 0], n * 3);
        sparkColors.set([1 * fade, 0.72 * fade, 0.3 * fade], n * 3);
      });
      if (any || sparkPoints.userData.had) {
        sparkGeometry.attributes.position.needsUpdate = true;
        sparkGeometry.attributes.color.needsUpdate = true;
      }
      sparkPoints.userData.had = any;
    },
    /**
     * A hull contact on truck `i` (`zone` 1 to 12, `steps` simulation steps of it this frame, its `force`): sparks while it scrapes
     * at speed, a burst of sparks and dust on a hard hit.
     */
    hit(i, object, zone, steps, force, speedFtS, flags) {
      // With "Rich particles" from where the body is, dents and all, not from the corner of the box round it.
      const where = object.hullPoint(zone, !!rich);
      if (!where || !per[i]) return;
      const state = per[i];
      const bed = floorUnder(where[0], where[2], where[1]);
      const underWater = !!rich && waterLevel !== null && weatherNow !== 5 && bed < waterLevel && where[1] < waterLevel;
      // What it struck: the ground, or the ice over the water, when the point is down on it; else a thing.
      const onIce = !!rich && iced(bed), floor = onIce ? waterLevel : bed;
      const onGround = where[1] - floor < 1.2;
      const amount = sparkRules(sparkLevelOf(flags));
      if (amount.share > 0) {
        // Under water, nothing that burns; off the ice, chips.
        const kind = rich
          ? scrapeThrows({ onGround, underWater, onIce, family: lastSurface[i]?.family, type: lastSurface[i]?.type, weather: weatherNow, snowFt: rich.snowLying?.(where[0], where[2], where[1]) ?? 0 })
          : "spark";
        const result = scrapeSparks(state.scrape.get(zone) ?? 0, steps / 60, speedFtS, Math.random, amount.share, rich ? SPARK_MIN_SPEED : CLASSIC_SPARK_MIN_SPEED, amount.many && !rich);
        state.scrape.set(zone, result.timer);
        if (rich && kind === "spark") {
          // Off the ground, up; off a thing, out from it toward the truck, along the ground.
          const pos = lastTrucks[i]?.pose?.pos ?? where;
          const normal = onGround ? [0, 1, 0] : [pos[0] - where[0], 0, pos[2] - where[2]];
          const struck = amount.many ? sparksForHit(force, speedFtS) : burst(state, force, amount.share);
          sparkShowerAt(where, result.sparks, { vel: state.vel, normal, single: !amount.many });
          sparkShowerAt(where, struck, { vel: state.vel, normal, hit: true, single: !amount.many });
        } else for (let n = 0; n < result.sparks + burst(state, force, amount.share, amount.many); n++) spark(where[0], where[1], where[2], 14, 8, state.vel, kind);
      }
      // (What it does to the ice is the hull's on the ice, `hullOnIce`, which looks at it every frame.)
      if (!underWater) this._contactSmoke(state, where, steps, flags, force, speedFtS, onGround ? i : -1, onIce);
    },
    /**
     * Dark smoke from a hull contact that has gone on for a second, a puff every fifth of a second after. With "Rich
     * particles", a hull of truck `scraping` (-1 for a contact with a thing) that scrapes along the ground raises what
     * the ground gives instead (game/particles.js `scrapePuff`): dust off dusty ground, powder off snow and the ice
     * (`onIce`), nothing off mud.
     */
    _contactSmoke(state, where, steps, flags, force = 0, speedFtS = Infinity, scraping = -1, onIce = false) {
      state.sinceContact = 0;
      // Real time in contact, counted once a frame however many zones or steps report it.
      if (state.stamp !== clock) { state.stamp = clock; state.contact += frameDt; state.smokeTimer += frameDt; }
      // Smoke is of something being torn at speed, as sparks are: a truck that only leans on a thing makes none.
      if (!flags.dust || (rich && speedFtS < SPARK_HIT_SPEED)) return;
      let smoke = (y) => puff(where[0], y, where[2], true, state.vel);
      if (rich && scraping >= 0) {
        const surface = lastSurface[scraping], type = surface?.type ?? 0, family = surface?.family ?? "cement";
        const kind = scrapePuff(footing({
          family, type, weather: weatherNow, snowFt: rich.snowLying?.(where[0], where[2], where[1]) ?? 0, puddleFt: rich.puddleAt?.(where[0], where[2]) ?? 0, inWater: onIce,
        }));
        const thick = kind === "dust" ? dustOff(where[0], where[2], type) : 1;
        if (!kind || thick < DUST.least) return;
        if (kind !== "smoke") {
          const floor = standOn(where[0], where[2], where[1]);
          smoke = () => throwPuff(kind, where, floor, state.vel, [0, 0], family, type, 1.2, thick);
        }
      }
      // A hard hit smokes at once; a lasting contact keeps smoking after a moment.
      if (force >= 900 && clock - (state.lastHitSmoke ?? -9) > 0.5) { state.lastHitSmoke = clock; smoke(where[1] - 0.5); smoke(where[1] - 0.2); }
      if (state.contact < SMOKE_AFTER_S) return;
      if (state.smokeTimer >= SMOKE_EVERY_S) { state.smokeTimer %= SMOKE_EVERY_S; smoke(where[1] - 0.5); }
    },
    /** The water's level now in game feet (the bob included), or null on a track without water. */
    setWater(level) { waterLevel = level ?? null; },
    /**
     * Truck `i` met another truck this frame: sparks while they scrape at speed, a burst and dust on a hard hit. `where`
     * is the simulation's place for the meeting, which is half way between the two trucks' middles: with "Rich
     * particles" the sparks fly from where the two bodies are nearest each other instead, and it is how fast the two
     * are moving against each other that makes them, not how fast either is going. `hull`: bodywork met, not tires
     * alone (tires alone throw far fewer).
     */
    touch(i, where, steps, force, speedFtS, flags, hull = true) {
      if (!per[i]) return;
      const state = per[i];
      let at = where, slide = speedFtS, theirVel = STILL, mine = where;
      if (rich && lastTrucks[i]?.pose) {
        // The other truck is as far beyond the meeting place as this one is short of it.
        const mine = lastTrucks[i].pose.pos, other = [2 * where[0] - mine[0], 2 * where[1] - mine[1], 2 * where[2] - mine[2]];
        let j = -1, least = 30;
        lastTrucks.forEach((t, k) => {
          const d = k !== i && t?.pose ? Math.hypot(t.pose.pos[0] - other[0], t.pose.pos[1] - other[1], t.pose.pos[2] - other[2]) : Infinity;
          if (d < least) { least = d; j = k; }
        });
        if (j >= 0) {
          // The point of this body nearest the other truck, then the point of the other body nearest that, and back: where they touch.
          const theirs = lastTrucks[j].pose.pos;
          const a = lastTrucks[i].object.nearestBodyPoint?.(theirs[0], theirs[1], theirs[2]);
          const b = a && lastTrucks[j].object.nearestBodyPoint?.(a[0], a[1], a[2]);
          const c = b && lastTrucks[i].object.nearestBodyPoint?.(b[0], b[1], b[2]);
          if (c) at = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2];
          theirVel = per[j].vel;
          slide = Math.hypot(state.vel[0] - theirVel[0], state.vel[1] - theirVel[1], state.vel[2] - theirVel[2]);
        }
      }
      const underWater = !!rich && waterLevel !== null && weatherNow !== 5 && floorUnder(at[0], at[2], at[1]) < waterLevel && at[1] < waterLevel;
      const amount = sparkRules(sparkLevelOf(flags));
      if (amount.share > 0) {
        // Tires alone throw far fewer than bodywork.
        const share = (hull ? 1 : TIRE_SPARK_SHARE) * amount.share;
        const result = scrapeSparks(state.scrape.get(0) ?? 0, steps / 60, slide, Math.random, share, rich ? SPARK_MIN_SPEED : CLASSIC_SPARK_MIN_SPEED, amount.many && !rich);
        state.scrape.set(0, result.timer);
        if (rich && !underWater) {
          // Out from where the two meet, toward this truck: its own sparks.
          mine = lastTrucks[i]?.pose?.pos ?? at;
          const normal = [mine[0] - at[0], 0, mine[2] - at[2]];
          const struck = amount.many ? sparksForHit(force, slide) : burst(state, force, share);
          sparkShowerAt(at, result.sparks, { vel: state.vel, other: theirVel, normal, single: !amount.many });
          sparkShowerAt(at, struck, { vel: state.vel, other: theirVel, normal, hit: true, single: !amount.many });
        } else for (let n = 0; n < result.sparks + burst(state, force, share, amount.many); n++) spark(at[0], at[1], at[2], 14, 8, state.vel, underWater ? "bubble" : "spark");
      }
      if (!underWater) this._contactSmoke(state, at, steps, flags, force, slide);
    },
    /** The ruts (render/tire-tracks.js), with "Rich particles": for tests in the browser. */
    ruts,
    /** Press truck `i`'s body, `{ object }` (its `hullPoint`s), into the snow (`pressBody`): for tests in the browser. */
    pressBody: (i, t) => per[i] && ruts && pressBody(per[i], t),
    dispose() {
      particles?.dispose();
      ruts?.dispose();
      scene.remove(root);
      root.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) { m.map?.dispose?.(); m.dispose?.(); } });
      for (const list of frames) for (const m of list) { m?.map?.dispose(); m?.dispose(); }
    },
  };
}
