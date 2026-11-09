/*
  Community Patch 4's lakes, fog volumes and vegetation as the port builds them (docs/CP4_EXE_ANALYSIS.md 2, 3, 4):
  src/worker/cp4-world.js, src/game/lakes.js, src/game/fog-volumes.js, src/game/vegetation.js, and the LTE on the fine
  terrain mesh (src/worker/terrain-mesh.js). No game files.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { buildLakeSheets, buildVegetation, sceneTurn, vegetationWalls, VEG_PLACE_STRIDE } from "../src/worker/cp4-world.js";
import { LAKE_OWN_PASS_FT, lakeAt, lakeReflectionPlan, waterLevelAt } from "../src/game/lakes.js";
import { FOG_VOLUMES_DRAWN, FOG_VOLUMES_KEPT, fogVolumeInWeather, fogVolumeLight, fogVolumeOf, fogVolumesOf, fogVolumesShown } from "../src/game/fog-volumes.js";
import { VEG_CROSSFADE, VEG_NO_FAR_CARD, bandShare, grassKept, treeShown, trunkOf, vegDistances } from "../src/game/vegetation.js";
import { parseMtm2Veg, writeMtm2Veg } from "../src/vendor/openphotex/mtm/veg.js";
import { parseSitFog } from "../src/vendor/openphotex/mtm/sit.js";
import { eulerToMatrix } from "../src/vendor/openphotex/sim/mtm2/math.js";
import { toSceneMatrix } from "../src/shared/scene-frame.js";
import { buildFineTerrainMesh, buildTerrainAtlas } from "../src/worker/terrain-mesh.js";

// ---- Lakes -------------------------------------------------------------------------------------------------------

function lakeBuild() {
  const tileMap = new Uint8Array(65536);
  // Lake 1: tiles x 10..12 on row 5 and x 10 on row 6. Lake 2: one tile at (255, 255), on the world's edge.
  for (const x of [10, 11, 12]) tileMap[5 * 256 + x] = 1;
  tileMap[6 * 256 + 10] = 1;
  tileMap[255 * 256 + 255] = 2;
  const levelFt = new Float32Array(256);
  levelFt[1] = 40.5;
  levelFt[2] = 12;
  return { tileMap, levelFt, bodies: [{ id: 1, levelFt: 40.5, reflective: true }, { id: 2, levelFt: 12, reflective: false }, { id: 3, levelFt: 9, reflective: true }] };
}

test("a lake's sheet is its tiles, each row's run merged into one quad, flat at its surface and facing up", () => {
  const sheets = buildLakeSheets(lakeBuild());
  assert.deepEqual(sheets.map((s) => s.id), [1, 2], "a body with no tile has no sheet");
  const one = sheets[0].sheet;
  assert.equal(one.indices.length / 6, 2, "row 5's three tiles are one quad, row 6's tile another");
  const p = one.positions;
  for (let i = 1; i < p.length; i += 3) assert.equal(p[i], 40.5);
  // The first quad covers x 320..416 ft, game z 160..192 ft (scene z mirrored).
  const xs = [p[0], p[3], p[6], p[9]], zs = [p[2], p[5], p[8], p[11]];
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [320, 416]);
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [-192, -160]);
  // UVs as the track's water plane: x / 8192, game z / 8192.
  assert.equal(one.uvs[2], 416 / 8192);
  assert.equal(one.uvs[3], 160 / 8192);
  // Each triangle faces up in the scene.
  for (let t = 0; t < one.indices.length; t += 3) {
    const [a, b, c] = [one.indices[t], one.indices[t + 1], one.indices[t + 2]].map((v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
    const u = [b[0] - a[0], b[2] - a[2]], w = [c[0] - a[0], c[2] - a[2]];
    // y of (b - a) x (c - a) = uz wx - ux wz.
    assert.ok(u[1] * w[0] - u[0] * w[1] > 0, "the face's normal points up");
  }
});

test("the eye's water is a lake's on its tiles, the track's elsewhere, the world wrapping", () => {
  const lakes = lakeBuild();
  assert.equal(lakeAt(lakes, 330, 170), 1);
  assert.equal(waterLevelAt(lakes, 330, 170, 5), 40.5);
  assert.equal(waterLevelAt(lakes, 330, 230, 5), 5, "off the lake: the track's water");
  assert.equal(waterLevelAt(lakes, -10, -10, null), 12, "(-10, -10) is tile (255, 255) of the world before");
  assert.equal(waterLevelAt(null, 0, 0, 7), 7);
});

test("lakes share the base plane's reflection within 10 ft of it; the next two higher would have their own pass", () => {
  const bodies = [5, 8, 15, 15, 30, 60].map((levelFt) => ({ levelFt }));
  const plan = lakeReflectionPlan(bodies, 4);
  assert.equal(LAKE_OWN_PASS_FT, 10);
  assert.equal(plan.base, 4);
  assert.deepEqual(plan.shared, [5, 8]);
  assert.deepEqual(plan.ownPass, [15, 30], "grouped by distinct height, lowest first, base + waterMirrorExtra 2");
  assert.deepEqual(plan.unserved, [60]);
  assert.equal(lakeReflectionPlan(bodies, null).base, 5, "no track water: the lowest lake is the base");
});

// ---- Fog volumes -------------------------------------------------------------------------------------------------

const fogBox = (fields, extra = {}) => ({ type: 14, positionFt: [100, 50, 200], sizeFt: [30, 20, 10], psi: 0.5, fog: parseSitFog(fields), ...extra });

test("a fog box is a volume with base as its bottom face and the engine's shader inputs", () => {
  const v = fogVolumeOf(fogBox("40,60,12,3,300,0.5,0.6,0.7,8,50,20,0.9,511,0.4,0,40,3,2"));
  assert.deepEqual(v.centre, [100, 50 + 3 + 6, 200]);
  assert.deepEqual(v.half, [20, 6, 30]);
  assert.equal(v.heading, 0.5);
  assert.equal(v.extinction, 3 / 300, "about 5 % transmission after vis ft");
  assert.equal(v.falloff, 1 / 8);
  assert.equal(v.edge, 20, "soft edge at most half the smaller of w and l");
  assert.equal(v.top, 12, "soft top at most h");
  assert.equal(v.bottom, 2);
  assert.equal(v.maxOpacity, 0.9);
  assert.equal(v.round, 0.4);
});

test("a zero size falls back to the box's own; a side of 0.5 ft or less is not drawn", () => {
  const v = fogVolumeOf(fogBox(""));
  // The box's sizes are [length, width, height].
  assert.deepEqual(v.half, [10, 5, 15]);
  assert.equal(v.extinction, 3 / 300, "vis defaults to 300");
  assert.equal(v.wmask, 0x1ff);
  assert.equal(fogVolumeOf(fogBox("0.5,10,10")).usable, false);
});

test("only type 14 boxes give fog volumes, at most 64", () => {
  const boxes = [fogBox(""), { ...fogBox(""), type: 12 }, { type: 14, positionFt: [0, 0, 0] }, ...Array.from({ length: 80 }, () => fogBox(""))];
  const volumes = fogVolumesOf(boxes);
  assert.equal(FOG_VOLUMES_KEPT, 64);
  assert.equal(volumes.length, 64);
});

test("the weather mask's bit n is weather n, and the colour takes the weather's light", () => {
  const v = fogVolumeOf(fogBox("0,0,0,0,300,0.5,0.5,0.5,8,20,5,1,20")); // 0b10100: Foggy and Rain
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].filter((w) => fogVolumeInWeather(v, w)), [2, 4]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(fogVolumeLight), [1, 0.7, 1, 1, 0.3, 1, 0.375, 0.25, 0.05]);
});

test("the volumes drawn: in the weather, within the draw range and a tile, the nearest 16 first, across the world's seam", () => {
  const at = (x, z, mask = "511") => fogVolumeOf({ type: 14, positionFt: [x, 0, z], sizeFt: [20, 20, 20], psi: 0, fog: parseSitFog(`0,0,0,0,300,0.5,0.5,0.5,8,20,5,1,${mask}`) });
  const volumes = [at(8100, 0), at(500, 0), at(1000, 0, "1"), ...Array.from({ length: 20 }, (_, i) => at(100 + i * 10, 300))];
  const shown = fogVolumesShown(volumes, [50, 0], 2, 600);
  assert.equal(shown.length, FOG_VOLUMES_DRAWN);
  assert.equal(shown[0].volume, volumes[0], "8100 ft is 142 ft away across the seam");
  assert.equal(shown[0].dx, 8100 - 8192 - 50);
  assert.ok(!shown.some((s) => s.volume === volumes[2]), "its mask leaves Foggy out");
  // A volume whose near side is within the range and a tile is kept: 500 ft away, less its radius of 14.1 ft.
  assert.equal(fogVolumesShown([volumes[1]], [0, 0], 0, 460).length, 1);
  assert.equal(fogVolumesShown([volumes[1]], [0, 0], 0, 450).length, 0);
});

// ---- Vegetation --------------------------------------------------------------------------------------------------

test("without the crossfade flag a tree swaps at 950 ft: its model to 951, its card from 950", () => {
  const { model, card } = vegDistances({ kind: 0, flags: 0, farModel: "CARD.BIN" });
  assert.deepEqual(model, [0, 0, 951, 951]);
  assert.deepEqual(card, [950, 950, Infinity, Infinity]);
  assert.equal(bandShare(model, 950.5), 1);
  assert.equal(bandShare(model, 951), 0);
  assert.equal(bandShare(card, 949.9), 0);
  assert.equal(bandShare(card, 950), 1);
});

test("with the crossfade flag the model fades out and the card in over 900..1000 ft", () => {
  const { model, card } = vegDistances({ kind: 0, flags: VEG_CROSSFADE, farModel: "CARD.BIN" });
  assert.equal(bandShare(model, 900), 1);
  assert.equal(bandShare(model, 950), 0.5);
  assert.equal(bandShare(card, 950), 0.5);
  assert.equal(bandShare(model, 1000), 0);
  assert.equal(bandShare(card, 1000), 1);
});

test("flag 0x08, or no card named, is no far card; distances scale with vegLodScale", () => {
  assert.equal(vegDistances({ kind: 0, flags: VEG_NO_FAR_CARD, farModel: "CARD.BIN" }).card, null);
  assert.equal(vegDistances({ kind: 0, flags: 0, farModel: "" }).card, null);
  assert.deepEqual(vegDistances({ kind: 0, flags: 0, farModel: "C" }, { lodScale: 200 }).card, [1900, 1900, Infinity, Infinity]);
});

test("grass is drawn to 1000 ft, fading from 750; a tile keeps ceil(n x density / 100); a tree's tier is against the scenery detail", () => {
  const { model, card } = vegDistances({ kind: 1, flags: 0 });
  assert.deepEqual(model, [0, 0, 750, 1000]);
  assert.equal(card, null);
  assert.equal(bandShare(model, 875), 0.5);
  assert.equal(grassKept(10, 100), 10);
  assert.equal(grassKept(10, 25), 3);
  assert.equal(grassKept(10, 0), 1, "density clamps to 1..100");
  assert.ok(treeShown(1, 1) && !treeShown(2, 1));
});

/** A small .VEG through OpenPhotex's own writer and reader. */
function sampleVeg() {
  return parseMtm2Veg(writeMtm2Veg({
    species: [
      { model: "PINE.BIN", farModel: "PINEF.BIN", kind: 0, collide: 1, flags: 1, trunkDiameter: 0, trunkHeight: 0 },
      { model: "TUFT.BIN", farModel: "", kind: 1, collide: 0, flags: 0, trunkDiameter: 0, trunkHeight: 0 },
      { model: "ROCK.BIN", farModel: "", kind: 0, collide: 2, flags: VEG_NO_FAR_CARD, trunkDiameter: 128, trunkHeight: 160 },
    ],
    trees: {
      count: 3,
      position: Int32Array.from([256 * 100, 256 * 10, 256 * 200, 256 * 300, 0, 256 * 400, 256 * 50, 0, 256 * 60]),
      species: Uint16Array.from([0, 0, 2]), heading: Uint16Array.from([16384, 0, 0]), scale: Uint16Array.from([8192, 4096, 4096]),
      tint: new Uint8Array(3), tier: Uint8Array.from([0, 2, 1]),
    },
    clumps: {
      count: 4, tiles: [{ tx: 1, tz: 2, first: 0, count: 4 }],
      species: Uint16Array.from([1, 1, 1, 1]), offset: Uint8Array.from([8, 16, 0, 0, 0, 0, 0, 0]), y: Int32Array.from([256 * 3, 0, 0, 0]),
      heading: new Uint8Array(4), scale: Uint8Array.from([48, 0, 0, 0]), tint: new Uint8Array(4),
    },
  }));
}

