// Setup's install sources (src/install/media/, src/install/trial.js) and its choices (src/app/settings.js).

import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { existsSync, openAsBlob, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { openZip } from "../src/install/media/zip.js";
import { openCab, isCabinetHeader } from "../src/install/media/cab.js";
import { findCabinets } from "../src/install/media/exe.js";
import { openIso } from "../src/install/media/iso.js";
import { mediaKind, openMedia } from "../src/install/media/media-source.js";
import { inspectSource, listedArchives } from "../src/install/inspect-source.js";
import { isRequiredPod, isTrialPodSet, missingRequiredPods, podRole } from "../src/install/required-pods.js";
import { downloadTrial, TRIAL } from "../src/install/trial.js";

const enc = new TextEncoder();
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const text = async (blob) => new TextDecoder().decode(await bytesOf(blob));

/** A zip of `files` ({ name: bytes }), deflated when `deflate`. */
function makeZip(files, { deflate = false } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, packed.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, packed.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local, packed);
    centrals.push(central);
    offset += local.length + packed.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end]);
}

/** A one-folder MSZIP cabinet of `files`, cut in blocks of `block` bytes, each block's deflate primed with the history. */
function makeCab(files, { block = 32768 } = {}) {
  const names = Object.keys(files);
  const all = new Uint8Array(names.reduce((n, k) => n + files[k].length, 0));
  let p = 0;
  const records = names.map((name) => { const r = { name, start: p, size: files[name].length }; all.set(files[name], p); p += files[name].length; return r; });
  const blocks = [];
  for (let at = 0; at < all.length; at += block) {
    const chunk = all.subarray(at, Math.min(all.length, at + block));
    const history = all.subarray(Math.max(0, at - 32768), at);
    const packed = new Uint8Array(deflateRawSync(chunk, history.length ? { dictionary: history } : {}));
    const head = new Uint8Array(8 + 2);
    const hv = new DataView(head.buffer);
    hv.setUint16(4, packed.length + 2, true); hv.setUint16(6, chunk.length, true);
    head[8] = 0x43; head[9] = 0x4b;
    blocks.push(head, packed);
  }
  const fileTable = records.map(({ name, start, size }) => {
    const nameBytes = enc.encode(name);
    const r = new Uint8Array(16 + nameBytes.length + 1);
    const v = new DataView(r.buffer);
    v.setUint32(0, size, true); v.setUint32(4, start, true); v.setUint16(8, 0, true);
    r.set(nameBytes, 16);
    return r;
  });
  const filesAt = 36 + 8;
  const dataAt = filesAt + fileTable.reduce((n, r) => n + r.length, 0);
  const total = dataAt + blocks.reduce((n, b) => n + b.length, 0);
  const header = new Uint8Array(44);
  const v = new DataView(header.buffer);
  header.set(enc.encode("MSCF"), 0);
  v.setUint32(8, total, true); v.setUint32(16, filesAt, true); v.setUint8(24, 3); v.setUint8(25, 1);
  v.setUint16(26, 1, true); v.setUint16(28, records.length, true);
  v.setUint32(36, dataAt, true); v.setUint16(40, blocks.length / 2, true); v.setUint16(42, 1, true);
  return new Uint8Array(Buffer.concat([header, ...fileTable, ...blocks]));
}

/** A minimal ISO 9660 image: STARTUP.POD at the root and SYSTEM/TPARK.POD, with primary-volume names (";1"). */
function makeIso(files) {
  const S = 2048, image = new Uint8Array(S * 24);
  const record = (name, extent, size, dir) => {
    const nameBytes = typeof name === "string" ? enc.encode(name) : name;
    const r = new Uint8Array(33 + nameBytes.length + (nameBytes.length % 2 ? 0 : 1));
    r[0] = r.length;
    const v = new DataView(r.buffer);
    v.setUint32(2, extent, true); v.setUint32(10, size, true);
    r[25] = dir ? 2 : 0; r[32] = nameBytes.length; r.set(nameBytes, 33);
    return r;
  };
  const dir = (sector, records) => { let at = sector * S; for (const r of records) { image.set(r, at); at += r.length; } };
  image[16 * S] = 1; image.set(enc.encode("CD001"), 16 * S + 1); image[16 * S + 6] = 1;
  image.set(record(new Uint8Array([0]), 18, S, true), 16 * S + 156);
  image[17 * S] = 255; image.set(enc.encode("CD001"), 17 * S + 1);
  image.set(files["STARTUP.POD"], 20 * S);
  image.set(files["TPARK.POD"], 21 * S);
  dir(18, [record(new Uint8Array([0]), 18, S, true), record(new Uint8Array([1]), 18, S, true),
    record("STARTUP.POD;1", 20, files["STARTUP.POD"].length, false), record("SYSTEM", 19, S, true)]);
  dir(19, [record(new Uint8Array([0]), 19, S, true), record(new Uint8Array([1]), 18, S, true),
    record("TPARK.POD;1", 21, files["TPARK.POD"].length, false)]);
  return new Blob([image]);
}

