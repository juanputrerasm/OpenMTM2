// Which game an added archive belongs to (worker/addon-store.js `detectArchiveGame`), told from what it holds: an
// archive of vehicles alone must be known too, or its trucks are never listed. Skips without the games under ~/games.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../src/vendor/openphotex/index.js";
import { detectArchiveGame } from "../src/worker/addon-store.js";
import { createVfs, gameFamily } from "../src/worker/vfs.js";
import { buildCatalog } from "../src/worker/catalog.js";
import { skipLocal } from "./helpers/stock.mjs";

const GAMES = process.env.OPENMTM2_GAMES ?? join(process.env.HOME ?? "", "games");
const CASES = [
  ["cpr/RACECAR.POD", "CPR"], ["evo1/TRUCK.POD", "EVO1"], ["evo2/TRUCK.POD", "EVO2"],
  ["tv/CDROM.POD", "TV"], ["hb/GAME.POD", "HB"], ["mtm2/TRUCK2.POD", "MTM2"], ["evo2/PEAK.pod", "EVO2"],
];

for (const [path, game] of CASES) {
  test(`${path} is ${game}`, { skip: skipLocal(join(GAMES, path), `${path} is not under ${GAMES}`) }, async () => {
    const bytes = new Uint8Array(readFileSync(join(GAMES, path)));
    const archive = parsePod(bytes);
    assert.equal(await detectArchiveGame(archive, async (entry) => readPodEntry(bytes, entry)), game);
  });
}

test("an archive with nothing that tells is not guessed at", async () => {
  assert.equal(await detectArchiveGame({ entries: [{ normalizedName: "ART\\\\X.RAW" }] }, async () => new Uint8Array(0)), null);
});

test("an archive of MTM trucks whose game was never told still lists its trucks", { skip: skipLocal(join(GAMES, "mtm2/TRUCK2.POD"), "no MTM2 install") }, async () => {
  const bytes = new Uint8Array(readFileSync(join(GAMES, "mtm2/TRUCK2.POD")));
  const mount = { name: "ADDON.POD", family: gameFamily(null), archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) };
  const { trucks } = await buildCatalog(createVfs([mount]));
  assert.ok(trucks.length > 0, "trucks from an archive of unknown game");
});
