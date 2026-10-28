/*
  The About screen's text and its credits roll (MONSTER_EXE_ANALYSIS.md 1, "About screen").

  The screen is OpenMTM2's own: it names OpenMTM2 and its version first, then the installed game's
  build, then the installed game's `UI\LEGAL.TXT` as the original game's credit, without its product
  and version lines. The credits roll is OpenMTM2's credits first, then the game's `CREDLIST.BMP`.
*/
import { buildKind } from "../install/exe-version.js";
import { msg } from "./strings.js";

/** The game's credits box on the 640 x 480 art: x, y, height; the width is the strip's. */
export const CREDITS_BOX = Object.freeze({ x: 384, y: 127, height: 254 });
/** The roll's speed in pixels per second, and the wait before it moves. */
export const CREDITS_SPEED = 24;
export const CREDITS_DELAY_MS = 500;

/** How far the roll has moved, in pixels, `ms` after the screen opened. */
export function creditsOffset(ms) {
  return Math.max(0, ms - CREDITS_DELAY_MS) * CREDITS_SPEED / 1000;
}

/** True once the roll's last `boxHeight` pixels are in the box: the screen then leaves by itself. */
export function creditsDone(offset, rollHeight, boxHeight = CREDITS_BOX.height) {
  return offset >= rollHeight - boxHeight;
}

/** The installed game's build as shown: "Monster Truck Madness 2, Version 2.00.42", with the kind of build when not retail. */
export function installedVersionText(t, version) {
  if (!version) return t("Monster Truck Madness 2, version unknown");
  const kind = buildKind(version);
  if (kind === "patch") return t("Monster Truck Madness 2, Version <<1>> (community patch)", version);
  if (kind === "beta") return t("Monster Truck Madness 2, Version <<1>> (beta)", version);
  return t("Monster Truck Madness 2, Version <<1>>", version);
}

/**
 * The original game's lines from `LEGAL.TXT`: CRLF split, its product and version lines (the first paragraph when it
 * carries the `<<1>>` version slot) left out, runs of blank lines kept to one. Empty when the text is missing.
 */
export function originalLegalLines(raw) {
  if (!raw) return [];
  let lines = String(raw).replace(/\x1a[\s\S]*$/, "").split(/\r\n?|\n/).map((line) => line.trimEnd());
  const blank = lines.findIndex((line) => !line.trim());
  const head = blank < 0 ? lines : lines.slice(0, blank);
  if (head.some((line) => line.includes("<<1>>"))) lines = lines.slice(head.length);
  lines = lines.filter((line) => !line.includes("<<1>>"));
  const out = [];
  for (const line of lines) {
    if (!line.trim() && (!out.length || !out[out.length - 1].trim())) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/**
 * Everything the About screen writes, translated: the two caption and value pairs at the top right, and the text box's
 * paragraphs (OpenMTM2's own line, then the original game's credit lines under a heading).
 */
export function aboutText(t, { openmtm2Version, exeVersion, legalRaw }) {
  const legal = originalLegalLines(legalRaw);
  return {
    pairs: [
      [t("OpenMTM2"), t("Version <<1>>", openmtm2Version)],
      [t("Installed version:"), installedVersionText(t, exeVersion)],
    ],
    text: [
      t("OpenMTM2 <<1>>", openmtm2Version),
      t("Installed version: <<1>>", installedVersionText(t, exeVersion)),
      "",
      t("OpenMTM2 is an open-source reimplementation of Monster Truck Madness 2 that runs in your browser and plays from your own copy of the game. Apache License 2.0."),
      ...(legal.length ? ["", t("Original game"), ...legal] : []),
    ],
  };
}

/** Shown on the About screen before the game's own credits; the tags are translated, names are not. */
export const ABOUT_HEADINGS = Object.freeze({
  gameCredits: msg("Monster Truck Madness 2 credits"),
});
