/*
  The announcer's lines as MONSTER.EXE holds them (MONSTER_EXE_ANALYSIS.md 12): each phrase's
  clip script is a string, and the English line that goes with it is the string right after.
  Read from the player's own executable when the game is installed, so no game text ships with
  the port. Pure, so it runs under Node.
*/

/** A clip script: only clip names, driver-name marks, commas and spaces, with at least one `.wav`. */
const SPEC = /^(?:[A-Za-z0-9_-]+\.wav|[()*]<<\d>>|[\s,])+$/i;

/** Every null-terminated printable ASCII string of at least `min` characters, in file order. */
export function asciiStrings(bytes, min = 4) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const b = i < bytes.length ? bytes[i] : 0;
    if (b >= 0x20 && b < 0x7f) {
      if (start < 0) start = i;
    } else {
      if (b === 0 && start >= 0 && i - start >= min) out.push(String.fromCharCode(...bytes.subarray(start, i)));
      start = -1;
    }
  }
  return out;
}

/** The announcer's table: `{ clipScript: englishLine }`. */
export function commentaryLines(bytes) {
  const strings = asciiStrings(bytes, 3);
  const table = {};
  for (let i = 0; i + 1 < strings.length; i++) {
    const spec = strings[i], text = strings[i + 1];
    if (!/\.wav/i.test(spec) || !SPEC.test(spec) || SPEC.test(text)) continue;
    if (!/[A-Za-z]{3}/.test(text) || /\.(wav|bin|raw|txt|act)\b/i.test(text)) continue;
    if (!(spec in table)) table[spec] = text;
  }
  return table;
}
