/*
  Community Patch 4's 3D cockpit (CP4_EXE_ANALYSIS.md 6), drawn in the scene around the player's eye.

  `build` is the asset worker's (worker/cockpit3d.js): the layout the rules chose and its models and textures. The
  cab and the model lamps are in the truck's body frame and hang from the truck as they are; each moving part (the
  two needles, the wheel and the shifter) stands at its pivot and turns about its axis by the angle the layout gives
  (game/cockpit3d.js). Only the current gear's lamp is drawn, and the shift light above its rpm, both self-lit.

  The scene mirrors z (shared/scene-frame.js). A part's angle is clockwise as the driver sees it about +z, which in
  the scene is a turn about the mirrored axis (ax, ay, -az) by the same angle.

  The mirror is a second view, drawn where the mirror's corners fall on the screen: their bounding box, clipped to
  the screen, from the eye looking back and flipped left to right. It is drawn to a texture first and then over the
  frame through a scissor, so the flip keeps the faces' winding.
*/
import * as THREE from "three";
import { createModelLibrary, disposeObject } from "./track-scene.js";
import {
  COCKPIT_CENTRE_ROW, DEFAULT_EYE, gearLampLit, layoutVerticalFov, mirrorCorners, mirrorFaces, mirrorVerticalFov, shiftLightLit,
  sceneTurn, shifterDegrees, speedoDegrees, tachDegrees, viewDirection, wheelDegrees,
} from "../game/cockpit3d.js";

/** The cab is within this many feet of the eye; the flare's cover ray goes no further. */
const COVER_REACH_FT = 30;
/** cos(0.25 degree): the sun's move in the cab's frame below which the last cover test stands. */
const COVER_KEEP_COS = Math.cos(0.25 * Math.PI / 180);

const scratchAxis = new THREE.Vector3();
const toScene = ([x, y, z]) => new THREE.Vector3(x, y, -z);

/** The layout's moving-part angle as a scene rotation: the axis mirrored in z, the angle as it is. */
export function partQuaternion(axis, degrees, out = new THREE.Quaternion()) {
  const turn = sceneTurn(axis, degrees);
  return out.setFromAxisAngle(scratchAxis.fromArray(turn.axis), turn.radians);
}

function meshesOf(library, name) {
  const group = new THREE.Group();
  for (const { geometry, material, renderOrder } of library.get(name) ?? []) {
    const mesh = new THREE.Mesh(geometry, material);
    if (renderOrder) mesh.renderOrder = renderOrder;
    group.add(mesh);
  }
  return group;
}

/** A lamp drawn at full brightness (emissive 1.0): its materials copied and lit by themselves. */
function selfLit(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const material = o.material.clone();
    if (material.emissive) {
      material.emissive.set(0xffffff);
      material.emissiveMap = material.map ?? null;
      material.emissiveIntensity = 1;
    }
    o.material = material;
  });
  return group;
}

/**
 * @param {object} build worker/cockpit3d.js `buildCockpit3d`
 * @param {string} look the look (settings.look)
 */
