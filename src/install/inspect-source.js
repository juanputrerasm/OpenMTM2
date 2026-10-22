/*
  Look at a picked folder before copying anything: which of the archives POD.INI lists are
  present.
*/
import { parsePodIni, installPathKey } from "./pod-ini.js";
import { readExeVersion } from "./exe-version.js";
import { msg } from "../game/strings.js";
import { isTrialPodSet, missingRequiredPods, podFileName, podRole, REQUIRED_PODS, requiredPodsParts } from "./required-pods.js";

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

/** The skies Community Patch 3 reads from a loose WeatherArt folder (worker/weather-art.js), probed where a source cannot list. */
export const WEATHER_ART_STEMS = Object.freeze(["CCLOUDS", "CLOUDY2", "DUSKSKY", "NITESKY"]);

/**
 * The pictures in the folder's WeatherArt folder (any case), `{ name, file }` with `name` the upper-case file name: every
 * PNG and TGA there where the source can list its files, else the known skies.
 */
export async function findWeatherArt(source) {
  const found = [];
  const listed = source.list ? await source.list() : null;
  if (listed) {
    for (const path of listed) {
      const match = /^WEATHERART\/([^/]+\.(?:PNG|TGA))$/i.exec(path);
      const file = match && await source.getFile(path);
      if (file) found.push({ name: match[1].toUpperCase(), file });
    }
    return found;
  }
  for (const stem of WEATHER_ART_STEMS) {
    for (const extension of ["PNG", "TGA"]) {
      const file = await source.getFile(`WeatherArt/${stem}.${extension}`);
      if (file) { found.push({ name: `${stem}.${extension}`, file }); break; }
    }
  }
  return found;
}

/**
 * The archives are the same in every retail build, so any folder with a POD.INI and its archives
 * will do; the executable is read only for its version (`exeVersion`, null when it is missing),
 * which decides whether the classic menu art fits (install/exe-version.js).
 * @param {{ getFile(path: string): Promise<File|null> }} source
 * @returns {Promise<{ ok: boolean, message: string, podIni?: string,
 *   files?: { name: string, file: File }[], missing?: string[], totalBytes?: number,
 *   warnings?: string[], weatherArt?: { name: string, file: File }[] }>}
 */
export async function inspectSource(source) {
  let exeVersion = null;
  try {
    const exe = await findExe(source);
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
  // A disc image or the trial has no POD.INI (the game's setup writes it): its archives are found by name instead.
  if (!iniFile) files.push(...await listedArchives(source));
  if (!iniFile && !files.length) {
    return { ok: false, message: msg("This folder has no POD.INI, which lists the game's archives. Pick the folder Monster Truck Madness 2 is installed in.") };
  }
  // The copy keeps the paths where the archives were found, so the mount matches them.
  const podIni = `${files.length}\r\n${files.map((f) => f.name.toLowerCase()).join("\r\n")}\r\n`;
  if (files.length === 0) {
    return { ok: false, message: msg("None of the archives POD.INI lists are in this folder.") };
  }
  // Without the archives OpenMTM2 needs (install/required-pods.js) there is nothing to install.
  const required = missingRequiredPods(files.map((f) => f.name));
  if (required.length) {
    const [message, ...messageArgs] = requiredPodsParts(required);
    return { ok: false, message, messageArgs, required };
  }
  const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);
  const warnings = [...ini.warnings];
  const weatherArt = await findWeatherArt(source).catch(() => []);
  return {
    exeVersion,
    weatherArt,
    edition: isTrialPodSet(files.map((f) => f.name)) ? "trial" : "full",
    ok: missing.length === 0,
    message: missing.length === 0
      ? (isTrialPodSet(files.map((f) => f.name)) ? msg("Monster Truck Madness 2 Trial found.") : msg("Monster Truck Madness 2 found."))
      : msg("Monster Truck Madness 2 found. Missing archives: <<1>>."),
    // The figures the message's <<1>> stands for: it is shown as `t(message, ...messageArgs)` (game/strings.js).
    messageArgs: missing.length === 0 ? [] : [missing.join(", ")],
    podIni,
    files,
    missing,
    totalBytes,
    warnings,
  };
}

/** MONSTER.EXE where the folder or image has it (the trial's is MONSTERX.EXE), or null. */
async function findExe(source) {
  for (const path of ["MONSTER.EXE", "SYSTEM/MONSTER.EXE", "MONSTERX.EXE"]) {
    const file = await source.getFile(path);
    if (file) return file;
  }
  const listed = source.list ? await source.list() : [];
  const path = listed.find((p) => /(^|\/)MONSTERX?\.EXE$/i.test(p));
  return path ? source.getFile(path) : null;
}

/**
 * Every archive a source without POD.INI lists, each file name once (the shallowest path wins), in the order the game's
 * own POD.INI mounts the archives OpenMTM2 needs, then the rest by name. Each is `{ name, file }` with `name` the
 * upper-case file name, which is what the copy and the POD.INI written for it use.
 */
export async function listedArchives(source) {
  const listed = source.list ? await source.list() : [];
  const byName = new Map();
  for (const path of listed.filter((p) => /\.POD$/i.test(p)).sort((a, b) => a.split("/").length - b.split("/").length)) {
    const name = podFileName(path);
    if (!byName.has(name)) byName.set(name, path);
  }
  const rank = (name) => {
    const at = REQUIRED_PODS.indexOf(podRole(name));
    return at < 0 ? REQUIRED_PODS.length : at;
  };
  const names = [...byName.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const out = [];
  for (const name of names) {
    const file = await source.getFile(byName.get(name));
    if (file) out.push({ name, file });
  }
  return out;
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
    return { ok: false, message: msg("This folder has no POD.INI, which lists the game's archives. To add single POD files, use the POD manager.") };
  }
  const ini = parsePodIni(await iniFile.text());
  const files = [];
  const missing = [];
  for (const path of ini.paths) {
    const found = await findArchive(source, path);
    if (found) files.push({ name: installPathKey(found.path), file: found.file });
    else missing.push(path);
  }
  if (files.length === 0) return { ok: false, message: msg("None of the archives POD.INI lists are in this folder.") };
  return { ok: true, message: "", label: source.name || "Game", files, missing };
}
