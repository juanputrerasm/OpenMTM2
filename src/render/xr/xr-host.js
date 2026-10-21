/*
  The renderer and its immersive session (docs/VR.md, "The host").

  One WebGL renderer and canvas serve every race, so a headset session survives from one screen
  to the next: an immersive session is bound to a WebGL context, and a renderer made per race
  would end it. A screen that draws borrows the canvas, hands over its scene and its frame
  function (`start`), and gives them back (`release`). While a session runs with no screen
  drawing, the idle stage (idle-stage.js) keeps the headset drawn.

  Scale. The scene is in feet and a headset reports metres. The tracking space is the `rig`
  group, scaled by FEET_PER_METRE where it is placed, so what hangs from the rig (the head, the
  controllers, the seat and its boards) is in metres and the world is life size.

  The eyes. three.js would carry the rig's scale into the eye cameras' view matrices, which
  makes view space metres: fog distances, light ranges, sprite sizes and the shadow cascades,
  all written in feet, would then be wrong by 3.28. `placeRig` instead keeps view space in feet:
  it strips the scale from each eye's world matrix and folds it into the projection, where a
  uniform scale of view space is only a change of the near and far distances (the one element
  that holds them is multiplied by FEET_PER_METRE). The picture and the depth buffer are
  identical to the scaled ones; the session is told the planes in metres, so its depth stays
  metric.
*/
import * as THREE from "three";
import { FEET_PER_METRE } from "../../shared/scene-frame.js";
import { snapshotGamepad } from "../../game/vr/controls.js";
import { NO_CALIBRATION, calibrate } from "../../game/vr/pose.js";
import { vrSettings } from "../../game/vr/settings.js";
import { screenSampled } from "../../game/aa.js";
import { createIdleStage } from "./idle-stage.js";
import { createGpuPacer } from "../gpu-pacer.js";
import { createVrMenu } from "./vr-panel.js";
import { installAtmosphere } from "../atmosphere.js";

// Before this renderer compiles its first material: the fog's shader chunks (render/atmosphere.js).
installAtmosphere();

/** The eyes' near and far planes, metres: 10 cm, and the flat camera's 20000 ft. */
const NEAR_M = 0.1, FAR_M = 20000 / FEET_PER_METRE;
const ONE = new THREE.Vector3(1, 1, 1);

