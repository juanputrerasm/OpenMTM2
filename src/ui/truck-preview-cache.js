/*
  The asset worker's truck builds, fetched once per truck and shared by every preview slot
  (ui/truck-preview-slot.js). The POD manager forgets them after the mounted archives change,
  since the same file may then come from another archive.
*/
const builds = new Map();

/** The cached build for `key`, read with `fetch` the first time. */
export function cachedTruckPreview(key, fetch) {
  if (!builds.has(key)) builds.set(key, fetch());
  return builds.get(key);
}

/** Drop a failed read, so the next look tries again. */
export function dropTruckPreview(key) {
  builds.delete(key);
}

/** Forget every cached build. */
export function clearTruckPreviewCache() {
  builds.clear();
}
