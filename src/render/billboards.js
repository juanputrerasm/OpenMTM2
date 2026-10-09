/*
  Sprites in the scene from a sheet of cells (the effect art is `grid.x` by `grid.y` cells), as one
  instanced draw: each instance has a position, a size in feet, a cell and a brightness. Black in
  the sheet is background, so the sprites are added to the picture. `flat` lays them on the ground
  (ripples) instead of facing the camera.
*/
import * as THREE from "three";

/** A sheet as a texture from `{ width, height, rgba }` (rows from the top). */
export function sheetTexture({ width, height, rgba }) {
  const texture = new THREE.DataTexture(new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)), width, height, THREE.RGBAFormat);
  texture.flipY = false;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createBillboards({ sheet, grid, capacity, flat = false, tint = [1, 1, 1] }) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  geometry.setAttribute("uv", base.getAttribute("uv"));
  const position = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  const light = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("iPos", position);
  geometry.setAttribute("iSize", size);
  geometry.setAttribute("iCell", cell);
  geometry.setAttribute("iLight", light);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: sheetTexture(sheet) }, grid: { value: new THREE.Vector2(grid[0], grid[1]) }, tint: { value: new THREE.Vector3(...tint) } },
    vertexShader: `
      attribute vec3 iPos; attribute vec2 iSize; attribute float iCell; attribute float iLight;
      uniform vec2 grid; varying vec2 vUv; varying float vLight;
      void main() {
        vec4 view = modelViewMatrix * vec4(iPos, 1.0);
        ${flat
    ? "vec4 world = modelMatrix * vec4(iPos + vec3(position.x * iSize.x, 0.0, -position.y * iSize.y), 1.0); gl_Position = projectionMatrix * viewMatrix * world;"
    : "view.xy += position.xy * iSize; gl_Position = projectionMatrix * view;"}
        vec2 c = vec2(mod(iCell, grid.x), floor(iCell / grid.x));
        vUv = (c + vec2(uv.x, 1.0 - uv.y)) / grid;
        vLight = iLight;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 tint; varying vec2 vUv; varying float vLight;
      void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb * tint * vLight, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    object: mesh,
    capacity,
    /** Set instance `i`: position (scene), size (w, h in feet), cell and brightness. */
    set(i, x, y, z, w, h, c, l = 1) {
      position.setXYZ(i, x, y, z); size.setXY(i, w, h); cell.setX(i, c); light.setX(i, l);
    },
    /** After setting `count` instances this frame. */
    commit(count) {
      geometry.instanceCount = count;
      position.needsUpdate = size.needsUpdate = cell.needsUpdate = light.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.uniforms.map.value.dispose(); material.dispose(); },
  };
}
