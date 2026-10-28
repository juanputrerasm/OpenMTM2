/*
  Simulation-side extension registry. The worker offers lifecycle hooks and collision events;
  extension runtimes own their state, driving, scoring and public view.

  In an online room (docs/EXTENSIONS.md, "Over the network") one machine decides: `env.net.authority`
  is "owner" on the room owner's machine, which runs the rules and offers `netState()`, and
  "follower" on the others, which skip the rules' decisions and take the owner's state through
  `applyNet(state)`, in their own truck order. A follower becomes the owner when the room's owner
  leaves; it carries on from the last state it was given.
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import { createRumbleDriver, driveToPoint } from "../rumble-ai.js";
import {
  ESCAPE_S, HOCKEY_TUNE, NUDGE_AFTER_S, NUDGE_FT_S, TURN_FLOOR, createHockey, hockeyAim, hockeyHeld,
  hockeyHeliSpot, hockeyPlaces, hockeyRoles, hockeySpot, hockeyStep, hockeyTimeLeft, hockeyWinner, outsideRink, rinkGround,
} from "./hockey.js";
import {
  TAG64_BREAK_FT, TAG64_ROUND_S, TAG_MTM64, coverOf, createTag, createTagDriver, movableOf, roamRect, tag64Rate, tagAdopt,
  tagDrivePoint, tagHeld, tagScoring, tagShadowBand, itDistance, tagPlaces, tagRanks, tagSafe, tagSpeed, tagStep, tagZoneRate,
  wanderPoint,
} from "./tag.js";
import { SOCCER_DRIVE, SOCCER_TUNE } from "./soccer.js";
import { COPS_HOLD_S, cnrHeld, cnrHeliAllowed, cnrPlaces, cnrStep, createCnr, escapeSpot } from "./cops-robbers.js";
import {
  BLOCKER, CHEER_GAP_S, RACER, RNR_CHASE, blockOutcome, blockerTarget, blocksRacer, chaseBust, createChase, interceptPoint, racerHome,
  racerPlaces, rnrPlaces, rnrSided, rnrVariant, rnrWinner, timingTruck,
} from "./race-rumble.js";
import { createCombatRuntime } from "./combat-session.js";
import { createFreestyleRuntime } from "./freestyle-session.js";

const worldVelocity = (state) => {
  const matrix = state.matrix, [x, y, z] = state.bvel;
  return [matrix[0] * x + matrix[1] * y + matrix[2] * z, matrix[3] * x + matrix[4] * y + matrix[5] * z, matrix[6] * x + matrix[7] * y + matrix[8] * z];
};

const roamPoints = (course) => {
  const points = [];
  for (const segment of course) {
    if (segment.start) points.push([segment.start[0], segment.start[2]]);
    if (segment.end) points.push([segment.end[0], segment.end[2]]);
    if (segment.centre) points.push([segment.centre[0], segment.centre[2]]);
  }
  return points;
};

function endRace(race) {
  race.over = true;
  for (const truck of race.trucks) truck.finished = true;
}

function commonRuntime(payload, env) {
  const { trucks, race, step } = env;
  const sinceStart = () => race.clock - race.startTime;
  const driveByPoint = (truck) => {
    truck.recovery.player = true;
    truck.recovery.autopilot = false;
  };
  const resetDriver = (truck) => { truck.extensionDriver = createRumbleDriver(truck.extensionDriver?.aggression ?? 0.6); };
  const placeTruck = (truck, spot) => {
    const fresh = S.createTruckState(spot.pos, spot.heading, S.GEAR.PARK, truck.params);
    for (const [key, value] of Object.entries(fresh)) {
      if (ArrayBuffer.isView(value)) truck.state[key].set(value);
      else truck.state[key] = value;
    }
    truck.state.heliVisual = null;
    truck.flight = null;
    truck.exit = null;
    truck.headway = null;
    resetDriver(truck);
  };
  trucks.forEach((truck, index) => { truck.extensionDriver = createRumbleDriver(0.5 + ((index * 0.37) % 0.3)); });
  return { payload, trucks, race, step, sinceStart, driveByPoint, resetDriver, placeTruck, end: () => endRace(race) };
}

const following = (env) => env.net?.authority === "follower";

/**
 * The ground the chase modes roam (Tag, Cops & Robbers): their rectangle, the covers on it, and the objects a truck
 * would rather not hit (the covers and every movable object, which moves with the object).
 */
