/*
  Names written over the trucks in the world: one small label per truck, placed over the truck's roof by
  projecting its position onto the screen each frame. Written in the game's own bitmap font (render/bitmap-text.js)
  when the install has it, in white with a black edge; a label of two lines (game/names.js, the driver and the truck)
  has its second line in red.
*/
import * as THREE from "three";
import { el } from "../ui/dom.js";
import { drawText, textWidth } from "./bitmap-text.js";

/** Labels farther than this from the camera are hidden, in feet. */
const RANGE_FT = 700;
/** Feet above the truck's origin where its label hangs. */
const ABOVE_FT = 9;
/** The lines' colours: the first, and the second (the truck under its driver). */
export const NAME_COLOURS = Object.freeze(["#ffffff", "#e8231c"]);

export function createNameTags(count, font = null, scale = 1) {
  const root = el("div", { class: "name-tags", "aria-hidden": "true" });
  const tags = Array.from({ length: count }, () => {
    const tag = font ? el("canvas", { class: "name-tag name-tag-font" }) : el("span", { class: "name-tag" });
    tag.hidden = true;
    root.append(tag);
    return tag;
  });
  const shown = tags.map(() => "");
  /** Write a label's lines on its tag: the font's glyphs with a one-pixel black edge, or plain text without the font. */
  const write = (tag, lines) => {
    if (!font) {
      tag.replaceChildren(...lines.map((line, k) => el("span", { class: "name-tag-line", style: `color: ${NAME_COLOURS[Math.min(k, 1)]}` }, line)));
      return;
    }
    const lineH = (font.lineHeight + 2) * scale, edge = scale;
    tag.width = Math.ceil(Math.max(1, ...lines.map((line) => textWidth(font, line, scale)))) + 2 * edge;
    tag.height = lines.length * lineH + 2 * edge;
    tag.style.width = `${tag.width}px`;
    tag.style.height = `${tag.height}px`;
    const ctx = tag.getContext("2d");
    ctx.clearRect(0, 0, tag.width, tag.height);
    lines.forEach((line, k) => {
      const x = Math.round((tag.width - textWidth(font, line, scale)) / 2), y = edge + k * lineH;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawText(ctx, font, line, x + dx * edge, y + dy * edge, { color: "#000", scale });
      drawText(ctx, font, line, x, y, { color: NAME_COLOURS[Math.min(k, 1)], scale });
    });
  };
  const v = new THREE.Vector3();
  return {
    element: root,
    /**
     * `labels[i]` is the text, two lines as `[first, second]`, or null; `positions[i]` the truck in game feet;
     * `hidden[i]` skips a truck (the one you sit in). `width` and `height` are the view's size in pixels.
     * `marks[i]`, when given, is a party mode's indicator (`{ color, far }`): the label in that colour,
     * and with `far` at any distance.
     */
    update(camera, width, height, labels, positions, hidden = [], marks = []) {
      tags.forEach((tag, i) => {
        const label = labels[i];
        const p = positions[i];
        const mark = marks[i] ?? null;
        if (!label || !p || hidden[i]) { tag.hidden = true; return; }
        v.set(p[0], p[1] + ABOVE_FT, -p[2]);
        if (!mark?.far && v.distanceTo(camera.position) > RANGE_FT) { tag.hidden = true; return; }
        v.project(camera);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { tag.hidden = true; return; }
        tag.hidden = false;
        const lines = (Array.isArray(label) ? label : [label]).filter(Boolean).map(String), key = lines.join("\n");
        if (shown[i] !== key) { shown[i] = key; write(tag, lines); }
        const color = mark?.color ?? "";
        if (tag.dataset.color !== color) { tag.dataset.color = color; tag.style.color = color; }
        tag.classList.toggle("name-tag-mark", !!mark);
        tag.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -100%)`;
      });
    },
  };
}
