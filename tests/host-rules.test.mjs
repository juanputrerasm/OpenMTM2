/*
  Host rules (game/host-rules.js): the owner's game rules for an online room, applied over a player's settings.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { hostRules, withHostRules } from "../src/game/host-rules.js";
import { settingsForExtension } from "../src/game/extensions/loader.js";

test("host rules carry the owner's rules and the room's extension settings, and only those", () => {
  const owner = { physics: "evo2", aiBehaviour: "mtm2", aiSpeed: 1.2, chaseFov: 100, extensions: { combat: { laps: 5, names: false } } };
  const rules = hostRules(owner, "combat");
  assert.equal(rules.physics, "evo2");
  assert.equal(rules["ext.combat.laps"], 5);
  assert.equal(rules["ext.combat.names"], false);
  assert.equal(rules.chaseFov, undefined, "a player's own view is not a rule");
  const guest = { physics: "mtm2", chaseFov: 70, extensions: {} };
  const applied = withHostRules(guest, rules);
  assert.equal(applied.physics, "evo2");
  assert.equal(applied.chaseFov, 70);
  assert.equal(settingsForExtension(applied, "combat").names, false);
  assert.equal(guest.physics, "mtm2", "the player's own settings are left alone");
  assert.equal(withHostRules(guest, { "ext.combat.nope": 1, bogus: 2 }).bogus, undefined);
});

test("an extension whose id has a hyphen gets its rules back (race-rumble, cops-robbers)", async () => {
  const { DEFAULT_SETTINGS } = await import("../src/app/settings.js");
  const rules = hostRules({ ...DEFAULT_SETTINGS }, "race-rumble");
  const names = Object.keys(rules).filter((k) => k.startsWith("ext.race-rumble."));
  assert.ok(names.length > 0);
  for (const k of names) assert.match(k, /^[A-Za-z0-9_.-]{1,48}$/, "a name the server takes");
  const key = names[0].split(".")[2], before = rules[names[0]];
  const changed = typeof before === "number" ? before + 1 : typeof before === "boolean" ? !before : `${before}x`;
  const out = withHostRules({ ...DEFAULT_SETTINGS }, { [names[0]]: changed });
  assert.equal(out.extensions["race-rumble"][key], changed);
});
