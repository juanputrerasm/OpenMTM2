/*
  A computer truck's horn or YeeHaw high in the air (MONSTER.EXE `0x41e030`; Community Patch 3 `FUN_140214740`, the same
  rule with its switches; CP3_EXE_ANALYSIS.md 3). With all four wheels off the ground and the truck not being reset,
  `h` is a quarter of the four wheels' heights over the ground less a truck figure (`+0x1cc`, not traced; the port takes
  the body's height over the ground). Over 10 ft, each frame (the game's ran at about 30 a second) a computer truck
  sounds off when `rand() % N < 1.5 h`: N is 5000, or with CP3's "Reduce Yee-Haw/Horn Freq." `((slot x 7 + 3) % 5) x
  5000 + 30000` (6 to 10 times rarer, a different rate per truck). It then honks or whoops, one or the other at random;
  CP3's "Opponents Horn" and "Opponents Yee-Haw" switch each off (with one off, the other is always the one). Pure.
*/
export const AIR_CALL_FT = 10, AIR_CALL_RATE = 1.5, AIR_CALL_RANGE = 5000, GAME_FRAMES_PER_S = 30;

/** The settings' switches: CP3's `aiHorn`, `aiYeeHaw` (both on by default) and `aiSfxReduce` (off). */
export function airCallSwitches(settings = {}) {
  return { horn: settings.aiHorn !== false, yeehaw: settings.aiYeeHaw !== false, reduce: settings.aiSfxReduce === true };
}

/** The range the chance is drawn from for the truck in `slot`. */
export const airCallRange = (slot, reduce) => (reduce ? (((slot * 7 + 3) % 5) * 5000 + 30000) : AIR_CALL_RANGE);

/**
 * What a computer truck `slot` that is `h` ft up (all four wheels off) says over `dt` seconds: "horn", "yeehaw" or
 * null. `random()` is 0..1.
 */
export function airCall(h, slot, dt, switches, random = Math.random) {
  if (!(h > AIR_CALL_FT) || !(dt > 0) || (!switches.horn && !switches.yeehaw)) return null;
  const chance = Math.min(1, (AIR_CALL_RATE * h * GAME_FRAMES_PER_S * dt) / airCallRange(slot, switches.reduce));
  if (random() >= chance) return null;
  if (switches.horn && switches.yeehaw) return random() < 0.5 ? "horn" : "yeehaw";
  return switches.horn ? "horn" : "yeehaw";
}
