/*
  Tag (docs/PLAN.md, "Party modes"): one truck is It and hands that on by touching another, on any
  track in any weather, for a set number of minutes. An addition, not in the game.

  It is picked at random and held where it stands for 5 s after the countdown; a truck made It is
  not held, and may not tag back the truck that tagged it for 10 s. Each truck starts with the same
  points; once the start hold is over, free trucks gain 1 point per whole second while It loses 1, and
  a tag moves points from the truck tagged to the one that tagged it, more when the victim is higher
  in the standings. Places go by points, the most the best. The rules (`createTag`, `tagStep`) run in
  the simulation worker after the race tick, with the hull touches of the step before.

  Computer trucks do not drive the course. It chases a truck it may tag, nearer first but with a bias
  toward those higher in the standings, going around a
  solid object and up a slope, and taking a ramp that faces its quarry. The others mostly wander
  the ground around the course; the rest of the time they head for high ground, a ridge, or the far
  side of an object, and they do that instead of wandering while It is close. Pure, so it runs under
  Node.
*/
import { WORLD_FT } from "../shared/scene-frame.js";

export const DEFAULT_TAG_MINUTES = 5;
export const IT_START_HOLD_S = 5;
/** No tag-backs: the truck that made It is safe from it this long. */
export const TAG_BACK_S = 10;
/** The arrow's colour over the It truck. */
export const IT_COLOUR = "#ffa21f";
/**
 * The It arrow's outline in its own plane, feet, tip first. The tip is the lowest point and the
 * winding is counter-clockwise seen from the marker's +Z, which is the side turned toward the camera.
 */
export const IT_ARROW = Object.freeze([
  Object.freeze([0, -3.4]),
  Object.freeze([2.35, -0.35]),
  Object.freeze([0.85, -0.35]),
  Object.freeze([0.85, 3.05]),
  Object.freeze([-0.85, 3.05]),
  Object.freeze([-0.85, -0.35]),
  Object.freeze([-2.35, -0.35]),
]);
/** A chaser aims ahead of its quarry by the distance over this speed, at most `LEAD_MAX_S`. */
const LEAD_SPEED_FT = 80, LEAD_MAX_S = 1.5;
/** Each truck starts here; tags move points between trucks. */
export const TAG_START_POINTS = 100;
/** Points moved on a tag: at least this much, up to `TAG_TRANSFER_MAX` for the leader. */
export const TAG_TRANSFER_MIN = 8;
export const TAG_TRANSFER_MAX = 28;
/** It treats a leader as this many feet closer when picking a quarry (not always the leader). */
export const CHASE_RANK_FT = 55;
/** Points lost per whole second while a truck is It, and gained per whole second while free, after the opening hold. */
export const TAG_IT_DRAIN_PS = 1;
export const TAG_FREE_GAIN_PS = 1;
/** Without a course to drive, a truck runs this far ahead of itself, away from It, and keeps within `HOME_FT` of home. */
const FLEE_FT = 150;
export const HOME_FT = 500;
const WANDER_RATE = 0.8, WANDER_MAX = 0.8;

/** How far a truck roams from the start when the course covers no ground, and how far past a real course. */
export const ROAM_FT = 1400;
export const ROAM_MARGIN_FT = 700;
/** It this close, and a truck stops wandering and hides or runs. */
export const PRESS_FT = 180;
/** A new aim lasts about this long, and is dropped once the truck arrives. */
export const AIM_MIN_S = 4, AIM_MAX_S = 8;
export const ARRIVE_FT = 48;
/** Of the aims taken while It is away: wander, then a search for cover or high ground, then a run. */
export const WANDER_SHARE = 0.62, CALM_COVER_SHARE = 0.30;
/** While It is close, this share look for cover. The rest run. None wander. */
export const PRESSED_COVER_SHARE = 0.55;
/** Cruise, a run for cover, a flat-out run, the chase, and a ramp taken on the way. */
export const TAG_SPEED = Object.freeze({ wander: 64, cover: 82, flee: 92, chase: 90, ramp: 90 });
/** A box counts as cover once it reaches this far and stands this tall, feet. Checkpoints and props that never collide do not. */
export const COVER_REACH_FT = 8, COVER_TALL_FT = 8;
/** How far past a cover a truck aims when it hides, and how far wide of one it aims when it goes round. */
export const HIDE_STANDOFF_FT = 36, FLANK_FT = 40;
/** A ramp is worth taking when it is at least this big and the quarry is still this far off. */
export const RAMP_MIN_HEIGHT = 6, RAMP_MIN_LENGTH = 16, RAMP_CHASE_FT = 140, RAMP_REACH_FT = 300;
const MAP_MARGIN = 96;

