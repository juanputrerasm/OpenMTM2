/*
  A truck preview on a canvas that can be pointed at one truck after another (Winner's Circle, Hall of Fame).
  The truck's models come from the asset worker once per truck; a screen that has no WebGL goes without.
*/
import { createTruckPreview } from "../render/truck-preview.js";

const builds = new Map();

/**
 * @param {object} context the app context
 * @param {{ width: number, height: number, mode: "orbit"|"still"|"crown" }} options canvas pixels and the preview's kind
 * @returns {{ canvas: HTMLCanvasElement|null, show(file: string|null): Promise<void>, dispose(): void }}
 */
export function createPreviewSlot(context, { width, height, mode }) {
  const look = context.settings.look === "enhanced" ? "enhanced" : "classic";
  let preview = null, request = 0;
  try { preview = createTruckPreview({ width, height, look, mode }); } catch { /* no WebGL: no preview */ }
  return {
    canvas: preview?.canvas ?? null,
    async show(file) {
      if (!preview) return;
      const mine = ++request;
      if (!file) { preview.show(null); return; }
      const key = `${file}|${mode === "crown"}`;
      try {
        if (!builds.has(key)) builds.set(key, context.assets.call("truckPreview", { file, winner: mode === "crown" }));
        const build = await builds.get(key);
        if (mine === request) preview.show(build);
      } catch { builds.delete(key); }
    },
    dispose() { request++; preview?.dispose(); },
  };
}
