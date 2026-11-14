/*
  Deathmatch (docs/EXTENSIONS.md), an addition, not in the game: Combat's damage with no race. Wreck as many trucks as
  you can before the time runs out; the truck with the most wrecks wins.

  - **Damage** is Combat's (combat.js, combat-core.js): hit points, engine, gearbox, wheels, the rammer and its victim.
  - **Score.** A truck credited with the hit that wrecks another (Combat's rammer rule) scores a wreck. A truck wrecked
    with no truck credited (a landing, a wall, a roll) wrecked itself: it loses one. Places by score, then damage
    dealt, then the fewest times wrecked, then entry order.
  - **Respawn** (on by default): a wreck lies where it is for `RESPAWN.lieS`, then the truck is set down whole at a
    spawn spot, held `RESPAWN.holdS` and protected `RESPAWN.protectS` (it neither takes nor deals damage). Off, a
    wreck is out for good and the round also ends when one truck is left.
  - **Credits** only for attacking (`DM_REWARDS`); the Crash Damage key (X) spends them on Combat's repair, when
    repairs are on (off by default).
  - **Spawn spots** are spread over the track: along its course (circuits, rallies, drag strips), on its start slots
    (Summit Rumbles), or at random over the level (free roam, fly-by and any track without a course).
  Pure, so it runs under Node.
*/
import { msg } from "../strings.js";
import { coverOf, wanderPoint } from "./tag.js";
import { seeded } from "./combat-debris.js";
import { fromVehicles, localIndex, vehicleIndex } from "./net-wire.js";
import { TOUGHNESS } from "./combat.js";

/** The round's length by default, minutes. */
export const DEFAULT_DM_MINUTES = 5;
/** What earns credits: only damage dealt and wrecks. */
export const DM_REWARDS = Object.freeze({ checkpoint: 0, lap: 0, perHp: 1, wreck: 250 });
/** A wreck lies this long, then is set down, held, and protected (seconds); a spot this far from every truck is far enough (ft). */
export const RESPAWN = Object.freeze({ lieS: 5, holdS: 1, protectS: 3, farFt: 400 });
/**
 * The Helicopter key, when Options allow it: only for a truck stuck (under `slowFtS` for `stuckS`, or on its side or roof,
 * its up axis under `overUp`, for `overS`) that no one is attacking (no other truck has touched it for `peaceS`, and no
 * truck still in the fight is within `nearFt`). It sets the truck down on the nearest stretch of course, or where it is.
 */
export const HELI = Object.freeze({ slowFtS: 3, stuckS: 3, overUp: 0.5, overS: 2, peaceS: 5, nearFt: 80 });

/**
 * Why truck `me` may not call the helicopter, or null when it may: "off" (Options), "out" (wrecked or left), "moving"
 * (not stuck) or "attacked". `me` is `{ running, stillS, overS, lastTouchS, nearestFt }`: how long it has been still and
 * on its side or roof, how long since another truck touched it, how far the nearest truck still in the fight is.
 */
export function heliRefusal(allowed, me, T = HELI) {
  if (!allowed) return "off";
  if (!me.running) return "out";
  if (me.stillS < T.stuckS && me.overS < T.overS) return "moving";
  if (me.lastTouchS < T.peaceS || me.nearestFt < T.nearFt) return "attacked";
  return null;
}
/**
 * The spawn spots: every `stepFt` along a course; `randomCount` tried at random on a level with none, each on ground no
 * steeper than `maxSlope`, dry (`wetFt` over the water) and `boxClearFt` clear of an object; set down `rideFt` over the
 * ground; at most `most` of them.
 */
export const SPAWN = Object.freeze({ stepFt: 120, randomCount: 48, maxSlope: 0.6, wetFt: 1.5, boxClearFt: 15, rideFt: 6, most: 64, marginFt: 300 });
/** The retail terrain's side (256 cells of 32 ft; a track format version 6 world passes its own), and the margin kept from its edge. */
export const WORLD_FT = 256 * 32, EDGE_FT = 64;

