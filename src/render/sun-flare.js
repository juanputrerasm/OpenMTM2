/*
  The sun, the moon and MTM2's lens flare (the enhanced look).

  Adapted from JSTrackViewer's sun-flare.js. The layout is the game's `DATA\SUN.TXT` (parsed by
  OpenPhotex) and the textures its `ART\SUN*.RAW` and `MOON.RAW`, both read from the install by
  the asset worker (`flare`), so nothing here ships game art.

    master radius       "a radius of this size is full screen size"
    layers              texture, axis position, radius, texture rectangle
    vischecking rays    nine points around the camera, 8 ft apart, cast at the sun

  Sizes. The TRI engine projects with a fixed 512 pixel focal length, and a layer of radius r
  measures r / masterRadius of that on screen; here the focal length comes from the camera, so
  the flare keeps its proportions at any window size and field of view.

  Placement. A layer's axis position runs along the line from the screen centre (0) through the
  sun (1) and on past the centre (negative), which is where the ghost rings sit.

  The sun disc (SUN02, "drawn with the sky" in SUN.TXT) and the moon that replaces it at night
  go in the sky group, before everything else, so the terrain covers them. The flare is drawn
  over the finished frame and fades with the share of the nine rays that reach the sun.
*/
import * as THREE from "three";

/** SUN.TXT texture rectangles are in 256ths, whatever the texture's real size. */
const TEXTURE_UNITS = 256;
const SUN_DISC_RADIUS = 458;
/** Not in SUN.TXT; measured off the game's night sky at 1280x720, about 42 px across the radius. */
const MOON_DISC_RADIUS = 75;
/** How far past the screen edge, in half-screens, the sun can be before the flare is gone. */
const EDGE_FADE = 0.35;

function dataTexture({ rgba, width, height }) {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class SunFlare {
  /**
   * @param {THREE.Object3D} skyParent where the discs go
   * @param {{ masterRadius: number, layers: { texture: string, axisPosition: number, radius: number, tex: number[] }[],
   *   rays: number[][], textures: Record<string, { width: number, height: number, rgba: Uint8Array }> }} data from the asset worker
   */
  constructor(skyParent, data) {
    this._data = data;
    this._textures = new Map();
    this._mode = "none";
    this._visibility = 0;
    this._masterRadius = data.masterRadius || 916;
    this._overlay = new THREE.Scene();
    this._overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this._layers = data.layers.map(({ texture, axisPosition, radius, tex: [x1, y1, x2, y2] }) => {
      const geo = new THREE.PlaneGeometry(1, 1);
      const uv = geo.attributes.uv;
      // The texture data is top row first, so v runs down the image: v = y / 256.
      const u1 = x1 / TEXTURE_UNITS, u2 = x2 / TEXTURE_UNITS, v1 = y1 / TEXTURE_UNITS, v2 = y2 / TEXTURE_UNITS;
      uv.setXY(0, u1, v1); uv.setXY(1, u2, v1); uv.setXY(2, u1, v2); uv.setXY(3, u2, v2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: this._texture(texture), blending: THREE.AdditiveBlending, transparent: true,
        depthTest: false, depthWrite: false, toneMapped: false,
      }));
      mesh.frustumCulled = false;
      this._overlay.add(mesh);
      return { mesh, axis: axisPosition, radius };
    });
    this._sunDisc = this._disc("SUN02", { blending: THREE.AdditiveBlending });
    this._moonDisc = this._disc("MOON", {
      blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    skyParent.add(this._sunDisc, this._moonDisc);
  }

  _texture(name) {
    const key = name.replace(/\.raw$/i, "").toUpperCase();
    if (!this._textures.has(key)) {
      const source = this._data.textures[key];
      this._textures.set(key, source ? dataTexture(source) : null);
    }
    return this._textures.get(key);
  }

  _disc(name, blend) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._texture(name), depthTest: false, depthWrite: false, fog: false, toneMapped: false, ...blend,
    }));
    sprite.frustumCulled = false;
    sprite.renderOrder = 1;   // after the sky dome
    sprite.visible = false;
    return sprite;
  }

  /** "sun" (disc and flare), "moon" (disc only) or "none". */
  setMode(mode) {
    this._mode = mode;
    if (mode === "none") this._visibility = 0;
  }

  /**
   * Places everything for this frame.
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Vector3} lightDirection the way the sunlight travels (unit)
   * @param {boolean} showDiscs
   * @param {boolean} showFlare
   * @param {(origin: THREE.Vector3, direction: THREE.Vector3) => boolean} blocked
   */
  update(camera, lightDirection, showDiscs, showFlare, blocked) {
    const toSun = _toSun.copy(lightDirection).negate().normalize();
    const distance = camera.far * 0.85;
    const disc = this._mode === "moon" ? this._moonDisc : this._sunDisc;
    const discRadius = this._mode === "moon" ? MOON_DISC_RADIUS : SUN_DISC_RADIUS;
    this._sunDisc.visible = false;
    this._moonDisc.visible = false;
    if (this._mode !== "none" && showDiscs) {
      disc.visible = true;
      disc.position.copy(camera.position).addScaledVector(toSun, distance);
      // A camera-facing quad whose half-size subtends atan(r / master radius), as the layers do.
      disc.scale.setScalar(2 * distance * discRadius / this._masterRadius);
    }
    this._flareOn = false;
    if (this._mode !== "sun" || !showFlare) return;
    camera.getWorldDirection(_forward);
    if (_forward.dot(toSun) <= 0) return;
    _screen.copy(camera.position).addScaledVector(toSun, distance).project(camera);
    const outside = Math.max(Math.abs(_screen.x), Math.abs(_screen.y)) - 1;
    const edge = outside <= 0 ? 1 : Math.max(0, 1 - outside / EDGE_FADE);
    if (edge <= 0) return;
    // The share of the rays that reach the sun. The file's offsets are 1/256 ft; the scene is in feet.
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    const rays = this._data.rays.length ? this._data.rays : [[0, 0, 0]];
    let clear = 0;
    for (const [x, y] of rays) {
      _origin.copy(camera.position).addScaledVector(_right, x / 256).addScaledVector(_up, y / 256);
      if (!blocked(_origin, toSun)) clear++;
    }
    this._visibility = (clear / rays.length) * edge;
    if (this._visibility <= 0) return;
    this._sunScreen = [_screen.x, _screen.y];
    this._flareOn = true;
  }

  /** Draws the flare over the frame just rendered. */
  render(renderer, camera) {
    if (!this._flareOn) return;
    const size = renderer.getSize(_size);
    const halfW = size.x / 2, halfH = size.y / 2;
    const cam = this._overlayCamera;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    const focal = halfH / Math.tan((camera.fov * Math.PI / 180) / 2);
    const [sx, sy] = this._sunScreen;
    for (const { mesh, axis, radius } of this._layers) {
      mesh.position.set(sx * halfW * axis, sy * halfH * axis, 0);
      mesh.scale.setScalar(2 * focal * radius / this._masterRadius);
      mesh.material.opacity = this._visibility;
    }
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this._overlay, cam);
    renderer.autoClear = autoClear;
  }

  dispose() {
    for (const t of this._textures.values()) t?.dispose();
    this._sunDisc.removeFromParent();
    this._moonDisc.removeFromParent();
  }
}

const _toSun = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _screen = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _size = new THREE.Vector2();
