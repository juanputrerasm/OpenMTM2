/*
  Smooth normals for a model's triangles (from JSTruckViewer's bin-decoder).

  A .BIN stores no vertex normals, so lighting each triangle with its face normal shades every
  polygon flat and the low-poly bodies come out faceted, most of all under the sun shadows.

  Each corner instead takes the area-weighted average of the faces that meet at its position,
  across every mesh of the model, so a texture seam does not show as a shading seam. Faces bent
  further than the crease angle from the corner's own face are left out, which keeps the hard
  edges a truck has: bumper corners, wheel-well lips, the cab against the bed. The same test
  drops a two-sided face's back copy, whose normal points the other way.

  Pure: typed arrays or plain arrays in, no three.js, so the worker, the renderer and the tests use it.
*/

export const SMOOTHING_CREASE_DEGREES = 60;

// The unnormalised cross product: its length is twice the triangle's area, which is the weight.
function weightedFaceNormal(positions, i) {
  const abx = positions[i + 3] - positions[i], aby = positions[i + 4] - positions[i + 1], abz = positions[i + 5] - positions[i + 2];
  const acx = positions[i + 6] - positions[i], acy = positions[i + 7] - positions[i + 1], acz = positions[i + 8] - positions[i + 2];
  const x = aby * acz - abz * acy, y = abz * acx - abx * acz, z = abx * acy - aby * acx;
  return { x, y, z, length: Math.hypot(x, y, z) };
}

function positionKey(positions, i) {
  return `${Math.round(positions[i] * 1000)},${Math.round(positions[i + 1] * 1000)},${Math.round(positions[i + 2] * 1000)}`;
}

/**
 * Rewrites `normals` of every mesh in place. Each mesh is unindexed triangles: nine `positions`
 * values and nine `normals` values per triangle. A degenerate triangle keeps the normals it has.
 * @param {{ positions: ArrayLike<number>, normals: number[] | Float32Array }[]} meshes one model's meshes
 */
export function smoothNormals(meshes, creaseDegrees = SMOOTHING_CREASE_DEGREES) {
  const cosCrease = Math.cos((creaseDegrees * Math.PI) / 180);
  const facesAtPosition = new Map();
  const faceNormals = meshes.map(({ positions }) => {
    const normals = [];
    for (let i = 0; i + 8 < positions.length; i += 9) {
      const normal = weightedFaceNormal(positions, i);
      normals.push(normal);
      for (let corner = 0; corner < 3; corner++) {
        const key = positionKey(positions, i + corner * 3);
        let faces = facesAtPosition.get(key);
        if (!faces) facesAtPosition.set(key, (faces = []));
        faces.push(normal);
      }
    }
    return normals;
  });

  meshes.forEach(({ positions, normals }, meshIndex) => {
    faceNormals[meshIndex].forEach((own, face) => {
      if (!own.length) return;
      for (let corner = 0; corner < 3; corner++) {
        const offset = face * 9 + corner * 3;
        let x = 0, y = 0, z = 0;
        for (const other of facesAtPosition.get(positionKey(positions, offset))) {
          if (!other.length) continue;
          const cos = (own.x * other.x + own.y * other.y + own.z * other.z) / (own.length * other.length);
          if (cos >= cosCrease) { x += other.x; y += other.y; z += other.z; }
        }
        const length = Math.hypot(x, y, z);
        if (length > 0) {
          normals[offset] = x / length;
          normals[offset + 1] = y / length;
          normals[offset + 2] = z / length;
        }
      }
    });
  });
}
