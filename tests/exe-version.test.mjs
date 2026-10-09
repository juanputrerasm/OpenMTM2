import test from "node:test";
import assert from "node:assert/strict";
import { buildKind, compareVersions, defaultSkin, readExeVersion, resolveSkin } from "../src/install/exe-version.js";

const utf16 = (s) => Uint8Array.from([...s].flatMap((c) => [c.charCodeAt(0), 0]));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

test("the FileVersion string of the retail build reads 2.00.42", () => {
  const bytes = concat(new Uint8Array(40), utf16("FileVersion"), new Uint8Array(4), utf16("2.00.42"), new Uint8Array(4));
  assert.equal(readExeVersion(bytes), "2.00.42");
  assert.equal(defaultSkin("2.00.42"), "classic");
});

test("without the string the fixed file info is read", () => {
  const info = new Uint8Array(16);
  const view = new DataView(info.buffer);
  view.setUint32(0, 0xfeef04bd, true); view.setUint32(4, 0x10000, true); view.setUint32(8, 0x20000, true); view.setUint32(12, 0x2a0000, true);
  assert.equal(readExeVersion(concat(new Uint8Array(8), info)), "2.00.42");
});

test("retail, beta and community patch builds, and the skin each starts in", () => {
  assert.equal(buildKind("2.00.41"), "retail");
  assert.equal(buildKind("2.00.42"), "retail");
  assert.equal(buildKind("2.00.40"), "beta");
  assert.equal(buildKind("2.00.52"), "patch");
  assert.equal(buildKind(null), "unknown");
  assert.ok(compareVersions("2.00.52", "2.00.42") > 0);
  assert.equal(defaultSkin("2.00.52"), "modern");
  assert.equal(defaultSkin("2.00.30"), "classic");
  assert.equal(defaultSkin(null), "classic");
  assert.equal(resolveSkin("auto", "2.00.52"), "modern");
  assert.equal(resolveSkin("classic", "2.00.52"), "classic");
  assert.equal(resolveSkin("modern", "2.00.42"), "modern");
  assert.equal(readExeVersion(new Uint8Array(100)), null);
});
