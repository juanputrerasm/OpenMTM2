/*
  "MTM1 particles" drawn (the rules are game/mtm1-particles.js; MTM1_MONSTER_EXE_ANALYSIS.md 6.6): the particles as single
  points a screen pixel or two across, the size MTM1 drew them at 640 x 480, and the marks on the ground as one texture
  of 32 by 32 texels laid over each marked cell, following its ground. The world wraps, so both are drawn at the copy
  nearest the eye.
*/
import * as THREE from "three";
import {
  CELL_FT, POINTS, PER_POINT, PARTICLE_POOL, THROW_TICK_S, WORLD_FT, createGroundMarks, createParticlePool, groundTexel,
  particleVelocity, takesTracks, throwsParticles, tireThrow, trackTexels, trackWidth,
} from "../game/mtm1-particles.js";

/** The tire's width, feet (MTM2_PHYSICS.md: tire +0x74, 4 ft): its three throwing points stand across it. */
const TIRE_WIDTH = 4;

/** A cell's mark follows its ground in this many squares a side. */
const MARK_STEPS = 4;

/**
 * `ground(x, z)` is the ground's height in game feet; `atlas` and `clr` the level's ground art and CLR words, for the
 * particles' colour.
 */
export function createMtm1Particles({ scene, ground, atlas, clr, random = Math.random, worldFt = WORLD_FT }) {
  // The copy of the world nearest the eye, at the world's size (8192 ft, or a track format version 6 world's).
  const nearest = (v, to) => v + Math.round((to - v) / worldFt) * worldFt;
  const root = new THREE.Group();
  root.name = "mtm1-particles";
  scene.add(root);
  const pool = createParticlePool();
  const positions = new Float32Array(PARTICLE_POOL * 3), colours = new Float32Array(PARTICLE_POOL * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage));
  const pointMaterial = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true });
  const points = new THREE.Points(geometry, pointMaterial);
  points.frustumCulled = false;
  root.add(points);
  const colour = new THREE.Color();

  // The marked cells: a mesh each, laid over the ground with the cell's texels.
  const meshes = new Map();
  const markMaterial = (texture) => new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const marks = createGroundMarks({
    worldFt,
    onDrop: (cell) => {
      const mesh = meshes.get(cell.key);
      if (!mesh) return;
      mesh.removeFromParent();
      mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose();
      meshes.delete(cell.key);
    },
  });
  function cellMesh(cell) {
    let mesh = meshes.get(cell.key);
    if (mesh) return mesh;
    const texture = new THREE.DataTexture(cell.rgba, CELL_FT, CELL_FT, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    const n = MARK_STEPS + 1, vertex = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), index = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cell.col * CELL_FT + (i * CELL_FT) / MARK_STEPS, z = cell.row * CELL_FT + (j * CELL_FT) / MARK_STEPS, at = j * n + i;
        vertex.set([x, ground(x, z) + 0.06, -z], at * 3);
        uv.set([i / MARK_STEPS, j / MARK_STEPS], at * 2);
        if (i < MARK_STEPS && j < MARK_STEPS) index.push(at, at + n, at + 1, at + 1, at + n, at + n + 1);
      }
    }
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.BufferAttribute(vertex, 3));
    shape.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    shape.setIndex(index);
    mesh = new THREE.Mesh(shape, markMaterial(texture));
    mesh.renderOrder = 2;
    mesh.userData.cell = cell;
    root.add(mesh);
    meshes.set(cell.key, mesh);
    return mesh;
  }

  const states = [];
  return {
    /**
     * Once a frame. `trucks` as the tire effects take them: `{ object, pose, tires, radius }` (`tires` the simulation's,
     * with `onGround`, `surface` and `spin`); `pixelSize` the size of a point on the screen.
     */
    update({ dt, trucks, camera, pixelSize = 2 }) {
      trucks.forEach((t, i) => {
        if (!t?.object || !t.tires) return;
        const state = states[i] ??= { timer: 0, last: [null, null, null, null], centre: null, speed: 0 };
        const hubs = t.tires.map((_, k) => t.object.tireHub(k));
        if (hubs.some((h) => !h)) return;
        // The truck's level axes and its speed along them, from where its wheels are.
        const centre = [(hubs[0][0] + hubs[1][0] + hubs[2][0] + hubs[3][0]) / 4, 0, (hubs[0][2] + hubs[1][2] + hubs[2][2] + hubs[3][2]) / 4];
        let fx = hubs[0][0] + hubs[1][0] - hubs[2][0] - hubs[3][0], fz = hubs[0][2] + hubs[1][2] - hubs[2][2] - hubs[3][2];
        const len = Math.hypot(fx, fz) || 1;
        fx /= len; fz /= len;
        const forward = [fx, 0, fz], right = [fz, 0, -fx];
        if (state.centre && dt > 0) state.speed = ((centre[0] - state.centre[0]) * fx + (centre[2] - state.centre[2]) * fz) / dt;
        state.centre = centre;
        state.timer += dt;
        const tick = state.timer >= THROW_TICK_S;
        if (tick) state.timer %= THROW_TICK_S;
        t.tires.forEach((tire, k) => {
          const hub = hubs[k];
          if (!tire.onGround) { state.last[k] = null; return; }
          const type = Math.floor((tire.surface ?? 0) / 100), at = [hub[0], ground(hub[0], hub[2]), hub[2]];
          // The track: from where the tire touched last to where it touches now.
          if (takesTracks(type) && state.last[k]) for (const [x, z] of trackTexels(state.last[k][0], state.last[k][2], at[0], at[2], trackWidth(t.radius))) marks.mark(x, z);
          state.last[k] = at;
          if (!tick || !throwsParticles(type) || Math.abs(state.speed) < 1) return;
          const thrown = tireThrow({ forward, right, rimSpeed: (t.radius ?? 3) * (tire.spin ?? 0), forwardSpeed: state.speed }, random);
          const tone = groundTexel(atlas, clr, at[0], at[2], worldFt) ?? [120, 100, 80];
          for (let p = 0; p < POINTS; p++) {
            const side = (p - 1) * (TIRE_WIDTH / 2);
            const from = [at[0] + right[0] * side, at[1] + 0.2, at[2] + right[2] * side];
            for (let n = 0; n < PER_POINT; n++) pool.throw(from, particleVelocity(thrown, random), tone);
          }
        });
      });
      pool.step(dt, ground, (x, z, tone) => marks.mark(x, z, tone));

      // The points, at the copy of the world nearest the eye; a spent one far below it.
      const eyeX = camera.position.x, eyeZ = -camera.position.z;
      pool.particles.forEach((p, n) => {
        if (p.life <= 0) { positions.set([0, -1e6, 0], n * 3); return; }
        positions.set([nearest(p.pos[0], eyeX), p.pos[1], -nearest(p.pos[2], eyeZ)], n * 3);
        colour.setRGB(p.colour[0] / 255, p.colour[1] / 255, p.colour[2] / 255, THREE.SRGBColorSpace);
        colours.set([colour.r, colour.g, colour.b], n * 3);
      });
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      pointMaterial.size = pixelSize;

      // The marks: new and changed cells to the graphics card, each cell at the copy nearest the eye.
      for (const cell of marks.cells.values()) {
        const mesh = cellMesh(cell);
        if (cell.dirty) mesh.material.map.needsUpdate = true;
        const cx = cell.col * CELL_FT + CELL_FT / 2, cz = cell.row * CELL_FT + CELL_FT / 2;
        mesh.position.set(nearest(cx, eyeX) - cx, 0, -(nearest(cz, eyeZ) - cz));
      }
      marks.clean();
    },
    dispose() {
      for (const mesh of meshes.values()) { mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose(); }
      meshes.clear();
      geometry.dispose();
      pointMaterial.dispose();
      root.removeFromParent();
    },
  };
}
