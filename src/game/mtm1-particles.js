/*
  Monster Truck Madness 1's particles and tire tracks (MTM1_MONSTER_EXE_ANALYSIS.md 6.6), "MTM1 particles" in Options:
  single points of the ground's own colour thrown from the tires, which mark the ground where they land, and tracks
  darkened into the ground's texels. Both draw on the ground's texture, one texel a foot (a cell is 32 by 32), and only
  32 cells keep their marks: the 33rd cell drawn on takes the oldest one's marks away.

  Pure: the rules and the state; render/mtm1-particles.js draws them.
*/

/** The surface flags by `.TTY` type (0x4300c0): bit 1 throws particles, bit 4 takes tracks. */
export const MTM1_SURFACE_FLAGS = Object.freeze({ 1: 10, 2: 13, 3: 1, 4: 5, 5: 9, 6: 5, 7: 5, 9: 5 });
export const throwsParticles = (type) => ((MTM1_SURFACE_FLAGS[type] ?? 0) & 1) !== 0;
export const takesTracks = (type) => ((MTM1_SURFACE_FLAGS[type] ?? 0) & 4) !== 0;

export const PARTICLE_POOL = 256, PARTICLE_LIFE_S = 3, GRAVITY_FT = 32;
/** The particles a tire throws a frame: three from each of its three points. */
export const PER_POINT = 3, POINTS = 3;
/** How often a tire throws, seconds: the game throws every frame; the port at the 30 frames a second it ran at. */
export const THROW_TICK_S = 1 / 30;
export const CELL_FT = 32, MARKED_CELLS = 32, WORLD_FT = 8192;
/** A track's step is at most this many texels (feet) long; longer, it is a jump and draws nothing. */
export const MAX_TRACK_STEP = 32;
/** How much of a texel's light one pass of the shade table takes (the table is not traced: the port's reading). */
export const TRACK_SHADE = 0.3;

/**
 * A particle's velocity from the tire's (`tire`, ft/s, game axes): 0.9 to 1.1 of it across, 0.5 to 1.5 of it up.
 */
export function particleVelocity(tire, random = Math.random) {
  return [tire[0] * (1 + (random() - 0.5) * 0.2), tire[1] * (1 + (random() - 0.5)), tire[2] * (1 + (random() - 0.5) * 0.2)];
}

/**
 * The tire's own throwing velocity (0x448a20): along a direction of the tire's times half its rim speed, with a push of up
 * to 3 ft/s across and up to half the forward speed along. The direction (tire +0xac) is not traced; the port takes the
 * way back from the truck, tilted up by half, as a tire throws what it rolls through. `forward` and `right` are the
 * truck's level unit axes in game feet; `rimSpeed` the tire's (radius times spin).
 */
export function tireThrow({ forward, right, rimSpeed, forwardSpeed }, random = Math.random) {
  const half = Math.abs(rimSpeed) / 2, f = (random() - 0.5) * 2;
  const across = 3 * f, along = f * forwardSpeed * 0.5;
  return [
    -forward[0] * half + right[0] * across + forward[0] * along,
    half * 0.5,
    -forward[2] * half + right[2] * across + forward[2] * along,
  ];
}

/** The pool of particles: a ring of `PARTICLE_POOL`, the newest taking the oldest's place. */
export function createParticlePool(size = PARTICLE_POOL) {
  const particles = Array.from({ length: size }, () => ({ life: 0, pos: [0, 0, 0], vel: [0, 0, 0], colour: [0, 0, 0] }));
  let next = 0;
  return {
    particles,
    throw(pos, vel, colour) {
      const p = particles[next];
      next = (next + 1) % size;
      p.life = PARTICLE_LIFE_S;
      p.pos[0] = pos[0]; p.pos[1] = pos[1]; p.pos[2] = pos[2];
      p.vel[0] = vel[0]; p.vel[1] = vel[1]; p.vel[2] = vel[2];
      p.colour[0] = colour[0]; p.colour[1] = colour[1]; p.colour[2] = colour[2];
    },
    /** Step every particle (0x4a0e20): `landed(x, z, colour)` for each that falls below `ground(x, z)`, and is gone. */
    step(dt, ground, landed = () => {}) {
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.vel[1] -= GRAVITY_FT * dt;
        p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt; p.pos[2] += p.vel[2] * dt;
        if (p.vel[1] < 0 && p.pos[1] < ground(p.pos[0], p.pos[2])) {
          p.life = 0;
          landed(p.pos[0], p.pos[2], p.colour);
          continue;
        }
        p.life = Math.max(0, p.life - dt);
      }
    },
  };
}

/**
 * A track's width in texels: the tire's radius (+0x6c) cut to a whole number, as MTM1 passes it (MTM1_MONSTER_EXE_ANALYSIS.md
 * 6.6, `0x433d0f`), and not the tire's width (+0x74).
 */
export const trackWidth = (radius = 3) => Math.max(1, Math.trunc(radius));

/**
 * The texels of a track step (0x4a16c0): a Bresenham line from (x0, z0) to (x1, z1) in whole feet, `width` texels across
 * it (across x where the line runs along z, and the other way round); none for a step longer than `MAX_TRACK_STEP`.
 */
