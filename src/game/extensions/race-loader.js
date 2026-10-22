/*
  Race-facing extension adapter. The race screen calls these generic functions; shipped extension
  details stay behind this registry boundary.
*/
import { extensionById } from "./loader.js";
import { TEAM_COLOURS, TEAM_NAMES, hockeyFromWire, hockeyRink, hockeySpot, hockeyTeams, hockeyToWire, rinkBoxes } from "./hockey.js";
import { tagFromWire, tagToWire } from "./tag.js";

export function resolveRaceExtension(id, track) {
  const extension = extensionById(id);
  return extension?.acceptsTrack(track) ? extension : null;
}

/** Build extension-owned race data after the track has loaded. */
export function prepareExtensionRace(extension, { build, entrants, length, groundHeightAt }) {
  if (!extension) return null;
  if (extension.id === "hockey") {
    const rink = hockeyRink(rinkBoxes(build), groundHeightAt, build.waterLevelFt);
    if (!rink) throw new Error("This track has no hockey rink: Hockey needs Breakneck Ridge's frozen lake, its puck and its two goals.");
    const teams = hockeyTeams(entrants.length);
    return {
      id: extension.id,
      dress: { mode: extension.id, rink, teams },
      course: [],
      walls: [...(build.sim.walls ?? []), ...rink.boards],
      start: (index) => hockeySpot(rink, teams, index),
      simulation: { mode: extension.id, rink, teams, goals: length },
    };
  }
  if (extension.id === "tag") {
    return {
      id: extension.id,
      dress: { mode: extension.id },
      start: (_index, fallback) => fallback,
      simulation: { mode: extension.id, minutes: length },
    };
  }
  return null;
}

/** Labels shown over trucks, with extension-specific decoration when requested. */
export function extensionTruckLabels(state, entrants, baseLabel) {
  if (state?.mode !== "hockey") return entrants.map(baseLabel);
  return entrants.map((entrant, index) => {
    const label = baseLabel(entrant, index);
    return label ? `${label}\n${TEAM_NAMES[state.teams[index]]}` : entrant.name;
  });
}

/** Optional coloured marks beside truck labels. */
export function extensionTruckMarks(state, count) {
  if (state?.mode !== "hockey") return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, index) => ({ color: TEAM_COLOURS[state.teams[index]], far: false }));
}

/** The truck index an extension's world marker follows, or -1 when it has no marker. */
export function extensionMarkerTarget(state) {
  return state?.mode === "tag" ? state.it : -1;
}

/** The Winner's Circle time value supplied by an extension. */
export function extensionResultTime(id, length, race) {
  return id === "tag" ? length * 60 : race.clock;
}

/**
 * Extension HUD rows and event messages. State owned by the caller is returned as `events` and
 * `phase`, so the adapter remains pure and can be tested under Node.
 */
export function extensionHud(state, race, entrants, helpers, previous = {}) {
  if (!state) return null;
  const { t, formatRaceTime, summitBoard } = helpers;
  const me = race.trucks[0];
  const nameOf = (index) => index === 0 ? t("You") : entrants[index]?.name ?? "";
  const flashes = [];
  let phase = previous.phase ?? null;
  if (state.mode === "hockey") {
    const mine = state.teams[0];
    const rows = [
      [`${t(TEAM_NAMES[0])}:`, String(state.score[0])], [`${t(TEAM_NAMES[1])}:`, String(state.score[1])],
      [t("Clock:"), formatRaceTime(race.clock)], ["", ""], [t("Team:"), t(TEAM_NAMES[mine])], [t("Goals:"), String(me.score)],
    ];
    if (state.events !== previous.events) {
      const event = state.event;
      if (event?.kind === "goal") {
        const by = event.scorer >= 0 ? ` (${nameOf(event.scorer)})` : event.own >= 0 ? ` (${t("own goal, <<1>>", nameOf(event.own))})` : "";
        flashes.push(`${t("<<1>> scores!", t(TEAM_NAMES[event.team]))}${by}  ${state.score[0]} - ${state.score[1]}`);
      } else if (event?.kind === "out") flashes.push(t("Puck out of the rink. Face-off!"));
    }
    if (state.phase === "faceoff" && phase !== "faceoff" && state.events > 0) flashes.push(t("Face-off! First to <<1>>", state.target));
    else if (state.phase === "over" && phase !== "over") flashes.push(t("<<1>> wins!", t(TEAM_NAMES[state.score[0] >= state.score[1] ? 0 : 1])));
    phase = state.phase;
    return { rows, flashes, events: state.events, phase, team: mine };
  }

  const rows = [
    [t("Time Remaining:"), formatRaceTime(state.left)], [t("Points:"), String(Math.round(state.points[0]))],
    [t("It:"), state.it === 0 ? t("You") : entrants[state.it]?.name ?? ""], [t("It time:"), formatRaceTime(state.itTime[0])],
    [t("Place:"), `${me.place}/${race.trucks.length}`], ["", ""],
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
    flashes.push(state.it === 0 ? t("You're It! Wait for it...") : t("<<1>> is It! Run!", nameOf(state.it)));
    phase = "started";
  }
  return { rows, flashes, events: state.events, phase };
}

/**
 * An online room's mode state (docs/EXTENSIONS.md, "Over the network"): the owner's runtime state as sent, truck
 * indexes as vehicle numbers, and back in this machine's truck order. Null for a mode that cannot be played online.
 */
export function extensionNetToWire(id, state, vehicleOf) {
  if (!state) return null;
  if (id === "hockey") return hockeyToWire(state, vehicleOf);
  if (id === "tag") return tagToWire(state, vehicleOf);
  return null;
}
export function extensionNetFromWire(id, data, localOf, count) {
  if (!data) return null;
  if (id === "hockey") return hockeyFromWire(data, localOf, count);
  if (id === "tag") return tagFromWire(data, localOf, count);
  return null;
}
