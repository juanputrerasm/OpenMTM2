/*
  The port's own particles (docs/VISUALS.md, "Particles"; what each kind is made of and when a
  truck throws it are in game/particles.js), when "Rich particles" is on.

  Puffs are soft clouds: dust, smoke, the powder of snow, the mist of water. Each is a soft,
  lumpy ball that sits on the ground without being cut by it, and many of them make one even
  cloud (below, at `PUFF_VERTEX`).

  Streaks are small hard things in flight, drawn out along the way they move against the eye for
  as long as the eye blurs them: drops, chips of ice, clods; and sparks, glowing dots, which are
  their own light and far brighter than white (so the lens makes them glow).

  Both are one draw each however many there are, both are veiled by the fog, worked out at
  each particle's place and not at every point of it (a cloud of dust is many puffs deep), and
  both take the scene's own lights, so dust is dim at Night and orange at Dusk.
*/
import * as THREE from "three";
import { PUFF_POOL, STREAK_POOL, bubbleRiseFtS, bubbleSpiral, bubbleVelocity, bubbleWidth, puffCover, sparkFlight, sparkGlow } from "../game/particles.js";
import { VEIL_GLSL, veilUniforms } from "./atmosphere.js";
import { puffNoise } from "./noise-textures.js";

const GRAVITY = 32.2;
/** The noise inside a puff repeats every this many feet. */
const PUFF_NOISE_FT = 26;

/*
  A puff is a soft ball, a little flattened (`squash`), its thickness falling from its middle to
  nothing at its rim as 1 - r squared. It is drawn on a square that stands across the way to the
  eye at its near side, as wide as it looks from there, or over the whole picture when the eye
  is in it. Each point of the square works out exactly how much of the puff the way from the eye
  through it passes, cut off where it goes under the ground, which is taken as the plane of the
  ground under the puff, and, drawn into a picture of its own that reads the scene's depth
  (render/over-scene.js: through the lens, and wherever the puffs are heavy), where it meets
  whatever the scene has there: so the puff sits on the ground, and wraps a tire that stands in
  it, without being cut by either. Drawn straight over the scene (a headset, or without the
  lens) its depth is its square's, at its near side: what stands in front of it hides it, and
  what stands in it does not.
  What is inside it is noise in space, carried with it as it drifts, and it is lit by its height
  over the ground, alike for every puff: so a cloud of many puffs reads as one cloud.
*/
const PUFF_VERTEX = /* glsl */ `
// its middle (the scene's axes) and its radius, feet
attribute vec4 iPlace;
// its height over its width, how much it hides, how far through its life it is (0 to 1), how far its middle is over the ground under it (feet)
attribute vec4 iLook;
// its colour
attribute vec3 iTone;
// the way up off the ground under it (the scene's axes)
attribute vec3 iGround;
// how far it has been carried since it was thrown (the scene's axes)
attribute vec3 iDrift;
varying vec3 vRay, vTone, vGround, vDrift;
varying vec4 vPlace, vLook, vVeil;
${VEIL_GLSL}
void main() {
  vec3 middle = iPlace.xyz;
  float radius = iPlace.w;
  vec3 toEye = cameraPosition - middle;
  float dist = length( toEye );
  float near = projectionMatrix[ 3 ][ 2 ] / ( projectionMatrix[ 2 ][ 2 ] - 1.0 );
  vec3 corner;
  if ( dist - radius > near * 3.0 ) {
    // Across the way to the eye at its near side, as wide as it looks from there.
    vec3 way = toEye / dist;
    vec3 side = cross( vec3( 0.0, 1.0, 0.0 ), way );
    side = dot( side, side ) > 1e-6 ? normalize( side ) : vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    vec3 up = cross( way, side );
    float reach = ( dist - radius ) * radius / sqrt( dist * dist - radius * radius ) * 1.02;
    corner = middle + way * radius + ( side * position.x + up * position.y ) * 2.0 * reach;
  } else {
    // The eye is in it, or nearly: over the whole picture, just past the near plane.
    float d = near * 1.5;
    vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
    vec3 back = vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );
    corner = cameraPosition - back * d + right * ( position.x * 2.2 * d / projectionMatrix[ 0 ][ 0 ] ) + up * ( position.y * 2.2 * d / projectionMatrix[ 1 ][ 1 ] );
  }
  vRay = corner - cameraPosition;
  vPlace = iPlace;
  vLook = iLook;
  vTone = iTone;
  vGround = iGround;
  vDrift = iDrift;
  vVeil = mtmFogVeil( ( viewMatrix * vec4( middle, 1.0 ) ).xyz );
  gl_Position = projectionMatrix * viewMatrix * vec4( corner, 1.0 );
}`;

