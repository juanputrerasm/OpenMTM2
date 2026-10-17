/*
  The land in the water (docs/VISUALS.md, "Water", "The land in it"; the numbers are game/water.js
  `WATER_REFLECTION`), for "Reflective water".

  A level mirror shows the eye what an eye as far under the water as it is over it would see of
  the land above the water. Once a frame, before the scene is drawn, this works that picture out
  as a map of directions from that eye under the water, a column for each way round and a row
  for each height: for each, the line is followed from where it comes up through the water to
  the first ground it meets, over the map of the drawn ground (render/ground-textures.js), and
  the ground there is lit as the scene's light lights it and hazed by how far the light has come
  from it to the eye. The water's shader (render/water-surface.js) reads the map along each
  point's own line off its waves, so the hills stand upside down in the water, broken up where
  the water is rough and whole where it is calm.

  A line runs over the highest ground in the cells it crosses (game/water.js `highestGround`), a
  cell at a time while it clears all of a cell, the wider the cells the more it clears, and
  against the drawn ground itself in a cell it does not clear: a line over open water takes a
  few reads and one that meets a hill a few more.

  It draws nothing of the scene and reads nothing back, and its cost does not grow with the
  picture: the map is the same size on any screen, and one serves both eyes of a headset.
  What stands on the ground (trees, buildings, the trucks) is not in it.
*/
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { WATER_REFLECTION, highestGround, landTones } from "../game/water.js";
import { WORLD_FT } from "../shared/scene-frame.js";

const { columns: COLUMNS, rows: ROWS, cellFt: CELL_FT, levels: LEVELS, stepFt: STEP_FT, stepShare: STEP_SHARE, reads: READS } = WATER_REFLECTION;
const glsl = (n) => n.toFixed(6);

