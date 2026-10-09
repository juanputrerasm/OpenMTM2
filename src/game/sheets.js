/*
  Sprite sheets built from the effect art (worker/effects-art.js): pure, so it runs under Node.
*/

/** Several equally sized images side by side as one sheet. */
export function joinSheets(images, { halves = false } = {}) {
  const pieces = halves ? images.flatMap((image) => [[image, 0], [image, 1]]) : images.map((image) => [image, null]);
  const cell = halves ? images[0].width / 2 : images[0].width, height = images[0].height;
  const rgba = new Uint8Array(cell * pieces.length * height * 4);
  pieces.forEach(([image, half], n) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < cell; x++) {
        const src = (y * image.width + x + (half === null ? 0 : half * cell)) * 4, dst = (y * cell * pieces.length + n * cell + x) * 4;
        rgba.set(image.rgba.subarray(src, src + 4), dst);
      }
    }
  });
  return { width: cell * pieces.length, height, rgba, cells: pieces.length };
}

/** A mosaic of the four ice textures by cell parity (`SNOW0` + x & 1 + 2 (z & 1), 0x4f9...): a 128 x 128 image that repeats every 64 ft. */
export function iceMosaic(ice) {
  const n = ice[0].width, rgba = new Uint8Array(n * 2 * n * 2 * 4);
  for (let cz = 0; cz < 2; cz++) {
    for (let cx = 0; cx < 2; cx++) {
      const image = ice[cx + cz * 2];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const src = (y * n + x) * 4, dst = ((cz * n + y) * n * 2 + cx * n + x) * 4;
          rgba.set(image.rgba.subarray(src, src + 4), dst);
        }
      }
    }
  }
  return { width: n * 2, height: n * 2, rgba };
}
