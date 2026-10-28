/*
  When the announcer speaks (MONSTER_EXE_ANALYSIS.md 12, "Commentary (Trucksfx.c)"). Each frame the race screen hands
  over what the simulation reports; this turns changes in it into the game's triggers, `{ group, args, ctx }`, which
  go to the queue (game/commentary.js). As in the game, a trigger is made only for the player's truck and the truck
  the camera follows (`watched`); `ctx.camera` says the watched truck is in it (for the lines only said then).

  Drivers are numbered from 1 in the entrants' order, the player first. The game's own tests read some figures the
  simulation does not report; the port reads them from what it has:
  - a hard hull contact on the roof (roll): the truck going over, its up axis below level, at speed;
  - one on the two tail points alone (wheelie): the nose pitched up past `WHEELIE_PITCH` with the front wheels off;
  - the far side of the line (edge) and two trucks ahead at once (lead) are not told apart from a pass: lead is said
    when the player closes on the leader, edge is not said.
  Pure, so it runs under Node.
*/

/** All four wheels this far over the ground: in the air (0x4262e0). */
export const AIR_FT = 30;
/** The passing lines that need the camera's truck in them also need the two trucks this close, feet. */
export const CLOSE_FT = 60;
/** A collision between trucks this hard (the pair's force) is a clash. */
export const CLASH_FORCE = 2500;
/** Going over at this speed or more (ft/s) is a roll; the nose this far up (its forward axis's y) is a wheelie. */
export const ROLL_SPEED = 20, WHEELIE_PITCH = 0.6;
/** Ground types: water, deep water, frozen water, snow (MTM2_PHYSICS.md 2.3). */
const WATER = new Set([3, 13]), FROZEN = 8, SNOW = 9;
/** The dark weathers, where a truck without its lamps is in stealth mode (0x41bbd0). */
export const DARK_WEATHERS = new Set([7, 8]);

const typeOf = (surface) => Math.trunc((Number(surface) || 0) / 100);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * @param {{ drivers: number, player?: number, summit?: boolean, drag?: boolean }} options
 * @returns {{ update(frame: object): { group: string, args: number[], ctx: object }[] }}
 *   `frame`: `{ now, watched, blimp, weather, lamps, checkpoints, race: { started, trucks: [{ place, finished, missed,
 *   checkpoint, laps }] }, trucks: [{ pos, up, forwardY, speed, sound: { airborne, clearance, collide, hit, tires,
 *   heli } }] }`; `hitModel(sitIndex)` names the object a truck hit.
 */
