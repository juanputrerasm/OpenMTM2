/*
  The game's message table (the TRI Message System, `.LOC`, MONSTER_EXE_ANALYSIS.md 17). Every
  on-screen string in the game is looked up by its English text, the tag; a loaded `.LOC`
  swaps some for other wording, and `<<1>>`, `<<2>>` stand for arguments. Without a table the
  tag itself shows. Pure, so it runs under Node.
*/

/**
 * @param {{ tag: string, text: string }[]} [messages] from OpenPhotex's parseLoc
 * @returns {(tag: string, ...args: unknown[]) => string}
 */
export function createStrings(messages = []) {
  const table = new Map();
  for (const { tag, text } of messages ?? []) if (!table.has(tag)) table.set(tag, text);
  return (tag, ...args) => {
    let text = table.get(tag) ?? tag;
    args.forEach((arg, i) => { text = text.replaceAll(`<<${i + 1}>>`, String(arg)); });
    return text;
  };
}

/** A readable name for a `.LOC` file in the install: MTM2-PIG.LOC is "Pig Latin". */
export function locName(path) {
  const stem = String(path).split(/[\\/]/).pop().replace(/\.loc$/i, "");
  const known = { "MTM2-FUN": "Fun", "MTM2-PIG": "Pig Latin", MTM2: "English" };
  return known[stem.toUpperCase()] ?? stem;
}
