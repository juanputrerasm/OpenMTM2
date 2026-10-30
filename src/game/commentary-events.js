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

  With `cp3`, Community Patch 3's calls are made too (docs/CP3_EXE_ANALYSIS.md 4): the intro chosen by track and
  weather, the final lap, road signs, barricades and trains, the Summit Rumble's points, and a drag pass from the
  staging to the heat's winner.
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
/** CP3: the weathers with an intro of their own (Foggy, Dense Fog, Snow, Night, Pitch Black), and Snow's number. */
export const CP3_INTRO_WEATHERS = new Set([2, 3, 5, 7, 8]);
const SNOW_WEATHER = 5;
/** CP3: the box types its hit calls name (a post: road signs; a barricade; a train), and each one's least gap, s. */
export const CP3_HIT_CALLS = Object.freeze({ 1: { group: "sign", gap: 40 }, 2: { group: "barricade", gap: 60 }, 10: { group: "train", gap: 0 } });
/** CP3: a holding call every this many points scored on top of the Summit. */
export const CP3_SUMMIT_HOLD_POINTS = 10;
/** CP3's drag countdowns: said this far into the 30 s prestage and stage phases, with the seconds left. */
export const CP3_DRAG_CALLS_S = Object.freeze([10, 20]);
const DRAG_PHASE_S = 30;
/** The tree's lamps (game/drag-race.js `LAMP`): prestaged and staged. */
const LAMP_PRESTAGE = 1, LAMP_STAGE = 2;

/**
 * CP3's race intro (docs/CP3_EXE_ANALYSIS.md 4.3): Summit Rumble's own; on Snake Canyon half the time its own; in the
 * five weathers half the time the night (Night, Pitch Black: half of those), snow (Snow: half) or else the fog lines;
 * otherwise the race intro.
 */
export function cp3IntroGroup({ summit = false, sit = "", weather = 0, random = Math.random }) {
  if (summit) return "introSummit";
  const coin = () => Math.floor(random() * 2) === 1;
  if (/^snake\.sit$/i.test(String(sit).split(/[\\/]/).pop() ?? "") && coin()) return "introSnake";
  if (CP3_INTRO_WEATHERS.has(weather) && coin()) {
    if (DARK_WEATHERS.has(weather) && coin()) return "introNight";
    if (weather === SNOW_WEATHER && coin()) return "introSnow";
    return "introFog";
  }
  return "introRace";
}

