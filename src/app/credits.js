/*
  OpenMTM2's credits, rolled on the About screen before the original game's own (ui/screens/about.js).
*/
export const AUTHOR = "Juan Pablo Utreras";

/**
 * The OpenMTM2 part of the roll as lines: `{ text, kind }` where kind is "title", "heading", "name", "text" or "gap".
 * `t` translates the tags; names are shown as written. A "text" line is wrapped to the credits box.
 */
export function openmtm2Credits(t) {
  return [
    { text: "OpenMTM2", kind: "title" },
    { text: t("Open source web implementation of MTM2"), kind: "text" },
    { text: "", kind: "gap" },
    { text: t("Developed by"), kind: "heading" },
    { text: t("<<1>> & collaborators", AUTHOR), kind: "name" },
    { text: "", kind: "gap" },
    { text: t("Special thanks to <<1>> for enhanced graphics.", "Loren Burkholder"), kind: "text" },
    { text: "", kind: "gap" },
    { text: t("Built on OpenPhotex technology."), kind: "text" },
  ];
}
