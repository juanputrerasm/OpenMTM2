/*
  The game's file system: PODs mounted in POD.INI order (MONSTER_EXE_ANALYSIS.md section 2).

  A path is looked up upper-cased and compared exactly with every entry of every POD, in mount
  order; the first match wins. Only if no POD has it would the game open a loose file, and
  OpenMTM2 copies no loose files, so a miss is a miss.

  This module is pure: a mount is `{ name, archive, readEntry(entry) }`, where `archive` is an
  OpenPhotex PodArchive and `readEntry` resolves to the entry's bytes. The asset worker builds
  mounts from OPFS; tests build them from synthetic PODs.
*/
import { normalizePodPath } from "../vendor/openphotex/index.js";

/**
 * @param {{ name: string, archive: object, readEntry: (entry: object) => Promise<Uint8Array> }[]} mounts
 */
export function createVfs(mounts) {
  // One map per mount, built once: lookups are hot (every texture, model and sound).
  const tables = mounts.map((mount) => {
    const byPath = new Map();
    for (const entry of mount.archive.entries) {
      if (!byPath.has(entry.normalizedName)) byPath.set(entry.normalizedName, entry);
    }
    return { mount, byPath };
  });

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
   * that wins it, in mount order then directory order.
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

  return { mounts, find, read, list };
}