/** The highest ground in each cell, as a texture of floats, one level a mipmap (read texel by texel). */
function highestTexture(groundMap, wraps) {
  const { levels, sides } = highestGround(groundMap.heights, groundMap.side, { worldFt: WORLD_FT, cellFt: CELL_FT, levels: 32, wraps });
  const texture = new THREE.DataTexture(levels[0], sides[0], sides[0], THREE.RedFormat, THREE.FloatType);
  texture.mipmaps = levels.map((data, i) => ({ data, width: sides[i], height: sides[i] }));
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, side: sides[0], topFt: Math.max(...levels.at(-1)) };
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/** The pass, for a map of the highest ground `side` cells square at its finest, of a world that repeats or (`wraps` false) is drawn once. */
const fragment = (side, wraps) => /* glsl */ `
    precision highp float;
    precision highp int;
    ${wraps ? "" : "#define EDGED"}
    uniform sampler2D uGround, uHighest, uTones;
    // the eye as far under the water as the real one is over it: the map's x and z (feet), its height; the water's level
    uniform vec4 uEye;
    // the ground map's reference height (feet), 1 / the world's width, the highest ground anywhere (feet)
    uniform vec3 uMap;
    // the way to the sun (scene axes); the light a face square to the sun takes from it, and what the sky gives every face
    uniform vec3 uSun, uSunLight, uSkyLight;
    // the haze's colour, as the water mixes it
    uniform vec3 uHorizon;
    // where the far fade starts and ends (feet), how thick the haze is a foot, how far a line is followed (feet)
    uniform vec4 uFade;
    // which half of the columns to work out this frame, in blocks of sixteen (0 or 1), or all of them (-1)
    uniform float uHalf;
    varying vec2 vUv;

    // A level drawn once has no ground past its edges.
    bool outside( vec2 p ) { return any( lessThan( p, vec2( 0.0 ) ) ) || any( greaterThan( p, vec2( ${WORLD_FT.toFixed(1)} ) ) ); }
    // The drawn ground's height at map point \`p\`, feet.
    float groundAt( vec2 p ) {
      #ifdef EDGED
        if ( outside( p ) ) return - 1e5;
      #endif
      return textureLod( uGround, p * uMap.y, 0.0 ).r + uMap.x;
    }
    // The highest ground in the cell \`cell\` of \`level\` (game/water.js \`highestGround\`), in which \`p\` lies.
    float highestIn( vec2 cell, vec2 p, int level ) {
      #ifdef EDGED
        if ( outside( p ) ) return - 1e5;
      #endif
      return texelFetch( uHighest, ivec2( cell ) & ( ( ${side} >> level ) - 1 ), level ).r;
    }

    void main() {
      if ( uHalf >= 0.0 && mod( floor( gl_FragCoord.x / 16.0 ), 2.0 ) != uHalf ) discard;
      // This point's line: a way round, as the water's own reads it (atan( x, -z ) in the scene), and a height, by the
      // square root of its sine (game/water.js \`reflectionRow\`).
      float around = vUv.x * 6.2831853, sine = vUv.y * vUv.y;
      float cosine = sqrt( max( 1.0 - sine * sine, 1e-8 ) ), rise = sine / cosine;
      vec2 way = vec2( sin( around ), cos( around ) );
      // It comes up through the water as far out as the eye is over it for each foot it climbs; past where it would be over
      // the highest ground there is, or the haze has hidden all, nothing more is met.
      float s = ( uEye.w - uEye.z ) / max( rise, 1e-6 );
      float far = min( uFade.w, ( uMap.z - uEye.z ) / max( rise, 1e-6 ) );
      gl_FragColor = vec4( 0.0 );
      if ( s >= far ) return;
      // How far the line runs on the map for a foot along each of its axes, and which of a cell's sides it leaves by.
      vec2 per = 1.0 / max( abs( way ), 1e-6 ), leaves = step( 0.0, way );
      int level = ${LEVELS - 1};
      float size = ${glsl(CELL_FT * 2 ** (LEVELS - 1))}, met = - 1.0, lastS = - 1.0, lastGap = 0.0, cellEnd = 0.0;
      for ( int i = 0; i < ${READS}; i ++ ) {
        if ( s > far ) break;
        vec2 p = uEye.xy + way * s;
        float y = uEye.z + s * rise;
        if ( level >= 0 ) {
          vec2 cell = floor( p * ( 1.0 / size ) ), out_ = abs( ( cell + leaves ) * size - p ) * per;
          float left = min( out_.x, out_.y ) + 0.02;
          // Over all the ground in this cell: on to where it leaves it, and try the wider cells. Not over it: the narrower,
          // and in the narrowest, the ground itself.
          if ( y > highestIn( cell, p, level ) ) { s += left; if ( level < ${LEVELS - 1} ) { level ++; size *= 2.0; } }
          else if ( level > 0 ) { level --; size *= 0.5; }
          else { level = - 1; cellEnd = s + left; lastS = - 1.0; }
        } else {
          // Against the ground itself, and where the line goes under it, between the last two steps.
          float gap = y - groundAt( p );
          if ( gap <= 0.0 ) { met = lastS >= 0.0 ? mix( lastS, s, lastGap / max( lastGap - gap, 1e-4 ) ) : s; break; }
          lastS = s;
          lastGap = gap;
          s += max( ${glsl(STEP_FT)}, s * ${glsl(STEP_SHARE)} );
          if ( s > cellEnd ) level = 0;
        }
      }
      if ( met < 0.0 ) return;
      // The ground it met: its own colour, lit by the sky and as the sun meets its slope, and hazed by how far the light
      // has come from it to the eye (as far as from this eye under the water).
      vec2 at = uEye.xy + way * met;
      float h0 = groundAt( at ), hx = groundAt( at + vec2( 6.0, 0.0 ) ), hz = groundAt( at + vec2( 0.0, 6.0 ) );
      vec3 normal = normalize( vec3( h0 - hx, 6.0, hz - h0 ) );
      vec3 tone = textureLod( uTones, at * uMap.y, 0.0 ).rgb;
      vec3 lit = tone * ( uSkyLight * ( 0.75 + 0.25 * normal.y ) + uSunLight * max( dot( normal, uSun ), 0.0 ) );
      float away = met / cosine;
      float haze = max( smoothstep( uFade.x, uFade.y, away ), 1.0 - exp( - uFade.z * away ) );
      gl_FragColor = vec4( mix( lit, uHorizon, haze ), 1.0 );
    }`;

/**
 * @param {{ renderer: THREE.WebGLRenderer, groundMap: { side: number, heights: Float32Array }, groundTexture: { texture: THREE.Texture, referenceFt: number },
 *   clr?: Uint16Array|Uint32Array|null, tones?: number[][]|null, fallbackTone?: number[], wraps?: boolean }} env
 *   `groundMap` the asset worker's map of the drawn ground and `groundTexture` the same as the
 *   water reads it; `clr` the terrain's cells and `tones` the mean colour of each ground texture
 *   (game/lighting.js `tileTones`), or `fallbackTone` for every cell; `wraps` false for a level
 *   drawn once.
 */