test("vegetation instances: trees above the scenery detail left out, grass thinned by density, placed in the scene frame", () => {
  const veg = sampleVeg();
  const built = buildVegetation(veg, { detail: 1, grassDensity: 50, titleOf: (n) => n.toUpperCase() });
  const [pine, tuft, rock] = built.species;
  assert.equal(pine.place.length / VEG_PLACE_STRIDE, 1, "the tier 2 pine is not drawn at detail 1");
  assert.equal(pine.card, "PINEF.BIN");
  assert.ok(pine.castShadow && !pine.cardShadow);
  assert.equal(tuft.kind, "grass");
  assert.equal(tuft.place.length / VEG_PLACE_STRIDE, 2, "half of the tile's four clumps");
  assert.equal(rock.card, null, "flag 0x08: no far card");
  // The pine: game (100, 10, 200), a quarter turn, scale 2, as toSceneMatrix places a model.
  const m = toSceneMatrix(eulerToMatrix(0, 0, Math.PI / 2, new Array(9)), [100, 10, 200]);
  const p = pine.place;
  assert.deepEqual([p[0], p[1], p[2]], [100, 10, -200]);
  [[3, 0], [4, 2], [5, 8], [6, 10]].forEach(([k, e]) => assert.ok(Math.abs(p[k] - m[e]) < 1e-6, `element ${e}`));
  assert.equal(p[7], 2);
  // A clump: x = tile x * 32 + fx / 8, scale 0.25 + b / 64.
  assert.deepEqual([tuft.place[0], tuft.place[1], tuft.place[2], tuft.place[7]], [33, 3, -66, 1]);
  assert.deepEqual(sceneTurn(0), [1, 0, -0, 1]);
  assert.equal(buildVegetation(veg, { grass: false }).species.some((s) => s.kind === "grass"), false);
  assert.equal(buildVegetation(veg, { hasModel: (n) => n !== "PINEF.BIN" }).species[0].card, null, "a card that cannot be read is not drawn");
});

