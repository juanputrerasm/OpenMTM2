/*
  Sun shadows across the view distance, as cascaded shadow maps (the enhanced look).

  Ported from JSTrackViewer's sun-shadows.js with the distances in feet, this scene's unit. The
  text below is that file's own, which still holds.
*/
/*
  Sun shadows across the whole view distance, as cascaded shadow maps.

  A single shadow map has one texel size everywhere it covers. Stretched over the view
  distance that texel grows until trees cast smudges, so the viewer used to shadow only a
  32 cell square around the camera, and shadows stopped a short way in front of it. Cascades
  split the view frustum by distance and give each slice its own map: fine texels close to
  the camera, where detail shows, and coarse ones far away, where it does not.

  three.js's CSM add-on does the splitting and fitting. It lights with one directional light
  per cascade and selects one of them per fragment, which has two consequences handled here:

    - Every lit material has to be set up for it. A material that is not would add all the
      cascade lights together and render several times too bright. setupMaterials walks the
      scene and sets up whatever it has not seen, so materials created later (a texture
      toggle swapping the terrain's, a truck being loaded) are picked up on the next pass.

    - CSM takes a material's onBeforeCompile for itself. The terrain already has one (the
      CPR road mask, see scene.js), so an existing hook is kept and run first, and the
      program cache key is made to tell the combined hook apart from CSM's alone.

  With shadows off the cascades are hidden and the scene's ordinary sun lights instead: a
  set up material with no shadowed lights falls through to CSM's plain lighting loop, so it
  is lit exactly once either way.

  Keeping it cheap. A shadow map redraw draws every caster in the cascade again, and on a
  track with thousands of objects that is most of a frame's work. CSM fits each cascade to
  the view frustum, so every turn of the camera, not only every move, redraws all four. Here
  the fitting is CSM's replaced (see _fit) so that the maps depend as little as possible on
  the camera:

    - Each cascade covers a circle around the camera rather than its slice of the frustum:
      the circle that holds the slice however the camera is turned. Looking around then
      never redraws anything.
    - Each covers a little more than it needs (SLACK) and is redrawn only once the camera
      has moved further than that from where it was last fitted. Moving slowly redraws the
      near cascade now and then and the far one hardly ever.
    - When things in the scene move (a truck being driven, objects knocked about), the near
      cascade redraws every frame and each further one half as often.
    - The fit is snapped to whole texels, so a refit does not make shadow edges crawl.
    - With Natural light each cascade keeps a copy of what never moves (the ground, the placed
      objects, the camera-facing trees among them: their shadows are held square to the sun). A
      redraw puts back only the texels that what moves covered the last time it was drawn,
      and draws the trucks and the keyframed models on top. A cascade a truck's shadow cannot
      reach skips that truck.
      The copies are 32 MB each. Without Natural light only a few objects cast, and every redraw
      draws the whole map, as before.
    - A placed object a truck knocks about changes what never moves. Only the cascades its
      shadow falls in, as it stood and as it stands, have their copy drawn again, and only
      those whose texels are small enough to show it: a far cascade's texel is many feet
      across. Every copy drawn again is the whole map, ground and all, so no more than one is
      drawn in a frame; another waits a frame or two, nearest first. A cascade not yet drawn
      at all never waits.

  Reading them. three.js's soft shadows test the depth at sixteen texels about each point and
  unpack each depth from a colour. Each cascade's map keeps its depth in a texture the graphics
  card compares as well. In the first cascade (150 ft with Natural light, 500 ft without) the
  lit materials read that four times, the card weighing the tests between texels itself, which
  gives the same shadow (game/shadow-cache.js). Further out they read it once, the card
  weighing the four texels about the point: an edge a texel wide instead of three. The packed
  colour is still drawn: the water reads it.
*/

import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import { CSMShader } from "three/addons/csm/CSMShader.js";
import { SHADOW_CASCADE_ENDS_FT, SHADOW_FAR_FT } from "../game/lighting.js";
import { REBUILDS_PER_FRAME, changeReaches, patchesToRestore, shadowPatch } from "../game/shadow-cache.js";
import { WORLD_FT } from "../shared/scene-frame.js";

const CASCADES = 4;
const MAP_SIZE = 2048;
/** Where the first three cascades end, in feet; the last runs on to maxFar. */
const CASCADE_ENDS = [500, 1700, 4200];
const LIGHT_MARGIN = 1300;
const LIGHT_FAR = 34000;
/** How much further than its slice each cascade reaches, as a fraction: the camera's free travel. */
const SLACK = 0.12;
/** Depth room behind a cascade's circle toward the sun, in feet, for tall casters. */
const DEPTH_MARGIN = 2500;
/** Normal offset per cascade, as a fraction of that cascade's texel: enough to stop acne on the terrain. */
const NORMAL_BIAS_PER_TEXEL = 0.5;
const DEPTH_BIAS = -0.00002;
/**
 * Depth offset per cascade, in feet per foot of that cascade's texel. The far cascades' texels are feet wide, and the
 * ground under one rises and falls by more than a fixed bias allows: without this it shadows itself in grey bands that
 * ring the camera far off (the distance turns grey with Smooth textures, the only look with sun shadows).
 */
