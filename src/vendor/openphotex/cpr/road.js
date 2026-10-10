/*
  The CPR road layer as geometry: the quads and wall panels a `.TRK` describes.

  `parseCprTrk` returns the records; this lays them out, once, for whatever draws the track and
  whatever drives on it, so the two cannot disagree. It follows JSTrackViewer's road layer
  (docs/LEVELS.md, "CPR's road layer"):

    - Each record owns the stretch to the next one; a closed circuit's last record runs back
      to record 0 (`cprSegmentPairs`).
    - Only the slots between the outermost walls are there (`cprVisibleSlots`), and a slot
      collapsed to no width on both records is skipped (`isDegenerateSlot`).
    - A slot's texture is the packed reference of the record that owns the stretch, its U the
      record's own u1..u4 (road tiles carry their edge line on one side, so U is never tiled
      across the width) and its V runs along the stretch, one tile every 128 ft.
    - A wall stands on a cross section point of the owning record and spans to the next
      record's same point, stacked by its type (`CPR_WALL_LAYERS`). Each panel of the stack
      is one of the four strips of a wall texture, or the catch fence.

  Positions are the file's own: `[x, altitude, along]` in feet. The file says nothing of which
  way `along` runs against the terrain's rows; the caller places it.
*/
import { CPR_CROSS_SECTION_MIDPOINT, CPR_WALL_LAYERS, cprSegmentPairs, cprTextureIndex, cprTextureSlice, cprTextureU, cprVisibleSlots, isDegenerateSlot, } from "./track.js";
/*
  Height of one wall panel, in feet.

  Not in the data: the engine holds it. 4.5 ft is JSTrackViewer's calibration against the
  original game's screenshots of Laguna. It is the one number here that is not read off the file.
*/
export const CPR_WALL_PART_HEIGHT_FT = 4.5;
/** Feet of track one road texture tile covers along the stretch. */
const ROAD_TILE_FT = 128;
/** The section U values a slot takes when the record writes none (16.16 over 0..256). */
const DEFAULT_U_INNER = 262144;
const DEFAULT_U_OUTER = 16384000;
const point = (p) => [p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0];
/** `textureCount` is the `.TTX`'s length: a reference outside it reads as texture 0. */
export function buildCprRoad(surfaces, textureCount = Infinity) {
    const quads = [];
    const walls = [];
    const textureOf = (value) => {
        const index = cprTextureIndex(value ?? 0);
        return index >= 0 && index < textureCount ? index : 0;
    };
    for (const [from, to] of cprSegmentPairs(surfaces)) {
        const a = surfaces[from], b = surfaces[to];
        const aPts = a.points ?? [], bPts = b.points ?? [];
        const pointCount = Math.min(aPts.length, bPts.length);
        if (pointCount < 2)
            continue;
        const visible = cprVisibleSlots(a);
        for (let slot = Math.max(0, visible.first); slot <= Math.min(pointCount - 2, visible.last); slot++) {
            if (isDegenerateSlot(a, slot) && isDegenerateSlot(b, slot))
                continue;
            const coords = a.textureCoordinates?.[slot];
            const p0 = point(aPts[slot]), p1 = point(bPts[slot]), p2 = point(bPts[slot + 1]), p3 = point(aPts[slot + 1]);
            const vRepeat = Math.max(1, Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) / ROAD_TILE_FT);
            quads.push({
                segment: from, slot, corners: [p0, p1, p2, p3], texture: textureOf(coords?.[0] ?? a.textureIndexes?.[slot]),
                uvs: [
                    [cprTextureU(coords?.[1] ?? DEFAULT_U_INNER), 1], [cprTextureU(coords?.[3] ?? DEFAULT_U_INNER), 1 - vRepeat],
                    [cprTextureU(coords?.[4] ?? DEFAULT_U_OUTER), 1 - vRepeat], [cprTextureU(coords?.[2] ?? DEFAULT_U_OUTER), 1],
                ],
            });
        }
        for (let index = 0; index < pointCount; index++) {
            // The owning record decides whether a wall stands here; its texture parts outlive a deleted wall.
            const wallType = a.wallTypes?.[index] ?? 0;
            const layers = CPR_WALL_LAYERS[wallType];
            if (!layers)
                continue;
            const parts = a.wallTextures?.[index] ?? [];
            const p0 = point(aPts[index]), p1 = point(bPts[index]);
            const panels = [];
            let base = 0;
            for (const layer of layers) {
                const top = base + layer.units * CPR_WALL_PART_HEIGHT_FT;
                const value = parts[layer.part ?? 0] ?? parts[0] ?? 0;
                const vTop = layer.fence ? 0 : cprTextureSlice(value) / 4;
                panels.push({
                    baseFt: base, topFt: top, fence: !!layer.fence, texture: layer.fence ? -1 : textureOf(value),
                    vTop, vBottom: layer.fence ? 1 : vTop + 1 / 4,
                });
                base = top;
            }
            walls.push({
                segment: from, point: index, wallType, from: p0, to: p1, heightFt: base,
                uRepeat: Math.max(1, Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) / ROAD_TILE_FT),
                facing: index < CPR_CROSS_SECTION_MIDPOINT ? 1 : -1, panels,
            });
        }
    }
    return { quads, walls };
}