function chaseField(env) {
  const { levelBoxes, walls, course, specs } = env;
  const home = [specs.reduce((sum, spec) => sum + spec.start.pos[0], 0) / specs.length, specs.reduce((sum, spec) => sum + spec.start.pos[2], 0) / specs.length];
  const covers = [], avoid = [];
  for (const box of levelBoxes) {
    const cover = coverOf(box);
    if (cover) covers.push(cover);
    const movable = movableOf(box);
    if (movable && !cover) avoid.push(movable);
  }
  for (const wall of walls ?? []) {
    const cover = coverOf({ pos: wall.pos, reach: Math.hypot(wall.size[0], wall.size[2]) * 0.5, tall: wall.size[1] });
    if (cover) covers.push(cover);
  }
  return { rect: roamRect(roamPoints(course), home), covers, avoid: [...covers, ...avoid] };
}

/** A truck's speed, ft/s. */
const speedOf = (state) => Math.hypot(state.bvel[0], state.bvel[1], state.bvel[2]);

function createHockeyRuntime(payload, env) {
  const base = commonRuntime(payload, env);
  const { trucks, race, step, levelBoxes, dirty, wallsAround } = env;
  const game = createHockey(payload.rink, payload.teams, payload.goals, { minutes: payload.minutes, suddenDeath: payload.suddenDeath });
  // Soccer's walls that only the ball meets (soccer.js `ballWalls`); a pitch the trucks may leave has no escape rule.
  const ballWalls = (payload.rink.ballWalls ?? []).map((w) => S.createBox(w.pos, w.size, 0, [0, 0, w.psi]));
  const escape = payload.rink.boards.length > 0;
  /** Face-offs so far (the owner counts them; a follower places its own trucks when the count moves on). */
  let resets = 0, seenResets = -1;
  const puck = levelBoxes.find((box) => box.sitIndex === payload.rink.puck.sitIndex) ?? null;
  let roles = null;
  // Soccer plays on grass: its own way of playing and driving (soccer.js); Hockey slides on the ice.
  const soccer = payload.mode === "soccer";
  const tune = soccer ? SOCCER_TUNE : HOCKEY_TUNE;
  const driving = soccer ? SOCCER_DRIVE : { back: false, turnFloor: TURN_FLOOR };
  const setPuck = () => {
    if (!puck) return;
    const { start, psi } = payload.rink.puck;
    puck.pos[0] = start[0]; puck.pos[1] = start[1]; puck.pos[2] = start[2];
    puck.vel.fill(0); puck.bvel.fill(0); puck.rates.fill(0); puck.force.fill(0); puck.moment.fill(0);
    puck.euler.set([0, 0, psi]);
    S.eulerToMatrix(0, 0, psi, puck.matrix);
    puck.depths.fill(-9999);
    dirty.add(puck);
  };
  trucks.forEach(base.driveByPoint);
  setPuck();
  return {
    id: payload.mode,
    specialBox: puck,
    debug: { game, puck },
    held: () => hockeyHeld(game),
    /** The Helicopter key sets a truck down at the rink's centre, where the puck faces off. */
    heliSpot: (index) => hockeyHeliSpot(payload.rink, game.teams, index, puck ? puck.pos : null),
    tick() {
      const action = following(env) ? null : hockeyStep(game, puck ? puck.pos : [...payload.rink.puck.start], step);
      if (action === "reset") {
        resets++;
        trucks.forEach((truck, index) => base.placeTruck(truck, hockeySpot(payload.rink, game.teams, index)));
        setPuck();
      } else if (action === "over") base.end();
      if (puck) roles = hockeyRoles(game, trucks.map((truck) => truck.state.pos), trucks.map((truck) => truck.autopilot), puck.pos);
      if (escape) trucks.forEach((truck, index) => {
        truck.outside = truck.flight || !outsideRink(payload.rink, truck.state.pos) ? 0 : (truck.outside ?? 0) + step;
        if (truck.outside >= ESCAPE_S) { base.placeTruck(truck, hockeySpot(payload.rink, game.teams, index)); truck.outside = 0; }
      });
      hockeyPlaces(game).forEach((place, index) => { race.trucks[index].place = place; });
    },
    drive(truck, index) {
      const role = roles?.[index] ?? { role: "attack", side: 1 };
      const state = truck.state;
      const aim = puck ? hockeyAim(payload.rink, game.teams[index], role.role, { pos: state.pos, heading: state.euler[2] }, puck.pos, role.side, truck.extensionDriver, tune) : { point: state.pos, speed: 0 };
      driveToPoint(state, truck.extensionDriver, aim.point, aim.speed, 0, S.GEAR, step, driving);
    },
    afterTruckStep(truck) {
      const state = truck.state, controls = state.controls;
      const driving = controls.throttle > 0.5 && controls.gear !== S.GEAR.PARK && controls.gear !== S.GEAR.NEUTRAL;
      truck.extensionStill = driving && Math.hypot(state.bvel[0], state.bvel[1], state.bvel[2]) < 0.05 ? (truck.extensionStill ?? 0) + step : 0;
      if (truck.extensionStill >= NUDGE_AFTER_S) state.bvel[2] += controls.gear === S.GEAR.REVERSE ? -NUDGE_FT_S : NUDGE_FT_S;
    },
    collideSpecial(index, box, collide) {
      const [x, y, z] = box.force;
      collide();
      if (box.force[0] !== x || box.force[1] !== y || box.force[2] !== z) game.lastTouch = index;
    },
    addSpecialWalls(all, listed) {
      if (!puck || !listed.includes(puck)) return;
      const walls = [];
      wallsAround(puck.pos[0], puck.pos[2], puck.radius, walls);
      for (const wall of walls) if (!all.includes(wall)) all.push(wall);
      for (const wall of ballWalls) all.push(wall);
    },
    view() {
      return {
        mode: payload.mode, score: [...game.score], target: game.target, teams: game.teams, phase: game.phase,
        timer: Math.max(0, game.timer), event: game.event, events: game.events, ball: puck ? [...puck.pos] : null,
        left: hockeyTimeLeft(game), suddenDeath: game.suddenDeath, winner: game.phase === "over" ? hockeyWinner(game) : null,
      };
    },
    score: (index) => game.goals[index],
    finish: base.end,
    netState: () => ({
      teams: game.teams, goals: game.goals, score: game.score, phase: game.phase, timer: game.timer, lastTouch: game.lastTouch,
      event: game.event, events: game.events, resets, over: !!race.over, elapsed: game.elapsed, suddenDeath: game.suddenDeath,
      puck: puck ? { pos: [...puck.pos], vel: [...puck.vel], bvel: [...puck.bvel], rates: [...puck.rates], euler: [...puck.euler] } : null,
    }),
    applyNet(d) {
      Object.assign(game, { teams: d.teams, goals: d.goals, score: d.score, phase: d.phase, timer: d.timer, lastTouch: d.lastTouch, event: d.event, events: d.events });
      if (Number.isFinite(d.elapsed)) game.elapsed = d.elapsed;
      game.suddenDeath = !!d.suddenDeath;
      game.prev = null;
      resets = d.resets;
      // The first state, and every face-off after: this machine's own trucks go to their spots (the others follow their owners).
      if (d.resets !== seenResets) {
        seenResets = d.resets;
        trucks.forEach((truck, index) => { if (!truck.remote) base.placeTruck(truck, hockeySpot(payload.rink, game.teams, index)); });
      }
      if (puck && d.puck) {
        for (const key of ["pos", "vel", "bvel", "rates", "euler"]) if (Array.isArray(d.puck[key])) puck[key].set(d.puck[key]);
        S.eulerToMatrix(puck.euler[0], puck.euler[1], puck.euler[2], puck.matrix);
        dirty.add(puck);
      }
      if (d.over) base.end();
    },
  };
}

