/*
  Race-facing extension adapter. The race screen calls these generic functions; each shipped mode's
  details stay in its entry of `ADAPTERS`, behind this registry boundary. An entry may give:

  - `prepare(extension, ctx)`: the race data (`{ id, dress, course?, walls?, start, simulation }`); `ctx.picks[i]` is
    the team (and role) truck i was given in the Computer Opponents dialog, `{ team, role }` or null;
  - `labels(state, entrants, baseLabel)` and `marks(state, count)`: the names over the trucks and their colours (a
    label's line may be coloured pieces, `[{ text, color }]`, render/name-tag-style.js);
  - `mapMarks(state, count)` and `mapPoints(state)`: the trucks' colours and markers on the map, and other things on it;
  - `markerTarget(state)`: the truck the arrow hangs over, or -1;
  - `finderTarget(state, index, positions)`: where the checkpoint finder points for truck `index`, or null for
    nowhere (undefined keeps the checkpoints);
  - `resultTime(length, race)`: the Winner's Circle time, or undefined for each truck's own;
  - `hud(state, race, entrants, helpers, previous)`: the HUD's rows, messages and sounds (rows null keeps the race's
    own; `sounds` are `{ kind: "horn" | "yeehaw", truck }`); `helpers.watched` is the truck the HUD is for; what it
    returns as `memory` comes back in the next frame's `previous`;
  - `toWire` and `fromWire`: the mode's state over the network (the owner's); `ownToWire` and `ownFromWire`, for a
    mode that judges each truck on the machine that drives it (Combat), the state each machine sends of its trucks;
  - `out(state, index)`: whether truck `index` is out of the race (wrecked, or left it): a player who is out watches on;
  - `keyAction(state, index)`: what the Crash Damage key does in a mode that owns it (the manifest's `damageKey`):
    `{ action, message }`, the action sent to the simulation (`modeAction`) and a line to show, either one optional.
*/
import { extensionById } from "./loader.js";
import { hockeyFromWire, hockeyRink, hockeySpot, hockeyTeams, hockeyToWire, rinkBoxes } from "./hockey.js";
import { soccerPitch, pitchBoxes } from "./soccer.js";
import { IT_COLOUR, TAG64_ROUND_S, TAG_MTM64, tagFromWire, tagScoring, tagToWire } from "./tag.js";
import { COP_COLOUR, COP_NAME, ROBBER_COLOUR, ROBBER_NAME, cnrFromWire, cnrToWire } from "./cops-robbers.js";
import {
  BLOCKER, CHASE_BUST_FT, CHASE_COLOURS, CHASE_ROLE_NAMES, RACER, RNR_CHASE, RNR_TIMED, ROLE_NAMES, SIDE_NAMES, rnrFromWire, rnrTeams,
  rnrToWire, rnrVariant, timingTruck,
} from "./race-rumble.js";
import { TEAM_COLOURS, TEAM_NAMES, pickedTeams } from "./teams.js";
import { OUT_LABEL, WHEEL_NAMES, WRECKED_LABEL, combatFromWire, combatOwnFromWire, combatOwnToWire, combatToWire } from "./combat.js";

