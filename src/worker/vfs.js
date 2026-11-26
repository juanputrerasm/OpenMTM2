/*
  The game's file system: PODs mounted in POD.INI order (MONSTER_EXE_ANALYSIS.md section 2).

  A path is looked up upper-cased and compared exactly with every entry of every POD, in mount
  order; the first match wins. Only if no POD has it would the game open a loose file, and
  OpenMTM2 copies no loose files, so a miss is a miss.

  Archives of other games can be mounted beside MTM2's (worker/addon-store.js). Each mount has a
  `family` ("MTM", "CPR", "EVO1", "EVO2", "TV" (Terminal Velocity and Fury3), "HB" or "" when unknown; "MTM" when it states none), and a
  lookup goes through the mounts of one family first, in mount order, then through the rest: a
  CPR or Evo archive never shadows an MTM2 file of the same name, whatever the order. The VFS
  itself looks up for "MTM"; `scoped(family)` is the same VFS for another game's track, and `preferGame(game)` puts one
  game's archives first within the family (an MTM1 truck kept apart from MTM2's same-named one).

  This module is pure: a mount is `{ name, archive, readEntry(entry), family? }`, where `archive`
  is an OpenPhotex PodArchive and `readEntry` resolves to the entry's bytes. The asset worker
  builds mounts from OPFS; tests build them from synthetic PODs.
*/
import { normalizePodPath } from "../vendor/openphotex/pod/paths.js";

export const DEFAULT_FAMILY = "MTM";

/** The lookup family of a detected game: MTM1 and MTM2 share their archives. */
export function gameFamily(game) {
  return game === "MTM1" || game === "MTM2" ? "MTM" : game ?? "";
}

/**
 * @param {{ name: string, archive: object, readEntry: (entry: object) => Promise<Uint8Array>, family?: string }[]} mounts
 */
export function createVfs(mounts) {
  // One map per mount, built once: lookups are hot (every texture, model and sound).
  const allTables = mounts.map((mount) => {
    const byPath = new Map();
    for (const entry of mount.archive.entries) {
      if (!byPath.has(entry.normalizedName)) byPath.set(entry.normalizedName, entry);
    }
    return { mount, byPath };
  });
  const familyOf = (mount) => mount.family ?? DEFAULT_FAMILY;
  const views = new Map();

  function view(family, game = null, first = null) {
    const key = `${family}|${game ?? ""}|${first ?? ""}`;
    if (views.has(key)) return views.get(key);
    let tables = [...allTables.filter((t) => familyOf(t.mount) === family), ...allTables.filter((t) => familyOf(t.mount) !== family)];
    // One game's archives ahead of the rest of its family (`preferGame`): MTM1's before MTM2's, though both are "MTM".
    if (game) tables = [...tables.filter((t) => t.mount.game === game), ...tables.filter((t) => t.mount.game !== game)];
    // One archive ahead of all (`preferMount`), then the rest as above.
    if (first) tables = [...tables.filter((t) => t.mount.name === first), ...tables.filter((t) => t.mount.name !== first)];

    /** `{ mount, entry }` for a path, or null. */
    function find(path) {
      const key = normalizePodPath(path);
      for (const { mount, byPath } of tables) {
        const entry = byPath.get(key);
        if (entry) return { mount, entry, path: key };
      }
      return null;
    }

    async function read(path) {
      const hit = find(path);
      return hit ? hit.mount.readEntry(hit.entry) : null;
    }

    /**
     * Every visible path with the given extension (".SIT"), each once, resolved to the mount
     * that wins it, in lookup order then directory order. `extension` may be a list: the paths with any of them, in
     * one pass, so an archive's `.SIT`, `.SI2` and `.SI3` keep their order among themselves.
     */
    function list(extension) {
      const exts = (Array.isArray(extension) ? extension : [extension]).map((e) => e.toUpperCase());
      const seen = new Set();
      const out = [];
      for (const { mount, byPath } of tables) {
        for (const [path, entry] of byPath) {
          if (!exts.some((ext) => path.endsWith(ext)) || seen.has(path)) continue;
          seen.add(path);
          out.push({ path, mount, entry });
        }
      }
      return out;
    }

    /** `mounts` is this view's lookup order; `allMounts` the mount order as the player set it. */
    const made = {
      family, mounts: tables.map((t) => t.mount), allMounts: mounts, find, read, list, scoped: (other) => view(other),
      /** The same VFS with the archives of one game (`mount.game`, "MTM1") looked through first. */
      preferGame: (other) => view(family, other, first),
      /** The same VFS with one archive (by `mount.name`) looked through first. */
      preferMount: (name) => view(family, game, name),
    };
    views.set(key, made);
    return made;
  }

  return view(DEFAULT_FAMILY);
}
