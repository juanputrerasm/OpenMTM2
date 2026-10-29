/*
  A truck's lamps (MONSTER_EXE_ANALYSIS.md 11b, 0x579f10 and 0x57a080). The TRK lists each lamp: its
  type, where it sits on the body, its lens bitmap and, for a headlight, the cone of light it throws.
  Whether a lamp is lit depends on its type, on the truck's lamp switch (`lamps`: 0 off, 2 on; the
  game sets 2 in a dusk or night race and the Headlights key, L, toggles it for the player's truck),
  on the brakes, on the gear and on whether the viewer sits in the truck's own cockpit.
*/

/** The lamp switch the truck starts a race with: on when the weather lights the lamps. */
export const lampsAtStart = (weatherHeadlights) => (weatherHeadlights ? 2 : 0);

/** The Headlights key: the switch goes from off to on and from on to off. */
export const toggleLamps = (lamps) => (lamps ? 0 : 2);

/** Rear brake pressure above this lights a brake lamp (`0x617e80`). */
export const BRAKE_ON = 0.01;

/**
 * How bright a lamp is, 0 to 1.
 * @param {{ type: number, pos: number[] }} light
 * @param {{ lamps: number, braking: boolean, reverse: boolean, cockpit: boolean, night: boolean }} state
 *   `cockpit` is the viewer sitting in this truck's own cockpit, `night` the weather's lamps flag.
 */
export function lightIntensity(light, { lamps, braking, reverse, cockpit, night }) {
  switch (light.type) {
    case 0:
    case 3:
      return lamps === 2 ? 1 : 0;
    case 1:
      if (cockpit) return 0;
      // A lamp on the centre line (the cab's third brake light) shines only when braking.
      if (light.pos[0] === 0) return braking ? (lamps > 0 ? 1 : 0.6) : 0;
      return (braking ? 0.6 : 0) + (lamps > 0 ? 0.4 : 0);
    case 2:
      return !cockpit && lamps > 0 ? 1 : 0;
    case 5:
      return !cockpit && reverse ? 1 : 0;
    default:
      if (light.type < 0) return night ? 1 : 0;
      return lamps > 1 ? 1 : 0;
  }
}

/** A blinking lamp (`msOff` above 0) is on for `msOn` of every `msOn + msOff` milliseconds. */
export function blinkOn(light, ms) {
  if (!(light.msOff > 0)) return true;
  return ms % (light.msOn + light.msOff) < light.msOn;
}

/** A lamp's heading at `seconds`: a beacon turns by its spin speed. */
export const lampHeading = (light, seconds) => light.heading + light.spin * seconds;

/*
  Damage knocks a lamp askew (MONSTER_EXE_ANALYSIS.md 11b, `0x5323e0`). A lamp's knock is `{ pos, heading, pitch }`:
  how far its current position (body axes, feet) and its heading and pitch (radians) have moved from the TRK's.
*/
/** A lamp within this of the dented zone's point (feet, the current position) is knocked. */
export const LAMP_KNOCK_REACH_FT = 2;
/** The most a knock turns a lamp's heading or pitch away from its own, and the most one knock turns it, radians (20 degrees). */
export const LAMP_KNOCK_RAD = 0.349066;

/** A lamp not knocked yet. */
export const freshKnock = () => ({ pos: [0, 0, 0], heading: 0, pitch: 0 });

/**
 * One damage call on zone point `point` with the zone's direction `direction` (body axes): a lamp near it turns by a
 * random step either way, held within LAMP_KNOCK_RAD of its own aim (only a lamp with a cone), and moves along the
 * direction by up to half a foot on x and y and a fifth of that on z. `random()` is in [0, 1). Whether it was near.
 */
