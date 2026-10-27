/*
  Names written over the trucks in the world: one small label per truck, placed over the truck's roof by
  projecting its position onto the screen each frame. Written in the game's own bitmap font (render/bitmap-text.js)
  when the install has it, in white with a black edge; a label of two lines (game/names.js, the driver and the truck)
  has its second line in red. The font is drawn pixel for pixel on the screen's own pixels, at a whole scale for the
  screen's height (`nameTagScale`): one font pixel a screen pixel up to about 1,600 pixels tall, about the size of the
  13 px text shown without the font.
*/
import * as THREE from "three";
import { el } from "../ui/dom.js";
import { drawText, textWidth } from "./bitmap-text.js";
import { linePieces, nameTagLineColour, nameTagPaintKey, nameTagScale } from "./name-tag-style.js";

export { NAME_COLOURS, nameTagScale } from "./name-tag-style.js";

/** Feet above the truck's origin where its label hangs. */
const ABOVE_FT = 9;

export function createNameTags(count, font = null) {
  const root = el("div", { class: "name-tags", "aria-hidden": "true" });
  const tags = Array.from({ length: count }, () => {
    const tag = font ? el("canvas", { class: "name-tag name-tag-font" }) : el("span", { class: "name-tag" });
    tag.hidden = true;
    root.append(tag);
    return tag;
  });
  const shown = tags.map(() => "");
  // The screen the tags were drawn for: a new size or pixel ratio draws them again.
  let drawnFor = "";
  /** Write a label's lines on its tag: the font's glyphs with a one-pixel black edge, or plain text without the font. */
  const write = (tag, lines, extensionColour) => {
    const colourOf = (piece, k) => piece.color || nameTagLineColour(k, extensionColour);
    if (!font) {
      tag.replaceChildren(...lines.map((pieces, k) => el("span", { class: "name-tag-line", style: `color: ${nameTagLineColour(k, extensionColour)}` },
        ...pieces.map((piece) => el("span", { style: `color: ${colourOf(piece, k)}` }, piece.text)))));
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const scale = nameTagScale(Math.round(window.innerHeight * ratio));
    const lineH = (font.lineHeight + 2) * scale, edge = scale;
    const widthOf = (pieces) => pieces.reduce((w, piece) => w + textWidth(font, piece.text, scale), 0);
    tag.width = Math.ceil(Math.max(1, ...lines.map(widthOf))) + 2 * edge;
    tag.height = lines.length * lineH + 2 * edge;
    // One canvas pixel a device pixel.
    tag.style.width = `${tag.width / ratio}px`;
    tag.style.height = `${tag.height / ratio}px`;
    const ctx = tag.getContext("2d");
    ctx.clearRect(0, 0, tag.width, tag.height);
    lines.forEach((pieces, k) => {
      let x = Math.round((tag.width - widthOf(pieces)) / 2);
      const y = edge + k * lineH;
      for (const piece of pieces) {
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawText(ctx, font, piece.text, x + dx * edge, y + dy * edge, { color: "#000", scale });
        drawText(ctx, font, piece.text, x, y, { color: colourOf(piece, k), scale });
        x += textWidth(font, piece.text, scale);
      }
    });
  };
  const v = new THREE.Vector3();
  const inView = new THREE.Vector3();
  return {
    element: root,
    /**
     * `labels[i]` is the text, two lines as `[first, second]`, or null; `positions[i]` the truck in game feet;
     * `hidden[i]` skips a truck (the one you sit in). `width` and `height` are the view's size in pixels.
     * `marks[i]`, when given, is an extension indicator (`{ color }`): the label in that colour.
     */
    update(camera, width, height, labels, positions, hidden = [], marks = []) {
      const screen = `${window.innerHeight}@${window.devicePixelRatio || 1}`;
      if (screen !== drawnFor) { drawnFor = screen; shown.fill(""); }
      tags.forEach((tag, i) => {
        const label = labels[i];
        const p = positions[i];
        const mark = marks[i] ?? null;
        if (!label || !p || hidden[i]) { tag.hidden = true; return; }
        v.set(p[0], p[1] + ABOVE_FT, -p[2]);
        // Shown at any distance, past the far plane too: only a truck behind the camera or off the screen has no label.
        inView.copy(v).applyMatrix4(camera.matrixWorldInverse);
        if (inView.z > -0.5) { tag.hidden = true; return; }
        v.project(camera);
        if (Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { tag.hidden = true; return; }
        tag.hidden = false;
        const color = mark?.color ?? "";
        const lines = (Array.isArray(label) ? label : [label]).filter(Boolean).map(linePieces), key = nameTagPaintKey(lines, color);
        if (shown[i] !== key) { shown[i] = key; write(tag, lines, color); }
        if (tag.dataset.color !== color) { tag.dataset.color = color; tag.style.color = color; }
        tag.classList.toggle("name-tag-mark", !!mark);
        // The label's top left on a whole device pixel, so its glyphs stay sharp.
        const ratio = window.devicePixelRatio || 1;
        const w = tag.width / ratio, h = tag.height / ratio;
        const x = Math.round(((v.x * 0.5 + 0.5) * width - w / 2) * ratio) / ratio, y = Math.round(((-v.y * 0.5 + 0.5) * height - h) * ratio) / ratio;
        tag.style.transform = font ? `translate(${x}px, ${y}px)` : `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -100%)`;
      });
    },
  };
}
