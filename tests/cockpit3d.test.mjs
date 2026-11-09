import test from "node:test";
import assert from "node:assert/strict";
import { parseCpt } from "../src/vendor/openphotex/mtm/cpt.js";
import { MRGL } from "../src/vendor/openphotex/model/bin.js";
import { writeBin } from "../src/vendor/openphotex/model/bin-write.js";
import {
  DEFAULT_SHIFT_RPM, LOOK_PITCH_MAX, LOOK_YAW_MAX, checkLayout, gearIndex, gearLampLit, layoutVerticalFov, mergeLayout,
  mirrorCorners, mirrorFaces, sceneTurn, mirrorVerticalFov, projectionValue, resolveCockpit, shiftLightLit, shifterDegrees,
  speedoDegrees, stepCockpitLook, COCKPIT_CENTRE_ROW, tachDegrees, trkCockpitName, verticalFovFor, viewDirection, wheelDegrees,
} from "../src/game/cockpit3d.js";
import { buildCockpit3d, resolveTruckCockpit } from "../src/worker/cockpit3d.js";

// The shipped default layout (cockpit.pod DATA\_DEFAULT_CP.CPT, CP4_EXE_ANALYSIS.md 6), as numbers only.
const DEFAULT_TEXT = [
  "VERSION = 1", "CAB = _DEFAULT_CP.BIN", "EYE = 0, 4, 1",
  "SPEEDO = _DEFAULT_CPN1.BIN, -1.206169, 3.198295, 2.728, 0, 0, 1, 304.5, 2.65",
  "TACH = _DEFAULT_CPN2.BIN, 0.830596, 3.284966, 2.728, 0, 0, 1, 153, 0.0261",
  "WHEEL = _DEFAULT_CPW.BIN, 0, 2.937722, 1.85, 0, 0, 1, 7",
  "SHIFTER = _DEFAULT_CPS.BIN, 1.252, 2.595936, 2.542021, 1, 0, 0, -5.42, 5.38, 17.74, 30.26, 42.62, 53.42",
  ...["P", "R", "N", "1", "2", "3"].map((g) => `GEARLAMP_${g} = _DEFAULT_CPL${g}.BIN`),
  "SHIFTLIGHT = _DEFAULT_CPLS.BIN, 6500",
  "MIRROR = 1.023919, 4.46813, 2.75, 0, 0, -1, 1.152038, 0.351097, 65536",
].join("\r\n");
const base = checkLayout(parseCpt(DEFAULT_TEXT));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const bytes = (text) => new TextEncoder().encode(text);

test("a .TRK names its cockpit with its last two non-blank lines, COCKPIT then <name>.CPT, in its last 256 bytes", () => {
  assert.equal(trkCockpitName(bytes("MTM2\r\nTruck\r\nCOCKPIT\r\nMINE_CP.CPT\r\n\r\n")), "MINE_CP.CPT");
  assert.equal(trkCockpitName(bytes("MTM2\r\ncockpit\r\nmine.cpt")), "mine.cpt", "COCKPIT in any case");
  assert.equal(trkCockpitName(bytes("MTM2\r\nCOCKPIT\r\nMINE.CPT\r\nWave File\r\nx.wav")), null, "not the last two lines");
  assert.equal(trkCockpitName(bytes("COCKPIT\r\nA\\B.CPT")), null, "no path");
  assert.equal(trkCockpitName(bytes("COCKPIT\r\n.CPT")), null, "5 to 31 characters");
  assert.equal(trkCockpitName(bytes("COCKPIT\r\nMINE.CPT\r\n   \r\n")), "MINE.CPT", "blank lines after them are not lines");
  assert.equal(trkCockpitName(bytes(`COCKPIT\r\nMINE.CPT${" ".repeat(300)}`)), null, "trailing blanks still fill the 256 bytes");
  // Only the last 256 bytes: a COCKPIT line further up is not seen.
  assert.equal(trkCockpitName(bytes(`COCKPIT\r\n${"\r\n".repeat(130)}MINE.CPT`)), null);
  assert.equal(trkCockpitName(null), null);
});