/** A game of Tag among `count` trucks, It picked by `random`. */
export function createTag(count, random = Math.random) {
  return {
    it: Math.min(count - 1, Math.floor(random() * count)),
    itTime: new Array(count).fill(0),
    points: new Array(count).fill(TAG_START_POINTS),
    /** Whole-second accumulator for per-second scoring once the opening hold has ended. */
    second: 0,
    /** It is held until this time (seconds since the countdown ended). */
    holdUntil: IT_START_HOLD_S,
    /** The truck It may not tag back, and until when. */
    safe: -1, safeUntil: 0,
    /** The last tag (`{ kind: "tag", from, to, points }`) and how many there have been. */
    event: null, events: 0,
  };
}

/** Points drained from It over `seconds` whole seconds. */
export function tagItDrain(seconds) {
  return TAG_IT_DRAIN_PS * seconds;
}

/**
 * One step once the countdown has ended: `clock` the seconds since, `touches` the pairs of trucks
 * whose hulls met in the step before. It's time grows; once the opening hold is over, each whole
 * second free trucks gain points and It loses points, and a touch with It moves points from the
 * other truck and makes it It. Returns the tag, or null.
 */
export function tagStep(tag, clock, dt, touches = []) {
  tag.itTime[tag.it] += dt;
  if (clock < tag.holdUntil) return null;
  tag.second += dt;
  const ticks = Math.floor(tag.second + 1e-9);
  if (ticks > 0) {
    tag.second = Math.max(0, tag.second - ticks);
    const drain = tagItDrain(ticks);
    const gain = TAG_FREE_GAIN_PS * ticks;
    for (let i = 0; i < tag.points.length; i++) {
      tag.points[i] = i === tag.it ? Math.max(0, tag.points[i] - drain) : tag.points[i] + gain;
    }
  }
  for (const [a, b] of touches) {
    const other = a === tag.it ? b : b === tag.it ? a : -1;
    if (other < 0 || other === tag.it || tagSafe(tag, other, clock)) continue;
    const n = tag.points.length;
    const victimPlace = tagRanks(tag)[other];
    const moved = Math.min(tag.points[other], tagTransfer(n, victimPlace));
    tag.points[other] -= moved;
    tag.points[tag.it] += moved;
    tag.event = { kind: "tag", from: tag.it, to: other, points: Math.round(moved) };
    tag.events++;
    tag.safe = tag.it;
    tag.safeUntil = clock + TAG_BACK_S;
    tag.it = other;
    return tag.event;
  }
  return null;
}

/** Whether truck `i` is held at `clock`: It, while its hold lasts. */
export const tagHeld = (tag, i, clock) => i === tag.it && clock < tag.holdUntil;

/** Whether It may not tag truck `i` at `clock`: the one that made it It, for `TAG_BACK_S`. */
export const tagSafe = (tag, i, clock) => i === tag.safe && clock < tag.safeUntil;

/** Points moved when It tags the truck in `place` (1 is the leader) among `count` trucks. */
export function tagTransfer(count, place) {
  if (count <= 1) return TAG_TRANSFER_MAX;
  const t = (count - place) / (count - 1);
  return Math.round(TAG_TRANSFER_MIN + (TAG_TRANSFER_MAX - TAG_TRANSFER_MIN) * t);
}

/**
 * Each truck's shared place by points (1 plus the count of trucks with strictly more points), so tied
 * trucks have the same value and chase bias regardless of entry order.
 */
export function tagRanks(tag) {
  return tag.points.map((p) => 1 + tag.points.filter((o) => o > p).length);
}

