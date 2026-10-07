import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePodIni, installPathKey } from "../src/install/pod-ini.js";
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

test("inspectSource needs only POD.INI and its archives, not MONSTER.EXE", async () => {
  const { inspectSource } = await import("../src/install/inspect-source.js");
  const files = { "POD.INI": "2\r\nstartup.pod\r\nui.pod\r\n", "STARTUP.POD": "x", "UI.POD": "y" };
  const source = {
    getFile: async (p) => {
      const body = files[installPathKey(p)];
      return body === undefined ? null : { name: p, size: body.length, text: async () => body };
    },
  };
  const result = await inspectSource(source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.map((f) => f.name), ["STARTUP.POD", "UI.POD"]);
  assert.equal(result.podIni, "2\r\nstartup.pod\r\nui.pod\r\n");
  delete files["POD.INI"];
  assert.match((await inspectSource(source)).message, /no POD\.INI/);
});
