import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry } from "../src/vendor/openphotex/index.js";
import { createVfs } from "../src/worker/vfs.js";
import { buildTruckRender } from "../src/worker/truck-build.js";
import { createPaletteResolver } from "../src/worker/palette-resolver.js";
import { skipLocal } from "./helpers/stock.mjs";

const GAMES = process.env.OPENMTM2_GAMES ?? join(process.env.HOME ?? "", "games");
const TRUCK_POD = join(GAMES, "mtm1", "TRUCK.POD");

test("an MTM1 truck draws the one tire model its TRK names on every corner (POWERBIG: wheel13.bin)", {
  skip: skipLocal(GAMES) || (existsSync(TRUCK_POD) ? false : `no Monster Truck Madness 1 TRUCK.POD under ${GAMES}/mtm1`),
}, async () => {
  const bytes = new Uint8Array(readFileSync(TRUCK_POD));
  const vfs = createVfs([{ name: "TRUCK.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) }]);
  const truck = await buildTruckRender(vfs, "POWERBIG.TRK", createPaletteResolver(vfs, "MTM1", null));
  assert.ok(truck.parts.tireLeft, "a tire model");
  assert.equal(truck.parts.tireLeft, truck.parts.tireRight);
  assert.ok(truck.parts.tireLeft.meshes.length > 0);
});

test("with MTM1 trucks kept apart, MTM2's Bigfoot shadows MTM1's, which is listed and built as MTM1:BIGFOOT.TRK", {
  skip: skipLocal(GAMES) || (existsSync(TRUCK_POD) && existsSync(join(GAMES, "mtm2", "POD.INI")) ? false : "needs the MTM1 TRUCK.POD and an MTM2 install"),
}, async () => {
  const { stockVfs } = await import("./helpers/stock.mjs");
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const stock = stockVfs();
  const bytes = new Uint8Array(readFileSync(TRUCK_POD));
  const vfs = createVfs([
    ...stock.allMounts.map((m) => ({ ...m, game: "MTM2" })),
    { name: "TRUCK.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry), family: "MTM", game: "MTM1" },
  ]);
  const { trucks } = await buildCatalog(vfs);
  const plain = trucks.find((t) => t.file === "BIGFOOT.TRK"), apart = trucks.find((t) => t.file === "MTM1:BIGFOOT.TRK");
  assert.equal(plain.dialect, "MTM2");
  assert.ok(apart?.apart);
  assert.match(apart.name, /\(MTM1\)$/);
  // An MTM1 truck MTM2 has no namesake for is listed once, as it is.
  assert.ok(trucks.some((t) => t.file === "POWERBIG.TRK"));
  assert.ok(!trucks.some((t) => t.file === "MTM1:POWERBIG.TRK"));
  const palettes = createPaletteResolver(vfs, "MTM2", null);
  const mtm2 = await buildTruckRender(vfs, "BIGFOOT.TRK", palettes), mtm1 = await buildTruckRender(vfs, "MTM1:BIGFOOT.TRK", palettes);
  assert.equal(mtm1.file, "MTM1:BIGFOOT.TRK");
  assert.ok(mtm1.parts.tireLeft && mtm1.parts.body);
  assert.notDeepEqual(mtm1.anchors, mtm2.anchors);
});

test("MTM1 trucks are told by their manifests, also when MTM1's TRUCK.POD is listed in the MTM2 install's own POD.INI", {
  skip: skipLocal(GAMES) || (existsSync(TRUCK_POD) && existsSync(join(GAMES, "mtm2", "POD.INI")) ? false : "needs the MTM1 TRUCK.POD and an MTM2 install"),
}, async () => {
  const { stockVfs } = await import("./helpers/stock.mjs");
  const { buildCatalog } = await import("../src/worker/catalog.js");
  const bytes = new Uint8Array(readFileSync(TRUCK_POD));
  const vfs = createVfs([
    ...stockVfs().allMounts.map((m) => ({ ...m, game: "MTM2" })),
    { name: "MTM1TRUCK.POD", archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry), family: "MTM", game: "MTM2" },
  ]);
  const { trucks } = await buildCatalog(vfs);
  const apart = trucks.filter((t) => t.apart).map((t) => t.file);
  for (const file of ["BIGFOOT.TRK", "SAMSON.TRK", "SNAKEBIT.TRK"]) assert.ok(apart.includes(`MTM1:${file}`), file);
  // GRAVE.TRK has no MTM2 namesake: it is listed once, under its own name.
  assert.ok(trucks.some((t) => t.file === "GRAVE.TRK") && !apart.includes("MTM1:GRAVE.TRK"));
  const palettes = createPaletteResolver(vfs, "MTM2", null);
  const built = await buildTruckRender(vfs, "MTM1:SAMSON.TRK", palettes), mtm2 = await buildTruckRender(vfs, "SAMSON.TRK", palettes);
  assert.equal(built.name, "Samson (MTM1)");
  assert.ok(built.parts.tireLeft && built.parts.body);
  // Built from MTM1's own manifest, whose anchors are not MTM2's.
  assert.notDeepEqual(built.anchors, mtm2.anchors);
});
