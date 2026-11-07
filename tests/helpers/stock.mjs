/*
  The local MTM2 install, for tests that need real game files.

  These tests are opt-in: they run only with OPENMTM2_STOCK=1 (`OPENMTM2_STOCK=1 node --test tests/`), so the
  default suite never depends on what is installed. A player's install changes (POD.INI gains archives, a POD is
  rebuilt with more trucks or tracks), so even then they mount only the retail archives, in retail order
  (`stockVfs`), and name what they check instead of counting what is there. Tests using it must skip
  (`skipWithoutStock()` or `skipLocal()` as node:test's `skip` option). Nothing read here may be committed.
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../../src/vendor/openphotex/index.js";
import { parsePodIni } from "../../src/install/pod-ini.js";
import { createVfs } from "../../src/worker/vfs.js";

export const GAMES = process.env.OPENMTM2_GAMES ?? join(process.env.HOME ?? "", "games");
/** Whether the tests that read local game files were asked for. */
export const STOCK_OPT_IN = process.env.OPENMTM2_STOCK === "1";
const NOT_ASKED = "local game files are opt-in: set OPENMTM2_STOCK=1";
/** Reason string for node:test's `skip` for a test that reads `path` (absolute), or false when asked for and present. */
export const skipLocal = (path, reason = `${path} is not present`) => (!STOCK_OPT_IN ? NOT_ASKED : existsSync(path) ? false : reason);
export const STOCK_DIR = join(GAMES, "mtm2");

/** The path of a file in the install, matched without regard to case. */
export function stockPath(name) {
  const direct = join(STOCK_DIR, name);
  if (existsSync(direct)) return direct;
  const upper = join(STOCK_DIR, name.toUpperCase());
  if (existsSync(upper)) return upper;
  return join(STOCK_DIR, name.toLowerCase());
}

export function hasStock(name = "POD.INI") {
  return existsSync(stockPath(name));
}

/** Reason string for node:test's `skip`, or false when the file is present. */
export function skipWithoutStock(name = "POD.INI") {
  if (!STOCK_OPT_IN) return NOT_ASKED;
  if (name.toUpperCase() === "POD.INI") {
    const missing = RETAIL_PODS.filter((pod) => !hasStock(pod));
    return missing.length ? `the MTM2 install under ${STOCK_DIR} lacks ${missing.join(", ")}` : false;
  }
  return hasStock(name) ? false : `no local MTM2 install with ${name} under ${STOCK_DIR}`;
}

export function readStock(name) {
  return new Uint8Array(readFileSync(stockPath(name)));
}

/** A stock POD parsed with OpenPhotex, with a synchronous entry reader. */
export function openStockPod(name) {
  const bytes = readStock(name);
  const archive = parsePod(bytes);
  return { archive, read: (entry) => readPodEntry(bytes, entry) };
}

/**
 * The 19 archives retail MTM2's POD.INI lists, in its order. A player's POD.INI may add others (HD textures, truck
 * packs such as FIXMORE4), usually ahead of these so they win.
 */
export const RETAIL_PODS = Object.freeze([
  "STARTUP.POD", "MUSIC.POD", "SOUND.POD", "TRUCK2.POD", "COCKPIT.POD", "UI.POD", "TPARK.POD", "ALASKA.POD", "JUNK.POD",
  "CRAZY98.POD", "SNAKE.POD", "MAIN.POD", "AZTEC.POD", "OUTBACK.POD", "ROCKQRY.POD", "BAJA.POD", "SUMMIT1.POD",
  "SUMMIT2.POD", "SUMMIT3.POD",
]);

/** The install's POD.INI, parsed. */
export function stockPodIni() {
  return parsePodIni(new TextDecoder().decode(readStock("POD.INI")));
}

/** The 15 tracks retail MTM2 ships, by SIT file, with their race types; GRAVEY and WAR are hidden. */
export const RETAIL_TRACKS = Object.freeze({
  "TPARK.SIT": "circuit", "ALASKA.SIT": "circuit", "GRAVEY.SIT": "circuit", "JUNK.SIT": "circuit", "CRAZY98.SIT": "circuit",
  "SNAKE.SIT": "rally", "WAR.SIT": "circuit", "MAIN.SIT": "rally", "AZTEC.SIT": "circuit", "AUSSIE.SIT": "rally",
  "ROCKQRY.SIT": "circuit", "BAJA.SIT": "rally", "SUMMIT1.SIT": "summit", "SUMMIT2.SIT": "summit", "SUMMIT3.SIT": "summit",
});
/** The retail tracks among a catalog's, in its order; an archive rebuilt with more tracks adds nothing here. */
export const retailTracks = (tracks) => tracks.filter((t) => Object.hasOwn(RETAIL_TRACKS, t.file.toUpperCase()));

/** The 20 trucks retail MTM2 ships, by TRK file. */
export const RETAIL_TRUCKS = Object.freeze([
  "BEARFOOT.TRK", "BIGFOOT.TRK", "BOOGEY.TRK", "BULLDZR.TRK", "CRUSHER.TRK", "DIGGER.TRK", "EXECUTE.TRK", "FIRESTN.TRK",
  "HITMAN.TRK", "HOGAN.TRK", "MONSTER.TRK", "NITEMARE.TRK", "OUTSDR.TRK", "OVERKILL.TRK", "RAMPAGE.TRK", "SAMSON.TRK",
  "SNAKEBIT.TRK", "STALLION.TRK", "STINGER.TRK", "WILDFOOT.TRK",
]);

/** The retail archives mounted from disk in retail order, as the asset worker mounts OPFS; a player's own additions are left out. */
export function stockVfs() {
  return createVfs(RETAIL_PODS.map((key) => {
    const bytes = readStock(key);
    return { name: key, archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) };
  }));
}