const DEPTH_BIAS_PER_TEXEL = 1.5;
/** Materials whose shader uses the scene lights, and so the cascade lights. */
const isLit = (material) => material && (material.isMeshLambertMaterial || material.isMeshPhongMaterial
  || material.isMeshStandardMaterial || material.isMeshToonMaterial);

/*
  The lit materials' read of a cascade. The first, where shadows are seen up close, gets three.js's soft shadow as four
  tests the graphics card compares and weighs (game/shadow-cache.js `softShadowReads`); the others one test, the card
  weighing the four texels about the point. Which cascade is read is known when the shader is built: three.js writes
  CSM's loop out once per cascade. A material set up without MTM_SHADOW_COMPARED reads three.js's way.
*/
const COMPARED_PARS = /* glsl */ `
#if defined( USE_CSM ) && defined( CSM_CASCADES ) && defined( MTM_SHADOW_COMPARED ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
uniform sampler2DShadow mtmShadowDepth[ NUM_DIR_LIGHT_SHADOWS ];
float mtmShadowCompared( sampler2DShadow map, vec2 size, float intensity, float bias, vec4 coord, bool soft ) {
  float shadow = 1.0;
  coord.xyz /= coord.w;
  coord.z += bias;
  // A shadow of no strength changes nothing, and is not read.
  if ( intensity > 0.0 && coord.x >= 0.0 && coord.x <= 1.0 && coord.y >= 0.0 && coord.y <= 1.0 && coord.z <= 1.0 ) {
    if ( soft ) {
      // Along each axis the texels left of the point's lower neighbour weigh 1 - f, 1, 1 and f: two pairs, each one read.
      vec2 t = coord.xy * size + 0.5;
      vec2 f = fract( t ), n = t - f;
      vec2 first = 2.0 - f, second = 1.0 + f;
      vec2 a = ( n - 1.5 + 1.0 / first ) / size, b = ( n + 0.5 + f / second ) / size;
      shadow = ( first.x * first.y * texture( map, vec3( a, coord.z ) ) + second.x * first.y * texture( map, vec3( b.x, a.y, coord.z ) )
        + first.x * second.y * texture( map, vec3( a.x, b.y, coord.z ) ) + second.x * second.y * texture( map, vec3( b, coord.z ) ) ) / 9.0;
    } else {
      shadow = texture( map, coord.xyz );
    }
  }
  return mix( 1.0, shadow, intensity );
}
// A surface turned from the sun takes none of its light in these materials, shadowed or not, so its shadow is not read.
// A coat, a sheen or a toon's steps are lit past that, and always read it. The cascade's number, nth, is a constant.
#if defined( USE_CLEARCOAT ) || defined( USE_SHEEN ) || defined( TOON )
#define MTM_CASCADE_SHADOW( packed, compared, caster, coord, nth ) mtmShadowCompared( compared, caster.shadowMapSize, caster.shadowIntensity, caster.shadowBias, coord, ( nth ) == 0 )
#else
#define MTM_CASCADE_SHADOW( packed, compared, caster, coord, nth ) ( dot( geometryNormal, directLight.direction ) > 0.0 ? mtmShadowCompared( compared, caster.shadowMapSize, caster.shadowIntensity, caster.shadowBias, coord, ( nth ) == 0 ) : 1.0 )
#endif
#else
#define MTM_CASCADE_SHADOW( packed, compared, caster, coord, nth ) getShadow( packed, caster.shadowMapSize, caster.shadowIntensity, caster.shadowBias, caster.shadowRadius, coord )
#endif
`;
/** three.js's read of a cascade in CSM's loop over them, and where that loop ends. */
const CSM_GET_SHADOW = "getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )";
const CSM_LOOP_END = "#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM ) && !defined( CSM_CASCADES )";

/**
 * CSM puts its chunks in three.js's for every material when it is made. Its loop over the cascades is made to read them
 * as COMPARED_PARS does, in a material that asks for it. Whether the chunks were as this expects.
 */
function compareCascades() {
  const begin = CSMShader.lights_fragment_begin, end = begin.indexOf(CSM_LOOP_END);
  if (end < 0 || !begin.slice(0, end).includes(CSM_GET_SHADOW)) return false;
  // three.js writes the loop out once per cascade, UNROLLED_LOOP_INDEX becoming each one's number.
  const read = "MTM_CASCADE_SHADOW( directionalShadowMap[ i ], mtmShadowDepth[ i ], directionalLightShadow, vDirectionalShadowCoord[ i ], UNROLLED_LOOP_INDEX )";
  THREE.ShaderChunk.lights_fragment_begin = begin.slice(0, end).split(CSM_GET_SHADOW).join(read) + begin.slice(end);
  THREE.ShaderChunk.lights_pars_begin = CSMShader.lights_pars_begin + COMPARED_PARS;
  return true;
}

