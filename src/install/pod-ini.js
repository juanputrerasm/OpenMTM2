/*
  POD.INI: which archives the game mounts, in priority order.

  The game reads it with a number followed by that many names (MONSTER_EXE_ANALYSIS.md
  section 2), so whitespace of any kind separates tokens and line endings do not matter. The
  stock file is CRLF text with lowercase names ("19", "startup.pod", ...) while the files on
  disk are uppercase, so names are matched without regard to case. Paths may use backslashes
  ("system\startup.pod"); they are relative to the game folder.

  Order matters: when two archives hold the same path, the one listed first wins.
*/

/** Key used to compare relative paths: forward slashes, no leading slash, upper case. */
export function installPathKey(path) {
  return String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim().toUpperCase();
}

/**
 * @param {string} text the file's contents
 * @returns {{ declared: number, paths: string[], keys: string[], warnings: string[] }}
 */
export function parsePodIni(text) {
  // Control bytes count as whitespace: the stock file ends with a DOS end-of-file byte (0x1A).
  const tokens = String(text ?? "").split(/[\s\x00-\x1f]+/).filter(Boolean);
  const warnings = [];
  const declared = Number.parseInt(tokens[0] ?? "", 10);
  if (!Number.isFinite(declared) || declared < 0) {
    return { declared: 0, paths: [], keys: [], warnings: ["POD.INI does not start with a count"] };
  }
  const names = tokens.slice(1, 1 + declared);
  if (names.length < declared) {
    warnings.push(`POD.INI declares ${declared} archives but lists ${names.length}`);
  }
  if (tokens.length > 1 + declared) {
    warnings.push(`POD.INI has ${tokens.length - 1 - declared} entries beyond its count; ignored`);
  }
  const paths = [];
  const keys = [];
  for (const name of names) {
    const key = installPathKey(name);
    if (keys.includes(key)) {
      warnings.push(`POD.INI lists ${name} twice; the first one is used`);
      continue;
    }
    paths.push(name.replace(/\\/g, "/"));
    keys.push(key);
  }
  return { declared, paths, keys, warnings };
}

/** The fallback list the game mounts when POD.INI is missing (a development layout). */
export const DEFAULT_POD_LIST = Object.freeze([
  "system/startup.pod", "system/truck.pod", "system/game.pod", "system/ui.pod",
]);
