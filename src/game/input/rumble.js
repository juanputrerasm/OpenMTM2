/*
  A gamepad's rumble, from the game's force feedback (MONSTER_EXE_ANALYSIS.md section 7, "Force feedback").

  The game pushed a joystick or wheel. A pad only has two motors, the strong (low, heavy) and the weak (high, light),
  and what a stick pushed hard a motor barely shows, so the port keeps the game's events and tunes them for a pad:

  - **Hits** (the game's jolt): its size is the game's, `F * 6.25e-5 + dv / dt * 0.02`, from the hull's contact force,
    another truck's collision force and the bump stops' landing. The port adds what a pad should feel and a stick's
    push already gave away: a wheel's load jumping (a kerb, a rock, a wheel against an object or a truck) and an
    object's hit. A hit runs the strong motor and dies away over 0.5 s, so hits one after another each show.
  - **Ground** (the game's shake): the game's surface table, on both motors, a fresh size every 0.2 s as the game's.
    A size felt on a stick is too faint for a motor, so the motor runs at the square root of it: smooth cement buzzes
    lightly, dirt and grass more, gravel and rocks hard. The game's frequency is not pulsed: the pad is sent a level only
    a few times a second (game/input/gamepad.js `rumble`).
  - **Engine** (the port's own): a soft, steady rumble on the strong motor whenever the truck is driven, rising with
    the engine's speed.

  The Rumble effects setting keeps the battery of a wireless pad: 1 hits only, 2 hits and ground, 3 all three.
  The spring, damper and friction only resisted a stick; the lean with the truck's tilt has no direction on a pad.
*/

const HIT_FADE_S = 0.5;
const SHAKE_EVERY_S = 0.2;
const GAME_FRAME_S = 1 / 30;
/** Smaller hits are not felt and only cost battery. */
const HIT_FLOOR = 0.02;
const IDLE_RPM = 800, MAX_RPM = 8500;

/** The Rumble effects levels. */
export const RUMBLE_LEVELS = Object.freeze({ HITS: 1, GROUND: 2, ENGINE: 3 });

/** The shake by surface code: the amplitude of an axis for a fresh `r` (0..1), the base frequency and its cap (Hz). */
const SHAKES = Object.freeze({
  0: { amp: (r) => 0.405 * r + 0.135, base: 0.85, cap: 9 },
  200: { amp: (r) => r * r + 0.15, base: 0.6, cap: 7 },
  400: { amp: (r) => 0.36 * r + 0.12, base: 0.85, cap: 9 },
  600: { amp: (r) => 0.315 * r + 0.105, base: 0.85, cap: 9 },
  700: { amp: (r) => 1.2 * r * r + 0.15, base: 1.1, cap: 12 },
  900: { amp: (r) => 0.27 * r + 0.09, base: 0.85, cap: 9 },
  1100: { fixed: 0.3, base: 1.6, cap: 15 },
  1200: { amp: (r) => 18 * r * r, base: 0.9, cap: 10 },
  1400: { fixed: 0.7, base: 1.0, cap: 20 },
});
/** Surfaces with no shake: water, sand, ice and deep water. */
const STILL = new Set([300, 500, 800, 1300]);
/** Any other code shakes as 100 does. */
const OTHER = { amp: (r) => 0.09 * r + 0.03, base: 0.85, cap: 9 };

/** A tire's surface code, `type * 100` (the game's value at +0xbc shifted right 16). */
export const surfaceCode = (value) => Math.floor((value ?? 0) / 100) * 100;

/** The surface that sets the shake: the most weighted among the tires, 30 for 1100 and 40 for 1400, a tire in the air 1300. */
export function shakeSurface(tires) {
  const weights = new Map();
  for (const tire of tires ?? []) {
    const code = tire.onGround ? surfaceCode(tire.surface) : 1300;
    weights.set(code, (weights.get(code) ?? 0) + (code === 1100 ? 30 : code === 1400 ? 40 : 1));
  }
  let best = null, most = 0;
  for (const [code, weight] of weights) if (weight > most) { best = code; most = weight; }
  return best;
}

/**
 * The game's shake on a surface at a speed (ft/s), times the strength (0..1): its size (both axes) and frequency, or
 * null for none. Below 4 ft/s the size also scales with `speed / 4`; the frequency is `base * speed / 8`, at most the cap.
 */
export function shakeOn(code, speed, strength, rand = Math.random) {
  if (STILL.has(code)) return null;
  const spec = SHAKES[code] ?? OTHER;
  const x = spec.fixed ? 0 : spec.amp(rand()), y = spec.fixed ?? spec.amp(rand());
  const scale = strength * (speed < 4 ? speed / 4 : 1);
  return { size: Math.hypot(x, y) * scale, hz: Math.min(spec.cap, spec.base * speed / 8) };
}

