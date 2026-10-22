/*
  Archives added beside the MTM2 install, as kept in OPFS (asset worker only).

    addons/f<n>/<NAME>         the archives of an added game folder, as its POD.INI lists them
    addons/m<n>/<NAME>         an archive added by hand in the POD manager
    addons/manifest.json       what is there, and the mount order of every archive

  OpenMTM2 reads tracks of Monster Truck Madness 1 and 2, CART Precision Racing and 4x4 Evolution
  1 and 2. A player may own a whole install (Add POD.INI: its POD.INI is read) or a few
  archives (the POD manager). Each archive is tagged with the game it comes from, read from the
  first track script it holds; an archive without one takes the game of the folder it came with.
  The tag sets the lookup family (worker/vfs.js), so same-named files of two games stay apart.

  The mount order is one list over the install's archives and the added ones (`order`, by mount
  key); an archive not in it yet comes after the listed ones.
*/
import { readFile, readTextFile, removePath, writeBytesToFile } from "../shared/opfs.js";
import { detectSitOrigin } from "../vendor/openphotex/mtm/sit.js";
import { isEvoSit, parseEvoSit } from "../vendor/openphotex/evo/sit.js";
import { parseTruckManifest } from "../vendor/openphotex/truck/manifest.js";
import { parseTvLvl } from "../vendor/openphotex/tv/lvl.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import { copyFile, installMounts, reapplyPodIni, unmountInstallArchive } from "./install-store.js";
import { indexPodFile, readPodEntryBytes } from "./pod-index.js";
import { createVfs, gameFamily } from "./vfs.js";

export const ADDON_DIR = "addons";
const MANIFEST = `${ADDON_DIR}/manifest.json`;
const MANIFEST_FORMAT = 1;

const empty = () => ({ format: MANIFEST_FORMAT, next: 1, archives: [], order: [] });

export async function readAddons() {
  try {
    const manifest = JSON.parse(await readTextFile(MANIFEST));
    return manifest?.format === MANIFEST_FORMAT ? manifest : empty();
  } catch {
    return empty();
  }
}

