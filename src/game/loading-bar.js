/*
  MTM2's loading bar (MONSTER_EXE_ANALYSIS.md, "The loading bar"): drawn on the loading screen, in 640 x 480 terms, with
  the step's message centred in it and the race and skill over it. Pure, so it runs under Node.
*/
import { msg } from "./strings.js";

/** The bar, its black box and the steps a race load and the end of a race count. */
export const LOADING_BAR = Object.freeze({
  box: Object.freeze([33, 415, 605, 445]),
  x: 34, y: 416, width: 570, height: 28,
  /** A race load's steps; the game's eight messages stop one short of full. */
  loadSteps: 9,
  /** "Determining times for remaining trucks": a step every 32 of 960 frames. */
  finishSteps: 30,
});

/** The race load's messages, in the game's order. */
export const LOAD_MESSAGES = Object.freeze([
  msg("Loading world database"), msg("Initializing phototexture system"), msg("Loading terrain database"), msg("Loading vehicles"),
  msg("Loading scenery"), msg("Loading courses"), msg("Preparing simulator"), msg("Loading additional graphics"),
]);

/** The skill over the bar, by the race's difficulty (0x4dbaf0). */
export const SKILL_NAMES = Object.freeze([msg("Rookie"), msg("Intermediate"), msg("Professional")]);

/** "Race : <name>" and "Skill : <level>" as the game words them, translated with `t`. */
export function raceAndSkill(name, difficulty, t = (s, ...a) => a.reduce((r, v, i) => r.replace(`<<${i + 1}>>`, v), s)) {
  const level = SKILL_NAMES[Number(difficulty)];
  return { race: name ? t("Race : <<1>>", name) : "", skill: level ? t("Skill : <<1>>", t(level)) : "" };
}

/** The filled width of the bar after `count` of `steps` steps, in 640 x 480 pixels. */
export function barFill(count, steps) {
  if (!(steps > 0)) return 0;
  const c = Math.max(0, Math.min(steps, Math.floor(count)));
  return Math.floor((c * LOADING_BAR.width) / steps);
}

const INFO_LABELS = Object.freeze({
  track: msg("Track:"), truck: msg("Truck:"), mode: msg("Game mode:"), physics: msg("Physics:"), ai: msg("Computer AI:"), cameras: msg("Cameras:"),
});

/**
 * The port's own lines at the top left of the loading screen: what this race is. `race` is
 * `{ track, trackType, truck, mode, physics, ai, cameras }`, each already worded; a missing one is left out.
 */
export function raceInfoLines(race, t = (s) => s) {
  const lines = [];
  const add = (label, value) => { if (value) lines.push(`${t(label)} ${value}`); };
  add(INFO_LABELS.track, race.track && race.trackType ? `${race.track} (${race.trackType})` : race.track);
  add(INFO_LABELS.truck, race.truck);
  add(INFO_LABELS.mode, race.mode);
  add(INFO_LABELS.physics, race.physics);
  add(INFO_LABELS.ai, race.ai);
  add(INFO_LABELS.cameras, race.cameras);
  return lines;
}
