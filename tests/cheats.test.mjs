import test from "node:test";
import assert from "node:assert/strict";
import { cheatTyped, typeKey } from "../src/game/cheats.js";

test("cheats: the last 8 letters typed are compared with each code", () => {
  let typed = "";
  for (const code of ["KeyX", "KeyG", "KeyO", "KeyL"]) typed = typeKey(typed, code);
  assert.equal(cheatTyped(typed), null);
  typed = typeKey(typed, "KeyD");
  assert.equal(cheatTyped(typed), "GOLD");
  for (const code of "ABCDEFGHIJ".split("")) typed = typeKey(typed, `Key${code}`);
  assert.equal(typed.length, 8);
  assert.equal(typeKey("AB", "ArrowUp"), "AB", "non-letters are not typed");
  for (const code of ["KeyF", "KeyR", "KeyA", "KeyM", "KeyE"]) typed = typeKey(typed, code);
  assert.equal(cheatTyped(typed), "FRAME");
});
