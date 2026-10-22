/*
  Starting without a server (docs/ARCHITECTURE.md, "Without a server").

  The game's data is in the browser's own storage from the day it is installed; what still came
  from a server at every start was the app itself. This keeps a copy of the app in the browser
  too, so that the same address opens it with no server and no network: a headset that was on
  a cable once (docs/VR.md, "Running it on a headset"), or any browser gone offline.

  Two parts. The service worker (sw.js, at the site's root) answers from the copy when the
  network fails, and only then. This module makes the copy: at each start it walks the app's
  files from the page (shared/app-files.js), fetches every one from the server, and stores them
  in a new cache; only when all are in does it point the worker at that cache and drop the one
  before, never a cache another tab is still filling. So the copy is always one complete set of
  files as a server gave them, and a start that fails halfway (the server stopped, the page was
  closed) leaves the last one in place.

  The app's own files are fetched past the worker (the header below) and past the browser's
  cache, so the copy is the server's word. Files from another site (three.js from its CDN) keep
  their version in their address: when that site cannot be reached, the ones already kept are
  carried over.
*/
import { crawl, kindOf } from "../shared/app-files.js";
import { createStrings } from "../game/strings.js";

/** The header on the requests that make the copy; sw.js leaves those alone. */
export const COPYING = "x-openmtm2-offline";

/**
 * The names the copy goes by, for the app at `root` (its page's folder, ending in "/"): the
 * cache and address where the pointer to the complete copy is, what every copy's cache name
 * begins with, and the mark on a copy that is still being filled. sw.js has the first two.
 */
export function offlineNames(root) {
  return {
    pointerCache: `openmtm2-offline|${root}`,
    pointerUrl: `${root}__offline__`,
    copyPrefix: `openmtm2-app|${root}|`,
    buildingPrefix: `openmtm2-building|${root}|`,
  };
}

/** The copy now kept: `{ cache, files, savedAt }`, or null. */
export async function offlineCopy(root, cacheStorage = globalThis.caches) {
  const names = offlineNames(root);
  const pointer = await cacheStorage.match(names.pointerUrl, { cacheName: names.pointerCache });
  if (!pointer) return null;
  try {
    const copy = await pointer.json();
    return typeof copy?.cache === "string" && (await cacheStorage.has(copy.cache)) ? copy : null;
  } catch {
    return null;
  }
}

/** Where the browser has no Web Locks: the work on each copy waits its turn, in this page at least. */
const queues = new Map();

/**
 * Run `work` once no other work on the copy at `root` is under way. With Web Locks, that is
 * every tab, and `work` is the only writer. Without them, it is this page only: another tab
 * has its own queue, so `work` must not drop a cache that tab is still filling.
 * @param {(exclusive: boolean) => Promise<unknown>} work
 */
function oneAtATime(root, work, locks = globalThis.navigator?.locks) {
  const name = `${offlineNames(root).pointerCache}|lock`;
  if (locks?.request) return locks.request(name, () => work(true));
  const turn = (queues.get(name) ?? Promise.resolve()).then(() => work(false));
  const done = turn.catch(() => {});
  queues.set(name, done);
  done.then(() => { if (queues.get(name) === done) queues.delete(name); });
  return turn;
}

/** The cache that marks one copy as still being filled. */
function markName(names, id) {
  return `${names.buildingPrefix}${id}`;
}

/**
 * Make a new copy of the app and, once it is complete, make it the one that is kept.
 * Rejects, leaving the copy before it untouched, when the app's server cannot be reached.
 * With Web Locks, copies of one app are made one at a time across tabs. Without them, one
 * page at a time, and a tab never drops a cache another tab is still filling.
 * @param {{ root: string, fetchFn?: typeof fetch, cacheStorage?: CacheStorage, id?: string, locks?: LockManager|null }} options
 *   `id` names the new copy's cache; two copies never share one. `locks` null skips Web Locks.
 * @returns {Promise<{ cache: string, files: number, savedAt: string }|null>}
 *   null when the copy was removed before it could be kept
 */
export function saveOfflineCopy({ root, fetchFn = globalThis.fetch, cacheStorage = globalThis.caches, id, locks }) {
  return oneAtATime(root, (exclusive) => makeCopy({
    root, fetchFn, cacheStorage, exclusive,
    id: id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  }), locks);
}

