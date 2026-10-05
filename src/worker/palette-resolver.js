/*
  Resolve classic 8-bit texture palettes with OpenPhotex's JSTrackViewer ranking.

  The VFS mounts many PODs while paletteCandidates accepts one archive, so `archiveView`
  presents the visible entries in mount priority order. The entries remain the originals and
  are read through the VFS, preserving first-match lookup and POD1 palette metadata.
*/
import { bundledPalette, decodeActPalette, paletteCandidates, textureStem } from "../vendor/openphotex/index.js";

function archiveView(vfs) {
  const entries = [];
  const seen = new Set();
  for (const mount of vfs.mounts) {
    for (const entry of mount.archive.entries) {
      if (seen.has(entry.normalizedName)) continue;
      seen.add(entry.normalizedName);
      entries.push(entry);
    }
  }
  return { entries };
}

/**
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @param {"MTM1"|"MTM2"|"CPR"|"TV/F3"|"HB"} origin
 * @param {Uint8Array|null} trackPalette decoded level palette
 */
export function createPaletteResolver(vfs, origin, trackPalette = null) {
  const archive = archiveView(vfs);
  const cache = new Map();
  const sources = new Map();

  const readEntryPalette = async (entry) => decodeActPalette(await vfs.read(entry.normalizedName));
  const candidatePalette = async (candidate) => {
    if (candidate.source === "track") return trackPalette?.length >= 768 ? trackPalette : null;
    if (candidate.source === "bundled") return decodeActPalette(bundledPalette(candidate.bundled));
    if (candidate.source === "pod-metadata" && !candidate.entry) {
      return candidate.bundled ? decodeActPalette(bundledPalette(candidate.bundled)) : null;
    }
    return candidate.entry ? readEntryPalette(candidate.entry) : null;
  };
  const candidateLabel = (candidate) => {
    if (candidate.source === "track") return "track";
    if (candidate.source === "bundled") return `bundled:${candidate.bundled}`;
    if (candidate.source === "pod-metadata") {
      return candidate.entry ? `pod-metadata:${candidate.entry.name}` : `pod-metadata:${candidate.bundled ?? candidate.name}`;
    }
    return `${candidate.source}:${candidate.entry.name}`;
  };

  async function resolve(textureName, rawEntry = null, kind = "model") {
    const key = `${kind}:${textureStem(textureName)}`;
    if (!cache.has(key)) cache.set(key, (async () => {
      const candidates = paletteCandidates(
        archive, { name: textureName, entry: rawEntry },
        { origin, automatic: true, kind, trackPalette: !!trackPalette },
      );
      for (const candidate of candidates) {
        const palette = await candidatePalette(candidate);
        if (!palette || palette.length < 768) continue;
        const result = { palette, source: candidateLabel(candidate) };
        sources.set(key, result.source);
        return result;
      }
      const result = { palette: null, source: "none" };
      sources.set(key, result.source);
      return result;
    })());
    return cache.get(key);
  }

  return {
    resolve,
    async paletteFor(textureName, rawEntry = null, kind = "model") {
      return (await resolve(textureName, rawEntry, kind)).palette;
    },
    sourceSummary() {
      const counts = {};
      for (const source of sources.values()) counts[source] = (counts[source] ?? 0) + 1;
      return counts;
    },
  };
}