export function createCommentaryWatcher({ drivers, player = 0, summit = false, drag = false, hitModel = () => null }) {
  let intro = false, go = false, blimpBefore = false;
  const was = [];
  const memory = (i) => was[i] ?? (was[i] = {
    place: null, ahead: null, ground: null, air: false, over: false, wheelie: false, heli: false, missed: false, finished: false,
    stealth: false, clashAt: -1e9,
  });

  return {
    update(frame) {
      const { now, race, trucks } = frame;
      const out = [];
      if (!race || !trucks?.[player] || drag) return out;
      const watched = Number.isInteger(frame.watched) ? frame.watched : player;
      const told = [...new Set([player, watched])].filter((i) => trucks[i]);
      const say = (group, args, ctx = {}) => out.push({ group, args: args.map((i) => i + 1), ctx: { camera: args.includes(watched), ...ctx } });

      // The start (0x4277ff) and GO (0x427640): at once.
      if (!intro) { intro = true; say(summit ? "introSummit" : "introRace", []); }
      if (race.started && !go) { go = true; say("go", []); }
      // The BlimpCam (0x428500).
      if (frame.blimp && !blimpBefore) say("blimp", []);
      blimpBefore = !!frame.blimp;
      if (!race.started) return out;

      for (const i of told) {
        const m = memory(i), rt = race.trucks[i], t = trucks[i], s = t.sound ?? {};
        if (!rt) continue;

        // Places (0x483600, 0x487300), never in a Summit Rumble.
        if (!summit && !rt.finished && Number.isInteger(rt.place)) {
          const aheadNow = race.trucks.findIndex((o, k) => k !== i && o.place === rt.place - 1);
          const settled = (rt.laps ?? 0) > 0 || (rt.checkpoint ?? 0) >= 1;
          if (m.place !== null && rt.place < m.place) {
            // A place gained: the truck passed and the pass of the player's own.
            const passed = race.trucks.findIndex((o, k) => k !== i && o.place === rt.place + 1);
            say("goingYourWay", [i]);
            if (i === player && passed >= 0 && settled) {
              const close = flat(t.pos, trucks[passed].pos) < CLOSE_FT;
              say("pass", [i, passed], { camera: (i === watched || passed === watched) && close, passedLeader: rt.place === 1 });
            }
          } else if (i === player && settled && aheadNow >= 0 && aheadNow !== m.ahead) {
            // A new truck ahead to catch.
            const close = flat(t.pos, trucks[aheadNow].pos) < CLOSE_FT;
            say(race.trucks[aheadNow].place === 1 ? "lead" : "move", [i, aheadNow], { camera: (i === watched || aheadNow === watched) && close });
          }
          m.place = rt.place;
          m.ahead = aheadNow;
        }

        // A clash with another truck (0x4894a0): the pair's force, the nearest truck the other one.
        if ((s.collide ?? 0) > CLASH_FORCE && now - m.clashAt > 1) {
          let other = -1, best = Infinity;
          trucks.forEach((o, k) => { if (k !== i && o) { const d = flat(o.pos, t.pos); if (d < best) { best = d; other = k; } } });
          if (other >= 0) { say("clash", [i, other], { camera: i === watched || other === watched }); m.clashAt = now; }
        }
        // A cow (0x424890).
        if (s.hit && /^cow\.bin$/i.test(String(hitModel(s.hit.sitIndex) ?? ""))) say("cow", [i]);

        // The ground under the wheels turning to water, frozen water or snow (0x46a2c0).
        const types = (s.tires ?? []).filter((x) => x.onGround).map((x) => typeOf(x.surface));
        const ground = types.some((x) => WATER.has(x)) ? "water" : types.includes(FROZEN) ? "spin" : types.includes(SNOW) ? "ice" : "dry";
        if (m.ground !== null && ground !== m.ground && ground !== "dry") say(ground, [i]);
        m.ground = ground;

        // All four wheels high off the ground (0x476b80).
        const air = s.airborne === 4 && (s.clearance ?? 0) > AIR_FT;
        if (air && !m.air) {
          const lap = frame.checkpoints > 0 ? (rt.checkpoint ?? 0) / frame.checkpoints : 0;
          say("air", [i], { nearFinish: !summit && lap > 0.75 });
        }
        m.air = air;

        // Going over at speed (roll) and up on the tail (wheelie), 0x475960.
        const over = (t.up ?? 1) < 0 && (s.speed ?? 0) > ROLL_SPEED;
        if (over && !m.over) say("roll", [i]);
        m.over = (t.up ?? 1) < 0;
        const tires = s.tires ?? [];
        const wheelie = (t.forwardY ?? 0) > WHEELIE_PITCH && tires.length === 4 && !tires[0].onGround && !tires[1].onGround && (tires[2].onGround || tires[3].onGround);
        if (wheelie && !m.wheelie) say("wheelie", [i]);
        m.wheelie = wheelie;

        // The helicopter's flight starting (0x46ed90).
        if (s.heli && !m.heli) say("flipped", [i]);
        m.heli = !!s.heli;

        // The player's missed checkpoint (0x46c0e0).
        if (i === player && !summit && rt.missed && !m.missed) say("missedCheckpoint", [i]);
        m.missed = !!rt.missed;

        // Finishing (0x52ee50): the winner's lines, else "has finished".
        if (!summit && rt.finished && !m.finished) say(rt.place === 1 ? "finishWinner" : "hasFinished", [i]);
        m.finished = !!rt.finished;

        // Driving with no lamps in the dark (0x41bbd0).
        const dark = DARK_WEATHERS.has(frame.weather) && frame.lamps?.[i] === 0;
        if (dark && !m.stealth) say("stealth", [i]);
        m.stealth = dark;
      }
      return out;
    },
  };
}