export function knockLamp(knock, light, point, direction, random = Math.random) {
  const at = [light.pos[0] + knock.pos[0], light.pos[1] + knock.pos[1], light.pos[2] + knock.pos[2]];
  const d2 = (at[0] - point[0]) ** 2 + (at[1] - point[1]) ** 2 + (at[2] - point[2]) ** 2;
  if (!(d2 < LAMP_KNOCK_REACH_FT ** 2)) return false;
  if (light.coneLength > 0) {
    const turn = (now) => Math.max(-LAMP_KNOCK_RAD, Math.min(LAMP_KNOCK_RAD, now + random() * 2 * LAMP_KNOCK_RAD - LAMP_KNOCK_RAD));
    knock.heading = turn(knock.heading);
    knock.pitch = turn(knock.pitch);
  }
  const u = random() * 0.5;
  knock.pos[0] += direction[0] * u;
  knock.pos[1] += direction[1] * u;
  knock.pos[2] += direction[2] * u * 0.2;
  return true;
}

/** The cone shows at night for a lit lamp that has a length; a lens bitmap needs the viewer in front of it. */
export function beamShows(light, intensity, night) {
  return night && intensity > 0 && light.coneLength > 0;
}

/** Is the viewer (in body axes) in the half space the lamp faces? Only the heading counts, as in the game. */
export function lensFacesViewer(light, viewer) {
  const dx = viewer[0] - light.pos[0], dz = viewer[2] - light.pos[2];
  return dx * Math.sin(light.heading) + dz * Math.cos(light.heading) > 0;
}

/*
  Lamps of the port's own, for "Truck lamps" (docs/VISUALS.md, "Lamps"). Which lamp a truck has
  and where is still the TRK's, and the lamp switch, the brakes and the gear still decide what is
  lit. What changes is how a lit lamp is drawn, and three things about when:

   - a headlight lights the ground whenever it is lit, not only in the weathers that light the
     lamps at the start (the Headlights key switched the lens and the beam, and left the light
     on the ground as the weather had it);
   - its beam is seen in the air by what there is in the air to show it: plainly in fog and at
     night, faintly in rain and snow, hardly at all on a clear day;
   - a tail lamp works as a car's does now: dim and steady with the lamps on, full and at once
     under the brakes whether the lamps are on or not.
*/

/**
 * A lit lamp's own colour, linear, by its type: a headlight's warm white, a tail or brake
 * lamp's red (the game's lamp art is a pink that no tail lamp is), a reversing lamp's white.
 * Null for a lamp of another kind, which keeps the colour of its own art.
 */
export function lampTone(light) {
  if (light.type === 0 || light.type === 3) return [1, 0.92, 0.8];
  if (light.type === 1) return [1, 0.045, 0.02];
  if (light.type === 5) return [1, 0.97, 0.92];
  return null;
}

/** With the lamps on and the brakes off a tail lamp burns at this share of its brake light. */
export const TAIL_RUNNING = 0.22;

/**
 * How bright a lamp is, 0 to 1, as `lightIntensity` but for the tail lamps: running at
 * `TAIL_RUNNING` with the lamp switch on, full under the brakes with it on or off. The cab's
 * third lamp, on the centre line, is a brake lamp only.
 */
export function lampLevel(light, state) {
  if (light.type !== 1) return lightIntensity(light, state);
  if (state.cockpit) return 0;
  if (state.braking) return 1;
  return light.pos[0] === 0 || !(state.lamps > 0) ? 0 : TAIL_RUNNING;
}

/**
 * How brightly a lit lamp's lens glows against the screen's white, for a lamp at `level` (0 to
 * 1) in a weather as light as `daylight` (game/weather.js `light`, 1 a clear day): a lamp is
 * several times white, so that the lens flares it (render/lens.js), and is seen less by day,
 * when there is a bright picture round it. A headlight is far brighter than a tail lamp.
 */
export function lensGlow(light, level, daylight = 1) {
  const full = light.type === 0 || light.type === 3 ? 7 : light.type === 1 ? 4.5 : 3;
  return level * full * (1 - 0.55 * Math.min(1, Math.max(0, daylight)));
}

/**
 * How much there is in the air to show a beam, by weather, against the dark of Night doubled: a beam of light is seen
 * from the side only by what it lights on its way. Fog shows it best, the dark shows what
 * little dust and damp there always is, rain and snow show it in part, and on a clear day
 * there is next to nothing to see.
 */
export const BEAM_AIR = Object.freeze({ 0: 0.04, 1: 0.08, 2: 1.3, 3: 1.7, 4: 0.6, 5: 0.7, 6: 0.4, 7: 0.5, 8: 0.55, 9: 0.04 });
export const beamAir = (weather) => BEAM_AIR[weather] ?? BEAM_AIR[0];

