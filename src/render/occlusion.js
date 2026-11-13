/*
  What is hidden behind something else is not drawn (occlusion culling).

  three.js skips what lies outside the view. In a city most of what lies inside it is behind the nearest walls: on a
  street of Nice Beaver six to eight in ten of the placed models in view, and the ground under the streets, cannot be
  seen at all, and each was still a draw and all its vertices, every frame.

  Each frame, once the solid scene is drawn, the box round each such thing in view is asked of the graphics card (an
  occlusion query: did any point of the box pass the scene's depth). A thing whose box was hidden two frames running is
  left out of the picture, and its box is asked again every frame, so it comes back the frame after its box shows. The
  box is `MARGIN_FT` larger every way than the thing: a box shows before the thing in it does, which covers the frame
  or two an answer takes. Only the picture taken with the race's own camera is culled; the sun's shadows, a mirror and
  the water's picture draw everything, since what is hidden from the eye still casts a shadow and shows in a mirror.

  The boxes are drawn by this module's own program and not through three.js, whose every draw costs as much on the
  processor as the draw it would spare: a few hundred boxes are then a few hundred plain calls.
*/
import * as THREE from "three";

/** How much larger than the thing its box is, feet every way: what the eye can come round in the frames an answer takes. */
const MARGIN_FT = 8;
/** How many frames running a box must have been hidden for its thing to be left out. */
const HIDDEN_FRAMES = 2;

const VERTEX = `#version 300 es
in vec3 position;
uniform mat4 uViewProjection;
uniform vec3 uCentre, uHalf;
void main() { gl_Position = uViewProjection * vec4( uCentre + position * uHalf, 1.0 ); }`;
const FRAGMENT = `#version 300 es
precision lowp float;
out vec4 colour;
void main() { colour = vec4( 0.0 ); }`;

const CORNERS = new Float32Array([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]);
const FACES = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);

/**
 * @param {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera }} env `camera` is the one whose
 *   picture is culled.
 * @returns `{ watch(mesh, box), stats, dispose() }`: `watch` a mesh that stands still in its parent, with `box` the
 *   box round it in its own frame as `() => [cx, cy, cz, hx, hy, hz] | null` (asked each frame: null while it has none).
 */