const boxModel = (min, max, extra = []) => ({ bounds: { min, max }, meshes: [{ positions: Float32Array.from([...min, ...max, ...extra]) }] });

test("a trunk: 30 % of the radius, refined to 65 % of the spread near the base, height 30 % within 6 ft and the model's", () => {
  // A 20 ft wide, 40 ft tall tree: radius 10; three vertices within 5 ft of the base spread 2 ft across.
  const tree = boxModel([-10, 0, -10], [10, 40, 10], [-1, 1, 0, 1, 2, 0, 0, 3, 1]);
  const trunk = trunkOf({ trunkDiameter: 0, trunkHeight: 0 }, tree);
  // min corner, (-1,1,0), (1,2,0), (0,3,1) are within 5 ft of the base: spread x 11, z 11 -> 0.65 x 11.
  assert.ok(Math.abs(trunk.widthFt - 0.65 * 11) < 1e-9);
  assert.equal(trunk.heightFt, 12);
  const bare = { bounds: { min: [-10, 0, -10], max: [10, 10, 10] }, meshes: [] };
  assert.equal(trunkOf({}, bare).widthFt, 3, "no vertices near the base: 30 % of the radius");
  assert.equal(trunkOf({}, bare).heightFt, 6, "at least 6 ft");
  assert.equal(trunkOf({}, { bounds: { min: [0, 0, 0], max: [1, 4, 1] }, meshes: [] }).heightFt, 4, "at most the model's height");
  assert.deepEqual(trunkOf({ trunkDiameter: 128, trunkHeight: 160 }, bare), { widthFt: 2, heightFt: 10, baseFt: 0 });
});