export function createWaterReflection({ renderer, groundMap, groundTexture, clr = null, tones = null, fallbackTone = [0.2, 0.16, 0.12], wraps = true }) {
  const highest = highestTexture(groundMap, wraps);
  const toneTexture = new THREE.DataTexture(landTones(clr, tones, fallbackTone), 256, 256, THREE.RGBAFormat);
  toneTexture.colorSpace = THREE.SRGBColorSpace;
  toneTexture.wrapS = toneTexture.wrapT = THREE.RepeatWrapping;
  toneTexture.magFilter = toneTexture.minFilter = THREE.LinearFilter;
  toneTexture.generateMipmaps = false;
  toneTexture.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(COLUMNS, ROWS, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  const uniforms = {
    uGround: { value: groundTexture.texture }, uHighest: { value: highest.texture }, uTones: { value: toneTexture },
    uEye: { value: new THREE.Vector4() },
    uMap: { value: new THREE.Vector3(groundTexture.referenceFt, 1 / WORLD_FT, highest.topFt) },
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunLight: { value: new THREE.Color() }, uSkyLight: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() }, uFade: { value: new THREE.Vector4() }, uHalf: { value: -1 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: fragment(highest.side, wraps), uniforms, depthTest: false, depthWrite: false });
  const quad = new FullScreenQuad(material);
  /** What the water's shader is given: the map, and whether it holds anything this frame. */
  const shared = { uLand: { value: target.texture }, uLandOn: { value: 0 } };
  /**
   * What the map was last worked out for: the eye under the water (map x and z, height) and the light, or null for nothing
   * yet; which half was worked out last, and whether the other half is still a frame behind it.
   */
  let last = null, half = 0, behind = false;
  const now = new Float32Array(16);

  return {
    uniforms: shared,
    /**
     * Before a frame is drawn: `eye` the eye's place in the scene (feet), `levelFt` the water's
     * level now, or nothing to show (the eye under the water, the water frozen). `light`: `sun`
     * the way to the sun (scene axes), `sunLight` what a face square to it takes from it and
     * `skyLight` what the sky gives any face (colours, as the water reckons its daylight),
     * `horizon` the haze's colour, `fade` [start, end] of the far fade and `haze` how thick it is
     * a foot.
     */
    render(eye, levelFt, light) {
      if (levelFt === null || levelFt === undefined || !(eye.y > levelFt)) { shared.uLandOn.value = 0; last = null; return; }
      now.set([eye.x, -eye.z, 2 * levelFt - eye.y, light.sun.x, light.sun.y, light.sun.z, light.sunLight.r + light.sunLight.g + light.sunLight.b,
        light.skyLight.r, light.skyLight.g, light.skyLight.b, light.horizon.r + light.horizon.g + light.horizon.b, light.fade[0], light.fade[1], light.haze * 1e4]);
      /*
        The map depends on where the eye is and not on where it looks. An eye that has not moved, under the same light (a
        paused race, a still camera), keeps it as it is. One that moves works out half its columns each frame, the other
        half the next, so that each is a frame old at most; one that stops works out the half that is behind, and then
        keeps it. A jump of the eye, or a change of the light, works it all out.
      */
      let whole = !last, still = !!last;
      if (last) {
        const moved = Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]);
        let changed = false;
        for (let i = 3; i < 14; i++) if (Math.abs(now[i] - last[i]) > 1e-3 * Math.max(1, Math.abs(last[i]))) changed = true;
        whole = changed || moved > 30;
        // (The water's bob alone moves the eye under it a few hundredths of a foot a frame: let it gather to a tenth.)
        still = !changed && moved < 0.1;
      }
      if (still && !behind) return;
      last = (last ?? new Float32Array(16));
      last.set(now);
      uniforms.uEye.value.set(eye.x, -eye.z, 2 * levelFt - eye.y, levelFt);
      uniforms.uSun.value.copy(light.sun);
      uniforms.uSunLight.value.copy(light.sunLight);
      uniforms.uSkyLight.value.copy(light.skyLight);
      uniforms.uHorizon.value.copy(light.horizon);
      uniforms.uFade.value.set(light.fade[0], light.fade[1], light.haze, light.fade[1]);
      uniforms.uHalf.value = whole ? -1 : (half ^= 1);
      behind = !whole && !still;
      // Drawn outside a headset's own drawing, which would otherwise draw it once for each eye; and over what is there,
      // which the half not worked out keeps.
      const was = renderer.getRenderTarget(), xr = renderer.xr.enabled, clear = renderer.autoClear;
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      quad.render(renderer);
      renderer.setRenderTarget(was);
      renderer.autoClear = clear;
      renderer.xr.enabled = xr;
      shared.uLandOn.value = 1;
    },
    dispose() {
      target.dispose();
      material.dispose();
      quad.dispose();
      highest.texture.dispose();
      toneTexture.dispose();
    },
  };
}