function createTagRuntime(payload, env) {
  const base = commonRuntime(payload, env);
  const { trucks, race, step, ramps, ground, weather, watchHeadway } = env;
  const game = createTag(trucks.length, Math.random, tagScoring(payload.scoring));
  const shadow = tagShadowBand(game.scoring);
  if (Number.isInteger(payload.it) && payload.it >= 0 && payload.it < trucks.length) game.it = payload.it;
  // MTM64's rules: a fixed round, and the level's edge is out of bounds (the terrain's 256 cells of 32 ft).
  const mtm64 = game.scoring.rules === TAG_MTM64;
  const edgeFt = S.TERRAIN_CELLS * S.CELL_FT;
  race.roundSeconds = mtm64 ? TAG64_ROUND_S : Math.max(1, Number(payload.minutes) || 5) * 60;
  const { rect, covers, avoid } = chaseField(env);
  const touches = [];
  trucks.forEach((truck) => { truck.tagDriver = createTagDriver(); });
  return {
    id: payload.mode,
    debug: { game },
    held: (index) => tagHeld(game, index, base.sinceStart()),
    touch: (a, b) => { if (!following(env)) touches.push([a, b]); },
    tick() {
      if (!following(env)) tagStep(game, base.sinceStart(), step, touches, trucks.map((truck) => truck.state.pos), edgeFt);
      touches.length = 0;
      if (base.sinceStart() >= race.roundSeconds) base.end();
      tagPlaces(game).forEach((place, index) => { race.trucks[index].place = place; });
    },
    drive(truck, index) {
      const since = base.sinceStart();
      const role = truck === trucks[game.it] ? "it" : "free";
      const standings = tagRanks(game);
      const quarry = role === "it"
        ? trucks.map((other, otherIndex) => (other === truck || other.state.heliTimer > 0 || tagSafe(game, otherIndex, since) ? null : { pos: other.state.pos, vel: worldVelocity(other.state), place: standings[otherIndex] }))
        : null;
      const aimed = tagDrivePoint(truck.tagDriver, role, {
        clock: since, pos: truck.state.pos, itPos: trucks[game.it].state.pos, quarry, rect,
        covers, avoid, ramps, heightAt: (x, z) => ground.height(x, z), shadow, breakFt: mtm64 ? TAG64_BREAK_FT : undefined,
        water: weather() === S.WEATHER.SNOW ? null : ground.waterLevelFt, random: Math.random,
      });
      // A point that is not a place (a broken object's) is no aim: the truck waits a step rather than steer by NaN.
      const point = aimed && aimed.every(Number.isFinite) ? aimed : null;
      base.driveByPoint(truck);
      driveToPoint(truck.state, truck.extensionDriver, point ?? truck.state.pos, point ? tagSpeed(truck.tagDriver, truck.state.pos, truck.tagDriver.point) : 0, 0, S.GEAR, step, { detour: true });
      if (role === "it" && tagHeld(game, index, since)) truck.headway = null;
      else watchHeadway(truck, PATIENT_HEADWAY_S);
    },
    view(since) {
      return {
        mode: payload.mode, it: game.it, itTime: [...game.itTime], points: [...game.points],
        // Each truck's points a second now, for the HUD, inside the proximity zone round It.
        rates: trucks.map((truck, i) => {
          if (i === game.it || since < game.holdUntil) return 0;
          const d = itDistance(game, trucks.map((x) => x.state.pos), i);
          return mtm64 ? tag64Rate(d) : tagZoneRate(d, game.scoring);
        }),
        proximity: game.scoring.proximity, rules: game.scoring.rules,
        pass: Math.max(0, (game.passUntil ?? 0) - Math.max(0, since)),
        safe: tagSafe(game, game.safe, Math.max(0, since)) ? game.safe : -1,
        hold: Math.max(0, game.holdUntil - Math.max(0, since)),
        left: Math.max(0, race.roundSeconds - Math.max(0, since)), event: game.event, events: game.events,
      };
    },
    score: (index) => game.points[index],
    finish: base.end,
    netState: () => ({
      it: game.it, itTime: game.itTime, points: game.points, holdUntil: game.holdUntil, safe: game.safe, safeUntil: game.safeUntil,
      passUntil: game.passUntil, event: game.event, events: game.events, over: !!race.over, scoring: game.scoring,
    }),
    applyNet(d) {
      tagAdopt(game, d);
      if (d.over) base.end();
    },
  };
}

