/*
  What is drawn over the scene (docs/VISUALS.md, "How a puff is drawn"): the puffs of dust,
  smoke, powder and mist (render/particles.js), after the scene and apart from it.

  A puff is drawn on a square, and every point of every square is worked out and laid over
  the picture. Following trucks through their dust the squares add up to dozens of pictures'
  worth, and filling them is then most of a frame's work on a small graphics chip (65
  pictures' worth, 34 ms of a 56 ms frame, measured on an Intel HD 630 at 1920 x 1080). So
  the puffs are drawn one of two ways, by how much of the picture their squares cover
  (game/particles.js `OVER`):

    - Light: at the picture's own size. Through the lens into a picture of their own,
      reading the scene's depth, so a puff stops softly where the scene stands in it. Without
      the lens straight over the scene, hidden by what stands in front of each square.
    - Heavy: into a picture `OVER.shrink` times smaller each way, and laid over the scene
      from that. Thick dust has no edge the smaller picture could lose. Through the lens a
      puff reads the scene's depth and stops where the scene stands in it, as when light.
      Without the lens the small picture has a depth of its own, filled from the scene's, and
      a puff is hidden by what stands in front of its square, as when light: the same shader
      and the same test, on fewer points, so the dust looks the same either side of the change.
      The small picture comes back to the picture's size by the scene's depth (`UPSIZE`), so what stands in
      the dust keeps its own outline and not the small picture's steps.

  The heavy way needs the scene's depth as a texture. The lens and the optional
  anti-aliasing draw the scene into a picture that has one. The plain screen has its depth
  where no shader can read it, but the browser will copy it into a texture of the same format
  (`findScreenDepth`), and then the scene is drawn to the screen as ever and nothing but the
  puffs is drawn another way. Where the browser will not, `present` draws the scene, while the
  puffs are heavy and only then, into a picture of its own first (`asScreen`) and puts both on
  the screen in one pass: 4.5 ms a frame on the chip above, which is why that is not the
  first choice, and not used while the puffs are light.
*/
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { OVER, overIsHeavy } from "../game/particles.js";

/*
  Make `target` a picture the materials colour exactly as they colour the screen: encoded for
  the screen and through its tone curve, so what is drawn into it and copied to the screen is,
  point for point, what drawing to the screen would have left there. three.js (r169, the
  version index.html pins) keeps that for the screen and for a headset's pictures, which it
  knows by `isXRRenderTarget`; nothing else in it reads that mark off a target. The picture is
  then encoded bytes, so its format is named: the samples and the texture they are resolved
  into must be of one format, and three.js would pick a decoding one for the texture alone.
*/
function asScreen(renderer, target) {
  target.isXRRenderTarget = true;
  target.texture.colorSpace = renderer.outputColorSpace;
  if (target.texture.type === THREE.UnsignedByteType) target.texture.internalFormat = "RGBA8";
  return target;
}

