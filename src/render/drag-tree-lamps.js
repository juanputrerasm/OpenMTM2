/*
  The Christmas tree model beside a drag strip, lit (game/drag-tree-face.js): every material drawn with TRLFACE.RAW
  gets one shared 64 x 64 texture, repainted when the lamps change, and shines by itself as the game's unlit
  palette colours do.
*/
import * as THREE from "three";
import { TREE_FACE_SIZE, treeFace } from "../game/drag-tree-face.js";

const NAME = "TRLFACE.RAW";

/**
 * @param {THREE.Object3D} world the track
 * @param {Record<number, number[]>} colours level palette index to RGB (track-build.js `dragTreeColours`)
 * @returns the lamps, or null where the track has no tree
 */
export function createDragTreeLamps(world, colours) {
  if (!colours) return null;
  const materials = new Set();
  world.traverse((object) => {
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const m of list) if (m?.userData?.textureName === NAME) materials.add(m);
  });
  if (!materials.size) return null;
  const n = TREE_FACE_SIZE;
  const rgba = new Uint8Array(n * n * 4), indices = new Uint8Array(n * n);
  const texture = new THREE.DataTexture(rgba, n, n, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Rows are top first, as every texture of the track's (render/track-scene.js `dataTexture`).
  texture.flipY = false;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  const previous = [];
  for (const m of materials) {
    previous.push([m, m.map, m.emissiveMap, m.emissive?.clone()]);
    m.map = texture;
    if (m.emissive) { m.emissiveMap = texture; m.emissive.setRGB(1, 1, 1); }
    m.needsUpdate = true;
  }
  let shown = null;
  const paint = (bySlot) => {
    const key = `${bySlot?.[0] ?? 0},${bySlot?.[1] ?? 0}`;
    if (key === shown) return;
    shown = key;
    treeFace(bySlot, indices);
    for (let p = 0; p < indices.length; p++) {
      const c = colours[indices[p]] ?? [0, 0, 0];
      rgba[p * 4] = c[0]; rgba[p * 4 + 1] = c[1]; rgba[p * 4 + 2] = c[2]; rgba[p * 4 + 3] = 255;
    }
    texture.needsUpdate = true;
  };
  paint([0, 0]);
  return {
    /** The lamp word of grid slot 0 and slot 1 (game/drag-race.js `LAMP`). */
    set: paint,
    dispose() {
      for (const [m, map, emissiveMap, emissive] of previous) {
        m.map = map; m.emissiveMap = emissiveMap;
        if (emissive) m.emissive.copy(emissive);
        m.needsUpdate = true;
      }
      texture.dispose();
    },
  };
}
