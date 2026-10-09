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

/** The cone shows at night for a lit lamp that has a length; a lens bitmap needs the viewer in front of it. */
export function beamShows(light, intensity, night) {
  return night && intensity > 0 && light.coneLength > 0;
}

/** Is the viewer (in body axes) in the half space the lamp faces? Only the heading counts, as in the game. */
export function lensFacesViewer(light, viewer) {
  const dx = viewer[0] - light.pos[0], dz = viewer[2] - light.pos[2];
  return dx * Math.sin(light.heading) + dz * Math.cos(light.heading) > 0;
}
