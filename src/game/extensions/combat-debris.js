/*
  Combat's debris (docs/EXTENSIONS.md): the bits a hit tears off. From one impact, a seeded set of shards: the harder
  the hit, the more of them, the faster, and a few bigger, up to `DEBRIS.most`. Mostly small grey bits of metal in
  several shades, some flecks of the body's paint and of glass. The same impact always gives the same shards, so a hit looks the same however often it is drawn. The shards
  only fly and settle on the ground (render/extensions/combat-scene.js); nothing hits them. Pure, so it runs under Node.
*/

/**
 * The figures: hit points taken (`force`) under `least` throw nothing; `perHp` shards per hit point after that, at most
 * `most`; sizes from `sizeFt` growing by `sizeGrow` per 100 hit points; speeds from `speedFtS`, faster by `speedGrow`
 * per 100; each lives `lifeS` seconds.
 */
export const DEBRIS = Object.freeze({
  least: 8, perHp: 0.5, most: 120, sizeFt: [0.08, 0.3], sizeGrow: 0.12, speedFtS: [10, 35], speedGrow: 12, lifeS: [5, 9],
});
/** The kinds of shard and how often each comes: grey metal, the body's paint, glass. */
export const SHARD_KINDS = Object.freeze([["metal", 0.7], ["body", 0.2], ["glass", 0.1]]);

/** A small seeded random generator (mulberry32): the same seed, the same numbers. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many shards a hit taking `force` hit points throws. */
export function debrisCount(force, T = DEBRIS) {
  if (!(force > T.least)) return 0;
  return Math.min(T.most, Math.round((force - T.least) * T.perHp) + 2);
}

/**
 * The shards of one impact: `pos` where (world feet), `normal` the way out from the struck body (world, any length),
 * `vel` the truck's velocity (world ft/s), `force` the hit points taken, `seed` the impact's own number. Each shard is
 * `{ pos, vel, spin: [x, y, z] rad/s, size: [w, h], kind, shade, life }` (`shade` a metal's grey, 0 to 1).
 */
export function debrisShards({ pos, normal = [0, 1, 0], vel = [0, 0, 0], force, seed }, T = DEBRIS) {
  const count = debrisCount(force, T);
  const rand = seeded(seed);
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n = [normal[0] / len, normal[1] / len, normal[2] / len];
  const grow = Math.max(0, force) / 100;
  const out = [];
  for (let k = 0; k < count; k++) {
    // Out from the body in a wide cone, and up.
    const spread = () => (rand() - 0.5) * 1.6;
    const dir = [n[0] + spread(), n[1] + 0.4 + rand() * 0.8, n[2] + spread()];
    const d = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const speed = T.speedFtS[0] + rand() * (T.speedFtS[1] - T.speedFtS[0]) + T.speedGrow * grow * rand();
    // Most are small; one in eight is a bigger piece.
    const big = rand() < 0.125 ? 2 : 1;
    const size = (T.sizeFt[0] + rand() * (T.sizeFt[1] - T.sizeFt[0]) * (1 + T.sizeGrow * grow)) * big;
    // A grey's shade, from dark to light, for the metal.
    const shade = 0.18 + rand() * 0.42;
    let pick = rand(), kind = SHARD_KINDS[0][0];
    for (const [name, share] of SHARD_KINDS) { if (pick < share) { kind = name; break; } pick -= share; }
    out.push({
      pos: [pos[0] + (rand() - 0.5), pos[1] + (rand() - 0.5) * 0.5, pos[2] + (rand() - 0.5)],
      vel: [vel[0] * 0.6 + (dir[0] / d) * speed, vel[1] * 0.3 + (dir[1] / d) * speed, vel[2] * 0.6 + (dir[2] / d) * speed],
      spin: [(rand() - 0.5) * 24, (rand() - 0.5) * 24, (rand() - 0.5) * 24],
      size: [size, size * (0.3 + rand() * 0.7)],
      kind: kind === "glass" && size > 0.3 ? "metal" : kind, shade,
      life: T.lifeS[0] + rand() * (T.lifeS[1] - T.lifeS[0]),
    });
  }
  return out;
}

/** One step of a shard's flight (`dt` s) over the ground at height `floor`: it falls, bounces once or twice and lies still. */
export function stepShard(shard, dt, floor) {
  if (shard.still) { shard.life -= dt; return; }
  shard.vel[1] -= 32.2 * dt;
  for (let k = 0; k < 3; k++) shard.pos[k] += shard.vel[k] * dt;
  shard.life -= dt;
  if (shard.pos[1] < floor + 0.05) {
    shard.pos[1] = floor + 0.05;
    if (Math.abs(shard.vel[1]) < 4) { shard.still = true; shard.vel = [0, 0, 0]; shard.spin = [0, 0, 0]; return; }
    shard.vel = [shard.vel[0] * 0.45, Math.abs(shard.vel[1]) * 0.3, shard.vel[2] * 0.45];
    shard.spin = shard.spin.map((s) => s * 0.5);
  }
}