test("the layout's checks: VERSION 1, EYE within 32 ft, FOV 30..150 truncated, the mirror's zoom 0 is 65536", () => {
  assert.equal(checkLayout(parseCpt("CAB = A.BIN")), null, "no VERSION line");
  assert.equal(checkLayout(parseCpt("VERSION = 2\nCAB = A.BIN")), null, "unsupported VERSION");
  assert.equal(base.cab, "_DEFAULT_CP.BIN");
  assert.deepEqual(base.eye, [0, 4, 1]);
  assert.equal(base.fov, null);
  assert.equal(base.mirror.zoom, 65536);
  assert.equal(base.shiftLight.rpm, 6500);
  const odd = checkLayout(parseCpt("VERSION=1\nEYE = 0, 40, 1\nFOV = 90.9\nCAB = NOEXT\nMIRROR = 0,4,2, 0,0,-1, 1, 0.5, 0\nSHIFTLIGHT = A.BIN"));
  assert.equal(odd.eye, null, "an EYE past 32 ft is the default's");
  assert.equal(odd.fov, 90);
  assert.equal(odd.cab, null, "a model name ends in .BIN");
  assert.equal(odd.mirror.zoom, 65536);
  assert.equal(odd.shiftLight.rpm, DEFAULT_SHIFT_RPM);
  assert.equal(checkLayout(parseCpt("VERSION=1\nFOV = 160")).fov, null);
  assert.equal(checkLayout(parseCpt("VERSION=1\nMIRROR = 0,4,2, 0,0,0, 1, 0.5")).mirror, null, "a mirror needs a normal");
  assert.equal(checkLayout(parseCpt("VERSION=1\nMIRROR = 0,4,2, 0,0,-1, 1, 0.5, 300000")).mirror, null, "zoom at most 0x40000");
  const quad = checkLayout(parseCpt("VERSION=1\nGEARLAMP_N = 1, 2.9, 2.4, 0.1, 0.05\nSHIFTLIGHT = 0.5, 3.5, 2.7, 0.1, 0.1, 7000"));
  assert.deepEqual(quad.gearLamps[2], { model: null, quad: { center: [1, 2.9, 2.4], w: 0.1, h: 0.05 } });
  assert.equal(quad.shiftLight.rpm, 7000);
  assert.equal(checkLayout(parseCpt("VERSION=1\nGEARLAMP_N = 1, 2.9, 2.4, 0, 0.05")).gearLamps[2], null, "0 < w");
});

test("which cockpit a truck gets: named found, named missing, powerbig or richford, else 2D; no default cab, 2D for all", () => {
  const all = () => true;
  assert.equal(resolveCockpit({ base: null, cluster: "powerbig" }).kind, "2d");
  assert.equal(resolveCockpit({ base, cluster: "powerbig", hasModel: (n) => n !== "_DEFAULT_CP.BIN" }).kind, "2d", "the default's CAB missing");
  assert.equal(resolveCockpit({ base: { ...base, cab: null }, named: "X.CPT", custom: base }).kind, "2d");
  assert.deepEqual(resolveCockpit({ base, cluster: "POWERBIG", hasModel: all }), { kind: "3d", layout: base, reason: "default cockpit" });
  assert.equal(resolveCockpit({ base, cluster: "richford", hasModel: all }).kind, "3d");
  assert.equal(resolveCockpit({ base, cluster: "dodgeram", hasModel: all }).kind, "2d", "another cluster keeps the 2D cockpit");
  const missing = resolveCockpit({ base, named: "MINE.CPT", custom: null, cluster: "dodgeram", hasModel: all });
  assert.equal(missing.kind, "3d");
  assert.equal(missing.layout, base, "named but missing: the default");
  const custom = checkLayout(parseCpt("VERSION=1\nCAB = MINE.BIN\nEYE = 0, 5, 0.5\nWHEEL = MINE_W.BIN, 0, 3, 2, 0, 0, 1, 5\nTACH = GONE.BIN, 0, 3, 2, 0, 0, 1, 100, 0.03"));
  const found = resolveCockpit({ base, named: "MINE.CPT", custom, hasModel: (n) => n !== "GONE.BIN" });
  assert.equal(found.kind, "3d");
  assert.equal(found.layout.cab, "MINE.BIN");
  assert.deepEqual(found.layout.eye, [0, 5, 0.5]);
  assert.equal(found.layout.wheel.model, "MINE_W.BIN");
  assert.deepEqual(found.layout.tach, base.tach, "a missing instrument model takes the default's whole instrument");
  assert.deepEqual(found.layout.speedo, base.speedo, "keys it does not have are the default's");
  assert.equal(mergeLayout(base, custom, (n) => n !== "MINE.BIN").cab, "_DEFAULT_CP.BIN", "a missing custom CAB is the default cab");
});