/** Data that compresses but repeats only far apart, so blocks must reach into the previous ones. */
function sample(size, seed = 1) {
  const out = new Uint8Array(size);
  let x = seed;
  const motif = new Uint8Array(5000).map(() => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 24; });
  for (let i = 0; i < size; i++) out[i] = motif[i % motif.length] ^ (i % 7 === 0 ? 1 : 0);
  return out;
}

test("a zip's stored and deflated entries come out as written, matched without regard to case", async () => {
  const files = { "STARTUP.POD": sample(70000), "sub/readme.txt": enc.encode("hello") };
  for (const deflate of [false, true]) {
    const zip = await openZip(makeZip(files, { deflate }));
    assert.deepEqual(zip.files.map((f) => f.path), ["STARTUP.POD", "sub/readme.txt"]);
    assert.deepEqual(await bytesOf(await zip.open("startup.pod")), files["STARTUP.POD"]);
    assert.equal(await text(await zip.open("SUB/README.TXT")), "hello");
    assert.equal(await zip.open("missing"), null);
  }
});

test("an MSZIP cabinet unpacks across blocks that refer back into earlier ones", async () => {
  const files = { "Startup.pod": sample(100000), "eula.txt": enc.encode("EULA text"), "Tpark.pod": sample(50000, 7) };
  const cab = await openCab(new Blob([makeCab(files)]));
  assert.deepEqual(cab.files.map((f) => f.path), ["Startup.pod", "eula.txt", "Tpark.pod"]);
  assert.deepEqual(await bytesOf(await cab.open("STARTUP.POD")), files["Startup.pod"]);
  assert.deepEqual(await bytesOf(await cab.open("tpark.pod")), files["Tpark.pod"]);
  assert.equal(await text(await cab.open("EULA.TXT")), "EULA text");
});

test("an installer's cabinet is found past a stray MSCF in its stub", () => {
  const cab = makeCab({ "a.pod": sample(1000) });
  const exe = new Uint8Array(Buffer.concat([Buffer.from("MZ"), Buffer.from("....MSCF but not a header...."), Buffer.alloc(100), cab]));
  const at = findCabinets(exe);
  assert.equal(at.length, 1);
  assert.equal(isCabinetHeader(exe, at[0]), true);
  assert.deepEqual(exe.subarray(at[0], at[0] + 4), enc.encode("MSCF"));
});

test("a CD image lists its files by path without the version suffix, as slices of the image", async () => {
  const files = { "STARTUP.POD": sample(3000), "TPARK.POD": sample(1500, 3) };
  const iso = await openIso(makeIso(files));
  assert.deepEqual(iso.files.map((f) => f.path).sort(), ["STARTUP.POD", "SYSTEM/TPARK.POD"]);
  assert.deepEqual(await bytesOf(await iso.open("system/tpark.pod")), files["TPARK.POD"]);
});

test("nested containers are opened until one holds archives: zip, then installer, then cabinet", async () => {
  const cab = makeCab({ "Startup.pod": sample(40000), "Uix.pod": sample(20000, 5), "eula.txt": enc.encode("license") });
  const exe = new Uint8Array(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(5000), cab]));
  const zip = makeZip({ "MtM2trial.EXE": exe }, { deflate: true });
  assert.equal(await mediaKind(zip), "zip");
  const phases = new Set();
  const source = await openMedia(zip, "MtM2trial.zip", { onProgress: (phase) => phases.add(phase) });
  assert.equal(source.kind, "exe");
  assert.deepEqual((await source.list()).sort(), ["EULA.TXT", "STARTUP.POD", "UIX.POD"]);
  assert.equal(await text(await source.getFile("eula.txt")), "license");
  assert.ok(phases.has("unpack"));
  await assert.rejects(openMedia(new Blob([enc.encode("not a container")]), "x.bin"), /not a zip/);
});

test("the trial's archive names stand for the full game's, so a trial passes the required-archive check", () => {
  const trial = ["STARTUP.POD", "MUSICX.POD", "SOUNDX.POD", "COCKPIT.POD", "TRUCK2X.POD", "UIX.POD", "TPARK.POD"];
  assert.deepEqual(missingRequiredPods(trial), []);
  assert.equal(podRole("uix.pod"), "UI.POD");
  assert.equal(isRequiredPod("TRUCK2X.POD"), true);
  assert.equal(isTrialPodSet(trial), true);
  assert.equal(isTrialPodSet(["STARTUP.POD", "UI.POD"]), false);
});

