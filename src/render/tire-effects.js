/*
  Dust puffs, tire tracks and sparks (game/tire-effects.js has the rules).
  - Puffs: a pool of 96 camera-facing sprites that run through the twelve frames of PUFF2 or PUFF3, added to the view.
  - Tracks: a ring of ribbons laid on the ground behind each tire on soft ground, textured with TREAD.RAW.
  - Sparks: a pool of bright points thrown from hull contacts, falling under gravity.
*/
import * as THREE from "three";
import {
  CONTACT_GAP_S, DUST_RANGE_FT, DUST_TICK_S, TRACK_RANGE_FT, SMOKE_AFTER_S, SMOKE_EVERY_S, PUFF_FRAMES, PUFF_POOL, SPARK_POOL, TRACK_BREAK_FT, TRACK_LIFE_S, TRACK_POOL, TRACK_STEP_FT, TRACK_WIDTH_FT,
  dustPuffs, keepsTread, puffFrame, puffLife, puffSize, puffsForHit, raisesDust, scrapeSparks, sparksForHit, trackOpacity,
} from "../game/tire-effects.js";

const GRAVITY = 32.2, DROP_POOL = 1600;
const flatTexture = ({ rgba, width, height }, repeat = false) => {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

/** A puff frame as tinted dust: the art's brightness becomes its opacity (at most 0.5), the colour a dull brown. */
function dustPrint(art, [r, g, b] = [128, 112, 92], top = 128) {
  const out = new Uint8ClampedArray(art.rgba.length);
  for (let i = 0; i < art.rgba.length; i += 4) {
    const lum = Math.max(art.rgba[i], art.rgba[i + 1], art.rgba[i + 2]);
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

/**
 * @param {{ scene: THREE.Scene, art: object|null, ground: (x: number, z: number) => number, count: number, random?: () => number }} options
 *   `ground` is the terrain's height in game feet; `art` the effects art (worker/effects-art.js).
 */
export function createTireEffects({ scene, art, ground, count, random = Math.random }) {
  const root = new THREE.Group();
  root.name = "tire-effects";
  scene.add(root);

  // Puffs.
  // The puff art is grey on black; it is drawn as a soft brown dust, clear where the art is black, not added to the view.
  // Kinds 0 and 1 are dust, 2 and 3 the dark grey smoke of a collision (denser).
  const tints = [[[128, 112, 92], 128], [[54, 54, 58], 110]];
  const frames = tints.flatMap(([tint, top]) => [art?.puff2, art?.puff3].map((list) => (list ?? []).map((image) => image && new THREE.SpriteMaterial({
    map: flatTexture(dustPrint(image, tint, top)), transparent: true, depthWrite: false, opacity: 0.7,
  }))));
  const puffs = Array.from({ length: PUFF_POOL }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
    sprite.visible = false;
    sprite.renderOrder = 3;
    sprite.userData = { age: 0, life: 0, size: 0, kind: 0, live: false };
    root.add(sprite);
    return sprite;
  });
  /** Dust from a wheel starts 2.8 times the game's size, swells by 14 ft and lives 2.2 times as long; the smoke of a hit starts 3 times and swells by 10. */
  function puff(x, y, z, smoke = false) {
    if (!frames[0].length) return;
    const sprite = puffs.find((p) => !p.userData.live);
    if (!sprite) return;
    const scale = smoke ? 3 : 2.8, growth = smoke ? 10 : 14;
    Object.assign(sprite.userData, {
      age: 0, life: puffLife(random()) * (smoke ? 1.6 : 2.2), size: puffSize(random()) * scale, growth,
      kind: (smoke ? 2 : 0) + (random() < 0.5 ? 0 : 1), live: true,
    });
    sprite.position.set(x, y + 0.5, -z);
    sprite.visible = true;
  }

  // Tracks: TRACK_POOL quads in one dynamic geometry, written round like a ring.
  const trackPositions = new Float32Array(TRACK_POOL * 12), trackUvs = new Float32Array(TRACK_POOL * 8), trackColors = new Float32Array(TRACK_POOL * 16);
  const trackBorn = new Float64Array(TRACK_POOL).fill(-1e9);
  const trackGeometry = new THREE.BufferGeometry();
  trackGeometry.setAttribute("position", new THREE.BufferAttribute(trackPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trackGeometry.setAttribute("uv", new THREE.BufferAttribute(trackUvs, 2));
  trackGeometry.setAttribute("color", new THREE.BufferAttribute(trackColors, 4).setUsage(THREE.DynamicDrawUsage));
  trackGeometry.setIndex(Array.from({ length: TRACK_POOL }, (_, q) => [q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3]).flat());
  const tracksMesh = new THREE.Mesh(trackGeometry, new THREE.MeshBasicMaterial({
    map: art?.tread ? flatTexture(treadPrint(art.tread), true) : null, vertexColors: true, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  tracksMesh.frustumCulled = false;
  // First of the see-through things: dust, smoke, drops and sparks are drawn over the tracks, not under them.
  tracksMesh.renderOrder = 0;
  root.add(tracksMesh);
  let trackHead = 0, clock = 0, frameDt = 1 / 60;

  // Sparks.
  const sparkPositions = new Float32Array(SPARK_POOL * 3), sparkColors = new Float32Array(SPARK_POOL * 3);
  const sparks = Array.from({ length: SPARK_POOL }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 }));
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute("color", new THREE.BufferAttribute(sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
  const sparkPoints = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({
    size: 0.22, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, sizeAttenuation: true, fog: false,
  }));
  sparkPoints.frustumCulled = false;
  sparkPoints.renderOrder = 3;
  root.add(sparkPoints);
  function spark(x, y, z, speed, up = 6) {
    // No sparks under water.
    if (waterLevel !== null && y < waterLevel) return;
    const s = sparks.find((p) => p.life <= 0);
    if (!s) return;
    const a = random() * Math.PI * 2, v = speed * (0.4 + random() * 0.8);
    Object.assign(s, { x, y, z, vx: Math.cos(a) * v, vy: up * (0.3 + random()), vz: Math.sin(a) * v, life: 0.35 + random() * 0.5, max: 0.85 });
  }

  // Water drops: small points thrown up and out where a wheel runs through water, more and higher the faster the truck.
  const dropPositions = new Float32Array(DROP_POOL * 3);
  const drops = Array.from({ length: DROP_POOL }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
  const dropGeometry = new THREE.BufferGeometry();
  dropGeometry.setAttribute("position", new THREE.BufferAttribute(dropPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const dropPoints = new THREE.Points(dropGeometry, new THREE.PointsMaterial({
    size: 0.3, color: 0xd6ebff, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true,
  }));
  dropPoints.frustumCulled = false;
  dropPoints.renderOrder = 3;
  root.add(dropPoints);
  let waterLevel = null;
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

  const per = Array.from({ length: count }, () => ({ contact: 0, sinceContact: 9, smokeTimer: 0, wet: [false, false, false, false], waterTimer: 0, timer: 0, last: [null, null, null, null], strip: [0, 0, 0, 0], scrape: new Map() }));

  /** A quad of track between two contact points, one tire's width across. */
  function mark(i, tire, x, z, travelled) {
    const state = per[i], last = state.last[tire];
    state.last[tire] = [x, z];
    if (!last) return;
    const dx = x - last[0], dz = z - last[1], length = Math.hypot(dx, dz);
    if (length < TRACK_STEP_FT || length > TRACK_BREAK_FT) { if (length > TRACK_BREAK_FT) state.last[tire] = [x, z]; else state.last[tire] = last; return; }
    const nx = (-dz / length) * (TRACK_WIDTH_FT / 2), nz = (dx / length) * (TRACK_WIDTH_FT / 2);
    const q = trackHead;
    trackHead = (trackHead + 1) % TRACK_POOL;
    const corners = [[last[0] - nx, last[1] - nz], [last[0] + nx, last[1] + nz], [x + nx, z + nz], [x - nx, z - nz]];
    corners.forEach(([cx, cz], k) => trackPositions.set([cx, ground(cx, cz) + 0.07, -cz], (q * 4 + k) * 3));
    const v0 = state.strip[tire], v1 = v0 + length / 4;
    state.strip[tire] = v1;
    trackUvs.set([0, v0, 1, v0, 1, v1, 0, v1], q * 8);
    trackBorn[q] = clock;
    for (let k = 0; k < 4; k++) trackColors.set([1, 1, 1, 1], (q * 4 + k) * 4);
    trackGeometry.attributes.position.needsUpdate = true;
    trackGeometry.attributes.uv.needsUpdate = true;
  }

  return {
    /**
     * Per frame. `trucks[i]` is `{ object, pose, surface: { family, type } | null }` (the truck's drawn object and
     * pose, and what it drives on); `flags` `{ dust, tracks, sparks }`; `noDust` for Rain and Snow (the game raises none).
     */
    update({ dt, listener, flags, noDust = false, trucks }) {
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
          hubs.forEach((hub, k) => { if (onGround[k]) mark(i, k, hub[0], hub[2]); else state.last[k] = null; });
        } else state.last.fill(null);
        // Water drops: a wheel in water throws them (every tick, more with speed); a wheel meeting the water at speed throws a burst.
        const speed = Math.hypot(t.pose.speed ?? 0), yaw = t.pose.euler?.[2] ?? 0, forward = [Math.sin(yaw), Math.cos(yaw)];
        const wetNow = hubs.map((hub) => waterLevel !== null && ground(hub[0], hub[2]) < waterLevel && hub[1] - waterLevel < 5);
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
              puff(hubs[k][0] + (random() - 0.5), ground(hubs[k][0], hubs[k][2]), hubs[k][2] + (random() - 0.5));
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
        if (!material) { u.live = false; sprite.visible = false; continue; }
        sprite.material = material;
        const size = (u.size + Math.min(1, u.age / u.life) * u.growth) * 2;
        sprite.scale.set(size, size, 1);
      }
      // Tracks fade by age.
      const colors = trackGeometry.attributes.color;
      for (let q = 0; q < TRACK_POOL; q++) {
        if (trackBorn[q] < -1e8) continue;
        const a = trackOpacity(clock - trackBorn[q]);
        if (trackColors[q * 16 + 3] === a) continue;
        for (let k = 0; k < 4; k++) trackColors[(q * 4 + k) * 4 + 3] = a;
        colors.needsUpdate = true;
      }
      // Drops fly and fall back into the water.
      let wet = false;
      drops.forEach((d, n) => {
        if (d.life > 0) {
          d.life -= dt;
          d.vy -= GRAVITY * dt;
          d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
          if (d.y < (waterLevel ?? -1e9) || d.y < ground(d.x, d.z)) d.life = 0;
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
          const floor = ground(s.x, s.z);
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
      const where = object.hullPoint(zone);
      if (!where || !per[i]) return;
      const state = per[i];
      if (flags.sparks) {
        const result = scrapeSparks(state.scrape.get(zone) ?? 0, steps / 60, speedFtS);
        state.scrape.set(zone, result.timer);
        for (let n = 0; n < result.sparks + sparksForHit(force); n++) spark(where[0], where[1], where[2], 14, 8);
      }
      this._contactSmoke(state, where, steps, flags, force);
    },
    /** Dark smoke from a hull contact that has gone on for a second, a puff every fifth of a second after. */
    _contactSmoke(state, where, steps, flags, force = 0) {
      state.sinceContact = 0;
      // Real time in contact, counted once a frame however many zones or steps report it.
      if (state.stamp !== clock) { state.stamp = clock; state.contact += frameDt; state.smokeTimer += frameDt; }
      if (!flags.dust) return;
      // A hard hit smokes at once; a lasting contact keeps smoking after a moment.
      if (force >= 900 && clock - (state.lastHitSmoke ?? -9) > 0.5) { state.lastHitSmoke = clock; puff(where[0], where[1] - 0.5, where[2], true); puff(where[0], where[1] - 0.2, where[2], true); }
      if (state.contact < SMOKE_AFTER_S) return;
      if (state.smokeTimer >= SMOKE_EVERY_S) { state.smokeTimer %= SMOKE_EVERY_S; puff(where[0], where[1] - 0.5, where[2], true); }
    },
    /** The water's level now in game feet (the bob included), or null on a track without water. */
    setWater(level) { waterLevel = level ?? null; },
    /** Truck `i` met another truck at `where` (game feet) this frame: sparks while they scrape at speed, a burst and dust on a hard hit. */
    touch(i, where, steps, force, speedFtS, flags) {
      if (!per[i]) return;
      const state = per[i];
      if (flags.sparks) {
        const result = scrapeSparks(state.scrape.get(0) ?? 0, steps / 60, speedFtS);
        state.scrape.set(0, result.timer);
        for (let n = 0; n < result.sparks + sparksForHit(force); n++) spark(where[0], where[1], where[2], 14, 8);
      }
      this._contactSmoke(state, where, steps, flags, force);
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) { m.map?.dispose?.(); m.dispose?.(); } });
      for (const list of frames) for (const m of list) { m?.map?.dispose(); m?.dispose(); }
    },
  };
}
