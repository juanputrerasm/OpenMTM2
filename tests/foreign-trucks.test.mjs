// CART Precision Racing's cars and the 4x4 Evolution trucks as trucks (worker/foreign-truck-build.js, docs/PLAN.md
// Stage 3.1). The tests with real files skip without the games under ~/games.

import test from "node:test";
import { cprAnchorsForSag } from "../src/shared/cpr-anchors.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePod, readPodEntry, mtm2Sim as S } from "../src/vendor/openphotex/index.js";
import { createVfs } from "../src/worker/vfs.js";
import { buildCatalog } from "../src/worker/catalog.js";
import { buildTruckRender } from "../src/worker/truck-build.js";
import { foreignTruckId, parseForeignTruckId, tireSize } from "../src/worker/foreign-truck-build.js";
import { raceEntrants } from "../src/game/race-setup.js";

const GAMES = process.env.OPENMTM2_GAMES ?? join(process.env.HOME ?? "", "games");
const mount = (game, dir, file) => {
  const bytes = new Uint8Array(readFileSync(join(GAMES, dir, file)));
  return { name: file, family: game, archive: parsePod(bytes), readEntry: async (entry) => readPodEntry(bytes, entry) };
};
const ARCHIVES = [["CPR", "cpr", "RACECAR.POD"], ["EVO1", "evo1", "TRUCK.POD"], ["EVO2", "evo2", "TRUCK.POD"]];
const missing = ARCHIVES.filter(([, dir, file]) => !existsSync(join(GAMES, dir, file))).map(([, dir, file]) => `${dir}/${file}`);
const skip = missing.length ? `not installed under ${GAMES}: ${missing.join(", ")}` : false;

test("a vehicle of another game is named <GAME>:<file>; an MTM truck's name is not one", () => {
  assert.equal(foreignTruckId("EVO2", "truck\\cbls24.trk"), "EVO2:CBLS24.TRK");
  assert.deepEqual(parseForeignTruckId("cpr:davis.car"), { game: "CPR", file: "DAVIS.CAR" });
  assert.equal(parseForeignTruckId("BIGFOOT.TRK"), null);
  assert.equal(parseForeignTruckId(null), null);
});

test("a tire model's size: half its height, and its extent across", () => {
  assert.deepEqual(tireSize({ bounds: { min: [-0.5, -1.2, -1.2], max: [0.5, 1.2, 1.2] } }), { radiusFt: 1.2, widthFt: 1 });
  assert.equal(tireSize({ bounds: null }), null);
  assert.equal(tireSize(null), null);
});

test("the computer's default trucks are MTM's own; another game's races when it is picked", () => {
  const trucks = [{ file: "A.TRK" }, { file: "B.TRK" }, { file: "EVO1:X.TRK", game: "EVO1" }, { file: "CPR:Y.CAR", game: "CPR" }];
  for (let seed = 0; seed < 40; seed++) {
    let n = seed;
    const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const drawn = raceEntrants({ playerTruck: "A.TRK", trucks, slots: 8, opponents: 3, random });
    assert.ok(drawn.every((d) => !d.file.includes(":")), drawn.map((d) => d.file).join(" "));
  }
  const picked = raceEntrants({ playerTruck: "EVO1:X.TRK", trucks, slots: 8, opponents: ["CPR:Y.CAR"] });
  assert.deepEqual(picked.map((d) => d.file).sort(), ["CPR:Y.CAR", "EVO1:X.TRK"]);
});

test("the catalog lists the cars and trucks of the mounted games, titled with their game", { skip }, async () => {
  const vfs = createVfs(ARCHIVES.map(([game, dir, file]) => mount(game, dir, file)));
  const { trucks, problems } = await buildCatalog(vfs);
  assert.deepEqual(problems, []);
  const count = (game) => trucks.filter((t) => t.game === game).length;
  assert.equal(count("CPR"), 29);
  assert.equal(count("EVO1"), 121);
  assert.equal(count("EVO2"), 150);
  const davis = trucks.find((t) => t.file === "CPR:DAVIS.CAR");
  assert.equal(davis.name, "Davis/Salles (CPR)");
  // The same file in both Evolution games is two trucks.
  assert.ok(trucks.some((t) => t.file === "EVO1:CBLS24.TRK") && trucks.some((t) => t.file === "EVO2:CBLS24.TRK"));
  assert.equal(new Set(trucks.map((t) => t.file)).size, trucks.length);
});

test("a CPR car and an Evolution truck of each game build, with art, and the simulation rests them on their own tires", { skip }, async () => {
  const vfs = createVfs(ARCHIVES.map(([game, dir, file]) => mount(game, dir, file)));
  const terrain = S.createTerrain(new Uint8Array(65536).fill(50));
  const ground = S.createTerrainGround(terrain, null, 0, null);
  for (const id of ["CPR:DAVIS.CAR", "EVO1:CBLS24.TRK", "EVO2:CBLS24.TRK"]) {
    const truck = await buildTruckRender(vfs, id, null);
    assert.ok(truck, `${id} builds`);
    assert.equal(truck.file, id);
    assert.ok(truck.parts.body.meshes.length > 0, `${id} has a body`);
    assert.ok(truck.parts.tireLeft?.meshes.length && truck.parts.tireRight?.meshes.length, `${id} has tires`);
    assert.equal(truck.anchors.length, 4);
    assert.equal(truck.scrapePoints.length, 12);
    assert.ok(truck.anchors[0][0] > 0 && truck.anchors[1][0] < 0 && truck.anchors[0][2] > 0 && truck.anchors[2][2] < 0, `${id}: FR, FL, RR, RL`);
    const named = new Set(Object.values(truck.parts).flatMap((p) => (p?.meshes ?? []).map((m) => m.textureName)).filter(Boolean));
    const found = [...named].filter((name) => truck.textures[name]?.rgba?.length);
    assert.ok(found.length > 0 && found.length >= named.size - 1, `${id}: ${found.length} of ${named.size} textures decoded`);
    assert.ok(truck.tire.radiusFt > 0.5 && truck.tire.radiusFt < 2.5, `${id}: tire radius ${truck.tire.radiusFt} ft`);
    assert.equal(truck.suspension, null);
    // Driven by MTM2's model on its own tires: it settles, upright, lower than a monster truck.
    const figures = { wheelAnchors: truck.anchors, scrapePoints: truck.scrapePoints, tireRadiusFt: truck.tire.radiusFt, tireWidthFt: truck.tire.widthFt };
    let p = S.createTruckParams(figures);
    // A CPR car's anchors for MTM2's springs, as the simulation worker sets them.
    if (truck.restHubs) p = S.createTruckParams({ ...figures, wheelAnchors: cprAnchorsForSag(truck.restHubs, p.sagFt) });
    const s = S.createTruckState([1000, 106, 1000], 0, S.GEAR.NEUTRAL, p);
    const ctx = { ground, human: false, difficulty: S.DIFFICULTY.INTERMEDIATE, sonicTrack: false };
    for (let i = 0; i < 300; i++) { S.stepTruck(s, p, ctx, 1 / 60); S.postStepTruck(s, p, ground, 1 / 60); }
    assert.ok(Number.isFinite(s.pos[1]) && s.pos[1] > 100 && s.pos[1] < 104, `${id} rests at ${s.pos[1]} ft over ground at 100`);
    assert.ok(s.matrix[4] > 0.98, `${id} is upright (${s.matrix[4]})`);
  }
});

test("a vehicle whose game is not mounted is not built", async () => {
  assert.equal(await buildTruckRender(createVfs([]), "EVO1:CBLS24.TRK", null), null);
});
