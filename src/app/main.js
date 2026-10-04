/*
  Boot: check the browser has what the game needs, then open the first screen.
*/
import { Router } from "./router.js";
import { loadSettings } from "./settings.js";
import { WorkerClient } from "../shared/worker-client.js";

const screens = {
  install: () => import("../ui/screens/install.js"),
  start: () => import("../ui/screens/start.js"),
  unsupported: () => import("../ui/screens/unsupported.js"),
  "dev-track": () => import("../ui/screens/dev-track.js"),
};

/** What the game cannot run without. An empty list means the browser is fine. */
export function missingFeatures(env = globalThis) {
  const missing = [];
  if (typeof env.Worker !== "function") missing.push("Web Workers");
  if (typeof env.navigator?.storage?.getDirectory !== "function") {
    missing.push("the Origin Private File System (navigator.storage.getDirectory)");
  }
  if (typeof env.WebGL2RenderingContext !== "function") missing.push("WebGL 2");
  return missing;
}

async function boot() {
  const container = document.getElementById("app");
  const context = { settings: loadSettings() };
  const router = new Router(container, context, screens);
  context.router = router;

  const missing = missingFeatures();
  if (missing.length) {
    await router.go("unsupported", { missing });
    return;
  }
  context.assets = new WorkerClient(new URL("../worker/asset-worker.js", import.meta.url));
  const { installed } = await context.assets.call("installStatus");
  await router.go(installed ? "start" : "install");
}

if (typeof document !== "undefined") {
  boot().catch((err) => {
    console.error(err);
    document.getElementById("app").textContent = `OpenMTM2 failed to start: ${err.message}`;
  });
}