function createCnrRuntime(payload, env) {
  const base = commonRuntime(payload, env);
  const { trucks, race, step, ramps, ground, weather, watchHeadway } = env;
  const game = createCnr(trucks.length);
  if (Number.isInteger(payload.robber) && payload.robber >= 0 && payload.robber < trucks.length) game.robber = payload.robber;
  race.roundSeconds = Math.max(1, Number(payload.minutes) || 20) * 60;
  const { rect, covers, avoid } = chaseField(env);
  const touches = [];
  /** Captures so far, where the robber was set down last, and until when it is held there. */
  let resets = 0, seenResets = 0, spot = null, settleUntil = 0;
  const RIDE_FT = 6;
  const groundSpot = (p) => [p[0], ground.height(p[0], p[2]) + RIDE_FT, p[2]];
  const dry = (p) => ground.waterLevelFt === null || ground.waterLevelFt === undefined || weather() === S.WEATHER.SNOW || ground.height(p[0], p[2]) > ground.waterLevelFt + 1.5;
  const setDown = (where) => {
    const robber = trucks[game.robber];
    base.placeTruck(robber, { pos: where.pos, heading: where.heading });
    settleUntil = base.sinceStart() + 1;
  };
  trucks.forEach((truck) => { truck.tagDriver = createTagDriver(); });
  return {
    id: payload.mode,
    debug: { game },
    held: (index) => cnrHeld(game, index, base.sinceStart()) || (index === game.robber && base.sinceStart() < settleUntil),
    heliAllowed(index) {
      const state = trucks[index].state;
      const deep = ground.waterLevelFt !== null && ground.waterLevelFt !== undefined && weather() !== S.WEATHER.SNOW
        && ground.height(state.pos[0], state.pos[2]) < ground.waterLevelFt - 3;
      return cnrHeliAllowed(game, index, deep);
    },
    touch: (a, b) => { if (!following(env)) touches.push([a, b]); },
    tick() {
      const since = base.sinceStart();
      if (!following(env)) {
        const robber = trucks[game.robber].state;
        const capture = cnrStep(game, since, step, touches, { up: robber.matrix[4], speed: speedOf(robber) });
        if (capture) {
          const cops = trucks.filter((_, i) => i !== game.robber).map((truck) => truck.state.pos);
          const candidates = [];
          for (let k = 0; k < 24; k++) { const p = groundSpot(wanderPoint(rect, Math.random)); if (dry(p)) candidates.push(p); }
          const pos = escapeSpot(candidates.length ? candidates : [groundSpot(wanderPoint(rect, Math.random))], cops);
          spot = { pos, heading: Math.random() * Math.PI * 2 };
          resets++;
          setDown(spot);
        }
      }
      touches.length = 0;
      if (since >= race.roundSeconds) base.end();
      cnrPlaces(game).forEach((place, index) => { race.trucks[index].place = place; });
    },
    drive(truck, index) {
      const since = base.sinceStart();
      const robber = trucks[game.robber];
      const role = truck === robber ? "free" : "it";
      // The robber minds the nearest cop; the cops chase the robber.
      let chaser = null, near = Infinity;
      if (role === "free") {
        for (const other of trucks) {
          if (other === truck) continue;
          const d = Math.hypot(other.state.pos[0] - truck.state.pos[0], other.state.pos[2] - truck.state.pos[2]);
          if (d < near) { near = d; chaser = other; }
        }
      }
      const quarry = role === "it" ? [robber.state.heliTimer > 0 ? null : { pos: robber.state.pos, vel: worldVelocity(robber.state), place: 0 }] : null;
      const aimed = tagDrivePoint(truck.tagDriver, role, {
        clock: since, pos: truck.state.pos, itPos: role === "free" ? (chaser ?? truck).state.pos : robber.state.pos, quarry, rect, covers, avoid, ramps,
        shy: role === "free",
        heightAt: (x, z) => ground.height(x, z), water: weather() === S.WEATHER.SNOW ? null : ground.waterLevelFt, random: Math.random,
      });
      // A point that is not a place (a broken object's) is no aim: the truck waits a step rather than steer by NaN.
      const point = aimed && aimed.every(Number.isFinite) ? aimed : null;
      base.driveByPoint(truck);
      driveToPoint(truck.state, truck.extensionDriver, point ?? truck.state.pos, point ? tagSpeed(truck.tagDriver, truck.state.pos, truck.tagDriver.point) : 0, 0, S.GEAR, step, { detour: true });
      if (cnrHeld(game, index, since)) truck.headway = null;
      else watchHeadway(truck, PATIENT_HEADWAY_S);
    },
    view(since) {
      const now = Math.max(0, since);
      return {
        mode: payload.mode, robber: game.robber, points: [...game.points], captures: [...game.captures],
        safe: Math.max(0, game.safeUntil - now), hold: Math.max(0, COPS_HOLD_S - now),
        left: Math.max(0, race.roundSeconds - now), event: game.event, events: game.events,
      };
    },
    score: (index) => game.points[index],
    finish: base.end,
    netState: () => ({
      robber: game.robber, points: game.points, captures: game.captures, safeUntil: game.safeUntil,
      event: game.event, events: game.events, resets, spot, over: !!race.over,
    }),
    applyNet(d) {
      Object.assign(game, { robber: d.robber, points: d.points, captures: d.captures, safeUntil: d.safeUntil, event: d.event, events: d.events });
      resets = d.resets;
      // A capture: when this machine drives the robber, it sets its own truck down where the owner said.
      if (d.resets !== seenResets) {
        seenResets = d.resets;
        if (d.spot && !trucks[game.robber].remote) setDown(d.spot);
      }
      if (d.over) base.end();
    },
  };
}

