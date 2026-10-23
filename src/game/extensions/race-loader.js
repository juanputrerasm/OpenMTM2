/*
  Race-facing extension adapter. The race screen calls these generic functions; each shipped mode's
  details stay in its entry of `ADAPTERS`, behind this registry boundary. An entry may give:

  - `prepare(extension, ctx)`: the race data (`{ id, dress, course?, walls?, start, simulation }`); `ctx.picks[i]` is
    the team (and role) truck i was given in the Computer Opponents dialog, `{ team, role }` or null;
  - `labels(state, entrants, baseLabel)` and `marks(state, count)`: the names over the trucks and their colours;
  - `mapMarks(state, count)` and `mapPoints(state)`: the trucks' colours and markers on the map, and other things on it;
  - `markerTarget(state)`: the truck the arrow hangs over, or -1;
  - `finderTarget(state, index, positions)`: where the checkpoint finder points for truck `index`, or null for
    nowhere (undefined keeps the checkpoints);
  - `resultTime(length, race)`: the Winner's Circle time, or undefined for each truck's own;
  - `hud(state, race, entrants, helpers, previous)`: the HUD's rows and messages (rows null keeps the race's own);
  - `toWire` and `fromWire`: the mode's state over the network.
*/
import { extensionById } from "./loader.js";
import { hockeyFromWire, hockeyRink, hockeySpot, hockeyTeams, hockeyToWire, rinkBoxes } from "./hockey.js";
import { soccerPitch, pitchBoxes } from "./soccer.js";
import { IT_COLOUR, tagFromWire, tagScoring, tagToWire } from "./tag.js";
import { COP_COLOUR, COP_NAME, ROBBER_COLOUR, ROBBER_NAME, cnrFromWire, cnrToWire } from "./cops-robbers.js";
import { RACER, RNR_TIMED, ROLE_NAMES, SIDE_NAMES, rnrFromWire, rnrTeams, rnrToWire, rnrVariant } from "./race-rumble.js";
import { TEAM_COLOURS, TEAM_NAMES, pickedTeams } from "./teams.js";

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
  prepare: (extension, { length, settings }) => ({
    id: extension.id,
    dress: { mode: extension.id, marker: IT_COLOUR },
    start: (_index, fallback) => fallback,
    simulation: { mode: extension.id, minutes: length, scoring: tagScoring(settings) },
  }),
  mapMarks: (state, count) => Array.from({ length: count }, (_, i) => (i === state.it ? { color: IT_COLOUR, marker: "arrow" } : null)),
  markerTarget: (state) => state.it,
  // It looks for the nearest truck; the others for It.
  finderTarget: (state, index, positions) => (index === state.it
    ? nearest(positions, positions[index] ?? [0, 0, 0], (i) => i !== index && i !== state.safe)
    : positions[state.it] ?? null),
  resultTime: (length) => length * 60,
  hud(state, race, entrants, { t, formatRaceTime, summitBoard }, previous) {
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

const RNR = {
  prepare(extension, { entrants, length, settings, picks }) {
    const variant = rnrVariant(settings?.variant);
    const { teams, roles } = rnrTeams(entrants.length, !!settings?.blocker, { variant, picks: picks ?? [] });
    return {
      id: extension.id,
      dress: { mode: extension.id, variant, teams, roles },
      start: (_index, fallback) => fallback,
      simulation: { mode: extension.id, variant, teams, roles, laps: length, minutes: settings?.minutes },
    };
  },
  // Each name says whether that truck races or blocks; the colour is its team's.
  labels: (state, entrants, baseLabel) => entrants.map((entrant, index) => {
    const label = baseLabel(entrant, index);
    return label ? withLine(label, ROLE_NAMES[state.roles[index]]) : entrant.name;
  }),
  marks: teamMarks,
  mapMarks: teamMarks,
  // A racer follows the checkpoints; a blocker looks for the nearest racer of another team.
  finderTarget: (state, index, positions) => (state.roles[index] === RACER
    ? undefined
    : nearest(positions, positions[index] ?? [0, 0, 0], (i) => state.roles[i] === RACER && state.teams[i] !== state.teams[index])),
  resultTime: () => undefined,
  /** The race's own HUD; the start says who is who, the timed block warns of its last minute, and the end says who won. */
  hud(state, _race, _entrants, { t, formatRaceTime }, previous) {
    const flashes = [];
    let phase = previous.phase ?? null;
    const timed = state.variant === RNR_TIMED;
    const racer = state.roles[0] === RACER;
    if (phase === null) {
      if (timed) {
        const time = state.left !== null && state.left !== undefined ? formatRaceTime(state.left) : "";
        flashes.push(racer ? t("You are a Racer: get one of the Racers home within <<1>>.", time) : t("You are a Blocker: hold the Racers off for <<1>>.", time));
      } else {
        const team = t(TEAM_NAMES[state.teams[0]] ?? "");
        flashes.push(racer ? t("You race for <<1>>: be the first racer home.", team) : t("You block for <<1>>: stop the other racers and guard your own.", team));
      }
      phase = "started";
    }
    if (timed && phase === "started" && state.left !== null && state.left <= 60 && !state.over) {
      flashes.push(t("One minute left!"));
      phase = "minute";
    }
    if (state.over && phase !== "over") {
      if (state.winner !== null && state.winner !== undefined) {
        flashes.push(timed ? t("<<1>> win!", t(SIDE_NAMES[state.winner])) : t("<<1>> wins!", t(TEAM_NAMES[state.winner])));
      }
      phase = "over";
    }
    return { rows: null, flashes, events: previous.events ?? 0, phase };
  },
  toWire: rnrToWire,
  fromWire: rnrFromWire,
};

const ADAPTERS = new Map([["hockey", HOCKEY], ["soccer", SOCCER], ["tag", TAG], ["cops-robbers", CNR], ["race-rumble", RNR]]);
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