test("a source without POD.INI is installed from the archives it lists, in the game's mount order", async () => {
  const names = ["TPARK.POD", "UIX.POD", "TRUCK2X.POD", "COCKPIT.POD", "SOUNDX.POD", "MUSICX.POD", "STARTUP.POD", "EXTRA/STARTUP.POD"];
  const files = new Map(names.map((n) => [n, new Blob([new Uint8Array(8)])]));
  const source = { name: "trial", getFile: async (p) => files.get(p.toUpperCase()) ?? null, list: async () => [...files.keys()] };
  const listed = await listedArchives(source);
  assert.deepEqual(listed.map((f) => f.name), ["STARTUP.POD", "MUSICX.POD", "SOUNDX.POD", "COCKPIT.POD", "TRUCK2X.POD", "UIX.POD", "TPARK.POD"]);
  const result = await inspectSource(source);
  assert.equal(result.ok, true);
  assert.equal(result.edition, "trial");
  assert.equal(result.podIni, "7\r\nstartup.pod\r\nmusicx.pod\r\nsoundx.pod\r\ncockpit.pod\r\ntruck2x.pod\r\nuix.pod\r\ntpark.pod\r\n");
});

test("Setup's graphics: Enhanced is the OpenMTM2 preset, Standard puts back exactly the defaults it changes", async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const { DEFAULT_SETTINGS, applyOpenMtm2, applySetupGraphics, setupGraphicsOf } = await import("../src/app/settings.js");
  const settings = { ...DEFAULT_SETTINGS, laps: 7 };
  assert.equal(setupGraphicsOf(settings), "standard");
  applySetupGraphics(settings, "enhanced");
  assert.deepEqual(settings, applyOpenMtm2({ ...DEFAULT_SETTINGS, laps: 7 }));
  assert.equal(setupGraphicsOf(settings), "enhanced");
  applySetupGraphics(settings, "standard");
  assert.deepEqual(settings, { ...DEFAULT_SETTINGS, laps: 7 });
});

test("Setup's language: the browser's first language the app has, else English; a saved one wins", async () => {
  const { detectLanguage, languageOf } = await import("../src/app/settings.js");
  assert.equal(detectLanguage(["es-CL", "en-US"]), "es");
  assert.equal(detectLanguage(["fr-FR", "es"]), "es");
  assert.equal(detectLanguage(["de"]), "en");
  assert.equal(detectLanguage(undefined), "en");
  assert.equal(languageOf({ language: "en" }, ["es"]), "en");
  assert.equal(languageOf({ language: null }, ["es-MX"]), "es");
});

test("the Spanish table covers every string of the Setup screen", () => {
  const rows = JSON.parse(readFileSync(new URL("../assets/lang/es.json", import.meta.url), "utf8"));
  const tags = new Set(rows.map((r) => r.tag));
  assert.ok(rows.every((r) => typeof r.tag === "string" && typeof r.text === "string" && r.text));
  const screen = readFileSync(new URL("../src/ui/screens/install.js", import.meta.url), "utf8");
  const used = [...screen.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]).filter((tag) => tag !== "<<1>>");
  assert.deepEqual(used.filter((tag) => !tags.has(tag)), []);
});

const TRIAL_ZIP = new URL("../assets/trial/MtM2trial.zip", import.meta.url);
const noTrial = existsSync(TRIAL_ZIP) ? false : "assets/trial/MtM2trial.zip is not present";

test("the shipped trial is the published zip, and unpacks to its seven archives and license", { skip: noTrial }, async () => {
  const bytes = readFileSync(TRIAL_ZIP);
  assert.equal(bytes.length, TRIAL.size);
  assert.equal(createHash("sha1").update(bytes).digest("hex"), TRIAL.sha1);
  const source = await openMedia(await openAsBlob(TRIAL_ZIP), "MtM2trial.zip");
  const result = await inspectSource(source);
  assert.equal(result.ok, true);
  assert.equal(result.edition, "trial");
  assert.equal(result.exeVersion, "2.00.41");
  assert.deepEqual(result.files.map((f) => f.name), ["STARTUP.POD", "MUSICX.POD", "SOUNDX.POD", "COCKPIT.POD", "TRUCK2X.POD", "UIX.POD", "TPARK.POD"]);
  assert.match(await text(await source.getFile("EULA.TXT")), /Reproduction and\s+Distribution/);
});

test("the trial download falls back to the next source and refuses anything but the published zip", { skip: noTrial }, async () => {
  const zip = readFileSync(TRIAL_ZIP);
  const asked = [];
  const ok = (body, length = body.length) => new Response(body, { headers: { "content-length": String(length) } });
  const fetchFn = async (url) => { asked.push(url); return asked.length === 1 ? new Response("gone", { status: 404 }) : ok(zip); };
  const seen = [];
  const blob = await downloadTrial({ base: "http://localhost/app/", fetchFn, onProgress: ({ source }) => seen.push(source) });
  assert.equal(blob.size, TRIAL.size);
  assert.deepEqual(asked, ["http://localhost/app/assets/trial/MtM2trial.zip", TRIAL.sources[1].url]);
  assert.ok(seen.includes("the Internet Archive"));
  const wrong = new Uint8Array(zip); wrong[100] ^= 1;
  await assert.rejects(downloadTrial({ base: "http://localhost/", fetchFn: async () => ok(wrong) }), /checksum differs/);
  await assert.rejects(downloadTrial({ base: "http://localhost/", fetchFn: async () => ok(new Uint8Array(10)) }), /not the trial's/);
});