/**
 * How strongly a lit headlight lights the ground before it, against its strength in the dark
 * (render/weather-scene.js): by day the sun's own light drowns it.
 */
export const headlightReach = (daylight = 1) => Math.min(1, Math.max(0.06, 1.2 - 1.15 * daylight));

/** How far past its drawn cone a lamp's light still reaches the ground, as a share of the cone's length. */
export const POOL_REACH = 2;

/**
 * The light a truck's own lamps throw on the ground ("Truck lamps"), as its TRK defines them: from its headlights (type 0),
 * or its roof lamps (type 3) when it has none, every one of them that throws a beam. `pos` is their middle and `dir`
 * their mean aim, body game axes; `angle` the half-angle of a cone that holds all their cones (each cone's own, widened
 * by how far apart the lamps stand); `reach` how far it lights, feet. Null for a truck whose lamps throw no beam.
 */
export function headlightPool(lights = []) {
  const beams = lights.filter(throwsBeam);
  const lamps = beams.some((l) => l.type === 0) ? beams.filter((l) => l.type === 0) : beams;
  if (!lamps.length) return null;
  const pos = [0, 1, 2].map((k) => lamps.reduce((sum, l) => sum + l.pos[k], 0) / lamps.length);
  const dir = [0, 0, 0];
  for (const l of lamps) {
    dir[0] += Math.sin(l.heading) * Math.cos(l.pitch); dir[1] += Math.sin(l.pitch); dir[2] += Math.cos(l.heading) * Math.cos(l.pitch);
  }
  const length = Math.hypot(...dir) || 1;
  for (let k = 0; k < 3; k++) dir[k] /= length;
  const spread = Math.max(...lamps.map((l) => Math.hypot(l.pos[0] - pos[0], l.pos[1] - pos[1])));
  const coneLength = Math.max(...lamps.map((l) => l.coneLength));
  const angle = Math.max(...lamps.map((l) => Math.atan2(Math.max(l.coneRim, l.coneBase) + spread, l.coneLength)));
  return { pos, dir, angle: Math.min(angle, Math.PI / 3), reach: coneLength * POOL_REACH };
}

/**
 * Aim the headlight pools and say how strongly each one lights the ground.
 *
 * `slots` are the scene's spot lights, one per truck that can be lit at once. They are shown and
 * hidden all together (`visible`): shown while any truck's pool is lit, the spare ones put out
 * (`intensity` 0), and hidden while none is. Every lit material's shader is built for the
 * number of spot lights shown and sums each of them at every point it draws, lit or put out, so
 * pools that are only put out cost a clear day the same as a night. Two shaders of each
 * material do for the whole race, one with the pools and one without, and the scene builds the
 * one it is not using ahead of need (render/weather-scene.js `warmPools`): hiding the pools one
 * by one made a shader for each count, built on the frame that first drew it, and the
 * Headlights key froze the race on that frame.
 *
 * As the game has it, a weather that lights the lamps lights every truck. With "Truck lamps"
 * (`rich`) each truck follows its own switch (`lit`), in any weather, as strongly as the day
 * leaves it to be seen (`headlightReach`), and its pool is its own lamps' (`pool`, `headlightPool`, placed by the truck's
 * rotation `matrix`): a truck whose lamps throw no beam lights no ground. `strength` is a pool's strength in the dark.
 * `cameraX` and `cameraZ` are the scene camera's (the world's z is mirrored, so a truck's game z
 * is `-cameraZ`). The nearest trucks take the slots.
 * @param {Array<{ intensity: number, visible: boolean, position: { set: Function }, target: { position: { set: Function } } }>} slots
 * @param {Array<{ x: number, y: number, z: number, heading: number, lit: boolean, pool?: object, matrix?: number[] }>} trucks
 *   game feet, heading in radians, `matrix` the body's rotation (row-major, body to world, game axes)
 * @param {{ rich: boolean, headlights: boolean, daylight: number, strength: number, cameraX: number, cameraZ: number }} env
 */
