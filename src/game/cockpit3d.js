/*
  Community Patch 4's 3D cockpit (CP4_EXE_ANALYSIS.md 6): which cockpit a truck gets, the layout's range checks, the
  instruments' angles, the mirror's test and the smooth cockpit look. Pure, so it runs under Node; worker/cockpit3d.js
  reads the files and render/cockpit3d.js draws the result.

  A layout here is the parsed `.CPT` (OpenPhotex `parseCpt`) after the engine's checks:
  `{ cab, eye, fov, speedo, tach, wheel, shifter, gearLamps: [6], shiftLight, mirror }`, every key null where the file
  has no valid line for it. Units are the game's: feet, degrees in the file, body axes x right, y up, z forward.
*/
import { mtmTrkCockpit } from "../vendor/openphotex/truck/mtm-trk.js";

/** The default layout's file and where it lives (cockpit.pod). */
export const DEFAULT_CPT = "_DEFAULT_CP.CPT";
/** The eye with no EYE line, feet in the body frame (the retail cockpit's, 0x553cf0). */
export const DEFAULT_EYE = Object.freeze([0, 4, 1]);
/** The field of view with no FOV line, degrees: the projection value 65536, retail's lens. */
export const DEFAULT_FOV = 106.26;
/** The shift light's threshold with no rpm, and the instrument clusters that get the default cockpit unasked. */
export const DEFAULT_SHIFT_RPM = 6500;
export const CLUSTERS_3D = Object.freeze(["powerbig", "richford"]);
/** The gear lamps' keys, by gear index (gear 1 Park to 6 third, less one). */
export const GEAR_KEYS = Object.freeze(["P", "R", "N", "1", "2", "3"]);
/** Only the last bytes of a .TRK are scanned for its COCKPIT lines (`FUN_1401fc220`). */
export const TRK_COCKPIT_SCAN_BYTES = 256;

const latin1 = new TextDecoder("latin1");
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const within = (v, limit) => finite(v) && Math.abs(v) <= limit;
/** A model name the engine takes: 1..31 characters, ends in .BIN, no path. */
export const modelName = (name) => typeof name === "string" && name.length >= 1 && name.length <= 31 && /\.BIN$/i.test(name) && !/[\\/]/.test(name);

/** The custom cockpit a .TRK names (`COCKPIT` then `<name>.CPT` as its last two non-blank lines, in its last 256 bytes), or null. */
export function trkCockpitName(bytes) {
  if (!bytes) return null;
  const tail = bytes.length > TRK_COCKPIT_SCAN_BYTES ? bytes.subarray(bytes.length - TRK_COCKPIT_SCAN_BYTES) : bytes;
  const text = latin1.decode(tail).replace(/\x1a.*$/s, "");
  const name = mtmTrkCockpit(text.split(/\r\n|\r|\n/));
  return name && /\.CPT$/i.test(name) && /^[\x20-\x7e]+$/.test(name) ? name : null;
}

/** A moving part from `parseCpt`'s `{ model, pivot, axis, values }` with `count` values, or null where a check fails. */
function checkPart(part, count) {
  if (!part || !modelName(part.model) || part.values.length < count) return null;
  if (!part.pivot.every((v) => within(v, 64)) || !part.axis.every((v) => within(v, 1e6))) return null;
  if (Math.hypot(...part.axis) === 0) return null;
  const values = part.values.slice(0, count);
  if (!values.every((v) => within(v, 1e6))) return null;
  return { model: part.model.toUpperCase(), pivot: [...part.pivot], axis: [...part.axis], values };
}

/** A lamp line's values: a model, or a quad x, y, z, w, h (0 < w, h <= 64); `extra` numbers may follow. */
function checkLamp(values) {
  if (!values?.length) return null;
  if (modelName(values[0])) return { model: values[0].toUpperCase(), quad: null, rest: values.slice(1).map(Number) };
  const n = values.map(Number);
  if (n.length < 5 || !n.slice(0, 3).every((v) => within(v, 64))) return null;
  if (!(n[3] > 0 && n[3] <= 64 && n[4] > 0 && n[4] <= 64)) return null;
  return { model: null, quad: { center: n.slice(0, 3), w: n[3], h: n[4] }, rest: n.slice(5) };
}