async function writeAddons(manifest) {
  await writeBytesToFile(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
}

export async function removeAddons() {
  await removePath(ADDON_DIR);
}

const isTrackScript = (entry) => /\.SI[T2]$/.test(entry.normalizedName);
/** A vehicle's manifest: an MTM or 4x4 Evolution truck (`TRUCK\*.TRK`) or a CART Precision Racing car (`VEHICLE\*.CAR`). */
const isVehicle = (entry) => /^(?:TRUCK[\\/][^\\/]+\.TRK|VEHICLE[\\/][^\\/]+\.CAR)$/.test(entry.normalizedName);

/** The game a track script comes from: "MTM1", "MTM2", "CPR", "EVO1" or "EVO2"; null when it cannot be told. */
export function sitGame(bytes, title) {
  try {
    if (isEvoSit(bytes)) return `EVO${parseEvoSit(bytes, title).game}`;
    const lines = new TextDecoder("latin1").decode(bytes).split(/\r\n|\r|\n/);
    return detectSitOrigin(lines, title) ?? null;
  } catch {
    return null;
  }
}

/**
 * The game of an archive, or null when it cannot be told, from what it holds (`read(entry)` gives an entry's bytes):
 *  - its first track script (`sitGame`);
 *  - else Terminal Velocity, Fury3 or Hellbender levels (`LEVELS\*.LVL`, OpenPhotex `parseTvLvl`): "TV" (the first two
 *    cannot be told apart) or "HB";
 *  - else its vehicles: a CART Precision Racing car (`VEHICLE\*.CAR`) makes it "CPR"; a truck (`TRUCK\*.TRK`) makes it
 *    "EVO1" or "EVO2", or for an MTM truck "MTM1" or "MTM2" by the manifest's own dialect. So an archive of trucks
 *    alone (an add-on truck, an Evolution TRUCK.POD, CPR's RACECAR.POD) is known for what it is.
 */
export async function detectArchiveGame(archive, read) {
  const entry = archive.entries.find(isTrackScript);
  if (entry) return sitGame(await read(entry), podPathTitle(entry.normalizedName));
  const inFolder = (folder, extension) => archive.entries.filter((e) => new RegExp(`^${folder}[\\\\/][^\\\\/]+\\.${extension}$`).test(e.normalizedName));
  for (const lvl of inFolder("LEVELS", "LVL").slice(0, 4)) {
    try {
      const level = parseTvLvl(await read(lvl));
      if (level.complete) return level.origin === "HB" ? "HB" : "TV";
    } catch { /* not a level of those games */ }
  }
  for (const car of inFolder("VEHICLE", "CAR").slice(0, 4)) {
    try { if (parseTruckManifest(await read(car), podPathTitle(car.normalizedName)).kind === "cpr-car") return "CPR"; } catch { /* not a car */ }
  }
  for (const trk of inFolder("TRUCK", "TRK").slice(0, 4)) {
    try {
      const parsed = parseTruckManifest(await read(trk), podPathTitle(trk.normalizedName));
      if (parsed.kind === "evo") return `EVO${parsed.manifest.game}`;
      if (parsed.kind === "mtm") return parsed.manifest.dialect === "MTM1" ? "MTM1" : "MTM2";
    } catch { /* not a truck */ }
  }
  return null;
}

const archiveGame = (file, archive) => detectArchiveGame(archive, (entry) => readPodEntryBytes(file, entry));

/** Copy one archive to `path` and describe it; throws when it is not a POD. */
async function store(file, path, name, onChunk) {
  await copyFile(file, path, onChunk);
  try {
    const stored = await readFile(path);
    const archive = await indexPodFile(stored);
    return { path, name, size: file.size, modified: file.lastModified ?? null, game: await archiveGame(stored, archive) };
  } catch (error) {
    await removePath(path);
    throw new Error(`${name} is not a POD archive (${error.message}).`);
  }
}

function progress(files, onProgress) {
  const total = files.reduce((sum, f) => sum + f.file.size, 0);
  let copied = 0;
  return (name) => (bytes) => { copied += bytes; onProgress({ copied, total, name }); };
}

/**
 * Add a game folder's archives, in its POD.INI order. A folder added before under the same name is replaced.
 * @param {{ label: string, files: { name: string, file: File }[] }} request `name` is the archive's path in the folder
 */
export async function addGameFolder({ label, files }, onProgress = () => {}) {
  const manifest = await readAddons();
  for (const old of manifest.archives.filter((a) => a.source === "folder" && a.label === label)) await removePath(old.path);
  manifest.archives = manifest.archives.filter((a) => !(a.source === "folder" && a.label === label));
  const slot = `f${manifest.next++}`;
  const chunk = progress(files, onProgress);
  const added = [];
  for (const { name, file } of files) {
    added.push({ ...(await store(file, `${ADDON_DIR}/${slot}/${name}`, name, chunk(name))), key: `${slot}:${name}`, source: "folder", label });
  }
  // Archives without a track (the game's own art, vehicles, sounds) belong to the folder's game.
  const game = added.find((a) => a.game)?.game ?? null;
  for (const a of added) a.game ??= game;
  manifest.archives.push(...added);
  await writeAddons(manifest);
  return { added: added.map((a) => a.name), game };
}

/**
 * Add archives picked by hand. One added by hand before under the same name is replaced, read afresh whatever its size
 * and date (a POD rebuilt under the same name), and keeps its place in the mount order.
 * @param {{ files: File[] }} request
 */
export async function addPods({ files }, onProgress = () => {}) {
  const manifest = await readAddons();
  const fresh = files.map((file) => ({ name: file.name.toUpperCase(), file }));
  const replaced = new Map();
  for (const { name } of fresh) {
    const old = manifest.archives.find((a) => a.source === "manual" && a.name === name);
    if (!old) continue;
    await removePath(old.path);
    manifest.archives = manifest.archives.filter((a) => a !== old);
    replaced.set(name, old.key);
  }
  const chunk = progress(fresh, onProgress);
  const added = [], failed = [];
  for (const { name, file } of fresh) {
    const slot = `m${manifest.next++}`;
    try {
      const key = `${slot}:${name}`;
      added.push({ ...(await store(file, `${ADDON_DIR}/${slot}/${name}`, name, chunk(name))), key, source: "manual", label: "" });
      // The archive it replaces keeps its place in the order.
      const before = replaced.get(name);
      if (before) manifest.order = manifest.order.map((k) => (k === before ? key : k));
    } catch (error) {
      failed.push(error.message);
    }
  }
  manifest.archives.push(...added);
  await writeAddons(manifest);
  return { added: added.map((a) => a.name), replaced: [...replaced.keys()], skipped: 0, failed };
}

/**
 * Remove an archive by its mount key: an added one is deleted, one of the install's is taken out of the mounts until
 * Reload POD.INI (worker/install-store.js `unmountInstallArchive`).
 */
export async function removePod(key) {
  if (key.startsWith("install:")) return unmountInstallArchive(key.slice("install:".length));
  const manifest = await readAddons();
  const archive = manifest.archives.find((a) => a.key === key);
  if (!archive) throw new Error("Only archives added to the install can be removed here.");
  await removePath(archive.path);
  manifest.archives = manifest.archives.filter((a) => a !== archive);
  manifest.order = manifest.order.filter((k) => k !== key);
  await writeAddons(manifest);
  return true;
}

/**
 * Reload POD.INI (worker/install-store.js `reapplyPodIni`): the install's archives all mounted again, first and in the
 * file's order; the added archives keep their order after them. Returns the archives that came back.
 */
export async function reloadPodIni() {
  const { keys, restored } = await reapplyPodIni();
  const manifest = await readAddons();
  manifest.order = [...keys, ...manifest.order.filter((key) => !key.startsWith("install:"))];
  await writeAddons(manifest);
  return { archives: keys.length, restored };
}

/** Store the mount order: every mount key, first mounted first. */
export async function setMountOrder(keys) {
  const manifest = await readAddons();
  manifest.order = [...keys];
  await writeAddons(manifest);
  return true;
}

/** `mounts` in the stored order; those the order does not list keep their place after the listed ones. */
export function orderMounts(mounts, order) {
  const rank = new Map(order.map((key, i) => [key, i]));
  return mounts.map((mount, i) => ({ mount, i })).sort((a, b) =>
    (rank.get(a.mount.key) ?? Infinity) - (rank.get(b.mount.key) ?? Infinity) || a.i - b.i).map(({ mount }) => mount);
}

/** Every archive mounted: the install's in POD.INI order, then the added ones, rearranged by the stored order. */
export async function mountAll(installManifest) {
  const [addons, mounts] = await Promise.all([readAddons(), installMounts(installManifest)]);
  let learned = false;
  // Each added archive is opened at once; they keep their stored order.
  const added = await Promise.all(addons.archives.map(async (a) => {
    try {
      const file = await readFile(a.path);
      const archive = await indexPodFile(file);
      // An archive stored before its kind could be told (trucks alone, another game's levels) is looked at again.
      if (!a.game) {
        a.game = await archiveGame(file, archive).catch(() => null);
        learned ||= !!a.game;
      }
      return {
        key: a.key, name: a.name, archive, readEntry: (entry) => readPodEntryBytes(file, entry), blob: () => file,
        family: gameFamily(a.game), game: a.game, source: a.source === "folder" ? `${a.label} folder` : "Added by hand", size: a.size, removable: true,
      };
    } catch { return null; /* an archive that no longer opens is left out */ }
  }));
  mounts.push(...added.filter(Boolean));
  if (learned) await writeAddons(addons).catch(() => {});
  return createVfs(orderMounts(mounts, addons.order));
}

/** The mounted archives for the POD manager, in mount order. */
export function describeMounts(vfs) {
  return vfs.allMounts.map((m) => ({
    key: m.key, name: m.name, game: m.game ?? null, source: m.source ?? "", format: m.archive.format ?? "",
    entries: m.archive.entries.length, tracks: m.archive.entries.filter(isTrackScript).length,
    trucks: m.archive.entries.filter(isVehicle).length, size: m.size ?? null, removable: !!m.removable, install: !!m.install,
  }));
}
