/*
  Names written over the trucks in the world: one small label per truck, placed over the truck's roof by
  projecting its position onto the screen each frame.
*/
import * as THREE from "three";
import { el } from "../ui/dom.js";

/** Labels farther than this from the camera are hidden, in feet. */
const RANGE_FT = 700;
/** Feet above the truck's origin where its label hangs. */
const ABOVE_FT = 9;

export function createNameTags(count) {
  const root = el("div", { class: "name-tags", "aria-hidden": "true" });
  const tags = Array.from({ length: count }, () => {
    const tag = el("span", { class: "name-tag" });
    tag.hidden = true;
    root.append(tag);
    return tag;
  });
  const v = new THREE.Vector3();
  return {
    element: root,
    /**
     * `labels[i]` is the text or null; `positions[i]` the truck in game feet; `hidden[i]` skips a truck
     * (the one you sit in). `width` and `height` are the view's size in pixels.
     */
    update(camera, width, height, labels, positions, hidden = []) {
      tags.forEach((tag, i) => {
        const text = labels[i];
        const p = positions[i];
        if (!text || !p || hidden[i]) { tag.hidden = true; return; }
        v.set(p[0], p[1] + ABOVE_FT, -p[2]);
        if (v.distanceTo(camera.position) > RANGE_FT) { tag.hidden = true; return; }
        v.project(camera);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { tag.hidden = true; return; }
        tag.hidden = false;
        if (tag.textContent !== text) tag.textContent = text;
        tag.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -100%)`;
      });
    },
  };
}