async function makeCopy({ root, fetchFn, cacheStorage, id, exclusive }) {
  const names = offlineNames(root);
  const before = await offlineCopy(root, cacheStorage);
  const name = `${names.copyPrefix}${id}`;
  if (before?.cache === name) throw new Error("A copy by that name is already kept.");
  const mark = markName(names, id);
  await cacheStorage.delete(name);
  await cacheStorage.delete(mark);
  // The mark before the cache, so a sweep never sees the cache without it.
  await cacheStorage.open(mark);
  const cache = await cacheStorage.open(name);
  let files;
  try {
    files = await crawl(root, async (url) => {
      const own = url.startsWith(root);
      let response;
      try {
        response = await fetchFn(url, own ? { headers: { [COPYING]: "1" }, cache: "no-cache" } : undefined);
      } catch (error) {
        // Another site's file, kept before: its address carries its version, so it is still right.
        response = own || !before ? undefined : await cacheStorage.match(url, { cacheName: before.cache, ignoreVary: true });
        if (!response) throw error;
      }
      // A file that is not there is not part of the app; the page itself has to be.
      if (!response.ok) {
        if (url === root) throw new Error(`${url} answered ${response.status}.`);
        return null;
      }
      const text = kindOf(url, root) === "other" ? "" : await response.clone().text();
      await cache.put(url, response);
      return text;
    });
  } catch (error) {
    await cacheStorage.delete(name);
    await cacheStorage.delete(mark);
    throw error;
  }
  const copy = { cache: name, files: files.length, savedAt: new Date().toISOString() };
  return publishCopy({ root, cacheStorage, names, id, exclusive, copy });
}

/**
 * Point at `copy` and drop what it replaces.
 * The building mark stays until the pointer names this cache. Another tab drops a cache only
 * when that mark is gone and the pointer does not name it, so it never drops one still being
 * filled. Holding the lock (`exclusive`), no other tab is writing, and every other cache of
 * this app is the one replaced or half made by a page that closed.
 */
async function publishCopy({ root, cacheStorage, names, id, exclusive, copy }) {
  const name = copy.cache;
  const mark = markName(names, id);
  const superseded = await offlineCopy(root, cacheStorage);
  const pointer = await cacheStorage.open(names.pointerCache);
  await pointer.put(names.pointerUrl, new Response(JSON.stringify(copy), { headers: { "content-type": "application/json" } }));
  const namesUs = async () => (await offlineCopy(root, cacheStorage))?.cache === name;

  // A removal already deleted the cache. Take the pointer back if it still names it.
  if (!(await cacheStorage.has(name))) {
    await cacheStorage.delete(mark);
    await retractPointer(cacheStorage, names, name);
    return offlineCopy(root, cacheStorage);
  }
  if (await namesUs()) {
    await cacheStorage.delete(mark);
    if (exclusive) {
      for (const key of await cacheStorage.keys()) {
        if (key.startsWith(names.buildingPrefix) || (key.startsWith(names.copyPrefix) && key !== name)) await cacheStorage.delete(key);
      }
    } else {
      // The copy the pointer named a moment ago is complete, even if a closed page left its mark.
      if (superseded?.cache && superseded.cache !== name) {
        await cacheStorage.delete(superseded.cache);
        await cacheStorage.delete(markName(names, superseded.cache.slice(names.copyPrefix.length)));
      }
      await dropFinishedCopies(cacheStorage, names, root, name);
    }
  } else {
    await cacheStorage.delete(mark);
  }
  if (!(await namesUs())) {
    await cacheStorage.delete(name);
    await cacheStorage.delete(mark);
    await retractPointer(cacheStorage, names, name);
    return offlineCopy(root, cacheStorage);
  }
  return copy;
}

/** Drop finished copies of this app other than `keep`. A copy still being filled has its mark. */
async function dropFinishedCopies(cacheStorage, names, root, keep) {
  for (const key of await cacheStorage.keys()) {
    if (!key.startsWith(names.copyPrefix) || key === keep) continue;
    const mark = markName(names, key.slice(names.copyPrefix.length));
    if (await cacheStorage.has(mark)) continue;
    if ((await offlineCopy(root, cacheStorage))?.cache === key) continue;
    // The mark comes off only after the pointer names the cache, so a cache with no mark will
    // not become the one named in this gap. Read both once more, then drop it.
    if (await cacheStorage.has(mark)) continue;
    if ((await offlineCopy(root, cacheStorage))?.cache === key) continue;
    await cacheStorage.delete(key);
    await cacheStorage.delete(mark);
  }
}

/** Drop the pointer when it still names `cache`, so a deleted copy is not what a later read finds. */
async function retractPointer(cacheStorage, names, cache) {
  const pointer = await cacheStorage.match(names.pointerUrl, { cacheName: names.pointerCache });
  if (!pointer) return;
  try {
    const body = await pointer.json();
    if (body?.cache === cache) await cacheStorage.delete(names.pointerCache);
  } catch {
    // Not JSON, so it is not the pointer this copy wrote.
  }
}

