/*
  Deathmatch's runtime in the simulation worker (docs/EXTENSIONS.md; the rules are deathmatch.js). The damage is the
  shared combat core's (combat-core.js); this adds the round: the clock, the score (a wreck dealt, a wreck of its own),
  the respawn at a spawn spot with its hold and protection, the computer hunters (deathmatch-ai.js), and the places.
*/
import * as S from "../../vendor/openphotex/sim/mtm2/index.js";
import { adoptRules, revive, running, wheelsOn } from "./combat.js";
import { createCombatCore } from "./combat-core.js";
import { ramPoint, wantsRepair } from "./combat-ai.js";
import { DM_AI, backPoint, createHunter, hunterHit, hunterStep } from "./deathmatch-ai.js";
import { DM_REWARDS, HELI, RESPAWN, SPAWN, deathmatchPlaces, heliRefusal, pickSpawn, scoreOf } from "./deathmatch.js";
import { nearestCourseSpot } from "../heli-flight.js";
import { createTagDriver, tagDrivePoint, tagSpeed } from "./tag.js";
import { driveToPoint } from "../rumble-ai.js";
import { PATIENT_HEADWAY_S, chaseField, commonRuntime, worldVelocity } from "./party-common.js";

export function createDeathmatchRuntime(payload, env) {
  const base = commonRuntime(payload, env);
  const { trucks, race, step, ramps, ground, weather, watchHeadway } = env;
  race.roundSeconds = Math.max(1, Number(payload.minutes) || 5) * 60;
  const rules = { toughness: payload.toughness ?? "normal", respawn: payload.respawn !== false, repairs: !!payload.repairs, helicopter: !!payload.helicopter };
  const aggression = payload.aggression ?? "normal";
  const spots = Array.isArray(payload.spots) ? payload.spots : [];
  const n = trucks.length;
  /** Each truck's times wrecked by itself, times wrecked, times set down again; when it was wrecked, held and protected till. */
  const selfWrecks = new Array(n).fill(0), deaths = new Array(n).fill(0), respawns = new Array(n).fill(0);
  const downAt = new Array(n).fill(null), holdUntil = new Array(n).fill(-Infinity), protectUntil = new Array(n).fill(-Infinity);
  /** How long each truck has been still, and on its side or roof (seconds), for the Helicopter key (`HELI`). */
  const stillFor = new Array(n).fill(0), overFor = new Array(n).fill(0);
  let decided = null, winner = -1, rulesTaken = false;
  const clock = () => race.clock - race.startTime;

  const core = createCombatCore(env, { toughness: rules.toughness, credits: true, startCredits: 0, rewards: DM_REWARDS }, {
    onWrecked(i, by, remote) {
      downAt[i] = clock();
      // Its own machine counts it (and sends the counts).
      if (remote) return;
      deaths[i]++;
      if (by < 0) selfWrecks[i]++;
    },
    canDamage: (i) => clock() >= protectUntil[i],
    ownExtra: (i) => ({ sw: selfWrecks[i], dt: deaths[i], rs: respawns[i] }),
    markExtra: (i) => `r${respawns[i]}`,
    adoptExtra(j, e) {
      // Set down again on its own machine: whole here too, and protected as there.
      if ((e.rs | 0) > respawns[j]) {
        respawns[j] = e.rs | 0;
        revive(core.c, j);
        core.restore(j);
        downAt[j] = null;
        protectUntil[j] = clock() + RESPAWN.protectS;
      }
      selfWrecks[j] = e.sw | 0;
      deaths[j] = e.dt | 0;
    },
  });
  const { c, per, judgedHere, following } = core;
  const field = chaseField(env);
  // How each truck recovers when it is driving (a wreck turns it off; a respawn turns it back on).
  const recoveryAtStart = trucks.map((t) => ({ autopilot: !!t.recovery?.autopilot, player: !!t.recovery?.player, racing: !!t.recovery?.racing }));
  const hunters = trucks.map(() => createHunter());
  trucks.forEach((t) => { t.tagDriver = createTagDriver(); });
  const water = () => (weather() === S.WEATHER.SNOW ? null : ground.waterLevelFt);

  const scores = () => c.trucks.map((t, i) => scoreOf(t.wrecks, selfWrecks[i]));
  const places = () => deathmatchPlaces(c.trucks.map((t, i) => ({ score: scoreOf(t.wrecks, selfWrecks[i]), dealt: t.dealt, deaths: deaths[i] })));
  const setPlaces = (p) => p.forEach((place, i) => { race.trucks[i].place = place; });
  const end = () => {
    if (!decided) { decided = places(); winner = decided.indexOf(1); }
    setPlaces(decided);
    base.end();
  };

  /** Where truck `i` comes back: a spawn spot away from the others, on the ground. */
  function spawnFor(i) {
    const others = trucks.filter((t, j) => j !== i && running(c.trucks[j])).map((t) => t.state.pos);
    const spot = pickSpawn(spots, others, Math.random());
    if (!spot) return null;
    // The spot is already set over its drivable surface (a deck, a street mesh); the session's ground is only the
    // terrain and road there, so it can only raise the spot (frozen water in Snow), never sink it into the terrain.
    const y = ground.height(spot.pos[0], spot.pos[2]);
    return { pos: [spot.pos[0], Number.isFinite(y) ? Math.max(spot.pos[1], y + SPAWN.rideFt) : spot.pos[1], spot.pos[2]], heading: spot.heading };
  }

  /** Truck `i` back in the fight: set down whole at a spawn spot, held a moment and protected. */
  function respawn(i) {
    const t = trucks[i], spot = spawnFor(i);
    if (spot) base.placeTruck(t, spot);
    revive(c, i);
    core.restore(i);
    respawns[i]++;
    downAt[i] = null;
    const now = clock();
    holdUntil[i] = now + RESPAWN.holdS;
    protectUntil[i] = now + RESPAWN.holdS + RESPAWN.protectS;
    Object.assign(t.recovery, recoveryAtStart[i]);
    hunters[i] = createHunter();
    t.tagDriver = createTagDriver();
  }

  /** Why truck `i` may not call the helicopter now, or null (deathmatch.js `heliRefusal`). */
  const heliWhyNot = (i) => {
    const s = trucks[i].state, met = per[i].met;
    let nearestFt = Infinity;
    trucks.forEach((o, j) => {
      if (j === i || !running(c.trucks[j]) || o.state.heliTimer > 0) return;
      nearestFt = Math.min(nearestFt, Math.hypot(o.state.pos[0] - s.pos[0], o.state.pos[2] - s.pos[2]));
    });
    return heliRefusal(rules.helicopter, {
      running: running(c.trucks[i]), stillS: stillFor[i], overS: overFor[i],
      lastTouchS: met ? clock() - met.at : Infinity, nearestFt,
    });
  };
  /** The course as the helicopter flies it (the worker's own), or none. */
  const driven = env.course?.length ? S.orientedCourse(env.course, false) : [];

  const others = (i) => trucks.map((o, j) => ({
    index: j, pos: o.state.pos, vel: worldVelocity(o.state), hp: c.trucks[j].global / c.full.global, wheels: wheelsOn(c.trucks[j]),
    leader: race.trucks[j].place === 1, running: j !== i && running(c.trucks[j]) && o.state.heliTimer <= 0,
    protected: clock() < protectUntil[j],
  }));

  return {
    id: payload.mode,
    debug: { combat: c, per, loose: core.loose, selfWrecks, deaths, respawns, downAt, protectUntil, rules, stillFor, overFor },
    held: (i) => clock() < holdUntil[i],
    groundFor: core.groundFor,
    movableBoxes: core.movableBoxes,
    /** The Helicopter key (off by default): only stuck, with no one attacking (`HELI`). */
    heliAllowed: (i) => heliWhyNot(i) === null,
    /** It sets the truck down on the nearest stretch of course, or upright where it is on a track without one. */
    heliSpot(i) {
      const s = trucks[i].state, height = (x, z) => ground.height(x, z);
      return nearestCourseSpot(driven, s.pos, height) ?? { pos: [s.pos[0], height(s.pos[0], s.pos[2]), s.pos[2]], heading: s.euler[2] };
    },
    touch(a, b) {
      core.touch(a, b);
      // A hunter that met its prey backs off before it comes again.
      const now = clock();
      if (hunters[a]?.prey === b) hunterHit(hunters[a], now, { aggression });
      if (hunters[b]?.prey === a) hunterHit(hunters[b], now, { aggression });
    },
    tick() {
      if (decided) { setPlaces(decided); return; }
      core.measure();
      const now = clock();
      trucks.forEach((t, i) => {
        const s = t.state;
        stillFor[i] = Math.hypot(s.bvel[0], s.bvel[1], s.bvel[2]) < HELI.slowFtS ? stillFor[i] + step : 0;
        overFor[i] = s.matrix[4] < HELI.overUp ? overFor[i] + step : 0;
      });
      // A wreck lies a while, then comes back (the trucks judged here; the others come back on their own machine).
      if (rules.respawn) {
        trucks.forEach((t, i) => {
          if (downAt[i] === null || c.trucks[i].quit || !judgedHere(i)) return;
          if (now - downAt[i] >= RESPAWN.lieS) respawn(i);
        });
      }
      if (rules.repairs && payload.cpuRepairs !== false) core.cpuRepairs(wantsRepair);
      setPlaces(places());
      if (now >= race.roundSeconds) { end(); return; }
      // Without respawns the last truck running ends it early; online the owner decides that (`applyNet`).
      if (!rules.respawn && !following() && n >= 2 && c.trucks.filter(running).length <= 1) end();
    },
    /** A wreck stays put; a computer truck hunts (deathmatch-ai.js). */
    drive(truck, i) {
      const s = truck.state;
      if (!running(c.trucks[i])) {
        s.controls.throttle = 0;
        s.controls.brakeFront = s.controls.brakeRear = 1;
        return true;
      }
      const now = clock();
      const self = { pos: s.pos, hp: c.trucks[i].global / c.full.global };
      const field2 = others(i);
      const { mode, target } = hunterStep(hunters[i], self, field2, { now, roll: per[i].rand(), aggression });
      const o = target >= 0 ? field2[target] : null;
      base.driveByPoint(truck);
      let point = null, speed = 0;
      if (mode === "ram" && o) {
        point = ramPoint(s.pos, { pos: o.pos, vel: o.vel, heading: trucks[target].state.euler[2] });
        speed = DM_AI.ramFtS;
      } else if (mode === "back" && o) {
        point = backPoint(s.pos, o.pos);
        speed = DM_AI.chaseFtS * 0.6;
      } else {
        const ctx = {
          clock: now, pos: s.pos, itPos: o ? o.pos : s.pos, rect: field.rect, covers: field.covers, avoid: field.avoid, ramps,
          heightAt: (x, z) => ground.height(x, z), water: water(), random: Math.random,
        };
        const chase = mode === "chase" && o;
        const aimed = tagDrivePoint(truck.tagDriver, chase ? "it" : "free", {
          ...ctx, quarry: chase ? [{ pos: o.pos, vel: o.vel, place: 0 }] : null, shy: mode === "flee",
        });
        point = aimed && aimed.every(Number.isFinite) ? aimed : null;
        speed = point ? (chase ? DM_AI.chaseFtS : tagSpeed(truck.tagDriver, s.pos, truck.tagDriver.point)) : 0;
      }
      driveToPoint(s, truck.extensionDriver, point ?? s.pos, point ? speed : 0, 0, S.GEAR, step, { detour: true });
      if (clock() < holdUntil[i]) truck.headway = null;
      else watchHeadway?.(truck, PATIENT_HEADWAY_S);
      return true;
    },
    afterTruckStep: core.afterTruckStep,
    /** The repair key, when repairs are on, and leaving the fight (the player's, truck 0, unless told). */
    action(name, i = 0) {
      if (name === "repair") return rules.repairs ? core.repair(i) : { reason: "off" };
      if (name === "quit" && core.quit(i)) return { quit: true };
      return null;
    },
    view(since) {
      const now = Math.max(0, since ?? clock());
      return {
        mode: payload.mode, ...core.view(),
        // The credits are always earned; whether X spends them is the rule.
        repairs: rules.repairs, respawn: rules.respawn, helicopter: rules.helicopter,
        // The Helicopter key's state for each truck: null when it may call it, else why not.
        heli: trucks.map((_, i) => heliWhyNot(i)),
        left: Math.max(0, race.roundSeconds - now),
        scores: scores(), selfWrecks: [...selfWrecks], deaths: [...deaths], respawns: [...respawns],
        respawnIn: downAt.map((at, i) => (at === null || !rules.respawn || c.trucks[i].quit ? null : Math.max(0, RESPAWN.lieS - (clock() - at)))),
        protected: protectUntil.map((until) => Math.max(0, until - clock())),
        over: !!decided, winner: decided ? winner : -1, places: decided ? [...decided] : null,
      };
    },
    /** The Points column: the score (wrecks less the times it wrecked itself). */
    score: (i) => scoreOf(c.trucks[i].wrecks, selfWrecks[i]),
    finish: end,
    /** The owner's word: the end, the winner and the rules. */
    netState: () => ({ over: !!decided, winner: decided ? winner : -1, rules }),
    applyNet(d) {
      if (!d) return;
      // The owner's rules, once: everyone plays by the same.
      if (d.rules && !rulesTaken) {
        rulesTaken = true;
        adoptRules(c, { toughness: d.rules.toughness, credits: true, startCredits: 0 });
        rules.toughness = d.rules.toughness; rules.respawn = !!d.rules.respawn; rules.repairs = !!d.rules.repairs;
        rules.helicopter = !!d.rules.helicopter;
      }
      if (d.over && !decided) {
        end();
        if (d.winner >= 0) winner = d.winner;
      }
    },
    netOwn: core.netOwn,
    applyNetOwn: core.applyNetOwn,
  };
}
