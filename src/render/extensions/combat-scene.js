/*
  What Combat draws as the race runs (docs/EXTENSIONS.md), from the runtime's view (game/extensions/combat-session.js):

  - each truck's lost wheels hidden, and a hurt wheel wobbling on its hub;
  - the loose wheels where the simulation has them (they are objects the trucks hit);
  - a shock and a piece of axle bar flying off when a wheel comes off, with a flash at the hub;
  - a wreck's torn-off axle (game/extensions/combat.js `wreckShed`, `axlesLost`): gone from the truck with its bars,
    shocks and shaft, and thrown with them;
  - debris torn off by every hit, more and bigger the harder it was (game/extensions/combat-debris.js);
  - sparks, plenty of them, with every hit and from a bare axle end dragging on the ground (the race's own sparks,
    render/tire-effects.js);
  - smoke from a hurt engine, grey then black, with flames near the end, and a column of smoke over a wreck.

  None of it is in a replay. Only rendering modules import three.js.
*/
import * as THREE from "three";
import { toSceneMatrix } from "../../shared/scene-frame.js";
import { debrisShards, seeded, stepShard } from "../../game/extensions/combat-debris.js";
import { axlesLost } from "../../game/extensions/combat.js";

/** Most debris shards, smoke puffs and flying parts drawn at once. */
const MOST_SHARDS = 700, MOST_PUFFS = 160, MOST_PARTS = 24;
/** A hurt wheel wobbles under this share of its hit points; the engine smokes under these. */
const WOBBLE_UNDER = 0.4, SMOKE_GREY = 0.5, SMOKE_BLACK = 0.2, FLAMES = 0.06;
/** Seconds a wreck smokes, and a flying part lies before it goes. */
const WRECK_SMOKE_S = 25, PART_LIFE_S = 30;

/** A soft round puff, drawn once. */
function puffTexture() {
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(64, 64) : Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const g = canvas.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.5)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A truck's paint for its debris, by its number: muted, as paint chips are. */
const bodyColour = (i) => new THREE.Color().setHSL(((i * 0.137) + 0.02) % 1, 0.4, 0.38);

