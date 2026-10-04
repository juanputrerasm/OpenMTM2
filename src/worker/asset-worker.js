/*
  The asset worker: the install in OPFS, the mounted archives and the content catalogue.
  Later milestones add track and truck preparation here.

  Protocol (src/shared/worker-client.js): requests `{ id, type, payload }`, replies
  `{ id, ok, payload | error }`, unsolicited events `{ event, payload }`, and `{ ready: true }`
  once this module graph has loaded.
*/
import { copyInstall, mountInstall, readManifest, removeInstall } from "./install-store.js";
import { buildCatalog } from "./catalog.js";

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
};

self.addEventListener("message", async ({ data }) => {
  const { id, type, payload } = data ?? {};
  const handler = handlers[type];
  try {
    if (!handler) throw new Error(`Unknown request "${type}"`);
    self.postMessage({ id, ok: true, payload: await handler(payload) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message ?? String(err) });
  }
});

self.postMessage({ ready: true });
