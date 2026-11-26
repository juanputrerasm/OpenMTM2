/*
  Community Patch 4 2.0.52.4's twin props (docs/CP4_ENGINE_UPDATES.md 12): some stock tracks place a second, higher
  priority copy of a building shell over the first, and the two z-fight. Two static props are twins when

  - their padded world boxes overlap by at least 80 % of the smaller box, and
  - at least 10 % of the lower-priority prop's face area is doubled by same-texture faces of the other that face the
    same way (within 10 degrees) and lie within 0.5 ft.

  The higher-priority twin is then not drawn at Normal and Complex scenery detail. Collision and the computer trucks
  are unchanged: this only picks what is drawn. The rule runs on every track; it is not a list.

  Pure: plain arrays in, a set of indexes out, so the tests use it.
*/

export const TWIN = Object.freeze({ overlap: 0.8, doubled: 0.1, angleDeg: 10, distanceFt: 0.5, padFt: 0.5 });

/** A prop's faces in world feet: per texture, each triangle's centroid, unit normal, area and corners. */
function worldFaces(prop) {
  const { meshes, matrix: m, pos } = prop;
  const faces = [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const w = (p, i) => [0, 1, 2].map((r) => pos[r] + m[r * 3] * p[i] + m[r * 3 + 1] * p[i + 1] + m[r * 3 + 2] * p[i + 2]);
  for (const mesh of meshes) {
    const p = mesh.positions;
    for (let i = 0; i + 8 < p.length; i += 9) {
      const a = w(p, i), b = w(p, i + 3), c = w(p, i + 6);
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (!(len > 1e-9)) continue;
      faces.push({
        texture: mesh.textureName ?? "", area: len / 2, normal: n.map((x) => x / len),
        centroid: [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3), corners: [a, b, c],
      });
    }
  }
  return { faces, lo, hi };
}

const volume = (lo, hi) => Math.max(0, hi[0] - lo[0]) * Math.max(0, hi[1] - lo[1]) * Math.max(0, hi[2] - lo[2]);

/** Whether point `p` lies over triangle `t` (projected along its normal `n`). */
function overTriangle(p, [a, b, c], n) {
  const side = (u, v) => {
    const e = [v[0] - u[0], v[1] - u[1], v[2] - u[2]], q = [p[0] - u[0], p[1] - u[1], p[2] - u[2]];
    const x = [e[1] * q[2] - e[2] * q[1], e[2] * q[0] - e[0] * q[2], e[0] * q[1] - e[1] * q[0]];
    return x[0] * n[0] + x[1] * n[1] + x[2] * n[2];
  };
  const s1 = side(a, b), s2 = side(b, c), s3 = side(c, a);
  return (s1 >= -1e-6 && s2 >= -1e-6 && s3 >= -1e-6) || (s1 <= 1e-6 && s2 <= 1e-6 && s3 <= 1e-6);
}

/** The share of `low`'s face area that `high` doubles. */
export function doubledShare(low, high, t = TWIN) {
  const cos = Math.cos((t.angleDeg * Math.PI) / 180);
  const byTexture = new Map();
  for (const g of high.faces) {
    if (!byTexture.has(g.texture)) byTexture.set(g.texture, []);
    byTexture.get(g.texture).push(g);
  }
  let total = 0, doubled = 0;
  for (const f of low.faces) {
    total += f.area;
    for (const g of byTexture.get(f.texture) ?? []) {
      const dot = f.normal[0] * g.normal[0] + f.normal[1] * g.normal[1] + f.normal[2] * g.normal[2];
      if (dot < cos) continue;
      const d = (f.centroid[0] - g.centroid[0]) * g.normal[0] + (f.centroid[1] - g.centroid[1]) * g.normal[1] + (f.centroid[2] - g.centroid[2]) * g.normal[2];
      if (Math.abs(d) > t.distanceFt || !overTriangle(f.centroid, g.corners, g.normal)) continue;
      doubled += f.area;
      break;
    }
  }
  return total > 0 ? doubled / total : 0;
}

/**
 * The props not to draw at Normal and Complex detail: `props[i] = { meshes, matrix, pos, priority }` (game frame,
 * `matrix` row-major body to world, `meshes[].positions` triangle corners in body feet, `meshes[].textureName`), the
 * static props only. Returns the indexes of each pair's higher-priority twin; props of equal priority are left alone.
 */
export function twinPropsHidden(props, t = TWIN) {
  // Each prop's padded world box from its corners (cheap); its faces only when a pair needs them.
  const shapes = props.map((p) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const mesh of p.meshes) {
      const q = mesh.positions;
      for (let i = 0; i + 2 < q.length; i += 3) for (let r = 0; r < 3; r++) {
        const v = p.pos[r] + p.matrix[r * 3] * q[i] + p.matrix[r * 3 + 1] * q[i + 1] + p.matrix[r * 3 + 2] * q[i + 2];
        if (v < lo[r]) lo[r] = v;
        if (v > hi[r]) hi[r] = v;
      }
    }
    return { faces: Number.isFinite(lo[0]) ? null : [], lo: lo.map((v) => v - t.padFt), hi: hi.map((v) => v + t.padFt) };
  });
  const facesOf = (i) => (shapes[i].faces ??= worldFaces(props[i]).faces);
  // Pairs whose boxes can meet, through a grid of 256 ft cells on x and z.
  const CELL = 256, cells = new Map();
  shapes.forEach((s, i) => {
    if (s.faces && !s.faces.length) return;
    for (let cx = Math.floor(s.lo[0] / CELL); cx <= Math.floor(s.hi[0] / CELL); cx++) {
      for (let cz = Math.floor(s.lo[2] / CELL); cz <= Math.floor(s.hi[2] / CELL); cz++) {
        const key = `${cx},${cz}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
    }
  });
  const hidden = new Set(), seen = new Set();
  for (const list of cells.values()) {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const i = list[x], j = list[y], key = i < j ? `${i},${j}` : `${j},${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pi = props[i].priority ?? 0, pj = props[j].priority ?? 0;
      if (pi === pj) continue;
      const a = shapes[i], b = shapes[j];
      const lo = [0, 1, 2].map((k) => Math.max(a.lo[k], b.lo[k])), hi = [0, 1, 2].map((k) => Math.min(a.hi[k], b.hi[k]));
      const smaller = Math.min(volume(a.lo, a.hi), volume(b.lo, b.hi));
      if (!(smaller > 0) || volume(lo, hi) < t.overlap * smaller) continue;
      const [lowIndex, highIndex] = pi < pj ? [i, j] : [j, i];
      if (doubledShare({ faces: facesOf(lowIndex) }, { faces: facesOf(highIndex) }, t) >= t.doubled) hidden.add(highIndex);
    }
  }
  return hidden;
}
