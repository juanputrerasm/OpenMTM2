/*
  The asset worker: the install in OPFS, the mounted archives and the content catalogue.
  It also prepares tracks for drawing (track-build.js).

  Protocol (src/shared/worker-client.js): requests `{ id, type, payload }`, replies
  `{ id, ok, payload | error }`, unsolicited events `{ event, payload }`, and `{ ready: true }`
  once this module graph has loaded.
*/
import { VIDEOS_DIR, copyInstall, readManifest, removeInstall, replaceVideos, syncInstall } from "./install-store.js";
import { readFile } from "../shared/opfs.js";
import { parseVideoLists } from "../game/videos.js";
import { addGameFolder, addPods, describeMounts, mountAll, reloadPodIni, removeAddons, removePod, setMountOrder } from "./addon-store.js";
import { buildCatalog } from "./catalog.js";
import { buildJukeboxList } from "./jukebox-list.js";
import { buildSky, buildTrackRender, transferablesOf } from "./track-build.js";
import { lenientKlp } from "../game/sound-model.js";
import { SOUND_EXTENSIONS, findSound, soundStem } from "./sound-file.js";
import { buildTruckPreview } from "./preview-build.js";
import { loadingScreen } from "./screen-art.js";
import { truckEnvMap } from "./env-map.js";
import { loadCockpit, cockpitArt } from "./cockpit-art.js";
import { loadEffectsArt } from "./effects-art.js";
import { decodeActPalette } from "../vendor/openphotex/texture/act.js";
import { decodeRawTexture } from "../vendor/openphotex/texture/raw.js";
import { parseKlp, parseMtmAmbientSounds } from "../vendor/openphotex/mtm/sound.js";
import { parseLoc } from "../vendor/openphotex/mtm/loc.js";
import { parseMod, renderMod } from "../vendor/openphotex/audio/mod.js";
import { parseMtmSun } from "../vendor/openphotex/mtm/sun.js";
import { parseTrn } from "../vendor/openphotex/mtm/trn.js";
import { decodeModel } from "./models.js";
import { FONT_SHEETS, parseBitmapFont } from "./bitmap-font.js";
import { readUserData, removeUserData, writeUserData } from "./user-data.js";
import { crcStart, crcUpdate } from "../net/vendor/mtmnet/track-crc.js";

/** A reply whose buffers move to the main thread instead of being copied. */
const TRANSFER = Symbol("transfer");
function withTransfer(payload, transfer) {
  return { [TRANSFER]: transfer, payload };
}

/** `bytes` with a buffer of its own to transfer: a read's own (pod-index.js), else a copy of a view into a larger one. */
const ownBytes = (bytes) => (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice());

// Promises, so requests that arrive together share one mount and one catalogue; a reset sets them to null.
let vfs = null;
let catalog = null;
/** The jukebox's music, with the catalogue it was read from: read again once the catalogue is (the mounts changed). */
let jukebox = { catalog: null, list: null };
/** Track checksums by archive key (trackChecksum); forgotten when the mounts change. */
const trackChecksums = new Map();

/** `pending`, forgotten if it fails while still current, so the next request tries again. */
async function settle(pending, forget) {
  try {
    return await pending;
  } catch (error) {
    forget(pending);
    throw error;
  }
}

function mounted() {
  vfs ??= readManifest().then((manifest) => {
    if (!manifest) throw new Error("No game install yet.");
    return mountAll(manifest);
  });
  return settle(vfs, (p) => { if (vfs === p) vfs = null; });
}

/** The file system as a track of `scope` sees it (worker/vfs.js). */
const scoped = (vfs, scope) => (scope ? vfs.scoped(scope) : vfs);

