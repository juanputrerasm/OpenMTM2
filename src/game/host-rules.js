/*
  Host rules (online rooms, server 0.4.0 `rules`): the game rules the room's owner decides for everyone, sent as one
  flat object with the race's start and applied over each player's own settings for that race only. What each player
  keeps for themselves (cameras, keys, gamepad, graphics, sound) is not a rule.

  Rule names are the settings' keys; an extension's settings travel as `ext.<extension id>.<key>`.
*/
import { EXTENSIONS, settingsForExtension } from "./extensions/loader.js";

/** The settings the owner decides for the room. */
export const HOST_RULE_KEYS = Object.freeze([
  "physics", "aiBehaviour", "aiSpeed", "opponentFps", "sonicTrucks", "shiftInAuto", "checkpointHeli", "difficulty",
]);

const ruleValue = (v) => (typeof v === "boolean" || typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) ? v : undefined);

/** The owner's rules from their settings, with the chosen extension's settings (`extensionId`, or none). */
export function hostRules(settings, extensionId = null) {
  const out = {};
  for (const key of HOST_RULE_KEYS) {
    const v = ruleValue(settings?.[key]);
    if (v !== undefined) out[key] = v;
  }
  const extension = extensionId ? EXTENSIONS.find((e) => e.id === extensionId) : null;
  if (extension) {
    for (const [key, value] of Object.entries(settingsForExtension(settings, extension))) {
      const v = ruleValue(value);
      if (v !== undefined) out[`ext.${extension.id}.${key}`] = v;
    }
  }
  return out;
}

/**
 * A player's settings with the owner's rules over them, for one race: a new object, the player's own left as they were.
 * Unknown rule names are ignored, and a value of another type than the setting's is too.
 */
export function withHostRules(settings, rules) {
  if (!rules || typeof rules !== "object") return settings;
  const out = { ...settings, extensions: { ...(settings?.extensions ?? {}) } };
  for (const [name, value] of Object.entries(rules)) {
    if (HOST_RULE_KEYS.includes(name)) {
      const mine = settings?.[name];
      if (mine === undefined || typeof mine === typeof value) out[name] = value;
      continue;
    }
    const m = /^ext\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/.exec(name);
    const extension = m && EXTENSIONS.find((e) => e.id === m[1]);
    if (!extension || !extension.settings.some((s) => s.key === m[2])) continue;
    out.extensions[extension.id] = { ...settingsForExtension(settings, extension), ...(out.extensions[extension.id] ?? {}), [m[2]]: value };
  }
  return out;
}