/** Drop the copy of the app at `root`, and anything half made; after a copy being made, if one is. */
export function removeOfflineCopy(root, cacheStorage = globalThis.caches, locks) {
  const names = offlineNames(root);
  return oneAtATime(root, async () => {
    for (const key of await cacheStorage.keys()) {
      if (key === names.pointerCache || key.startsWith(names.copyPrefix) || key.startsWith(names.buildingPrefix)) await cacheStorage.delete(key);
    }
  }, locks);
}

/** Once the page has nothing more pressing to do, or after five seconds. */
function whenIdle() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(() => resolve(), { timeout: 5000 });
    else setTimeout(resolve, 1500);
  });
}

/**
 * What a player is told about the copy, in a line, in the words of `t` (game/strings.js).
 * @param {{ supported: boolean, enabled: boolean, saving: boolean, copy: object|null, error: string|null }} status
 */
export function offlineStatusText(status, t = createStrings()) {
  if (!status.supported) return status.error ? t("Not possible here: <<1>>", status.error) : t("Not possible here: the page has to come from localhost, or over HTTPS with a certificate the browser trusts.");
  if (!status.enabled) return t("Off: the game needs its server at every start.");
  if (status.copy) {
    const when = new Date(status.copy.savedAt);
    const time = Number.isNaN(when.getTime()) ? "" : ` ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
    return status.saving ? t("Saved<<1>>, <<2>> files; checking for a newer one...", time, status.copy.files) : t("Saved<<1>>, <<2>> files.", time, status.copy.files);
  }
  if (status.saving) return t("Saving...");
  return status.error ? t("Not saved: <<1>>", status.error) : t("Not saved yet.");
}

/**
 * The copy, as the app works with it.
 * @param {{ settings: object }} context `settings.offline === false` switches it off
 * @param {{ nav?: object, cacheStorage?: object, secure?: boolean, fetchFn?: typeof fetch, root?: string, idle?: () => Promise<void> }} [env] for tests
 */
export function createOffline(context, {
  nav = globalThis.navigator, cacheStorage = globalThis.caches, secure = globalThis.isSecureContext,
  fetchFn = globalThis.fetch?.bind(globalThis), root = new URL("../../", import.meta.url).href, idle = whenIdle,
} = {}) {
  const state = { supported: !!(nav?.serviceWorker && cacheStorage) && secure !== false, saving: false, copy: null, error: null };
  const listeners = new Set();
  const changed = () => { for (const fn of [...listeners]) fn(offline.status); };
  let saving = null;

  const offline = {
    root,
    /** `{ supported, enabled, saving, copy, error }`: `copy` is what is kept (`{ files, savedAt }`), `error` why the last attempt failed. */
    get status() { return { ...state, enabled: context.settings.offline !== false }; },
    /** Hear of every change of the status. Returns the remover. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /**
     * At the app's start, and when the Options put a new setting to use: register the worker and
     * bring the copy up to date, once the page is idle; or, switched off, take both away. Never
     * rejects: the game runs the same without it.
     */
    async start() {
      if (!state.supported) return;
      if (context.settings.offline === false) return offline.remove();
      try {
        await nav.serviceWorker.register(new URL("sw.js", root).href, { scope: root });
      } catch (error) {
        // A page behind a certificate the browser does not trust, for one.
        state.supported = false;
        state.error = error?.message ?? String(error);
        changed();
        return;
      }
      state.copy = await offlineCopy(root, cacheStorage).catch(() => null);
      changed();
      await idle();
      await offline.save();
    },
    /** Make a new copy now. Resolves when done, whether it worked or not (see `status`). */
    save() {
      if (!state.supported || context.settings.offline === false) return Promise.resolve();
      saving ??= (async () => {
        state.saving = true;
        state.error = null;
        changed();
        try {
          state.copy = await saveOfflineCopy({ root, fetchFn, cacheStorage });
          // Switched off while it was being made.
          if (context.settings.offline === false) {
            await removeOfflineCopy(root, cacheStorage);
            state.copy = null;
          }
        } catch (error) {
          state.error = error?.message ?? String(error);
        }
        state.saving = false;
        saving = null;
        changed();
      })();
      return saving;
    },
    /** Take the worker and the copy away. */
    async remove() {
      if (!state.supported) return;
      try {
        // The copy first: without it the worker has nothing to answer from, however long it takes to go.
        await removeOfflineCopy(root, cacheStorage);
        const registration = await nav.serviceWorker.getRegistration(root);
        await registration?.unregister();
      } catch (error) {
        state.error = error?.message ?? String(error);
      }
      state.copy = null;
      changed();
    },
    /** Switch the copy on or off (the caller stores the settings). */
    async setEnabled(on) {
      context.settings.offline = !!on;
      changed();
      if (on) await offline.start();
      else await offline.remove();
    },
  };
  return offline;
}
