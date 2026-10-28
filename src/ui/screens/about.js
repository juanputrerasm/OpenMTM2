/*
  About OpenMTM2, on the original About screen's layout (MONSTER_EXE_ANALYSIS.md 1, "About screen"): OpenMTM2's version
  and the installed game's build at the top right, the text box with OpenMTM2's line and the original game's credit
  lines, and the credits box rolling OpenMTM2's credits, then the game's own CREDLIST.BMP. When the roll is over the
  screen leaves by itself, as Continue does.
*/
import { el } from "../dom.js";
import { frame, uiImageUrl } from "../frame.js";
import { msg } from "../../game/strings.js";
import { VERSION } from "../../app/version.js";
import { openmtm2Credits } from "../../app/credits.js";
import { ABOUT_HEADINGS, CREDITS_BOX, aboutText, creditsDone, creditsOffset } from "../../game/about.js";

/** The credits strip's look: white bold headings centred, gold names from the left (as CREDLIST.BMP draws them). */
const FONT = "Arial, Helvetica, sans-serif";
const LINE = { title: 30, heading: 22, name: 19, text: 18, gap: 14 };
const STRIP_WIDTH = 237;

export default async function mount(container, context) {
  const { t } = context;
  // The retail UI.POD has ABOUT.BMP; Community Patch 3's has ABOUT480.BMP in its place.
  const backdrop = (await uiImageUrl(context.assets, "ABOUT")) ? "ABOUT" : (await uiImageUrl(context.assets, "ABOUT480")) ? "ABOUT480" : "ABOUT";
  const [legalRaw, stripUrl] = await Promise.all([
    context.assets.call("uiText", { name: "LEGAL" }).catch(() => null),
    uiImageUrl(context.assets, "CREDLIST"),
  ]);
  const strip = stripUrl ? await loadImage(stripUrl) : null;
  const about = aboutText(t, { openmtm2Version: VERSION, exeVersion: context.exeVersion, legalRaw });

  const ui = await frame(container, context, {
    title: msg("About"), backdrop, bar: "about",
    regions: { aboutInfo: [400, 10, 200, 72], aboutText: [10, 205, 355, 260], aboutCredits: [CREDITS_BOX.x, CREDITS_BOX.y, STRIP_WIDTH, CREDITS_BOX.height] },
    modernRegions: { aboutInfo: [24, 64, 340, 72], aboutText: [24, 144, 340, 246] },
  });

  ui.regions.aboutInfo.append(...about.pairs.map(([caption, value]) =>
    el("div", { class: "about-pair" }, el("div", { class: "about-caption" }, caption), el("div", { class: "about-value" }, value))));
  ui.regions.aboutText.append(...about.text.map((line) => (line ? el("p", { class: "about-line" }, line) : el("div", { class: "about-gap" }))));

  const canvas = el("canvas", { class: "about-roll", width: STRIP_WIDTH, height: CREDITS_BOX.height });
  ui.regions.aboutCredits.classList.add("about-credits");
  ui.regions.aboutCredits.append(canvas);
  const ctx = canvas.getContext("2d");
  const fontOf = (kind) => (kind === "title" ? `bold 24px ${FONT}` : kind === "heading" ? `bold 15px ${FONT}` : kind === "text" ? `14px ${FONT}` : `15px ${FONT}`);

  // The roll: OpenMTM2's credits drawn here (a sentence wrapped to the box), a heading, then the game's strip, one column.
  const credits = openmtm2Credits(t);
  if (strip) credits.push({ text: "", kind: "gap" }, { text: "", kind: "gap" }, { text: t(ABOUT_HEADINGS.gameCredits), kind: "heading" }, { text: "", kind: "gap" });
  const lines = credits.flatMap((line) => {
    if (line.kind !== "text") return [line];
    ctx.font = fontOf("text");
    return wrap(ctx, line.text, canvas.width - 8).map((text) => ({ text, kind: "text" }));
  });
  const textHeight = CREDITS_BOX.height + lines.reduce((sum, line) => sum + LINE[line.kind], 0);
  const rollHeight = textHeight + (strip?.naturalHeight ?? 0);

  const draw = (offset) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The roll starts below the box, so OpenMTM2's title scrolls in rather than sitting there at first.
    let y = CREDITS_BOX.height - offset;
    for (const line of lines) {
      const h = LINE[line.kind];
      if (line.text && y + h > 0 && y < canvas.height) {
        // Titles, headings and sentences centred; names from the left in gold, as CREDLIST.BMP has them.
        const centred = line.kind !== "name";
        ctx.font = fontOf(line.kind);
        ctx.fillStyle = line.kind === "title" || line.kind === "heading" ? "#fff" : "#f8c018";
        ctx.textAlign = centred ? "center" : "left";
        ctx.textBaseline = "top";
        ctx.fillText(line.text, centred ? canvas.width / 2 : 4, y + 2, canvas.width - 8);
      }
      y += h;
    }
    if (strip && y < canvas.height) ctx.drawImage(strip, 0, Math.round(y));
  };

  let frameId = 0, gone = false;
  const opened = performance.now();
  const tick = (now) => {
    if (gone) return;
    const offset = creditsOffset(now - opened);
    if (creditsDone(offset, rollHeight)) { gone = true; context.router.back(); return; }
    draw(Math.floor(offset));
    frameId = requestAnimationFrame(tick);
  };
  draw(0);
  frameId = requestAnimationFrame(tick);

  return { unmount() { gone = true; cancelAnimationFrame(frameId); ui.unmount?.(); } };
}

/** A sentence broken into lines no wider than `width` in the context's font. */
function wrap(ctx, text, width) {
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
