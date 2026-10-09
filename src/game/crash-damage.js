/*
  Crash damage in a race (MONSTER_EXE_ANALYSIS.md section 10): each truck's damage code (12 zones
  of two bits), the switch, and what a frame's hull contacts do. The simulation reports the hull
  points in contact since the last frame, `{ zone, steps, force }` (worker/sim-worker.js); each
  step is one call of the game's routine, which raises the zone's level to the force's and pushes
  the body's vertices (`dent`). Pure, so it runs under Node.
*/
import { mtm2Sim } from "../vendor/openphotex/index.js";

/** Steps handled for one zone in one frame, so a long stall cannot flatten a model. */
export const MAX_STEPS_PER_FRAME = 6;

export function createCrashDamage(count, { enabled = true } = {}) {
  const codes = new Array(count).fill(0);
  let on = enabled;
  return {
    get enabled() { return on; },
    /** Whether truck `i` is damaged (its hull impacts sound different). */
    damaged: (i) => mtm2Sim.isDamaged(codes[i]),
    code: (i) => codes[i],
    /**
     * Handle truck `i`'s contacts of one frame; `dent(zone, level)` pushes the body. Returns the number of dents made.
     */
    contacts(i, entries, dent) {
      if (!on || !entries?.length) return 0;
      let made = 0;
      for (const { zone, steps, force } of entries) {
        if (!(zone >= 1 && zone <= mtm2Sim.DAMAGE_ZONES)) continue;
        const hit = mtm2Sim.recordZoneHit(codes[i], zone, force);
        codes[i] = hit.code;
        for (let n = 0; n < Math.min(steps, MAX_STEPS_PER_FRAME); n++) { dent(zone, hit.level); made++; }
      }
      return made;
    },
    /** The Crash Damage key: flips the switch; switching off repairs every truck (`repair(i)` for each). Returns the new state. */
    toggle(repair) {
      on = !on;
      if (!on) { codes.fill(0); for (let i = 0; i < count; i++) repair(i); }
      return on;
    },
  };
}

/** The message the key shows (0x584c2d to 0x584c70): "Crash damage on", or off with the trucks repaired. */
export function crashDamageMessage(on, trucks) {
  if (on) return "Crash damage on";
  return trucks > 1 ? "Crash damage off, trucks repaired" : "Crash damage off, truck repaired";
}