export const DEATHMATCH_EXTENSION = Object.freeze({
  id: "deathmatch",
  name: msg("Deathmatch"),
  description: msg("Wreck as many trucks as you can before the time runs out: the most wrecks wins. Combat's damage, no race. A truck that wrecks itself loses a wreck. Credits for the damage you deal buy repairs, when they are on."),
  length: Object.freeze({ key: "minutes", label: msg("Minutes"), default: DEFAULT_DM_MINUTES, min: 1, max: 99 }),
  settings: Object.freeze([
    Object.freeze({ key: "minutes", label: msg("Minutes"), type: "number", min: 1, max: 99, default: DEFAULT_DM_MINUTES }),
    Object.freeze({
      key: "toughness", label: msg("Truck toughness"), type: "select", default: "normal",
      options: Object.freeze([
        Object.freeze({ value: "soft", label: msg("Soft: short fights") }),
        Object.freeze({ value: "normal", label: msg("Normal") }),
        Object.freeze({ value: "tough", label: msg("Tough: long fights") }),
      ]),
    }),
    Object.freeze({ key: "respawn", label: msg("Wrecked trucks come back"), type: "boolean", default: true }),
    Object.freeze({ key: "repairs", label: msg("Repair with X, with the credits earned by attacking"), type: "boolean", default: false }),
    // Only with repairs on: Options greys it out otherwise (`enabledBy`).
    Object.freeze({ key: "cpuRepairs", label: msg("Computer trucks repair themselves"), type: "boolean", default: true, enabledBy: "repairs" }),
    Object.freeze({ key: "helicopter", label: msg("Helicopter (H) when stuck and no one is attacking"), type: "boolean", default: false }),
    // Read by the race screen for any extension: off starts the race with the Names key's tags off (N still shows them).
    Object.freeze({ key: "names", label: msg("Names over the trucks"), type: "boolean", default: true }),
    Object.freeze({
      key: "aggression", label: msg("Computer trucks' aggression"), type: "select", default: "normal",
      options: Object.freeze([
        Object.freeze({ value: "low", label: msg("Low: they pick their fights") }),
        Object.freeze({ value: "normal", label: msg("Normal") }),
        Object.freeze({ value: "high", label: msg("High: they never back off") }),
      ]),
    }),
  ]),
  /** Any track: the spawn spots are spread over its course, its start slots or the level. */
  acceptsTrack: (track) => !!track,
  trackLocked: false,
  keepsRace: false,
  minEntrants: 2,
  teamPicker: null,
  /** The Crash Damage key repairs instead of switching damage, which is always on. */
  damageKey: "repair",
  /** A player who is out (respawn off, or left the fight) watches on. */
  watchWhenOut: true,
  /** Combat's damage, its scene and its labels (game/extensions/loader.js `usesCombatDamage`). */
  combatDamage: true,
});

/** A truck's score: its wrecks less the times it wrecked itself. */
export const scoreOf = (wrecks, selfWrecks) => (wrecks | 0) - (selfWrecks | 0);

/**
 * The places from each truck's `{ score, dealt, deaths }`: the highest score first, then the most damage dealt, then the
 * fewest times wrecked, then entry order.
 */
export function deathmatchPlaces(rows) {
  const order = rows.map((_, i) => i).sort((a, b) => (rows[b].score - rows[a].score) || (rows[b].dealt - rows[a].dealt)
    || (rows[a].deaths - rows[b].deaths) || (a - b));
  const places = new Array(rows.length);
  order.forEach((i, k) => { places[i] = k + 1; });
  return places;
}

/** Points every `stepFt` along a course's straights (`{ startFt, endFt }`, world ft), each with the straight's heading. */
export function coursePoints(course, stepFt = SPAWN.stepFt) {
  const out = [];
  for (const seg of course ?? []) {
    const a = seg?.startFt ?? seg?.start, b = seg?.endFt ?? seg?.end;
    if (!a || !b) continue;
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    if (!(length > 0)) continue;
    const heading = Math.atan2(dx, dz);
    const n = Math.max(1, Math.floor(length / stepFt));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      out.push({ pos: [a[0] + dx * u, a[1] + (b[1] - a[1]) * u, a[2] + dz * u], heading });
    }
  }
  return out;
}