export function trackTexels(x0, z0, x1, z1, width) {
  x0 = Math.floor(x0); z0 = Math.floor(z0); x1 = Math.floor(x1); z1 = Math.floor(z1);
  const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
  if (dx > MAX_TRACK_STEP || dz > MAX_TRACK_STEP) return [];
  const out = [], sx = x1 >= x0 ? 1 : -1, sz = z1 >= z0 ? 1 : -1, w = Math.max(1, Math.round(width)), half = Math.floor(w / 2);
  let x = x0, z = z0;
  if (dx >= dz) {
    let err = dz * 2 - dx;
    for (let n = 0; n <= dx; n++) {
      for (let k = 0; k < w; k++) out.push([x, z + k - half]);
      if (err > 0) { z += sz; err -= dx * 2; }
      x += sx; err += dz * 2;
    }
  } else {
    let err = dx * 2 - dz;
    for (let n = 0; n <= dz; n++) {
      for (let k = 0; k < w; k++) out.push([x + k - half, z]);
      if (err > 0) { x += sx; err -= dz * 2; }
      z += sz; err += dx * 2;
    }
  }
  return out;
}

/**
 * The marks on the ground (0x4a1440, 0x4a1130): cells of 32 by 32 texels, at most `MARKED_CELLS`, taken in turn. A cell's
 * texels are RGBA, clear where nothing is drawn. `onCell(cell)` hears of a cell made or changed, `onDrop(cell)` of one
 * given back.
 */
export function createGroundMarks({ onCell = () => {}, onDrop = () => {}, worldFt = WORLD_FT } = {}) {
  // `worldFt`: the world's size (8192 ft, or a track format version 6 world's).
  const cells = new Map();
  const order = [];
  const wrap = (v) => ((v % worldFt) + worldFt) % worldFt;
  const across = worldFt / CELL_FT;
  function cellAt(x, z) {
    const col = Math.floor(wrap(x) / CELL_FT), row = Math.floor(wrap(z) / CELL_FT), key = row * across + col;
    let cell = cells.get(key);
    if (!cell) {
      if (order.length >= MARKED_CELLS) {
        const old = cells.get(order.shift());
        cells.delete(old.key);
        onDrop(old);
      }
      cell = { key, col, row, rgba: new Uint8ClampedArray(CELL_FT * CELL_FT * 4), dirty: true };
      cells.set(key, cell);
      order.push(key);
    }
    return cell;
  }
  /** A texel at game (x, z), `colour` [r, g, b] (0 to 255) laid opaque, or null to darken it by `TRACK_SHADE`. */
  function mark(x, z, colour = null) {
    const cell = cellAt(x, z);
    const u = Math.floor(wrap(x)) % CELL_FT, v = Math.floor(wrap(z)) % CELL_FT, at = (v * CELL_FT + u) * 4;
    if (colour) {
      cell.rgba[at] = colour[0]; cell.rgba[at + 1] = colour[1]; cell.rgba[at + 2] = colour[2]; cell.rgba[at + 3] = 255;
    } else if (cell.rgba[at + 3] < 255) {
      cell.rgba[at + 3] = Math.round(255 - (255 - cell.rgba[at + 3]) * (1 - TRACK_SHADE));
    } else {
      for (let c = 0; c < 3; c++) cell.rgba[at + c] = Math.round(cell.rgba[at + c] * (1 - TRACK_SHADE));
    }
    if (!cell.dirty) { cell.dirty = true; onCell(cell); }
    return cell;
  }
  return { cells, mark, clean: () => { for (const cell of cells.values()) cell.dirty = false; } };
}

/**
 * The colour of the ground's texture at game (x, z), [r, g, b]: the cell's tile in the atlas (`atlas` as the asset worker
 * gives it, `clr` the level's CLR words), turned and mirrored as the cell's word says (worker/terrain-mesh.js
 * `cellTileUvs`). Null when the atlas has no layout.
 */
export function groundTexel(atlas, clr, x, z, worldFt = WORLD_FT) {
  const { rgba, width, tileSide: side, padding = 0, slots } = atlas ?? {};
  if (!rgba || !side || !clr) return null;
  const pitch = side + padding * 2, cols = Math.max(1, Math.round(width / pitch));
  // The .CLR is worldFt / 32 cells a side (256, or a track format version 6 world's N).
  const n = worldFt / CELL_FT;
  const fx = ((x % worldFt) + worldFt) % worldFt / CELL_FT, fz = ((z % worldFt) + worldFt) % worldFt / CELL_FT;
  const col = Math.floor(fx) & (n - 1), row = Math.floor(fz) & (n - 1), word = clr[row * n + col];
  const slot = Math.min(word & 0x0fff, (slots ?? 1) - 1);
  const mirror = (word >> 12) & 3, rot = (word >> 14) & 3;
  // The cell's corners (row, col), (row, col + 1), (row + 1, col + 1), (row + 1, col) take these tile corners.
  const corner = (k) => {
    let c = k;
    if (mirror & 1) c = (3 - c) & 3;
    if (mirror & 2) c = (1 - c) & 3;
    c = (rot + c) & 3;
    return [c === 0 || c === 3 ? 0 : 1, c < 2 ? 1 : 0];
  };
  const a = fx - Math.floor(fx), b = fz - Math.floor(fz);
  const [u0, v0] = corner(0), [u1, v1] = corner(1), [u2, v2] = corner(2), [u3, v3] = corner(3);
  const u = (u0 * (1 - a) + u1 * a) * (1 - b) + (u3 * (1 - a) + u2 * a) * b;
  const v = (v0 * (1 - a) + v1 * a) * (1 - b) + (v3 * (1 - a) + v2 * a) * b;
  const tx = (slot % cols) * pitch + padding + Math.min(side - 1, Math.floor(u * side));
  const ty = Math.floor(slot / cols) * pitch + padding + Math.min(side - 1, Math.floor(v * side));
  const at = (ty * width + tx) * 4;
  return [rgba[at], rgba[at + 1], rgba[at + 2]];
}
