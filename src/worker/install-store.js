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
 * @param {{ files: { name: string, file: File }[], podIni: string, build: string, exe: object }} request
 * @param {(progress: { copied: number, total: number, name: string }) => void} onProgress
 */
export async function copyInstall({ files, podIni, build, exe, exeFile }, onProgress) {
  await removeInstall();
  const total = files.reduce((sum, f) => sum + f.file.size, 0);
  let copied = 0;
  for (const { name, file } of files) {
    await copyFile(file, `${INSTALL_DIR}/${name}`, (bytes) => {
      copied += bytes;
      onProgress({ copied, total, name });
    });
  }
  // The executable too: the announcer's English lines are in it (src/worker/exe-strings.js).
  if (exeFile) await copyFile(exeFile, `${INSTALL_DIR}/MONSTER.EXE`, () => {});
  await writeBytesToFile(`${INSTALL_DIR}/POD.INI`, new TextEncoder().encode(podIni));
  const manifest = {
    format: MANIFEST_FORMAT,
    build,
    exe: { size: exe.size, timeDateStamp: exe.timeDateStamp, fileVersion: exe.fileVersion },
    archives: files.map(({ name, file }) => ({ name, size: file.size })),
    installedAt: new Date().toISOString(),
  };
  await writeBytesToFile(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
  return manifest;
}

async function copyFile(file, path, onChunk) {
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
 * Mount the copied archives in POD.INI order. Archives the manifest does not record (missing
 * from the player's folder) are skipped, as the game would fail to mount them.
 */
export async function mountInstall(manifest) {
  const ini = parsePodIni(await readTextFile(`${INSTALL_DIR}/POD.INI`));
  const present = new Set(manifest.archives.map((a) => a.name));
  const mounts = [];
  for (const name of ini.keys) {
    if (!present.has(name)) continue;
    const path = `${INSTALL_DIR}/${name}`;
    const file = await readFile(path);
    const archive = await indexPodFile(file);
    mounts.push({ name, archive, readEntry: (entry) => readPodEntryBytes(file, entry) });
  }
  return createVfs(mounts);
}