/** A level box as a keep-out circle `{ pos, reach }` (`positionFt`, `sizeFt` or `bounds`), or null for one too small. */
export function keepOut(box) {
  const pos = box?.positionFt ?? box?.pos;
  if (!pos) return null;
  const size = box.sizeFt ?? (box.bounds ? [0, 1, 2].map((k) => box.bounds.max[k] - box.bounds.min[k]) : null);
  const reach = size ? Math.hypot(size[0], size[2]) / 2 : 0;
  return reach > 0 ? { pos, reach } : null;
}

/** The rectangle a level without a course is played on: its objects and start slots, with a margin; the whole terrain without them. */
export function levelRect(points, worldFt = WORLD_FT) {
  const inside = (points ?? []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[2]));
  const clamp = (v) => Math.max(EDGE_FT, Math.min(worldFt - EDGE_FT, v));
  if (inside.length < 2) return { minX: EDGE_FT, maxX: worldFt - EDGE_FT, minZ: EDGE_FT, maxZ: worldFt - EDGE_FT };
  const xs = inside.map((p) => p[0]), zs = inside.map((p) => p[2]);
  const rect = {
    minX: clamp(Math.min(...xs) - SPAWN.marginFt), maxX: clamp(Math.max(...xs) + SPAWN.marginFt),
    minZ: clamp(Math.min(...zs) - SPAWN.marginFt), maxZ: clamp(Math.max(...zs) + SPAWN.marginFt),
  };
  // A level whose objects stand close together is played on at least 1200 ft of it.
  for (const [lo, hi] of [["minX", "maxX"], ["minZ", "maxZ"]]) {
    if (rect[hi] - rect[lo] >= 1200) continue;
    const mid = (rect[lo] + rect[hi]) / 2;
    rect[lo] = clamp(mid - 600); rect[hi] = clamp(mid + 600);
  }
  return rect;
}

/**
 * Whether a spot suits a truck: ground no steeper than `SPAWN.maxSlope` across 16 ft, dry, and clear of every object.
 * `heightAt(x, z)` is the ground, `waterFt` the water level (null for none), `keepOuts` the objects (`keepOut`).
 */
export function goodSpot(p, heightAt, waterFt, keepOuts = []) {
  const h = heightAt(p[0], p[2]);
  if (!Number.isFinite(h)) return false;
  if (Number.isFinite(waterFt) && h < waterFt + SPAWN.wetFt) return false;
  const sx = (heightAt(p[0] + 8, p[2]) - heightAt(p[0] - 8, p[2])) / 16;
  const sz = (heightAt(p[0], p[2] + 8) - heightAt(p[0], p[2] - 8)) / 16;
  if (!(Math.hypot(sx, sz) <= SPAWN.maxSlope)) return false;
  return keepOuts.every((k) => Math.hypot(k.pos[0] - p[0], k.pos[2] - p[2]) > k.reach + SPAWN.boxClearFt);
}

/**
 * The spawn spots of a track (`{ pos, heading }`, set down `SPAWN.rideFt` over the ground), at most `SPAWN.most`, the
 * same on every machine for the same track. `kind` "course" spreads them along `course` (a circuit, a rally, a drag
 * strip's lanes), "slots" takes `slots` (a Summit Rumble's start slots), anything else picks them at random over
 * `levelRect` of `slots` and `boxes` (`seed` the dice). `heightAt(x, z, refY)` is the drivable ground (game/spawn-ground.js),
 * `refY` the height a course point runs at, undefined for a random point.
 */
