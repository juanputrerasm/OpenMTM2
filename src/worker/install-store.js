/*
  The install, as kept in OPFS (asset worker only).

    install/POD.INI            the player's POD.INI, as found
    install/<NAME>             each archive it lists, under its upper-cased relative path
    install/manifest.json      written last: its presence means the copy completed; `unmounted` lists the archives
                               the POD manager took out, which stay copied until Reload POD.INI mounts them again

  Copies use a synchronous access handle, which every browser supports in a dedicated worker
  (Safari offers no other way to write OPFS files).

  An archive comes as a File from the picked folder, or as `{ url, size }` when the folder is
  served over HTTP (install/url-source.js): then it is downloaded here and written as it arrives.
*/
import { getFileHandle, readFile, readTextFile, removePath, writeBytesToFile } from "../shared/opfs.js";
import { indexPodFile, readPodEntryBytes } from "./pod-index.js";
import { createVfs } from "./vfs.js";
import { parsePodIni } from "../install/pod-ini.js";
import { isRequiredPod } from "../install/required-pods.js";

export const INSTALL_DIR = "install";
const MANIFEST = `${INSTALL_DIR}/manifest.json`;
const MANIFEST_FORMAT = 1;
const CHUNK = 4 * 1024 * 1024;

export async function readManifest() {
  try {
    const manifest = JSON.parse(await readTextFile(MANIFEST));
    return manifest?.format === MANIFEST_FORMAT ? manifest : null;
  } catch {
    return null;
  }
}