export class SunShadows {
  /** `cascadeEnds` is where the first three cascades end, feet from the eye; the last runs on to `maxFar`. */
  constructor({ scene, camera, color, intensity = 1, maxFar = 10240, cascadeEnds = CASCADE_ENDS }) {
    this._scene = scene;
    this._camera = camera;
    this._seen = new WeakSet();
    this._csm = new CSM({
      camera,
      parent: scene,
      cascades: CASCADES,
      maxFar,
      mode: "custom",
      customSplitsCallback: (amount, near, far, target) => {
        for (let i = 1; i < amount; i++) {
          // Fixed distances, squeezed evenly if the view distance is shorter than they are.
          const end = cascadeEnds[i - 1] ?? far;
          target.push(Math.min(end / far, i / amount));
        }
        target.push(1);
      },
      shadowMapSize: MAP_SIZE,
      lightIntensity: intensity,
      lightNear: 1,
      lightFar: LIGHT_FAR,
      lightMargin: LIGHT_MARGIN,
    });
    // The depths the lit materials compare, a texture each cascade's map is drawn with; none where three.js's chunks are
    // not as expected, and the materials read three.js's way.
    this._depths = compareCascades() ? [] : null;
    for (const light of this._csm.lights) {
      // Set outright: the helper reads an intensity of 0 as "none given" and falls back to its own bright default, which
      // lit the ground and cast shadows in Pitch Black, the one weather whose sun is 0.
      light.intensity = intensity;
      light.color.set(color);
      light.shadow.bias = DEPTH_BIAS;
      // Redrawn per cascade, only when _fit or invalidate says so.
      light.shadow.autoUpdate = false;
      // three.js makes the map on its first draw, unless there is one.
      if (this._depths) {
        light.shadow.map = cascadeMap(light);
        this._depths.push(light.shadow.map.depthTexture);
      }
    }
    // `lx`, `ly`: where the cascade's middle lies in the light's own frame, across the light's way.
    this._fits = this._csm.lights.map(() => ({ center: null, radius: 0, lx: 0, ly: 0, serial: -1, rebuilt: false }));
    // What moves, as last drawn into each cascade over its static copy: patches of the map, [x0, y0, x1, y1] in texels,
    // or null where that is not known (the whole map is put back).
    this._drawn = this._csm.lights.map(() => null);
    // Whether a copy between two maps has been seen to work, after which it is not asked of the graphics card again.
    this._blitChecked = false;
    this._frame = 0;
    this._dynamic = false;
    this._renderer = null;
    this._world = null;
    this._caching = false;
    this._cacheBroken = false;
    this._cache = null;
    this._staticCasters = [];
    this._dynamicCasters = [];
    this._truckCasters = [];
    this._suppressClear = false;
    this._nativeRender = null;
    this._nativeClear = null;
    this.setEnabled(false);
  }

  get enabled() { return this._enabled; }

  /** Shows the cascade lights and lets them cast, or hides them all. */
  setEnabled(enabled) {
    this._enabled = enabled;
    for (const light of this._csm.lights) {
      light.visible = enabled;
      light.castShadow = enabled;
    }
    this.invalidate();
  }

  /** Something that affects every shadow changed (the sun, the track, visibility): redraw all. */
  invalidate() {
    for (const fit of this._fits ?? []) fit.center = null;
  }

  /** Something in the scene moved this frame: redraw near cascades now, far ones in turn. */
  invalidateDynamic() {
    this._dynamic = true;
  }

  /**
   * What `invalidateIfMoved` watches: the trucks' root objects (each node's place and whether it is shown, the lamps
   * aside, which cast nothing), the objects the simulation moves and the trees that fall (`world.userData.shadowMotion`,
   * render/track-scene.js), and the keyframed models while the world's clock runs.
   */
  watchMotion(world, trucks) {
    this._motionWorld = world;
    this._motionSerial = world.userData.shadowMotion ?? 0;
    this._motionClock = world.userData.animationTime ?? 0;
    let animated = false;
    world.traverse((o) => { if (o.isMesh && o.userData.frameCount > 1 && o.castShadow) animated = true; });
    this._animated = animated;
    this._settle = 0;
    this._watched = trucks.map((root) => {
      const nodes = [];
      const walk = (node) => {
        if (node.name === "lamps" || node.userData.reflection) return;
        nodes.push(node);
        for (const child of node.children) walk(child);
      };
      walk(root);
      return { root, nodes, pose: null };
    });
  }

  /**
   * `invalidateDynamic`, only when something that casts moved since the last call (see `watchMotion`): a still
   * scene, a paused race or trucks waiting on the grid, redraws no shadow map. Without `watchMotion`, always.
   */
  invalidateIfMoved() {
    const world = this._motionWorld;
    if (!world) { this._dynamic = true; return; }
    let moved = false;
    const serial = world.userData.shadowMotion ?? 0;
    if (serial !== this._motionSerial) { this._motionSerial = serial; moved = true; }
    const clock = world.userData.animationTime ?? 0;
    if (clock !== this._motionClock) { this._motionClock = clock; if (this._animated) moved = true; }
    for (const watched of this._watched) if (truckMoved(watched)) moved = true;
    // The far cascades redraw one frame in two, four, eight: once things stop, each gets its turn to draw them stopped.
    if (moved) this._settle = 1 << (CASCADES - 1);
    else if (this._settle > 0) this._settle--;
    else return;
    this._dynamic = true;
  }

  setIntensity(value) {
    for (const light of this._csm.lights) light.intensity = value;
  }