/** Each truck's place: the most points first, ties by entry order. */
export function tagPlaces(tag) {
  const order = tag.points.map((_, i) => i).sort((i, j) => (tag.points[j] - tag.points[i]) || (i - j));
  const places = new Array(order.length);
  order.forEach((i, k) => { places[i] = k + 1; });
  return places;
}

/**
 * Where It at `pos` drives: at one of `quarry` (`{ pos, vel, place? }` each, world ft and ft/s; null
 * for a truck not to chase), nearer first but with `place` (1 is the leader) counting like `CHASE_RANK_FT / place`
 * feet off the distance, ahead of it by the real distance over 80 ft/s, at most 1.5 s. Null with none.
 */
export function chasePoint(pos, quarry) {
  let best = null, bestCost = Infinity, bestD = 0;
  for (const q of quarry) {
    if (!q) continue;
    const d = Math.hypot(q.pos[0] - pos[0], q.pos[2] - pos[2]);
    const bias = q.place > 0 ? CHASE_RANK_FT / q.place : 0;
    const cost = d - bias;
    if (cost < bestCost) { bestCost = cost; bestD = d; best = q; }
  }
  if (!best) return null;
  const lead = Math.min(LEAD_MAX_S, bestD / LEAD_SPEED_FT);
  return [best.pos[0] + best.vel[0] * lead, best.pos[1], best.pos[2] + best.vel[2] * lead];
}

/** A slow wander for a fleeing truck's way, radians, stepped by `random`. */
export function wander(angle, dt, random = Math.random) {
  return Math.max(-WANDER_MAX, Math.min(WANDER_MAX, angle + (random() - 0.5) * WANDER_RATE * dt * 2));
}

/**
 * Where a truck at `pos` runs from It at `itPos`, its way turned by `angle`, kept within `HOME_FT` of `home`
 * (`[x, z]`; the start grid's middle), so it runs round the track rather than off across the world.
 */
export function fleePoint(pos, itPos, angle = 0, home = null) {
  let dx = pos[0] - itPos[0], dz = pos[2] - itPos[2];
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  const c = Math.cos(angle), s = Math.sin(angle);
  let x = pos[0] + (dx * c - dz * s) * FLEE_FT, z = pos[2] + (dx * s + dz * c) * FLEE_FT;
  if (home) {
    const hx = x - home[0], hz = z - home[1], far = Math.hypot(hx, hz);
    if (far > HOME_FT) { x = home[0] + (hx * HOME_FT) / far; z = home[1] + (hz * HOME_FT) / far; }
  }
  return [x, pos[1], z];
}

/** A driver's memory: the point it is making for, until when, and which kind of aim it is. */
export function createTagDriver() {
  return { point: null, until: 0, kind: "wander", wasPressed: false, angle: 0 };
}

/**
 * A cover from a level box (`{ pos, half, type }`) or a wall already measured (`{ pos, reach, tall }`).
 * Null when it is too small to hide a truck, or a kind that never stops one (checkpoint, goal, billboard).
 */
export function coverOf(box) {
  if (!box?.pos) return null;
  if (box.type === 6 || box.type === 7 || box.type === 8) return null;
  const reach = box.reach ?? (box.half ? Math.hypot(box.half[0], box.half[2]) : 0);
  const tall = box.tall ?? (box.half ? box.half[1] * 2 : 0);
  if (reach < COVER_REACH_FT || tall < COVER_TALL_FT) return null;
  return { pos: box.pos, reach, tall };
}

/**
 * The rectangle trucks roam, in game feet. A course that actually covers ground (its points plus the
 * start grid span more than 160 ft) is grown by `ROAM_MARGIN_FT`, so a wander leaves the racing line
 * for the terrain around it. Otherwise the square is `ROAM_FT` around `home` (`[x, z]`). Either way
 * it stays on the map.
 */
export function roamRect(points, home) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, n = 0;
  const take = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    n++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  take(home[0], home[1]);
  for (const p of points ?? []) take(p[0], p[1]);
  const wide = n > 1 && (maxX - minX > 160 || maxZ - minZ > 160);
  const margin = wide ? ROAM_MARGIN_FT : ROAM_FT;
  if (!wide) { minX = maxX = home[0]; minZ = maxZ = home[1]; }
  return clampRect({ minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin });
}

