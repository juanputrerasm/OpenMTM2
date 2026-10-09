import test from "node:test";
import assert from "node:assert/strict";
import { classicUiAllowed, readExeVersion } from "../src/install/exe-version.js";

const utf16 = (s) => Uint8Array.from([...s].flatMap((c) => [c.charCodeAt(0), 0]));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

test("the FileVersion string of the retail build reads 2.00.42", () => {
  const bytes = concat(new Uint8Array(40), utf16("FileVersion"), new Uint8Array(4), utf16("2.00.42"), new Uint8Array(4));
  assert.equal(readExeVersion(bytes), "2.00.42");
  assert.equal(classicUiAllowed("2.00.42"), true);
});

test("without the string the fixed file info is read", () => {
  const info = new Uint8Array(16);
  const view = new DataView(info.buffer);
  view.setUint32(0, 0xfeef04bd, true); view.setUint32(4, 0x10000, true); view.setUint32(8, 0x20000, true); view.setUint32(12, 0x2a0000, true);
  assert.equal(readExeVersion(concat(new Uint8Array(8), info)), "2.00.42");
});

test("other builds and unknown ones do not get the classic skin", () => {
  assert.equal(classicUiAllowed("2.00.41"), true);
  assert.equal(classicUiAllowed("2.00.43"), false);
  assert.equal(classicUiAllowed("3.00.00"), false);
  assert.equal(classicUiAllowed(null), false);
  assert.equal(readExeVersion(new Uint8Array(100)), null);
});