async function writeManifest(manifest) {
  await writeBytesToFile(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
}

/**
 * Take one of the install's archives out of the mounts (the POD manager). Its copy stays, for Reload POD.INI. The
 * archives OpenMTM2 needs (install/required-pods.js) cannot be taken out.
 */
export async function unmountInstallArchive(name) {
  const manifest = await readManifest();
  if (!manifest?.archives.some((a) => a.name === name)) throw new Error(`${name} is not in the install.`);
  if (isRequiredPod(name)) throw new Error(`${name} is needed to run OpenMTM2 and cannot be removed.`);
  manifest.unmounted = [...new Set([...(manifest.unmounted ?? []), name])];
  await writeManifest(manifest);
  return true;
}

/**
 * Reload POD.INI: the POD.INI picked with the install, read again from its copy. Every archive it lists is mounted
 * again, the ones the POD manager took out included. Returns the install's mount keys in its order, and what came back.
 */
export async function reapplyPodIni() {
  const manifest = await readManifest();
  if (!manifest) throw new Error("There is no install to reload.");
  const restored = manifest.unmounted ?? [];
  delete manifest.unmounted;
  await writeManifest(manifest);
  const ini = parsePodIni(await readTextFile(`${INSTALL_DIR}/POD.INI`));
  const copied = new Set(manifest.archives.map((a) => a.name));
  return { keys: ini.keys.filter((name) => copied.has(name)).map((name) => `install:${name}`), restored };
}

export async function removeInstall() {
  await removePath(INSTALL_DIR);
}

/**
 * Copy the archives into OPFS, replacing any previous install.
 * @param {{ files: { name: string, file: Blob | { url: string, size: number } }[], podIni: string, edition?: "full" | "trial" }} request
 * @param {(progress: { copied: number, total: number, name: string }) => void} onProgress
 */
/** The WeatherArt folder's pictures (install/inspect-source.js `findWeatherArt`), copied afresh to `install/WEATHERART`. */
async function copyWeatherArt(weatherArt = []) {
  await removePath(`${INSTALL_DIR}/WEATHERART`);
  for (const { name, file } of weatherArt) await copyFile(file, `${INSTALL_DIR}/WEATHERART/${name.toUpperCase()}`, () => {});
}

export async function copyInstall({ files, podIni, exeVersion = null, weatherArt = [], edition = "full" }, onProgress) {
  await removeInstall();
  const total = files.reduce((sum, f) => sum + f.file.size, 0);
  let copied = 0;
  for (const { name, file } of files) {
    await copyFile(file, `${INSTALL_DIR}/${name}`, (bytes) => {
      copied += bytes;
      onProgress({ copied, total, name });
    });
  }
  await writeBytesToFile(`${INSTALL_DIR}/POD.INI`, new TextEncoder().encode(podIni));
  await copyWeatherArt(weatherArt);
  const manifest = {
    format: MANIFEST_FORMAT,
    archives: files.map(({ name, file }) => ({ name, size: file.size, modified: file.lastModified ?? null })),
    weatherArt: weatherArt.map(({ name }) => name.toUpperCase()),
    exeVersion,
    // "trial" for the MTM2 trial (install/required-pods.js `isTrialPodSet`), else "full".
    edition,
    installedAt: new Date().toISOString(),
  };
  await writeBytesToFile(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  return manifest;
}

/**
 * Reload POD.INI from the player's folder, picked again: archives it no longer lists are removed,
 * new or changed ones (by size or modification time) are copied, the rest stay as they are, and
 * the mount order becomes the new file's. `force` copies every archive again, whatever its size and
 * date (Reload POD.INI: a POD rebuilt with the same name, size and date is still read afresh).
 * Returns the manifest with `added`, `removed` and `kept` archive names.
 */
export async function syncInstall({ files, podIni, exeVersion = null, weatherArt = [], force = false, edition = "full" }, onProgress) {
  const old = await readManifest();
  const before = new Map((old?.archives ?? []).map((a) => [a.name, a]));
  const wanted = new Set(files.map((f) => f.name));
  const same = ({ name, file }) => {
    const had = before.get(name);
    return !!had && had.size === file.size && had.modified != null && had.modified === (file.lastModified ?? null);
  };
  const changed = force ? files : files.filter((f) => !same(f));
  const removed = [...before.keys()].filter((name) => !wanted.has(name));
  // No manifest while the copy runs: an interrupted reload reads as no install, not as a broken one.
  await removePath(MANIFEST);
  for (const name of removed) await removePath(`${INSTALL_DIR}/${name}`);
  const total = changed.reduce((sum, f) => sum + f.file.size, 0);
  let copied = 0;
  for (const { name, file } of changed) {
    await copyFile(file, `${INSTALL_DIR}/${name}`, (bytes) => {
      copied += bytes;
      onProgress({ copied, total, name });
    });
  }
  await writeBytesToFile(`${INSTALL_DIR}/POD.INI`, new TextEncoder().encode(podIni));
  await copyWeatherArt(weatherArt);
  const manifest = {
    format: MANIFEST_FORMAT,
    archives: files.map(({ name, file }) => ({ name, size: file.size, modified: file.lastModified ?? null })),
    weatherArt: weatherArt.map(({ name }) => name.toUpperCase()),
    exeVersion,
    // "trial" for the MTM2 trial (install/required-pods.js `isTrialPodSet`), else "full".
    edition,
    installedAt: new Date().toISOString(),
  };
  await writeBytesToFile(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  return { ...manifest, added: changed.map((f) => f.name), removed, kept: force ? [] : files.filter(same).map((f) => f.name) };
}

export async function copyFile(file, path, onChunk) {
  const handle = await getFileHandle(path, true);
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    const write = (chunk, at) => {
      access.write(chunk, { at });
      onChunk(chunk.length);
    };
    if (typeof file.url === "string") {
      await downloadInto(file, write);
    } else {
      for (let at = 0; at < file.size; at += CHUNK) {
        write(new Uint8Array(await file.slice(at, Math.min(at + CHUNK, file.size)).arrayBuffer()), at);
      }
    }
    access.flush();
  } finally {
    access.close();
  }
}

/**
 * Download a served archive, handing each piece to `write(bytes, at)` as it arrives. A download
 * that ends short of the size the server announced is an error, not an install.
 * @param {{ url: string, size: number }} file
 * @param {(chunk: Uint8Array, at: number) => void} write
 * @param {typeof fetch} [fetchFn]
 */
export async function downloadInto({ url, size }, write, fetchFn = globalThis.fetch) {
  const response = await fetchFn(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  let at = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      write(value, at);
      at += value.length;
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    write(bytes, 0);
    at = bytes.length;
  }
  if (size > 0 && at !== size) throw new Error(`${url} sent ${at} of ${size} bytes.`);
  return at;
}

/**
 * The copied archives as mounts, in POD.INI order. Archives the manifest does not record (missing
 * from the player's folder) are skipped, as the game would fail to mount them, and so are those the
 * POD manager took out (`unmounted`). Every archive but the required ones may be taken out.
 */
export async function installMounts(manifest) {
  const ini = parsePodIni(await readTextFile(`${INSTALL_DIR}/POD.INI`));
  const sizes = new Map(manifest.archives.map((a) => [a.name, a.size]));
  const unmounted = new Set(manifest.unmounted ?? []);
  // Each archive's directory is read at once; the mounts keep POD.INI's order.
  return Promise.all(ini.keys.filter((name) => sizes.has(name) && !unmounted.has(name)).map(async (name) => {
    const file = await readFile(`${INSTALL_DIR}/${name}`);
    const archive = await indexPodFile(file);
    return {
      key: `install:${name}`, name, archive, readEntry: (entry) => readPodEntryBytes(file, entry), blob: () => file,
      family: "MTM", game: "MTM2", source: "Base MTM2 install", size: sizes.get(name), removable: !isRequiredPod(name), install: true,
    };
  }));
}

export async function mountInstall(manifest) {
  return createVfs(await installMounts(manifest));
}
