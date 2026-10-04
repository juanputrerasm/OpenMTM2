/*
  Look at a picked folder before copying anything: which build of the game it is, and which of
  the archives POD.INI lists are present.
*/
import { parsePodIni, installPathKey } from "./pod-ini.js";
import { inspectExe, classifyExe } from "./validate-exe.js";

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

  const iniFile = await source.getFile("POD.INI");
  if (!iniFile) return { ok: false, message: "This folder has no POD.INI, which lists the game's archives." };
  const podIni = await iniFile.text();
  const ini = parsePodIni(podIni);

  const files = [];
  const missing = [];
  for (const path of ini.paths) {
    const file = await source.getFile(path);
    if (file) files.push({ name: installPathKey(path), file });
    else missing.push(path);
  }
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
    podIni,
    files,
    missing,
    totalBytes,
    warnings: ini.warnings,
  };
}