/**
 * The engine's view of a parsed .CPT (`FUN_1401fada0`, range checks `FUN_140200570`/`FUN_140200630`): each key kept
 * only when its line passes, else null. Null for a file the engine refuses (no VERSION, or not 1).
 */
export function checkLayout(cpt) {
  if (!cpt || cpt.version !== 1) return null;
  const last = (key) => {
    for (let i = cpt.entries.length - 1; i >= 0; i--) if (cpt.entries[i].key === key) return cpt.entries[i].values;
    return null;
  };
  const out = { cab: null, eye: null, fov: null, speedo: null, tach: null, wheel: null, shifter: null, gearLamps: [null, null, null, null, null, null], shiftLight: null, mirror: null };
  if (modelName(cpt.cab)) out.cab = cpt.cab.toUpperCase();
  if (cpt.eye && cpt.eye.every((v) => within(v, 32))) out.eye = [...cpt.eye];
  const fov = Number(last("FOV")?.[0]);
  if (finite(fov) && Math.trunc(fov) >= 30 && Math.trunc(fov) <= 150) out.fov = Math.trunc(fov);
  out.speedo = checkPart(cpt.speedo, 2);
  out.tach = checkPart(cpt.tach, 2);
  out.wheel = checkPart(cpt.wheel, 1);
  out.shifter = checkPart(cpt.shifter, 6);
  GEAR_KEYS.forEach((key, i) => {
    const lamp = checkLamp(last(`GEARLAMP_${key}`));
    out.gearLamps[i] = lamp && { model: lamp.model, quad: lamp.quad };
  });
  const light = checkLamp(last("SHIFTLIGHT"));
  if (light) {
    const rpm = light.rest[0];
    out.shiftLight = { model: light.model, quad: light.quad, rpm: within(rpm, 1e6) ? rpm : DEFAULT_SHIFT_RPM };
  }
  const m = cpt.mirror;
  if (m && m.length >= 8 && m.slice(0, 3).every((v) => within(v, 64)) && m.slice(3, 6).every((v) => within(v, 1e6))
    && m[3] * m[3] + m[4] * m[4] + m[5] * m[5] > 1e-12 && m[6] > 0 && m[6] <= 64 && m[7] > 0 && m[7] <= 64) {
    const zoom = m.length > 8 && finite(m[8]) ? Math.trunc(m[8]) : 0;
    if (zoom >= 0 && zoom <= 0x40000) out.mirror = { center: m.slice(0, 3), normal: m.slice(3, 6), w: m[6], h: m[7], zoom: zoom || 65536 };
  }
  return out;
}

/**
 * A custom layout over the default (`FUN_1401fb9b0`): a copy of the default, each key the custom file has overriding.
 * A custom instrument or lamp whose model `hasModel` does not find takes the default's whole one; a missing custom CAB
 * the default cab.
 */
export function mergeLayout(base, custom, hasModel = () => true) {
  const out = { ...base, gearLamps: [...base.gearLamps] };
  const found = (part) => part && (!part.model || hasModel(part.model));
  if (custom.cab && hasModel(custom.cab)) out.cab = custom.cab;
  if (custom.eye) out.eye = custom.eye;
  if (custom.fov !== null) out.fov = custom.fov;
  for (const key of ["speedo", "tach", "wheel", "shifter", "shiftLight", "mirror"]) {
    if (custom[key] && (key === "mirror" || found(custom[key]))) out[key] = custom[key];
  }
  custom.gearLamps.forEach((lamp, i) => { if (found(lamp)) out.gearLamps[i] = lamp; });
  return out;
}

/**
 * Which cockpit a truck gets (CP4_EXE_ANALYSIS.md 6, "Which cockpit a truck gets"): `{ kind: "3d", layout, reason }`
 * or `{ kind: "2d", layout: null, reason }`.
 * - `base`: the checked default layout, or null when `_DEFAULT_CP.CPT` is missing or refused;
 * - `named`: the .CPT the .TRK names, or null; `custom`: that file checked, null when it is missing or refused;
 * - `cluster`: the .TRK's Instrument Cluster; `hasModel(name)`: whether MODELS\<name> is there.
 */
