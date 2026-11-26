/*
  Community Patch 4 2.0.52.4 (docs/CP4_ENGINE_UPDATES.md) in OpenMTM2's track loading: the limits of section 6, the
  vegetation caps, the lakes' height window and wet-tile rule (sections 3 and 5), the sidecars' archive (5) and the
  refusals of sections 3 and 4.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { CP4_LIMITS, checkpointRefusal, withCp4Limits, withCp4VegLimits } from "../src/game/cp4-limits.js";
import { RaceRefusal, readSidecar, situationLevelStem } from "../src/worker/level-load.js";
import { lakesOf, tileLowFt } from "../src/worker/track-build.js";
import { MAX_MTM2_TRACKS } from "../src/worker/catalog.js";

test("2.0.52.4's limits", () => {
  assert.equal(CP4_LIMITS.objects, 4608);
  assert.equal(CP4_LIMITS.objectsSi3, 16384);
  assert.equal(CP4_LIMITS.checkpoints, 100);
  assert.equal(CP4_LIMITS.topCrush, 100);
  assert.equal(CP4_LIMITS.movers, 100);
  assert.equal(CP4_LIMITS.surfaceBoxes, 64);
  assert.equal(MAX_MTM2_TRACKS, 2048);
});

test("objects, top-crush cars and movers past the limit: the first N kept, later movers stand still", () => {
  const boxes = Array.from({ length: 5000 }, (_, i) => ({ type: i < 120 ? 10 : 0, bvel: i < 120 ? [1, 0, 0] : null }));
  const lines = [];
  const sit = withCp4Limits({ boxes, topCrush: Array.from({ length: 150 }, () => ({})) }, (l) => lines.push(l));
  assert.equal(sit.boxes.length, 4608);
  assert.equal(sit.topCrush.length, 100);
  assert.equal(sit.boxes.filter((b) => b.bvel).length, 100);
  assert.equal(sit.boxes[119].type, 10, "the box keeps its place");
  assert.equal(withCp4Limits({ boxes }, () => {}, { si3: true }).boxes.length, 5000, "a .SI3 holds 16,384");
  assert.ok(lines.length >= 3);
});

test("more than 100 checkpoints refuses the track", () => {
  const cps = (n) => ({ boxes: Array.from({ length: n }, () => ({ type: 6 })) });
  assert.equal(checkpointRefusal(cps(100)), null);
  assert.match(checkpointRefusal(cps(101)), /101 checkpoints/);
});

test("vegetation: 64 species, 32,768 trees, a tile of over 1,024 clumps or out of order dropped whole", () => {
  const n = 40000;
  const veg = {
    species: Array.from({ length: 70 }, () => ({})),
    trees: { count: n, position: new Int32Array(3 * n), species: new Uint16Array(n), heading: new Uint16Array(n), scale: new Uint16Array(n), tint: new Uint8Array(n), tier: new Uint8Array(n) },
    clumps: { count: 3000, tiles: [{ tx: 1, tz: 0, first: 0, count: 10 }, { tx: 0, tz: 0, first: 10, count: 10 }, { tx: 2, tz: 0, first: 20, count: 1100 }, { tx: 3, tz: 0, first: 1120, count: 5 }] },
  };
  const out = withCp4VegLimits(veg);
  assert.equal(out.species.length, 64);
  assert.equal(out.trees.count, 32768);
  assert.deepEqual(out.clumps.tiles.map((t) => t.tx), [1, 3]);
});

test("a .WTR body with a tile under the track's water, or out of the height window, is left out", () => {
  const heights = new Uint8Array(256 * 256).fill(20); // 40 ft everywhere
  heights[10 * 256 + 10] = 5; // one corner at 10 ft
  const tileMap = new Uint8Array(65536);
  tileMap[10 * 256 + 10] = 1; tileMap[50 * 256 + 50] = 2; tileMap[60 * 256 + 60] = 3;
  const lake = (id, height) => ({ id, height, heightFt: height / 2, reflective: false, box: {} });
  const level = {
    heights, cells: 256, waterLevelFt: 20,
    lakes: { major: 1, tileMap, lakes: [lake(1, 100), lake(2, 100), lake(3, 5000)] },
    lakeHeightOk: (h) => h >= 1 && h <= 4096,
  };
  assert.equal(tileLowFt(level, 10, 10), 10);
  const kept = lakesOf(level);
  assert.deepEqual(kept.bodies.map((b) => b.id), [2], "1 is wet under the water (10 ft < 20 ft), 3 above 4096");
  assert.equal(kept.tileMap[10 * 256 + 10], 0);
});

test("a sidecar counts only in the level's archive", async () => {
  const a = { name: "A.POD", readEntry: async () => new Uint8Array([1]) }, b = { name: "B.POD", readEntry: async () => new Uint8Array([2]) };
  const files = { "WORLD\\X.WTR": { mount: b, entry: 0 }, "WORLD\\Y.WTR": { mount: a, entry: 0 } };
  const vfs = { find: (p) => files[p] ?? null };
  assert.equal(await readSidecar(vfs, ["WORLD\\X.WTR"], { mount: a }), null);
  assert.deepEqual([...await readSidecar(vfs, ["WORLD\\Q.WTR", "WORLD\\Y.WTR"], { mount: a })], [1]);
});

test("a situation's level is line 1's first token cut at the first dot", () => {
  assert.equal(situationLevelStem(new TextEncoder().encode("chicago.lvl 0 0\r\nrest")), "CHICAGO");
  assert.equal(new RaceRefusal("x is missing").message, "Race not started: x is missing");
});

test("twin props: a doubled shell of higher priority is not drawn; a different or moved one is", async () => {
  const { twinPropsHidden } = await import("../src/worker/twin-props.js");
  // A 20 ft wall of two triangles, textured WALL, facing -z.
  const wall = [{ textureName: "WALL", positions: new Float32Array([0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 0, 0, 20, 20, 0, 0, 20, 0]) }];
  const box = [...wall, { textureName: "WALL", positions: new Float32Array([0, 0, 10, 20, 20, 10, 20, 0, 10]) }];
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const prop = (pos, priority, meshes = box) => ({ meshes, matrix: I, pos, priority });
  assert.deepEqual([...twinPropsHidden([prop([0, 0, 0], 0), prop([0, 0, 0.2], 2)])], [1], "the priority 2 copy 0.2 ft off");
  assert.deepEqual([...twinPropsHidden([prop([0, 0, 0], 0), prop([0, 0, 0], 0)])], [], "equal priority: both drawn");
  assert.deepEqual([...twinPropsHidden([prop([0, 0, 0], 0), prop([0, 0, 3], 2)])], [], "3 ft off: not doubled");
  const other = box.map((m) => ({ ...m, textureName: "GLASS" }));
  assert.deepEqual([...twinPropsHidden([prop([0, 0, 0], 0), prop([0, 0, 0], 1, other)])], [], "another texture");
});

test("tree trunks: height clamped to 6 ft .. the model's, the 24 / 128 nearest", async () => {
  const { trunkOf } = await import("../src/game/vegetation.js");
  const model = { bounds: { min: [-10, 0, -10], max: [10, 40, 10] }, meshes: [{ positions: new Float32Array([-1, 0, -1, 1, 0, 1, 1, 2, -1, 9, 30, 9]) }] };
  assert.equal(trunkOf({ trunkDiameter: 0, trunkHeight: 0 }, model).heightFt, 12, "30 % of 40 ft");
  assert.equal(trunkOf({ trunkDiameter: 0, trunkHeight: 16 }, model).heightFt, 6, "an authored 1 ft is clamped to 6 ft");
  assert.equal(trunkOf({ trunkDiameter: 0, trunkHeight: 0 }, model).widthFt, 0.65 * 2, "65 % of the low vertices' spread");
  const { CP4_TREES_PER_TRUCK, CP4_TREES_AT_ONCE } = await import("../src/worker/sim-worker.js");
  assert.deepEqual([CP4_TREES_PER_TRUCK, CP4_TREES_AT_ONCE], [24, 128]);
});

test("series scoring: the classic table to 16 places, championship 8 and 16; a series preset read and written", async () => {
  const { CLASSIC_PLACE_POINTS_16, seriesPlacePoints, racePoints } = await import("../src/game/race-points.js");
  assert.deepEqual(CLASSIC_PLACE_POINTS_16.slice(8), [80, 70, 60, 50, 40, 30, 20, 10]);
  assert.equal(seriesPlacePoints(1, { scoring: 1 }), 10);
  assert.equal(seriesPlacePoints(8, { scoring: 1 }), 1);
  assert.equal(seriesPlacePoints(5, { scoring: 1, drags16: true }), 12);
  assert.equal(seriesPlacePoints(16, { scoring: 1, drags16: true }), 1);
  assert.equal(racePoints([{ place: 9, best: 0 }], 1)[0], 0, "an ordinary race keeps retail's eight places");
  const { tournamentFromText, tournamentText } = await import("../src/app/tournament.js");
  const tracks = [{ file: "DRAG1.SIT", name: "Drag One", raceType: "drag" }, { file: "TPARK.SIT", name: "Tpark", raceType: "circuit", defaultLaps: 3 }];
  const t = tournamentFromText("MTM2 Series 1.0\r\nNAME=Cup\r\nFORMAT=1\r\nSCORING=1\r\nAISPEED=110\r\nFIELD=15\r\nROUNDS=1\r\nR=DRAG1.SIT,DRAG.POD,1,3\r\n", tracks);
  assert.equal(t.series.format, 1);
  assert.equal(t.series.aiSpeed, 110);
  assert.equal(t.events[0].raceType, "drag");
  assert.match(tournamentText(t), /^MTM2 Series 1\.0\r\n/);
  const { startProblem } = await import("../src/game/events/tournament.js");
  assert.equal(startProblem(t, 16), null, "a drags-only series takes 16");
  assert.match(startProblem(t, 17), /2 to 16/);
});

test("Time Attack: laps recorded at 25 Hz, the best kept as the ghost, split gaps against it", async () => {
  const { createTimeAttack, ghostFromText, ghostText, ghostPoseAt } = await import("../src/game/extensions/time-attack.js");
  const names = { track: "TPARK.SIT", trackName: "Tpark", truck: "RAM.TRK", truckName: "Ram", driver: "Me" };
  const ta = createTimeAttack({ names });
  const pose = (x) => ({ pos: [x, 0, 0], euler: [0, 0, 0], axles: [{ articulation: 0, travel: 0 }, { articulation: 0, travel: 0 }], tires: [], steer: 0, rearSteer: 0 });
  // A first lap of 2 s: checkpoint 1 at 1 s.
  for (let k = 0; k <= 50; k++) {
    const t = k * 0.04;
    ta.frame(t, pose(t * 10), { laps: 0, lapTime: t, checkpoint: t >= 1 ? 1 : 0 });
  }
  const first = ta.frame(2.04, pose(20), { laps: 1, lapTime: 0, lastLap: 2, checkpoint: 0 });
  assert.deepEqual(first, { lap: { time: 2, best: true } });
  assert.equal(ta.ghost.lapTime, 2);
  assert.equal(ta.ghost.samples.length / 29 >= 50, true, "25 samples a second");
  // The second lap reaches checkpoint 1 at 0.8 s: 0.2 s ahead of the ghost.
  let split = null;
  for (let k = 0; k <= 25 && !split; k++) {
    const t = k * 0.04;
    split = ta.frame(2.04 + t, pose(t), { laps: 1, lapTime: t, checkpoint: t >= 0.8 ? 1 : 0 })?.split ?? null;
  }
  assert.ok(Math.abs(split.gap + 0.2) < 0.05);
  const back = ghostFromText(ghostText(ta.ghost));
  assert.equal(back.track, "TPARK.SIT");
  assert.ok(Math.abs(ghostPoseAt(back, 1).pos[0] - 10) < 0.5, "played back where it was");
  assert.equal(ghostPoseAt(back, 5), null, "past the lap's end");
  assert.deepEqual(ta.laps, [2]);
});

test("online: the race end waits for every other human; the 10 s guard is the computer trucks' only", async () => {
  const { WAIT_LIMIT_SECONDS, createRaceEnd } = await import("../src/game/race-end.js");
  const trucks = [{ finished: true, place: 1 }, { finished: false, place: 2 }, { finished: false, place: 3 }];
  const offline = createRaceEnd();
  offline.update({ clock: 10, trucks });
  assert.equal(offline.update({ clock: 10 + WAIT_LIMIT_SECONDS, trucks }).done, true, "offline: run on fast after 10 s");
  const online = createRaceEnd({ humans: [2] });
  online.update({ clock: 10, trucks });
  const waiting = online.update({ clock: 10 + WAIT_LIMIT_SECONDS + 60, trucks });
  assert.equal(waiting.done, false);
  assert.equal(waiting.waitingForHumans, true);
  trucks[2].finished = true;
  assert.equal(online.update({ clock: 80, trucks }).done, true, "the human finished; the computer truck is run on fast");
  const out = createRaceEnd({ humans: [1] });
  const dq = [{ finished: true }, { finished: false, outOfRace: true }];
  out.update({ clock: 0, trucks: dq });
  assert.equal(out.update({ clock: WAIT_LIMIT_SECONDS, trucks: dq }).done, true, "a human out of the race is not waited for");
});

test("online Rumble: places follow the owners' scores; a tie keeps the race's order", async () => {
  const { rankSummitByScore } = await import("../src/game/race-setup.js");
  const rows = [{ score: 40, place: 1 }, { score: 55.4, place: 2 }, { score: 40, place: 3 }];
  rankSummitByScore(rows);
  assert.deepEqual(rows.map((r) => r.place), [2, 1, 3]);
});

test("the course map's lane 2 is palette colour 253, magenta in the stock level palettes", async () => {
  const { LANE2_COLOR } = await import("../src/render/minimap.js");
  assert.equal(LANE2_COLOR, "rgb(255,0,255)");
});

test("Time Attack is a Mode list extension: alone, on a circuit or a rally, on the track's own race, laps until End Race", async () => {
  const { TIME_ATTACK_EXTENSION, TIME_ATTACK_LAPS } = await import("../src/game/extensions/time-attack.js");
  const { availableExtensions, extensionById, lengthLabel, opponentsFor, soloExtension } = await import("../src/game/extensions/loader.js");
  assert.equal(extensionById("time-attack"), TIME_ATTACK_EXTENSION);
  assert.ok(soloExtension(TIME_ATTACK_EXTENSION), "no opponents, no spectator mode, no online rooms");
  assert.deepEqual(opponentsFor(TIME_ATTACK_EXTENSION, ["A.TRK", "B.TRK"]), []);
  assert.ok(TIME_ATTACK_EXTENSION.keepsRace);
  assert.equal(TIME_ATTACK_EXTENSION.length, null);
  assert.equal(TIME_ATTACK_EXTENSION.fixedLaps, TIME_ATTACK_LAPS);
  assert.equal(lengthLabel("circuit", "time-attack"), "Laps");
  for (const [raceType, ok] of [["circuit", true], ["rally", true], ["summit", false], ["drag", false], ["freeroam", false]]) {
    assert.equal(TIME_ATTACK_EXTENSION.acceptsTrack({ raceType }), ok, raceType);
  }
  assert.equal(TIME_ATTACK_EXTENSION.acceptsTrack({ raceType: "circuit", freeRoamOnly: true }), false);
  assert.ok(!availableExtensions([{ raceType: "drag" }]).includes(TIME_ATTACK_EXTENSION));
  assert.ok(availableExtensions([{ raceType: "rally" }]).includes(TIME_ATTACK_EXTENSION));
});