export function createOcclusion({ renderer, scene, camera }) {
  const gl = renderer.getContext();
  // The program and the box, made with the graphics card's bindings put back as three.js left them.
  const beforeProgram = gl.getParameter(gl.CURRENT_PROGRAM), beforeArray = gl.getParameter(gl.VERTEX_ARRAY_BINDING), beforeBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; };
  const vertex = shader(gl.VERTEX_SHADER, VERTEX), fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);
  const fit = gl.getProgramParameter(program, gl.LINK_STATUS);
  const uViewProjection = gl.getUniformLocation(program, "uViewProjection"), uCentre = gl.getUniformLocation(program, "uCentre"), uHalf = gl.getUniformLocation(program, "uHalf");
  const array = gl.createVertexArray(), corners = gl.createBuffer(), faces = gl.createBuffer();
  gl.bindVertexArray(array);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, faces);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FACES, gl.STATIC_DRAW);
  gl.bindVertexArray(beforeArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, beforeBuffer);
  gl.useProgram(beforeProgram);

  /** What is watched: `{ mesh, box, hidden, runs, query, asked, was }`. */
  const watched = [];
  /** Those left out of the picture being drawn, to be shown again when it is done (or before the shadows are drawn). */
  const out = [];
  /** Those whose boxes are asked this frame, with each box in the world: six numbers apiece in `boxes`. */
  let asking = [], boxes = new Float32Array(0);
  const stats = { watched: 0, inView: 0, hidden: 0, asked: 0 };
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), sphere = new THREE.Sphere(), eye = new THREE.Vector3();
  let armed = false, frame = 0, drawnFrame = -1;

  const restore = () => {
    for (const item of out) item.mesh.visible = item.was;
    out.length = 0;
  };
  const shownAbove = (mesh) => { for (let node = mesh.parent; node && node !== scene; node = node.parent) if (!node.visible) return false; return true; };

  /** Before the camera's picture: the answers that have come, which things are in view, which are left out, which are asked. */
  const prepare = () => {
    restore();
    frame++;
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    eye.setFromMatrixPosition(camera.matrixWorld);
    if (boxes.length < watched.length * 6) boxes = new Float32Array(watched.length * 6);
    asking = [];
    stats.watched = watched.length; stats.inView = stats.hidden = 0;
    for (const item of watched) {
      const mesh = item.mesh;
      if (item.query && gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) {
        const seen = gl.getQueryParameter(item.query, gl.QUERY_RESULT) !== 0;
        gl.deleteQuery(item.query);
        item.query = null;
        // An answer about a frame in which it was not in view all along says nothing now.
        if (item.asked >= item.since) { item.runs = seen ? 0 : item.runs + 1; item.hidden = item.runs >= HIDDEN_FRAMES; }
      }
      const local = mesh.visible && shownAbove(mesh) ? item.box() : null;
      let inView = false;
      if (local) {
        const e = mesh.matrixWorld.elements;
        const cx = local[0] + e[12], cy = local[1] + e[13], cz = local[2] + e[14], hx = local[3] + MARGIN_FT, hy = local[4] + MARGIN_FT, hz = local[5] + MARGIN_FT;
        sphere.center.set(cx, cy, cz);
        sphere.radius = Math.hypot(hx, hy, hz);
        // (The eye in the box: it is about the eye, and no answer could say it is hidden.)
        const inside = Math.abs(eye.x - cx) < hx + 2 && Math.abs(eye.y - cy) < hy + 2 && Math.abs(eye.z - cz) < hz + 2;
        inView = !inside && frustum.intersectsSphere(sphere);
        if (inView && !item.query) {
          const at = asking.length * 6;
          boxes[at] = cx; boxes[at + 1] = cy; boxes[at + 2] = cz; boxes[at + 3] = hx; boxes[at + 4] = hy; boxes[at + 5] = hz;
          asking.push(item);
        }
      }
      if (!inView) {
        // Out of view, or not drawn at all: when it comes back it is drawn until its box has been hidden anew.
        item.hidden = false; item.runs = 0; item.since = frame + 1;
        continue;
      }
      stats.inView++;
      if (item.hidden) {
        stats.hidden++;
        item.was = mesh.visible;
        mesh.visible = false;
        out.push(item);
      }
    }
    armed = fit && asking.length > 0;
  };

  /** After the solid scene is drawn: each asked box, drawn into nothing, counted by the graphics card. */
  const ask = () => {
    armed = false;
    stats.asked = asking.length;
    const state = renderer.state;
    const program0 = gl.getParameter(gl.CURRENT_PROGRAM), array0 = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    state.buffers.color.setMask(false);
    state.buffers.depth.setMask(false);
    state.buffers.depth.setTest(true);
    state.buffers.depth.setFunc(THREE.LessEqualDepth);
    state.disable(gl.CULL_FACE);
    state.disable(gl.BLEND);
    gl.useProgram(program);
    gl.bindVertexArray(array);
    gl.uniformMatrix4fv(uViewProjection, false, viewProjection.elements);
    for (let i = 0; i < asking.length; i++) {
      const item = asking[i], at = i * 6;
      gl.uniform3f(uCentre, boxes[at], boxes[at + 1], boxes[at + 2]);
      gl.uniform3f(uHalf, boxes[at + 3], boxes[at + 4], boxes[at + 5]);
      item.query = gl.createQuery();
      item.asked = frame;
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, item.query);
      gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
    }
    gl.bindVertexArray(array0);
    gl.useProgram(program0);
    state.buffers.color.setMask(true);
  };

  // Drawn last of what is solid (after the ground, render/track-scene.js `GROUND_ORDER`), a point that shows nothing:
  // three.js calls back as it draws it, which is when the boxes are asked.
  const hostGeometry = new THREE.BufferGeometry();
  hostGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
  const host = new THREE.Mesh(hostGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, fog: false }));
  host.name = "occlusion";
  host.frustumCulled = false;
  host.renderOrder = 0.95;
  host.onAfterRender = (r, s, drawnWith) => { if (armed && drawnWith === camera && drawnFrame !== frame) { drawnFrame = frame; ask(); } };
  scene.add(host);

  const sceneBefore = scene.onBeforeRender, sceneAfter = scene.onAfterRender;
  scene.onBeforeRender = function (r, s, drawnWith, target) {
    sceneBefore.call(this, r, s, drawnWith, target);
    // A headset's pictures are taken with cameras of its own: nothing is left out of them.
    if (drawnWith === camera && !renderer.xr.isPresenting) prepare();
    else { restore(); armed = false; }
  };
  scene.onAfterRender = function (r, s, drawnWith, target) {
    restore();
    armed = false;
    sceneAfter.call(this, r, s, drawnWith, target);
  };
  // The shadows are drawn from the whole scene, within the same picture, after three.js has listed what the camera sees:
  // render/sun-shadows.js calls this as it starts on them. (Asked through the scene, not by wrapping the renderer's
  // shadow pass, which the shadows wrap as well: whichever of the two was unwrapped second put the other's wrapper
  // back, and with it everything of a finished race that wrapper could reach.)
  scene.userData.beforeShadows = restore;

  return {
    watch(mesh, box) { watched.push({ mesh, box, hidden: false, runs: 0, query: null, asked: 0, since: 0, was: true }); },
    /** How many are watched, in view, left out and asked, as of the last picture. */
    stats,
    dispose() {
      restore();
      scene.onBeforeRender = sceneBefore;
      scene.onAfterRender = sceneAfter;
      if (scene.userData.beforeShadows === restore) delete scene.userData.beforeShadows;
      scene.remove(host);
      hostGeometry.dispose();
      host.material.dispose();
      for (const item of watched) if (item.query) gl.deleteQuery(item.query);
      watched.length = 0;
      gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
      gl.deleteVertexArray(array); gl.deleteBuffer(corners); gl.deleteBuffer(faces);
    },
  };
}
