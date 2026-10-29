/*
  Boot: check the browser has what the game needs, then open the first screen.
*/
import { Router } from "./router.js";
import { loadSettings } from "./settings.js";
import { applyGraphics } from "../game/graphics.js";
import { graphicsHardware } from "./graphics-hardware.js";
import { createStrings } from "../game/strings.js";
import { loadStrings } from "./strings-store.js";
import { msg } from "../game/strings.js";
import { startMenuAudio } from "./menu-audio.js";
import { createXr } from "./xr.js";
import { lobbyMenu } from "./vr-lobby.js";
import { createOffline } from "./offline.js";
import { offlineNote } from "../ui/offline-note.js";
import { WorkerClient } from "../shared/worker-client.js";
import { mountWatermark } from "../ui/watermark.js";
import { startGamepadNav } from "../ui/gamepad-nav.js";
import { startInstallTip } from "../ui/display-mode.js";
import { missingRequiredPods } from "../install/required-pods.js";
import { startErrorReporting } from "../ui/error-dialog.js";
import { reportError } from "../shared/error-report.js";

const screens = {
  install: () => import("../ui/screens/install.js"),
  start: () => import("../ui/screens/start.js"),
  "race-select": () => import("../ui/screens/race-select.js"),
  garage: () => import("../ui/screens/garage.js"),
  race: () => import("../ui/screens/race.js"),
  drivers: () => import("../ui/screens/drivers.js"),
  hall: () => import("../ui/screens/hall.js"),
  about: () => import("../ui/screens/about.js"),
  manual: () => import("../ui/screens/manual.js"),
  options: () => import("../ui/screens/options.js"),
  results: () => import("../ui/screens/results.js"),
  "drag-event": () => import("../ui/screens/drag-event.js"),
  "fly-by": () => import("../ui/screens/fly-by.js"),
  "tournament": () => import("../ui/screens/tournament.js"),
  replay: () => import("../ui/screens/replay.js"),
  "net-connect": () => import("../ui/screens/net-connect.js"),
  multiplayer: () => import("../ui/screens/multiplayer.js"),
  rooms: () => import("../ui/screens/rooms.js"),
  unsupported: () => import("../ui/screens/unsupported.js"),
  "dev-track": () => import("../ui/screens/dev-track.js"),
  "dev-drive": () => import("../ui/screens/dev-drive.js"),
};

/** What the game cannot run without. An empty list means the browser is fine. */
export function missingFeatures(env = globalThis) {
  const missing = [];
  if (typeof env.Worker !== "function") missing.push(msg("Web Workers"));
  if (typeof env.navigator?.storage?.getDirectory !== "function") {
    missing.push(msg("the Origin Private File System (navigator.storage.getDirectory)"));
  }
  if (typeof env.WebGL2RenderingContext !== "function") missing.push(msg("WebGL 2"));
  return missing;
}

