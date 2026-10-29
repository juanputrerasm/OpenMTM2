// The jukebox (worker/jukebox-list.js, game/jukebox.js): the mounted music, each piece once, in the player's order.

import test from "node:test";
import assert from "node:assert/strict";
import { createVfs } from "../src/worker/vfs.js";
import { buildJukeboxList } from "../src/worker/jukebox-list.js";
import { jukeboxQueue, nextPlayable, orderedEntries, moveEntry } from "../src/game/jukebox.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";
import { buildCatalog } from "../src/worker/catalog.js";

/** A level whose music line (the 15th) names `music`. */
const lvl = (music) => new TextEncoder().encode([...Array.from({ length: 14 }, (_, i) => (i === 0 ? "0" : `L${i}.RAW`)), music].join("\n"));

/** A mount of named files (an archive's entries in upper case, "/" between folders). */
function mount(name, files) {
  const entries = Object.keys(files).map((path) => ({ normalizedName: path.toUpperCase().replace(/\\/g, "/"), path }));
  return { name, archive: { entries }, readEntry: async (entry) => files[entry.path] };
}

test("the jukebox lists the menus' music, each track's, the music archives' and every module, each once", async () => {
  const vfs = createVfs([
    mount("ADDON.POD", { "SOUND\\FARM.OGG": new Uint8Array(1), "LEVELS\\NEW.LVL": lvl("farm.wav"), "LEVELS\\ODD.LVL": lvl("metal.mod") }),
    mount("MUSIC.POD", {
      "SOUND\\SPLASH.WAV": new Uint8Array(1), "SOUND\\SPLASH.KLP": new Uint8Array(1),
      "SOUND\\FARM.WAV": new Uint8Array(1), "SOUND\\FARM.KLP": new Uint8Array(1), "SOUND\\BREAK.WAV": new Uint8Array(1),
    }),
    mount("LEVELS.POD", { "LEVELS\\FARM.LVL": lvl("FARM.WAV"), "LEVELS\\RUMBLE.LVL": lvl("engine.wav") }),
    mount("SOUND.POD", { "SOUND\\ENGINE.WAV": new Uint8Array(1), "SOUND\\ENGINE.KLP": new Uint8Array(1), "SOUND\\IDLE.WAV": new Uint8Array(1), "SOUND\\IDLE.KLP": new Uint8Array(1) }),
    mount("GAME.POD", { "MUSIC\\METAL.MOD": new Uint8Array(1), "MUSIC\\GRUNGE.MOD": new Uint8Array(1) }),
  ]);
  const tracks = [
    { path: "WORLD\\FARM.SIT", name: "Farm", game: "MTM2", level: "FARM.LVL" },
    { path: "WORLD\\NEW.SIT", name: "New", game: "MTM2", level: "NEW.LVL" },
    { path: "WORLD\\RUMBLE.SIT", name: "Rumble", game: "MTM2", level: "RUMBLE.LVL" },
    { path: "WORLD\\ODD.SIT", name: "Odd", game: "MTM1", level: "ODD.LVL" },
    { path: "WORLD\\CPR.SIT", name: "Speedway", game: "CPR", scope: "CPR", level: "FARM.LVL" },
  ];
  const list = await buildJukeboxList(vfs, tracks);
  assert.deepEqual(list.map((e) => e.id), ["sound:SPLASH", "sound:FARM", "sound:ENGINE", "mod:METAL", "sound:BREAK", "mod:GRUNGE"]);
  const byId = Object.fromEntries(list.map((e) => [e.id, e]));
  assert.equal(byId["sound:SPLASH"].menu, true);
  // FARM.WAV and the add-on's FARM.OGG are one piece, played as the OGG the game would play.
  assert.deepEqual(byId["sound:FARM"].tracks, ["Farm", "New"]);
  assert.equal(byId["sound:FARM"].format, "ogg");
  assert.equal(byId["mod:METAL"].format, "mod");
  // An effect loop is music only when a level names it; the other effects are not listed.
  assert.ok(!byId["sound:IDLE"]);
});

test("the jukebox's order: the saved one first, new music after it, music no longer mounted left out", () => {
  const entries = ["sound:SPLASH", "sound:FARM", "mod:METAL", "sound:BREAK"].map((id) => ({ id }));
  assert.deepEqual(orderedEntries(entries, ["mod:METAL", "sound:GONE", "sound:SPLASH"]).map((e) => e.id),
    ["mod:METAL", "sound:SPLASH", "sound:FARM", "sound:BREAK"]);
  assert.deepEqual(moveEntry(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveEntry(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveEntry(["a", "b", "c"], 0, 9), ["b", "c", "a"]);
});

test("the jukebox plays the list in order, past the skipped pieces, and starts over after the last", () => {
  const ids = ["a", "b", "c", "d"];
  const skipped = new Set(["b"]);
  assert.equal(nextPlayable(ids, skipped, "a", 1), "c");
  assert.equal(nextPlayable(ids, skipped, "d", 1), "a");
  assert.equal(nextPlayable(ids, skipped, "c", -1), "a");
  assert.equal(nextPlayable(ids, skipped, "a", -1), "d");
  assert.equal(nextPlayable(ids, skipped, null, 1), "a");
  // A piece no longer in the list: the first one.
  assert.equal(nextPlayable(ids, skipped, "zz", 1), "a");
  assert.equal(nextPlayable(ids, new Set(ids), "a", 1), null);
  assert.deepEqual(jukeboxQueue(ids, skipped), ["a", "c", "d"]);
});

test("the stock install's jukebox: the menu music, the tracks' music from MUSIC.POD, each once", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  const { tracks } = await buildCatalog(vfs);
  const list = await buildJukeboxList(vfs, tracks);
  const ids = list.map((e) => e.id);
  assert.equal(ids[0], "sound:SPLASH");
  assert.equal(new Set(ids).size, ids.length, "no piece twice");
  for (const stem of ["FARM", "AZTEC", "ROCKX", "SURF", "VOODOO"]) assert.ok(ids.includes(`sound:${stem}`), stem);
  assert.ok(list.find((e) => e.id === "sound:FARM").tracks.length > 0, "FARM is named by a track");
});
