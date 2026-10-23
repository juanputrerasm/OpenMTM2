/*
  The rumble readout (Options, Keys): a small debug panel in a race that shows whether the gamepad rumbles, why not
  when it does not, how hard each motor runs, and what set it (game/input/rumble.js). Like the FPS counter, it is a
  developer's panel and reads in English.
*/
import { el } from "./dom.js";

const SURFACES = Object.freeze({
  0: "Default", 100: "Cement", 200: "Dirt", 300: "Water", 400: "Mud", 500: "Sand", 600: "Grass", 700: "Gravel",
  800: "Ice", 900: "Snow", 1000: "Metal", 1100: "Wood", 1200: "Rocks", 1300: "Deep water or air", 1400: "1400 (bridge)",
});
const pct = (v) => `${Math.round(v * 100)}%`;

export function createRumbleReadout({ visible = false } = {}) {
  const lines = [0, 1, 2, 3, 4, 5, 6].map(() => el("div"));
  const element = el("div", { class: "rumble-readout", hidden: !visible }, ...lines);
  let lastJolt = null, lastJoltAt = 0;  // the latest hit and when it came
  const write = (...texts) => lines.forEach((line, i) => { line.textContent = texts[i] ?? ""; });
  return {
    element,
    /**
     * `state`: `{ on, reason, info: { pad, canRumble }, strength, report }`; `report` is the rumble model's frame.
     */
    show({ on, reason = "", info = {}, strength = 0, report = null }) {
      if (element.hidden) return;
      element.classList.toggle("on", !!on && !!report && (report.strong > 0.01 || report.weak > 0.01));
      const pad = info.pad ? `${info.pad.slice(0, 40)} (rumble: ${info.canRumble ? "yes" : "no"})` : "no gamepad";
      if (!on || !report) { write(`RUMBLE OFF: ${reason}`, `pad: ${pad}`); return; }
      if (report.lastHit && report.lastHit !== lastJolt) { lastJolt = report.lastHit; lastJoltAt = performance.now(); }
      const ago = lastJolt ? ((performance.now() - lastJoltAt) / 1000).toFixed(1) : null;
      write(
        `RUMBLE ON  strong ${pct(report.strong)}  weak ${pct(report.weak)}  (strength ${pct(strength)})`,
        `pad: ${pad}`,
        `sent to pad: ${info.sent ? `strong ${pct(info.sent.strong)}  weak ${pct(info.sent.weak)}` : "nothing"}, ${info.perSecond ?? 0}/s   engine ${pct(report.engine)}`,
        report.hit > 0 ? `hit ${pct(report.hit)} fading, ${report.hitLeft.toFixed(2)} s left` : "hit: none",
        lastJolt ? `last hit ${lastJolt.size.toFixed(2)}, ${ago} s ago:` : "last hit: none yet",
        lastJolt
          ? `  hull ${Math.round(lastJolt.impact)} lbf  trucks ${Math.round(lastJolt.collide)} lbf  wheels +${Math.round(lastJolt.wheels)} lbf  object ${lastJolt.object.toFixed(1)} ft/s  landing ${lastJolt.bottoming.toFixed(1)} ft/s`
          : "",
        report.surface === null
          ? `ground: none (off, in the air or stopped), ${report.speed.toFixed(0)} ft/s`
          : `ground: ${SURFACES[report.surface] ?? report.surface} ${report.hz.toFixed(1)} Hz, size ${report.size.toFixed(2)}, ${report.speed.toFixed(0)} ft/s`,
      );
    },
    setVisible(on) { element.hidden = !on; },
  };
}
