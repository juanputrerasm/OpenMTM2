/*
  Mipmaps for the frames of an animated texture that do not flicker far off.

  A texture that runs through frames (the game's water, eight pictures of ripples) is seen far away as each frame's mean
  colour, and the frames' means are not alike: over open water the whole far sea pulsed between a greyer and a bluer
  tone four times a second, where up close the ripples move. Here each frame's smaller pictures are mixed toward the
  same pictures averaged over all the frames, wholly from `full` halvings on: far off every frame is the same water, and
  near the eye each is itself. Pure; colours are averaged as light (the bytes are sRGB), alpha as it is.
*/

const toLight = Float32Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toByte = (light) => Math.round(255 * (light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055));

/** A picture as light (four floats a point, alpha 0 to 1). */
function asLight({ rgba, width, height }) {
  const out = new Float32Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = toLight[rgba[i]]; out[i + 1] = toLight[rgba[i + 1]]; out[i + 2] = toLight[rgba[i + 2]]; out[i + 3] = rgba[i + 3] / 255; }
  return { data: out, width, height };
}

/** The picture half the size each way (no smaller than a point), each point the mean of the four it covers. */
function halved({ data, width, height }) {
  const w = Math.max(1, width >> 1), h = Math.max(1, height >> 1), out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.min(width - 1, x * 2), x1 = Math.min(width - 1, x * 2 + 1), y0 = Math.min(height - 1, y * 2), y1 = Math.min(height - 1, y * 2 + 1);
    for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = (data[(y0 * width + x0) * 4 + c] + data[(y0 * width + x1) * 4 + c] + data[(y1 * width + x0) * 4 + c] + data[(y1 * width + x1) * 4 + c]) / 4;
  }
  return { data: out, width: w, height: h };
}

/**
 * @param frames `[{ rgba, width, height }]`, all one size (sRGB bytes)
 * @param from the first halving that takes any of the frames' common picture; @param full the halving from which a
 *   level is that common picture alone
 * @returns for each frame its levels, the frame itself first: `[{ data: Uint8Array, width, height }]` down to a point
 */
export function steadyMipmaps(frames, { from = 1, full = 3 } = {}) {
  if (!frames.length) return [];
  const chains = frames.map((frame) => { const levels = [asLight(frame)]; while (levels.at(-1).width > 1 || levels.at(-1).height > 1) levels.push(halved(levels.at(-1))); return levels; });
  const count = chains[0].length;
  return chains.map((levels, f) => levels.map((level, n) => {
    const share = n === 0 ? 0 : Math.min(1, Math.max(0, (n - from + 1) / (full - from + 1)));
    const out = new Uint8Array(level.data.length);
    for (let i = 0; i < out.length; i++) {
      let common = 0;
      if (share > 0) { for (const other of chains) common += other[Math.min(n, count - 1)].data[i]; common /= chains.length; }
      const value = level.data[i] * (1 - share) + common * share;
      out[i] = i % 4 === 3 ? Math.round(value * 255) : toByte(value);
    }
    return { data: n === 0 ? frames[f].rgba : out, width: level.width, height: level.height };
  }));
}
