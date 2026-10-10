/*
  Look at a picked folder before copying anything: which of the archives POD.INI lists are
  present.
*/
import { parsePodIni, installPathKey } from "./pod-ini.js";
import { readExeVersion } from "./exe-version.js";

/**
 * An archive POD.INI lists. Installs differ in how the list is written (a drive letter, a
 * folder that is not the picked one), so when the path as written is missing the same file
 * name is looked for in the picked folder and its SYSTEM folder.
 */
export async function findArchive(source, path) {
  const base = String(path).replace(/\\/g, "/").split("/").pop();
  for (const candidate of [path, base, `SYSTEM/${base}`]) {
    const file = await source.getFile(candidate);
    if (file) return { path: candidate, file };
  }
  return null;
}

/**
 * The archives are the same in every retail build, so any folder with a POD.INI and its archives
 * will do; the executable is read only for its version (`exeVersion`, null when it is missing),
 * which decides whether the classic menu art fits (install/exe-version.js).
 * @param {{ getFile(path: string): Promise<File|null> }} source
 * @returns {Promise<{ ok: boolean, message: string, podIni?: string,
 *   files?: { name: string, file: File }[], missing?: string[], totalBytes?: number,
 *   warnings?: string[] }>}
 */
export async function inspectSource(source) {
  let exeVersion = null;
  try {
    const exe = (await source.getFile("MONSTER.EXE")) ?? (await source.getFile("SYSTEM/MONSTER.EXE"));
    if (exe) exeVersion = readExeVersion(new Uint8Array(await exe.arrayBuffer()));
  } catch { /* no version: the modern skin */ }

  // Names match without regard to case; some installs keep the file in SYSTEM.
  const iniFile = (await source.getFile("POD.INI")) ?? (await source.getFile("SYSTEM/POD.INI"));
  const ini = iniFile ? parsePodIni(await iniFile.text()) : { paths: [], warnings: [] };

  const files = [];
  const missing = [];
  for (const path of ini.paths) {
    const found = await findArchive(source, path);
    if (found) files.push({ name: installPathKey(found.path), file: found.file });
    else missing.push(path);
  }
  if (!iniFile) {
    return { ok: false, message: "This folder has no POD.INI, which lists the game's archives. "
      + "Pick the folder Monster Truck Madness 2 is installed in." };
  }
  // The copy keeps the paths where the archives were found, so the mount matches them.
  const podIni = `${files.length}\r\n${files.map((f) => f.name.toLowerCase()).join("\r\n")}\r\n`;
  if (files.length === 0) {
    return { ok: false, message: "None of the archives POD.INI lists are in this folder." };
  }
  const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);
  const warnings = [...ini.warnings];
  return {
    exeVersion,
    ok: missing.length === 0,
    message: missing.length === 0
      ? "Monster Truck Madness 2 found."
      : `Monster Truck Madness 2 found. Missing archives: ${missing.join(", ")}.`,
    podIni,
    files,
    missing,
    totalBytes,
    warnings,
  };
}

/**
 * Another game's folder (CART Precision Racing, 4x4 Evolution 1 or 2, or more of MTM), added beside
 * the install: the archives its POD.INI lists that are present. Without a POD.INI there is nothing
 * to go by; single archives go through the POD manager.
 * @param {{ name?: string, getFile(path: string): Promise<File|null> }} source
 * @returns {Promise<{ ok: boolean, message: string, label?: string, files?: { name: string, file: File }[], missing?: string[] }>}
 */
export async function inspectGameFolder(source) {
  const iniFile = (await source.getFile("POD.INI")) ?? (await source.getFile("SYSTEM/POD.INI"));
  if (!iniFile) {
    return { ok: false, message: "This folder has no POD.INI, which lists the game's archives. "
      + "To add single POD files, use the POD manager." };
  }
  const ini = parsePodIni(await iniFile.text());
  const files = [];
  const missing = [];
  for (const path of ini.paths) {
    const found = await findArchive(source, path);
    if (found) files.push({ name: installPathKey(found.path), file: found.file });
    else missing.push(path);
  }
  if (files.length === 0) return { ok: false, message: "None of the archives POD.INI lists are in this folder." };
  return { ok: true, message: "", label: source.name || "Game", files, missing };
}