/** The scene and what is over it, on the screen: both are what the screen takes already. */
const PRESENT = {
  uniforms: { tScene: { value: null }, tOver: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene, tOver;
    varying vec2 vUv;
    void main() {
      // What is over the scene has its colour already times how much it hides.
      vec4 over = texture2D( tOver, vUv );
      gl_FragColor = vec4( texture2D( tScene, vUv ).rgb * ( 1.0 - over.a ) + over.rgb, 1.0 );
    }`,
};

/** What is over the scene, laid on the picture being drawn: its colour is already times how much it hides. */
const LAY = {
  uniforms: { tOver: { value: null } },
  vertexShader: PRESENT.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tOver;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D( tOver, vUv ); }`,
};

/** The scene's depth into the depth of the picture being drawn, which is smaller: each point takes the scene's there. */
const DEPTH = {
  uniforms: { tDepth: { value: null } },
  vertexShader: PRESENT.vertexShader,
  fragmentShader: /* glsl */ `
    uniform highp sampler2D tDepth;
    varying vec2 vUv;
    void main() { gl_FragDepth = texture2D( tDepth, vUv ).r; gl_FragColor = vec4( 0.0 ); }`,
};

/*
  The small picture of heavy puffs back to the picture's size, by the scene's depth. Each small point was worked out at
  the scene's depth at its middle, so where a truck stands in front of the ground, the four small points around a point
  of the picture saw two things and blending them drew the truck's outline in steps `OVER.shrink` wide. A point whose
  four agree with its own depth blends them, as before; one where they do not takes the one whose depth is nearest its own.
*/
const UPSIZE = {
  uniforms: { tOver: { value: null }, tDepth: { value: null }, uSmall: { value: new THREE.Vector2(1, 1) }, uProjection: { value: new THREE.Matrix4() } },
  vertexShader: PRESENT.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tOver;
    uniform highp sampler2D tDepth;
    uniform vec2 uSmall;
    uniform mat4 uProjection;
    varying vec2 vUv;
    // How far ahead the scene is at a depth, in feet; the sky far beyond anything.
    float ahead( float depth ) {
      return depth >= 1.0 ? 1e6 : uProjection[ 3 ][ 2 ] / ( depth * 2.0 - 1.0 + uProjection[ 2 ][ 2 ] );
    }
    void main() {
      float here = ahead( texture2D( tDepth, vUv ).r );
      vec2 corner = floor( vUv * uSmall - 0.5 ) + 0.5;
      vec2 best = corner / uSmall;
      float nearest = 1e9, worst = 0.0;
      for ( int i = 0; i < 4; i++ ) {
        vec2 at = ( corner + vec2( float( i - ( i / 2 ) * 2 ), float( i / 2 ) ) ) / uSmall;
        float off = abs( ahead( texture2D( tDepth, at ).r ) - here ) / here;
        worst = max( worst, off );
        if ( off < nearest ) { nearest = off; best = at; }
      }
      gl_FragColor = texture2D( tOver, worst < 0.1 ? vUv : best );
    }`,
};

/**
 * The depth formats a screen may have, most likely first, as three.js names them: 24 bits with a stencil's 8 (what a
 * browser makes even where no stencil was asked for), 24 bits, 32 bit floats, 16 bits.
 */
const SCREEN_DEPTHS = [
  [THREE.DepthStencilFormat, THREE.UnsignedInt248Type], [THREE.DepthFormat, THREE.UnsignedIntType],
  [THREE.DepthFormat, THREE.FloatType], [THREE.DepthFormat, THREE.UnsignedShortType],
];

/**
 * @param {{ renderer: THREE.WebGLRenderer, plainScreen?: boolean, soft?: boolean }} env
 *   `plainScreen` says the scene is drawn straight to the screen (no lens, MSAA), which `present` is for: the puffs'
 *   own picture then takes colours as the screen does. Otherwise it takes them as light, as the lens's picture and
 *   the anti-aliasing's do. `soft` says a puff drawn into its own picture reads the scene's depth and stops where the
 *   scene stands in it (the lens's way); otherwise that picture has a depth of its own, filled from the scene's, and a
 *   puff is hidden by what stands in front of its square, as one drawn straight over the scene is.
 */
export function createOverScene({ renderer, plainScreen = false, soft = false }) {
  const scene = new THREE.Scene();
  scene.name = "over the scene";
  /**
   * What its materials read of the scene: its depth, the size of the picture they are drawn into, and 1 where they
   * read that depth to stop where the scene stands in them (0: they are hidden by the picture's own depth instead).
   */
  const uniforms = { uSceneDepth: { value: null }, uSceneSoft: { value: 0 }, uSceneSize: { value: new THREE.Vector2(1, 1) } };
  const pass = (shader, more = {}) => new THREE.ShaderMaterial({ ...shader, uniforms: THREE.UniformsUtils.clone(shader.uniforms), depthTest: false, depthWrite: false, toneMapped: false, ...more });
  const presenting = pass(PRESENT);
  const laying = pass(LAY, { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const deepening = pass(DEPTH, { depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, colorWrite: false });
  const upsizing = pass(UPSIZE);
  const quad = new FullScreenQuad(presenting);
  const clearColor = new THREE.Color(), drawing = new THREE.Vector2();
  // The samples the screen takes a point, for the scene's picture to take as many.
  const screenSamples = (() => {
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    const gl = renderer.getContext(), samples = gl.getParameter(gl.SAMPLES);
    renderer.setRenderTarget(before);
    return samples > 1 ? samples : 0;
  })();
  /** The puffs' own pictures, made when first drawn into: the picture's size, and `OVER.shrink` times smaller. */
  let full = null, small = null;
  /** The screen's depth copied to a texture, for `present`: null until it is tried, false where the browser will not copy it. */
  let screenDepth = null;
  /** The scene's picture for `present` where there is no copy of the screen's depth, made the first time it is needed. */
  let sceneTarget = null;
  let load = 0, heavy = false;
  /** Whether `present` has drawn its first frame, and whether the scene's picture could not be made. */
  let presented = false, unfit = false;
  // The puffs' picture: bytes the screen would take where it is laid on the screen, light where it is laid on a picture
  // of light. Where a puff does not read the scene's depth (`soft`) the picture has a depth of its own to hide it.
  const picture = (w, h) => {
    const target = new THREE.WebGLRenderTarget(w, h, { type: plainScreen ? THREE.UnsignedByteType : THREE.HalfFloatType, depthBuffer: !soft });
    return plainScreen ? asScreen(renderer, target) : target;
  };
  /** Copy the screen's depth into `target`'s. The browser refuses (an error, read by the caller) where the two are not of one format. */
  const copyScreenDepth = (target, w, h) => {
    const gl = renderer.getContext(), before = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    // Read from the screen. (Asked of the context itself: three.js binds a picture for reading and drawing at once and
    // keeps no note of the reading side, which it takes to be the screen whenever it has not said otherwise. So is it left.)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    renderer.setRenderTarget(before);
  };
  /**
   * A picture whose depth the screen's can be copied into, holding this frame's, or false. What format the screen's
   * depth has is the browser's to choose and not told, so each likely one is tried, once, as the race starts.
   */
  const findScreenDepth = (w, h) => {
    const gl = renderer.getContext();
    for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++);
    for (const [format, type] of SCREEN_DEPTHS) {
      const depth = new THREE.DepthTexture(w, h, type, undefined, undefined, undefined, THREE.NearestFilter, THREE.NearestFilter, undefined, format);
      const target = new THREE.WebGLRenderTarget(w, h, { depthTexture: depth, stencilBuffer: format === THREE.DepthStencilFormat });
      copyScreenDepth(target, w, h);
      if (gl.getError() === gl.NO_ERROR) return target;
      depth.dispose();
      target.dispose();
    }
    return false;
  };
  const sized = (target, w, h) => {
    if (!target) return picture(w, h);
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    return target;
  };
  const any = () => scene.children.some((child) => child.visible);
  /** Draw `fn()` counted with the scene's own draws: three.js starts its count again at each draw (GOLD mode's Z display reads it). */
  const counted = (fn) => {
    const auto = renderer.info.autoReset;
    renderer.info.autoReset = false;
    try { fn(); } finally { renderer.info.autoReset = auto; }
  };

  const over = {
    scene, uniforms,
    /** How many pictures' worth the squares of what is drawn here cover, as what draws them counts it each frame (render/particles.js). */
    get load() { return load; },
    set load(value) { load = value > 0 ? value : 0; },
    /** Whether anything is to be drawn over the scene this frame. */
    any,
    /** Whether what is here is drawn the heavy way now. */
    get heavy() { return heavy; },
    /** Once a frame, before the view's own picture is drawn: whether the puffs are heavy this frame (game/particles.js `overIsHeavy`). */
    weigh() {
      heavy = any() && overIsHeavy(heavy, load);
      return heavy;
    },
    /**
     * Draw it into its own picture, which starts clear, by the scene's `depth` (the depth texture of a picture
     * `width` by `height`, drawn with `camera`): a picture of that size, or `OVER.shrink` times smaller while heavy.
     * Returns that picture's texture, its colour times how much it hides. `fog` is the scene's.
     */
    draw(camera, fog, depth, width, height) {
      let target;
      if (heavy) target = small = sized(small, Math.ceil(width / OVER.shrink), Math.ceil(height / OVER.shrink));
      else target = full = sized(full, width, height);
      scene.fog = fog;
      uniforms.uSceneSize.value.set(target.width, target.height);
      const before = renderer.getRenderTarget(), alpha = renderer.getClearAlpha(), auto = renderer.autoClear;
      renderer.getClearColor(clearColor);
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      if (soft) {
        // A puff reads the scene's depth and stops where the scene stands in it.
        uniforms.uSceneDepth.value = depth;
        uniforms.uSceneSoft.value = 1;
        renderer.autoClear = true;
      } else {
        // The scene's depth into the picture's own, and the puffs tested against it as they are on the screen.
        renderer.autoClear = false;
        renderer.clear();
        deepening.uniforms.tDepth.value = depth;
        quad.material = deepening;
        counted(() => quad.render(renderer));
        uniforms.uSceneDepth.value = null;
        uniforms.uSceneSoft.value = 0;
      }
      counted(() => renderer.render(scene, camera));
      renderer.setRenderTarget(before);
      renderer.setClearColor(clearColor, alpha);
      renderer.autoClear = auto;
      // Let go of the depth: what is drawn next may be drawn into the picture it belongs to, which may not then be read.
      uniforms.uSceneDepth.value = null;
      uniforms.uSceneSoft.value = 0;
      if (!heavy) return target.texture;
      // Heavy: the small picture back to the picture's size, sharp along what stands in the dust (`UPSIZE`).
      full = sized(full, width, height);
      upsizing.uniforms.tOver.value = small.texture;
      upsizing.uniforms.tDepth.value = depth;
      upsizing.uniforms.uSmall.value.set(small.width, small.height);
      upsizing.uniforms.uProjection.value.copy(camera.projectionMatrix);
      renderer.setRenderTarget(full);
      renderer.setClearColor(0x000000, 0);
      quad.material = upsizing;
      counted(() => quad.render(renderer));
      renderer.setRenderTarget(before);
      renderer.setClearColor(clearColor, alpha);
      upsizing.uniforms.tDepth.value = null;
      return full.texture;
    },
    /**
     * Build ahead of need what `draw` and `lay` use for a picture `width` by `height` whose depth is `depth`, drawn
     * with `camera`: the puffs' shaders and the passes that deepen and lay their picture, by drawing it once the heavy
     * way and laying it on the picture being drawn into (nothing is over the scene yet: it lays nothing). The plain
     * screen's `present` does the same with its first frame.
     */
    warm(camera, fog, depth, width, height) {
      renderer.compile(scene, camera);
      const was = heavy;
      heavy = true;
      try { this.lay(this.draw(camera, fog, depth, width, height)); } finally { heavy = was; }
    },
    /** Lay a picture `draw` returned over the picture being drawn into. */
    lay(texture) {
      laying.uniforms.tOver.value = texture;
      quad.material = laying;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      counted(() => quad.render(renderer));
      renderer.autoClear = auto;
    },
    /** After the scene was drawn with `camera`, into whatever it was drawn into: what is over it, straight over it, hidden by what stands in front. */
    plain(camera, fog) {
      if (!any()) return;
      scene.fog = fog;
      uniforms.uSceneDepth.value = null;
      uniforms.uSceneSoft.value = 0;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      counted(() => renderer.render(scene, camera));
      renderer.autoClear = auto;
    },
    /**
     * The plain screen's frame: draw `mainScene` with `camera` and what is over it, to the screen (which the renderer
     * must be drawing to). Light, the scene and the puffs straight over it. Heavy, the scene, its depth copied off the
     * screen, the puffs into their small picture by that depth, and that picture laid over the scene. Where the
     * screen's depth cannot be copied: the scene into a picture that takes it as the screen does, the puffs into their
     * small one by its depth, and both to the screen.
     *
     * The first frame is drawn the heavy way whatever is over it, and the puffs' shader is built with it: the pictures
     * are made, the copy is tried and the shaders are built while the race is still loading, not on the frame the dust
     * first thickens, which stopped for a tenth of a second for them.
     */
    present(mainScene, camera) {
      const first = !presented;
      presented = true;
      if (first) renderer.compile(scene, camera);
      if (!(this.weigh() || first) || unfit) {
        renderer.render(mainScene, camera);
        this.plain(camera, mainScene.fog);
        return;
      }
      // (The first frame's, whatever the puffs weigh.)
      heavy = true;
      const size = renderer.getDrawingBufferSize(drawing), w = Math.max(1, size.x), h = Math.max(1, size.y);
      if (screenDepth !== false) {
        renderer.render(mainScene, camera);
        if (screenDepth === null) screenDepth = findScreenDepth(w, h);
        else {
          if (screenDepth.width !== w || screenDepth.height !== h) screenDepth.setSize(w, h);
          copyScreenDepth(screenDepth, w, h);
        }
        // (The frame that finds there is no copy to be had has drawn the scene already: its puffs go straight over it.)
        if (screenDepth) this.lay(this.draw(camera, mainScene.fog, screenDepth.depthTexture, w, h));
        else this.plain(camera, mainScene.fog);
        return;
      }
      const before = renderer.getRenderTarget();
      if (!sceneTarget) {
        sceneTarget = asScreen(renderer, new THREE.WebGLRenderTarget(w, h, { samples: screenSamples, depthTexture: new THREE.DepthTexture(w, h) }));
        sceneTarget.texture.generateMipmaps = false;
        // A graphics chip that cannot make that picture draws the light way always.
        renderer.setRenderTarget(sceneTarget);
        const gl = renderer.getContext();
        unfit = gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE;
        if (unfit) {
          renderer.setRenderTarget(before);
          sceneTarget.depthTexture.dispose();
          sceneTarget.dispose();
          sceneTarget = null;
          heavy = false;
          renderer.render(mainScene, camera);
          this.plain(camera, mainScene.fog);
          return;
        }
      } else if (sceneTarget.width !== w || sceneTarget.height !== h) sceneTarget.setSize(w, h);
      renderer.setRenderTarget(sceneTarget);
      renderer.render(mainScene, camera);
      renderer.setRenderTarget(before);
      presenting.uniforms.tOver.value = this.draw(camera, mainScene.fog, sceneTarget.depthTexture, w, h);
      presenting.uniforms.tScene.value = sceneTarget.texture;
      quad.material = presenting;
      counted(() => quad.render(renderer));
    },
    dispose() {
      sceneTarget?.depthTexture.dispose();
      if (screenDepth) screenDepth.depthTexture.dispose();
      for (const target of [full, small, sceneTarget, screenDepth]) if (target) target.dispose();
      presenting.dispose();
      laying.dispose();
      deepening.dispose();
      upsizing.dispose();
      quad.dispose();
    },
  };
  return over;
}
