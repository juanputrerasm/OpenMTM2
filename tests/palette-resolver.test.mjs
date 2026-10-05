import test from "node:test";
import assert from "node:assert/strict";
import { decodeActPalette, decodeRawTexture, parsePod, readPodEntry, writePod1 } from "../src/vendor/openphotex/index.js";
import { createPaletteResolver } from "../src/worker/palette-resolver.js";
import { createVfs } from "../src/worker/vfs.js";
import { loadLevel, loadTextureSource } from "../src/worker/level-load.js";
import { buildTrackRender } from "../src/worker/track-build.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

function mount(name, entries) {
  const bytes = writePod1(name, entries);
  const archive = parsePod(bytes);
  return { name, archive, readEntry: async (entry) => readPodEntry(bytes, entry) };
}

function palette(seed) {
  return Uint8Array.from({ length: 768 }, (_, i) => (i + seed) & 255);
}

test("MTM2 model and shared terrain art prefer mounted METALCR2 over the level palette", async () => {
  const raw = new Uint8Array(64 * 64);
  const metal = palette(17), track = palette(63);
  const vfs = createVfs([
    mount("TRACK.POD", [{ name: "ART\\SHARED.RAW", data: raw }]),
    mount("STARTUP.POD", [{ name: "ART\\METALCR2.ACT", data: metal }]),
  ]);
  const resolver = createPaletteResolver(vfs, "MTM2", decodeActPalette(track));
  for (const kind of ["model", "terrain"]) {
    const source = await loadTextureSource(vfs, "SHARED.RAW", resolver, kind);
    assert.deepEqual(source.palette, decodeActPalette(metal));
    assert.equal(source.paletteSource, "archive:ART\\METALCR2.ACT");
  }
});

test("a companion ACT still outranks METALCR2", async () => {
  const own = palette(91), metal = palette(17);
  const vfs = createVfs([mount("TRACK.POD", [
    { name: "ART\\OWN.RAW", data: new Uint8Array(64 * 64) },
    { name: "ART\\OWN.ACT", data: own },
    { name: "ART\\METALCR2.ACT", data: metal },
  ])]);
  const source = await loadTextureSource(vfs, "OWN.RAW", createPaletteResolver(vfs, "MTM2", palette(1)), "model");
  assert.deepEqual(source.palette, decodeActPalette(own));
  assert.equal(source.paletteSource, "same-stem:ART\\OWN.ACT");
});

test("Crazy '98 REX art without companion ACT resolves through STARTUP's METALCR2", { skip: skipWithoutStock("POD.INI") }, async () => {
  const vfs = stockVfs();
  const level = await loadLevel(vfs, "WORLD\\CRAZY98.SIT");
  const resolver = createPaletteResolver(vfs, "MTM2", level.palette);
  const source = await loadTextureSource(vfs, "SAURHULL.RAW", resolver, "model");
  const metal = decodeActPalette(await vfs.read("ART\\METALCR2.ACT"));
  assert.equal(vfs.find("ART\\SAURHULL.ACT"), null);
  assert.deepEqual(source.palette, metal);
  assert.equal(source.paletteSource, "archive:ART\\METALCR2.ACT");
  assert.notDeepEqual(source.palette, level.palette);

  const build = await buildTrackRender(vfs, "WORLD\\CRAZY98.SIT");
  const cutout = build.models["REX.BIN"].meshes.some((mesh) => mesh.textureName === "SAURHULL.RAW" && mesh.cutout);
  const expected = decodeRawTexture(source.raw, metal, { cutout });
  assert.deepEqual(build.modelTextures["SAURHULL.RAW"].rgba, expected.rgba);
});
