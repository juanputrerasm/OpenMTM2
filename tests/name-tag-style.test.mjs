import test from "node:test";
import assert from "node:assert/strict";
import { NAME_COLOURS, linePieces, nameTagLineColour, nameTagPaintKey } from "../src/render/name-tag-style.js";

test("an extension colour repaints every line of a truck name tag", () => {
  assert.equal(nameTagLineColour(0), NAME_COLOURS[0]);
  assert.equal(nameTagLineColour(1), NAME_COLOURS[1]);
  assert.equal(nameTagLineColour(0, "#2979ff"), "#2979ff");
  assert.equal(nameTagLineColour(1, "#2979ff"), "#2979ff");
  assert.notEqual(nameTagPaintKey(["Driver", "Truck"], "#2979ff"), nameTagPaintKey(["Driver", "Truck"], "#e8231c"));
});

test("a name tag's line can be coloured pieces: a name and a figure in its own colour", () => {
  assert.deepEqual(linePieces("Bob"), [{ text: "Bob", color: "" }]);
  assert.deepEqual(linePieces([{ text: "Bob " }, { text: "40%", color: "#f2d22e" }]), [{ text: "Bob ", color: "" }, { text: "40%", color: "#f2d22e" }]);
  assert.notEqual(nameTagPaintKey([[{ text: "Bob " }, { text: "40%", color: "#f2d22e" }]]), nameTagPaintKey([[{ text: "Bob " }, { text: "40%", color: "#ff3b30" }]]));
});
