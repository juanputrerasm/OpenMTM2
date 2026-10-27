/*
  Pure colour and cache-key rules for the labels above trucks. Kept apart from the three.js view so
  extension colours can be covered by the Node test suite.
*/

/** The ordinary lines' colours: the driver, then the truck under it. */
export const NAME_COLOURS = Object.freeze(["#ffffff", "#e8231c"]);

/** An extension colour owns every line; otherwise the ordinary per-line colours apply. */
export function nameTagLineColour(line, extensionColour = "") {
  return extensionColour || NAME_COLOURS[Math.min(line, NAME_COLOURS.length - 1)];
}

/**
 * A label's line as pieces `[{ text, color }]`: a string is one piece; a line may be one piece `{ text, color }` or a
 * list of them (a name in white and a coloured figure beside it). A piece without a colour takes the line's.
 */
export function linePieces(line) {
  const piece = (p) => (p && typeof p === "object" ? { text: String(p.text ?? ""), color: p.color || "" } : { text: String(p ?? ""), color: "" });
  return Array.isArray(line) ? line.map(piece) : [piece(line)];
}

/** A different colour must repaint a bitmap label even when its words did not change. */
export function nameTagPaintKey(lines, extensionColour = "") {
  return `${extensionColour}\0${lines.map((line) => linePieces(line).map((p) => `${p.color}\u0001${p.text}`).join("\u0002")).join("\n")}`;
}

/** The name tags' font scale on a screen `deviceHeight` device pixels tall: whole, one font pixel a screen pixel to about 1,600. */
export const nameTagScale = (deviceHeight) => Math.max(1, Math.round(deviceHeight / 1080));
