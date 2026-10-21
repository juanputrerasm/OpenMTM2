/*
  The fog along every way from the eye, worked out once a frame (docs/VISUALS.md, "Fog").

  A fragment's fog is its line from the eye cut in slices that end at the same distances for
  every line (render/atmosphere.js `mtmFogAlong`): the first at a twenty-fifth of the banks'
  reach, the second at four twenty-fifths, and so on by the square. What a line has met by the
  end of a slice it passes whole depends on its way alone, not on how far it runs. So before
  the scene is drawn, a small picture of the ways the eye looks in (`FOG_STATE_SHRINK` times
  smaller than the screen each way) is worked out with the slices' own code: in three bands side
  by side, after slices one and two, three and four, and five, how much of the light still comes
  through and how much of the fog's light has been seen. A fragment reads its whole slices there
  and works out only the slice it ends in, and the even fog beyond the slices.

  Half floats hold those to a two-thousandth, and a way between the picture's points is read
  between them; the banks change over hundreds of feet, so a fragment's fog is as it was to well
  under a step of an 8 bit picture.

  Only the eye the picture was worked out from reads it, and only while `draw` draws the scene
  (render/scenery.js): a mirror's eye, the water's mirrored one and a headset's two work their fog
  out as before. A fog with billows is stepped through each fragment's own way, and is not worked
  out ahead.
*/
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { ATMOSPHERE_GLSL, atmosphere, atmosphereUniforms } from "./atmosphere.js";

/** How many times smaller the picture of the ways is than the screen, each way. */
export const FOG_STATE_SHRINK = 16;

const PASS_VERTEX = /* glsl */ `
void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;
const PASS_FRAGMENT = /* glsl */ `
// From a point of the picture to the world (the eye's turn and lens, unshifted, undone), where the eye is, and a band's size.
uniform mat4 uFromView;
uniform vec3 uEye;
uniform vec2 uBand;
#define cameraPosition uEye
${ATMOSPHERE_GLSL}
void main() {
  float band = floor( gl_FragCoord.x / uBand.x );
  vec2 at = vec2( gl_FragCoord.x - band * uBand.x, gl_FragCoord.y ) / uBand;
  vec4 end = uFromView * vec4( at * 2.0 - 1.0, 1.0, 1.0 );
  vec3 dir = normalize( end.xyz / end.w - uEye );
  // The line as render/atmosphere.js \`mtmFogAlong\` takes it, slice by slice, to the last this band keeps.
  float far = mtmFog[ 6 ].x, billowFt = mtmFog[ 7 ].x;
  int slices = int( mtmFog[ 4 ].w + 0.5 ), steps = int( mtmFog[ 6 ].y + 0.5 );
  float bandLow = - 0.6 * billowFt - mtmFog[ 8 ].y, bandHigh = 0.6 * billowFt + 3.0 * mtmFog[ 8 ].z;
  vec2 sunFlat = mtmFog[ 2 ].xz / max( length( mtmFog[ 2 ].xz ), 1e-4 );
  float clear = 1.0, seen = 0.0, from = 0.0;
  int kept = int( band ), last = kept * 2 + 2;
  vec4 state = vec4( 1.0, 0.0, 1.0, 0.0 );
  for ( int i = 0; i < 6; i ++ ) {
    if ( i >= slices || i >= last ) break;
    float part = float( i + 1 ) / float( slices );
    float to = far * part * part;
    mtmFogSlice( dir, from, to, billowFt, bandLow, bandHigh, sunFlat, steps, clear, seen );
    from = to;
    if ( i / 2 == kept ) {
      if ( i % 2 == 0 ) state.xy = vec2( clear, seen );
      else state.zw = vec2( clear, seen );
    }
  }
  gl_FragColor = state;
}
`;

/**
 * The one picture, for every race's materials: each takes its own copy of the list of it as it is built, so it is made once
 * and kept, and only resized (render/atmosphere.js `aheadPicture`).
 */
let picture = null;
function pictureOf(w, h) {
  if (!picture) {
    picture = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    picture.texture.name = "fog state";
    atmosphere.aheadPicture(picture.texture);
  } else if (picture.width !== w || picture.height !== h) picture.setSize(w, h);
  return picture;
}

/**
 * The picture of the fog along every way, for the screen's frames (render/scenery.js), made with the scene, before its
 * materials are built. `prepare` works it out for `camera` on a screen `width` by `height` and tells every material it
 * may read it (render/atmosphere.js `atmosphere.ahead`); `end` takes that back once the scene is drawn.
 */
export function createFogState({ renderer }) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...atmosphereUniforms(), uFromView: { value: new THREE.Matrix4() }, uEye: { value: new THREE.Vector3() }, uBand: { value: new THREE.Vector2() } },
    vertexShader: PASS_VERTEX, fragmentShader: PASS_FRAGMENT,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(material);
  const view = new THREE.Matrix4(), eye = new THREE.Vector3();
  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
  const sized = (width, height) => [Math.max(1, Math.ceil(width / FOG_STATE_SHRINK)), Math.max(1, Math.ceil(height / FOG_STATE_SHRINK))];
  const [w0, h0] = sized(drawing.x, drawing.y);
  pictureOf(w0 * 3, h0);
  /** Work the picture out for `camera`, `width` by `height` points of the screen. */
  const work = (camera, width, height) => {
    const [w, h] = sized(width, height);
    const target = pictureOf(w * 3, h);
    camera.updateMatrixWorld();
    view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.getWorldPosition(eye);
    material.uniforms.uFromView.value.copy(view).invert();
    material.uniforms.uEye.value.copy(eye);
    material.uniforms.uBand.value.set(w, h);
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    quad.render(renderer);
    renderer.setRenderTarget(before);
  };
  return {
    prepare(camera, width, height) {
      if (!atmosphere.on || atmosphere.billows) { atmosphere.ahead(); return; }
      work(camera, width, height);
      atmosphere.ahead(eye, view);
    },
    end() { atmosphere.ahead(); },
    /** Build the pass's shader ahead of need, whatever the weather now (render/scenery.js `compile`). */
    warm(camera, width, height) { work(camera, width, height); },
    dispose() {
      atmosphere.ahead();
      material.dispose();
      quad.dispose();
    },
  };
}