const PUFF_FRAGMENT = /* glsl */ `
uniform mat4 projectionMatrix;
uniform highp sampler3D uPuffNoise;
// the scene's depth, and the picture's size in points; whether it reads that depth, to stop where the scene stands in it
uniform sampler2D uSceneDepth;
uniform vec2 uSceneSize;
uniform float uSceneSoft;
uniform float uTime;
uniform vec3 uSunLight, uSkyLight, uGroundLight, uSunWay;
varying vec3 vRay, vTone, vGround, vDrift;
varying vec4 vPlace, vLook, vVeil;
// The noise inside a puff repeats every this many feet.
const float NOISE_FT = ${PUFF_NOISE_FT.toFixed(1)};
void main() {
  vec3 way = normalize( vRay );
  vec3 eye = cameraPosition - vPlace.xyz;
  float radius = vPlace.w;
  // In its own measure, where it is a ball of radius 1.
  vec3 stretch = vec3( 1.0, 1.0 / vLook.x, 1.0 ) / radius;
  vec3 e = eye * stretch, w = way * stretch;
  float a = dot( w, w ), b = dot( e, w ) / a;
  // How near the way passes its middle (squared, in its measure), and how far either side of there it is in it.
  vec3 closest = e - w * b;
  float q = dot( closest, closest );
  if ( q >= 1.0 ) discard;
  float h = sqrt( ( 1.0 - q ) / a );
  float t0 = max( - b - h, 0.0 ), t1 = - b + h;
  // Not under the ground under it.
  float over = dot( vGround, eye ) + vLook.w, climb = dot( vGround, way );
  if ( climb < 0.0 ) t1 = min( t1, - over / climb );
  else if ( over < 0.0 ) t0 = max( t0, - over / climb );
  // Not past what the scene has there, where it is drawn into a picture of its own that reads the scene's depth (render/over-scene.js).
  if ( uSceneSoft > 0.5 ) {
    float depth = texture2D( uSceneDepth, gl_FragCoord.xy / uSceneSize ).r;
    if ( depth < 1.0 ) {
      float ahead = projectionMatrix[ 3 ][ 2 ] / ( depth * 2.0 - 1.0 + projectionMatrix[ 2 ][ 2 ] );
      vec3 forward = - vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );
      t1 = min( t1, ahead / max( dot( way, forward ), 1e-3 ) );
    }
  }
  if ( t1 <= t0 ) discard;
  // How much of it the way passes: 1 - r squared summed along the way, as a share of the most (a ball's middle, 4/3 of its radius).
  float s0 = t0 + b, s1 = t1 + b;
  float through = ( ( 1.0 - q ) * ( s1 - s0 ) - a * ( s1 * s1 * s1 - s0 * s0 * s0 ) / 3.0 ) / ( 1.3333 * radius );
  // Lumpy inside, the lumps carried with it and boiling slowly; eaten away from its thin rim as it ages.
  vec3 boil = vec3( 0.0, uTime * 0.3, 0.0 );
  vec2 n1 = texture( uPuffNoise, ( cameraPosition + way * mix( t0, t1, 0.3 ) - vDrift - boil ) / NOISE_FT ).rg;
  vec2 n2 = texture( uPuffNoise, ( cameraPosition + way * mix( t0, t1, 0.7 ) - vDrift + boil ) / NOISE_FT ).rg;
  float lumps = clamp( 0.5 + 2.4 * ( ( n1.r - 0.5 ) * 0.4 + ( n1.g - 0.5 ) * 0.2 + ( n2.r - 0.5 ) * 0.25 + ( n2.g - 0.5 ) * 0.15 ), 0.0, 1.0 );
  float gone = 0.06 + 0.4 * vLook.z * vLook.z;
  float thick = max( through * ( 0.2 + 1.6 * lumps ) - gone * ( 1.0 - through ) * ( 1.5 - lumps ), 0.0 );
  float alpha = vLook.y * ( 1.0 - exp( - 3.0 * thick ) ) * 1.05;
  if ( alpha < 0.003 ) discard;
  // Lit from the sky above and the ground below by how high it is over the ground, alike for every puff.
  vec3 inside = eye + way * mix( t0, t1, 0.35 );
  float high = dot( vGround, inside ) + vLook.w;
  vec3 light = mix( uGroundLight, uSkyLight, clamp( 0.5 + high / 10.0, 0.0, 1.0 ) );
  // The sun: what of it gets through the puff to there, and how much of that the dust throws toward the eye, the
  // most when the eye looks toward the sun (dust throws light forward: Henyey and Greenstein's, g = 0.35).
  vec3 i = inside * stretch, s = uSunWay * stretch;
  float sa = dot( s, s ), sb = dot( i, s ) / sa;
  float sunward = - sb + sqrt( max( sb * sb - ( dot( i, i ) - 1.0 ) / sa, 0.0 ) );
  float shade = exp( - 2.5 * vLook.y * sunward / radius );
  float phase = 0.8775 / pow( 1.1225 - 0.7 * dot( way, uSunWay ), 1.5 );
  light += uSunLight * ( 0.3 + 0.7 * shade ) * ( 0.4 + 0.6 * phase );
  gl_FragColor = vec4( vTone * light, min( alpha, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vVeil.rgb, vVeil.a );
}`;