test("trees collide as upright boxes, trunk or model, scaled by the tree; grass and tiers above the detail do not", () => {
  const veg = sampleVeg();
  const models = { "PINE.BIN": { bounds: { min: [-10, 0, -10], max: [10, 40, 10] }, meshes: [] }, "ROCK.BIN": boxModel([-2, -1, -4], [6, 3, 4]) };
  const walls = vegetationWalls(veg, (n) => models[n] ?? null, { detail: 1 });
  assert.equal(walls.length, 2);
  // Traxx's writer keeps the trees sorted by tile: the rock comes first.
  const [rock, pine] = walls;
  // The pine, scale 2: a 3 ft x 12 ft trunk, centred at base + h / 2.
  assert.deepEqual(pine.size, [6, 24, 6]);
  assert.deepEqual(pine.pos, [100, 10 + 12, 200]);
  assert.equal(pine.psi, Math.PI / 2);
  // The rock (collide 2): its bounds, the centre across moved with it.
  assert.deepEqual(rock.size, [8, 4, 8]);
  assert.deepEqual(rock.pos, [52, 1, 60]);
  assert.equal(vegetationWalls(veg, (n) => models[n] ?? null, { detail: 2 }).length, 3);
});

// ---- Fine terrain lighting ---------------------------------------------------------------------------------------

test("a Spline or Full Map track's fine mesh takes the .LTE, each fine point between its cell's four corners", () => {
  const fineFt = new Float32Array(1024 * 1024);
  const clr = new Uint16Array(65536);
  const lte = new Uint8Array(65536 * 7);
  // Corner (row 0, col 1) is lit 255, the others 0.
  lte[(0 * 256 + 1) * 7] = 255;
  const mesh = buildFineTerrainMesh({ fineFt, sub: 4, clr, lte, atlas: buildTerrainAtlas([null]) });
  assert.equal(mesh.hasLte, true);
  // Cell (0, 0): point j = 0, i = 2 is half way to corner (0, 1); j = 2, i = 4 half way down its edge.
  const n = 5;
  assert.equal(mesh.shade[0 * n + 2], 0.5);
  assert.equal(mesh.shade[2 * n + 4], 0.5);
  assert.equal(mesh.shade[0], 0);
  assert.equal(buildFineTerrainMesh({ fineFt, sub: 4, clr, atlas: buildTerrainAtlas([null]) }).hasLte, false);
});
