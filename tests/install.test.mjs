import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePodIni, installPathKey } from "../src/install/pod-ini.js";
import { RETAIL_PODS, readStock, skipWithoutStock } from "./helpers/stock.mjs";

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

test("the stock POD.INI lists the 19 retail archives in retail order; mods may come with them", { skip: skipWithoutStock("POD.INI") }, () => {
  const ini = parsePodIni(new TextDecoder().decode(readStock("POD.INI")));
  // A player's POD.INI may mount HD textures or truck packs too, usually first so they win.
  assert.deepEqual(ini.keys.map((key) => key.toUpperCase()).filter((key) => RETAIL_PODS.includes(key)), RETAIL_PODS);
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
  // The archives OpenMTM2 cannot run without (install/required-pods.js), and nothing else.
  const files = {
    "POD.INI": "6\r\nstartup.pod\r\nui.pod\r\nmusic.pod\r\nsound.pod\r\ncockpit.pod\r\ntruck2.pod\r\n",
    "STARTUP.POD": "x", "UI.POD": "y", "MUSIC.POD": "m", "SOUND.POD": "s", "COCKPIT.POD": "c", "TRUCK2.POD": "t",
  };
  const source = {
    getFile: async (p) => {
      const body = files[installPathKey(p)];
      return body === undefined ? null : { name: p, size: body.length, text: async () => body };
    },
  };
  const result = await inspectSource(source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.files.map((f) => f.name), ["STARTUP.POD", "UI.POD", "MUSIC.POD", "SOUND.POD", "COCKPIT.POD", "TRUCK2.POD"]);
  assert.equal(result.podIni, "6\r\nstartup.pod\r\nui.pod\r\nmusic.pod\r\nsound.pod\r\ncockpit.pod\r\ntruck2.pod\r\n");
  delete files["POD.INI"];
  assert.match((await inspectSource(source)).message, /no POD\.INI/);
});

test("a Community Patch 3 build mounts what POD.INI lists, like the retail game, and its version is read", async () => {
  const { inspectSource } = await import("../src/install/inspect-source.js");
  const utf16 = (str) => Uint8Array.from([...str].flatMap((c) => [c.charCodeAt(0), 0]));
  const exe = { name: "MONSTER.EXE", size: 1, arrayBuffer: async () => Uint8Array.from([...utf16("FileVersion"), 0, 0, 0, 0, ...utf16("2.0.52.0"), 0, 0]).buffer };
  const required = ["STARTUP.POD", "MUSIC.POD", "SOUND.POD", "COCKPIT.POD", "TRUCK2.POD", "UI.POD"];
  const entries = {
    "POD.INI": { text: async () => `6\r\n${required.join("\r\n").toLowerCase()}\r\n` }, "GAME.POD": { name: "GAME.POD", size: 10 }, "MONSTER.EXE": exe,
    ...Object.fromEntries(required.map((name) => [name, { name, size: 10 }])),
  };
  const result = await inspectSource({ getFile: async (p) => entries[p.toUpperCase().replace(/\\/g, "/")] ?? null });
  assert.deepEqual(result.files.map((f) => f.name), required);
  assert.equal(result.exeVersion, "2.00.52");
});