  setColor(color) {
    for (const light of this._csm.lights) light.color.set(color);
  }

  /** How dark the shadows are, 0 (none) to 1: an overcast sky's are faint. */
  setStrength(value) {
    for (const light of this._csm.lights) light.shadow.intensity = value;
  }

  /** The direction the sunlight travels, as the scene's own sun uses it. */
  setDirection(direction) {
    this._csm.lightDirection.copy(direction).normalize();
    this.invalidate();
  }

  /**
   * Take the scene's sun as it stands now: its strength, its colour and where it is, and
   * `strength`, how dark its shadows are. The weather changes all four (render/light-rig.js).
   */
  follow(sun, strength = 1) {
    this.setIntensity(sun.intensity);
    this.setColor(sun.color);
    this.setStrength(strength);
    _center.copy(sun.position).normalize().negate();
    if (_center.distanceToSquared(this._csm.lightDirection) > 1e-8) this.setDirection(_center);
  }

  /** After the camera's aspect or far plane changes: the cascades are cut from its frustum. */
  setMaxFar(maxFar) {
    this._csm.maxFar = maxFar;
    this.refit();
  }

  refit() {
    // Recomputes the cascade breaks and the shaders' copies of them; the circles follow.
    this._csm.updateFrustums();
    this.invalidate();
  }