test("the instruments: needles a0 + k x reading, the wheel steer x 57.2958 x ratio, the shifter's angle per gear", () => {
  close(speedoDegrees(base.speedo, 0), 304.5);
  // 20 mph straight up, as the shipped dial prints it: 304.5 + 53 = 357.5.
  close(speedoDegrees(base.speedo, 20 * 5280 / 3600), 357.5);
  // The speed's size: backing up reads as going forward.
  close(speedoDegrees(base.speedo, -20 * 5280 / 3600), 357.5);
  // fmod 360.
  close(speedoDegrees(base.speedo, 40 * 5280 / 3600), (304.5 + 106) % 360);
  close(tachDegrees(base.tach, 1000), 179.1);
  close(wheelDegrees(base.wheel, 0.1), 0.1 * 57.2958 * 7);
  close(wheelDegrees(base.wheel, -0.1), -0.1 * 57.2958 * 7);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((g) => shifterDegrees(base.shifter, g)), [-5.42, 5.38, 17.74, 30.26, 42.62, 53.42]);
  assert.equal(gearIndex(0), 0);
  assert.equal(gearIndex(9), 5, "a higher gear holds the third's place");
  assert.equal(gearLampLit(3, 4), true);
  assert.equal(gearLampLit(2, 4), false, "only the current gear's lamp");
  assert.equal(shiftLightLit(base.shiftLight, 6500), false, "above the rpm, not at it");
  assert.equal(shiftLightLit(base.shiftLight, 6501), true);
});

// Rodrigues' rotation, right-handed, as three.js turns about an axis.
const rotate = (v, { axis: k, radians: t }) => {
  const c = Math.cos(t), s = Math.sin(t), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => v[i] * c + x[i] * s + k[i] * d * (1 - c));
};

test("a part's angle in the scene: clockwise as the driver sees it about +z, a lever's top back about +x", () => {
  // The needle's tip along +y; 90 degrees about +z points it right (scene +x), as the dial art reads clockwise.
  const tip = rotate([0, 1, 0], sceneTurn([0, 0, 1], 90));
  close(tip[0], 1); close(tip[1], 0);
  // The shifter's top about +x: a positive angle moves it back, toward the driver (scene +z is the truck's back).
  const top = rotate([0, 1, 0], sceneTurn([1, 0, 0], 30));
  assert.ok(top[2] > 0);
  // A positive steer turns the wheel's top to the right.
  assert.ok(rotate([0, 1, 0], sceneTurn(base.wheel.axis, wheelDegrees(base.wheel, 0.05)))[0] > 0);
});

test("FOV 106.26 is the projection value 65536: degrees across a 4:3 frame, 90 degrees top to bottom; the mirror's zoom is across its width", () => {
  assert.equal(projectionValue(106.26), 65536);
  close(verticalFovFor(65536), 90);
  close(layoutVerticalFov(base), 90);
  close(layoutVerticalFov({ ...base, fov: 90 }), 2 * Math.atan(0.75) * 180 / Math.PI); // 90 across 4:3 is 73.74 high
  close(mirrorVerticalFov(65536, 2), 2 * Math.atan(0.5) * 180 / Math.PI);
});

test("the mirror: its corners about C, drawn when the eye is before it and the view within 60 degrees of it", () => {
  const corners = mirrorCorners(base.mirror);
  const [c, n] = [base.mirror.center, base.mirror.normal];
  // n = (0, 0, -1): u = (nz, 0, -nx) = (-1, 0, 0), v = n x u = (0, 1, 0).
  close(corners[0][0], c[0] + base.mirror.w / 2);
  close(corners[0][1], c[1] + base.mirror.h / 2);
  for (const k of corners) close(k[2], c[2]);
  assert.ok(n);
  assert.equal(mirrorFaces(base.mirror, [0, 4, 1], viewDirection(0, 0)), true);
  assert.equal(mirrorFaces(base.mirror, [0, 4, 1], viewDirection(Math.PI, 0)), false, "looking back");
  assert.equal(mirrorFaces(base.mirror, [0, 4, 1], viewDirection(-Math.PI / 2, 0)), false, "looking left, past 60 degrees");
  assert.equal(mirrorFaces(base.mirror, [0, 4, 3], viewDirection(0, 0)), false, "the eye behind the glass");
});