export function createCockpit3d(build, look) {
  const { layout } = build;
  const library = createModelLibrary(build.models, build.textures, look);
  const root = new THREE.Group();
  root.name = "cockpit3d";
  root.matrixAutoUpdate = false;
  root.visible = false;
  root.add(meshesOf(library, layout.cab));
  const pivots = {};
  for (const key of ["speedo", "tach", "wheel", "shifter"]) {
    const part = layout[key];
    if (!part) continue;
    const pivot = new THREE.Group();
    pivot.position.copy(toScene(part.pivot));
    const turn = new THREE.Group();
    turn.add(meshesOf(library, part.model));
    pivot.add(turn);
    root.add(pivot);
    pivots[key] = turn;
  }
  // The lamps with a model; a quad lamp's colour is not known yet (CP4_EXE_ANALYSIS.md 6), so it is not drawn.
  const lamps = layout.gearLamps.map((lamp) => {
    if (!lamp?.model) return null;
    const group = selfLit(meshesOf(library, lamp.model));
    root.add(group);
    return group;
  });
  const shiftLight = layout.shiftLight?.model ? selfLit(meshesOf(library, layout.shiftLight.model)) : null;
  if (shiftLight) root.add(shiftLight);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  const eye = layout.eye ?? DEFAULT_EYE;
  const verticalFov = layoutVerticalFov(layout);
  const scratch = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };

  // The mirror pass: a camera, a texture it draws to, and the flipped quad that puts it on the screen.
  const mirrorCamera = new THREE.PerspectiveCamera(40, 1, 0.5, 20000);
  const flipBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  let target = null;
  const blitGeometry = new THREE.PlaneGeometry(2, 2);
  const uv = blitGeometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const blitMaterial = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
  const blitScene = new THREE.Scene();
  blitScene.add(new THREE.Mesh(blitGeometry, blitMaterial));
  const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  const corner = new THREE.Vector3(), viewSpace = new THREE.Vector3();
  const corners = layout.mirror ? mirrorCorners(layout.mirror) : [];
  // The lens flare's cover test (`covers`).
  const coverRay = new THREE.Raycaster(), coverInverse = new THREE.Matrix4();
  const coverDir = new THREE.Vector3(), coverDirWorld = new THREE.Vector3(), coverEye = new THREE.Vector3();
  const coverLastDir = new THREE.Vector3(), coverLastEye = new THREE.Vector3();
  let coverHit = null;

  return {
    root,
    /** The eye, feet in the body frame. */
    eye,
    /** The layout's vertical field of view, degrees. */
    verticalFov,
    layout,
    setVisible(visible) { root.visible = !!visible; },
    /**
     * Whether the cab stands between `origin` (the eye, scene feet) and the sun along `direction` (unit, scene): the
     * lens flare's cover, as the game's flare is hidden by what is drawn in front of the sun. One ray through the
     * cab's triangles, kept while the sun stays within a quarter degree in the cab's own frame.
     */
    covers(origin, direction) {
      if (!root.visible) return false;
      root.updateMatrixWorld(true);
      coverInverse.copy(root.matrixWorld).invert();
      coverDir.copy(direction).transformDirection(coverInverse);
      coverEye.copy(origin).applyMatrix4(coverInverse);
      if (coverHit !== null && coverDir.dot(coverLastDir) > COVER_KEEP_COS && coverEye.distanceToSquared(coverLastEye) < 0.01) return coverHit;
      coverRay.set(origin, coverDirWorld.copy(direction).normalize());
      coverRay.far = COVER_REACH_FT;
      coverHit = coverRay.intersectObject(root, true).length > 0;
      coverLastDir.copy(coverDir);
      coverLastEye.copy(coverEye);
      return coverHit;
    },
    /** Hang the cockpit from the truck: `body` the truck's scene matrix (shared/scene-frame.js `toSceneMatrix`). */
    pose(body) {
      root.matrix.copy(body);
      root.matrixWorldNeedsUpdate = true;
    },
    /** The instruments for the truck's state: `speed` ft/s, `rpm`, `gear` (1 Park to 6 third), `steer` radians, right positive. */
    update({ speed = 0, rpm = 0, gear = 1, steer = 0 }) {
      if (pivots.speedo) partQuaternion(layout.speedo.axis, speedoDegrees(layout.speedo, speed), pivots.speedo.quaternion);
      if (pivots.tach) partQuaternion(layout.tach.axis, tachDegrees(layout.tach, rpm), pivots.tach.quaternion);
      if (pivots.wheel) partQuaternion(layout.wheel.axis, wheelDegrees(layout.wheel, steer), pivots.wheel.quaternion);
      if (pivots.shifter) partQuaternion(layout.shifter.axis, shifterDegrees(layout.shifter, gear), pivots.shifter.quaternion);
      lamps.forEach((lamp, i) => { if (lamp) lamp.visible = gearLampLit(i, gear); });
      if (shiftLight) shiftLight.visible = shiftLightLit(layout.shiftLight, rpm);
    },
    /**
     * The camera at the eye: the body's turn, then the head's (`turn`, radians right, the View keys), then the smooth
     * look's `yaw` (right) and `pitch` (up). `body` is the truck's scene matrix.
     */
    placeCamera(camera, body, { turn = 0, yaw = 0, pitch = 0 } = {}) {
      body.decompose(scratch.position, scratch.quaternion, scratch.scale);
      camera.position.copy(toScene(eye)).applyMatrix4(body);
      camera.quaternion.copy(scratch.quaternion);
      if (turn + yaw) camera.rotateY(-(turn + yaw));
      if (pitch) camera.rotateX(pitch);
      // CP4's centre row (COCKPIT_CENTRE_ROW): the projection's centre raised from the middle of the screen. Kept on
      // the projection itself, so any updateProjectionMatrix (a resize, the lens set for another view) undoes it.
      const shift = -(1 - 2 * COCKPIT_CENTRE_ROW);
      const m = camera.projectionMatrix.elements;
      if (m[9] !== shift) {
        camera.updateProjectionMatrix();
        m[9] = shift;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }
    },
    /**
     * The rear-view mirror over the frame just drawn, when the layout has one and it faces the eye within 60 degrees of
     * the view (`turn`, `yaw`, `pitch` as for `placeCamera`). `drawOver(camera)` draws what goes over the scene.
     * Returns whether it was drawn.
     */
    drawMirror(renderer, scene, camera, body, { turn = 0, yaw = 0, pitch = 0, drawOver = null } = {}) {
      if (!layout.mirror || !mirrorFaces(layout.mirror, eye, viewDirection(turn + yaw, pitch))) return false;
      renderer.getSize(size);
      camera.updateMatrixWorld();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of corners) {
        corner.copy(toScene(c)).applyMatrix4(body);
        viewSpace.copy(corner).applyMatrix4(camera.matrixWorldInverse);
        if (viewSpace.z >= 0) return false;
        corner.project(camera);
        const px = (corner.x + 1) / 2 * size.x, py = (1 - corner.y) / 2 * size.y;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(size.x, Math.ceil(x1)); y1 = Math.min(size.y, Math.ceil(y1));
      const w = x1 - x0, h = y1 - y0;
      if (w < 1 || h < 1) return false;
      const ratio = renderer.getPixelRatio();
      const tw = Math.max(1, Math.round(w * ratio)), th = Math.max(1, Math.round(h * ratio));
      if (!target) target = new THREE.WebGLRenderTarget(tw, th);
      else if (target.width !== tw || target.height !== th) target.setSize(tw, th);
      body.decompose(scratch.position, scratch.quaternion, scratch.scale);
      mirrorCamera.position.copy(toScene(eye)).applyMatrix4(body);
      mirrorCamera.quaternion.copy(scratch.quaternion).multiply(flipBack);
      mirrorCamera.aspect = w / h;
      mirrorCamera.fov = mirrorVerticalFov(layout.mirror.zoom, w / h);
      mirrorCamera.far = camera.far;
      mirrorCamera.updateProjectionMatrix();
      const shown = root.visible;
      // The cab is not in its own mirror's picture: the view back from the eye would be its back wall.
      root.visible = false;
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, mirrorCamera);
        drawOver?.(mirrorCamera);
      } finally {
        root.visible = shown;
        renderer.setRenderTarget(previous);
      }
      blitMaterial.map = target.texture;
      const y = size.y - y1;
      renderer.setScissorTest(true);
      renderer.setScissor(x0, y, w, h);
      renderer.setViewport(x0, y, w, h);
      try {
        renderer.render(blitScene, blitCamera);
      } finally {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
      }
      return true;
    },
    dispose() {
      root.removeFromParent();
      disposeObject(root);
      target?.dispose();
      blitGeometry.dispose();
      blitMaterial.dispose();
    },
  };
}
