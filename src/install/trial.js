/*
  The Monster Truck Madness 2 trial (docs/STANDALONE_ASSETS.md, "The trial"): Microsoft's free 1998 demo, Farm Road 29
  and four trucks. Its license lets anyone pass on true and complete copies, with the license, not for profit, so the
  app carries the unmodified MtM2trial.zip with its EULA.txt (assets/trial/). The Internet Archive's copy, the same bytes,
  is the fallback; its CORS address is the one the Archive's own in-browser players use, as its plain download address
  does not let another site read the file.

  A download that is not exactly the known zip (size and SHA-1) is refused, so a changed copy is never installed.
*/
import { msg } from "../game/strings.js";

/** The trial's zip as published, from archive.org/metadata/MonsterTruckMadness2_1020/files. */
export const TRIAL = Object.freeze({
  size: 18433184,
  sha1: "d12c783aab1f9b88834c43879560c5d08eee8966",
  /** Where it is fetched from, in order: the app's own copy, then the Internet Archive. */
  sources: Object.freeze([
    Object.freeze({ id: "app", label: msg("OpenMTM2"), path: "assets/trial/MtM2trial.zip" }),
    Object.freeze({ id: "archive", label: msg("the Internet Archive"), url: "https://cors.archive.org/cors/MonsterTruckMadness2_1020/MtM2trial.zip" }),
  ]),
  /** The item's page, for a player who downloads it by hand. */
  page: "https://archive.org/details/MonsterTruckMadness2_1020",
});

/**
 * Download the trial's zip, trying each source in turn.
 * @param {{ base?: string, signal?: AbortSignal, fetchFn?: typeof fetch,
 *   onProgress?: (progress: { loaded: number, total: number, source: string }) => void }} [options]
 *   `base` is the address the app's own copy is relative to (the page's).
 * @returns {Promise<Blob>}
 */
export async function downloadTrial({ base = globalThis.document?.baseURI, signal, fetchFn = globalThis.fetch, onProgress } = {}) {
  const failures = [];
  for (const source of TRIAL.sources) {
    const url = source.url ?? new URL(source.path, base).href;
    try {
      const blob = await fetchChecked(url, { signal, fetchFn, onProgress: (loaded) => onProgress?.({ loaded, total: TRIAL.size, source: source.label }) });
      return blob;
    } catch (err) {
      if (signal?.aborted) throw err;
      failures.push(`${source.label}: ${err.message}`);
    }
  }
  throw new Error(`The trial could not be downloaded (${failures.join("; ")}).`);
}

async function fetchChecked(url, { signal, fetchFn, onProgress }) {
  const response = await fetchFn(url, { signal });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  // A page served without the file (a plain text pointer, an error page) is not worth reading whole.
  const announced = Number(response.headers.get("content-length"));
  if (announced && announced !== TRIAL.size) throw new Error(`sent ${announced} bytes, not the trial's ${TRIAL.size}`);
  const chunks = [];
  let loaded = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (loaded > TRIAL.size) throw new Error("sent more than the trial's size");
      onProgress(loaded);
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes);
    loaded = bytes.length;
    onProgress(loaded);
  }
  if (loaded !== TRIAL.size) throw new Error(`sent ${loaded} of ${TRIAL.size} bytes`);
  const blob = new Blob(chunks, { type: "application/zip" });
  if (await sha1Hex(blob) !== TRIAL.sha1) throw new Error("sent a file that is not the trial (its checksum differs)");
  return blob;
}

/** The SHA-1 of a blob, as lower-case hex. */
export async function sha1Hex(blob) {
  const digest = await crypto.subtle.digest("SHA-1", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