/** A blocker or a chase-mode truck stuck this long within 12 ft calls the helicopter (the worker's headway watch). */
const PATIENT_HEADWAY_S = 15;

function createRnrRuntime(payload, env) {
  const base = commonRuntime(payload, env);
  const { trucks, race, step, watchHeadway } = env;
  const teams = [...payload.teams], roles = [...payload.roles];
  const variant = rnrVariant(payload.variant);
  /** The timed block's and the chase's limit, seconds after the countdown. */
  const limit = rnrSided(variant) ? Math.max(1, Number(payload.minutes) || 5) * 60 : null;
  /** The chase's busts (race-rumble.js `chaseBust`), null in the other variants. */
  const chase = variant === RNR_CHASE ? createChase(trucks.length) : null;
  /** The places once the race is decided (a racer home, the time up, or the race left early), else null; and the winning team. */
  let decided = null, winner = null;
  /** Blockers' hits on racers still to tell (`"blocker,racer"` to `{ at, speed }`), the last cheer of each blocker, and the events. */
  const hits = new Map();
  const cheered = trucks.map(() => -Infinity);
  let event = null, events = 0;
  // The blockers are driven here, and recover as the player does; the racers keep the course's autopilot.
  trucks.forEach((truck, i) => {
    if (roles[i] !== BLOCKER) return;
    base.driveByPoint(truck);
  });
  /** While the race runs only the racers have places, among themselves. */
  const livePlaces = () => racerPlaces(roles, race.trucks.map((rt) => rt.place)).forEach((place, i) => { race.trucks[i].place = place; });
  livePlaces();
  const decide = () => {
    winner = rnrWinner(roles, race.trucks, teams, variant);
    decided = rnrPlaces(teams, roles, race.trucks, variant, chase?.busts);
    decided.forEach((place, i) => { race.trucks[i].place = place; });
  };
  /** The trucks as the blockers see them. */
  const field = () => trucks.map((other, i) => ({
    index: i, team: teams[i], role: roles[i], pos: other.state.pos, vel: worldVelocity(other.state), speed: speedOf(other.state),
    place: race.trucks[i].place, finished: race.trucks[i].finished || other.state.heliTimer > 0,
  }));
  /** A blocker's block or roll-over: the event, its cheer (the HUD plays a horn or a YeeHaw from its truck). */
  const cheer = (blocker, racer, kind) => {
    const now = base.sinceStart();
    if (now - cheered[blocker] < CHEER_GAP_S) return;
    cheered[blocker] = now;
    event = { kind, by: blocker, racer };
    events++;
  };
  const tellHits = () => {
    const now = base.sinceStart();
    for (const [key, hit] of hits) {
      const [blocker, racer] = key.split(",").map(Number);
      const state = trucks[racer].state;
      const outcome = blockOutcome(hit, { speed: speedOf(state), up: state.matrix[4] }, now);
      if (!outcome) continue;
      hits.delete(key);
      if (outcome !== "expired") cheer(blocker, racer, outcome);
    }
  };
  return {
    id: payload.mode,
    keepsRace: true,
    held: () => false,
    /** A blocker is not in the race: no checkpoints, no laps, no place while it runs. */
    outOfRace: (index) => roles[index] === BLOCKER,
    /** A computer racer gets itself out when stuck; the helicopter is its last resort. */
    selfRecovery: (index) => roles[index] === RACER,
    /** The blockers a racer minds: those against it, coming its way. */
    threats(index) {
      if (roles[index] !== RACER) return null;
      const out = [];
      trucks.forEach((other, i) => {
        if (roles[i] === BLOCKER && teams[i] !== teams[index] && other.state.heliTimer <= 0) out.push({ pos: other.state.pos, vel: worldVelocity(other.state) });
      });
      return out;
    },
    /** A classic blocker's HUD shows its racer's times. */
    timingTruck: (index) => timingTruck(index, teams, roles, variant),
    touch(a, b) {
      // A chase scores busts by distance, not blocks.
      if (following(env) || decided || chase) return;
      for (const [blocker, racer] of [[a, b], [b, a]]) {
        if (!blocksRacer(blocker, racer, teams, roles)) continue;
        const key = `${blocker},${racer}`;
        if (!hits.has(key)) hits.set(key, { at: base.sinceStart(), speed: speedOf(trucks[racer].state) });
        else hits.get(key).at = base.sinceStart();
      }
    },
    tick() {
      if (decided) { decided.forEach((place, i) => { race.trucks[i].place = place; }); return; }
      livePlaces();
      if (following(env)) return;
      tellHits();
      if (chase && base.sinceStart() >= 0) {
        const bust = chaseBust(chase, base.sinceStart(), roles, trucks.map((truck) => truck.state.pos), racerHome(roles, race.trucks));
        if (bust) { event = bust; events++; }
      }
      // The first racer home ends it for everyone; in the timed block so does the clock, for the Blockers.
      if (racerHome(roles, race.trucks) || (limit !== null && base.sinceStart() >= limit)) { decide(); base.end(); }
    },
    /** A racer drives the course (false: the worker's autopilot); a blocker frees its racer, or goes for the leader. */
    drive(truck, index) {
      if (roles[index] === RACER) return false;
      const target = blockerTarget(index, field());
      base.driveByPoint(truck);
      const point = target ? interceptPoint(truck.state.pos, target) : truck.state.pos;
      driveToPoint(truck.state, truck.extensionDriver, point, target ? 95 : 0, 0, S.GEAR, step, { detour: true });
      watchHeadway(truck, PATIENT_HEADWAY_S);
      return true;
    },
    view(since) {
      return {
        mode: payload.mode, variant, teams, roles, over: !!decided, places: decided ? [...decided] : null, winner,
        left: limit !== null ? Math.max(0, limit - Math.max(0, since ?? 0)) : null, event, events,
        ...(chase ? { busts: [...chase.busts], cool: Math.max(0, chase.coolUntil - Math.max(0, since ?? 0)) } : {}),
      };
    },
    // The winning team 10 points a truck, the others 4; a chase's cops their busts (the suspect none).
    score: (index) => (chase ? chase.busts[index] : decided ? (teams[index] === winner ? 10 : 4) : 0),
    finish() { if (!decided) decide(); base.end(); },
    netState: () => ({ teams, roles, over: !!decided, variant, event, events, ...(chase ? { busts: chase.busts, coolUntil: chase.coolUntil } : {}) }),
    applyNet(d) {
      if (Number.isFinite(d.events) && d.events !== events) { event = d.event ?? null; events = d.events; }
      if (chase && Array.isArray(d.busts)) { chase.busts = [...d.busts]; chase.coolUntil = Number(d.coolUntil) || 0; }
      if (d.over && !decided) { decide(); base.end(); }
    },
  };
}

const FACTORIES = new Map([
  ["hockey", { ground: rinkGround, create: createHockeyRuntime }],
  // Soccer plays Hockey's rules on its own pitch (soccer.js), the ground as it is.
  ["soccer", { ground: (ground) => ground, create: createHockeyRuntime }],
  ["tag", { ground: (ground) => ground, create: createTagRuntime }],
  ["cops-robbers", { ground: (ground) => ground, create: createCnrRuntime }],
  ["race-rumble", { ground: (ground) => ground, create: createRnrRuntime }],
  ["combat", { ground: (ground) => ground, create: createCombatRuntime }],
  ["freestyle", { ground: (ground) => ground, create: createFreestyleRuntime }],
]);

/** Extension-specific driving ground selected before trucks are constructed. */
export function extensionSessionGround(payload, ground) {
  return payload ? (FACTORIES.get(payload.mode)?.ground(ground) ?? ground) : ground;
}

/** Create a runtime from a registered simulation payload. */
export function createExtensionSession(payload, environment) {
  return payload ? (FACTORIES.get(payload.mode)?.create(payload, environment) ?? null) : null;
}