function clampRect(rect) {
  const limit = WORLD_FT - MAP_MARGIN;
  const fit = (a, b) => {
    let min = Math.max(MAP_MARGIN, Math.min(a, b));
    let max = Math.min(limit, Math.max(a, b));
    if (max - min < 200) {
      const mid = (min + max) / 2;
      min = Math.max(MAP_MARGIN, mid - 100);
      max = Math.min(limit, min + 200);
      min = max - 200;
    }
    return [min, max];
  };
  const [minX, maxX] = fit(rect.minX, rect.maxX);
  const [minZ, maxZ] = fit(rect.minZ, rect.maxZ);
  return { minX, maxX, minZ, maxZ };
}

/** A point kept inside `rect`. */
export function clampToRect(point, rect) {
  return [
    Math.max(rect.minX, Math.min(rect.maxX, point[0])),
    point[1],
    Math.max(rect.minZ, Math.min(rect.maxZ, point[2])),
  ];
}

/** A random point inside `rect`, from `random`. */
export function wanderPoint(rect, random) {
  return [
    rect.minX + random() * (rect.maxX - rect.minX),
    0,
    rect.minZ + random() * (rect.maxZ - rect.minZ),
  ];
}

/** Where `x, z` falls on the segment from A to B: `t` along it, and the distance off it. */
function along(ax, az, bx, bz, x, z) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1) return { t: 0, dist: Math.hypot(x - ax, z - az) };
  const t = ((x - ax) * dx + (z - az) * dz) / len2;
  const u = Math.max(0, Math.min(1, t));
  return { t, dist: Math.hypot(x - (ax + dx * u), z - (az + dz * u)) };
}

/**
 * The tallest cover standing on the way from `from` to `to` (`{ pos, reach, tall }` each), or null.
 * It has to lie on the span, not at either truck's feet.
 */
export function coverBetween(covers, from, to) {
  let best = null, bestTall = -1;
  for (const c of covers) {
    const { t, dist } = along(from[0], from[2], to[0], to[2], c.pos[0], c.pos[2]);
    if (t < 0.08 || t > 0.96 || dist > c.reach) continue;
    if (c.tall > bestTall) { best = c; bestTall = c.tall; }
  }
  return best;
}

/** A point just past `cover`, on the side away from It. */
export function hideBehind(cover, itPos) {
  let dx = cover.pos[0] - itPos[0], dz = cover.pos[2] - itPos[2];
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  const dist = cover.reach + HIDE_STANDOFF_FT;
  return [cover.pos[0] + dx * dist, itPos[1] ?? 0, cover.pos[2] + dz * dist];
}

/** The side of `cover` nearer `from`, wide of it, on the way to `to`. */
export function flankPoint(from, to, cover) {
  const dx = to[0] - from[0], dz = to[2] - from[2];
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len, pz = dx / len;
  const off = cover.reach + FLANK_FT;
  const y = to[1] ?? 0;
  const a = [cover.pos[0] + px * off, y, cover.pos[2] + pz * off];
  const b = [cover.pos[0] - px * off, y, cover.pos[2] - pz * off];
  const da = Math.hypot(a[0] - from[0], a[2] - from[2]);
  const db = Math.hypot(b[0] - from[0], b[2] - from[2]);
  return da <= db ? a : b;
}

/**
 * How good a hiding spot `point` is from It at `itPos`. High ground, a ridge between them, and a
 * cover on the line all add; water, a cliff down from `from`, and a point on top of It take away.
 * `heightAt(x, z)` is the ground, feet.
 */
