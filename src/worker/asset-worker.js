/*
  The asset worker: the install in OPFS, the mounted archives and the content catalogue.
  It also prepares tracks for drawing (track-build.js).

  Protocol (src/shared/worker-client.js): requests `{ id, type, payload }`, replies
  `{ id, ok, payload | error }`, unsolicited events `{ event, payload }`, and `{ ready: true }`
  once this module graph has loaded.
*/
import { copyInstall, mountInstall, readManifest, removeInstall } from "./install-store.js";
import { buildCatalog } from "./catalog.js";
import { buildTrackRender, transferablesOf } from "./track-build.js";
import { loadingScreen } from "./screen-art.js";

/** A reply whose buffers move to the main thread instead of being copied. */
const TRANSFER = Symbol("transfer");
function withTransfer(payload, transfer) {
  return { [TRANSFER]: transfer, payload };
}

let vfs = null;
let catalog = null;

async function mounted() {
  if (!vfs) {
    const manifest = await readManifest();
    if (!manifest) throw new Error("No game install yet.");
    vfs = await mountInstall(manifest);
  }
  return vfs;
}

const handlers = {
  async installStatus() {
    const manifest = await readManifest();
    return { installed: Boolean(manifest), manifest };
  },

  async install(request) {
    vfs = null;
    catalog = null;
    return copyInstall(request, (progress) => self.postMessage({ event: "install-progress", payload: progress }));
  },

  async uninstall() {
    vfs = null;
    catalog = null;
    await removeInstall();
    return true;
  },

  async catalog() {
    if (!catalog) catalog = await buildCatalog(await mounted());
    return catalog;
  },

  /** Everything needed to draw a track; `{ path }` is its SIT, e.g. "WORLD\\TPARK.SIT". */
  async trackRender({ path, detailLevel, raceType, truckFiles }) {
    const build = await buildTrackRender(await mounted(), path, { detailLevel, raceType, truckFiles });
    return withTransfer(build, transferablesOf(build));
  },

  /** The race loading screen, `{ width, height, rgba }` or null. */
  async loadingScreen({ raceType } = {}) {
    const image = await loadingScreen(await mounted(), { raceType });
    return image ? withTransfer(image, [image.rgba.buffer]) : null;
  },
};

self.addEventListener("message", async ({ data }) => {
  const { id, type, payload } = data ?? {};
  const handler = handlers[type];
  try {
    if (!handler) throw new Error(`Unknown request "${type}"`);
    const result = await handler(payload);
    if (result && typeof result === "object" && TRANSFER in result) {
      self.postMessage({ id, ok: true, payload: result.payload }, result[TRANSFER]);
    } else {
      self.postMessage({ id, ok: true, payload: result });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message ?? String(err) });
  }
});

self.postMessage({ ready: true });