  /**
   * Sets up every lit material under `root` that has not been seen yet.
   * Cheap on a scene that has not changed: one traversal and a WeakSet lookup per material.
   */
  setupMaterials(root = this._scene) {
    root.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!isLit(material) || this._seen.has(material)) continue;
        this._seen.add(material);
        this._setup(material);
      }
    });
  }

  _setup(material) {
    const own = Object.prototype.hasOwnProperty.call(material, "onBeforeCompile") ? material.onBeforeCompile : null;
    // What tells this material's own shader from another's: the key it gives itself, or else its hook's text. Two
    // materials may share a hook's text and differ in what the hook was made with (render/ground-surface.js).
    const ownKey = own ? material.customProgramCacheKey() : "";
    this._csm.setupMaterial(material);
    const depths = this._depths;
    if (!own && !depths) return;
    // The cascades read as the graphics card compares them (COMPARED_PARS).
    if (depths) material.defines.MTM_SHADOW_COMPARED = "";
    const csmHook = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      own?.call(material, shader, renderer);
      csmHook.call(material, shader, renderer);
      if (depths) shader.uniforms.mtmShadowDepth = { value: depths };
    };
    if (own) {
      const key = `${ownKey}|${csmHook.toString()}`;
      material.customProgramCacheKey = () => key;
    }
    material.needsUpdate = true;
  }

  /** Drops the materials of a track that has been cleared, which the CSM would otherwise keep. */
  forgetMaterials() {
    this._csm.shaders.clear();
    this._seen = new WeakSet();
  }

  /**
   * Once a frame: refits and marks for redrawing the cascades that need it. Returns true when
   * any does, for the renderer's shadow pass to run.
   */
  update() {
    if (!this._enabled) return false;
    this._frame++;
    const camera = this._camera;
    camera.updateMatrixWorld();
    const far = Math.min(camera.far, this._csm.maxFar);
    // The farthest a point at view depth d can be from the camera is d times this.
    const ty = Math.tan((camera.fov * Math.PI / 180) / 2);
    const tx = ty * camera.aspect;
    const spread = Math.sqrt(1 + tx * tx + ty * ty);

    // Objects that left the still ones (render/track-scene.js `moveObjects`) are drawn with what moves from now on.
    const fresh = this._world?.userData.newDynamicCasters;
    if (fresh?.length) {
      if (this._caching) for (const mesh of fresh) if (mesh.castShadow) this._dynamicCasters.push(mesh);
      fresh.length = 0;
    }
    let any = false, rebuilds = 0;
    const serial = this._world?.userData.shadowStaticSerial ?? 0;
    this._csm.lights.forEach((light, i) => {
      const fit = this._fits[i];
      const reach = this._csm.breaks[i] * far * spread;
      const radius = reach * (1 + SLACK);
      const unbuilt = !fit.center || !light.shadow.map || (this._caching && !this._cache?.[i]);
      let stale = !fit.center || Math.abs(fit.radius - radius) > radius * 1e-3
        || fit.center.distanceTo(camera.position) > reach * SLACK;
      const due = this._dynamic && this._frame % (1 << i) === 0;
      // A far cascade is not redrawn every frame, so a moved prop has to mark it even on a frame it would skip. A prop
      // whose shadow this cascade does not show changes nothing in it.
      let serialStale = this._caching && fit.serial !== serial;
      if (serialStale && !this._changeReaches(fit, serial)) { fit.serial = serial; serialStale = false; }
      // One copy drawn afresh a frame at most (the nearest that wants it): all four at once, with a forest in them, would
      // hold up the frame for tens of milliseconds. The rest keep what they have for now.
      if (this._caching && !unbuilt && (stale || serialStale)) {
        if (rebuilds >= REBUILDS_PER_FRAME) { stale = false; serialStale = false; }
        else rebuilds++;
      }
      if (!stale && !due && !serialStale) return;
      if (stale) this._fit(light, fit, radius);
      // A refit, a moved prop, or a missing copy redraws the static ground. A truck's frame only redraws what moves.
      fit.rebuilt = !!(this._caching && (stale || serialStale || unbuilt));
      light.shadow.needsUpdate = true;
      any = true;
    });
    this._dynamic = false;
    return any;
  }

  /**
   * Whether anything that changed in what never moves since the cascade fitted as `fit` last drew its static copy (up
   * to `serial`) shows in it (game/shadow-cache.js `changeReaches`): what it shows is its circle across the light's way.
   */
  _changeReaches(fit, serial) {
    if (!fit.center) return true;
    _orientation.lookAt(_zero, this._csm.lightDirection, _worldUp);
    _inverse.copy(_orientation).invert();
    const toLight = (x, y, z) => { _point.set(x, y, z).applyMatrix4(_inverse); return [_point.x, _point.y]; };
    const cascade = { serial: fit.serial, radius: fit.radius, x: fit.center.x, z: fit.center.z, lx: fit.lx, ly: fit.ly };
    return changeReaches(cascade, this._world?.userData.shadowChanges, serial, { toLight, worldFt: WORLD_FT, mapSize: MAP_SIZE });
  }

  /*
    Points a cascade's light at a circle of `radius` around the camera, snapped to texels in
    the light's own frame so that successive fits line up with each other.
  */
  _fit(light, fit, radius) {
    const direction = this._csm.lightDirection;
    _orientation.lookAt(_zero, direction, _worldUp);
    _inverse.copy(_orientation).invert();
    const texel = (2 * radius) / MAP_SIZE;
    _center.copy(this._camera.position).applyMatrix4(_inverse);
    _center.x = Math.round(_center.x / texel) * texel;
    _center.y = Math.round(_center.y / texel) * texel;
    fit.lx = _center.x;
    fit.ly = _center.y;
    _center.applyMatrix4(_orientation);

    const cam = light.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 1;
    cam.far = 2 * radius + 2 * DEPTH_MARGIN;
    cam.updateProjectionMatrix();
    light.position.copy(_center).addScaledVector(direction, -(radius + DEPTH_MARGIN));
    light.target.position.copy(_center);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    light.shadow.normalBias = texel * NORMAL_BIAS_PER_TEXEL;
    // The depth bias is in the shadow camera's depth range: the texel's feet over the range's.
    light.shadow.bias = Math.min(DEPTH_BIAS, -(texel * DEPTH_BIAS_PER_TEXEL) / (cam.far - cam.near));

    fit.center = this._camera.position.clone();
    fit.radius = radius;
  }

  /**
   * With Natural light, keep a GPU copy of each cascade's static casters (the ground and the placed
   * objects) and redraw only what moves. `trucks` are the trucks' root objects. Called once the
   * shadow proxies exist, so the lists are the casters as they will be drawn.
   */
  keepStatic(renderer, world, trucks) {
    this._renderer = renderer;
    this._world = world;
    this._caching = true;
    this._cacheBroken = false;
    this._cache = this._csm.lights.map(() => null);
    const truckRoots = new Set(trucks);
    this._truckCasters = trucks.map((root) => ({ root, meshes: [], sphere: new THREE.Sphere() }));
    const byRoot = new Map(this._truckCasters.map((entry) => [entry.root, entry]));
    this._staticCasters = [];
    this._dynamicCasters = [];
    const seen = new Set();
    const consider = (object) => {
      if (!object.isMesh || !object.castShadow || seen.has(object)) return;
      seen.add(object);
      let owner = null;
      for (let node = object; node; node = node.parent) if (truckRoots.has(node)) { owner = node; break; }
      if (owner) byRoot.get(owner).meshes.push(object);
      else if (object.userData.shadowProxy || object.userData.frameCount || object.userData.moving) this._dynamicCasters.push(object);
      else this._staticCasters.push(object);
    };
    this._scene.traverse(consider);
    for (const truck of trucks) truck.traverse(consider);
    this._hookRenderer();
  }

  /** The renderer's shadow pass, split so each cascade can restore its static copy before drawing what moves. */
  _renderShadows(lights, scene, camera) {
    const renderer = this._renderer;
    // The colour pass is already aimed at its picture. A cascade binds its own target, so the caller's goes back.
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const mip = renderer.getActiveMipmapLevel();
    try {
      if (!this._caching || this._cacheBroken) {
        this._nativeRender.call(renderer.shadowMap, lights, scene, camera);
        return;
      }
      this._ours ??= new Set(this._csm.lights);
      const pending = this._pending ??= [], rest = this._rest ??= [];
      pending.length = rest.length = 0;
      for (const light of lights) {
        if (this._ours.has(light) && light.shadow?.needsUpdate) pending.push(light);
        else rest.push(light);
      }
      // The cascades are drawn below. Left set, the pass over the other lights would draw them as well.
      for (const light of pending) light.shadow.needsUpdate = false;
      if (rest.length) this._nativeRender.call(renderer.shadowMap, rest, scene, camera);
      for (const light of pending) this._drawCascade(light);
    } finally {
      renderer.setRenderTarget(previous, face, mip);
    }
  }

  _drawCascade(light) {
    const renderer = this._renderer;
    const i = this._csm.lights.indexOf(light);
    const fit = this._fits[i];
    const full = () => {
      this._restoreCast();
      light.shadow.needsUpdate = true;
      this._nativeRender.call(renderer.shadowMap, [light], this._scene, this._camera);
    };
    if (this._cacheBroken) { full(); return; }
    const serial = this._world?.userData.shadowStaticSerial ?? 0;
    const rebuild = fit.rebuilt || !this._cache[i] || !light.shadow.map;
    if (rebuild) {
      this._setCast(this._dynamicCasters, false);
      for (const truck of this._truckCasters) this._setCast(truck.meshes, false);
      try {
        light.shadow.needsUpdate = true;
        this._nativeRender.call(renderer.shadowMap, [light], this._scene, this._camera);
      } finally {
        this._restoreCast();
      }
      const map = light.shadow.map;
      if (!map || map.width !== MAP_SIZE || map.height !== MAP_SIZE) { this._failCache(); full(); return; }
      if (!this._cache[i]) this._cache[i] = staticShadowCopy();
      if (!this._blit(map, this._cache[i])) { this._failCache(); full(); return; }
      fit.serial = serial;
      // The map holds what never moves, and nothing else yet.
      this._drawn[i] = [];
    } else if (!this._blit(this._cache[i], light.shadow.map, this._drawn[i])) { this._failCache(); full(); return; }
    this._drawn[i] = this._overlay(light);
  }

  /**
   * Draw the trucks, keyframed models and camera-facing trees over the restored static copy. Returns the patches of the
   * map they were drawn in, for the next redraw to put back, or null where they cover too much of it for patches.
   */
  _overlay(light) {
    this._setCast(this._staticCasters, false);
    light.shadow.updateMatrices(light);
    const frustum = light.shadow.getFrustum();
    const patches = [];
    for (const truck of this._truckCasters) {
      const reach = this._truckSphere(truck);
      const shown = !!(reach && frustum.intersectsSphere(reach));
      this._setCast(truck.meshes, shown);
      if (shown) this._patch(light, reach, patches);
    }
    for (const mesh of this._dynamicCasters) {
      const geometry = mesh.geometry;
      if (!geometry) continue;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      _sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      if (frustum.intersectsSphere(_sphere)) this._patch(light, _sphere, patches);
    }
    this._setCast(this._dynamicCasters, true);
    this._suppressClear = true;
    try {
      light.shadow.needsUpdate = true;
      this._nativeRender.call(this._renderer.shadowMap, [light], this._scene, this._camera);
    } finally {
      this._suppressClear = false;
      this._restoreCast();
    }
    return patchesToRestore(patches, MAP_SIZE);
  }

  /**
   * Where `sphere` (in the world) lies on cascade `light`'s map, whose matrices are current, added to `patches`
   * (game/shadow-cache.js `shadowPatch`). The map is drawn straight down the light's way, so what lies in the sphere is
   * drawn within it.
   */
  _patch(light, sphere, patches) {
    const camera = light.shadow.camera;
    _point.copy(sphere.center).applyMatrix4(light.shadow.matrix);
    const patch = shadowPatch(_point.x, _point.y, sphere.radius / (camera.right - camera.left), MAP_SIZE);
    if (patch) patches.push(patch);
  }

  _truckSphere(entry) {
    if (entry.root.visible === false) return null;
    const sphere = entry.sphere;
    let found = false;
    for (const mesh of entry.meshes) {
      const geometry = mesh.geometry;
      if (!geometry) continue;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      _sphere.copy(geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      if (!found) { sphere.copy(_sphere); found = true; }
      else sphere.union(_sphere);
    }
    return found ? sphere : null;
  }

  _setCast(list, value) {
    for (let i = 0; i < list.length; i++) list[i].castShadow = value;
  }

  _restoreCast() {
    this._setCast(this._staticCasters, true);
    this._setCast(this._dynamicCasters, true);
    for (const truck of this._truckCasters) this._setCast(truck.meshes, true);
  }

  /**
   * Copy a cascade's colour and depth. The packed depth lives in the colour, and the test uses the depth buffer. With
   * `patches` ([x0, y0, x1, y1] in texels) only those are copied, and none when there are none.
   *
   * Whether the browser takes the copy is asked of it once, the first time: asking waits for the graphics card to catch
   * up with everything drawn before it, which held up every frame by as long as the card was behind.
   */
  _blit(src, dst, patches = null) {
    if (patches && !patches.length) return true;
    const renderer = this._renderer;
    const gl = renderer.getContext();
    if (!gl.blitFramebuffer) return false;
    try {
      // A blit is cut by the scissor and dropped by a write mask. The shadow pass turns both off; a copy does too.
      const state = renderer.state;
      state.buffers.color.setMask(true);
      state.buffers.depth.setMask(true);
      state.setScissorTest(false);
      renderer.setRenderTarget(src);
      renderer.setRenderTarget(dst);
      const srcFb = renderer.properties.get(src).__webglFramebuffer;
      const dstFb = renderer.properties.get(dst).__webglFramebuffer;
      if (!srcFb || !dstFb) return false;
      const check = !this._blitChecked;
      if (check) for (let n = 0; n < 8 && gl.getError() !== gl.NO_ERROR; n++) { /* a stale error is not this copy */ }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFb);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFb);
      const mask = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;
      if (patches) for (const [x0, y0, x1, y1] of patches) gl.blitFramebuffer(x0, y0, x1, y1, x0, y0, x1, y1, mask, gl.NEAREST);
      else gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, mask, gl.NEAREST);
      const ok = !check || gl.getError() === gl.NO_ERROR;
      if (ok) this._blitChecked = true;
      // three.js remembers the framebuffer it bound. The copy bound its own, so bind through three.js again.
      renderer.setRenderTarget(null);
      renderer.setRenderTarget(dst);
      return ok;
    } catch {
      renderer.setRenderTarget(null);
      return false;
    }
  }

  _failCache() {
    this._cacheBroken = true;
    for (const target of this._cache ?? []) target?.dispose();
    if (this._cache) this._cache.fill(null);
  }

  _hookRenderer() {
    const renderer = this._renderer;
    if (!renderer) return;
    const existing = shadowHook.get(renderer);
    if (existing?.owner === this) return;
    if (existing) existing.owner._unhook();
    const saved = { render: renderer.shadowMap.render, clear: renderer.clear, owner: this };
    shadowHook.set(renderer, saved);
    this._nativeRender = saved.render;
    this._nativeClear = saved.clear;
    const self = this;
    renderer.shadowMap.render = function (lights, scene, camera) { self._renderShadows(lights, scene, camera); };
    renderer.clear = function (...args) {
      if (self._suppressClear) return;
      return self._nativeClear.apply(renderer, args);
    };
  }

  _unhook() {
    const renderer = this._renderer;
    if (!renderer) return;
    const saved = shadowHook.get(renderer);
    if (!saved || saved.owner !== this) return;
    renderer.shadowMap.render = saved.render;
    renderer.clear = saved.clear;
    shadowHook.delete(renderer);
    this._nativeRender = null;
    this._nativeClear = null;
  }

  /** Drop the static copies and the hooks on the renderer. The cascade lights stay: the caller disposes the scene. */
  dispose() {
    for (const target of this._cache ?? []) target?.dispose();
    this._cache = null;
    this._caching = false;
    this._unhook();
  }
}