/**
 * The game's jolt size: contact and collision forces (lbf: the hull's contact, and another truck's) and the bottoming
 * (ft/s taken off by the bump stops), with the game's 30 frames a second for its frame time.
 */
export const joltSize = (force, bottoming) => (force ?? 0) * 6.25e-5 + ((bottoming ?? 0) / GAME_FRAME_S) * 0.02;

/** The tires' load rising less than this (lbf) in a frame is the suspension at work, not a knock. */
const WHEEL_DEADBAND = 2000;
/** A wheel's knock: the rise in the tires' load (lbf) since the last frame past the dead band, at the jolt's scale. */
export const wheelKnock = (rise) => Math.max(0, rise - WHEEL_DEADBAND) * 6.25e-5;

/** An object's hit (a SIT box met at a speed, ft/s). */
export const objectKnock = (speed) => Math.max(0, speed ?? 0) * 0.03;

/** The engine's rumble on the strong motor, at full strength, for an engine speed. */
export const engineRumble = (rpm) => 0.09 + 0.2 * Math.min(1, Math.max(0, ((rpm ?? IDLE_RPM) - IDLE_RPM) / (MAX_RPM - IDLE_RPM)));

export function createRumble({ rand = Math.random } = {}) {
  let hit = 0, left = 0, shake = null, shakeIn = 0, surface = null, last = null, loads = null;
  return {
    /**
     * One frame: `sample` is the player's truck as the simulation saw it since the last frame (`impact` the hull's
     * contact force and `collide` another truck's, lbf; `bottoming`, ft/s; `hitSpeed` an object's hit, ft/s; `tires`
     * with `onGround`, `surface` and body `force`; body `vx` and `vz`; `rpm`), `dt` the seconds since, `strength` 0..1,
     * `level` the Rumble effects (RUMBLE_LEVELS).
     * Returns the motors, `{ strong, weak }`, 0..1, with what made them for the readout.
     */
    update(sample, dt, strength, level = RUMBLE_LEVELS.ENGINE) {
      const tires = sample.tires ?? [];
      // A wheel's load jumping: the rise summed over the four tires since the last frame.
      const now = tires.map((tire) => (tire.onGround ? Math.abs(tire.force?.[1] ?? 0) : 0));
      const rise = loads ? now.reduce((sum, load, i) => sum + Math.max(0, load - (loads[i] ?? 0)), 0) : 0;
      loads = now;
      const sources = {
        impact: sample.impact ?? 0, collide: sample.collide ?? 0, bottoming: sample.bottoming ?? 0,
        wheels: rise, object: sample.hitSpeed ?? 0,
      };
      const size = joltSize(sources.impact + sources.collide, sources.bottoming) + wheelKnock(rise) + objectKnock(sources.object);
      // A hit replaces the one dying away only when it is larger than what is left of it.
      const fading = left > 0 ? hit * (left / HIT_FADE_S) : 0;
      if (size >= HIT_FLOOR && size > fading) { hit = size; left = HIT_FADE_S; last = { size, ...sources }; }
      left = Math.max(0, left - dt);
      const hitNow = left > 0 ? Math.min(1, hit * strength * (left / HIT_FADE_S)) : 0;

      const speed = Math.sqrt(5 * (sample.vx ?? 0) ** 2 + (sample.vz ?? 0) ** 2);
      const touching = tires.some((tire) => tire.onGround);
      let groundStrong = 0, groundWeak = 0;
      if (level >= RUMBLE_LEVELS.GROUND && touching && speed > 0.1) {
        shakeIn -= dt;
        if (!shake || shakeIn <= 0) {
          surface = shakeSurface(tires);
          shake = shakeOn(surface, speed, strength, rand);
          shakeIn = SHAKE_EVERY_S;
        }
        if (shake) {
          groundWeak = Math.min(1, Math.sqrt(shake.size));
          groundStrong = groundWeak * 0.5;
        }
      } else { shake = null; shakeIn = 0; surface = null; }
      const engine = level >= RUMBLE_LEVELS.ENGINE ? engineRumble(sample.rpm) * strength : 0;
      return {
        strong: Math.max(hitNow, groundStrong, engine), weak: groundWeak,
        hit: hitNow, hitLeft: left, lastHit: last, engine, surface: shake ? surface : null,
        hz: shake?.hz ?? 0, size: shake?.size ?? 0, speed,
      };
    },
    reset() { hit = 0; left = 0; shake = null; shakeIn = 0; surface = null; loads = null; },
  };
}
