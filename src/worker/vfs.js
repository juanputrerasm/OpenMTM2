/*
  The game's file system: PODs mounted in POD.INI order (MONSTER_EXE_ANALYSIS.md section 2).

  A path is looked up upper-cased and compared exactly with every entry of every POD, in mount
  order; the first match wins. Only if no POD has it would the game open a loose file, and
  OpenMTM2 copies no loose files, so a miss is a miss.

  Archives of other games can be mounted beside MTM2's (worker/addon-store.js). Each mount has a
  `family` ("MTM", "CPR", "EVO1", "EVO2" or "" when unknown; "MTM" when it states none), and a
  lookup goes through the mounts of one family first, in mount order, then through the rest: a
  CPR or Evo archive never shadows an MTM2 file of the same name, whatever the order. The VFS
  itself looks up for "MTM"; `scoped(family)` is the same VFS for another game's track.

  This module is pure: a mount is `{ name, archive, readEntry(entry), family? }`, where `archive`
  is an OpenPhotex PodArchive and `readEntry` resolves to the entry's bytes. The asset worker
  builds mounts from OPFS; tests build them from synthetic PODs.
*/
import { normalizePodPath } from "../vendor/openphotex/index.js";

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

  function view(family) {
    if (views.has(family)) return views.get(family);
    const tables = [...allTables.filter((t) => familyOf(t.mount) === family), ...allTables.filter((t) => familyOf(t.mount) !== family)];

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
     * that wins it, in lookup order then directory order.
     */
    function list(extension) {
      const ext = extension.toUpperCase();
      const seen = new Set();
      const out = [];
      for (const { mount, byPath } of tables) {
        for (const [path, entry] of byPath) {
          if (!path.endsWith(ext) || seen.has(path)) continue;
          seen.add(path);
          out.push({ path, mount, entry });
        }
      }
      return out;
    }

    /** `mounts` is this view's lookup order; `allMounts` the mount order as the player set it. */
    const made = { family, mounts: tables.map((t) => t.mount), allMounts: mounts, find, read, list, scoped: view };
    views.set(family, made);
    return made;
  }

  return view(DEFAULT_FAMILY);
}
