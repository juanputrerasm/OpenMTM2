/* Community Patch 3's racing line, as points (render/race-line.js draws them). Pure. */
export const RACE_LINE_PIECE_FT = 24, RACE_LINE_MAX_PIECES = 64, RACE_LINE_LIFT_FT = 0.35, RACE_LINE_REACH_FT = 900;

/**
 * Line-segment pairs (game feet) along every straight `{ startFt, endFt }`, each cut into `1 + length / 24` pieces (at
 * most 64), every end 0.35 ft over `heightAt(x, z)`.
 */
export function raceLinePoints(straights, heightAt) {
  const out = [];
  for (const s of straights ?? []) {
    const a = s.startFt, b = s.endFt;
    if (!a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const pieces = Math.max(1, Math.min(RACE_LINE_MAX_PIECES, 1 + Math.trunc(length / RACE_LINE_PIECE_FT)));
    const at = (k) => {
      const t = k / pieces, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
      return [x, heightAt(x, z) + RACE_LINE_LIFT_FT, z];
    };
    for (let k = 0; k < pieces; k++) out.push(at(k), at(k + 1));
  }
  return out;
}
