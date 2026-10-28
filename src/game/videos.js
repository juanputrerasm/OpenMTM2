/*
  The game's videos (MONSTER_EXE_ANALYSIS.md 2 and 5, "Results"): Smacker files under `VIDEOS\`, listed in the
  `[Video]` section of `SYSTEM\EXTRAS.INI`. `StartScene` plays at launch; after a race `Win` (first place), `Lose`
  (last) or `Other` (between), with `WCW` appended after a Summit Rumble, one of the list at random. Pure, so it runs
  under Node.
*/

/** A video's path as the install keeps it: upper case, forward slashes, no leading `.\`. */
export const videoPath = (path) => String(path ?? "").trim().replace(/\\/g, "/").replace(/^\.?\//, "").toUpperCase();

/**
 * The `[Video]` lists of an EXTRAS.INI: `{ StartScene: [...], Win: [...], ... }`, each path as `videoPath` gives it.
 * A list is its count key's entries (`Win=11`, `Win0` to `Win10`); without a count, its numbered keys from 0 while
 * they are there (0x4c51d0).
 */
export function parseVideoLists(text) {
  const values = new Map();
  let inVideo = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) { inVideo = section[1].trim().toLowerCase() === "video"; continue; }
    if (!inVideo) continue;
    const eq = line.indexOf("=");
    if (eq > 0) values.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
  }
  const lists = {};
  const names = new Set([...values.keys()].map((k) => k.replace(/\d+$/, "")));
  for (const lower of names) {
    const count = Number.parseInt(values.get(lower) ?? "", 10);
    const out = [];
    for (let i = 0; Number.isFinite(count) ? i < count : values.has(`${lower}${i}`); i++) {
      const path = values.get(`${lower}${i}`);
      if (path) out.push(videoPath(path));
    }
    if (out.length) lists[KEY_CASE[lower] ?? lower] = out;
  }
  return lists;
}

const KEY_CASE = Object.freeze({
  startscene: "StartScene", demo: "Demo", win: "Win", lose: "Lose", other: "Other", winwcw: "WinWCW", losewcw: "LoseWCW", otherwcw: "OtherWCW",
});

/** The list a race's video comes from: by the player's place among `count` trucks, the WCW one after a Summit Rumble. */
export function raceVideoKey(place, count, summit = false) {
  const key = place === 1 ? "Win" : place === count ? "Lose" : "Other";
  return summit ? `${key}WCW` : key;
}

/** One video of a list at random, among those `has(path)` says the install has; null when there is none. */
export function pickVideo(lists, key, has = () => true, random = Math.random) {
  const list = (lists?.[key] ?? []).filter((path) => has(path));
  return list.length ? list[Math.floor(random() * list.length)] : null;
}