async function boot() {
  const container = document.getElementById("app");
  const context = { settings: loadSettings(), t: createStrings() };
  // The scenery preset writes its switches for this machine before any screen reads them.
  applyGraphics(context.settings, graphicsHardware());
  const router = new Router(container, context, screens);
  context.router = router;
  // From here on no error is left to the console alone: it is shown with what the game knew (ui/error-dialog.js).
  startErrorReporting(context);
  // A gamepad works every screen, the install screen included (ui/gamepad-nav.js).
  startGamepadNav(context);
  // On a phone's browser tab, once: how to play fullscreen (ui/display-mode.js). The install prompt is caught from here on.
  const showInstallTip = startInstallTip(context);

  // The player's language comes first, so even this page is in it; the install's own wording is laid over it below.
  await loadStrings(context);
  const missing = missingFeatures();
  if (missing.length) {
    await router.go("unsupported", { missing });
    return;
  }
  context.assets = new WorkerClient(new URL("../worker/asset-worker.js", import.meta.url));
  // Two Advanced options every screen's requests follow: the catalogue "Keep MTM1 trucks apart" (worker/catalog.js
  // `mtm1ApartTrucks`), and the skies "CP3 HD weather" (worker/weather-art.js).
  const callAssets = context.assets.call.bind(context.assets);
  const withOptions = (type, payload) => {
    if (type === "catalog") return { mtm1Apart: context.settings.mtm1TrucksApart !== false, ...(payload ?? {}) };
    if (type === "trackRender") return { hdWeather: context.settings.hdWeather !== false, originalBackdrops: !!context.settings.originalBackdrops, ...(payload ?? {}) };
    if (type === "sky") return { hdWeather: context.settings.hdWeather !== false, ...(payload ?? {}) };
    return payload;
  };
  context.assets.call = (type, payload, ...rest) => callAssets(type, withOptions(type, payload), ...rest);
  // The headset, where the browser has one (docs/VR.md). Between races it shows the race setup.
  context.xr = createXr(context);
  context.xr.setLobby(() => lobbyMenu(context));
  const { installed, manifest } = await context.assets.call("installStatus");
  // MONSTER.EXE's version, read when the folder was picked: only the retail builds get the classic menus.
  // An install made before the version was recorded (no `exeVersion` key at all) is taken as the retail build it was made for.
  context.exeVersion = manifest && !("exeVersion" in manifest) ? "2.00.42" : manifest?.exeVersion ?? null;
  mountWatermark(context.assets ?? null, router);
  if (installed) {
    await loadStrings(context);
    // The game's start videos (MSLogo, TRI, Open: EXTRAS.INI [Video] StartScene), when the install has them and Options
    // keeps them on; a key or a click skips one, Escape the rest (game/videos.js, ui/video-player.js).
    if (context.settings.introVideos !== false && !missingRequiredPods(manifest.archives.map((a) => a.name)).length) {
      const { lists, files } = await context.assets.call("videoLists").catch(() => ({ lists: {}, files: [] }));
      const have = new Set(files);
      const intro = (lists.StartScene ?? []).filter((path) => have.has(path));
      if (intro.length) await (await import("../ui/video-player.js")).playVideos(context, intro);
    }
    // Menu and race sounds share one unlocked audio context; the menu music stops during a race.
    startMenuAudio(context);
  }
  // A copy of the app in the browser, so the game starts without its server next time
  // (docs/ARCHITECTURE.md, "Without a server"). It is made in the background.
  context.offline = createOffline(context);
  context.offlineNote = offlineNote(context);
  // An install without the archives OpenMTM2 needs (install/required-pods.js) cannot run: the folder is picked again.
  const requiredMissing = installed ? missingRequiredPods(manifest.archives.map((a) => a.name)) : [];
  // An invite link (`?room=CODE&server=address`, app/net.js `inviteLink`) goes straight to that room.
  const invite = installed && !requiredMissing.length ? takeInvite() : null;
  await router.go(invite ? "rooms" : installed && !requiredMissing.length ? "start" : "install", invite ? { invite } : requiredMissing.length ? { requiredMissing } : {});
  context.offline.start();
  showInstallTip();
}

/** The room invite in the page's address, if any, taken out of it so a reload does not join again. */
function takeInvite() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("room");
  if (!code) return null;
  const server = url.searchParams.get("server") ?? "";
  url.searchParams.delete("room");
  url.searchParams.delete("server");
  window.history.replaceState(null, "", url.href);
  return /^[A-Za-z0-9]{6}$/.test(code) ? { code: code.toUpperCase(), server } : null;
}

if (typeof document !== "undefined") {
  // The page's start watchdog (index.html) stands down once a screen is up, and speaks when the start failed.
  boot().then(() => globalThis.openmtm2Started?.(), (err) => {
    document.getElementById("app").textContent = `OpenMTM2 failed to start: ${err.message}`;
    reportError(err, { where: "starting the game", fatal: true });
    globalThis.openmtm2LoadFailed?.();
  });
}
