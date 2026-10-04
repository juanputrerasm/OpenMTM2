/*
  The local MTM2 install, for tests that need real game files.

  Tests using it must skip when it is absent (`skipWithoutStock()` as node:test's `skip`
  option), so the suite passes on machines without the game. Nothing read here may be
  committed.
*/
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../../src/vendor/openphotex/index.js";

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

export function hasStock(name = "MONSTER.EXE") {
  return existsSync(stockPath(name));
}

/** Reason string for node:test's `skip`, or false when the file is present. */
export function skipWithoutStock(name = "MONSTER.EXE") {
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