/**
 * A cascade's map as three.js would make it (its depth packed in the colour, which the water reads), its depth a texture
 * the lit materials compare (COMPARED_PARS), bilinearly. 24 bit, as three.js's depth buffer, so a static copy's depth
 * buffer takes a copy of it.
 */
function cascadeMap(light) {
  const depth = new THREE.DepthTexture(MAP_SIZE, MAP_SIZE, THREE.UnsignedIntType);
  depth.compareFunction = THREE.LessEqualCompare;
  depth.minFilter = THREE.LinearFilter;
  depth.magFilter = THREE.LinearFilter;
  const target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: depth,
  });
  target.texture.name = `${light.name}.shadowMap`;
  return target;
}

/** One cascade's copy of the static shadow: the same 2048 square, nearest, with a depth buffer. 32 MB. */
function staticShadowCopy() {
  const target = new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
  });
  target.texture.name = "static shadow copy";
  return target;
}

const shadowHook = new WeakMap();

const _orientation = new THREE.Matrix4();
const _inverse = new THREE.Matrix4();
const _center = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _sphere = new THREE.Sphere();
/** How far a truck's part has to move, feet (or turn, as a quaternion's part), for its shadow to be drawn again. */
const MOTION_EPSILON = 1e-3;

/** Whether any node of a watched truck moved, or was shown or hidden, since the last call; records its place. */
function truckMoved(watched) {
  const { nodes } = watched;
  const size = nodes.length * 11;
  const fresh = !watched.pose;
  if (fresh) watched.pose = new Float64Array(size);
  const pose = watched.pose;
  let moved = fresh;
  for (let i = 0, k = 0; i < nodes.length; i++, k += 11) {
    const node = nodes[i];
    // A node placed by its matrix keeps its place there; the rest by position, turn and scale.
    let a, b, c, d, e, f, g, h, j, l;
    if (node.matrixAutoUpdate) {
      const { position: p, quaternion: q, scale: z } = node;
      a = p.x; b = p.y; c = p.z; d = q.x; e = q.y; f = q.z; g = q.w; h = z.x; j = z.y; l = z.z;
    } else {
      const m = node.matrix.elements;
      a = m[12]; b = m[13]; c = m[14]; d = m[0]; e = m[1]; f = m[2]; g = m[4]; h = m[5]; j = m[6]; l = m[8];
    }
    const shown = node.visible ? 1 : 0;
    if (!moved && (Math.abs(pose[k] - a) > MOTION_EPSILON || Math.abs(pose[k + 1] - b) > MOTION_EPSILON || Math.abs(pose[k + 2] - c) > MOTION_EPSILON
      || Math.abs(pose[k + 3] - d) > MOTION_EPSILON || Math.abs(pose[k + 4] - e) > MOTION_EPSILON || Math.abs(pose[k + 5] - f) > MOTION_EPSILON
      || Math.abs(pose[k + 6] - g) > MOTION_EPSILON || Math.abs(pose[k + 7] - h) > MOTION_EPSILON || Math.abs(pose[k + 8] - j) > MOTION_EPSILON
      || Math.abs(pose[k + 9] - l) > MOTION_EPSILON || pose[k + 10] !== shown)) moved = true;
    pose[k] = a; pose[k + 1] = b; pose[k + 2] = c; pose[k + 3] = d; pose[k + 4] = e;
    pose[k + 5] = f; pose[k + 6] = g; pose[k + 7] = h; pose[k + 8] = j; pose[k + 9] = l; pose[k + 10] = shown;
  }
  return moved;
}
const _point = new THREE.Vector3();

