/*
  The scenery presets (docs/VISUALS.md, "The switches" and "Cost"): what each tier turns off,
  and which tier a machine is given.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../src/app/settings.js";
import { VISUAL_OPTIONS } from "../src/game/visuals.js";
import { GRAPHICS_FLAGS, GRAPHICS_MANY_POINTS, GRAPHICS_NOTES, GRAPHICS_PRESETS, applyGraphics, detectGraphics, graphicsChoice, graphicsLabel } from "../src/game/graphics.js";

const KEYS = VISUAL_OPTIONS.map((option) => option.key);

test("the presets are Auto, Off, Low, High, Max and Custom, and the default is Off with every part off", () => {
  assert.deepEqual(GRAPHICS_PRESETS.map((preset) => preset.id), ["auto", "off", "low", "high", "max", "custom"]);
  for (const preset of GRAPHICS_PRESETS) {
    assert.ok(preset.label);
    assert.equal(typeof GRAPHICS_NOTES[preset.id], "string");
    if (preset.id !== "custom") assert.ok(GRAPHICS_NOTES[preset.id]);
  }
  assert.equal(graphicsChoice("nope"), "off");
  assert.equal(graphicsChoice("high"), "high");
  assert.equal(graphicsLabel("low"), "Low");
  assert.equal(DEFAULT_SETTINGS.graphics, "off");
  for (const key of KEYS) assert.equal(DEFAULT_SETTINGS[key], false, key);
  assert.equal(GRAPHICS_MANY_POINTS, 5e6);
  assert.ok(2560 * 1440 < GRAPHICS_MANY_POINTS);
  assert.ok(3840 * 2160 > GRAPHICS_MANY_POINTS);
});

test("Low keeps the cheap parts and the rich dust and gives up the smoothed ground, High drops only the lens, Max is everything and Off is nothing", () => {
  for (const key of KEYS) {
    assert.equal(GRAPHICS_FLAGS.off[key], false, key);
    assert.equal(GRAPHICS_FLAGS.max[key], true, key);
  }
  assert.equal(GRAPHICS_FLAGS.high.lensEffects, false);
  for (const key of KEYS) if (key !== "lensEffects") assert.equal(GRAPHICS_FLAGS.high[key], true, key);
  // The smoothed ground is the one cheap-looking part a small chip pays for on every frame (docs/VISUALS.md, "On a small chip").
  for (const key of ["terrainSmoothing", "volumetricWeather", "groundDetail", "naturalLight", "lensEffects"]) {
    assert.equal(GRAPHICS_FLAGS.low[key], false, key);
  }
  for (const key of ["enhancedWater", "rainPuddles", "snowCover", "glossyPaint", "truckLamps", "richParticles"]) {
    assert.equal(GRAPHICS_FLAGS.low[key], true, key);
  }
});

test("a preset writes its switches, Custom keeps a mix, and Auto leaves the choice as Auto", () => {
  const low = { graphics: "low", lensEffects: true, richParticles: false };
  applyGraphics(low, { renderer: "NVIDIA GeForce RTX 4070", pixels: 1920 * 1080 });
  assert.equal(low.graphics, "low");
  assert.equal(low.lensEffects, false);
  assert.equal(low.richParticles, true);
  assert.equal(low.terrainSmoothing, false);

  const custom = { graphics: "custom", lensEffects: false, volumetricWeather: true, terrainSmoothing: false };
  applyGraphics(custom, { renderer: "NVIDIA GeForce RTX 4070", pixels: 1920 * 1080 });
  assert.equal(custom.graphics, "custom");
  assert.equal(custom.lensEffects, false);
  assert.equal(custom.terrainSmoothing, false);
  assert.equal(custom.volumetricWeather, true);

  const auto = { graphics: "auto" };
  applyGraphics(auto, { renderer: "NVIDIA GeForce RTX 4070", pixels: 1920 * 1080 });
  assert.equal(auto.graphics, "auto");
  assert.equal(auto.lensEffects, true);
  assert.equal(auto.groundDetail, true);

  const integrated = { graphics: "auto" };
  applyGraphics(integrated, { renderer: "Intel(R) UHD Graphics 620", pixels: 1920 * 1080 });
  assert.equal(integrated.graphics, "auto");
  assert.equal(integrated.lensEffects, false);
  assert.equal(integrated.volumetricWeather, false);
  assert.equal(integrated.groundDetail, false);
  assert.equal(integrated.naturalLight, false);
  assert.equal(integrated.terrainSmoothing, false);
  assert.equal(integrated.richParticles, true);
  // The frozen defaults are not a place to write a preset.
  assert.equal(DEFAULT_SETTINGS.lensEffects, false);
  assert.equal(DEFAULT_SETTINGS.graphics, "off");
});

test("Auto picks Low, High or Max from the chip and the picture, and never Off", () => {
  const cases = [
    [{}, "high"],
    [{ renderer: "" }, "high"],
    [{ renderer: "", pixels: 8e6 }, "low"],
    [{ renderer: "", pixels: 3.6e6 }, "high"],
    [{ renderer: "Google SwiftShader" }, "low"],
    [{ renderer: "llvmpipe" }, "low"],
    [{ renderer: "Microsoft Basic Render Driver" }, "low"],
    [{ renderer: "Intel(R) UHD Graphics 620" }, "low"],
    [{ renderer: "Intel(R) HD Graphics 4000" }, "low"],
    [{ renderer: "Intel(R) Iris(R) Xe Graphics", pixels: 2e6 }, "high"],
    [{ renderer: "Intel(R) Iris(R) Xe Graphics", pixels: 8e6 }, "low"],
    [{ renderer: "Intel(R) Iris(R) Xe Graphics", pixels: 2e6, deviceMemory: 2 }, "low"],
    [{ renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)", pixels: 1920 * 1080 }, "max"],
    [{ renderer: "NVIDIA GeForce RTX 4070", pixels: 2560 * 1440 }, "max"],
    [{ renderer: "NVIDIA GeForce RTX 4070 Laptop GPU", pixels: 2560 * 1440 }, "max"],
    [{ renderer: "NVIDIA GeForce RTX 4070", pixels: 3840 * 2160 }, "high"],
    [{ renderer: "NVIDIA GeForce RTX 3050", pixels: 1920 * 1080 }, "high"],
    [{ renderer: "NVIDIA GeForce GTX 1080", pixels: 2560 * 1440 }, "max"],
    [{ renderer: "NVIDIA GeForce GTX 1060", pixels: 1920 * 1080 }, "high"],
    [{ renderer: "NVIDIA GeForce GTX 1660", pixels: 1920 * 1080 }, "high"],
    [{ renderer: "NVIDIA GeForce GTX 750", pixels: 1920 * 1080 }, "low"],
    [{ renderer: "NVIDIA GeForce GT 1030", pixels: 1920 * 1080 }, "low"],
    [{ renderer: "AMD Radeon RX 9070 XT (radeonsi, navi48, LLVM 19.1.0, DRM 3.57)", pixels: 2560 * 1440 }, "max"],
    [{ renderer: "AMD Radeon RX 6700 XT", pixels: 2560 * 1440 }, "max"],
    [{ renderer: "AMD Radeon RX 580", pixels: 1920 * 1080 }, "high"],
    [{ renderer: "AMD Radeon RX 6600", pixels: 1920 * 1080 }, "high"],
    [{ renderer: "AMD Radeon Graphics", pixels: 2e6 }, "high"],
    [{ renderer: "AMD Radeon(TM) Graphics", pixels: 2e6 }, "high"],
    [{ renderer: "AMD Radeon Graphics", pixels: 8e6 }, "low"],
    [{ renderer: "Mali-G78" }, "low"],
    [{ renderer: "Adreno (TM) 740" }, "low"],
    [{ renderer: "Apple M1 Pro", pixels: 2e6 }, "max"],
    [{ renderer: "Apple M1 Pro", pixels: 8e6 }, "high"],
    [{ renderer: "Apple M1", pixels: 2e6 }, "high"],
    [{ renderer: "Apple M3", pixels: 2e6 }, "max"],
    [{ renderer: "Apple GPU" }, "low"],
    [{ renderer: "Intel Arc A770", pixels: 2e6 }, "max"],
    [{ renderer: "Intel Arc A380", pixels: 2e6 }, "high"],
    [{ renderer: "NVIDIA GeForce RTX 4070", pixels: 2e6, deviceMemory: 2 }, "max"],
    [{ renderer: "", deviceMemory: 2 }, "low"],
    [{ renderer: "Intel(R) UHD Graphics", deviceMemory: 8 }, "low"],
    [{ renderer: "ANGLE" }, "high"],
  ];
  for (const [hardware, tier] of cases) {
    const got = detectGraphics(hardware);
    assert.equal(got, tier, JSON.stringify(hardware));
    assert.ok(got === "low" || got === "high" || got === "max");
  }
});

test("reading the hardware does not throw where there is no document", async () => {
  const { graphicsHardware } = await import("../src/app/graphics-hardware.js");
  const hardware = graphicsHardware();
  assert.equal(hardware.renderer, "");
  assert.equal(hardware.pixels, null);
  assert.ok(hardware.deviceMemory === null || Number.isFinite(hardware.deviceMemory));
  assert.equal(graphicsHardware().renderer, "");
});

test("boot, the race and the replay apply the preset before the track is built, and Custom is the only page that lists the switches", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const main = read("../src/app/main.js");
  const boot = main.slice(main.indexOf("async function boot"));
  assert.ok(boot.indexOf("loadSettings()") < boot.indexOf("applyGraphics(context.settings, graphicsHardware())"));
  for (const screen of ["../src/ui/screens/race.js", "../src/ui/screens/replay.js"]) {
    const source = read(screen);
    const applyAt = source.indexOf("applyGraphics(context.settings, graphicsHardware())");
    const trackAt = source.indexOf("trackVisuals(context.settings");
    assert.ok(applyAt >= 0 && applyAt < trackAt, screen);
  }
  const panel = read("../src/ui/options-panel.js");
  assert.match(panel, /GRAPHICS_PRESETS\.map\(\(preset\) => el\("option"/);
  assert.match(panel, /choice === "custom"/);
  assert.match(panel, /VISUAL_OPTIONS\.map\(\(option\) => \(option\.amountKey \? slider\([\s\S]*?: toggle\(option\.label, option\.key, option\.hint\)\)\)/);
  assert.match(panel, /"Enhanced graphics"/);
});

test("Picture size: a known share of the screen's points or the whole, on a pixel ratio held to 2", async () => {
  const { RENDER_SCALES, drawnPixelRatio, renderScale } = await import("../src/game/graphics.js");
  assert.equal(DEFAULT_SETTINGS.renderScale, 1);
  for (const scale of RENDER_SCALES) assert.equal(renderScale(scale), scale);
  assert.equal(renderScale(0.3), 1);
  assert.equal(renderScale(undefined), 1);
  assert.equal(renderScale("0.75"), 0.75);
  assert.equal(drawnPixelRatio(1, 1), 1);
  assert.equal(drawnPixelRatio(3, 1), 2);
  assert.equal(drawnPixelRatio(2, 0.5), 1);
  assert.equal(drawnPixelRatio(1, 0.75), 0.75);
  assert.equal(drawnPixelRatio(undefined, 0.5), 0.5);
});
