/*
  The local MTM2 install, for tests that need real game files.

  Tests using it must skip when it is absent (`skipWithoutStock()` as node:test's `skip`
  option), so the suite passes on machines without the game. Nothing read here may be
  committed.
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../../src/vendor/openphotex/index.js";
import { parsePodIni } from "../../src/install/pod-ini.js";
import { createVfs } from "../../src/worker/vfs.js";

const GAMES = process.env.OPENMTM2_GAMES ?? join(process.env.HOME ?? "", "games");
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

/** The 20 trucks retail MTM2 ships, by TRK file. */
export const RETAIL_TRUCKS = Object.freeze([
  "BEARFOOT.TRK", "BIGFOOT.TRK", "BOOGEY.TRK", "BULLDZR.TRK", "CRUSHER.TRK", "DIGGER.TRK", "EXECUTE.TRK", "FIRESTN.TRK",
  "HITMAN.TRK", "HOGAN.TRK", "MONSTER.TRK", "NITEMARE.TRK", "OUTSDR.TRK", "OVERKILL.TRK", "RAMPAGE.TRK", "SAMSON.TRK",
  "SNAKEBIT.TRK", "STALLION.TRK", "STINGER.TRK", "WILDFOOT.TRK",
]);

/** The stock install mounted from disk, in POD.INI order, as the asset worker mounts OPFS: mods included. */
export function stockVfs() {
  return createVfs(stockPodIni().keys.map((key) => {
    const bytes = readStock(key);
    return { name: key, archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) };
  }));
}