export function hideScore(point, itPos, heightAt, covers, { from = null, water = null } = {}) {
  const h = heightAt(point[0], point[2]);
  const ih = heightAt(itPos[0], itPos[2]);
  let score = 0;
  const rise = h - ih;
  if (rise > 6) score += Math.min(36, rise);
  const mid = heightAt((point[0] + itPos[0]) / 2, (point[2] + itPos[2]) / 2);
  const ridge = mid - Math.max(h, ih);
  if (ridge > 5) score += Math.min(28, ridge * 1.5);
  const cover = coverBetween(covers, itPos, point);
  if (cover) score += 22 + Math.min(18, cover.tall);
  const away = Math.hypot(point[0] - itPos[0], point[2] - itPos[2]);
  if (away < 90) score -= 40;
  else score += Math.min(16, away / 80);
  if (water !== null && water !== undefined && h < water + 1.5) score -= 70;
  if (from) {
    const drop = heightAt(from[0], from[2]) - h;
    if (drop > 28) score -= drop * 0.5;
  }
  return score;
}

/** The immediate point to steer at: around a cover on the line, or a step up a slope, else `point` itself. */
export function routePoint(pos, point, covers, heightAt) {
  if (!point) return null;
  const blocked = coverBetween(covers ?? [], pos, point);
  if (blocked) return flankPoint(pos, point, blocked);
  if (!heightAt) return point;
  const dist = Math.hypot(point[0] - pos[0], point[2] - pos[2]);
  if (dist < 80) return point;
  const fromH = heightAt(pos[0], pos[2]);
  const toH = heightAt(point[0], point[2]);
  if (!(toH > fromH + 14)) return point;
  const step = [pos[0] + (point[0] - pos[0]) * 0.4, point[1], pos[2] + (point[2] - pos[2]) * 0.4];
  const stepH = heightAt(step[0], step[2]);
  if (stepH > fromH + 3 && stepH < toH + 8) return step;
  return point;
}

/** The ramp's nose (the high end, body +z) and tail. */
function rampEnds(r) {
  const fx = r.matrix[2], fz = r.matrix[8];
  const half = r.length * 0.5;
  return {
    nose: [r.pos[0] + fx * half, r.pos[1], r.pos[2] + fz * half],
    tail: [r.pos[0] - fx * half, r.pos[1], r.pos[2] - fz * half],
    fx, fz,
  };
}

function rampUseful(r) {
  return !!r?.matrix && (r.height ?? 0) >= RAMP_MIN_HEIGHT && (r.length ?? 0) >= RAMP_MIN_LENGTH;
}

/**
 * The tail of a ramp It should run up: it faces the quarry, it lies on the way, and the quarry is
 * still far enough that the launch is worth leaving the straight chase. Null otherwise.
 */
export function rampLaunch(pos, quarry, ramps) {
  if (!ramps?.length) return null;
  const chase = Math.hypot(quarry[0] - pos[0], quarry[2] - pos[2]);
  if (chase < RAMP_CHASE_FT) return null;
  let best = null, bestD = RAMP_REACH_FT;
  for (const r of ramps) {
    if (!rampUseful(r)) continue;
    const { nose, tail, fx, fz } = rampEnds(r);
    const qx = quarry[0] - nose[0], qz = quarry[2] - nose[2];
    const ql = Math.hypot(qx, qz) || 1;
    if ((fx * qx + fz * qz) / ql < 0.5) continue;
    const tx = tail[0] - pos[0], tz = tail[2] - pos[2];
    if (tx * (quarry[0] - pos[0]) + tz * (quarry[2] - pos[2]) <= 0) continue;
    const d = Math.hypot(tx, tz);
    if (d < bestD && d < chase) { bestD = d; best = tail; }
  }
  return best;
}

/** The tail of a ramp whose nose points away from It, when the truck is near enough to take it. */
export function rampAway(pos, itPos, ramps) {
  if (!ramps?.length) return null;
  let best = null, bestD = 340;
  for (const r of ramps) {
    if (!rampUseful(r)) continue;
    const { nose, tail, fx, fz } = rampEnds(r);
    const ax = nose[0] - itPos[0], az = nose[2] - itPos[2];
    const al = Math.hypot(ax, az) || 1;
    if ((fx * ax + fz * az) / al < 0.4) continue;
    const d = Math.hypot(pos[0] - tail[0], pos[2] - tail[2]);
    if (d < bestD) { bestD = d; best = tail; }
  }
  return best;
}

