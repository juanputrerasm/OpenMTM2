/*
  Look at a picked folder before copying anything: which of the archives POD.INI lists are
  present.
*/
import { parsePodIni, installPathKey } from "./pod-ini.js";

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
 * The executable is not looked at: the archives are the same in every retail build, so any
 * folder with a POD.INI and its archives will do.
 * @param {{ getFile(path: string): Promise<File|null> }} source
 * @returns {Promise<{ ok: boolean, message: string, podIni?: string,
 *   files?: { name: string, file: File }[], missing?: string[], totalBytes?: number,
 *   warnings?: string[] }>}
 */
export async function inspectSource(source) {
  // Names match without regard to case; some installs keep the file in SYSTEM.
  const iniFile = (await source.getFile("POD.INI")) ?? (await source.getFile("SYSTEM/POD.INI"));
  if (!iniFile) {
    return { ok: false, message: "This folder has no POD.INI, which lists the game's archives. "
      + "Pick the folder Monster Truck Madness 2 is installed in." };
  }
  const ini = parsePodIni(await iniFile.text());

  const files = [];
  const missing = [];
  for (const path of ini.paths) {
    const found = await findArchive(source, path);
    if (found) files.push({ name: installPathKey(found.path), file: found.file });
    else missing.push(path);
  }
  // The copy keeps the paths where the archives were found, so the mount matches them.
  const podIni = `${files.length}\r\n${files.map((f) => f.name.toLowerCase()).join("\r\n")}\r\n`;
  if (files.length === 0) {
    return { ok: false, message: "None of the archives POD.INI lists are in this folder." };
  }
  const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);
  return {
    ok: missing.length === 0,
    message: missing.length === 0
      ? "Monster Truck Madness 2 found."
      : `Monster Truck Madness 2 found. Missing archives: ${missing.join(", ")}.`,
    podIni,
    files,
    missing,
    totalBytes,
    warnings: ini.warnings,
  };
}