const STREAK_VERTEX = /* glsl */ `
// its head (the scene's axes) and its width, feet
attribute vec4 iPlace;
// its velocity (the scene's axes, feet a second) and how long a time of its flight it is drawn out over
attribute vec4 iWay;
// its colour and how much it hides
attribute vec4 iTone;
// 1 where it is its own light, -1 for a bubble
attribute float iGlow;
uniform float uViewHeight;
// how fast the eye itself moves (the scene's axes, feet a second): a streak is blurred by how it moves against the eye
uniform vec3 uEyeVelocity;
varying vec2 vAt;
varying vec4 vTone;
varying float vGlow, vLong;
varying vec4 vVeil;
${VEIL_GLSL}
void main() {
  vec3 trail = ( iWay.xyz - uEyeVelocity ) * iWay.w;
  float len = length( trail );
  vec3 toEye = cameraPosition - iPlace.xyz;
  float dist = length( toEye );
  // No thinner than a pixel: fainter instead.
  float pixel = dist * 2.0 / ( projectionMatrix[ 1 ][ 1 ] * uViewHeight );
  float width = max( iPlace.w, pixel );
  vec3 along = len > 1e-4 ? trail / len : vec3( 0.0, 1.0, 0.0 );
  vec3 across = cross( along, toEye );
  float wide = length( across );
  across = wide > 1e-5 ? across / wide : vec3( 1.0, 0.0, 0.0 );
  // From half a width ahead of its head back along the way it came.
  vec3 world = iPlace.xyz + along * ( width * 0.5 - position.y * ( len + width ) ) + across * ( position.x * width );
  vAt = vec2( position.x * 2.0, position.y );
  vLong = len / ( len + width );
  vTone = vec4( iTone.rgb, iTone.a * min( 1.0, iPlace.w / max( pixel, 1e-5 ) ) );
  vGlow = iGlow;
  vec4 view = viewMatrix * vec4( world, 1.0 );
  vVeil = mtmFogVeil( view.xyz );
  gl_Position = projectionMatrix * view;
}`;

