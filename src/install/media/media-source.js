/*
  One file the player gives the Setup screen, as an install source: a zip (the MTM2 trial as the Internet Archive serves
  it, or a zipped game folder), a CD image (.ISO), the trial's installer (.EXE) or a cabinet (.CAB).

  The result has the shape of the folder picker's source (install/picker.js): files by path relative to the image, matched
  without regard to case, and a listing. Containers nest: the trial zip holds an installer, which holds a cabinet, which
  holds the archives. While a container holds no POD, the containers inside it are opened in turn, and the first that
  does is the source.
*/
import { installPathKey } from "../pod-ini.js";
import { openZip, isZip } from "./zip.js";
import { openIso, isIso } from "./iso.js";
import { openCab, isCabinetHeader } from "./cab.js";
import { findCabinets, isExe, MAX_INSTALLER_BYTES } from "./exe.js";

const SNIFF = 17 * 2048 + 8;
const MAX_NESTING = 3;
const CONTAINER = /\.(ZIP|ISO|EXE|CAB)$/i;

/** The kind of container `blob` is, from its first bytes: "zip", "iso", "exe", "cab" or null. */
export async function mediaKind(blob) {
  const head = new Uint8Array(await blob.slice(0, SNIFF).arrayBuffer());
  if (isZip(head)) return "zip";
  if (isCabinetHeader(head, 0, blob.size)) return "cab";
  if (isExe(head)) return "exe";
  if (isIso(head)) return "iso";
  return null;
}

/**
 * @param {Blob} blob
 * @param {string} [name] the file's name, for messages and the source's label
 * @param {{ onProgress?: (phase: string, done: number, total: number) => void }} [options]
 * @returns {Promise<{ name: string, kind: string, getFile(path: string): Promise<Blob|null>, list(): Promise<string[]> }>}
 */
export async function openMedia(blob, name = "", { onProgress } = {}) {
  const found = await openContainer(blob, name, onProgress, 0);
  if (!found) throw new Error(`${name || "This file"} is not a zip, a disc image or a game installer OpenMTM2 can read.`);
  return found;
}

async function openContainer(blob, name, onProgress, depth) {
  const kind = await mediaKind(blob);
  if (!kind) return null;
  const parts = await containerParts(blob, kind, name, onProgress);
  if (!parts.length) return null;
  const files = parts.flatMap((part) => part.files.map((f) => ({ ...f, part })));
  if (files.some((f) => /\.POD$/i.test(f.path)) || depth >= MAX_NESTING) return asSource(files, name, kind);
  // No archive here: try the containers inside, the largest first (the trial zip holds one installer).
  const inner = files.filter((f) => CONTAINER.test(f.path)).sort((a, b) => b.size - a.size);
  for (const file of inner) {
    const opened = await file.part.open(file.path, (done, total) => onProgress?.("unpack", done, total));
    const result = opened && await openContainer(opened, file.path.split("/").pop(), onProgress, depth + 1);
    if (result) return result;
  }
  return asSource(files, name, kind);
}

/** The readable parts of a container: itself, or for an installer each cabinet inside it. */
async function containerParts(blob, kind, name, onProgress) {
  if (kind === "zip") return [await openZip(blob)];
  if (kind === "iso") return [await openIso(blob)];
  if (kind === "cab") return [withProgress(await openCab(blob), onProgress)];
  if (blob.size > MAX_INSTALLER_BYTES) return [];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const cabinets = findCabinets(bytes);
  const whole = new Blob([bytes]);
  return Promise.all(cabinets.map(async (at) => withProgress(await openCab(whole, at), onProgress)));
}

/** A cabinet whose unpacking reports progress. */
function withProgress(cab, onProgress) {
  return { files: cab.files, open: (path) => cab.open(path, (done, total) => onProgress?.("unpack", done, total)) };
}

function asSource(files, name, kind) {
  const byPath = new Map();
  for (const file of files) {
    const key = installPathKey(file.path);
    if (!byPath.has(key)) byPath.set(key, file);
  }
  const opened = new Map();
  return {
    name,
    kind,
    async getFile(path) {
      const key = installPathKey(path);
      const file = byPath.get(key);
      if (!file) return null;
      if (!opened.has(key)) opened.set(key, file.part.open(file.path));
      return opened.get(key);
    },
    async list() {
      return [...byPath.keys()];
    },
  };
}