/** @param {{ settings: object }} context the app's context: `settings.vr` holds the player's VR preferences */
export function createXrHost(context) {
  const canvas = document.createElement("canvas");
  /*
    The context is the one three.js would make (r169's attributes for it), with samples on the screen's own picture only
    where the settings draw the scene straight onto it (game/aa.js `screenSampled`). three.js is told the context has
    samples: its WebXR manager gives a headset's pictures as many as it reads there, and those keep theirs. And it is
    told the context has no alpha, as it would have had it from three.js's own default.
  */
  const gl = canvas.getContext("webgl2", {
    alpha: true, depth: true, stencil: false, antialias: screenSampled(context.settings),
    premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "default", failIfMajorPerformanceCaveat: false,
  });
  if (gl) {
    const attributes = gl.getContextAttributes.bind(gl);
    gl.getContextAttributes = () => ({ ...attributes(), alpha: false, antialias: true });
  }
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl ?? null });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const xr = renderer.xr;
  xr.enabled = true;
  // The cameras are readied by hand, once the rig is placed (placeRig).
  xr.cameraAutoUpdate = false;
  // The origin near where the head was when the session began. Recentring is the rig's work.
  xr.setReferenceSpaceType("local");

  const rig = new THREE.Group();
  rig.name = "vr-rig";
  rig.matrixAutoUpdate = false;
  // The seat: the calibrated driving position within the tracking space, looking down its -z.
  const seat = new THREE.Group();
  seat.name = "vr-seat";
  // The head's camera. three.js writes the viewer's pose into it each frame.
  const camera = new THREE.PerspectiveCamera(70, 1, NEAR_M, FAR_M);
  rig.add(seat, camera);

  const head = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), valid: false };
  let calibration = NO_CALIBRATION;
  /** A recentre is due on the next frame that has a head pose. */
  let recenterDue = false;
  let session = null, entering = false;
  let loop = null, last = performance.now(), idle = null;
  const listeners = new Map();
  const emit = (name, detail) => { for (const fn of [...(listeners.get(name) ?? [])]) fn(detail); };

  /* The controllers: three.js keeps a group per input source for its ray and one for its grip. */
  const hands = { left: null, right: null };
  const controllers = [0, 1].map((index) => {
    const ray = xr.getController(index), grip = xr.getControllerGrip(index);
    const c = { index, ray, grip, source: null, beam: controllerBeam(), body: controllerBody() };
    ray.add(c.beam);
    grip.add(c.body);
    ray.addEventListener("connected", (e) => { c.source = e.data; });
    ray.addEventListener("disconnected", () => { c.source = null; });
    // A pinch or a gaze tap has no gamepad to read: its select is passed on as an event.
    ray.addEventListener("select", () => { if (!c.source?.gamepad) emit("select", c); });
    rig.add(ray, grip);
    return c;
  });
  const _local = new THREE.Vector3(), _vertical = new THREE.Vector3(0, 1, 0);

  /** This frame's controllers as plain data: buttons and axes by hand, and the hand's place on the seat (metres). */
  function readHands() {
    hands.left = hands.right = null;
    if (!xr.isPresenting) return;
    for (const c of controllers) {
      const side = c.source?.handedness;
      if (!c.source || !c.ray.visible || (side !== "left" && side !== "right")) continue;
      // Tracking space to seat space: the calibration undone.
      _local.setFromMatrixPosition(c.grip.visible ? c.grip.matrix : c.ray.matrix).sub(seat.position).applyAxisAngle(_vertical, -calibration.yaw);
      hands[side] = { ...(snapshotGamepad(c.source.gamepad) ?? { buttons: [], axes: [] }), position: _local.toArray(), controller: c };
    }
  }

  /** Each hand's pointing ray in the scene, once the rig is placed. */
  function placeHands() {
    for (const hand of [hands.left, hands.right]) {
      if (!hand) continue;
      const ray = hand.controller.ray;
      hand.origin = new THREE.Vector3().setFromMatrixPosition(ray.matrixWorld);
      hand.direction = new THREE.Vector3(0, 0, -1).transformDirection(ray.matrixWorld);
    }
  }

  function readHead(frame) {
    const space = xr.getReferenceSpace();
    const pose = frame && space ? frame.getViewerPose(space) : null;
    if (!pose) return;
    head.position.copy(pose.transform.position);
    head.quaternion.copy(pose.transform.orientation);
    head.valid = true;
  }

  /** Make where the head is now the driving position. */
  function recenter() {
    if (!head.valid) {
      recenterDue = true;
      return false;
    }
    recenterDue = false;
    calibration = calibrate(head.position.toArray(), head.quaternion.toArray());
    seat.position.fromArray(calibration.position);
    seat.rotation.set(0, calibration.yaw, 0);
    emit("recenter");
    return true;
  }

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _other = new THREE.Vector3();
  /** Per eye camera: the projection element that holds the planes, as it was left here. */
  const converted = new WeakMap();
  /**
   * The eye cameras for this frame, in feet (see the top of the file), and the flat camera
   * `proxy` put where the head is in the scene, so that everything following the camera (the
   * sky, billboards, rain, the sound's listener) follows the head.
   */
  function readyCameras(proxy) {
    rig.updateMatrixWorld(true);
    const eyes = xr.getCamera();
    for (const eye of eyes.cameras) {
      // On a frame that has a pose three.js writes each eye's projection afresh, the near and
      // far planes in metres. A frame without one (tracking lost) leaves what was written
      // here, which must not be converted twice.
      const e = eye.projectionMatrix.elements;
      if (converted.get(eye) === e[14]) continue;
      e[14] *= FEET_PER_METRE;
      converted.set(eye, e[14]);
      eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
    }
    // World matrices through the rig, the camera both eyes fit in (for culling), the head's camera.
    xr.updateCamera(camera);
    for (const eye of [eyes, ...eyes.cameras]) {
      eye.matrixWorld.decompose(_p, _q, _s);
      eye.matrixWorld.compose(_p, _q, ONE);
      eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
      eye.near = NEAR_M * FEET_PER_METRE;
      eye.far = FAR_M * FEET_PER_METRE;
    }
    placeHands();
    if (!proxy) return;
    camera.matrixWorld.decompose(proxy.position, proxy.quaternion, _s);
    const [l, r] = eyes.cameras;
    // Midway between the eyes.
    if (l && r) proxy.position.setFromMatrixPosition(l.matrixWorld).add(_other.setFromMatrixPosition(r.matrixWorld)).multiplyScalar(0.5);
    const e = (l ?? eyes).projectionMatrix.elements;
    proxy.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1 / e[5]));
    proxy.aspect = e[5] / e[0];
    proxy.updateProjectionMatrix();
    proxy.updateMatrixWorld();
  }

  /*
    The frame loop: the window's frames, or the headset's while a session runs. It is set once
    and left running (three.js moves it between the two as a session starts and ends; setting
    it again during a session would start the window's frames beside the headset's). With no
    screen drawing and no session, a frame does nothing.

    The window's frames wait for the graphics card (render/gpu-pacer.js): one that comes while
    the card is two frames behind is skipped, and the next takes its time. A headset paces its
    own frames and must be given every one.
  */
  const pacer = createGpuPacer(renderer.getContext());
  const frameOf = (frame) => {
    const now = performance.now();
    const paced = loop && !xr.isPresenting;
    if (paced && pacer.behind(now)) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (xr.isPresenting) readHead(frame);
    readHands();
    if (loop) loop(dt, now);
    else if (xr.isPresenting) (idle ??= createIdleStage(host)).frame(dt, now);
    if (paced) pacer.drawn(now);
  };
  /*
    V-sync (Options, Display): off, the window's frames come from a timer instead of the display's refresh, as fast as the
    browser runs one (about 250 a second). The animation loop stays set, for a session's frames and as what notices the
    setting; with V-sync off it only starts the timer, and the window's frames come from the timer alone.
  */
  const vsyncOff = () => context.settings.vsync === false && !xr.isPresenting;
  let timer = 0;
  const spin = () => {
    timer = 0;
    if (!vsyncOff()) return;
    frameOf(null);
    timer = setTimeout(spin, 0);
  };
  const tick = (_time, frame) => {
    if (!vsyncOff()) frameOf(frame);
    else if (!timer) timer = setTimeout(spin, 0);
  };
  renderer.setAnimationLoop(tick);

  const onVisibility = () => emit("visibility", session?.visibilityState ?? "hidden");
  const onReset = () => { recenterDue = true; };
  xr.addEventListener("sessionstart", () => {
    session = xr.getSession();
    pacer.reset();
    head.valid = false;
    recenterDue = true;
    session.addEventListener("visibilitychange", onVisibility);
    // The headset's own recentre moves the tracking space's origin: take the driving position again.
    xr.getReferenceSpace()?.addEventListener?.("reset", onReset);
    emit("start");
  });
  xr.addEventListener("sessionend", () => {
    session = null;
    head.valid = false;
    hands.left = hands.right = null;
    idle?.leave();
    emit("end");
  });

  const host = {
    renderer, canvas, rig, seat, camera, head, hands, controllers,
    /** The one menu board, worked by controllers and keys (vr-panel.js). */
    menu: null,
    /** What the idle stage shows: a menu (game/vr/menu.js `createMenu`), or null for its default. */
    board: null,
    get presenting() { return xr.isPresenting; },
    get session() { return session; },
    /** The driving position (game/vr/pose.js `calibrate`). */
    get calibration() { return calibration; },
    /** Listen to "start", "end", "visibility" (with the session's state), "recenter" or "select"; returns the remover. */
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    /**
     * Open an immersive session. Browsers allow it only from a click or a key press. Resolves
     * once the headset is presenting.
     */
    async enter() {
      if (xr.isPresenting || entering) return;
      if (!navigator.xr) throw new Error("This browser has no WebXR.");
      entering = true;
      try {
        const vr = vrSettings(context.settings.vr);
        xr.setFramebufferScaleFactor(vr.renderScale);
        xr.setFoveation(vr.foveation);
        // With layers three.js draws straight into the headset's own textures, antialiased.
        // Where a browser offers them and then cannot make one, the plain framebuffer serves.
        for (const optionalFeatures of [["layers"], []]) {
          const started = await navigator.xr.requestSession("immersive-vr", { optionalFeatures });
          try {
            await xr.setSession(started);
            return;
          } catch (error) {
            // A session that could not be set up is not left running.
            await started.end().catch(() => {});
            if (!optionalFeatures.length) throw error;
          }
        }
      } finally {
        entering = false;
      }
    },
    exit() {
      return session?.end().catch(() => {});
    },
    /** A screen starts drawing: its scene takes the rig, and `fn(dt, now)` runs every frame. */
    start(scene, fn) {
      idle?.leave();
      scene.add(rig);
      loop = fn;
    },
    /** The screen is done: the rig leaves its scene and the renderer is as the screen found it. */
    release() {
      loop = null;
      rig.removeFromParent();
      host.menu.close();
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.autoUpdate = true;
      renderer.renderLists.dispose();
    },
    /** First in a frame that draws to the headset: a recentre that is due is taken. */
    beginFrame() {
      if (recenterDue && head.valid) recenter();
    },
    /**
     * Place the tracking space from a column-major matrix (game/vr/pose.js `rigMatrix`, made with
     * `calibration` after `beginFrame`) and ready the cameras; `proxy` is the flat camera that
     * takes the head's place. Once per frame, before anything reads the hands or the camera.
     */
    placeRig(matrix, proxy) {
      rig.matrix.fromArray(matrix);
      readyCameras(proxy);
    },
    recenter,
    /** Recentre on the next frame that has a head pose (a race starting). */
    recenterSoon() { recenterDue = true; },
    setBoard(menu) { host.board = menu; },
    /** Show or hide the controllers' pointing beams (an open menu shows them). */
    showBeams(on) {
      for (const c of controllers) c.beam.visible = on;
    },
  };
  host.showBeams(false);
  host.menu = createVrMenu(host);
  return host;
}

/** The beam a controller points with: a thin line fading out over two metres. */
function controllerBeam() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -2], 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute([1, 0.75, 0.2, 0.25, 0.18, 0.05], 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  }));
  line.name = "vr-beam";
  line.frustumCulled = false;
  line.renderOrder = 1001;
  return line;
}

/** A plain stand-in for a controller in the hand, so the player can see where their hands are. */
function controllerBody() {
  const group = new THREE.Group();
  group.name = "vr-controller";
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.11, 10), new THREE.MeshBasicMaterial({ color: 0x2b3038, fog: false }));
  handle.rotation.x = Math.PI / 2;
  handle.position.z = 0.03;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 6, 20), new THREE.MeshBasicMaterial({ color: 0xf2a516, fog: false }));
  ring.position.z = -0.03;
  group.add(handle, ring);
  return group;
}
