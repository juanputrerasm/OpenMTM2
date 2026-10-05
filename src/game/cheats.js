/*
  The typed cheat codes (MONSTER_EXE_ANALYSIS.md 15): the game keeps the last 8 keys typed and
  compares them with each code. Pure, so it runs under Node.
*/
export const CHEAT_CODES = Object.freeze(["GOLD", "FRAME"]);
export const MAX_TYPED = 8;

/** The code the typed letters end with, or null. */
export function cheatTyped(typed) {
  return CHEAT_CODES.find((code) => typed.endsWith(code)) ?? null;
}

/** The typed letters after one more key (`code` is a KeyboardEvent.code), the last 8 kept. */
export function typeKey(typed, code) {
  return /^Key[A-Z]$/.test(code) ? (typed + code.slice(3)).slice(-MAX_TYPED) : typed;
}