export function resolveCockpit({ base, named = null, custom = null, cluster = null, hasModel = () => true }) {
  if (!base || !base.cab || !hasModel(base.cab)) return { kind: "2d", layout: null, reason: "no default cockpit" };
  if (named) {
    if (!custom) return { kind: "3d", layout: base, reason: `${named} not found - default cockpit` };
    return { kind: "3d", layout: mergeLayout(base, custom, hasModel), reason: named };
  }
  if (CLUSTERS_3D.includes(String(cluster ?? "").trim().toLowerCase())) return { kind: "3d", layout: base, reason: "default cockpit" };
  return { kind: "2d", layout: null, reason: `Instrument Cluster '${cluster ?? ""}' - 2D cockpit` };
}

/** Every model a layout names, once each, upper case. */
export function layoutModels(layout) {
  if (!layout) return [];
  const names = [layout.cab, layout.speedo?.model, layout.tach?.model, layout.wheel?.model, layout.shifter?.model,
    layout.shiftLight?.model, ...layout.gearLamps.map((l) => l?.model)];
  return [...new Set(names.filter(Boolean).map((n) => n.toUpperCase()))];
}

// ---- The instruments (FUN_1401fd050, FUN_1401ff090, FUN_1401fca10) ----------------------------------------------

/** An angle in degrees as the engine keeps it: fmod 360. */
const wrap = (degrees) => degrees % 360;
/** The speedometer needle, degrees: a0 + k * |speed| in mph (speed in ft/s). */
export const speedoDegrees = (part, speedFtps) => wrap(part.values[0] + part.values[1] * (Math.abs(speedFtps) * 3600 / 5280));
/** The tachometer needle, degrees: a0 + k * rpm. */
export const tachDegrees = (part, rpm) => wrap(part.values[0] + part.values[1] * rpm);
/** The steering wheel, degrees: the steering angle (radians, right positive) in degrees times the ratio. */
export const wheelDegrees = (part, steerRad) => wrap(steerRad * 57.2958 * part.values[0]);
/** The gear index 0..5 (P, R, N, 1, 2, 3) for the simulation's gear (1 Park to 6 third, higher held at third). */
export const gearIndex = (gear) => Math.max(0, Math.min(5, Math.trunc(Number(gear) || 0) - 1));
/** The shifter lever, degrees: the layout's angle for the gear. */
export const shifterDegrees = (part, gear) => wrap(part.values[gearIndex(gear)]);
/** Whether a gear lamp (index 0..5) is drawn: only the current gear's. */
export const gearLampLit = (index, gear) => index === gearIndex(gear);
/** Whether the shift light is lit: rpm above its threshold. */
export const shiftLightLit = (light, rpm) => !!light && rpm > light.rpm;

/**
 * A part's turn in the scene (shared/scene-frame.js mirrors z): the axis `(ax, ay, -az)`, normalised, and the angle in
 * radians, right-handed. A positive angle about +z (forward) is then clockwise as the driver sees it, as the shipped
 * dials read (CP4_EXE_ANALYSIS.md 6), and a positive one about +x moves a lever's top back toward the driver.
 */
export function sceneTurn(axis, degrees) {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  if (!l) return { axis: [0, 1, 0], radians: 0 };
  return { axis: [axis[0] / l, axis[1] / l, -axis[2] / l], radians: degrees * Math.PI / 180 };
}

/** The camera projection value for a FOV in degrees (camera +0xb8): 106.26 gives 65536. */
export const projectionValue = (fovDegrees) => Math.trunc(Math.tan((fovDegrees / 2) * Math.PI / 180) * 49152 + 0.5);
/**
 * Where the 3D cockpit's view centre sits, as a share of the screen's height from the top: CP4 moves the projection's
 * centre row to height * 208 / 480 while the cockpit pass is on (FUN_1401fd850 writes DAT_140e4d2a4, the y the
 * projection adds; restored after), and widens the bottom clip to match (DAT_140949d58). The lens's scale is unchanged,
 * so the cab is drawn as it is, the horizon raised by 1/15 of the screen (CP4_EXE_ANALYSIS.md 6).
 */
export const COCKPIT_CENTRE_ROW = 208 / 480;