export function placeHeadlightPools(slots, trucks, { rich, headlights, daylight, strength, cameraX, cameraZ }) {
  const on = rich ? trucks.some((t) => t.lit) : headlights;
  for (const light of slots) light.visible = on;
  const reach = rich ? strength * headlightReach(daylight) : strength;
  const nearest = on
    ? trucks
      .filter((t) => !rich || (t.lit && t.pool !== null))
      .map((t) => ({ t, d: Math.hypot(t.x - cameraX, t.z + cameraZ) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, slots.length)
    : [];
  slots.forEach((light, i) => {
    const near = nearest[i]?.t;
    if (!near) { light.intensity = 0; return; }
    light.intensity = reach;
    if (rich && near.pool && near.matrix) {
      // The truck's own lamps: from their middle, along their aim, as wide and as far as their cones.
      const m = near.matrix, { pos, dir } = near.pool;
      const at = [0, 1, 2].map((r) => m[r * 3] * pos[0] + m[r * 3 + 1] * pos[1] + m[r * 3 + 2] * pos[2]);
      const way = [0, 1, 2].map((r) => m[r * 3] * dir[0] + m[r * 3 + 1] * dir[1] + m[r * 3 + 2] * dir[2]);
      const x = near.x + at[0], y = near.y + at[1], z = near.z + at[2], far = near.pool.reach;
      light.position.set(x, y, -z);
      light.target.position.set(x + way[0] * far, y + way[1] * far, -(z + way[2] * far));
      light.angle = near.pool.angle;
      light.distance = far;
      return;
    }
    const fx = Math.sin(near.heading), fz = Math.cos(near.heading);
    light.position.set(near.x + fx * 6, near.y + 3, -(near.z + fz * 6));
    light.target.position.set(near.x + fx * 90, near.y - 2, -(near.z + fz * 90));
    if (light.angle !== undefined) { light.angle = DEFAULT_POOL.angle; light.distance = DEFAULT_POOL.distance; }
  });
}

/** The pool of the game's own lamps, the same for every truck: its half-angle (rad) and reach (feet). */
export const DEFAULT_POOL = Object.freeze({ angle: 0.55, distance: 300 });

/** Whether a lamp is one that throws light ahead of the truck: a headlight or a roof lamp, with a cone. */
export const throwsBeam = (light) => (light.type === 0 || light.type === 3) && light.coneLength > 0;

/*
  The start gantry's lamps (MONSTER_EXE_ANALYSIS.md 6.1), as the port draws them with "Truck lamps". The game fills
  each lamp bar's texture with one palette colour: dark red through the countdown, then black, and the green bar black,
  then green. The port keeps when each is lit and draws the bar as a row of round lamps behind glass, lit far past
  white so the lens flares them, with a glow about each seen from in front, and in the dark a light of their colour on
  the ground and the trucks under the gantry.
*/
/**
 * `red` and `green` are the lit lamps' own colours, linear. A bar holds as many lamps as fit at `pitchFt` apart, each
 * `radiusFt` across its glass. A lit lamp's face is `face` times white at its middle and its glow `glow` (a tail lamp's
 * is 4.5, render/truck-object.js), both less by day as `lensGlow`. In the dark a light of the lit bar's colour, `light`
 * strong (a headlight's pool is 2.4), is thrown forward and down from the bar, out to `reachFt`.
 */
export const START_LAMPS = Object.freeze({
  red: Object.freeze([1, 0.045, 0.02]), green: Object.freeze([0.1, 1, 0.32]), pitchFt: 2.2, radiusFt: 0.72, face: 3, glow: 5, light: 2.2, reachFt: 70,
});
/** Which bar is lit, 0 or 1 each: the red through the countdown (`counting`), the green from the start, as the game has it. */
export const startLampsLit = (counting) => ({ red: counting ? 1 : 0, green: counting ? 0 : 1 });
/** How many lamps a bar `lengthFt` long holds. */
export const startLampCount = (lengthFt) => Math.max(1, Math.round(lengthFt / START_LAMPS.pitchFt));
/** How bright a lit start lamp's glow is against the screen's white, in a weather as light as `daylight`. */
export const startLampGlow = (lit, daylight = 1) => lit * START_LAMPS.glow * (1 - 0.55 * Math.min(1, Math.max(0, daylight)));