test("smooth cockpit look: 180 degrees a second with a full stick, dt capped at 0.25 s, held to 150 and 35, eased back", () => {
  let look = stepCockpitLook({ yaw: 0, pitch: 0 }, { x: 1, y: 0 }, 0.1);
  close(look.yaw, Math.PI * 0.1);
  look = stepCockpitLook({ yaw: 0, pitch: 0 }, { x: 0.5, y: 1 }, 1);
  close(look.yaw, Math.PI * 0.5 * 0.25, 1e-9);
  close(look.pitch, LOOK_PITCH_MAX, 1e-9);
  look = stepCockpitLook({ yaw: 2.6, pitch: 0.6 }, { x: 1, y: 1 }, 0.25);
  close(look.yaw, LOOK_YAW_MAX);
  close(look.pitch, LOOK_PITCH_MAX);
  close(LOOK_YAW_MAX * 180 / Math.PI, 150, 0.01);
  close(LOOK_PITCH_MAX * 180 / Math.PI, 35, 0.01);
  look = stepCockpitLook({ yaw: 1, pitch: -0.5 }, { x: 0, y: 0 }, 0.045);
  close(look.yaw, Math.exp(-1));
  close(look.pitch, -0.5 * Math.exp(-1));
  assert.deepEqual(stepCockpitLook({ yaw: 0.006, pitch: 0 }, null, 0.01), { yaw: 0, pitch: 0 }, "under 64 units snaps to 0");
});

// A one-triangle model, enough for the rules to find a model there.
const tinyBin = () => writeBin({ vertices: [0, 0, 0, 512, 0, 0, 0, 512, 0], groups: [{ opcode: MRGL.FACET, texture: "", faces: [{ vertexIndices: [0, 1, 2] }] }] }).bytes;
const vfsOf = (files) => ({ find: () => null, read: async (path) => files[path] ?? null });
const trk = (cluster, tail = "") => bytes(`MTM2\r\nTest\r\ntruckModelBaseName\r\ntest\r\nInstrument Cluster\r\n${cluster}\r\n${tail}`);

test("the worker resolves a truck's cockpit from the files: the default's models, a named one, and 2D without them", async () => {
  const models = Object.fromEntries(["_DEFAULT_CP", "_DEFAULT_CPN1", "_DEFAULT_CPN2", "_DEFAULT_CPW", "_DEFAULT_CPS", "MINE"].map((n) => [`MODELS\\${n}.BIN`, tinyBin()]));
  const files = {
    "DATA\\_DEFAULT_CP.CPT": bytes(DEFAULT_TEXT), "DATA\\MINE.CPT": bytes("VERSION = 1\r\nCAB = MINE.BIN\r\n"), ...models,
    "TRUCK\\BIG.TRK": trk("powerbig"), "TRUCK\\RAM.TRK": trk("dodgeram"), "TRUCK\\OWN.TRK": trk("dodgeram", "COCKPIT\r\nMINE.CPT\r\n"),
  };
  const vfs = vfsOf(files);
  assert.equal((await resolveTruckCockpit(vfs, "BIG.TRK")).kind, "3d");
  assert.equal((await resolveTruckCockpit(vfs, "RAM.TRK")).kind, "2d");
  const own = await buildCockpit3d(vfs, "own.trk", null);
  assert.equal(own.layout.cab, "MINE.BIN");
  assert.equal(own.layout.speedo.model, "_DEFAULT_CPN1.BIN");
  assert.ok(own.models["MINE.BIN"] && !own.models["_DEFAULT_CP.BIN"], "only the models the layout draws");
  assert.equal(own.layout.gearLamps[0].model, "_DEFAULT_CPLP.BIN", "a lamp the install lacks stays named, and is not drawn");
  assert.equal(await buildCockpit3d(vfs, "CPR:CAR.CAR", null), null, "another game's vehicle keeps the 2D cockpit");
  assert.equal(await buildCockpit3d(vfsOf({ ...files, "MODELS\\_DEFAULT_CP.BIN": undefined }), "BIG.TRK", null), null, "no default cab: 2D");
});

test("the 3D cockpit's view centre sits at 208 / 480 of the screen's height, as CP4 sets it (FUN_1401fd850)", () => {
  assert.equal(COCKPIT_CENTRE_ROW, 208 / 480);
});
