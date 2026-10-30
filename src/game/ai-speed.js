/*
  AI Speed, from Community Patch 3 (docs/CP3_EXE_ANALYSIS.md 5): a whole percent, 70 to 130, default 100. It
  multiplies each computer truck's autopilot target speed and engine torque by percent / 100. The player's
  truck and trucks another machine drives are never scaled. A running tournament's own value takes its place.
*/

export const AI_SPEED = Object.freeze({ min: 70, max: 130, step: 5, default: 100 });

/** The setting as the game reads it: a whole percent clamped to 70..130; anything unreadable is 100. */
export function aiSpeedPercent(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return AI_SPEED.default;
  return Math.min(AI_SPEED.max, Math.max(AI_SPEED.min, n));
}

/** The factor the simulation applies, or null at 100 % (the game scales only when the factor is not 1). */
export function aiSpeedFactor(value) {
  const percent = aiSpeedPercent(value);
  return percent === 100 ? null : percent / 100;
}

/**
 * The AI Speed in force and whether something other than the Options value set it: a running tournament's
 * own value comes first, then an online room's, then the player's setting.
 */
export function effectiveAiSpeed({ setting, tournament = null, room = null } = {}) {
  if (Number.isFinite(Number(tournament)) && tournament !== null) return { percent: aiSpeedPercent(tournament), locked: true };
  if (Number.isFinite(Number(room)) && room !== null) return { percent: aiSpeedPercent(room), locked: true };
  return { percent: aiSpeedPercent(setting), locked: false };
}