const handlers = {
  async installStatus() {
    const manifest = await readManifest();
    return { installed: Boolean(manifest), manifest };
  },

  async install(request) {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    return copyInstall(request, (progress) => self.postMessage({ event: "install-progress", payload: progress }));
  },

  /** Reload POD.INI: the stored POD.INI applied again, every archive it lists mounted in its order (worker/addon-store.js). */
  async reloadPodIni() {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    return reloadPodIni();
  },

  /** Change base install, from a folder picked again: mount what its POD.INI lists, copying only what changed. */
  async reloadInstall(request) {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    const done = await syncInstall(request, (progress) => self.postMessage({ event: "install-progress", payload: progress }));
    // The new POD.INI's order for the install's archives, ahead of the added ones.
    await reloadPodIni();
    return done;
  },

  /**
   * The game's videos (game/videos.js): `{ lists, files }`, the `[Video]` lists of the install's EXTRAS.INI and the video
   * paths the install has. Empty when the folder had none.
   */
  async videoLists() {
    const manifest = await readManifest();
    const files = (manifest?.videos ?? []).filter((name) => name !== "EXTRAS.INI");
    const ini = await readFile(`${VIDEOS_DIR}/EXTRAS.INI`).then((f) => f.text()).catch(() => "");
    return { lists: parseVideoLists(ini), files };
  },

  /** Copy the game's videos into the install, or remove them with none given (install-store.js `replaceVideos`). */
  async installVideos({ videos = [] } = {}) {
    return replaceVideos(videos, (progress) => self.postMessage({ event: "install-progress", payload: progress }));
  },

  /** A video's bytes (`path` as `videoLists` gives it), or null. */
  async video({ path }) {
    const file = await readFile(`${VIDEOS_DIR}/${String(path).toUpperCase()}`).catch(() => null);
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return withTransfer(bytes, [bytes.buffer]);
  },

  async uninstall() {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    await removeInstall();
    return true;
  },

  /** Remove every OpenMTM2 OPFS record. Preferences are cleared by the main thread. */
  async clearGameData() {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    await Promise.all([removeInstall(), removeAddons(), removeUserData()]);
    return true;
  },

  /** Add a game folder's archives (`{ label, files }`, as its POD.INI lists them) beside the install. */
  async addGameFolder(request) {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    return addGameFolder(request, (progress) => self.postMessage({ event: "install-progress", payload: progress }));
  },

  /** Add archives picked by hand: `{ files }`. */
  async addPods(request) {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    return addPods(request, (progress) => self.postMessage({ event: "install-progress", payload: progress }));
  },

  async removePod({ key }) {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    return removePod(key);
  },

  /** The mount order, as every mount key, first mounted first. */
  async setMountOrder({ keys }) {
    vfs = null;
    catalog = null;
    trackChecksums.clear();
    return setMountOrder(keys);
  },

  /** Every mounted archive, in mount order (the POD manager). */
  async podList() {
    return describeMounts(await mounted());
  },

  /** `mtm1Apart`: also the MTM1 trucks that MTM2's shadow, as `MTM1:<file>` (Options, Advanced, "Keep MTM1 trucks apart"). */
  async catalog({ mtm1Apart = false } = {}) {
    catalog ??= mounted().then(buildCatalog);
    const all = await settle(catalog, (p) => { if (catalog === p) catalog = null; });
    return mtm1Apart ? all : { ...all, trucks: all.trucks.filter((truck) => !truck.apart) };
  },

  /**
   * The jukebox's music (worker/jukebox-list.js): every piece of music in the mounted archives, each once:
   * `[{ id, kind, stem, format, menu, tracks }]`.
   */
  async jukebox() {
    const { tracks } = await handlers.catalog();
    // Set at once, so requests that arrive together share one reading.
    if (jukebox.catalog !== catalog || !jukebox.list) jukebox = { catalog, list: mounted().then((view) => buildJukeboxList(view, tracks)) };
    const pending = jukebox.list;
    return settle(pending, (p) => { if (jukebox.list === p) jukebox = { catalog: null, list: null }; });
  },

  /** Everything needed to draw a track; `{ path }` is its SIT, e.g. "WORLD\\TPARK.SIT". */
  /** `scope` is the track's lookup family (the catalogue's `scope`), for a track of another game than MTM. */
  async trackRender({ path, scope, detailLevel, raceType, truckFiles, weather, mtm1, tileOverlap, visuals, smoothTiles, hdWeather, originalBackdrops, evoForest, sunShadows }) {
    const build = await buildTrackRender(scoped(await mounted(), scope), path, { detailLevel, raceType, truckFiles, weather, mtm1, tileOverlap, visuals, smoothTiles, hdWeather, originalBackdrops, evoForest, sunShadows });
    return withTransfer(build, transferablesOf(build));
  },

  /** A truck's models and the mini garage for the Driver Check-in preview; `{ file }` is its TRK. */
  async truckPreview({ file, winner = false }) {
    const build = await buildTruckPreview(await mounted(), file, { winner });
    return withTransfer(build, transferablesOf(build));
  },

  /** A player's data file (profiles, Hall of Fame) as parsed JSON, or null when missing. */
  async userData({ key }) {
    return readUserData(key);
  },

  async saveUserData({ key, value }) {
    await writeUserData(key, value);
    return true;
  },

  /** A `UI\\*.BMP` as raw bytes (browsers show BMP natively), or null. */
  async uiImage({ name }) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(name))) throw new Error(`Bad image name "${name}"`);
    const bytes = await (await mounted()).read(`UI\\${name.toUpperCase()}.BMP`);
    if (!bytes) return null;
    const own = ownBytes(bytes);
    return withTransfer(own, [own.buffer]);
  },

  /** A `UI\\*.TXT` (the About screen's LEGAL.TXT) as text with CRLF kept, or null. */
  async uiText({ name }) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(name))) throw new Error(`Bad text name "${name}"`);
    const bytes = await (await mounted()).read(`UI\\${name.toUpperCase()}.TXT`);
    return bytes ? new TextDecoder("latin1").decode(bytes) : null;
  },

  /**
   * A track's network checksum (MONSTER_EXE_ANALYSIS.md 14.2, packet 0x25): CRC-32/MPEG-2 over the whole POD that holds
   * `WORLD\\<sit>`, -1 when none does. Kept per archive, as the game keeps it.
   */
  async trackChecksum({ sit }) {
    const hit = (await mounted()).find(`WORLD\\${String(sit).toUpperCase()}`);
    if (!hit?.mount.blob) return -1;
    const key = hit.mount.key ?? hit.mount.name;
    if (!trackChecksums.has(key)) {
      trackChecksums.set(key, (async () => {
        const blob = await hit.mount.blob();
        let crc = crcStart();
        const CHUNK = 4 << 20;
        for (let at = 0; at < blob.size; at += CHUNK) crc = crcUpdate(crc, new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
        return crc;
      })().catch((err) => { trackChecksums.delete(key); throw err; }));
    }
    return trackChecksums.get(key);
  },

  /** The mounted tournaments (`TOURNEY\\*.TRN`): `[{ path, trn, description }]`, the description from the text file the TRN names. */
  async tournaments() {
    const vfs = await mounted(), out = [], seen = new Set();
    for (const { path } of vfs.list(".TRN")) {
      const key = path.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const trn = parseTrn(await vfs.read(path));
      if (!trn) continue;
      const text = trn.descriptionFile ? await vfs.read(`TOURNEY\\${trn.descriptionFile.toUpperCase()}`) : null;
      const said = text ? new TextDecoder("latin1").decode(text) : "";
      out.push({ path, trn, description: (said.includes("\x1a") ? said.slice(0, said.indexOf("\x1a")) : said).replace(/\r\n?/g, "\n").trim() });
    }
    return out;
  },

  /** A track's description (`WORLD\\<name>`, the SIT's "Track Description .TXT file") as text, or null. */
  async trackText({ name }) {
    if (!/^[A-Za-z0-9_.-]+$/.test(String(name))) throw new Error(`Bad text name "${name}"`);
    const bytes = await (await mounted()).read(`WORLD\\${name.toUpperCase()}`);
    if (!bytes) return null;
    // A DOS text file: a Ctrl+Z ends it.
    const text = new TextDecoder("latin1").decode(bytes);
    return (text.includes("\x1a") ? text.slice(0, text.indexOf("\x1a")) : text).replace(/\r\n?/g, "\n").trim();
  },

  /** The cockpit art and the finder (worker/cockpit-art.js), darkened for `weather`, or null. */
  async cockpit({ weather = 0 } = {}) {
    const art = await loadCockpit(await mounted(), { weather });
    if (!art) return null;
    const buffers = [];
    const collect = (value) => { if (value?.rgba) buffers.push(value.rgba.buffer); else if (value && typeof value === "object") Object.values(value).forEach(collect); };
    collect(art);
    return withTransfer(art, buffers);
  },

  /** The weather and water effect art (worker/effects-art.js). */
  async effectsArt() {
    const art = await loadEffectsArt(await mounted());
    const buffers = [];
    const collect = (value) => { if (value?.rgba) buffers.push(value.rgba.buffer); else if (value && typeof value === "object") Object.values(value).forEach(collect); };
    collect(art);
    return withTransfer(art, buffers);
  },

  /**
   * The dashboard needle (`MODELS\\NEEDLE.BIN`, from UI.POD) as flat 2D shapes: `[{ color, points }]`
   * with `points` the x, y of each triangle's corners, y up, the tip along +y; or null.
   */
  async needle() {
    const bytes = await (await mounted()).read("MODELS\\NEEDLE.BIN");
    const model = bytes && decodeModel(bytes, "NEEDLE.BIN");
    if (!model?.meshes.length) return null;
    return model.meshes.map((m) => ({
      color: (m.color ?? 0xffffff) & 0xffffff,
      points: Array.from({ length: m.positions.length / 3 }, (_, n) => [m.positions[n * 3], m.positions[n * 3 + 1]]),
    }));
  },

  /**
   * The sun's lens flare (`DATA\\SUN.TXT`) with its textures decoded: `{ masterRadius, layers, rays,
   * textures: { SUN06: { width, height, rgba } } }`, or null when the install lacks the file.
   */
  async flare() {
    const vfs = await mounted();
    const text = await vfs.read("DATA\\SUN.TXT");
    if (!text) return null;
    const sun = parseMtmSun(text);
    const names = new Set(sun.layers.map((l) => l.texture.replace(/\.raw$/i, "").toUpperCase()));
    names.add("SUN02");
    names.add("MOON");
    const textures = {};
    for (const name of names) {
      const raw = await vfs.read(`ART\\${name}.RAW`), act = await vfs.read(`ART\\${name}.ACT`);
      const palette = act && decodeActPalette(act);
      if (!raw || !palette) continue;
      try {
        const image = decodeRawTexture(raw, palette, { cutout: name === "MOON" });
        textures[name] = { width: image.width, height: image.height, rgba: image.rgba };
      } catch { /* a texture that does not decode is left out */ }
    }
    return withTransfer({ masterRadius: sun.masterRadius, layers: sun.layers, rays: sun.rays, textures },
      Object.values(textures).map((t) => t.rgba.buffer));
  },

  /**
   * A tracker module (`MUSIC\\<name>.MOD`, or SOUND\\) played through into stereo PCM:
   * `{ sampleRate, left, right, loopStartFrame }`, or null. The page loops it.
   */
  async mod({ name }) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(name).replace(/\.mod$/i, ""))) throw new Error(`Bad module name "${name}"`);
    const stem = name.replace(/\.mod$/i, "").toUpperCase();
    const vfs = await mounted();
    const bytes = (await vfs.read(`MUSIC\\${stem}.MOD`)) ?? (await vfs.read(`SOUND\\${stem}.MOD`));
    const song = bytes && parseMod(bytes);
    if (!song) return null;
    const out = renderMod(song, { sampleRate: 44100 });
    return withTransfer(out, [out.left.buffer, out.right.buffer]);
  },

  /**
   * A sound by name (sound-file.js): `SOUND\\<name>.OGG`, `.MP3` or `.WAV`, with its `.KLP` loop points:
   * `{ name, bytes, format, sourceRate, klp }`, or null. `only: "WAV"` skips the replacements.
   */
  async sound({ name, only = null }) {
    if (!/^[A-Za-z0-9_.-]+$/.test(String(name))) throw new Error(`Bad sound name "${name}"`);
    if (only !== null && !SOUND_EXTENSIONS.includes(only)) throw new Error(`Bad sound format "${only}"`);
    const stem = soundStem(name);
    const vfs = await mounted();
    const found = await findSound(vfs, stem, { only });
    if (!found) return null;
    const klp = await vfs.read(`SOUND\\${stem}.KLP`);
    const copy = ownBytes(found.bytes).buffer;
    return withTransfer({ name: stem, bytes: copy, format: found.format, sourceRate: found.sourceRate, klp: klp ? parseKlp(klp) ?? lenientKlp(klp) : null }, [copy]);
  },

  /** A level's ambient sounds (`DATA\\SOUNDnnn.TXT`), or null. */
  async ambience({ number }) {
    const bytes = await (await mounted()).read(`DATA\\SOUND${String(Number(number)).padStart(3, "0")}.TXT`);
    return bytes ? parseMtmAmbientSounds(bytes) : null;
  },

  /** The `.LOC` message tables in the install: `[{ path }]`. */
  async locFiles() {
    return (await mounted()).list(".LOC").map(({ path }) => ({ path }));
  },

  /** One `.LOC` parsed into `[{ tag, text }]`, or null. */
  async loc({ path }) {
    const bytes = await (await mounted()).read(path);
    return bytes ? parseLoc(bytes) : null;
  },

  /** One of the game's bitmap fonts by stem ("FNT1_480"): its glyph boxes and a 0/255 mask. */
  async font({ stem }) {
    const size = FONT_SHEETS[stem];
    if (!size) throw new Error(`Unknown font "${stem}"`);
    const raw = await (await mounted()).read(`ART\\${stem}.RAW`);
    if (!raw) return null;
    const font = parseBitmapFont(raw, size[0], size[1]);
    const reply = { ...font, glyphs: [...font.glyphs] };
    return withTransfer(reply, [font.mask.buffer]);
  },

  /** A track's sky for another weather, `{ name, width, height, rgba }` or null. */
  async sky({ path, scope, weather, mtm1, hdWeather }) {
    const sky = await buildSky(scoped(await mounted(), scope), path, weather, mtm1, { hdWeather });
    return sky ? withTransfer(sky, [sky.rgba.buffer]) : null;
  },

  /** The texture MTM2 mirrors on a truck's body in `weather` (worker/env-map.js), `{ width, height, rgba }` or null. */
  async envMap({ weather = 0 } = {}) {
    const image = await truckEnvMap(await mounted(), weather);
    return image ? withTransfer(image, [image.rgba.buffer]) : null;
  },

  /** The race loading screen, `{ width, height, rgba }` or null. */
  async loadingScreen({ raceType } = {}) {
    const image = await loadingScreen(await mounted(), { raceType });
    return image ? withTransfer(image, [image.rgba.buffer]) : null;
  },

  /** The headset cab's dashboard panel and gauge layout (cockpit-art.js `cockpitArt`), or null. */
  async cockpitPanel() {
    const art = await cockpitArt(await mounted());
    return art ? withTransfer(art, [art.panel.rgba.buffer]) : null;
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
