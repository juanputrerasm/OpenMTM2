/*
  The jukebox's playlist: the mounted music (worker/jukebox-list.js) in the player's own order, some pieces skipped,
  played one after another in the menus and in races in place of the game's music (audio/jukebox.js).

  Kept in this browser apart from the settings (`openmtm2.jukebox`): the jukebox acts at once, while the Options
  dialog edits a draft of the settings that its Save would put back over a change made meanwhile.

  Pure but for the guarded storage, so it runs under Node in tests.
*/

const KEY = "openmtm2.jukebox";

/** What the jukebox keeps: on (it plays in place of the game's music), the order, the skipped pieces, the last one. */
export const DEFAULT_JUKEBOX = Object.freeze({ on: false, order: [], skip: [], current: null });

export function loadJukebox(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? "{}");
    const ids = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
    return { on: saved.on === true, order: ids(saved.order), skip: ids(saved.skip), current: typeof saved.current === "string" ? saved.current : null };
  } catch {
    return { ...DEFAULT_JUKEBOX, order: [], skip: [] };
  }
}

export function saveJukebox(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify({ on: !!state.on, order: state.order, skip: state.skip, current: state.current ?? null }));
  } catch {
    // Not kept; the session plays on with what it has.
  }
}

/** The mounted entries in the saved order: those saved first, as saved, then the ones not saved yet, as listed. */
export function orderedEntries(entries, order = []) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const placed = order.filter((id) => byId.has(id));
  const seen = new Set(placed);
  return [...placed, ...entries.map((entry) => entry.id).filter((id) => !seen.has(id))].map((id) => byId.get(id));
}

/** `ids` with the one at `from` moved to `to` (clamped to the list). */
export function moveEntry(ids, from, to) {
  const out = [...ids];
  const [moved] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, moved);
  return out;
}

/** The pieces that play, in order. */
export const jukeboxQueue = (ids, skipped) => ids.filter((id) => !skipped.has(id));

/**
 * The piece after (`step` 1) or before (-1) `current` that is not skipped, round the list; the first one when `current`
 * is null or no longer listed; null when every piece is skipped.
 */
export function nextPlayable(ids, skipped, current, step = 1) {
  const queue = jukeboxQueue(ids, skipped);
  if (!queue.length) return null;
  const at = ids.indexOf(current);
  if (current === null || at < 0) return queue[0];
  for (let k = 1; k <= ids.length; k++) {
    const id = ids[(((at + step * k) % ids.length) + ids.length) % ids.length];
    if (!skipped.has(id)) return id;
  }
  return null;
}
