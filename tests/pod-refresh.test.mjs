import test from "node:test";
import assert from "node:assert/strict";
import { createSilentAudio } from "../src/audio/audio-engine.js";
import { clearFontCache } from "../src/render/bitmap-text.js";
import { clearUiImageCache } from "../src/ui/frame.js";
import { refreshAfterPodChange } from "../src/ui/pod-refresh.js";
import { cachedTruckPreview, clearTruckPreviewCache, dropTruckPreview } from "../src/ui/truck-preview-cache.js";

test("the POD caches clear safely when empty", () => {
  assert.doesNotThrow(() => {
    clearUiImageCache();
    clearTruckPreviewCache();
    clearFontCache();
    createSilentAudio().clearSamples();
  });
});

test("truck builds read once, read again after a failure or a POD change", async () => {
  let reads = 0;
  const fetch = async () => `build${++reads}`;
  assert.equal(await cachedTruckPreview("BIGFOOT.TRK|false", fetch), "build1");
  assert.equal(await cachedTruckPreview("BIGFOOT.TRK|false", fetch), "build1");
  assert.equal(reads, 1);
  dropTruckPreview("BIGFOOT.TRK|false");
  assert.equal(await cachedTruckPreview("BIGFOOT.TRK|false", fetch), "build2");
  clearTruckPreviewCache();
  assert.equal(await cachedTruckPreview("BIGFOOT.TRK|false", fetch), "build3");
  assert.equal(reads, 3);
});

test("refreshAfterPodChange forgets cached sounds, reads the wording and shows the screen again", async () => {
  const calls = [];
  const context = {
    settings: { wording: "" },
    menuAudio: { clearSamples() { calls.push("clearSamples"); } },
    router: {
      stack: [{ name: "race-select", params: { mode: "circuit" } }],
      async go(name, params, options) { calls.push(["go", name, params, options]); },
    },
  };
  await refreshAfterPodChange(context);
  assert.deepEqual(calls, [
    "clearSamples",
    ["go", "race-select", { mode: "circuit" }, { replace: true }],
  ]);
  assert.equal(typeof context.t, "function");
});

test("refreshAfterPodChange reads the wording through the worker", async () => {
  const context = {
    settings: { wording: "TEXT\\ENGLISH.LOC" },
    assets: { async call(type, payload) {
      assert.equal(type, "loc");
      assert.deepEqual(payload, { path: "TEXT\\ENGLISH.LOC" });
      return [{ tag: "Races", text: "Races" }];
    } },
    router: { stack: [], async go() { throw new Error("must not show a screen"); } },
  };
  await refreshAfterPodChange(context);
  assert.equal(context.t("Races"), "Races");
});

test("refreshAfterPodChange works with no screen on the stack and no menu audio", async () => {
  await refreshAfterPodChange({ settings: {}, router: { stack: [] } });
  await refreshAfterPodChange({ settings: {} });
});