/**
 * Turn on the sun's shadows for a track being drawn: the cascades replace the plain sun light,
 * the world's models and the trucks cast, and everything lit receives. `trucks` are the trucks'
 * root objects. Only the middle copy of the wrapped world's models casts.
 *
 * With `natural` ("Natural light", docs/VISUALS.md) the ground casts as well, in every copy of
 * the world, so a cliff shades the canyon under it, and the cascades are drawn in closer, so a
 * truck's shadow is sharp.
 */
export function enableSunShadows({ renderer, scene, camera, world, sun, trucks = [], natural = false }) {
  renderer.shadowMap.enabled = true;
  // Soft-edged shadows (PCFSoft), as JSTrackViewer's scene draws them with its cascades.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  const tile = world.getObjectByName("tile");
  world.traverse((o) => {
    if (!o.isMesh || o.name === "sky") return;
    o.receiveShadow = true;
    // The ground is one sheet with nothing under it, and is drawn into the shadow map from behind (three.js's way with a
    // one-sided surface): the slopes turned from the sun cast, and a slope in the sun never shades itself.
    if (natural && o.name === "terrain") o.castShadow = true;
  });
  // Solid things cast, ground boxes among them; water does not, nor does CART Precision Racing's road surface (it would
  // shade itself and the ground it lies on; its walls do), nor do blended (see-through) surfaces. A caster
  // is drawn into the shadow map on the same side it is drawn on, which keeps thin walls from leaking light.
  const casts = (o) => {
    const m = o.material;
    if (!m || (m.transparent && !(m.alphaTest > 0))) return false;
    m.shadowSide = m.side;
    return true;
  };
  tile?.traverse((o) => {
    if (o.isMesh && o.name !== "terrain" && o.name !== "water" && o.name !== "road" && casts(o)) o.castShadow = true;
  });
  // A truck's lamps are light, not things: a beam drawn in the air casts no shadow. Nor does a body's reflection
  // (render/truck-reflection.js), the body drawn again over itself: its shadow would be the body's, drawn twice.
  for (const truck of trucks) truck.traverse((o) => { if (o.isMesh && o.parent?.name !== "lamps" && !o.userData.reflection) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.shadowSide = o.material.side; } });
  // The placed models are instanced over every copy; only the original's instances cast (track-scene.js).
  world.getObjectByName("objects")?.traverse((o) => { if (o.isInstancedMesh) o.castShadow = true; });
  // 4x4 Evolution's forest is drawn once, by chunks at the copy nearest the camera (track-scene.js `createForest`): each
  // chunk casts, and the shadow cameras cull the chunks out of their reach.
  world.getObjectByName("forest")?.traverse((o) => { if (o.isInstancedMesh && casts(o)) o.castShadow = true; });
  // A facing object (type 8 and 9 billboards) turns to the camera, which would swing its shadow around with the
  // view. Its shadow comes from an invisible copy held square to the sun instead (updateTrackWorld keeps it there).
  world.userData.shadowFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(sun.position.x, sun.position.z));
  // The instanced ones turn in their depth shader (track-scene.js `facingDepthMaterial`): the same turn, as its sine and cosine.
  const across = Math.hypot(sun.position.x, sun.position.z);
  world.userData.shadowTurn = across > 1e-6 ? new THREE.Vector2(sun.position.x / across, sun.position.z / across) : new THREE.Vector2(0, 1);
  tile?.traverse((group) => {
    if (group.name !== "placedObject" || !group.userData.billboard) return;
    for (const mesh of [...group.children]) {
      if (!mesh.isMesh) continue;
      mesh.castShadow = false;
      const source = mesh.material;
      const proxy = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
        map: source.map ?? null, alphaTest: source.alphaTest ?? 0, transparent: !!source.transparent,
        side: THREE.DoubleSide, colorWrite: false, depthWrite: false,
      }));
      proxy.castShadow = true;
      proxy.userData.shadowProxy = true;
      group.add(proxy);
    }
  });
  const shadows = new SunShadows({
    scene, camera, color: sun.color, intensity: sun.intensity,
    ...(natural ? { maxFar: SHADOW_FAR_FT, cascadeEnds: SHADOW_CASCADE_ENDS_FT } : { maxFar: 10240 }),
  });
  shadows.setDirection(sun.position.clone().negate());
  shadows.setEnabled(true);
  sun.visible = false;
  if (natural) shadows.keepStatic(renderer, world, trucks);
  shadows.watchMotion(world, trucks);
  return shadows;
}