const STREAK_FRAGMENT = /* glsl */ `
uniform vec3 uSunLight, uSkyLight;
varying vec2 vAt;
varying vec4 vTone;
varying float vGlow, vLong;
varying vec4 vVeil;
void main() {
  float glow = max( vGlow, 0.0 ), bubble = step( vGlow, - 0.5 );
  // Where in its fleck this point is, the top up.
  vec2 disc = vec2( vAt.x, vAt.y * 2.0 - 1.0 );
  float out_ = length( disc );
  // A short one is a round fleck; a long one a streak, bright at its head and thinning to its tail.
  float fleck = 1.0 - smoothstep( 0.45, 1.0, out_ );
  // A bubble is seen by the light its skin sends back, the light from above caught all round its edge: a bright rim about a
  // clearer middle, and a spark where its skin faces the light.
  float spark = 1.0 - smoothstep( 0.0, 0.3, length( disc - vec2( - 0.3, - 0.35 ) ) );
  float skin = smoothstep( 0.4, 0.78, out_ ) * ( 1.0 - smoothstep( 0.8, 1.0, out_ ) ) + 0.18 * ( 1.0 - smoothstep( 0.8, 1.0, out_ ) );
  fleck = mix( fleck, min( 1.0, skin + spark ), bubble );
  // (Where the picture is drawn with several samples a point, a point just off the streak has these a hair out of range.)
  float tail = max( 1.0 - vAt.x * vAt.x, 0.0 ) * pow( clamp( 1.0 - vAt.y, 0.0, 1.0 ), 1.5 ) * smoothstep( 0.0, 0.07, vAt.y );
  float alpha = vTone.a * mix( fleck, tail, vLong );
  if ( alpha < 0.004 ) discard;
  // Lit from above, as something small in the open air is; a bubble's spark brighter.
  vec3 color = vTone.rgb * mix( uSkyLight + uSunLight, vec3( 1.0 ), glow ) * ( 1.0 + bubble * spark );
  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Fog veils what is lit and dims what is its own light.
  gl_FragColor.rgb = mix( mix( gl_FragColor.rgb, vVeil.rgb, vVeil.a ), gl_FragColor.rgb * ( 1.0 - vVeil.a ), glow );
  // Its own light is added to the picture; the rest lies over it.
  gl_FragColor = vec4( gl_FragColor.rgb * alpha, alpha * ( 1.0 - glow ) );
}`;

function instanced(count, quad, attributes) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(quad), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const made = {};
  for (const [name, size] of Object.entries(attributes)) {
    made[name] = new THREE.InstancedBufferAttribute(new Float32Array(count * size), size).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, made[name]);
  }
  geometry.instanceCount = 0;
  return { geometry, ...made };
}

const CENTRED_QUAD = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
const STREAK_QUAD = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0];
const between = ([from, to], t) => from + (to - from) * t;

/** What a puff reads of the scene where it is drawn straight into it: nothing. */
const IN_SCENE = () => ({ uSceneDepth: { value: null }, uSceneSize: { value: new THREE.Vector2(1, 1) }, uSceneSoft: { value: 0 } });

/**
 * @param {{ scene: THREE.Scene, ground: (x: number, z: number, y: number) => number, random?: () => number, over?: object|null }} env
 *   `ground` is the height of what is drawn under a point at game (x, y, z), feet (on a bridge's deck, the deck): streaks
 *   land on it and puffs sit on it. `over`
 *   is what is drawn over the scene (render/over-scene.js), where the puffs are drawn when there is one, and which is
 *   told each frame how much of the picture their squares cover (its `load`).
 */
