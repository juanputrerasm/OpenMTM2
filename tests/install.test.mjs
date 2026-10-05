import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePodIni, installPathKey } from "../src/install/pod-ini.js";
import { inspectExe, classifyExe, RETAIL_2_00_42 } from "../src/install/validate-exe.js";
import { readStock, skipWithoutStock } from "./helpers/stock.mjs";

test("parsePodIni reads the count and names, in order, any whitespace", () => {
  const ini = parsePodIni("3\r\nstartup.pod\r\nmusic.pod\r\nsystem\\ui.pod\r\n");
  assert.equal(ini.declared, 3);
  assert.deepEqual(ini.paths, ["startup.pod", "music.pod", "system/ui.pod"]);
  assert.deepEqual(ini.keys, ["STARTUP.POD", "MUSIC.POD", "SYSTEM/UI.POD"]);
  assert.deepEqual(ini.warnings, []);
});

test("parsePodIni reports short lists, extra names and duplicates", () => {
  assert.match(parsePodIni("4 a.pod b.pod").warnings[0], /declares 4 archives but lists 2/);
  assert.match(parsePodIni("1 a.pod b.pod").warnings[0], /1 entries beyond its count/);
  const dup = parsePodIni("2 a.pod A.POD");
  assert.deepEqual(dup.keys, ["A.POD"]);
  assert.match(dup.warnings[0], /twice/);
  assert.match(parsePodIni("startup.pod").warnings[0], /count/);
  assert.deepEqual(parsePodIni("1\r\na.pod\r\n\x1a").warnings, []);
});

test("installPathKey compares paths without case or slash style", () => {
  assert.equal(installPathKey("\\System\\Startup.pod"), "SYSTEM/STARTUP.POD");
});

/** A minimal PE header, with an optional VS_FIXEDFILEINFO further in. */
function syntheticExe({ size = 4096, machine = 0x014c, stamp = 0, version = null } = {}) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x4d; bytes[1] = 0x5a;
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x80, 0x00004550, true);
  view.setUint16(0x84, machine, true);
  view.setUint32(0x88, stamp, true);
  if (version) {
    const at = 0x400;
    bytes.set([0xbd, 0x04, 0xef, 0xfe], at);
    view.setUint32(at + 4, 0x00010000, true);
    view.setUint32(at + 8, (version[0] << 16) | version[1], true);
    view.setUint32(at + 12, (version[2] << 16) | version[3], true);
  }
  return bytes;
}

test("inspectExe reads machine, timestamp and fixed file version", () => {
  const info = inspectExe(syntheticExe({ stamp: 123, version: [2, 0, 42, 0] }));
  assert.equal(info.isPe, true);
  assert.equal(info.machine, 0x014c);
  assert.equal(info.timeDateStamp, 123);
  assert.equal(info.fileVersion, "2.0.42.0");
  assert.equal(inspectExe(new Uint8Array(100)).isPe, false);
});

test("classifyExe accepts retail 2.00.42 and turns away 64-bit and unknown builds", () => {
  const retail = { isPe: true, machine: 0x014c, size: RETAIL_2_00_42.size, timeDateStamp: RETAIL_2_00_42.timeDateStamp };
  assert.equal(classifyExe(retail).build, "retail-2.00.42");
  assert.equal(classifyExe(retail).supported, true);
  assert.equal(classifyExe({ ...retail, machine: 0x8664 }).build, "community-patch");
  assert.equal(classifyExe({ ...retail, machine: 0x8664 }).supported, false);
  assert.equal(classifyExe({ ...retail, size: 1 }).supported, false);
  assert.equal(classifyExe({ isPe: false }).supported, false);
});

test("the stock MONSTER.EXE is retail 2.00.42", { skip: skipWithoutStock() }, () => {
  const info = inspectExe(readStock("MONSTER.EXE"));
  assert.equal(info.fileVersion, "2.0.42.0");
  assert.equal(classifyExe(info).build, "retail-2.00.42");
});

test("the stock POD.INI lists 19 archives", { skip: skipWithoutStock("POD.INI") }, () => {
  const ini = parsePodIni(new TextDecoder().decode(readStock("POD.INI")));
  assert.equal(ini.keys.length, 19);
  assert.equal(ini.keys[0], "STARTUP.POD");
  assert.deepEqual(ini.warnings, []);
});

test("findArchive falls back to the file name in the folder, then in SYSTEM", async () => {
  const { findArchive } = await import("../src/install/inspect-source.js");
  const files = { "STARTUP.POD": 1, "SYSTEM/TRUCK.POD": 2 };
  const source = { getFile: async (p) => (files[installPathKey(p)] ? { name: p } : null) };
  assert.equal((await findArchive(source, "C:\\Games\\MTM2\\startup.pod")).path, "startup.pod");
  assert.equal((await findArchive(source, "truck.pod")).path, "SYSTEM/truck.pod");
  assert.equal(await findArchive(source, "x.pod"), null);
});
