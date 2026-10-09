/*
  The asset worker: the install in OPFS, the mounted archives and the content catalogue.
  It also prepares tracks for drawing (track-build.js).

  Protocol (src/shared/worker-client.js): requests `{ id, type, payload }`, replies
  `{ id, ok, payload | error }`, unsolicited events `{ event, payload }`, and `{ ready: true }`
  once this module graph has loaded.
*/
import { copyInstall, mountInstall, readManifest, removeInstall } from "./install-store.js";
import { buildCatalog } from "./catalog.js";
import { buildSky, buildTrackRender, transferablesOf } from "./track-build.js";
import { loadingScreen } from "./screen-art.js";
import { loadCockpit } from "./cockpit-art.js";
import { loadEffectsArt } from "./effects-art.js";
import { decodeActPalette, decodeRawTexture, parseKlp, parseLoc, parseMod, parseMtmAmbientSounds, parseMtmSun, renderMod } from "../vendor/openphotex/index.js";
import { decodeModel } from "./models.js";
import { FONT_SHEETS, parseBitmapFont } from "./bitmap-font.js";
import { readUserData, removeUserData, writeUserData } from "./user-data.js";

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

  /** Remove every OpenMTM2 OPFS record. Preferences are cleared by the main thread. */
  async clearGameData() {
    vfs = null;
    catalog = null;
    await Promise.all([removeInstall(), removeUserData()]);
    return true;
  },

  async catalog() {
    if (!catalog) catalog = await buildCatalog(await mounted());
    return catalog;
  },

  /** Everything needed to draw a track; `{ path }` is its SIT, e.g. "WORLD\\TPARK.SIT". */
  async trackRender({ path, detailLevel, raceType, truckFiles, weather }) {
    const build = await buildTrackRender(await mounted(), path, { detailLevel, raceType, truckFiles, weather });
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
    return bytes ? withTransfer(bytes.slice(), []) : null;
  },

  /** The cockpit art and the finder (worker/cockpit-art.js), or null. */
  async cockpit() {
    const art = await loadCockpit(await mounted());
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
    const out = renderMod(song, { sampleRate: 22050 });
    return withTransfer(out, [out.left.buffer, out.right.buffer]);
  },

  /** A sound by name, `SOUND\\<name>.WAV` with its `.KLP` loop points: `{ name, wav, klp }`, or null. */
  async sound({ name }) {
    if (!/^[A-Za-z0-9_.-]+$/.test(String(name))) throw new Error(`Bad sound name "${name}"`);
    const stem = name.replace(/\.wav$/i, "").toUpperCase();
    const vfs = await mounted();
    const wav = await vfs.read(`SOUND\\${stem}.WAV`);
    if (!wav) return null;
    const klp = await vfs.read(`SOUND\\${stem}.KLP`);
    const copy = wav.slice().buffer;
    return withTransfer({ name: stem, wav: copy, klp: klp ? parseKlp(klp) : null }, [copy]);
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
  async sky({ path, weather }) {
    const sky = await buildSky(await mounted(), path, weather);
    return sky ? withTransfer(sky, [sky.rgba.buffer]) : null;
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
