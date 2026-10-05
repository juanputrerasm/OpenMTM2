import test from "node:test";
import assert from "node:assert/strict";
import { asciiStrings, commentaryLines } from "../src/worker/exe-strings.js";
import { PHRASES } from "../src/game/commentary.js";
import { readStock, skipWithoutStock } from "./helpers/stock.mjs";

const bytes = (...strings) => new TextEncoder().encode(strings.map((s) => `${s}\0`).join("\0"));

test("exe strings: a clip script followed by its line is a phrase; two scripts in a row are not", () => {
  const data = bytes("airhorn.wav", "check2.wav", "(<<1>> crown.wav", "<<1>> takes the monster crown.", "whobe.wav", "Who's it gonna be?", "sound%03d.txt");
  assert.deepEqual(asciiStrings(new Uint8Array([65, 66, 67, 68, 0, 1, 66, 0])), ["ABCD"]);
  assert.deepEqual(commentaryLines(data), {
    "(<<1>> crown.wav": "<<1>> takes the monster crown.",
    "whobe.wav": "Who's it gonna be?",
  });
});

test("the stock MONSTER.EXE gives a line for nearly every phrase in the table", { skip: skipWithoutStock("MONSTER.EXE") }, () => {
  const lines = commentaryLines(readStock("MONSTER.EXE"));
  const specs = Object.values(PHRASES).flat();
  const missing = specs.filter((s) => !(s in lines));
  assert.ok(missing.length <= 3, `no line for: ${missing.join(" | ")}`);
  assert.equal(lines["(<<1>> crown.wav"], "<<1>> takes the monster crown.");
  assert.equal(lines["whobe.wav"], "Who's it gonna be?");
});