const typeOf = (surface) => Math.trunc((Number(surface) || 0) / 100);
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * @param {{ drivers: number, player?: number, summit?: boolean, drag?: boolean, cp3?: boolean, sit?: string,
 *   weekend?: boolean, random?: () => number, hitType?: (sitIndex: number) => number | null }} options
 * @returns {{ update(frame: object): { group: string, args: number[], ctx: object }[] }}
 *   `frame`: `{ now, watched, blimp, weather, lamps, checkpoints, race: { started, trucks: [{ place, finished, missed,
 *   checkpoint, laps }] }, trucks: [{ pos, up, forwardY, speed, sound: { airborne, clearance, collide, hit, tires,
 *   heli } }] }`; `hitModel(sitIndex)` names the object a truck hit, `hitType(sitIndex)` its box type. With `cp3` the
 *   frame also carries `race.laps` (the race's), `race.summit.states`, each truck's `score`, and in a drag race
 *   `race.drag` (`phase`, `phaseTime`, `lamps`) and each truck's `dq`, `dqLine` and `reaction`.
 */
export function createCommentaryWatcher({
  drivers, player = 0, summit = false, drag = false, hitModel = () => null, hitType = () => null,
  cp3 = false, sit = "", weekend = false, random = Math.random,
}) {
  let intro = false, go = false, blimpBefore = false;
  const was = [];
  const memory = (i) => was[i] ?? (was[i] = {
    place: null, ahead: null, ground: null, air: false, over: false, wheelie: false, heli: false, missed: false, finished: false,
    stealth: false, clashAt: -1e9, laps: null, hit: null, summitState: null, summitScore: null, held: 0,
    lamps: 0, dq: null, countdowns: 0,
  });
  // CP3: when each hit call was last made, the Summit's points leader, the drag pass's phase, its jump and winner told.
  const hitAt = {};
  let summitLeader = -1, dragPhase = null, jumpTold = false, winnerTold = false;

  /** CP3's drag calls: staging, the countdowns, the red light, the jump, the disqualifications and the winner. */
  function dragCalls(frame, say) {
    const { race } = frame, d = race.drag;
    if (!d) return;
    if (d.phase !== dragPhase) { dragPhase = d.phase; for (const m of was) if (m) m.countdowns = 0; }
    race.trucks.forEach((rt, i) => {
      if (!rt || !frame.trucks[i]) return;
      const m = memory(i), lamps = d.lamps?.[i] ?? 0;
      // Prestaged and staged, at once; while not, the seconds left at 10 s and 20 s into the phase.
      if ((lamps & LAMP_PRESTAGE) && !(m.lamps & LAMP_PRESTAGE) && !(lamps & LAMP_STAGE)) say("dragPrestaged", [i]);
      if ((lamps & LAMP_STAGE) && !(m.lamps & LAMP_STAGE)) say("dragStaged", [i]);
      m.lamps = lamps;
      const waiting = d.phase === "prestage" ? !(lamps & LAMP_PRESTAGE) : d.phase === "stage" ? !(lamps & LAMP_STAGE) : false;
      const due = CP3_DRAG_CALLS_S[m.countdowns];
      if (waiting && !rt.dq && due !== undefined && (d.phaseTime ?? 0) >= due) {
        m.countdowns += 1;
        say(d.phase === "prestage" ? "dragPrestageTime" : "dragStageTime", [i], { numbers: { 2: DRAG_PHASE_S - due } });
      }
      // Out: the red light, a line crossed, backing up, the time limit ("not staged" has no line).
      if (rt.dq && rt.dq !== m.dq) {
        const group = rt.dq === "red light" ? "dragRedLight" : rt.dq === "reversing" ? "dragReversing" : rt.dq === "timeout" ? "dragTimeLimit"
          : rt.dq === "out of lane" ? (rt.dqLine === "edge" ? "dragOutsideEdge" : "dragCentreLine") : null;
        if (group) say(group, [i]);
      }
      m.dq = rt.dq ?? null;
    });
    // The jump: once both trucks are off the line, the quicker one has it on the other.
    const off = race.trucks.map((rt, i) => ({ rt, i })).filter(({ rt }) => rt && Number.isFinite(rt.reaction) && !rt.dq);
    if (!jumpTold && off.length === 2) {
      jumpTold = true;
      const [a, b] = off[0].rt.reaction <= off[1].rt.reaction ? off : [off[1], off[0]];
      say("dragJump", [a.i, b.i]);
    }
    // The heat's winner: the first truck home that is not out (a weekend's "won the heat", else the winner's lines).
    const won = race.trucks.findIndex((rt) => rt && rt.finished && rt.place === 1 && !rt.dq);
    if (!winnerTold && won >= 0) { winnerTold = true; say(weekend ? "dragHeatWinner" : "finishWinner", [won]); }
  }

  /** CP3's Summit Rumble calls (docs/CP3_EXE_ANALYSIS.md 4.4), for every truck. */
  function summitCalls(frame, say) {
    const states = frame.race.summit?.states;
    if (!states) return;
    frame.race.trucks.forEach((rt, i) => {
      if (!rt) return;
      const m = memory(i), state = states[i], score = rt.score ?? 0;
      if (m.summitState !== null) {
        // Points scored on top: every tenth time, the holding lines.
        if (state === 2 && score > m.summitScore && ++m.held % CP3_SUMMIT_HOLD_POINTS === 0) say("summitHold", [i]);
        // Off the summit with a penalty: knocked off; off the top but still on the summit: stepped out.
        if (state === 0 && m.summitState !== 0 && score < m.summitScore) say("summitKnocked", [i]);
        else if (state === 1 && m.summitState === 2) say("summitOut", [i]);
      }
      m.summitState = state;
      m.summitScore = score;
    });
    // The points leader changing.
    let best = -1, top = 0;
    frame.race.trucks.forEach((rt, i) => { if (rt && (rt.score ?? 0) > top) { top = rt.score; best = i; } });
    if (best < 0) summitLeader = -1;
    else if (best !== summitLeader) { summitLeader = best; say("summitLeader", [best]); }
  }

  return {
    update(frame) {
      const { now, race, trucks } = frame;
      const out = [];
      if (!race || !trucks?.[player] || (drag && !cp3)) return out;
      const watched = Number.isInteger(frame.watched) ? frame.watched : player;
      const told = [...new Set([player, watched])].filter((i) => trucks[i]);
      const say = (group, args, ctx = {}) => out.push({ group, args: args.map((i) => i + 1), ctx: { camera: args.includes(watched), ...ctx } });

      // CP3 talks a drag pass through: GO, then its own calls only.
      if (drag) {
        if (race.started && !go) { go = true; say("go", []); }
        dragCalls(frame, say);
        return out;
      }

      // The start (0x4277ff) and GO (0x427640): at once.
      if (!intro) {
        intro = true;
        say(cp3 ? cp3IntroGroup({ summit, sit, weather: frame.weather, random }) : summit ? "introSummit" : "introRace", []);
      }
      if (race.started && !go) { go = true; say("go", []); }
      // The BlimpCam (0x428500).
      if (frame.blimp && !blimpBefore) say("blimp", []);
      blimpBefore = !!frame.blimp;
      if (!race.started) return out;
      if (cp3 && summit) summitCalls(frame, say);

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
        const cow = s.hit && /^cow\.bin$/i.test(String(hitModel(s.hit.sitIndex) ?? ""));
        if (cow) say("cow", [i]);
        // CP3: a road sign, a barricade or a train, each new hit once, signs and barricades with a least gap.
        if (cp3 && s.hit && !cow && s.hit.sitIndex !== m.hit) {
          const call = CP3_HIT_CALLS[hitType(s.hit.sitIndex)];
          if (call && now - (hitAt[call.group] ?? -1e9) >= call.gap) { hitAt[call.group] = now; say(call.group, [i]); }
        }
        m.hit = s.hit?.sitIndex ?? null;
        // CP3: the player starting the last lap of a race of more than one.
        const total = race.laps ?? 0;
        if (cp3 && i === player && !summit && total > 1 && m.laps !== null && rt.laps === total - 1 && m.laps < total - 1) say("finalLap", [i]);
        m.laps = rt.laps ?? 0;

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