const none = (count) => Array.from({ length: count }, () => null);
const nearest = (positions, from, pick) => {
  let best = null, bestD = Infinity;
  positions.forEach((p, i) => {
    if (!p || !pick(i)) return;
    const d = Math.hypot(p[0] - from[0], p[2] - from[2]);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
};

// ---- Hockey and Soccer: two teams and a ball ----

function ballGameHud(outMessage) {
  return (state, race, entrants, { t, formatRaceTime }, previous) => {
    const me = race.trucks[0];
    const nameOf = (index) => index === 0 ? t("You") : entrants[index]?.name ?? "";
    const flashes = [];
    let phase = previous.phase ?? null;
    const mine = state.teams[0];
    const clock = state.suddenDeath ? [t("Clock:"), t("Sudden death")]
      : state.left !== null && state.left !== undefined ? [t("Time Remaining:"), formatRaceTime(state.left)]
      : [t("Clock:"), formatRaceTime(race.clock)];
    const rows = [
      [`${t(TEAM_NAMES[0])}:`, String(state.score[0])], [`${t(TEAM_NAMES[1])}:`, String(state.score[1])],
      clock, ["", ""], [t("Team:"), t(TEAM_NAMES[mine])], [t("Goals:"), String(me.score)],
    ];
    if (state.events !== previous.events) {
      const event = state.event;
      if (event?.kind === "goal") {
        const by = event.scorer >= 0 ? ` (${nameOf(event.scorer)})` : event.own >= 0 ? ` (${t("own goal, <<1>>", nameOf(event.own))})` : "";
        flashes.push(`${t("<<1>> scores!", t(TEAM_NAMES[event.team]))}${by}  ${state.score[0]} - ${state.score[1]}`);
      } else if (event?.kind === "out") flashes.push(t(outMessage));
      else if (event?.kind === "sudden") flashes.push(t("Time! Tied <<1>> - <<2>>: sudden death, the next goal wins.", state.score[0], state.score[1]));
    }
    if (state.phase === "faceoff" && phase !== "faceoff" && state.events > 0) {
      flashes.push(state.suddenDeath ? t("Face-off! Sudden death: the next goal wins") : t("Face-off! First to <<1>>", state.target));
    } else if (state.phase === "over" && phase !== "over") {
      const winner = state.winner ?? (state.score[0] === state.score[1] ? -1 : state.score[0] > state.score[1] ? 0 : 1);
      flashes.push(winner < 0 ? t("Time! A draw, <<1>> - <<2>>.", state.score[0], state.score[1]) : t("<<1>> wins!", t(TEAM_NAMES[winner])));
    }
    phase = state.phase;
    return { rows, flashes, events: state.events, phase, team: mine };
  };
}

/** A label (one line, or `[first, second]`) with a line added under it. */
const withLine = (label, line) => [...(Array.isArray(label) ? label : [label]), line];
const teamLabels = (state, entrants, baseLabel) => entrants.map((entrant, index) => {
  const label = baseLabel(entrant, index);
  return label ? withLine(label, TEAM_NAMES[state.teams[index]]) : entrant.name;
});
/** The teams the dialog picked (`ctx.picks`), as team numbers. */
const pickedTeamsOf = (picks, count) => Array.from({ length: count }, (_, i) => picks?.[i]?.team ?? null);
const teamMarks = (state, count) => Array.from({ length: count }, (_, index) => ({ color: TEAM_COLOURS[state.teams[index]] }));

const BALL_GAME = {
  labels: teamLabels,
  marks: teamMarks,
  mapMarks: teamMarks,
  mapPoints: (state) => (state.ball ? [{ pos: state.ball, color: "#ffffff" }] : []),
  // Every truck's finder points at the ball.
  finderTarget: (state) => state.ball ?? null,
  resultTime: (_length, race) => race.clock,
  toWire: hockeyToWire,
  fromWire: hockeyFromWire,
};

const HOCKEY = {
  ...BALL_GAME,
  prepare(extension, { build, entrants, length, groundHeightAt, settings, picks }) {
    const rink = hockeyRink(rinkBoxes(build), groundHeightAt, build.waterLevelFt);
    if (!rink) throw new Error("This track has no hockey rink: Hockey needs Breakneck Ridge's frozen lake, its puck and its two goals.");
    const teams = picks ? pickedTeams(entrants.length, pickedTeamsOf(picks, entrants.length), 2) : hockeyTeams(entrants.length);
    return {
      id: extension.id,
      dress: { mode: extension.id, rink, teams },
      course: [],
      walls: [...(build.sim.walls ?? []), ...rink.boards],
      start: (index) => hockeySpot(rink, teams, index),
      simulation: { mode: extension.id, rink, teams, goals: length, minutes: settings?.minutes ?? 0, suddenDeath: settings?.suddenDeath !== false },
    };
  },
  hud: ballGameHud("Puck out of the rink. Face-off!"),
};

const SOCCER = {
  ...BALL_GAME,
  prepare(extension, { build, entrants, length, groundHeightAt, settings, picks }) {
    const pitch = soccerPitch(pitchBoxes(build), groundHeightAt);
    if (!pitch) throw new Error("This track has no soccer pitch: Soccer needs Highlands Rally's ball and its four goal posts.");
    const teams = pickedTeams(entrants.length, pickedTeamsOf(picks, entrants.length), 2);
    return {
      id: extension.id,
      dress: { mode: extension.id, rink: pitch, teams },
      course: [],
      start: (index) => hockeySpot(pitch, teams, index),
      simulation: { mode: extension.id, rink: pitch, teams, goals: length, minutes: settings?.minutes ?? 0, suddenDeath: settings?.suddenDeath !== false },
    };
  },
  hud: ballGameHud("Ball out of play. Kick-off!"),
};

// ---- Tag ----

const TAG = {
  prepare: (extension, { length, settings }) => {
    const scoring = tagScoring(settings);
    return {
      id: extension.id,
      dress: { mode: extension.id, marker: IT_COLOUR },
      start: (_index, fallback) => fallback,
      // MTM64's rules play a fixed 5 minute round.
      simulation: { mode: extension.id, minutes: scoring.rules === TAG_MTM64 ? TAG64_ROUND_S / 60 : length, scoring },
    };
  },
  mapMarks: (state, count) => Array.from({ length: count }, (_, i) => (i === state.it ? { color: IT_COLOUR, marker: "arrow" } : null)),
  markerTarget: (state) => state.it,
  // It looks for the nearest truck; the others for It.
  finderTarget: (state, index, positions) => (index === state.it
    ? nearest(positions, positions[index] ?? [0, 0, 0], (i) => i !== index && i !== state.safe)
    : positions[state.it] ?? null),
  resultTime: (length, race) => (race?.extension?.rules === TAG_MTM64 ? TAG64_ROUND_S : length * 60),
  hud(state, race, entrants, helpers, previous) {
    if (state.rules === TAG_MTM64) return tag64Hud(state, race, entrants, helpers, previous);
    const { t, formatRaceTime, summitBoard } = helpers;
    const me = race.trucks[0];
    const nameOf = (index) => index === 0 ? t("You") : entrants[index]?.name ?? "";
    const flashes = [];
    let phase = previous.phase ?? null;
    const rate = state.rates?.[0] ?? 0;
    const zone = state.it === 0 || state.proximity === false ? "-" : rate > 0 ? t("+<<1>> a second", rate) : t("too far from It");
    const rows = [
      [t("Time Remaining:"), formatRaceTime(state.left)], [t("Points:"), String(Math.round(state.points[0]))],
      [t("It:"), state.it === 0 ? t("You") : entrants[state.it]?.name ?? ""], [t("Scoring:"), zone],
      [t("It time:"), formatRaceTime(state.itTime[0])], [t("Place:"), `${me.place}/${race.trucks.length}`], ["", ""],
      ...summitBoard(race.trucks, entrants.map((entrant) => entrant.name)),
    ];
    if (state.events !== previous.events) {
      const event = state.event;
      const points = event?.points ? `${event.points}` : "";
      if (event?.to === 0) flashes.push(`${t("<<1>> tagged you. You're It!", nameOf(event.from))}${points ? ` (-${points})` : ""}`);
      else if (event?.from === 0) flashes.push(`${t("You tagged <<1>>!", nameOf(event.to))}${points ? ` (+${points})` : ""}`);
      else if (event) flashes.push(`${t("<<1>> tagged <<2>>!", nameOf(event.from), nameOf(event.to))}${points ? ` (+${points})` : ""}`);
    }
    if (phase === null && race.started) {
      flashes.push(state.it === 0 ? t("You're It! Wait for it...") : t("<<1>> is It! Stay close to score.", nameOf(state.it)));
      phase = "started";
    }
    return { rows, flashes, events: state.events, phase };
  },
  toWire: tagToWire,
  fromWire: tagFromWire,
};

/** Tag's HUD under MTM64's rules: whole points, the rate now, and the passes and out-of-bounds penalties. */
function tag64Hud(state, race, entrants, { t, formatRaceTime, summitBoard }, previous) {
  const me = race.trucks[0];
  const nameOf = (index) => index === 0 ? t("You") : entrants[index]?.name ?? "";
  const flashes = [];
  let phase = previous.phase ?? null;
  const rate = state.rates?.[0] ?? 0;
  const rows = [
    [t("Time Remaining:"), formatRaceTime(state.left)], [t("Points:"), t("<<1>> points", Math.floor(state.points[0]))],
    [t("It:"), state.it === 0 ? t("You") : entrants[state.it]?.name ?? ""],
    [t("Scoring:"), state.it === 0 ? "-" : t("+<<1>> a second", Math.round(rate * 10) / 10)],
    [t("It time:"), formatRaceTime(state.itTime[0])], [t("Place:"), `${me.place}/${race.trucks.length}`], ["", ""],
    ...summitBoard(race.trucks, entrants.map((entrant) => entrant.name)),
  ];
  if (state.events !== previous.events) {
    const event = state.event;
    if (event?.kind === "out") flashes.push(event.to === 0 ? t("Out of bounds: you're It!") : t("<<1>> went out of bounds and is It!", nameOf(event.to)));
    else if (event?.from === 0) flashes.push(t("You passed It to <<1>>! +<<2>>", nameOf(event.to), event.points));
    else if (event?.to === 0) flashes.push(t("<<1>> passed It to you!", nameOf(event.from)));
    else if (event) flashes.push(t("<<1>> passed It to <<2>>!", nameOf(event.from), nameOf(event.to)));
  }
  if (phase === null && race.started) {
    flashes.push(state.it === 0 ? t("You're It! Get within 25 ft of a truck to pass it on.") : t("<<1>> is It! Stay close, but not within 25 ft.", nameOf(state.it)));
    phase = "started";
  }
  return { rows, flashes, events: state.events, phase };
}

// ---- Cops & Robbers ----

const roleColour = (state, i) => (i === state.robber ? ROBBER_COLOUR : COP_COLOUR);
const CNR = {
  prepare: (extension, { length }) => ({
    id: extension.id,
    dress: { mode: extension.id, marker: ROBBER_COLOUR },
    start: (_index, fallback) => fallback,
    simulation: { mode: extension.id, minutes: length },
  }),
  labels: (state, entrants, baseLabel) => entrants.map((entrant, index) => {
    const label = baseLabel(entrant, index);
    const role = index === state.robber ? ROBBER_NAME : COP_NAME;
    return label ? `${label}\n${role}` : entrant.name;
  }),
  marks: (state, count) => Array.from({ length: count }, (_, i) => ({ color: roleColour(state, i) })),
  mapMarks: (state, count) => Array.from({ length: count }, (_, i) => (i === state.robber ? { color: ROBBER_COLOUR, marker: "arrow" } : { color: COP_COLOUR })),
  markerTarget: (state) => state.robber,
  // The cops look for the robber; the robber for the nearest cop.
  finderTarget: (state, index, positions) => (index === state.robber
    ? nearest(positions, positions[index] ?? [0, 0, 0], (i) => i !== index)
    : positions[state.robber] ?? null),
  resultTime: (length) => length * 60,
  hud(state, race, entrants, { t, formatRaceTime, summitBoard }, previous) {
    const me = race.trucks[0];
    const nameOf = (index) => index === 0 ? t("You") : entrants[index]?.name ?? "";
    const flashes = [];
    let phase = previous.phase ?? null;
    const robber = state.robber === 0;
    const rows = [
      [t("Time Remaining:"), formatRaceTime(state.left)], [t("Points:"), String(Math.round(state.points[0]))],
      [t("Robber:"), robber ? t("You") : nameOf(state.robber)],
      robber ? [t("Safe for:"), state.safe > 0 ? formatRaceTime(state.safe) : "-"] : [t("Captures:"), String(state.captures[0])],
      [t("Place:"), `${me.place}/${race.trucks.length}`], ["", ""],
      ...summitBoard(race.trucks, entrants.map((entrant) => entrant.name)),
    ];
    if (state.events !== previous.events && state.event?.kind === "capture") {
      const by = state.event.by;
      if (robber) flashes.push(t("<<1>> captured you! The helicopter takes you away.", nameOf(by)));
      else if (by === 0) flashes.push(t("You captured the robber!"));
      else flashes.push(t("<<1>> captured <<2>>!", nameOf(by), nameOf(state.robber)));
    }
    if (phase === null && race.started) {
      flashes.push(robber ? t("You're the robber! Get away!") : t("<<1>> is the robber. Turn it over, then touch it!", nameOf(state.robber)));
      phase = "started";
    }
    return { rows, flashes, events: state.events, phase };
  },
  toWire: cnrToWire,
  fromWire: cnrFromWire,
};

// ---- Race & Rumble ----

/**
 * A chase's HUD: the suspect sees the time left above its own times; a cop the time left, the suspect's lap and name,
 * and its busts. The start says who is who, 10 s left is warned, a bust sounds the cop's horn, the end says how it went.
 */
function chaseHud(state, race, entrants, { t, formatRaceTime, watched = 0 }, previous) {
  const flashes = [], sounds = [];
  let phase = previous.phase ?? null;
  const suspect = state.roles.indexOf(RACER);
  const isSuspect = watched === suspect;
  const nameOf = (index) => (index === 0 ? t("You") : entrants[index]?.name ?? "");
  const left = state.left ?? 0;
  if (phase === null) {
    flashes.push(isSuspect
      ? t("You are the suspect: finish the race within <<1>>.", formatRaceTime(left))
      : t("Bust the suspect, <<1>>: get within <<2>> ft.", nameOf(suspect), CHASE_BUST_FT));
    phase = "started";
  }
  if (phase === "started" && left > 0 && left <= 10 && !state.over) {
    flashes.push(t("10 seconds!"));
    phase = "ten";
  }
  const events = state.events ?? 0;
  if (events !== (previous.events ?? 0) && state.event?.kind === "bust" && state.event.by >= 0) {
    const by = state.event.by;
    sounds.push({ kind: "horn", truck: by });
    flashes.push(by === watched ? t("You busted the suspect!") : isSuspect ? t("<<1>> busted you!", nameOf(by)) : t("<<1>> busted the suspect!", nameOf(by)));
  }
  if (state.over && phase !== "over") {
    const home = race?.trucks?.[suspect]?.finished && state.winner === RACER;
    if (isSuspect) flashes.push(home ? t("Race complete! <<1>>", formatRaceTime(race.trucks[suspect].raceTime ?? 0)) : t("You did not complete the race in time."));
    else flashes.push(home ? t("The suspect got away!") : t("The cops win!"));
    phase = "over";
  }
  const done = { flashes, sounds, events, phase };
  const trucks = race?.trucks;
  if (!trucks?.length) return { rows: null, ...done };
  const timeRow = [t("Time Remaining:"), formatRaceTime(left)];
  if (!isSuspect) {
    const runner = trucks[suspect];
    return {
      rows: [
        timeRow, [t("Suspect:"), suspect >= 0 ? nameOf(suspect) : "-"],
        [t("Suspect's lap:"), runner ? `${Math.min(runner.lap, race.laps)}/${race.laps}` : "-"],
        [t("Busts:"), String(state.busts?.[watched] ?? 0)],
      ],
      ...done,
    };
  }
  const me = trucks[watched];
  return {
    rows: [
      timeRow, [t("Lap:"), formatRaceTime(me.lapTime)], [t("Best:"), formatRaceTime(me.best)],
      [t("Place:"), `${t("[lap count]Lap:")} ${me.lap}/${race.laps}`, "-"],
    ],
    ...done,
  };
}

const RNR = {
  prepare(extension, { entrants, length, settings, picks }) {
    const variant = rnrVariant(settings?.variant);
    const { teams, roles } = rnrTeams(entrants.length, !!settings?.blocker, { variant, picks: picks ?? [] });
    return {
      id: extension.id,
      // A chase hangs the red arrow over the suspect.
      dress: { mode: extension.id, variant, teams, roles, ...(variant === RNR_CHASE ? { marker: CHASE_COLOURS[RACER] } : {}) },
      start: (_index, fallback) => fallback,
      simulation: { mode: extension.id, variant, teams, roles, laps: length, minutes: settings?.minutes },
    };
  },
  // Each name says whether that truck races or blocks; the colour is its team's.
  labels: (state, entrants, baseLabel) => entrants.map((entrant, index) => {
    const label = baseLabel(entrant, index);
    const names = state.variant === RNR_CHASE ? CHASE_ROLE_NAMES : ROLE_NAMES;
    return label ? withLine(label, names[state.roles[index]]) : entrant.name;
  }),
  // A chase colours the suspect red and the cops blue, and marks the suspect on the map; the others by team.
  marks: (state, count) => (state.variant === RNR_CHASE
    ? Array.from({ length: count }, (_, i) => ({ color: CHASE_COLOURS[state.roles[i]] }))
    : teamMarks(state, count)),
  mapMarks: (state, count) => (state.variant === RNR_CHASE
    ? Array.from({ length: count }, (_, i) => (state.roles[i] === RACER ? { color: CHASE_COLOURS[RACER], marker: "arrow" } : { color: CHASE_COLOURS[BLOCKER] }))
    : teamMarks(state, count)),
  markerTarget: (state) => (state.variant === RNR_CHASE ? state.roles.indexOf(RACER) : -1),
  // A racer follows the checkpoints; a blocker looks for the nearest racer of another team.
  finderTarget: (state, index, positions) => (state.roles[index] === RACER
    ? undefined
    : nearest(positions, positions[index] ?? [0, 0, 0], (i) => state.roles[i] === RACER && state.teams[i] !== state.teams[index])),
  resultTime: () => undefined,
  /**
   * The race's board, for the racers alone (places among the racers). A racer sees its own times; a classic blocker
   * its team's racer's, named under them; a timed blocker the time left, the racers' lap and the lead racer. The
   * timed block's racers see the time left too. The start says who is who, the timed block warns of its last minute,
   * a blocker's block or roll-over is cheered (a horn, a YeeHaw) and told, and the end says who won.
   */
  hud(state, race, entrants, helpers, previous) {
    if (state.variant === RNR_CHASE) return chaseHud(state, race, entrants, helpers, previous);
    const { t, formatRaceTime, watched = 0 } = helpers;
    const flashes = [], sounds = [];
    let phase = previous.phase ?? null;
    const timed = state.variant === RNR_TIMED;
    const racer = state.roles[watched] === RACER;
    const nameOf = (index) => (index === 0 ? t("You") : entrants[index]?.name ?? "");
    if (phase === null) {
      if (timed) {
        const time = state.left !== null && state.left !== undefined ? formatRaceTime(state.left) : "";
        flashes.push(racer ? t("You are a Racer: get one of the Racers home within <<1>>.", time) : t("You are a Blocker: hold the Racers off for <<1>>.", time));
      } else {
        const team = t(TEAM_NAMES[state.teams[watched]] ?? "");
        flashes.push(racer ? t("You race for <<1>>: be the first racer home.", team) : t("You block for <<1>>: stop the leading racer and free your own.", team));
      }
      phase = "started";
    }
    if (timed && phase === "started" && state.left !== null && state.left <= 60 && !state.over) {
      flashes.push(t("One minute left!"));
      phase = "minute";
    }
    const events = state.events ?? 0;
    if (events !== (previous.events ?? 0) && state.event && state.event.by >= 0 && state.event.racer >= 0) {
      const { kind, by, racer: hit } = state.event;
      sounds.push({ kind: kind === "roll" ? "yeehaw" : "horn", truck: by });
      flashes.push(kind === "roll" ? t("<<1>> rolled <<2>> over!", nameOf(by), nameOf(hit)) : t("<<1>> blocked <<2>>!", nameOf(by), nameOf(hit)));
    }
    if (state.over && phase !== "over") {
      if (state.winner !== null && state.winner !== undefined) {
        flashes.push(timed ? t("<<1>> win!", t(SIDE_NAMES[state.winner])) : t("<<1>> wins!", t(TEAM_NAMES[state.winner])));
      }
      phase = "over";
    }
    const done = { flashes, sounds, events, phase };
    const trucks = race?.trucks;
    if (!trucks?.length) return { rows: null, ...done };
    const racers = state.roles.map((_, i) => i).filter((i) => state.roles[i] === RACER);
    const lead = racers.find((i) => trucks[i]?.place === 1) ?? racers[0] ?? -1;
    const left = state.left !== null && state.left !== undefined ? [[t("Time Remaining:"), formatRaceTime(state.left)]] : [];
    if (timed && !racer) {
      const leader = trucks[lead];
      return {
        rows: [...left, [t("Racers' lap:"), leader ? `${Math.min(leader.lap, race.laps)}/${race.laps}` : "-"], [t("Lead racer:"), lead >= 0 ? nameOf(lead) : "-"]],
        ...done,
      };
    }
    const shown = timingTruck(watched, state.teams, state.roles, state.variant);
    const me = trucks[shown] ?? trucks[watched];
    const place = me.place === null || me.place === undefined || state.roles[shown] === BLOCKER ? "-" : `${me.place}/${racers.length}`;
    const rows = [
      ...(timed ? left : []),
      [t("Lap:"), formatRaceTime(me.lapTime)], [t("Best:"), formatRaceTime(me.best)], ...(timed ? [] : [[t("Clock:"), formatRaceTime(race.clock)]]),
      ["", ""], [race.gap?.kind === "lead" ? t("Lead:") : t("Back:"), formatRaceTime(race.gap?.seconds ?? 0)],
      [t("Place:"), `${t("[lap count]Lap:")} ${me.lap}/${race.laps}`, place],
    ];
    if (!racer && shown !== watched) rows.push([t("Racer:"), nameOf(shown)]);
    return { rows, ...done };
  },
  toWire: rnrToWire,
  fromWire: rnrFromWire,
};


// ---- Combat ----

/** A share (0 to 1) as a percentage; a lost wheel (-1) as dashes. */
const percent = (share) => (share < 0 ? "--" : `${Math.max(0, Math.round(share * 100))}%`);
/** A share's colour on the board: green, yellow, orange, red; a lost wheel dark red. */
export const damageColour = (share) => (share < 0 ? "#b0202a" : share >= 0.6 ? "#4fe05a" : share >= 0.35 ? "#f2d22e" : share >= 0.15 ? "#ff8a1e" : "#ff3b30");
/** A share as a coloured piece of a value (render/bitmap-text.js). */
const shown = (share) => [{ text: percent(share), color: damageColour(share) }];
const COMBAT = {
  prepare(extension, { length, settings }) {
    return {
      id: extension.id,
      dress: { mode: extension.id },
      start: (_index, fallback) => fallback,
      simulation: {
        mode: extension.id, laps: length, toughness: settings?.toughness ?? "normal", credits: settings?.credits !== false,
        startCredits: settings?.startCredits ?? 500, aggression: settings?.aggression ?? "normal",
      },
    };
  },
  // Each name with the truck's hit points, coloured as on the board; a wrecked truck's name says so instead.
  labels: (state, entrants, baseLabel) => entrants.map((entrant, index) => {
    const label = baseLabel(entrant, index) || entrant.name;
    const me = state.trucks?.[index];
    if (state.out?.[index]) return withLine(label, me?.quit ? OUT_LABEL : WRECKED_LABEL);
    if (!me) return label;
    const lines = Array.isArray(label) ? [...label] : [label];
    lines[0] = [{ text: `${lines[0]} ` }, { text: percent(me.hp), color: damageColour(me.hp) }];
    return lines;
  }),
  resultTime: () => undefined,
  out: (state, index) => !!state?.out?.[index],
  toWire: combatToWire,
  fromWire: combatFromWire,
  // Each machine's own trucks (combat-session.js `netOwn`).
  ownToWire: combatOwnToWire,
  ownFromWire: combatOwnFromWire,
  keyAction(state, index) {
    const me = state?.trucks?.[index];
    if (!me || me.wrecked || me.quit) return {};
    if (!state.credits) return { message: "No repairs: credits are off in Options" };
    if (me.cost <= 0) return { message: "Your truck needs no repair" };
    if (me.credits <= 0) return { message: "Not enough credits to repair" };
    return { action: "repair" };
  },
  /**
   * The truck's state under the race's times: its hit points, engine, gearbox and wheels, its credits and what a full
   * repair costs. The start tells the keys; a wheel coming off, a wreck and the player's repairs are told (a wreck with
   * the wrecker's YeeHaw), and the end says who won.
   */
  hud(state, race, entrants, { t, formatRaceTime, watched = 0 }, previous) {
    const flashes = [], sounds = [], repaired = [];
    let phase = previous.phase ?? null;
    const nameOf = (index) => (index === watched ? t("You") : entrants[index]?.name ?? "");
    const wheel = (w) => t(WHEEL_NAMES[w] ?? "");
    if (phase === null) {
      flashes.push(state.credits
        ? t("Combat! Wreck the others and win the race. X repairs, with the credits you earn (<<1>>).", state.trucks?.[watched]?.credits ?? 0)
        : t("Combat! Wreck the others and win the race."));
      phase = "started";
    }
    const seen = previous.events ?? 0;
    for (const e of state.log ?? []) {
      if (e.id <= seen) continue;
      if (e.kind === "repair") {
        repaired.push(e.truck);
        if (e.truck === watched) flashes.push(t("Repaired for <<1>> credits", e.spent));
      } else if (e.kind === "wheel") {
        flashes.push(e.truck === watched ? t("You lost your <<1>> wheel!", wheel(e.wheel)) : t("<<1>> lost its <<2>> wheel!", nameOf(e.truck), wheel(e.wheel)));
        const me = state.trucks?.[e.truck];
        if (e.truck === watched && me && !me.wrecked && me.wheels.every((w) => w < 0)) flashes.push(t("No wheels left: X puts one back on"));
      } else if (e.kind === "wreck") {
        if (e.by >= 0) sounds.push({ kind: "yeehaw", truck: e.by });
        if (e.truck === watched) flashes.push(e.by >= 0 ? t("<<1>> wrecked you! Left and Right: watch another truck.", nameOf(e.by)) : t("You're wrecked! Left and Right: watch another truck."));
        else flashes.push(e.by >= 0 ? t("<<1>> wrecked <<2>>!", nameOf(e.by), nameOf(e.truck)) : t("<<1>> is wrecked!", nameOf(e.truck)));
      } else if (e.kind === "quit" && e.truck === watched) flashes.push(t("You left the fight. Left and Right: watch another truck."));
    }
    if (state.over && phase !== "over") {
      if (state.winner >= 0) flashes.push(state.winner === watched ? t("Last truck standing: you win!") : t("<<1>> is the last truck standing!", nameOf(state.winner)));
      phase = "over";
    }
    // A dead engine or gearbox is told once: the truck crawls on.
    const watchedTruck = state.trucks?.[watched];
    const crawl = !!watchedTruck && !watchedTruck.wrecked && (watchedTruck.engine <= 0 || watchedTruck.gearbox <= 0);
    if (crawl && !previous.crawl) flashes.push(t("Your truck is crawling: reach the checkpoints for credits and repair it"));
    const done = { flashes, sounds, repaired, events: state.events ?? seen, phase, memory: { crawl } };
    const trucks = race?.trucks;
    const mine = state.trucks?.[watched];
    if (!trucks?.length || !mine) return { rows: null, ...done };
    const me = trucks[watched];
    const rows = [
      [t("Lap:"), formatRaceTime(me.lapTime)], [t("Best:"), formatRaceTime(me.best)],
      [t("Place:"), `${t("[lap count]Lap:")} ${Math.min(me.lap, race.laps)}/${race.laps}`, `${me.place}/${trucks.length}`], ["", ""],
      [t("Truck:"), mine.wrecked ? [{ text: t("Wrecked"), color: damageColour(-1) }] : shown(mine.hp)], [t("Engine:"), shown(mine.engine)],
      [t("Gearbox:"), shown(mine.gearbox)],
      // The four wheels, front right to rear left, each in its own colour.
      [t("Wheels:"), mine.wheels.flatMap((share, w) => [...(w ? [{ text: " " }] : []), { text: percent(share), color: damageColour(share) }])],
    ];
    if (state.credits) rows.push(["", ""], [t("Credits:"), String(mine.credits)], [t("Repair (X):"), mine.cost > 0 ? String(mine.cost) : "-"]);
    return { rows, ...done };
  },
};

const ADAPTERS = new Map([["hockey", HOCKEY], ["soccer", SOCCER], ["tag", TAG], ["cops-robbers", CNR], ["race-rumble", RNR], ["combat", COMBAT]]);
const adapterOf = (stateOrId) => ADAPTERS.get(typeof stateOrId === "string" ? stateOrId : stateOrId?.mode) ?? null;

export function resolveRaceExtension(id, track) {
  const extension = extensionById(id);
  return extension?.acceptsTrack(track) ? extension : null;
}

/** Whether an extension plays on the track's own race (checkpoints, laps and its ending): Race & Rumble. */
export const extensionKeepsRace = (extension) => !!extension?.keepsRace;

/**
 * Build extension-owned race data after the track has loaded. `ctx` is `{ build, entrants, length, groundHeightAt,
 * settings }`, `settings` the extension's own (game/extensions/loader.js `settingsForExtension`).
 */
export function prepareExtensionRace(extension, ctx) {
  if (!extension) return null;
  return adapterOf(extension.id)?.prepare(extension, ctx) ?? null;
}

/** Labels shown over trucks, with extension-specific decoration when requested. */
export function extensionTruckLabels(state, entrants, baseLabel) {
  const labels = adapterOf(state)?.labels;
  return labels ? labels(state, entrants, baseLabel) : entrants.map(baseLabel);
}

/** Optional coloured marks for the labels over the trucks. */
export function extensionTruckMarks(state, count) {
  return adapterOf(state)?.marks?.(state, count) ?? none(count);
}

/** Each truck's colour and marker on the map (`{ color, marker? }` or null). */
export function extensionMapMarks(state, count) {
  return adapterOf(state)?.mapMarks?.(state, count) ?? none(count);
}

/** Other things an extension marks on the map (`{ pos, color }`): a ball. */
export function extensionMapPoints(state) {
  return adapterOf(state)?.mapPoints?.(state) ?? [];
}

/** The truck index an extension's world marker follows, or -1 when it has no marker. */
export function extensionMarkerTarget(state) {
  return adapterOf(state)?.markerTarget?.(state) ?? -1;
}

/**
 * Where the checkpoint finder of truck `index` points (`[x, y, z]`, game feet), with every truck's position: null
 * hides it, undefined leaves it on the checkpoints.
 */
export function extensionFinderTarget(state, index, positions) {
  const finder = adapterOf(state)?.finderTarget;
  return finder ? finder(state, index, positions) : undefined;
}

/** The Winner's Circle time value supplied by an extension, or undefined for each truck's own. */
export function extensionResultTime(id, length, race) {
  return adapterOf(id)?.resultTime?.(length, race);
}

/**
 * Extension HUD rows and event messages. State owned by the caller is returned as `events` and
 * `phase`, so the adapter remains pure and can be tested under Node. `rows` null keeps the race's own HUD.
 */
export function extensionHud(state, race, entrants, helpers, previous = {}) {
  if (!state) return null;
  return adapterOf(state)?.hud?.(state, race, entrants, helpers, previous) ?? null;
}

/** Whether truck `index` is out of an extension race (a wrecked player watches on). */
export function extensionTruckOut(state, index) {
  return !!adapterOf(state)?.out?.(state, index);
}

/** What the Crash Damage key does in a mode that owns it: `{ action?, message? }` (adapter `keyAction`). */
export function extensionKeyAction(state, index) {
  return adapterOf(state)?.keyAction?.(state, index) ?? {};
}

/**
 * An online room's mode state (docs/EXTENSIONS.md, "Over the network"): the owner's runtime state as sent, truck
 * indexes as vehicle numbers, and back in this machine's truck order. Null for a mode that cannot be played online.
 */
export function extensionNetToWire(id, state, vehicleOf) {
  if (!state) return null;
  return adapterOf(id)?.toWire?.(state, vehicleOf) ?? null;
}
export function extensionNetFromWire(id, data, localOf, count) {
  if (!data) return null;
  return adapterOf(id)?.fromWire?.(data, localOf, count) ?? null;
}
/** The state of the trucks one machine judges, in a mode that judges each where it is driven (Combat), and back. */
export function extensionNetOwnToWire(id, state, vehicleOf) {
  if (!state) return null;
  return adapterOf(id)?.ownToWire?.(state, vehicleOf) ?? null;
}
export function extensionNetOwnFromWire(id, data, localOf, count) {
  if (!data) return null;
  return adapterOf(id)?.ownFromWire?.(data, localOf, count) ?? null;
}