export function createCombatScene(scene) {
  const root = new THREE.Group();
  root.name = "combat";
  scene.add(root);
  const texture = puffTexture();

  // ---- Debris: one instanced mesh of small flat shards ----
  const shardGeometry = new THREE.PlaneGeometry(1, 1);
  const shardMaterial = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  const shardMesh = new THREE.InstancedMesh(shardGeometry, shardMaterial, MOST_SHARDS);
  shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shardMesh.frustumCulled = false;
  shardMesh.count = 0;
  root.add(shardMesh);
  const shards = [];
  const glass = new THREE.Color(0xbfd8e8);

  // ---- Smoke and flames: pooled sprites ----
  const puffs = [];
  const freeSprites = [];
  const spriteOf = () => {
    const sprite = freeSprites.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.visible = true;
    root.add(sprite);
    return sprite;
  };
  /** A puff at `pos` (drawn space, game feet): smoke rises and spreads; a flame is brief, bright and additive. */
  const puff = (pos, { colour, size = 3, grow = 4, rise = 6, life = 2.5, opacity = 0.7, flame = false }) => {
    if (puffs.length >= MOST_PUFFS) { const old = puffs.shift(); old.sprite.visible = false; root.remove(old.sprite); freeSprites.push(old.sprite); }
    const sprite = spriteOf();
    sprite.material.color.set(colour);
    sprite.material.blending = flame ? THREE.AdditiveBlending : THREE.NormalBlending;
    sprite.material.needsUpdate = true;
    puffs.push({ sprite, pos: [...pos], size, grow, rise, life, age: 0, opacity, drift: [(Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2] });
  };

  // ---- Flying parts (shocks and axle bars) and flashes ----
  const partMaterial = new THREE.MeshLambertMaterial({ color: 0x3a3a3e });
  const shockGeometry = new THREE.CylinderGeometry(0.22, 0.22, 3.2, 8);
  shockGeometry.rotateZ(Math.PI / 2);
  const barGeometry = new THREE.BoxGeometry(4.5, 0.4, 0.4);
  // A whole axle beam, as wide as a truck's track, and its differential.
  const axleGeometry = new THREE.CylinderGeometry(0.35, 0.35, 8.5, 10);
  axleGeometry.rotateZ(Math.PI / 2);
  const diffGeometry = new THREE.SphereGeometry(0.9, 10, 8);
  const parts = [];
  const flashes = [];
  const flashMaterial = () => new THREE.SpriteMaterial({ map: texture, color: 0xfff1c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  // ---- Loose wheels ----
  const loose = new Map();

  let seenHits = 0, seenEvents = 0, clock = 0, effectsNow = null, flagsNow = null;
  const wrecks = new Map();
  const engineTimers = [];
  const dummy = new THREE.Object3D();

  /** Throw debris for one hit (world feet in drawn space). */
  const throwDebris = (hit, pos, normal) => {
    const colour = bodyColour(hit.truck);
    for (const shard of debrisShards({ pos, normal, vel: hit.vel ?? [0, 0, 0], force: hit.force, seed: (hit.id * 2654435761) >>> 0 })) {
      if (shards.length >= MOST_SHARDS) shards.shift();
      shard.colour = shard.kind === "glass" ? glass : shard.kind === "metal" ? new THREE.Color(shard.shade, shard.shade, shard.shade * 1.05) : colour;
      shard.angle = [0, 0, 0];
      shards.push(shard);
    }
  };
  /** A wheel came off: a flash, a shock and a piece of axle bar, and a burst of debris. */
  const wheelOff = (pos, seed, truck) => {
    const rand = seeded(seed);
    const sprite = new THREE.Sprite(flashMaterial());
    sprite.position.set(pos[0], pos[1], -pos[2]);
    root.add(sprite);
    flashes.push({ sprite, age: 0 });
    for (const geometry of [shockGeometry, barGeometry]) {
      if (parts.length >= MOST_PARTS) { const old = parts.shift(); root.remove(old.mesh); }
      const mesh = new THREE.Mesh(geometry, partMaterial);
      mesh.castShadow = true;
      root.add(mesh);
      parts.push({
        mesh, pos: [pos[0], pos[1] + 0.5, pos[2]], vel: [(rand() - 0.5) * 30, 14 + rand() * 14, (rand() - 0.5) * 30],
        spin: [(rand() - 0.5) * 14, (rand() - 0.5) * 14, (rand() - 0.5) * 14], angle: [0, 0, 0], life: PART_LIFE_S,
      });
    }
    throwDebris({ id: seed, truck, force: 160, vel: [0, 0, 0] }, pos, [0, 1, 0]);
    effectsNow?.touch?.(truck, pos, 40, 6000, 60, flagsNow, true);
  };

  /** A part thrown from `pos` (drawn space), tumbling. */
  const throwPart = (geometry, pos, rand, up = 14) => {
    if (parts.length >= MOST_PARTS) { const old = parts.shift(); root.remove(old.mesh); }
    const mesh = new THREE.Mesh(geometry, partMaterial);
    mesh.castShadow = true;
    root.add(mesh);
    parts.push({
      mesh, pos: [pos[0], pos[1] + 0.5, pos[2]], vel: [(rand() - 0.5) * 30, up + rand() * 14, (rand() - 0.5) * 30],
      spin: [(rand() - 0.5) * 14, (rand() - 0.5) * 14, (rand() - 0.5) * 14], angle: [0, 0, 0], life: PART_LIFE_S,
    });
  };
  /** Each truck's axles as last drawn: lost or not. */
  const axlesShown = new Map();
  /** A wreck tore an axle off: the beam, its differential, its bars and shocks thrown, a flash and debris. */
  const axleOff = (pos, seed, truck) => {
    const rand = seeded(seed);
    const sprite = new THREE.Sprite(flashMaterial());
    sprite.position.set(pos[0], pos[1], -pos[2]);
    root.add(sprite);
    flashes.push({ sprite, age: 0, big: true });
    for (const geometry of [axleGeometry, diffGeometry, barGeometry, barGeometry, shockGeometry, shockGeometry]) throwPart(geometry, pos, rand, 18);
    throwDebris({ id: seed, truck, force: 220, vel: [0, 0, 0] }, pos, [0, 1, 0]);
    effectsNow?.touch?.(truck, pos, 60, 8000, 70, flagsNow, true);
  };

  return {
    /**
     * One frame. `state` is the runtime's view; `poses` the trucks as drawn (`pos`, `matrix`); `drawn` their objects
     * (`setTire`, `tireModel`); `effects` the race's tire effects (its sparks); `near(pos)` the drawn copy of a world
     * point; `floorAt(x, z, y)` the ground under a point.
     */
    update({ state, poses, drawn, dt, effects, flags, near, floorAt }) {
      if (!state || state.mode !== "combat" || !poses) return;
      clock += dt;
      effectsNow = effects;
      flagsNow = flags;
      // Lost wheels hidden, hurt ones wobbling; a wreck's torn-off axle gone, and thrown the moment it goes.
      state.trucks.forEach((truck, i) => {
        for (let w = 0; w < 4; w++) {
          const share = truck.wheels[w];
          drawn[i]?.setTire?.(w, { hidden: share < 0, wobble: share >= 0 && share < WOBBLE_UNDER ? 1 - share / WOBBLE_UNDER : 0 });
        }
        const lost = axlesLost(truck), shown = axlesShown.get(i) ?? [false, false];
        lost.forEach((gone, k) => {
          drawn[i]?.setAxle?.(k, { hidden: gone });
          const pose = poses[i];
          if (gone && !shown[k] && pose) {
            // The axle's middle: along the body's z to its hubs (about 6 ft each way), a little under the origin.
            const m = pose.matrix, z = k === 0 ? 6 : -6;
            axleOff(near([pose.pos[0] + m[1] * -2 + m[2] * z, pose.pos[1] + m[4] * -2 + m[5] * z, pose.pos[2] + m[7] * -2 + m[8] * z]), i * 977 + k * 31 + 5, i);
          }
        });
        axlesShown.set(i, lost);
      });
      // New hits: their debris.
      for (const hit of state.hits ?? []) {
        if (hit.id <= seenHits) continue;
        seenHits = hit.id;
        const at = near(hit.pos);
        throwDebris(hit, at, hit.normal);
        // A burst of sparks with every hit, the harder the more.
        const speed = Math.hypot(...(hit.vel ?? [0, 0, 0]));
        effects?.touch?.(hit.truck, at, Math.min(40, 4 + Math.round(hit.force / 6)), 900 + hit.force * 30, Math.max(speed, 40), flags, true);
      }
      // New events: a wheel off (from the loose wheel's place), a wreck's smoke.
      for (const e of state.log ?? []) {
        if (e.id <= seenEvents) continue;
        seenEvents = e.id;
        const pose = poses[e.truck];
        if (e.kind === "wheel") {
          const l = [...(state.loose ?? [])].reverse().find((x) => x.truck === e.truck && x.wheel === e.wheel);
          wheelOff(l ? near(l.pos) : pose?.pos ?? [0, 0, 0], e.id * 97 + 13, e.truck);
        } else if (e.kind === "wreck" && pose) {
          wrecks.set(e.truck, clock);
          throwDebris({ id: e.id * 131 + 7, truck: e.truck, force: 260, vel: [0, 0, 0] }, pose.pos, [0, 1, 0]);
          for (let n = 0; n < 6; n++) puff(pose.pos, { colour: 0x8a7a66, size: 6, grow: 10, rise: 3, life: 3, opacity: 0.6 });
        }
      }
      // Loose wheels, where the simulation has them.
      const live = new Set();
      for (const l of state.loose ?? []) {
        live.add(l.id);
        let object = loose.get(l.id);
        if (!object) {
          object = drawn[l.truck]?.tireModel?.(l.wheel) ?? new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1.5, 12).rotateZ(Math.PI / 2), partMaterial);
          object.matrixAutoUpdate = false;
          object.traverse((o) => { o.castShadow = true; });
          root.add(object);
          loose.set(l.id, object);
        }
        object.matrix.fromArray(toSceneMatrix(l.matrix, near(l.pos)));
        object.matrixWorldNeedsUpdate = true;
      }
      for (const [id, object] of loose) if (!live.has(id)) { root.remove(object); loose.delete(id); }
      // A bare axle end dragging: sparks, six times what a scraping hull throws, and its smoke.
      for (const stub of state.stubs ?? []) {
        if (stub.speed < 3 || !dt) continue;
        const steps = Math.max(1, Math.round(dt * 60 * 6));
        effects?.touch?.(stub.truck, near(stub.pos), steps, 400 + stub.speed * 20, stub.speed, flags, true);
      }
      // A hurt engine smokes from under its hood; a wreck smokes on.
      state.trucks.forEach((truck, i) => {
        const pose = poses[i];
        if (!pose || !dt) return;
        const m = pose.matrix;
        const hood = [pose.pos[0] + m[1] * 2.5 + m[2] * 5, pose.pos[1] + m[4] * 2.5 + m[5] * 5, pose.pos[2] + m[7] * 2.5 + m[8] * 5];
        const since = wrecks.get(i);
        const smoking = truck.wrecked || truck.engine < SMOKE_GREY;
        if (!smoking) return;
        engineTimers[i] = (engineTimers[i] ?? 0) + dt;
        const every = truck.wrecked ? 0.12 : truck.engine < SMOKE_BLACK ? 0.15 : 0.3;
        if (engineTimers[i] < every) return;
        engineTimers[i] = 0;
        const black = truck.wrecked || truck.engine < SMOKE_BLACK;
        if (!truck.wrecked || (since !== undefined && clock - since < WRECK_SMOKE_S)) {
          puff(hood, { colour: black ? 0x1c1a19 : 0x9a9a9a, size: black ? 3 : 2.2, grow: truck.wrecked ? 9 : 5, rise: truck.wrecked ? 12 : 7, life: truck.wrecked ? 4 : 2.2, opacity: black ? 0.75 : 0.5 });
        }
        if (truck.wrecked ? since !== undefined && clock - since < 8 : truck.engine < FLAMES) {
          puff(hood, { colour: 0xff7a1a, size: 1.6, grow: 1.5, rise: 5, life: 0.45, opacity: 0.9, flame: true });
        }
      });
      // Debris flies, settles and fades.
      let n = 0;
      for (let k = shards.length - 1; k >= 0; k--) {
        const shard = shards[k];
        stepShard(shard, dt, floorAt(shard.pos[0], shard.pos[2], shard.pos[1]));
        if (shard.life <= 0) { shards.splice(k, 1); continue; }
      }
      for (const shard of shards) {
        for (let a = 0; a < 3; a++) shard.angle[a] += shard.spin[a] * dt;
        const fade = Math.min(1, shard.life);
        dummy.position.set(shard.pos[0], shard.pos[1], -shard.pos[2]);
        dummy.rotation.set(shard.angle[0], shard.angle[1], shard.angle[2]);
        dummy.scale.set(shard.size[0] * fade, shard.size[1] * fade, 1);
        dummy.updateMatrix();
        shardMesh.setMatrixAt(n, dummy.matrix);
        shardMesh.setColorAt(n, shard.colour);
        n++;
      }
      shardMesh.count = n;
      shardMesh.instanceMatrix.needsUpdate = true;
      if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
      // Flying parts tumble and lie.
      for (let k = parts.length - 1; k >= 0; k--) {
        const part = parts[k];
        stepShard(part, dt, floorAt(part.pos[0], part.pos[2], part.pos[1]) + 0.2);
        if (part.life <= 0) { root.remove(part.mesh); parts.splice(k, 1); continue; }
        for (let a = 0; a < 3; a++) part.angle[a] += part.spin[a] * dt;
        part.mesh.position.set(part.pos[0], part.pos[1], -part.pos[2]);
        part.mesh.rotation.set(part.angle[0], part.angle[1], part.angle[2]);
      }
      // Flashes and puffs.
      for (let k = flashes.length - 1; k >= 0; k--) {
        const f = flashes[k];
        f.age += dt;
        const s = (3 + f.age * 40) * (f.big ? 2 : 1);
        f.sprite.scale.set(s, s, 1);
        f.sprite.material.opacity = Math.max(0, 1 - f.age / 0.3);
        if (f.age > 0.3) { root.remove(f.sprite); f.sprite.material.dispose(); flashes.splice(k, 1); }
      }
      for (let k = puffs.length - 1; k >= 0; k--) {
        const p = puffs[k];
        p.age += dt;
        if (p.age >= p.life) { p.sprite.visible = false; root.remove(p.sprite); freeSprites.push(p.sprite); puffs.splice(k, 1); continue; }
        const t = p.age / p.life;
        p.pos[0] += p.drift[0] * dt; p.pos[1] += p.rise * dt * (1 - t * 0.5); p.pos[2] += p.drift[1] * dt;
        const s = p.size + p.grow * t;
        p.sprite.position.set(p.pos[0], p.pos[1], -p.pos[2]);
        p.sprite.scale.set(s, s, 1);
        p.sprite.material.opacity = p.opacity * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      }
    },
    dispose() {
      scene.remove(root);
      shardGeometry.dispose(); shardMaterial.dispose(); shardMesh.dispose();
      shockGeometry.dispose(); barGeometry.dispose(); axleGeometry.dispose(); diffGeometry.dispose(); partMaterial.dispose();
      for (const p of puffs) p.sprite.material.dispose();
      for (const s of freeSprites) s.material.dispose();
      for (const f of flashes) f.sprite.material.dispose();
      texture.dispose();
    },
  };
}
