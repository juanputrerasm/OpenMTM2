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
  ESCAPE_S, NUDGE_AFTER_S, NUDGE_FT_S, TURN_FLOOR, createHockey, hockeyAim, hockeyHeld,
  hockeyHeliSpot, hockeyPlaces, hockeyRoles, hockeySpot, hockeyStep, outsideRink, rinkGround,
} from "./hockey.js";
import {
  TAG_SPEED, coverOf, createTag, createTagDriver, roamRect, tagAdopt, tagDrivePoint, tagHeld,
  tagPlaces, tagRanks, tagSafe, tagStep,
} from "./tag.js";

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

function createHockeyRuntime(payload, env) {
  const base = commonRuntime(payload, env);
  const { trucks, race, step, levelBoxes, dirty, wallsAround } = env;
  const game = createHockey(payload.rink, payload.teams, payload.goals);
  /** Face-offs so far (the owner counts them; a follower places its own trucks when the count moves on). */
  let resets = 0, seenResets = -1;
  const puck = levelBoxes.find((box) => box.sitIndex === payload.rink.puck.sitIndex) ?? null;
  let roles = null;
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
      trucks.forEach((truck, index) => {
        truck.outside = truck.flight || !outsideRink(payload.rink, truck.state.pos) ? 0 : (truck.outside ?? 0) + step;
        if (truck.outside >= ESCAPE_S) { base.placeTruck(truck, hockeySpot(payload.rink, game.teams, index)); truck.outside = 0; }
      });
      hockeyPlaces(game).forEach((place, index) => { race.trucks[index].place = place; });
    },
    drive(truck, index) {
      const role = roles?.[index] ?? { role: "attack", side: 1 };
      const state = truck.state;
      const aim = puck ? hockeyAim(payload.rink, game.teams[index], role.role, { pos: state.pos, heading: state.euler[2] }, puck.pos, role.side, truck.extensionDriver) : { point: state.pos, speed: 0 };
      driveToPoint(state, truck.extensionDriver, aim.point, aim.speed, 0, S.GEAR, step, { back: false, turnFloor: TURN_FLOOR });
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
    },
    view() {
      return {
        mode: payload.mode, score: [...game.score], target: game.target, teams: game.teams, phase: game.phase,
        timer: Math.max(0, game.timer), event: game.event, events: game.events,
      };
    },
    score: (index) => game.goals[index],
    finish: base.end,
    netState: () => ({
      teams: game.teams, goals: game.goals, score: game.score, phase: game.phase, timer: game.timer, lastTouch: game.lastTouch,
      event: game.event, events: game.events, resets, over: !!race.over,
      puck: puck ? { pos: [...puck.pos], vel: [...puck.vel], bvel: [...puck.bvel], rates: [...puck.rates], euler: [...puck.euler] } : null,
    }),
    applyNet(d) {
      Object.assign(game, { teams: d.teams, goals: d.goals, score: d.score, phase: d.phase, timer: d.timer, lastTouch: d.lastTouch, event: d.event, events: d.events });
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
  const { trucks, race, step, levelBoxes, walls, course, specs, ramps, ground, weather, watchHeadway } = env;
  const game = createTag(trucks.length);
  if (Number.isInteger(payload.it) && payload.it >= 0 && payload.it < trucks.length) game.it = payload.it;
  race.roundSeconds = Math.max(1, Number(payload.minutes) || 5) * 60;
  const home = [specs.reduce((sum, spec) => sum + spec.start.pos[0], 0) / specs.length, specs.reduce((sum, spec) => sum + spec.start.pos[2], 0) / specs.length];
  const covers = [];
  for (const box of levelBoxes) { const cover = coverOf(box); if (cover) covers.push(cover); }
  for (const wall of walls ?? []) {
    const cover = coverOf({ pos: wall.pos, reach: Math.hypot(wall.size[0], wall.size[2]) * 0.5, tall: wall.size[1] });
    if (cover) covers.push(cover);
  }
  const rect = roamRect(roamPoints(course), home);
  const touches = [];
  trucks.forEach((truck) => { truck.tagDriver = createTagDriver(); });
  return {
    id: payload.mode,
    debug: { game },
    held: (index) => tagHeld(game, index, base.sinceStart()),
    touch: (a, b) => { if (!following(env)) touches.push([a, b]); },
    tick() {
      if (!following(env)) tagStep(game, base.sinceStart(), step, touches);
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
      const point = tagDrivePoint(truck.tagDriver, role, {
        clock: since, pos: truck.state.pos, itPos: trucks[game.it].state.pos, quarry, rect,
        covers, ramps, heightAt: (x, z) => ground.height(x, z),
        water: weather() === S.WEATHER.SNOW ? null : ground.waterLevelFt, random: Math.random,
      });
      base.driveByPoint(truck);
      driveToPoint(truck.state, truck.extensionDriver, point ?? truck.state.pos, point ? TAG_SPEED[truck.tagDriver.kind] ?? TAG_SPEED.wander : 0, 0, S.GEAR, step);
      if (role === "it" && tagHeld(game, index, since)) truck.headway = null;
      else watchHeadway(truck);
    },
    view(since) {
      return {
        mode: payload.mode, it: game.it, itTime: [...game.itTime], points: [...game.points],
        safe: tagSafe(game, game.safe, Math.max(0, since)) ? game.safe : -1,
        hold: Math.max(0, game.holdUntil - Math.max(0, since)),
        left: Math.max(0, race.roundSeconds - Math.max(0, since)), event: game.event, events: game.events,
      };
    },
    score: (index) => game.points[index],
    finish: base.end,
    netState: () => ({
      it: game.it, itTime: game.itTime, points: game.points, holdUntil: game.holdUntil, safe: game.safe, safeUntil: game.safeUntil,
      event: game.event, events: game.events, over: !!race.over,
    }),
    applyNet(d) {
      tagAdopt(game, d);
      if (d.over) base.end();
    },
  };
}

const FACTORIES = new Map([
  ["hockey", { ground: rinkGround, create: createHockeyRuntime }],
  ["tag", { ground: (ground) => ground, create: createTagRuntime }],
]);

/** Extension-specific driving ground selected before trucks are constructed. */
export function extensionSessionGround(payload, ground) {
  return payload ? (FACTORIES.get(payload.mode)?.ground(ground) ?? ground) : ground;
}

/** Create a runtime from a registered simulation payload. */
export function createExtensionSession(payload, environment) {
  return payload ? (FACTORIES.get(payload.mode)?.create(payload, environment) ?? null) : null;
}
