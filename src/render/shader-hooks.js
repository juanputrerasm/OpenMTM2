/*
  Several parts of the port's scenery add lines to the same material's shader: the ground in
  the weather (render/ground-surface.js) and the ground's fine detail (render/ground-detail.js)
  both dress the terrain's material. three.js gives a material one `onBeforeCompile`; this
  keeps a list behind it.

  Each hook has a key, which says what its lines are made with: two materials whose hooks have
  the same keys share a compiled shader, and two that differ do not. Hooks run in the order of
  their `order`, lowest first, whatever order they were added in, so one that replaces a chunk
  of three.js's can be made to run after those that add lines beside it.
*/

/**
 * Add `fn(shader)` to what runs before `material`'s shader is compiled.
 * @param {object} material a three.js material
 * @param {string|(() => string)} key what tells this hook's lines from another's; a function for a hook whose lines
 *   can change after it was added (render/ground-detail.js), whose material is then marked `needsUpdate`
 * @param {number} order where it runs among the material's hooks, lowest first
 * @param {(shader: object, renderer: object) => void} fn
 */
export function addShaderHook(material, key, order, fn) {
  let hooks = material.userData.shaderHooks;
  if (!hooks) {
    hooks = material.userData.shaderHooks = [];
    // A hook someone gave the material before this (the sun's shadow cascades, render/sun-shadows.js) is kept, and runs last.
    if (Object.prototype.hasOwnProperty.call(material, "onBeforeCompile")) {
      const earlier = material.onBeforeCompile;
      hooks.push({ key: material.customProgramCacheKey(), order: Infinity, fn: (shader, renderer) => earlier.call(material, shader, renderer) });
    }
  }
  hooks.push({ key, order, fn });
  hooks.sort((a, b) => a.order - b.order);
  material.onBeforeCompile = (shader, renderer) => { for (const hook of hooks) hook.fn(shader, renderer); };
  material.customProgramCacheKey = () => `mtm-hooks|${hooks.map((hook) => (typeof hook.key === "function" ? hook.key() : hook.key)).join("|")}`;
  material.needsUpdate = true;
  return material;
}
