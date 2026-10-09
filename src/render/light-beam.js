/*
  A beam of light in the air, as JSTrackViewer's truck light rig draws it (src/drive/truck-lights.js there, from
  JSTruckViewer): an open cone of 24 sides with a fuzz texture repeated around and along it, brightest at the source and
  fading to nothing at the rim and toward its edges as seen, added to the view. Truck lamps and track lights share it.
*/
import * as THREE from "three";

export const BEAM_INTENSITY = 0.14, BEAM_SIDES = 24, BEAM_TEXTURE_FEET = 12, BEAM_TEXTURE_AROUND = 2;
export const BEAM_AXIS = new THREE.Vector3(0, 0, 1);

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vec3 viewNormal = normalize(normalMatrix * normal);
    vFacing = abs(dot(viewNormal, normalize(-viewPosition.xyz)));
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 repeat;
  uniform float intensity;
  uniform vec3 tint;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vec3 fuzz = texture2D(map, vUv * repeat).rgb * tint;
    float along = pow(1.0 - vUv.y, 2.2);
    float edge = pow(vFacing, 1.5);
    gl_FragColor = vec4(fuzz * intensity * along * edge, 1.0);
    #include <colorspace_fragment>
  }
`;

/** An open cone from the source (`base` radius) to the rim (`rim` radius at `length`), laid along +z from the origin. */
export function beamGeometry(length, base, rim) {
  const geometry = new THREE.CylinderGeometry(Math.max(rim, 0.01), Math.max(base, 0.01), length, BEAM_SIDES, 1, true);
  geometry.translate(0, length / 2, 0);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

const white = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

/** The beam's material: `map` the fuzz (white when null), its `uniforms.intensity` and `uniforms.tint` set per frame. */
export function beamMaterial(map, length, tint = [1, 1, 1]) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map ?? white },
      repeat: { value: new THREE.Vector2(BEAM_TEXTURE_AROUND, Math.max(1, length / BEAM_TEXTURE_FEET)) },
      intensity: { value: BEAM_INTENSITY },
      tint: { value: new THREE.Color(tint[0], tint[1], tint[2]) },
    },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}