function dryWander(rect, itPos, heightAt, water, random) {
  const bad = (p) => {
    const near = Math.hypot(p[0] - itPos[0], p[2] - itPos[2]) < 120;
    const wet = water !== null && water !== undefined && heightAt(p[0], p[2]) < water + 1.5;
    return near || wet;
  };
  let p = wanderPoint(rect, random);
  for (let i = 0; i < 6 && bad(p); i++) p = wanderPoint(rect, random);
  return p;
}

function bestHide(ctx) {
  const { rect, itPos, pos, heightAt, covers, ramps, water, random } = ctx;
  let best = null, bestS = -Infinity;
  const consider = (p, bonus = 0) => {
    const q = clampToRect(p, rect);
    const s = hideScore(q, itPos, heightAt, covers, { from: pos, water }) + bonus;
    if (s > bestS) { bestS = s; best = q; }
  };
  for (const c of covers) {
    if (Math.hypot(c.pos[0] - pos[0], c.pos[2] - pos[2]) > 520) continue;
    consider(hideBehind(c, itPos), Math.min(10, c.tall * 0.25));
  }
  const jump = rampAway(pos, itPos, ramps);
  if (jump) consider(jump, 24);
  for (let i = 0; i < 8; i++) consider(wanderPoint(rect, random));
  return best ?? wanderPoint(rect, random);
}

function pickFree(driver, ctx, pressed) {
  const roll = ctx.random();
  if (pressed) {
    if (roll < PRESSED_COVER_SHARE) {
      driver.point = bestHide(ctx);
      driver.kind = "cover";
    } else {
      driver.angle = wander(driver.angle, 1, ctx.random);
      driver.point = clampToRect(fleePoint(ctx.pos, ctx.itPos, driver.angle), ctx.rect);
      driver.kind = "flee";
    }
  } else if (roll < WANDER_SHARE) {
    driver.point = dryWander(ctx.rect, ctx.itPos, ctx.heightAt, ctx.water, ctx.random);
    driver.kind = "wander";
  } else if (roll < WANDER_SHARE + CALM_COVER_SHARE) {
    driver.point = bestHide(ctx);
    driver.kind = "cover";
  } else {
    driver.angle = wander(driver.angle, 1, ctx.random);
    driver.point = clampToRect(fleePoint(ctx.pos, ctx.itPos, driver.angle), ctx.rect);
    driver.kind = "flee";
  }
  driver.until = ctx.clock + AIM_MIN_S + ctx.random() * (AIM_MAX_S - AIM_MIN_S);
}

/**
 * The point this computer truck steers toward, and the kind of aim on `driver` (`createTagDriver`).
 * `role` is `"it"` or `"free"`. `ctx` is `{ clock, pos, itPos, quarry, rect, covers, ramps, heightAt, water, random }`.
 * `quarry` is the list `chasePoint` takes. The point it returns may be a step around a cover or up a slope;
 * `driver.point` stays the place it means to reach.
 */
export function tagDrivePoint(driver, role, ctx) {
  const covers = ctx.covers ?? [];
  const heightAt = ctx.heightAt;
  if (role === "it") {
    const lead = chasePoint(ctx.pos, ctx.quarry ?? []);
    if (lead) {
      const launch = rampLaunch(ctx.pos, lead, ctx.ramps ?? []);
      const aim = launch ?? lead;
      driver.point = aim;
      driver.kind = launch ? "ramp" : "chase";
      driver.until = ctx.clock + AIM_MAX_S;
      return routePoint(ctx.pos, aim, covers, heightAt);
    }
  }
  const pressed = Math.hypot(ctx.pos[0] - ctx.itPos[0], ctx.pos[2] - ctx.itPos[2]) < PRESS_FT;
  const arrived = driver.point && Math.hypot(driver.point[0] - ctx.pos[0], driver.point[2] - ctx.pos[2]) < ARRIVE_FT;
  const pressEdge = pressed && !driver.wasPressed;
  const stale = driver.kind === "chase" || driver.kind === "ramp";
  driver.wasPressed = pressed;
  if (!driver.point || stale || ctx.clock >= driver.until || arrived || (pressEdge && driver.kind === "wander")) {
    pickFree(driver, ctx, pressed);
  }
  return routePoint(ctx.pos, driver.point, covers, heightAt);
}
