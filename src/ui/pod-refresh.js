/*
  After the POD manager changes the mounted archives, the menus read again without reloading
  the page. The asset worker already drops its file system and catalogue on every change
  (worker/asset-worker.js), so the next `catalog` call rebuilds them. What stays behind is only
  what the page itself cached: UI pictures, truck builds, bitmap fonts and decoded sounds.
  Those are forgotten here, the wording is read again (it may live in a new archive), and the
  screen underneath shows itself again, which reads the fresh catalogue.

  The Options panel stays open where the manager was opened from it; its wording list names the
  `.LOC` files known when it opened, and catches up the next time it opens.
*/
import { loadStrings } from "../app/strings-store.js";
import { clearFontCache } from "../render/bitmap-text.js";
import { clearUiImageCache } from "./frame.js";
import { clearTruckPreviewCache } from "./truck-preview-cache.js";

/** Read again after the mounted archives changed, with no page reload. */
export async function refreshAfterPodChange(context) {
  clearUiImageCache();
  clearTruckPreviewCache();
  clearFontCache();
  context.menuAudio?.clearSamples?.();
  await loadStrings(context);
  const top = context.router?.stack.at(-1);
  if (top) await context.router.go(top.name, top.params, { replace: true });
}