export function spawnSpots({ kind, course = [], slots = [], boxes = [], heightAt, waterFt = null, seed = 1, worldFt = WORLD_FT }) {
  const keepOuts = boxes.map(keepOut).filter(Boolean);
  // A course point's height picks the surface it runs on (a street, not the deck over it); a random point has none, so
  // it takes the highest (game/spawn-ground.js).
  const at = (ref) => (x, z) => heightAt(x, z, ref);
  const ride = (p, heading, ref) => ({ pos: [p[0], heightAt(p[0], p[2], ref) + SPAWN.rideFt, p[2]], heading });
  const good = (p, ref) => goodSpot(p, at(ref), waterFt, keepOuts);
  let spots = [];
  if (kind === "course") {
    const along = coursePoints(course);
    spots = along.filter((s) => good(s.pos, s.pos[1])).map((s) => ride(s.pos, s.heading, s.pos[1]));
    if (spots.length < 2) spots = along.map((s) => ride(s.pos, s.heading, s.pos[1]));
  } else if (kind === "slots") {
    spots = slots.filter((s) => s?.pos).map((s) => ({ pos: [...s.pos], heading: s.heading ?? 0 }));
  }
  if (spots.length < 2) {
    const random = seeded(seed >>> 0 || 1);
    const rect = levelRect([...slots.map((s) => s?.pos), ...keepOuts.map((k) => k.pos)], worldFt);
    const tried = [];
    for (let k = 0; k < SPAWN.randomCount; k++) {
      const p = wanderPoint(rect, random);
      tried.push(p);
      if (good(p)) spots.push(ride(p, random() * Math.PI * 2));
    }
    if (spots.length < 2) spots = tried.map((p) => ride(p, random() * Math.PI * 2));
  }
  return thin(spots, SPAWN.most);
}

/** At most `most` of `spots`, spread as far apart as they go (farthest first from the first). */
export function thin(spots, most) {
  if (spots.length <= most) return spots;
  const out = [spots[0]];
  const near = spots.map((s) => Math.hypot(s.pos[0] - spots[0].pos[0], s.pos[2] - spots[0].pos[2]));
  while (out.length < most) {
    let best = -1;
    near.forEach((d, i) => { if (best < 0 || d > near[best]) best = i; });
    out.push(spots[best]);
    const p = spots[best].pos;
    near.forEach((d, i) => { near[i] = Math.min(d, Math.hypot(spots[i].pos[0] - p[0], spots[i].pos[2] - p[2])); });
  }
  return out;
}

/**
 * The start: one spot for each of `count` grid slots, as far apart as they go (from the spot nearest `first`, the first
 * slot's place), each turned to face the middle of the field. The same on every machine, since a room's slots are its
 * vehicle numbers.
 */
export function startSpots(spots, count, first = null) {
  if (!spots.length || count < 1) return [];
  const pool = spots.map((s) => ({ ...s, pos: [...s.pos] }));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  let start = 0;
  if (first) pool.forEach((s, i) => { if (dist(s.pos, first) < dist(pool[start].pos, first)) start = i; });
  const chosen = [pool[start]];
  const used = new Set([start]);
  while (chosen.length < Math.min(count, pool.length)) {
    let best = -1, bestD = -1;
    pool.forEach((s, i) => {
      if (used.has(i)) return;
      const d = Math.min(...chosen.map((c) => dist(c.pos, s.pos)));
      if (d > bestD) { bestD = d; best = i; }
    });
    used.add(best);
    chosen.push(pool[best]);
  }
  // More slots than spots: the rest stand beside the spots already taken, 30 ft over.
  for (let k = 0; chosen.length < count; k++) {
    const s = chosen[k % pool.length];
    chosen.push({ pos: [s.pos[0] + 30 * Math.cos(s.heading), s.pos[1], s.pos[2] - 30 * Math.sin(s.heading)], heading: s.heading });
  }
  const mid = [chosen.reduce((a, s) => a + s.pos[0], 0) / chosen.length, 0, chosen.reduce((a, s) => a + s.pos[2], 0) / chosen.length];
  return chosen.map((s) => (dist(s.pos, mid) > 1 ? { ...s, heading: Math.atan2(mid[0] - s.pos[0], mid[2] - s.pos[2]) } : s));
}

/**
 * Where a wrecked truck comes back: of `spots`, looked through from a random one (`roll` in [0, 1)), the first at least
 * `RESPAWN.farFt` from every truck in `others` (positions), else the one farthest from its nearest; turned toward the
 * nearest truck. Null with no spots.
 */
