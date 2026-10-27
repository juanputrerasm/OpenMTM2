/*
  OpenMTM2 extension registry. Core game and UI modules depend on this small contract instead of
  importing a shipped mode. See docs/EXTENSIONS.md before adding an extension.
*/
import { HOCKEY_EXTENSION } from "./hockey.js";
import { SOCCER_EXTENSION } from "./soccer.js";
import { TAG_EXTENSION } from "./tag.js";
import { CNR_EXTENSION } from "./cops-robbers.js";
import { RNR_EXTENSION } from "./race-rumble.js";
import { COMBAT_EXTENSION } from "./combat.js";
import { msg } from "../strings.js";

/** Shipped extensions. A new extension is registered in this one place. */
export const EXTENSIONS = Object.freeze([HOCKEY_EXTENSION, SOCCER_EXTENSION, TAG_EXTENSION, CNR_EXTENSION, RNR_EXTENSION, COMBAT_EXTENSION]);

/** An extension descriptor by id, or null for a core mode or an unknown id. */
export function extensionById(id) {
  return EXTENSIONS.find((extension) => extension.id === id) ?? null;
}

/** Extensions that can be offered for at least one installed track. */
export function availableExtensions(tracks) {
  return EXTENSIONS.filter((extension) => tracks.some((track) => extension.acceptsTrack(track)));
}

/** Whether an id belongs to a registered extension. */
export const isExtensionMode = (id) => !!extensionById(id);

/** The track an extension needs, or the current track when it can use it. */
export function trackForExtension(extension, tracks, current) {
  if (!extension) return current;
  if (extension.acceptsTrack(current)) return current;
  return tracks.find((track) => extension.acceptsTrack(track)) ?? null;
}

/**
 * The trucks a race would have: the player's and the picked opponents, or in spectator mode the picked trucks alone.
 * `null` when the extension has no minimum or the field reaches it, else the minimum it falls short of.
 */
export function entrantsShortfall(extension, opponents, spectator) {
  const min = extension?.minEntrants ?? 0;
  const count = (opponents?.length ?? 0) + (spectator ? 0 : 1);
  return count >= min ? null : min;
}

/** Defaults stored below `settings.extensions`, keyed by extension id. */
export function extensionSettingDefaults() {
  return Object.fromEntries(EXTENSIONS.map((extension) => [
    extension.id,
    Object.fromEntries(extension.settings.map((setting) => [setting.key, setting.default])),
  ]));
}

/** Move settings from pre-extension top-level keys, as declared by each setting schema. */
export function migrateExtensionSettings(stored) {
  const migrated = { ...extensionSettingDefaults(), ...(stored.extensions ?? {}) };
  for (const extension of EXTENSIONS) {
    const values = { ...extensionSettingDefaults()[extension.id], ...(migrated[extension.id] ?? {}) };
    for (const setting of extension.settings) {
      if (setting.legacyKey && stored[setting.legacyKey] !== undefined && stored.extensions?.[extension.id]?.[setting.key] === undefined) values[setting.key] = stored[setting.legacyKey];
      if (setting.legacyKey) delete stored[setting.legacyKey];
    }
    migrated[extension.id] = values;
  }
  return migrated;
}

/** One extension's settings, completed with its declared defaults. */
export function settingsForExtension(settings, extensionOrId) {
  const extension = typeof extensionOrId === "string" ? extensionById(extensionOrId) : extensionOrId;
  if (!extension) return {};
  const defaults = Object.fromEntries(extension.settings.map((setting) => [setting.key, setting.default]));
  return { ...defaults, ...(settings?.extensions?.[extension.id] ?? {}) };
}

/** Store one extension setting without exposing its storage shape to callers. */
export function setExtensionSetting(settings, extensionOrId, key, value) {
  const extension = typeof extensionOrId === "string" ? extensionById(extensionOrId) : extensionOrId;
  if (!extension) return;
  settings.extensions = {
    ...(settings.extensions ?? {}),
    [extension.id]: { ...settingsForExtension(settings, extension), [key]: value },
  };
}

/** The configured race length for an extension, clamped to its declared range. */
export function extensionLength(settings, extension) {
  const spec = extension?.length;
  if (!spec) return null;
  const value = Number(settingsForExtension(settings, extension)[spec.key]);
  return Math.max(spec.min, Math.min(spec.max, Math.trunc(value) || spec.default));
}

/** A generic race length label, delegated to an extension when one is selected. */
export function lengthLabel(type, mode) {
  return extensionById(mode)?.length.label ?? (type === "summit" ? msg("Minutes") : msg("Laps"));
}

/**
 * The team choices an extension offers the Computer Opponents dialog with its settings (teams.js `TWO_TEAM_PICKER`'s
 * shape), or null for a mode without teams.
 */
export function teamPickerFor(settings, extensionOrId) {
  const extension = typeof extensionOrId === "string" ? extensionById(extensionOrId) : extensionOrId;
  return extension?.teamPicker ? extension.teamPicker(settingsForExtension(settings, extension)) : null;
}

/** The key the player's own pick is kept under; a computer truck's is its file. */
export const PLAYER_PICK = "@player";

/** The dialog's picks for a mode, `{ [PLAYER_PICK or truck file]: { team, role } }`, kept below `settings.teamPicks.<id>`. */
export function storedTeamPicks(settings, id) {
  const picks = settings?.teamPicks?.[id];
  return picks && typeof picks === "object" ? picks : {};
}

/** Keep one truck's pick (`{ team?, role? }`; null clears it). */
export function setTeamPick(settings, id, key, pick) {
  const picks = { ...storedTeamPicks(settings, id) };
  if (pick) picks[key] = { ...(picks[key] ?? {}), ...pick };
  else delete picks[key];
  settings.teamPicks = { ...(settings.teamPicks ?? {}), [id]: picks };
}

/**
 * Each entrant's pick for a race (`entrants[i]` `{ file, player }`): `{ team, role }` with only what the mode's picker
 * asks for and within its range, or null for an entrant with none. Null for a mode without teams.
 */
export function entrantTeamPicks(settings, extensionOrId, entrants) {
  const extension = typeof extensionOrId === "string" ? extensionById(extensionOrId) : extensionOrId;
  const picker = teamPickerFor(settings, extension);
  if (!picker) return null;
  const stored = storedTeamPicks(settings, extension.id);
  return entrants.map((entrant) => {
    const pick = stored[entrant.player ? PLAYER_PICK : entrant.file];
    if (!pick) return null;
    const out = {};
    if (picker.teams > 0 && Number.isInteger(pick.team) && pick.team >= 0 && pick.team < picker.teams) out.team = pick.team;
    if (picker.roles && Number.isInteger(pick.role) && pick.role >= 0 && pick.role < picker.roles.length) out.role = pick.role;
    return Object.keys(out).length ? out : null;
  });
}