/**
 * The 3D cockpit's vertical field of view (degrees) for a projection value: the FOV key is degrees across a 4:3 frame,
 * so 65536 (the default 106.26) is 90 degrees top to bottom, kept on any screen shape. A CP4 beta 0.52 screenshot
 * against ours at 73.74 shows its gauges at 0.74 of our size, as tan(36.87) / tan(45) = 0.75 says
 * (CP4_EXE_ANALYSIS.md 6).
 */
export const verticalFovFor = (value) => 2 * Math.atan(value / 65536) * 180 / Math.PI;
/** The layout's vertical field of view, degrees. */
export const layoutVerticalFov = (layout) => verticalFovFor(layout?.fov ? projectionValue(layout.fov) : 65536);
/** The mirror pass's vertical field of view for its zoom and viewport aspect (zoom / 65536 = tan of half the angle across: INFERRED). */
export const mirrorVerticalFov = (zoom, aspect) => 2 * Math.atan((zoom || 65536) / 65536 / Math.max(aspect, 1e-6)) * 180 / Math.PI;

// ---- The mirror (FUN_1401fe360) ---------------------------------------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The mirror's four corners, body frame feet: C +- w/2 u +- h/2 v. */
export function mirrorCorners(mirror) {
  const n = unit(mirror.normal);
  const across = Math.hypot(n[0], n[2]);
  const u = across > 1e-9 ? [n[2] / across, 0, -n[0] / across] : [1, 0, 0];
  const v = cross(n, u);
  const c = mirror.center, hw = mirror.w / 2, hh = mirror.h / 2;
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => [0, 1, 2].map((k) => c[k] + a * hw * u[k] + b * hh * v[k]));
}

/** A view direction in the body frame for a yaw (right positive) and pitch (up positive), radians. */
export const viewDirection = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

/** Whether the mirror is drawn from `eye` looking along `view` (body frame): the eye before it, and within 60 degrees of it. */
export function mirrorFaces(mirror, eye, view) {
  if (!mirror) return false;
  if (!(dot(sub(eye, mirror.center), unit(mirror.normal)) > 0)) return false;
  const toward = sub(mirror.center, eye);
  if (Math.hypot(...toward) < 1e-9) return false;
  return dot(unit(view), unit(toward)) >= Math.cos(1.0472);
}

// ---- Smooth cockpit look (FUN_1403e04c0) ------------------------------------------------------------------------

/** The look's limits, radians: 27306 and 6371 of 65536. */
export const LOOK_YAW_MAX = 27306 / 65536 * Math.PI * 2, LOOK_PITCH_MAX = 6371 / 65536 * Math.PI * 2;
/** How fast a full stick looks round, radians a second (32768 a second, 180 degrees). */
export const LOOK_RATE = Math.PI;
/** The ease back's time constant, seconds, and the offset that snaps to 0 (64 of 65536). */
export const LOOK_EASE_S = 0.045, LOOK_SNAP = 64 / 65536 * Math.PI * 2;

/**
 * One step of the smooth cockpit look: `look` `{ yaw, pitch }` radians (yaw right, pitch up), `stick` `{ x, y }` -1..1
 * (x right, y up), `dt` seconds (capped at 0.25). A stick off centre moves the look, held to +-150 and +-35 degrees;
 * a centred one lets it ease back to straight ahead.
 */
export function stepCockpitLook(look, stick, dt) {
  const t = Math.min(Math.max(Number(dt) || 0, 0), 0.25);
  const x = Number(stick?.x) || 0, y = Number(stick?.y) || 0;
  if (x || y) {
    return {
      yaw: Math.max(-LOOK_YAW_MAX, Math.min(LOOK_YAW_MAX, look.yaw + x * LOOK_RATE * t)),
      pitch: Math.max(-LOOK_PITCH_MAX, Math.min(LOOK_PITCH_MAX, look.pitch + y * LOOK_RATE * t)),
    };
  }
  const k = Math.exp(-t / LOOK_EASE_S);
  const ease = (v) => (Math.abs(v * k) < LOOK_SNAP ? 0 : v * k);
  return { yaw: ease(look.yaw), pitch: ease(look.pitch) };
}
