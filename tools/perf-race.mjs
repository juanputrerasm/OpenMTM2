#!/usr/bin/env node
/*
  Measures a race's frame cost in a real Chrome, over the DevTools protocol. No dependencies.

      node tools/perf-race.mjs --game ~/games/mtm2 --track TPARK
      node tools/perf-race.mjs --game ~/games/mtm2 --add-pod ~/tracks/BEAVER.POD --track BVC1 --profile
      node tools/perf-race.mjs --url http://localhost:8080/ --track TPARK --settings '{"graphics":"low"}' --throttle 4

  What it does: serves the app and the game folder (tools/serve.mjs, unless --url names a server that
  is already up), opens Chrome with a profile of its own, installs the game from the server, starts a
  race on the track with seven computer trucks, puts the player's truck under the full autopilot and
  measures windows of driving. The autopilot's line repeats, so two versions of the code can be
  compared window by window; single runs still vary by several frames a second.

  What a window reports:
    fps, frame ms (mean, p50, p90, p99)   frames that were drawn, timed between their ends
    jsRenderMs                            main thread time inside the renderer, all passes
    shadowMs, shadowCalls                 the sun shadow pass's share
    gpuMs                                 the GPU's time for the frame (EXT_disjoint_timer_query_webgl2)
    drawCalls, triangles                  per frame, all passes (renderer.info)
    trucksNear                            trucks within 400 ft of the camera
    counter                               the game's own FPS counter text, with the simulation's line

  --shots saves a picture of the page after each window, to see that what was measured is what should be drawn.

  --profile adds a sampled CPU profile of the main thread and of each worker (the simulation runs in
  one), printed as the heaviest functions by self time and saved as .cpuprofile files for DevTools.

  --throttle N slows the page's main thread N times (Chrome's CPU throttling), a stand-in for a
  slower processor. It does not slow the GPU, and workers are throttled only where Chrome allows.

  The game's vsync setting is turned off for the run unless --settings says otherwise, so a 60 Hz
  panel does not cap the numbers. --settings takes a JSON object of the app's settings; "graphics"
  is applied as a preset first (off, low, high, max), the other keys then override single switches.

  --add-pod puts extra archives beside the game without touching the install: a folder of links to
  the game's files is made in the temporary directory, with the archives added to its POD.INI.

  Nothing here is a test: it needs a game, a display and Chrome, and its numbers belong to the
  machine it ran on.
*/
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `Usage: node tools/perf-race.mjs --track <name> [--game <MTM2 folder>] [options]

  --track <regex>      the track file to race, matched without regard to case (TPARK, BVC1)
  --game <folder>      the MTM2 folder to serve and install from (starts tools/serve.mjs)
  --add-pod <file>     an extra archive to mount with the game; may be given more than once
  --url <address>      use a server that is already running instead of starting one
  --port <n>           the port of the server this starts (8097)
  --seconds <n>        the length of one measured window (8)
  --windows <n>        how many windows to measure while driving (3)
  --settle <n>         seconds of driving before the first window (20)
  --settings <json>    app settings for the run, for example '{"graphics":"max","aa":"off"}'
  --mode <name>        a game mode (an extension's name, for example deathmatch)
  --throttle <n>       slow the main thread n times
  --profile            sample the CPU on the main thread and the workers
  --shots              save a picture of the page after each window
  --out <folder>       where the report and the profiles are written (perf-out, git-ignored if you add it)
  --window <w,h>       Chrome's window size (1920,1080)
  --dpr <n>            force the device pixel ratio
  --chrome <path>      the Chrome to run
  --keep               leave Chrome open at the end
`;

