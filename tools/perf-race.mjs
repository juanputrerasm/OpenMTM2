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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
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
  --freeze <n>         pause the race n seconds after the first window and measure the picture held still: the same
                       picture every frame and, the autopilot's line repeating, about the same from run to run, for
                       telling apart settings whose costs are smaller than a race's own ups and downs
  --occlusion          with --freeze: how much of what the held picture draws is wholly hidden behind something else
                       (the placed objects and the ground in view, each one's box tested against the scene's depth)
  --try <label::js>    with --freeze: after the held picture is measured, run the script in the page and measure it
                       again under that label (repeatable, each on top of the last): what one thing costs in one picture
  --eval <js>          an expression worked out in the page after each window, its value logged with it
  --races <n>          run the race n times in the one session, one after another (1): does it slow from race to race
  --heap               save the page's heap snapshot after the last race (with --races: what a finished race left)
  --weather <n>        the weather, by its number in the game's list (0, a clear day)
  --passes             the graphics card's time by pass (each picture three.js draws), in place of the frame's
  --dpr <n>            force the device pixel ratio
  --chrome <path>      the Chrome to run
  --keep               leave Chrome open at the end
`;

function parseArgs(argv) {
  const o = { track: null, game: null, pods: [], url: null, port: 8097, seconds: 8, windows: 3, settle: 20, settings: {}, mode: null, throttle: 1, races: 1, profile: false, shots: false, out: "perf-out", window: "1920,1080", dpr: null, chrome: null, keep: false, help: false };
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
    else if (arg === "--passes") o.passes = true;
    else if (arg === "--weather") o.weather = Number(value());
    else if (arg === "--heap") o.heap = true;
    else if (arg === "--races") o.races = Number(value());
    else if (arg === "--eval") o.eval = value();
    else if (arg === "--try") (o.tries ??= []).push(value());
    else if (arg === "--occlusion") o.occlusion = true;
    else if (arg === "--freeze") o.freeze = Number(value());
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
    // What ground the simulation says each truck is on (its .TTY type), a count a frame and truck.
    for (const pose of (R.latest && R.latest.poses) || []) if (pose.sound) surfaces[pose.sound.surface] = (surfaces[pose.sound.surface] || 0) + 1;
    renderer.info.reset(); renderMs = shadowMs = shadowCalls = 0; open = false;
  };
  // Draw calls by what is drawn: the nearest named thing above each drawn object, a truck's as one kind, the shadow
  // pass's apart.
  const kinds = new WeakMap(), byKind = {}, surfaces = {};
  let inShadow = false;
  const kindOf = (object) => {
    let kind = kinds.get(object);
    if (kind) return kind;
    kind = object.type;
    for (let o = object; o; o = o.parent) {
      if (/\\.TRK$/i.test(o.name)) { kind = "trucks"; break; }
      if (["objects", "looseObject", "terrain", "forest", "placedObject", "vegetation"].includes(o.name)) { kind = o.name; break; }
      if (o.parent === R.scene) { kind = o.name || kind; break; }
    }
    kinds.set(object, kind);
    return kind;
  };
  const origDirect = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const kind = (inShadow ? "shadow:" : "") + kindOf(object);
    byKind[kind] = (byKind[kind] || 0) + 1;
    return origDirect.call(this, camera, scene, geometry, material, object, group);
  };
  let depth = 0;
  // With passes asked for, the graphics card's time is taken of each picture three.js draws by itself (the shadow maps
  // with the picture that needs them), named by what it is drawn to and with, in place of the frame's as a whole: one
  // timer runs at a time.
  const PASSES = window.__perfPasses === true, passMs = {}, passWaiting = [];
  const passName = (scene) => {
    const target = renderer.getRenderTarget();
    const where = target ? target.width + "x" + target.height + (target.samples ? " msaa" + target.samples : "") : "screen";
    if (scene.isScene) return where + " scene" + (scene.name ? " " + scene.name : "");
    const material = scene.material || {};
    const uniforms = Object.keys(material.uniforms || {}).slice(0, 4).join(",");
    return where + " " + (material.name || scene.name || uniforms || material.type || scene.type);
  };
  renderer.render = (...args) => {
    if (!open) {
      open = true; channel.port2.postMessage(0);
      if (!PASSES && ext && waiting.length < 8) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    }
    const t = performance.now();
    let pass = null;
    if (PASSES && ext && depth === 0 && passWaiting.length < 64) { pass = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, pass); }
    const name = pass ? passName(args[0]) : null;
    depth++;
    try { return origRender(...args); } finally {
      if (--depth === 0) renderMs += performance.now() - t;
      if (pass) { gl.endQuery(ext.TIME_ELAPSED_EXT); passWaiting.push([pass, name]); }
    }
  };
  renderer.shadowMap.render = (...args) => {
    const before = renderer.info.render.calls, t = performance.now();
    inShadow = true;
    let result;
    try { result = origShadow(...args); } finally { inShadow = false; }
    shadowMs += performance.now() - t; shadowCalls += renderer.info.render.calls - before;
    return result;
  };
  const pollPasses = () => {
    for (let i = passWaiting.length - 1; i >= 0; i--) {
      const [q, name] = passWaiting[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { const p = (passMs[name] ||= { ms: 0, n: 0 }); p.ms += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; p.n++; }
      gl.deleteQuery(q); passWaiting.splice(i, 1);
    }
  };
  const poll = () => {
    pollPasses();
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
    // (An open port with a listener is never let go, nor is the race the listener can reach: found with --races --heap,
    // where the page seemed to keep every race it had run.)
    channel.port1.onmessage = null; channel.port1.close(); channel.port2.close();
    renderer.renderBufferDirect = origDirect;
    const drawsBy = Object.entries(byKind).map(([kind, n]) => [kind, Math.round(n / Math.max(1, frames.length + 1))])
      .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([kind, n]) => kind + " " + n).join(", ");
    if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); gl.deleteQuery(query); }
    for (const q of waiting) gl.deleteQuery(q);
    for (const [q] of passWaiting) gl.deleteQuery(q);
    // Each pass's mean time, and how many times a frame it is drawn (some are drawn on some frames only).
    const passes = Object.entries(passMs).map(([name, p]) => ({ name, ms: +(p.ms / p.n).toFixed(2), perFrame: +(p.n / Math.max(1, frames.length)).toFixed(2) }))
      .map((p) => ({ ...p, frameMs: +(p.ms * p.perFrame).toFixed(2) })).sort((a, b) => b.frameMs - a.frameMs);
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
      trucksNear: mean(near), meshes, nodes, largest, drawsBy, passes, surfaces, looseObjects: loose,
      at: pose ? pose.pos.map((v) => Math.round(v)) : null, raceTime: Math.round((R.latest && R.latest.time) || 0),
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      counter: (document.querySelector(".fps-counter-text") || {}).innerText || null,
    });
  }
}); true`;