export function createParticles({ scene, ground, random = Math.random, over = null }) {
  const root = new THREE.Group();
  root.name = "particles";
  scene.add(root);
  const lights = { uSunLight: { value: new THREE.Color() }, uSkyLight: { value: new THREE.Color() }, uGroundLight: { value: new THREE.Color() }, uSunWay: { value: new THREE.Vector3(0, 1, 0) } };

  const puffBuffers = instanced(PUFF_POOL, CENTRED_QUAD, { iPlace: 4, iLook: 4, iTone: 3, iGround: 3, iDrift: 3 });
  const puffMesh = new THREE.Mesh(puffBuffers.geometry, new THREE.ShaderMaterial({
    uniforms: { ...veilUniforms(), ...lights, ...(over?.uniforms ?? IN_SCENE()), uPuffNoise: { value: puffNoise() }, uTime: { value: 0 } },
    vertexShader: PUFF_VERTEX, fragmentShader: PUFF_FRAGMENT, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  }));
  const streakBuffers = instanced(STREAK_POOL, STREAK_QUAD, { iPlace: 4, iWay: 4, iTone: 4, iGlow: 1 });
  const streakMesh = new THREE.Mesh(streakBuffers.geometry, new THREE.ShaderMaterial({
    uniforms: { ...veilUniforms(), ...lights, uViewHeight: { value: 900 }, uEyeVelocity: { value: new THREE.Vector3() } },
    vertexShader: STREAK_VERTEX, fragmentShader: STREAK_FRAGMENT, transparent: true, premultipliedAlpha: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  }));
  for (const mesh of [puffMesh, streakMesh]) {
    // Placed by their own numbers, wherever the mesh itself is.
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    root.add(mesh);
  }
  // The puffs over the scene, where there is what draws them so.
  if (over) over.scene.add(puffMesh);

  /** Live puffs and streaks, in game axes; the dead wait in `spare` to be used again. */
  const puffs = [], streaks = [], sparePuffs = [], spareStreaks = [];
  let lastEye = null, clock = 0;
  /**
   * The ground under puff `p` as a plane, from the ground's height about where it is now: the point of it under the
   * puff (`gx`, `floor`, `gz`) and the way up off it (`nx`, `ny`, `nz`, game axes). Over water it is the water's level.
   */
  function underPuff(p, waterFt) {
    const e = 1.5, floor = ground(p.x, p.z, p.y);
    let nx = -(ground(p.x + e, p.z, p.y) - ground(p.x - e, p.z, p.y)) / (2 * e), nz = -(ground(p.x, p.z + e, p.y) - ground(p.x, p.z - e, p.y)) / (2 * e);
    p.floor = floor;
    if (waterFt !== null && waterFt > floor) { p.floor = waterFt; nx = nz = 0; }
    const length = Math.hypot(nx, 1, nz);
    p.nx = nx / length; p.ny = 1 / length; p.nz = nz / length;
    p.gx = p.x; p.gz = p.z;
  }
  const order = [];
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), tone = new THREE.Color(), ambient = new THREE.Color();

  return {
    /**
     * A puff of `kind` (an entry of game/particles.js `PUFF_KINDS`) at game (x, y, z), thrown at
     * (vx, vy, vz) ft/s. `tone` is its colour where it is not the kind's own (dust takes the
     * ground's), `scale` its size against the kind's and `thick` how much it hides against the
     * kind's.
     */
    puff(kind, x, y, z, vx = 0, vy = 0, vz = 0, { tone: colour = kind.tone, scale = 1, thick = 1, life = 1 } = {}) {
      if (puffs.length >= PUFF_POOL) return;
      const p = sparePuffs.pop() ?? {};
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.x0 = x; p.y0 = y; p.z0 = z; p.gx = null;
      p.size = between(kind.sizeFt, random()) * scale; p.grow = kind.growFt * scale * (0.75 + 0.5 * random());
      p.life = between(kind.lifeS, random()) * life; p.age = 0; p.squash = kind.squash ?? 1;
      p.opacity = kind.opacity * thick; p.rise = kind.riseFtPerS; p.drag = kind.drag;
      p.r = colour[0]; p.g = colour[1]; p.b = colour[2];
      puffs.push(p);
    },
    /**
     * A streak of `kind` (an entry of `STREAK_KINDS`) from game (x, y, z) at (vx, vy, vz) ft/s.
     * `onLand(x, y, z, onWater)` is called where it comes down, if it does before its time is up;
     * `width` (feet) and `opacity` are its own, where they are not the kind's.
     * Returns it, or nothing when the pool is full.
     */
    streak(kind, x, y, z, vx, vy, vz, { tone: colour = kind.tone, onLand = null, width = null, opacity = null } = {}) {
      if (streaks.length >= STREAK_POOL) return;
      const s = spareStreaks.pop() ?? {};
      s.x = x; s.y = y; s.z = z; s.vx = vx; s.vy = vy; s.vz = vz;
      s.life = between(kind.lifeS, random()); s.age = 0; s.kind = kind; s.onLand = onLand; s.bounces = 0;
      s.r = colour[0]; s.g = colour[1]; s.b = colour[2];
      s.width = kind.widthFt; s.terminal = 0; s.heat = 0;
      // A spark or a drop: its own size, and how hard the air brakes it (the smaller, the harder); a spark, how hot it leaves.
      if (kind.terminalFtS) {
        const size = random();
        s.width = kind.widthFt * (0.7 + 0.6 * size);
        s.terminal = between(kind.terminalFtS, size);
        if (kind.glow) s.heat = 0.85 + 0.3 * random();
      }
      if (width !== null) s.width = width;
      // A bubble: its own size, and from it how fast it rises and how it spirals as it goes (game/particles.js `BUBBLES`).
      if (kind.rises) {
        s.width = width ?? bubbleWidth(random);
        const spiral = bubbleSpiral(s.width);
        s.rise = bubbleRiseFtS(s.width); s.turn = spiral.turnsPerS * Math.PI * 2; s.spiral = spiral.radiusFt; s.phase = random() * Math.PI * 2;
      }
      s.opacity = opacity ?? kind.opacity;
      streaks.push(s);
      return s;
    },
    /**
     * Once a frame. `camera` is the eye; `light` the scene's own lights `{ sun, ambient,
     * hemisphere }` (the last null without "Natural light"); `waterFt` the water's level now or
     * null, and `frozen` whether it is ice; `viewHeight` the picture's height in pixels.
     */
    update(dt, { camera, light = {}, waterFt = null, frozen = false, viewHeight = 900 } = {}) {
      // What a face of each kind is lit by, as three.js lights a matt one: a light's colour times its strength, over pi.
      const { sun = null, ambient: flat = null, hemisphere = null } = light;
      ambient.setScalar(0);
      if (flat) ambient.copy(flat.color).multiplyScalar(flat.intensity / Math.PI);
      lights.uSkyLight.value.copy(ambient);
      lights.uGroundLight.value.copy(ambient);
      if (hemisphere) {
        lights.uSkyLight.value.add(tone.copy(hemisphere.color).multiplyScalar(hemisphere.intensity / Math.PI));
        lights.uGroundLight.value.add(tone.copy(hemisphere.groundColor).multiplyScalar(hemisphere.intensity / Math.PI));
      }
      if (sun) {
        lights.uSunLight.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
        lights.uSunWay.value.copy(sun.position).normalize();
      } else lights.uSunLight.value.setScalar(0);
      streakMesh.material.uniforms.uViewHeight.value = viewHeight;
      // How fast the eye moves, from where it was a frame ago; none across a jump (a new view, a reset).
      const eyeVelocity = streakMesh.material.uniforms.uEyeVelocity.value;
      if (lastEye && dt > 0) {
        eyeVelocity.copy(camera.position).sub(lastEye).divideScalar(dt);
        if (eyeVelocity.length() > 300) eyeVelocity.set(0, 0, 0);
      }
      (lastEye ??= new THREE.Vector3()).copy(camera.position);

      // Puffs drift, swell and thin.
      clock += dt;
      puffMesh.material.uniforms.uTime.value = clock % 1000;
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.age += dt;
        if (p.age >= p.life) { sparePuffs.push(p); puffs[i] = puffs[puffs.length - 1]; puffs.pop(); continue; }
        const slow = Math.exp(-p.drag * dt);
        p.vx *= slow; p.vy *= slow; p.vz *= slow;
        p.x += p.vx * dt; p.y += (p.vy + p.rise) * dt; p.z += p.vz * dt;
        // The ground under it, as a plane, looked at again when it has drifted a foot: the water's level over water.
        if (p.gx === null || Math.abs(p.x - p.gx) + Math.abs(p.z - p.gz) > 1) underPuff(p, waterFt);
      }
      // Furthest first, so each lies over those behind it.
      camera.getWorldDirection(forward);
      const ex = camera.position.x, ey = camera.position.y, ez = camera.position.z;
      order.length = puffs.length;
      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i];
        p.depth = (p.x - ex) * forward.x + (p.y - ey) * forward.y + (-p.z - ez) * forward.z;
        order[i] = p;
      }
      order.sort((a, b) => b.depth - a.depth);
      const { iPlace, iLook, iTone, iGround, iDrift } = puffBuffers;
      const place = iPlace.array, look = iLook.array, tones = iTone.array, lie = iGround.array, drift = iDrift.array;
      // How much of the picture the puffs' squares cover between them, for what draws them (render/over-scene.js).
      const view = camera.matrixWorld.elements, lens = camera.projectionMatrix.elements;
      right.set(view[0], view[1], view[2]);
      up.set(view[4], view[5], view[6]);
      const focal = lens[5], aspect = lens[5] / lens[0], near = camera.near ?? 0.5;
      let cover = 0;
      for (let i = 0; i < order.length; i++) {
        const p = order[i], t = p.age / p.life;
        // It swells fast at first; it comes up out of nothing in its first moments and thins to nothing at its end.
        const o = i * 4, o3 = i * 3, radius = p.size + p.grow * (1 - (1 - t) * (1 - t));
        place[o] = p.x; place[o + 1] = p.y; place[o + 2] = -p.z; place[o + 3] = radius;
        look[o] = p.squash; look[o + 1] = p.opacity * Math.min(1, t / 0.07) * (1 - t) ** 1.3; look[o + 2] = t;
        look[o + 3] = p.nx * (p.x - p.gx) + p.ny * (p.y - p.floor) + p.nz * (p.z - p.gz);
        tones[o3] = p.r; tones[o3 + 1] = p.g; tones[o3 + 2] = p.b;
        lie[o3] = p.nx; lie[o3 + 1] = p.ny; lie[o3 + 2] = -p.nz;
        drift[o3] = p.x - p.x0; drift[o3 + 1] = p.y - p.y0; drift[o3 + 2] = p.z0 - p.z;
        if (over) {
          const dx = p.x - ex, dy = p.y - ey, dz = -p.z - ez;
          cover += puffCover(dx * right.x + dy * right.y + dz * right.z, dx * up.x + dy * up.y + dz * up.z, p.depth, radius, focal, aspect, near);
        }
      }
      if (over) over.load = cover;
      puffBuffers.geometry.instanceCount = order.length;
      puffMesh.visible = order.length > 0;
      // Only the puffs there are: the rest of the pool is not sent.
      if (order.length) {
        for (const attribute of [iPlace, iLook, iTone, iGround, iDrift]) {
          attribute.clearUpdateRanges();
          attribute.addUpdateRange(0, order.length * attribute.itemSize);
          attribute.needsUpdate = true;
        }
      }

      // Streaks fly and fall.
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i];
        s.age += dt;
        const rises = s.kind.rises;
        if (rises) {
          // A bubble: the water takes what it was thrown with at once, and it rises as fast as its size lets it.
          const v = bubbleVelocity([s.vx, s.vy, s.vz], dt, s.rise);
          s.vx = v[0]; s.vy = v[1]; s.vz = v[2];
        } else if (s.terminal) {
          // A spark or a drop is braked by the air toward its terminal speed; a spark cools as it flies (game/particles.js).
          const v = sparkFlight([s.vx, s.vy, s.vz], dt, s.terminal, GRAVITY);
          s.vx = v[0]; s.vy = v[1]; s.vz = v[2];
          if (s.kind.glow) s.heat *= Math.exp(-dt / (s.life * 0.5));
        } else s.vy -= GRAVITY * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        // A bubble is gone at the surface, or in the open air (it was let go where the water is not, or the water fell).
        let over = s.age >= s.life || (rises && (waterFt === null || s.y >= waterFt)) || (s.kind.glow && s.heat < 0.03);
        if (!over && s.vy < 0) {
          const floor = ground(s.x, s.z, s.y);
          const wet = waterFt !== null && floor < waterFt;
          const top = wet ? waterFt : floor;
          if (s.y < top) {
            s.onLand?.(s.x, top, s.z, wet && !frozen);
            // Off hard ground and ice it skips on, a few times; into water or soft ground it is gone.
            if (s.kind.bounce > 0 && (!wet || frozen) && s.bounces < 3 && -s.vy > 3) {
              // A spark skids on along the ground, and the ground cools it.
              const along = s.kind.glow ? 0.7 : 0.6;
              s.y = top; s.vy = -s.vy * s.kind.bounce; s.vx *= along; s.vz *= along; s.bounces++;
              if (s.kind.glow) s.heat *= 0.7;
            } else over = true;
          }
        }
        if (over) { s.onLand = null; spareStreaks.push(s); streaks[i] = streaks[streaks.length - 1]; streaks.pop(); }
      }
      const head = streakBuffers.iPlace.array, way = streakBuffers.iWay.array, hue = streakBuffers.iTone.array, glow = streakBuffers.iGlow.array;
      for (let i = 0; i < streaks.length; i++) {
        const s = streaks[i], kind = s.kind, t = s.age / s.life;
        const o = i * 4;
        head[o] = s.x; head[o + 1] = s.y; head[o + 2] = -s.z; head[o + 3] = s.width;
        // A bubble is drawn where its spiral has it about the line it rises on.
        if (kind.rises && s.spiral > 0) {
          const turned = s.phase + s.turn * s.age;
          head[o] += Math.cos(turned) * s.spiral; head[o + 2] -= Math.sin(turned) * s.spiral;
        }
        way[o] = s.vx; way[o + 1] = s.vy; way[o + 2] = -s.vz; way[o + 3] = kind.trailS;
        // A spark cools as it flies and dims as it goes out; anything else thins over the last part of its time.
        const fade = Math.min(1, (1 - t) / 0.25);
        if (kind.glow) {
          // Its light is its heat's (game/particles.js `sparkGlow`).
          const lit = sparkGlow(s.heat);
          hue[o] = lit[0] * fade; hue[o + 1] = lit[1] * fade; hue[o + 2] = lit[2] * fade;
          hue[o + 3] = kind.opacity;
        } else { hue[o] = s.r; hue[o + 1] = s.g; hue[o + 2] = s.b; hue[o + 3] = s.opacity * fade; }
        // (-1 is a bubble, which the shader draws by the light its skin sends back.)
        glow[i] = kind.rises ? -1 : kind.glow;
      }
      streakBuffers.geometry.instanceCount = streaks.length;
      if (streaks.length) streakBuffers.iPlace.needsUpdate = streakBuffers.iWay.needsUpdate = streakBuffers.iTone.needsUpdate = streakBuffers.iGlow.needsUpdate = true;
    },
    /** How many of each are in the air, for tests in the browser. */
    get counts() { return { puffs: puffs.length, streaks: streaks.length }; },
    dispose() {
      scene.remove(root);
      over?.scene.remove(puffMesh);
      for (const mesh of [puffMesh, streakMesh]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    },
  };
}
