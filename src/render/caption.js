/*
  The in-race message bar (MONSTER_EXE_ANALYSIS.md 11, message system 0x414280 to 0x4165a0): a
  dark rectangle at the bottom of the view with the game's large font, for every message (view
  changes, the final lap, missed checkpoints, GOLD switches). Each message comes in with one of
  seven random transitions over a second, stays for its time, and goes out with one of four
  random ones over a second (0x41469b; -1 picks at random):

  in  0 slides in from the right, 1 from the left, 2 from below (the bar and its text together);
      3 and 4 bring the bar in from the right or from below while the letters appear from the left
      of the line to its right; 5 the bar from the left and the letters from the right; 6 slides
      the bar's even rows (and every other letter) in from the left and the odd ones from the right.
  out 0 slides out to the left, 1 to the right, 2 downward; 3 lets the letters fall away.

  The bar rests with its bottom edge at 98% of the height, centred; its width is the text's plus
  W/80 and its height the line's plus H/50 (a screenshot measures it 30 high at 480 lines). The
  motion is eased out going in, (2 - t) t, and eased in going out, t squared.
*/
import { drawText, textWidth } from "./bitmap-text.js";

export const IN_SECONDS = 1, OUT_SECONDS = 1;
export const IN_TRANSITIONS = 7, OUT_TRANSITIONS = 4;
const W = 640, H = 480, BAR_HEIGHT = 30, LINE_HEIGHT = 27;
const BAR = "rgba(24, 28, 24, 0.82)";

const easeOut = (t) => (2 - t) * t;

/**
 * Where the bar and its letters are at a moment of a message: `{ x, y }` is the bar's top-left,
 * `letters(i, count)` the letter's offset and opacity, `rows(r)` the bar row's horizontal offset.
 * `phase` is "in", "hold" or "out" and `t` its progress from 0 to 1.
 */
export function captionPose(phase, t, kind, bar) {
  const restX = (W - bar.width) / 2, restY = H * 0.98 - bar.height;
  const pose = { x: restX, y: restY, rowOffset: () => 0, letter: () => ({ dx: 0, dy: 0, alpha: 1 }), bar: true };
  if (phase === "hold") return pose;
  if (phase === "in") {
    const e = easeOut(t), k = 1 - e;
    switch (kind) {
      case 0: pose.x = restX + (W + bar.width * 0.1 - restX) * k; break;
      case 1: pose.x = restX - (restX + bar.width * 1.1) * k; break;
      case 2: pose.y = restY + (H - restY + bar.height * 0.1) * k; break;
      case 3: case 4: case 5: {
        if (kind === 3) pose.x = restX + (W - restX) * k;
        else if (kind === 4) pose.y = restY + (H - restY) * k;
        else pose.x = restX - (restX + W * 0.5 + bar.width / 2) * k;
        const fromRight = kind === 5;
        pose.letter = (i, count) => {
          const along = count > 1 ? i / (count - 1) : 0;
          const progress = e * 2 - (fromRight ? 1 - along : along);
          return { dx: 0, dy: 0, alpha: Math.max(0, Math.min(1, progress)) };
        };
        break;
      }
      default: {
        // Interlaced: even rows and letters from the left, odd from the right.
        const left = -(bar.width * 0.5 + W * 0.5) * k, right = (bar.width * 0.5 + W * 0.5) * k;
        pose.rowOffset = (r) => (r % 2 ? right : left);
        pose.letter = (i) => ({ dx: i % 2 ? right : left, dy: 0, alpha: 1 });
      }
    }
    return pose;
  }
  const c = t * t;
  switch (kind) {
    case 0: pose.x = restX - (restX + bar.width * 1.1) * c; break;
    case 1: pose.x = restX + (W + bar.width * 0.1 - restX) * c; break;
    case 2: pose.y = restY + (H - restY + bar.height * 0.1) * c; break;
    default: {
      pose.bar = false;
      const e = easeOut(t);
      pose.letter = (i) => ({ dx: ((i * 7) % 5 - 2) * 14 * e, dy: (50 + (i % 4) * 25) * e, alpha: 1 - t });
    }
  }
  return pose;
}

export function createCaption(font, { random = Math.random } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "race-caption";
  canvas.width = W;
  canvas.height = H;
  canvas.hidden = true;
  const ctx = canvas.getContext("2d");
  let message = null;

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    if (!message) { canvas.hidden = true; return; }
    canvas.hidden = false;
    const kind = message.phase === "out" ? message.outKind : message.inKind;
    const t = message.phase === "hold" ? 1 : message.elapsed / (message.phase === "in" ? IN_SECONDS : OUT_SECONDS);
    const pose = captionPose(message.phase, Math.min(1, t), kind, message.bar);
    const { bar } = message;
    if (pose.bar) {
      ctx.fillStyle = BAR;
      for (let r = 0; r < bar.height; r++) ctx.fillRect(Math.round(pose.x + pose.rowOffset(r)), Math.round(pose.y) + r, bar.width, 1);
    }
    const chars = [...message.text];
    let x = pose.x + 4;
    const top = pose.y + (bar.height - LINE_HEIGHT) / 2;
    chars.forEach((ch, i) => {
      const { dx, dy, alpha } = pose.letter(i, chars.length);
      const advance = textWidth(font, ch === " " ? "i" : ch) + (i < chars.length - 1 ? 1 : 0);
      if (alpha > 0 && ch !== " ") {
        ctx.globalAlpha = alpha;
        drawText(ctx, font, ch, Math.round(x + dx) + 1, Math.round(top + dy) + 1, { color: "#000" });
        drawText(ctx, font, ch, Math.round(x + dx), Math.round(top + dy), { color: "#f0f0f0" });
        ctx.globalAlpha = 1;
      }
      x += ch === " " ? Math.round(font.lineHeight * 0.4) + 1 : advance;
    });
  };

  return {
    element: canvas,
    get active() { return !!message; },
    /** Show a message for `seconds` between its two transitions (`Infinity` keeps it until `clear`). The same text again only renews its time. */
    show(text, seconds = 2) {
      if (!font || !text) return;
      if (message && message.text === text && message.phase !== "out") { message.hold = seconds; if (message.phase === "hold") message.elapsed = 0; return; }
      const width = Math.ceil(textWidth(font, text) + 8);
      message = {
        text, hold: seconds, phase: "in", elapsed: 0, bar: { width, height: BAR_HEIGHT },
        inKind: Math.floor(random() * IN_TRANSITIONS), outKind: Math.floor(random() * OUT_TRANSITIONS),
      };
      draw();
    },
    clear() { if (message && message.phase !== "out") { message.phase = "out"; message.elapsed = 0; } },
    update(dt) {
      if (!message) return;
      message.elapsed += dt;
      if (message.phase === "in" && message.elapsed >= IN_SECONDS) { message.phase = "hold"; message.elapsed = 0; }
      else if (message.phase === "hold" && message.elapsed >= message.hold) { message.phase = "out"; message.elapsed = 0; }
      else if (message.phase === "out" && message.elapsed >= OUT_SECONDS) message = null;
      draw();
    },
  };
}