/**
 * What of the picture's meshes is wholly hidden: the scene's depth drawn into a picture of its own, then the box round
 * each mesh in view asked of the graphics card (an occlusion query: did any point of it pass that depth). The upper
 * bound of what occlusion culling could spare: a mesh whose box shows may itself still be hidden.
 */
const OCCLUSION = `(async () => {
  const THREE = await import("three");
  const R = window.__openmtm2Race, renderer = R.renderer, gl = renderer.getContext(), camera = R.camera, scene = R.scene;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.ceil(size.x / 2), Math.ceil(size.y / 2), { depthBuffer: true });
  const before = renderer.getRenderTarget(), auto = renderer.autoClear, shadows = renderer.shadowMap.enabled;
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const kindOf = (o) => { for (let n = o; n; n = n.parent) { if (["objects", "terrain", "forest", "looseObject"].includes(n.name)) return n.name; } return null; };
  const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const items = [], sphere = new THREE.Sphere(), box = new THREE.Box3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !shown(o)) return;
    const kind = kindOf(o);
    if (!kind) return;
    if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); if (!o.boundingSphere) o.computeBoundingSphere(); }
    else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); }
    const localBox = o.isInstancedMesh ? o.boundingBox : o.geometry.boundingBox, localSphere = o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere;
    if (!localBox || localBox.isEmpty()) return;
    sphere.copy(localSphere).applyMatrix4(o.matrixWorld);
    if (!frustum.intersectsSphere(sphere)) return;
    box.copy(localBox).applyMatrix4(o.matrixWorld).expandByScalar(0.5);
    const index = o.geometry.index, count = (index ? index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    items.push({ kind, name: o.name, triangles: Math.round(count), inside: box.containsPoint(eye), center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) });
  });
  // The scene's depth, with nothing but depth drawn.
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(target);
  renderer.autoClear = true;
  // Only what hides: not the sky or a backdrop (drawn about the eye, leaving depth alone), nor anything see-through.
  const out = [];
  scene.traverse((o) => {
    if (!o.visible || !(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    let apart = !o.isMesh || !m || m.depthWrite === false || m.transparent || m.colorWrite === false || !!m.isShaderMaterial;
    for (let n = o; n && !apart; n = n.parent) if (n.name === "sky" || n.name === "backdrops") apart = true;
    if (apart) { o.visible = false; out.push(o); }
  });
  scene.overrideMaterial = depthOnly;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  for (const o of out) o.visible = true;
  renderer.autoClear = false;
  const probe = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  probe.frustumCulled = false;
  const probeScene = new THREE.Scene();
  probeScene.add(probe);
  const queries = [];
  for (const item of items) {
    if (item.inside) { queries.push(null); continue; }
    probe.position.copy(item.center);
    probe.scale.copy(item.size);
    const q = gl.createQuery();
    gl.beginQuery(gl.ANY_SAMPLES_PASSED, q);
    renderer.render(probeScene, camera);
    gl.endQuery(gl.ANY_SAMPLES_PASSED);
    queries.push(q);
  }
  renderer.setRenderTarget(before);
  renderer.autoClear = auto;
  renderer.shadowMap.enabled = shadows;
  gl.flush();
  for (let wait = 0; wait < 200; wait++) {
    await new Promise((done) => setTimeout(done, 20));
    if (queries.every((q) => !q || gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) break;
  }
  const by = {};
  items.forEach((item, i) => {
    const q = queries[i], hidden = q ? gl.getQueryParameter(q, gl.QUERY_RESULT) === 0 : false;
    if (q) gl.deleteQuery(q);
    const k = (by[item.kind] ||= { meshes: 0, hidden: 0, triangles: 0, hiddenTriangles: 0 });
    k.meshes++; k.triangles += item.triangles;
    if (hidden) { k.hidden++; k.hiddenTriangles += item.triangles; }
  });
  target.dispose(); depthOnly.dispose(); probe.geometry.dispose(); probe.material.dispose();
  return by;
})()`;

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
  /** A heap snapshot's pieces as they arrive (`--heap`), or null while none is being taken. */
  let heapChunks = null;
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.method === "HeapProfiler.addHeapSnapshotChunk" && heapChunks && !data.sessionId) { heapChunks.push(data.params.chunk); return; }
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
  // Every texture the page makes on the graphics card, with the race it was made in, where in the code and its size:
  // those of an earlier race still there when the last is over were never let go.
  await evaluate(`(() => {
    const live = window.__perfTextures = new Map(), proto = WebGL2RenderingContext.prototype;
    const wrap = (name, fn) => { const own = proto[name]; proto[name] = function (...args) { return fn.call(this, own, args); }; };
    wrap("createTexture", function (own, args) {
      const texture = own.apply(this, args);
      live.set(texture, { round: window.__perfRound || 0, points: 0, where: new Error().stack.split("\\n").slice(2, 12).map((line) => line.trim().replace(/^at /, "").replace(/https?:\\/\\/[^/]+\\//, "").replace(/\\?[^:)]*/, "")).filter((line) => !/^Object\\.|new Promise|as createTexture/.test(line)).filter((line, i, all) => !/three\\.module/.test(line) || all.every((other) => /three\\.module/.test(other))).slice(0, 5).join(" < ") });
      return texture;
    });
    wrap("deleteTexture", function (own, args) { live.delete(args[0]); return own.apply(this, args); });
    wrap("bindTexture", function (own, args) { this.__perfBound = args[1]; return own.apply(this, args); });
    const sized = (w, h, d) => function (own, args) { const t = live.get(this.__perfBound); if (t) t.points = Math.max(t.points, args[w] * args[h] * (d ? args[d] : 1)); return own.apply(this, args); };
    wrap("texStorage2D", sized(3, 4));
    wrap("texStorage3D", sized(3, 4, 5));
    wrap("texImage2D", function (own, args) {
      const t = live.get(this.__perfBound), source = args.length < 9 ? args[5] : null;
      if (t) t.points = Math.max(t.points, source ? (source.videoWidth || source.width || 0) * (source.videoHeight || source.height || 0) : args[3] * args[4]);
      return own.apply(this, args);
    });
    wrap("texImage3D", sized(3, 4, 5));
    return true;
  })()`);
  let report = null;
  for (let round = 1; round <= options.races; round++) {
  await evaluate(`window.__perfRound = ${round}; true`);
  const again = round > 1 ? `race ${round} ` : "";
  const race = await evaluate(`(async () => {
    const context = window.__perfContext;
    // The race before this one, if any: the next is ready when another has taken its place.
    window.__perfRaceBefore = window.__openmtm2Race || null;
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
    setRaceConfig(context, { mode: track.raceType ?? "circuit", track: track.file, laps: 3, difficulty: context.settings.difficulty ?? 1, gameMode: ${JSON.stringify(options.mode)}, opponents, weather: ${Number(options.weather) || 0}, freeRoam: false });
    goRace(context);
    const s = context.settings;
    return {
      track: track.file, name: track.name, player, opponents: opponents.length, dpr: window.devicePixelRatio,
      settings: { graphics: s.graphics, look: s.look, aa: s.aa, vsync: s.vsync, fpsLimit: s.fpsLimit, naturalLight: s.naturalLight, groundDetail: s.groundDetail, lensEffects: s.lensEffects, drawCells: s.drawCells, physics: s.physics, richParticles: s.richParticles },
    };
  })()`);
  log("race:", JSON.stringify(race));
  await waitFor("!!(window.__openmtm2Race && window.__openmtm2Race !== window.__perfRaceBefore && window.__openmtm2Race.latest && window.__openmtm2Race.latest.race)", 60000, "the race to start");
  await waitFor(`document.querySelector(".race-loading")?.hidden === true`, 180000, "the loading screen to go");
  const gpu = await evaluate(`(() => { const gl = window.__openmtm2Race.renderer.getContext(); const info = gl.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
  log("renderer:", gpu);
  // Under the autopilot from before the lights: the truck leaves the line with the others and drives in the pack, where
  // a race is dearest to draw (eight trucks, their dust and their shadows). Engaged after the first window, it left
  // some ten seconds late and drove alone.
  for (let i = 0; i < 3; i++) {
    const level = await evaluate(`window.__openmtm2Race.sim.call("command", { name: "autopilot" })`);
    if (level === 2) break;
  }
  await sleep(4000);
  if (options.passes) await evaluate("window.__perfPasses = true");
  await evaluate(MEASURE);
  if (options.throttle > 1) {
    await send("Emulation.setCPUThrottlingRate", { rate: options.throttle });
    for (const session of workers.keys()) await send("Emulation.setCPUThrottlingRate", { rate: options.throttle }, session).catch(() => {});
    log(`main thread slowed ${options.throttle} times`);
  }

  report ??= { when: new Date().toISOString(), url, renderer: gpu, throttle: options.throttle, race, windows: [], profiles: {} };
  const measure = async (name) => {
    const label = again + name;
    await send("Page.bringToFront").catch(() => {});
    const result = await evaluate(`window.__perfWindow(${options.seconds})`);
    report.windows.push({ label, ...result });
    log(`${label}: ${result.fps} fps, frame ${result.frameMs} ms (p90 ${result.p90}, p99 ${result.p99}), js render ${result.jsRenderMs} ms, gpu ${result.gpuMs} ms, ${result.drawCalls} draws (${result.shadowCalls} shadow), ${result.triangles} triangles, ${result.trucksNear} trucks near, at ${JSON.stringify(result.at)}`);
    log(`  draws by kind: ${result.drawsBy}`);
    log(`  ground types under the trucks: ${JSON.stringify(result.surfaces)}`);
    if (result.passes?.length) for (const p of result.passes) log(`  pass ${p.frameMs} ms a frame (${p.ms} ms x ${p.perFrame}): ${p.name}`);
    if (result.counter) log("  counter:", result.counter.replace(/\n/g, " | "));
    if (options.eval) log("  eval:", JSON.stringify(await evaluate(options.eval)));
    if (options.shots) {
      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
      writeFileSync(join(outDir, `${race.track.replace(/\W+/g, "_")}-${label.replace(/\W+/g, "_")}.jpg`), Buffer.from(shot.data, "base64"));
    }
  };
  await measure("start");
  if (options.freeze > 0) {
    await sleep(options.freeze * 1000);
    await evaluate(`window.__openmtm2Race.setPaused(true).then(() => true)`);
    log(`paused ${options.freeze} s after the first window`);
    await sleep(1500);
    for (let i = 0; i < options.windows; i++) await measure(`still ${i + 1}`);
    // The same held picture with its dust (the puffs of "Rich particles", render/over-scene.js) drawn each way and not
    // at all: what the dust in it costs, and which way of drawing it is the cheaper there.
    const load = await evaluate(`(() => {
      const over = window.__openmtm2Race.scenery.particles?.over;
      if (!over) return null;
      const own = Object.getOwnPropertyDescriptor(over, "load");
      window.__perfDust = (value) => {
        if (value === null) { Object.defineProperty(over, "load", own); return; }
        own.set.call(over, value);
        Object.defineProperty(over, "load", { configurable: true, enumerable: true, get: () => value, set() {} });
      };
      window.__perfDustShown = (shown) => {
        for (const child of over.scene.children) {
          if (shown) delete child.visible, child.visible = true;
          else Object.defineProperty(child, "visible", { configurable: true, enumerable: true, get: () => false, set() {} });
        }
      };
      return +over.load.toFixed(2);
    })()`);
    for (const attempt of options.tries ?? []) {
      const at = attempt.indexOf("::"), label = at < 0 ? attempt : attempt.slice(0, at), script = at < 0 ? attempt : attempt.slice(at + 2);
      await evaluate(`(() => { ${script}; return true; })()`);
      await sleep(800);
      await measure(label);
    }
    if (options.occlusion) {
      const hidden = await evaluate(OCCLUSION);
      for (const [kind, k] of Object.entries(hidden ?? {})) log(`hidden ${kind}: ${k.hidden} of ${k.meshes} meshes in view, ${k.hiddenTriangles} of ${k.triangles} triangles`);
      report.occlusion = hidden;
    }
    if (load !== null && !options.occlusion && !options.tries) {
      log(`dust: ${load} pictures' worth of puffs in the held picture`);
      for (const [label, script] of [["dust light", "__perfDust(0)"], ["dust heavy", "__perfDust(100)"], ["no dust", "__perfDust(0); __perfDustShown(false)"]]) {
        await evaluate(`${script}; true`);
        await sleep(800);
        await measure(label);
      }
    }
  } else {
    log(`driving under the autopilot; ${options.settle} s before the next window`);
    await sleep(options.settle * 1000);
    for (let i = 0; i < options.windows; i++) await measure(`drive ${i + 1}`);
  }

  // What the page holds after the race: a session that slows from race to race keeps something from each.
  await send("HeapProfiler.collectGarbage").catch(() => {});
  const held = await evaluate(`(() => {
    const R = window.__openmtm2Race, info = R.renderer.info;
    return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, domNodes: document.getElementsByTagName("*").length,
      sceneNodes: (() => { let n = 0; R.scene.traverse(() => n++); return n; })() };
  })()`);
  log(`${again}holds: ${JSON.stringify(held)}`);
  (report.held ??= []).push(held);
  }
  if (options.races > 1) {
    const left = await evaluate(`(() => {
      const by = new Map();
      for (const t of window.__perfTextures.values()) {
        if (!(t.round >= 1 && t.round < window.__perfRound)) continue;
        const k = by.get(t.where) || { count: 0, megapoints: 0, rounds: new Set() };
        k.count++; k.megapoints += t.points / 1e6; k.rounds.add(t.round);
        by.set(t.where, k);
      }
      return [...by].map(([where, k]) => ({ where, count: k.count, megapoints: +k.megapoints.toFixed(1), races: k.rounds.size })).sort((a, b) => b.megapoints - a.megapoints).slice(0, 14);
    })()`);
    for (const t of left) log(`textures of earlier races still held: ${t.count} (${t.megapoints} million points, from ${t.races} races) made at ${t.where}`);
    if (!left.length) log("no texture of an earlier race is still held");
    report.texturesLeft = left;
  }
  if (options.heap) {
    // What the page still holds once the races are over: for finding what keeps a finished race alive (tools/heap-paths.mjs).
    await evaluate("window.__perfRaceBefore = null; true");
    await send("HeapProfiler.collectGarbage").catch(() => {});
    heapChunks = [];
    await send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    const file = join(outDir, "page.heapsnapshot");
    writeFileSync(file, "");
    for (const chunk of heapChunks) appendFileSync(file, chunk);
    heapChunks = null;
    log("heap snapshot:", file);
  }
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
    const stamp = `${report.race.track.replace(/\W+/g, "_")}`;
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

  const reportFile = join(outDir, `${report.race.track.replace(/\W+/g, "_")}-${report.when.replace(/[:.]/g, "-")}.json`);
  writeFileSync(reportFile, JSON.stringify(report, null, 1));
  log("report:", reportFile);
  socket.close();
  process.exit(0);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
