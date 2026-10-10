/*
  Archives added beside the MTM2 install, as kept in OPFS (asset worker only).

    addons/f<n>/<NAME>         the archives of an added game folder, as its POD.INI lists them
    addons/m<n>/<NAME>         an archive added by hand in the POD manager
    addons/manifest.json       what is there, and the mount order of every archive

  OpenMTM2 reads tracks of Monster Truck Madness 1 and 2, CART Precision Racing and 4x4 Evolution
  1 and 2. A player may own a whole install (Add game folder: its POD.INI is read) or a few
  archives (the POD manager). Each archive is tagged with the game it comes from, read from the
  first track script it holds; an archive without one takes the game of the folder it came with.
  The tag sets the lookup family (worker/vfs.js), so same-named files of two games stay apart.

  The mount order is one list over the install's archives and the added ones (`order`, by mount
  key); an archive not in it yet comes after the listed ones.
*/
import { readFile, readTextFile, removePath, writeBytesToFile } from "../shared/opfs.js";
import { detectSitOrigin, isEvoSit, parseEvoSit, podPathTitle } from "../vendor/openphotex/index.js";
import { copyFile, installMounts } from "./install-store.js";
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

/** The game of an archive, from its first track script, or null when it holds none. */
async function archiveGame(file, archive) {
  const entry = archive.entries.find(isTrackScript);
  if (!entry) return null;
  return sitGame(await readPodEntryBytes(file, entry), podPathTitle(entry.normalizedName));
}

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
 * Add archives picked by hand. One already there with the same name, size and date is left as it is.
 * @param {{ files: File[] }} request
 */
export async function addPods({ files }, onProgress = () => {}) {
  const manifest = await readAddons();
  const fresh = files.map((file) => ({ name: file.name.toUpperCase(), file })).filter(({ name, file }) =>
    !manifest.archives.some((a) => a.source === "manual" && a.name === name && a.size === file.size && a.modified === (file.lastModified ?? null)));
  const chunk = progress(fresh, onProgress);
  const added = [], failed = [];
  for (const { name, file } of fresh) {
    const slot = `m${manifest.next++}`;
    try {
      added.push({ ...(await store(file, `${ADDON_DIR}/${slot}/${name}`, name, chunk(name))), key: `${slot}:${name}`, source: "manual", label: "" });
    } catch (error) {
      failed.push(error.message);
    }
  }
  manifest.archives.push(...added);
  await writeAddons(manifest);
  return { added: added.map((a) => a.name), skipped: files.length - fresh.length, failed };
}

/** Remove an added archive by its mount key. */
export async function removePod(key) {
  const manifest = await readAddons();
  const archive = manifest.archives.find((a) => a.key === key);
  if (!archive) throw new Error("Only archives added to the install can be removed here.");
  await removePath(archive.path);
  manifest.archives = manifest.archives.filter((a) => a !== archive);
  manifest.order = manifest.order.filter((k) => k !== key);
  await writeAddons(manifest);
  return true;
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
  const addons = await readAddons();
  const mounts = await installMounts(installManifest);
  for (const a of addons.archives) {
    try {
      const file = await readFile(a.path);
      const archive = await indexPodFile(file);
      mounts.push({
        key: a.key, name: a.name, archive, readEntry: (entry) => readPodEntryBytes(file, entry),
        family: gameFamily(a.game), game: a.game, source: a.source === "folder" ? `${a.label} folder` : "Added by hand", size: a.size, removable: true,
      });
    } catch { /* an archive that no longer opens is left out */ }
  }
  return createVfs(orderMounts(mounts, addons.order));
}

/** The mounted archives for the POD manager, in mount order. */
export function describeMounts(vfs) {
  return vfs.allMounts.map((m) => ({
    key: m.key, name: m.name, game: m.game ?? null, source: m.source ?? "", format: m.archive.format ?? "",
    entries: m.archive.entries.length, tracks: m.archive.entries.filter(isTrackScript).length, size: m.size ?? null, removable: !!m.removable,
  }));
}