export function pickSpawn(spots, others, roll = 0) {
  if (!spots?.length) return null;
  const from = Math.floor(Math.max(0, Math.min(0.999999, roll)) * spots.length);
  const nearestOf = (p) => {
    let best = null, bestD = Infinity;
    for (const o of others) {
      const d = Math.hypot(o[0] - p[0], o[2] - p[2]);
      if (d < bestD) { bestD = d; best = o; }
    }
    return { best, d: bestD };
  };
  let pick = null, pickD = -1;
  for (let k = 0; k < spots.length; k++) {
    const s = spots[(from + k) % spots.length];
    const { d } = nearestOf(s.pos);
    if (d >= RESPAWN.farFt) { pick = s; break; }
    if (d > pickD) { pickD = d; pick = s; }
  }
  const { best } = nearestOf(pick.pos);
  const heading = best ? Math.atan2(best[0] - pick.pos[0], best[2] - pick.pos[2]) : pick.heading;
  return { pos: [...pick.pos], heading };
}

/** The level's covers (Tag's `coverOf`) from its boxes, for the computer trucks' routes. */
export const coversOf = (boxes) => (boxes ?? []).map(coverOf).filter(Boolean);

/*
  Online (docs/EXTENSIONS.md, "Over the network"). Each machine judges the trucks it drives as in Combat (their pools,
  credits, wrecks and, here, the times each wrecked itself `sw`, was wrecked `dt` and came back `rs`); the owner's
  `mode` state is the end, the winner and its rules.
*/
export function deathmatchToWire(s, vehicleOf) {
  return {
    over: !!s.over, winner: vehicleIndex(s.winner ?? -1, vehicleOf),
    rules: s.rules ? { toughness: String(s.rules.toughness), respawn: !!s.rules.respawn, repairs: !!s.rules.repairs, helicopter: !!s.rules.helicopter } : null,
  };
}
export function deathmatchFromWire(d, localOf) {
  const rules = d.rules && typeof d.rules === "object" && TOUGHNESS[d.rules.toughness]
    ? { toughness: d.rules.toughness, respawn: !!d.rules.respawn, repairs: !!d.rules.repairs, helicopter: !!d.rules.helicopter } : null;
  return { over: !!d.over, winner: localIndex(d.winner, localOf), rules };
}

const shareOf = (x) => Math.max(0, Math.min(1, Number(x) || 0));
export function deathmatchOwnToWire(s, vehicleOf) {
  const trucks = {}, owed = {};
  (s.trucks ?? []).forEach((e, i) => { if (e) trucks[vehicleOf(i)] = { ...e, by: vehicleIndex(e.by ?? -1, vehicleOf) }; });
  (s.owed ?? []).forEach((o, i) => { if (o && (o.hp > 0 || o.wrecks > 0)) owed[vehicleOf(i)] = { hp: o.hp, wrecks: o.wrecks }; });
  return { trucks, owed };
}
export function deathmatchOwnFromWire(d, localOf, count) {
  const trucks = fromVehicles(d.trucks, localOf, count, null).map((e) => (e && typeof e === "object" ? {
    g: shareOf(e.g), e: shareOf(e.e), b: shareOf(e.b), w: [0, 1, 2, 3].map((w) => shareOf(e.w?.[w])), l: [0, 1, 2, 3].map((w) => !!e.l?.[w]),
    cr: Math.max(0, Number(e.cr) || 0), d: Math.max(0, Number(e.d) || 0), wk: e.wk | 0, rp: e.rp | 0, wr: !!e.wr, q: !!e.q, by: localIndex(e.by, localOf),
    sw: Math.max(0, e.sw | 0), dt: Math.max(0, e.dt | 0), rs: Math.max(0, e.rs | 0),
  } : null));
  const owed = fromVehicles(d.owed, localOf, count, null).map((o) => (o && typeof o === "object" ? { hp: Math.max(0, Number(o.hp) || 0), wrecks: Math.max(0, o.wrecks | 0) } : null));
  return { trucks, owed };
}
