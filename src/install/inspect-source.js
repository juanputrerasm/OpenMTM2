/*
  Look at a picked folder before copying anything: which build of the game it is, and which of
  the archives POD.INI lists are present.
*/
import { parsePodIni, installPathKey } from "./pod-ini.js";
import { inspectExe, classifyExe } from "./validate-exe.js";

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
 * @param {{ getFile(path: string): Promise<File|null> }} source
 * @returns {Promise<{ ok: boolean, message: string, build?: string, exe?: object,
 *   podIni?: string, files?: { name: string, file: File }[], missing?: string[],
 *   totalBytes?: number, warnings?: string[] }>}
 */
export async function inspectSource(source) {
  const exeFile = await source.getFile("MONSTER.EXE");
  if (!exeFile) {
    return { ok: false, message: "This folder has no MONSTER.EXE. Pick the folder Monster Truck Madness 2 is installed in." };
  }
  const exe = inspectExe(new Uint8Array(await exeFile.arrayBuffer()));
  const verdict = classifyExe(exe);
  if (!verdict.supported) return { ok: false, message: verdict.message, build: verdict.build, exe };

  // Names match without regard to case; some installs keep the file in SYSTEM.
  const iniFile = (await source.getFile("POD.INI")) ?? (await source.getFile("SYSTEM/POD.INI"));
  if (!iniFile) return { ok: false, message: "This folder has no POD.INI, which lists the game's archives." };
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
      ? verdict.message
      : `${verdict.message} Missing archives: ${missing.join(", ")}.`,
    build: verdict.build,
    exe,
    exeFile,
    podIni,
    files,
    missing,
    totalBytes,
    warnings: ini.warnings,
  };
}