function parseArgs(argv) {
  const o = { track: null, game: null, pods: [], url: null, port: 8097, seconds: 8, windows: 3, settle: 20, settings: {}, mode: null, throttle: 1, profile: false, shots: false, out: "perf-out", window: "1920,1080", dpr: null, chrome: null, keep: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
      return argv[++i];
    };
    if (arg === "--track") o.track = value();
    else if (arg === "--game") o.game = resolve(value());
    else if (arg === "--add-pod") o.pods.push(resolve(value()));
    else if (arg === "--url") o.url = value();
    else if (arg === "--port") o.port = Number(value());
    else if (arg === "--seconds") o.seconds = Number(value());
    else if (arg === "--windows") o.windows = Number(value());
    else if (arg === "--settle") o.settle = Number(value());
    else if (arg === "--settings") o.settings = JSON.parse(value());
    else if (arg === "--mode") o.mode = value();
    else if (arg === "--throttle") o.throttle = Number(value());
    else if (arg === "--profile") o.profile = true;
    else if (arg === "--shots") o.shots = true;
    else if (arg === "--out") o.out = value();
    else if (arg === "--window") o.window = value();
    else if (arg === "--dpr") o.dpr = value();
    else if (arg === "--chrome") o.chrome = value();
    else if (arg === "--keep") o.keep = true;
    else if (arg === "--help" || arg === "-h") o.help = true;
    else throw new Error(`Unknown argument ${arg}.`);
  }
  return o;
}

