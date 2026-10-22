/*
  The game's message table (the TRI Message System, `.LOC`, MONSTER_EXE_ANALYSIS.md 17). Every
  on-screen string in the game is looked up by its English text, the tag; a loaded `.LOC`
  swaps some for other wording, and `<<1>>`, `<<2>>` stand for arguments. Without a table the
  tag itself shows. A tag may start with a context in brackets, `[lap count]Lap:`, where one English
  text needs two translations; without a table the context is left out. Pure, so it runs under Node.
*/

/**
 * @param {{ tag: string, text: string }[]} [messages] from OpenPhotex's parseLoc
 * @returns {(tag: string, ...args: unknown[]) => string}
 */
export function createStrings(messages = []) {
  const table = new Map();
  for (const { tag, text } of messages ?? []) if (!table.has(tag)) table.set(tag, text);
  return (tag, ...args) => {
    let text = table.get(tag) ?? String(tag).replace(/^\[[^\]]*\]/, "");
    args.forEach((arg, i) => { text = text.replaceAll(`<<${i + 1}>>`, String(arg)); });
    return text;
  };
}

/**
 * Marks English text as a tag without translating it yet: a label kept in a table and passed to `t()` where it is
 * shown. It returns the text unchanged; tools/lang-strings.mjs finds the tags in calls of `t` and `msg` with a literal.
 */
export const msg = (text) => text;

/** A readable name for a `.LOC` file in the install: MTM2-PIG.LOC is "Pig Latin". */
export function locName(path) {
  const stem = String(path).split(/[\\/]/).pop().replace(/\.loc$/i, "");
  const known = { "MTM2-FUN": "Fun", "MTM2-PIG": "Pig Latin", MTM2: "English" };
  return known[stem.toUpperCase()] ?? stem;
}
