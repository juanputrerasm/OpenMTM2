/*
  The tracks and trucks an install offers.

  Like the game's CRace::init (MONSTER_EXE_ANALYSIS.md section 3), every `.SIT` and every
  `.TRK` in the mounted PODs is content: there is no registry. The game hides WAR.SIT
  "Torture Pit" (unlocked on Sidewinder Canyon) and GRAVEY.SIT "The Graveyard"
  (showHiddenTrack), and CHUCK.TRK (the CHUCK cheat) when an add-on POD supplies it: the
  retail PODs contain no CHUCK.TRK.

  Pure: it reads through a VFS (see vfs.js) and returns plain data.
*/
import { parseMtmSit, parseTruckManifest, podPathTitle } from "../vendor/openphotex/index.js";

export const HIDDEN_TRACKS = Object.freeze(["WAR.SIT", "GRAVEY.SIT"]);
export const HIDDEN_TRUCKS = Object.freeze(["CHUCK.TRK"]);

/** Race types by the SIT's track type code (MONSTER_EXE_ANALYSIS.md section 6). */
export const RACE_TYPES = Object.freeze({ 1: "drag", 2: "circuit", 3: "rally", 4: "summit" });

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @returns {Promise<{ tracks: object[], trucks: object[], problems: string[] }>}
 */
export async function buildCatalog(vfs) {
  const problems = [];
  const tracks = [];
  for (const { path, mount } of vfs.list(".SIT")) {
    try {
      const sit = parseMtmSit(await vfs.read(path), podPathTitle(path));
      if (sit.origin !== "MTM2") continue;
      const file = podPathTitle(path);
      tracks.push({
        path,
        pod: mount.name,
        file,
        name: sit.trackName || file,
        locale: sit.localeName,
        typeCode: sit.trackTypeCode,
        raceType: RACE_TYPES[sit.trackTypeCode] ?? "unsupported",
        weatherMask: sit.weatherMask,
        ambientSound: sit.ambientSound,
        level: sit.lvlName,
        hidden: HIDDEN_TRACKS.includes(file),
      });
    } catch (err) {
      problems.push(`${path}: ${err.message}`);
    }
  }
  const trucks = [];
  for (const { path, mount } of vfs.list(".TRK")) {
    try {
      const parsed = parseTruckManifest(await vfs.read(path), podPathTitle(path));
      if (parsed.kind !== "mtm") continue;
      const file = podPathTitle(path);
      trucks.push({
        path,
        pod: mount.name,
        file,
        name: parsed.manifest.truckName || file,
        dialect: parsed.manifest.dialect,
        hidden: HIDDEN_TRUCKS.includes(file),
      });
    } catch (err) {
      problems.push(`${path}: ${err.message}`);
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return { tracks: tracks.sort(byName), trucks: trucks.sort(byName), problems };
}
