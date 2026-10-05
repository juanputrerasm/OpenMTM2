import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePod, readPodEntry, writePod1 } from "../src/vendor/openphotex/index.js";
import { createVfs } from "../src/worker/vfs.js";
import { buildCatalog } from "../src/worker/catalog.js";
import { parsePodIni } from "../src/install/pod-ini.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

const text = (s) => new TextEncoder().encode(s);

function mountOf(name, bytes) {
  return { name, archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) };
}

test("the first mounted POD wins a path, lookups ignore case and slash style", async () => {
  const first = writePod1("first", [{ name: "ART\\A.RAW", data: text("first") }]);
  const second = writePod1("second", [
    { name: "ART\\A.RAW", data: text("second") },
    { name: "ART\\B.RAW", data: text("only in second") },
  ]);
  const vfs = createVfs([mountOf("FIRST.POD", first), mountOf("SECOND.POD", second)]);
  assert.equal(new TextDecoder().decode(await vfs.read("art/a.raw")), "first");
  assert.equal(new TextDecoder().decode(await vfs.read("ART\\B.RAW")), "only in second");
  assert.equal(vfs.find("ART/A.RAW").mount.name, "FIRST.POD");
  assert.equal(await vfs.read("ART/MISSING.RAW"), null);
  assert.deepEqual(vfs.list(".raw").map((hit) => `${hit.path}@${hit.mount.name}`),
    ["ART/A.RAW@FIRST.POD", "ART/B.RAW@SECOND.POD"]);
});


test("the stock catalog has 15 MTM2 tracks, 2 of them hidden", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { tracks, problems } = await buildCatalog(stockVfs());
  assert.deepEqual(problems, []);
  assert.equal(tracks.length, 15);
  assert.deepEqual(tracks.filter((t) => t.hidden).map((t) => t.file).sort(), ["GRAVEY.SIT", "WAR.SIT"]);
  const farm = tracks.find((t) => t.file === "TPARK.SIT");
  assert.equal(farm.name, "Farm Road 29");
  assert.equal(farm.raceType, "circuit");
  const counts = {};
  for (const t of tracks) counts[t.raceType] = (counts[t.raceType] ?? 0) + 1;
  assert.deepEqual(counts, { circuit: 8, rally: 4, summit: 3 });
});

test("the stock catalog lists the 20 trucks; retail ships no CHUCK.TRK", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { trucks, problems } = await buildCatalog(stockVfs());
  assert.deepEqual(problems, []);
  assert.equal(trucks.length, 20);
  assert.deepEqual(trucks.filter((t) => t.hidden), []);
  assert.ok(trucks.every((t) => t.name && t.dialect));
});

test("default laps: a Circuit's come from its track length, trunc(15000 / length + 1), 6000 ft when missing", async () => {
  const { defaultLaps } = await import("../src/worker/catalog.js");
  assert.equal(defaultLaps("circuit", 5973.36), 3);
  assert.equal(defaultLaps("circuit", 11665.5), 2);
  assert.equal(defaultLaps("circuit", 1579.7), 10);
  assert.equal(defaultLaps("circuit", null), 3);
  assert.equal(defaultLaps("summit", 6317), 5);
  assert.equal(defaultLaps("rally", 22445), 1);
  assert.equal(defaultLaps("drag", null), 1);
});

test("the loading screen: ART\\DATA480.RAW with its palette, 640 x 480", { skip: skipWithoutStock("STARTUP.POD") }, async () => {
  const { loadingScreen } = await import("../src/worker/screen-art.js");
  const image = await loadingScreen(stockVfs());
  assert.equal(image.width, 640);
  assert.equal(image.height, 480);
  assert.equal(image.rgba.length, 640 * 480 * 4);
  const summit = await loadingScreen(stockVfs(), { raceType: "summit" });
  assert.ok(summit && summit.rgba.some((v, i) => v !== image.rgba[i]), "the Summit Rumble screen differs");
});

test("each stock truck lists its three name clips for the announcer", { skip: skipWithoutStock("POD.INI") }, async () => {
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const { trucks } = await buildCatalog(stockVfs());
  const bigfoot = trucks.find((t) => t.file === "BIGFOOT.TRK");
  assert.deepEqual(bigfoot.waves, ["bfootf.wav", "bfootu.wav", "bfootd.wav"]);
  assert.ok(trucks.every((t) => t.waves.length === 3), "three each");
});