function findChrome(given) {
  const places = [
    given, process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const found = places.find((place) => place && existsSync(place));
  if (!found) throw new Error("No Chrome found: give --chrome <path>.");
  return found;
}

/** A folder of links to the game's files with `pods` added to its POD.INI; the install itself is left alone. */
function overlayGame(game, pods) {
  const names = readdirSync(game);
  const iniName = names.find((name) => name.toLowerCase() === "pod.ini");
  if (!iniName) throw new Error(`${game} has no POD.INI in its top folder; --add-pod needs one there.`);
  const overlay = mkdtempSync(join(os.tmpdir(), "openmtm2-perf-game-"));
  for (const name of names) if (name !== iniName) symlinkSync(join(game, name), join(overlay, name));
  const mounted = readFileSync(join(game, iniName), "latin1").split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean);
  for (const pod of pods) {
    if (!existsSync(pod)) throw new Error(`No such archive: ${pod}`);
    const name = basename(pod);
    if (!names.some((have) => have.toLowerCase() === name.toLowerCase())) symlinkSync(pod, join(overlay, name));
    if (!mounted.some((have) => have.toLowerCase() === name.toLowerCase())) mounted.push(name);
  }
  writeFileSync(join(overlay, "POD.INI"), [String(mounted.length), ...mounted, ""].join("\r\n"), "latin1");
  return overlay;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

/** The measurement that runs in the page: one window of drawn frames. */
const MEASURE = `window.__perfWindow = (seconds) => new Promise((resolve) => {
  const R = window.__openmtm2Race, renderer = R.renderer, gl = renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  renderer.info.autoReset = false;
  const origRender = renderer.render.bind(renderer), origShadow = renderer.shadowMap.render.bind(renderer.shadowMap);
  const channel = new MessageChannel();
  let open = false, lastDrawn = null, renderMs = 0, shadowMs = 0, shadowCalls = 0, query = null;
  const frames = [], calls = [], tris = [], render = [], shadow = [], shadowDraws = [], near = [], gpu = [], waiting = [];
  const t0 = performance.now();
  const trucksNear = () => {
    const latest = R.latest;
    if (!latest || !latest.poses) return 0;
    const c = R.camera.position;
    let n = 0;
    for (const pose of latest.poses) { const p = pose.current.pos; if (Math.hypot(p[0] - c.x, p[2] + c.z) < 400) n++; }
    return n;
  };
  // A frame ends with the task that drew it: the message posted at its first render call arrives after the task.
  channel.port1.onmessage = () => {
    const now = performance.now();
    if (lastDrawn !== null) frames.push(now - lastDrawn);
    lastDrawn = now;
    if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); waiting.push(query); query = null; }
    calls.push(renderer.info.render.calls); tris.push(renderer.info.render.triangles);
    render.push(renderMs); shadow.push(shadowMs); shadowDraws.push(shadowCalls); near.push(trucksNear());
    renderer.info.reset(); renderMs = shadowMs = shadowCalls = 0; open = false;
  };
  let depth = 0;
  renderer.render = (...args) => {
    if (!open) {
      open = true; channel.port2.postMessage(0);
      if (ext && waiting.length < 8) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    }
    const t = performance.now();
    depth++;
    try { return origRender(...args); } finally { if (--depth === 0) renderMs += performance.now() - t; }
  };
  renderer.shadowMap.render = (...args) => {
    const before = renderer.info.render.calls, t = performance.now();
    const result = origShadow(...args);
    shadowMs += performance.now() - t; shadowCalls += renderer.info.render.calls - before;
    return result;
  };
  const poll = () => {
    for (let i = waiting.length - 1; i >= 0; i--) {
      const q = waiting[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q); waiting.splice(i, 1);
    }
  };
  const tick = (now) => { poll(); if (now - t0 < seconds * 1000) requestAnimationFrame(tick); else finish(); };
  requestAnimationFrame(tick);
  function finish() {
    renderer.render = origRender; renderer.shadowMap.render = origShadow; renderer.info.autoReset = true;
    if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); gl.deleteQuery(query); }
    for (const q of waiting) gl.deleteQuery(q);
    const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
    const sorted = [...frames].sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1) : null);
    let meshes = 0, loose = 0, nodes = 0;
    R.scene.traverse((o) => { nodes++; if (o.isMesh) meshes++; if (o.name === "looseObject") loose++; });
    // Where the scene's objects are: the largest groups two levels down, by how many objects each holds.
    const sizeOf = (o) => { let n = 0; o.traverse(() => n++); return n; };
    const groups = [];
    for (const child of R.scene.children) {
      const size = sizeOf(child);
      if (size > 200) for (const inner of child.children) groups.push([(child.name || child.type) + "/" + (inner.name || inner.type), sizeOf(inner)]);
      else groups.push([child.name || child.type, size]);
    }
    const largest = groups.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, size]) => name + " " + size).join(", ");
    const pose = R.latest && R.latest.poses && R.latest.poses[0] ? R.latest.poses[0].current : null;
    const meanMs = mean(frames);
    resolve({
      fps: meanMs ? +(1000 / meanMs).toFixed(1) : null, frameMs: meanMs, p50: pct(0.5), p90: pct(0.9), p99: pct(0.99),
      jsRenderMs: mean(render), shadowMs: mean(shadow), gpuMs: mean(gpu), gpuSamples: gpu.length,
      drawCalls: Math.round(mean(calls) ?? 0), shadowCalls: Math.round(mean(shadowDraws) ?? 0), triangles: Math.round(mean(tris) ?? 0),
      trucksNear: mean(near), meshes, nodes, largest, looseObjects: loose,
      at: pose ? pose.pos.map((v) => Math.round(v)) : null, raceTime: Math.round((R.latest && R.latest.time) || 0),
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      counter: (document.querySelector(".fps-counter-text") || {}).innerText || null,
    });
  }
}); true`;

/** The heaviest functions of a sampled profile by self time. */
function summarize(profile, top = 25) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const merged = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0;
    total += dt;
    const frame = byId.get(profile.samples[i]).callFrame;
    const where = frame.url ? `${frame.url.split("/").slice(-2).join("/")}:${frame.lineNumber + 1}` : "";
    const key = `${frame.functionName || "(anonymous)"} ${where}`.trim();
    merged.set(key, (merged.get(key) ?? 0) + dt);
  }
  const rows = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([name, us]) => ({ name, ms: +(us / 1000).toFixed(1), share: +(100 * us / total).toFixed(1) }));
  return { totalMs: +(total / 1000).toFixed(0), rows };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.track) { console.log(HELP); process.exit(options.help ? 0 : 1); }
  if (!options.url && !options.game) throw new Error("Give --game <MTM2 folder>, or --url of a server that already serves one.");
  const outDir = resolve(options.out);
  mkdirSync(outDir, { recursive: true });
  const children = [];
  const stop = () => { for (const child of children) try { child.kill(); } catch { /* gone already */ } };
  process.on("exit", stop);
  process.on("SIGINT", () => process.exit(130));

  let url = options.url;
  if (!url) {
    const game = options.pods.length ? overlayGame(options.game, options.pods) : options.game;
    const server = spawn(process.execPath, [join(ROOT, "tools", "serve.mjs"), "--port", String(options.port), "--game", game], { stdio: "ignore" });
    children.push(server);
    url = `http://localhost:${options.port}/`;
    for (let i = 0; i < 50; i++) {
      try { await fetch(url); break; } catch { await sleep(100); }
      if (i === 49) throw new Error(`The server did not come up on port ${options.port}.`);
    }
    log("serving", game, "at", url);
  } else if (options.pods.length) throw new Error("--add-pod needs --game: it changes what this tool's own server mounts.");

  const debugPort = 9300 + Math.floor(Math.random() * 600);
  const profileDir = mkdtempSync(join(os.tmpdir(), "openmtm2-perf-chrome-"));
  const chrome = spawn(findChrome(options.chrome), [
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", `--window-size=${options.window}`, "--window-position=0,0",
    ...(options.dpr ? [`--force-device-scale-factor=${options.dpr}`] : []),
    "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", url,
  ], { stdio: "ignore" });
  if (!options.keep) children.push(chrome);

  let page = null;
  for (let i = 0; i < 150 && !page; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      page = targets.find((target) => target.type === "page" && target.url.startsWith(url.replace(/\/$/, "")));
    } catch { /* not listening yet */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error("Chrome did not open the page.");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((opened, failed) => { socket.onopen = opened; socket.onerror = failed; });
  let nextId = 0;
  const pending = new Map(), workers = new Map(), exceptions = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.method === "Runtime.exceptionThrown") {
      const details = data.params.exceptionDetails;
      const text = (details.exception?.description ?? details.text ?? "").slice(0, 500);
      if (!exceptions.includes(text)) { exceptions.push(text); log("PAGE EXCEPTION:", text); }
    }
    // What the app caught and reported itself (a track that could not be built says why on the console).
    if (data.method === "Runtime.consoleAPICalled" && (data.params.type === "error" || data.params.type === "warning")) {
      const text = data.params.args.map((arg) => arg.description ?? arg.value ?? "").join(" ").slice(0, 500);
      if (!exceptions.includes(text)) { exceptions.push(text); log(`PAGE ${data.params.type.toUpperCase()}:`, text); }
    }
    if (data.method === "Target.attachedToTarget" && data.params.targetInfo.type === "worker") {
      workers.set(data.params.sessionId, data.params.targetInfo.url.split("/").pop());
      // A worker's own errors are reported as the page's are.
      send("Runtime.enable", {}, data.params.sessionId).catch(() => {});
    }
    if (data.method === "Target.detachedFromTarget") workers.delete(data.params.sessionId);
    if (data.id) {
      const waiter = pending.get(data.id);
      pending.delete(data.id);
      if (waiter) data.error ? waiter.reject(new Error(JSON.stringify(data.error))) : waiter.resolve(data.result);
    }
  };
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolveIt, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveIt, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error("page: " + (reply.exceptionDetails.exception?.description ?? JSON.stringify(reply.exceptionDetails)));
    return reply.result.value;
  };
  const waitFor = async (expression, timeoutMs, label) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let value = null;
      try { value = await evaluate(expression); } catch (error) { log("while waiting for", label + ":", error.message.slice(0, 200)); }
      if (value) return value;
      await sleep(500);
    }
    const text = await evaluate("document.body.innerText.slice(0, 600)").catch(() => "");
    if (options.shots) {
      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).catch(() => null);
      if (shot) writeFileSync(join(outDir, "timed-out.jpg"), Buffer.from(shot.data, "base64"));
    }
    const state = await evaluate(`(() => { const R = window.__openmtm2Race; return R ? "race screen up, last reply: " + (R.latest ? Object.keys(R.latest).join(",") : "none") : "no race screen"; })()`).catch(() => "");
    throw new Error(`Timed out waiting for ${label} (${state}); the page says: ${text}`);
  };
  const button = (text) => `[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  const click = (text) => evaluate(`(() => { const b = ${button(text)}; if (!b) return false; b.click(); return true; })()`);
  const escape = async () => {
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  };

  await send("Runtime.enable");
  await send("Page.enable");
  // A page behind another window draws no frames: nothing would be measured, and a race would never start.
  await send("Page.bringToFront").catch(() => {});
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  const screen = `document.querySelector("video") ? "video" : ${button("Install from this server")} ? "install" : ${button("Driver Check-in")} ? "start" : ""`;
  let state = await waitFor(screen, 60000, "the first screen");
  if (state === "install") {
    log("installing the game from the server");
    await click("Install from this server");
    state = await waitFor(`(() => { const s = ${screen}; return s === "start" || s === "video" ? s : ""; })()`, 900000, "the install");
  }
  while (state === "video") { await escape(); await sleep(700); state = await evaluate(screen); }
  await waitFor(`!!(${button("Driver Check-in")})`, 60000, "the start screen");

  // The app's context, through the router: the next screen shown hands it over.
  await evaluate(`(async () => {
    const { Router } = await import("/src/app/router.js");
    const show = Router.prototype._show;
    Router.prototype._show = function (...args) { window.__perfContext = this.context; Router.prototype._show = show; return show.apply(this, args); };
    return true;
  })()`);
  await click("Driver Check-in");
  await waitFor("!!window.__perfContext", 15000, "the app's context");
  // The screen just asked for finishes coming up first: a race asked for under it would be replaced by it.
  await sleep(1000);

  const settings = { vsync: false, ...options.settings };
  const race = await evaluate(`(async () => {
    const context = window.__perfContext;
    context.settings.introVideos = false;
    context.settings.fpsCounter = true;
    const wanted = ${JSON.stringify(settings)};
    if (wanted.graphics) {
      const { applyGraphics } = await import("/src/game/graphics.js");
      context.settings.graphics = wanted.graphics;
      applyGraphics(context.settings, {});
    }
    for (const [key, value] of Object.entries(wanted)) if (key !== "graphics") context.settings[key] = value;
    const catalog = await context.assets.call("catalog");
    const track = catalog.tracks.find((t) => new RegExp(${JSON.stringify(options.track)}, "i").test(t.file));
    if (!track) throw new Error("No track matches " + ${JSON.stringify(options.track)} + ": " + catalog.tracks.map((t) => t.file).join(", "));
    const trucks = catalog.trucks.filter((t) => !t.hidden);
    const player = trucks[0].file;
    const opponents = trucks.filter((t) => t.file !== player && (!t.game || t.game === "MTM")).slice(0, 7).map((t) => t.file);
    const { goRace, setRaceConfig } = await import("/src/app/flow.js");
    setRaceConfig(context, { mode: track.raceType ?? "circuit", track: track.file, laps: 3, difficulty: context.settings.difficulty ?? 1, gameMode: ${JSON.stringify(options.mode)}, opponents, weather: 0, freeRoam: false });
    goRace(context);
    const s = context.settings;
    return {
      track: track.file, name: track.name, player, opponents: opponents.length, dpr: window.devicePixelRatio,
      settings: { graphics: s.graphics, look: s.look, aa: s.aa, vsync: s.vsync, fpsLimit: s.fpsLimit, naturalLight: s.naturalLight, groundDetail: s.groundDetail, lensEffects: s.lensEffects, drawCells: s.drawCells, physics: s.physics, richParticles: s.richParticles },
    };
  })()`);
  log("race:", JSON.stringify(race));
  await waitFor("!!(window.__openmtm2Race && window.__openmtm2Race.latest && window.__openmtm2Race.latest.race)", 60000, "the race to start");
  await waitFor(`document.querySelector(".race-loading")?.hidden === true`, 180000, "the loading screen to go");
  const gpu = await evaluate(`(() => { const gl = window.__openmtm2Race.renderer.getContext(); const info = gl.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
  log("renderer:", gpu);
  await sleep(4000);
  await evaluate(MEASURE);
  if (options.throttle > 1) {
    await send("Emulation.setCPUThrottlingRate", { rate: options.throttle });
    for (const session of workers.keys()) await send("Emulation.setCPUThrottlingRate", { rate: options.throttle }, session).catch(() => {});
    log(`main thread slowed ${options.throttle} times`);
  }

  const report = { when: new Date().toISOString(), url, renderer: gpu, throttle: options.throttle, race, windows: [], profiles: {} };
  const measure = async (label) => {
    await send("Page.bringToFront").catch(() => {});
    const result = await evaluate(`window.__perfWindow(${options.seconds})`);
    report.windows.push({ label, ...result });
    log(`${label}: ${result.fps} fps, frame ${result.frameMs} ms (p90 ${result.p90}, p99 ${result.p99}), js render ${result.jsRenderMs} ms, gpu ${result.gpuMs} ms, ${result.drawCalls} draws (${result.shadowCalls} shadow), ${result.triangles} triangles, ${result.trucksNear} trucks near, at ${JSON.stringify(result.at)}`);
    if (result.counter) log("  counter:", result.counter.replace(/\n/g, " | "));
    if (options.shots) {
      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
      writeFileSync(join(outDir, `${race.track.replace(/\W+/g, "_")}-${label.replace(/\W+/g, "_")}.jpg`), Buffer.from(shot.data, "base64"));
    }
  };
  await measure("grid");
  for (let i = 0; i < 3; i++) {
    const level = await evaluate(`window.__openmtm2Race.sim.call("command", { name: "autopilot" })`);
    if (level === 2) break;
  }
  log(`driving under the autopilot; ${options.settle} s before the first window`);
  await sleep(options.settle * 1000);
  for (let i = 0; i < options.windows; i++) await measure(`drive ${i + 1}`);

  if (options.profile) {
    const sessions = [[undefined, "main"], ...[...workers.entries()]];
    const started = [];
    for (const [session, name] of sessions) {
      try {
        await send("Profiler.enable", {}, session);
        await send("Profiler.setSamplingInterval", { interval: 250 }, session);
        await send("Profiler.start", {}, session);
        started.push([session, name]);
      } catch (error) { log("no profile of", name + ":", error.message.slice(0, 120)); }
    }
    await sleep(options.seconds * 1000);
    const stamp = `${race.track.replace(/\W+/g, "_")}`;
    for (const [session, name] of started) {
      const { profile } = await send("Profiler.stop", {}, session);
      const file = join(outDir, `${stamp}-${name.replace(/\W+/g, "_")}.cpuprofile`);
      writeFileSync(file, JSON.stringify(profile));
      const summary = summarize(profile);
      report.profiles[name] = summary;
      log(`CPU profile, ${name}: ${summary.totalMs} ms sampled (${file})`);
      for (const row of summary.rows) console.log(`${String(row.share).padStart(5)}%  ${String(row.ms).padStart(7)} ms  ${row.name}`);
    }
  }

  const reportFile = join(outDir, `${race.track.replace(/\W+/g, "_")}-${report.when.replace(/[:.]/g, "-")}.json`);
  writeFileSync(reportFile, JSON.stringify(report, null, 1));
  log("report:", reportFile);
  socket.close();
  process.exit(0);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
