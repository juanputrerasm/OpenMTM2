/*
  The install, as kept in OPFS (asset worker only).

    install/POD.INI            the player's POD.INI, as found
    install/<NAME>             each archive it lists, under its upper-cased relative path
    install/manifest.json      written last: its presence means the copy completed

  Copies use a synchronous access handle, which every browser supports in a dedicated worker
  (Safari offers no other way to write OPFS files).
*/
import { getFileHandle, readFile, readTextFile, removePath, writeBytesToFile } from "../shared/opfs.js";
import { indexPodFile, readPodEntryBytes } from "./pod-index.js";
import { createVfs } from "./vfs.js";
import { parsePodIni } from "../install/pod-ini.js";

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

export async function removeInstall() {
  await removePath(INSTALL_DIR);
}

/**
 * Copy the archives into OPFS, replacing any previous install.
 * @param {{ files: { name: string, file: File }[], podIni: string }} request
 * @param {(progress: { copied: number, total: number, name: string }) => void} onProgress
 */
export async function copyInstall({ files, podIni, exeVersion = null }, onProgress) {
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
  const manifest = {
    format: MANIFEST_FORMAT,
    archives: files.map(({ name, file }) => ({ name, size: file.size, modified: file.lastModified ?? null })),
    exeVersion,
    installedAt: new Date().toISOString(),
  };
  await writeBytesToFile(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  return manifest;
}

/**
 * Reload POD.INI from the player's folder, picked again: archives it no longer lists are removed,
 * new or changed ones (by size or modification time) are copied, the rest stay as they are, and
 * the mount order becomes the new file's. Returns the manifest with `added`, `removed` and `kept`
 * archive names.
 */
export async function syncInstall({ files, podIni, exeVersion = null }, onProgress) {
  const old = await readManifest();
  const before = new Map((old?.archives ?? []).map((a) => [a.name, a]));
  const wanted = new Set(files.map((f) => f.name));
  const same = ({ name, file }) => {
    const had = before.get(name);
    return !!had && had.size === file.size && had.modified != null && had.modified === (file.lastModified ?? null);
  };
  const changed = files.filter((f) => !same(f));
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
  const manifest = {
    format: MANIFEST_FORMAT,
    archives: files.map(({ name, file }) => ({ name, size: file.size, modified: file.lastModified ?? null })),
    exeVersion,
    installedAt: new Date().toISOString(),
  };
  await writeBytesToFile(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  return { ...manifest, added: changed.map((f) => f.name), removed, kept: files.filter(same).map((f) => f.name) };
}

export async function copyFile(file, path, onChunk) {
  const handle = await getFileHandle(path, true);
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    for (let at = 0; at < file.size; at += CHUNK) {
      const chunk = new Uint8Array(await file.slice(at, Math.min(at + CHUNK, file.size)).arrayBuffer());
      access.write(chunk, { at });
      onChunk(chunk.length);
    }
    access.flush();
  } finally {
    access.close();
  }
}

/**
 * The copied archives as mounts, in POD.INI order. Archives the manifest does not record (missing
 * from the player's folder) are skipped, as the game would fail to mount them.
 */
export async function installMounts(manifest) {
  const ini = parsePodIni(await readTextFile(`${INSTALL_DIR}/POD.INI`));
  const sizes = new Map(manifest.archives.map((a) => [a.name, a.size]));
  const mounts = [];
  for (const name of ini.keys) {
    if (!sizes.has(name)) continue;
    const path = `${INSTALL_DIR}/${name}`;
    const file = await readFile(path);
    const archive = await indexPodFile(file);
    mounts.push({
      key: `install:${name}`, name, archive, readEntry: (entry) => readPodEntryBytes(file, entry),
      family: "MTM", game: "MTM2", source: "MTM2 install", size: sizes.get(name), removable: false,
    });
  }
  return mounts;
}

export async function mountInstall(manifest) {
  return createVfs(await installMounts(manifest));
}
