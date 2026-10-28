import { test } from "node:test";
import assert from "node:assert/strict";
import { CREDITS_BOX, CREDITS_DELAY_MS, CREDITS_SPEED, aboutText, creditsDone, creditsOffset, installedVersionText, originalLegalLines } from "../src/game/about.js";
import { AUTHOR, openmtm2Credits } from "../src/app/credits.js";
import { createStrings } from "../src/game/strings.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

const t = createStrings();
// The shape of the retail UI\LEGAL.TXT: the product and version lines, then the copyright paragraphs.
const LEGAL = "Microsoft\xae Monster Truck Madness\x99 2\r\nVersion <<1>> MMX\r\n\r\nCopyright \xa9 & (p) 1998 Microsoft Corporation. All rights reserved.\r\n\r\n"
  + "Copyright \xa9 1998 Terminal Reality Inc. All rights reserved.\r\n\r\nWarning: protected by copyright law.\r\n";

test("about: the credits box and roll speed are the game's (MONSTER_EXE_ANALYSIS.md 1, About screen)", () => {
  assert.deepEqual({ ...CREDITS_BOX }, { x: 384, y: 127, height: 254 });
  assert.equal(CREDITS_SPEED, 24);
  assert.equal(CREDITS_DELAY_MS, 500);
});

test("about: the roll waits 500 ms, then moves 24 px a second", () => {
  assert.equal(creditsOffset(0), 0);
  assert.equal(creditsOffset(500), 0);
  assert.equal(creditsOffset(1500), 24);
  assert.equal(creditsOffset(10500), 240);
});

test("about: the screen leaves once the roll's last box height is in the box", () => {
  assert.equal(creditsDone(0, 1000), false);
  assert.equal(creditsDone(745, 1000), false);
  assert.equal(creditsDone(746, 1000), true);
});

test("about: the installed build is named as Monster Truck Madness 2 with its version", () => {
  assert.equal(installedVersionText(t, "2.00.42"), "Monster Truck Madness 2, Version 2.00.42");
  assert.equal(installedVersionText(t, "2.00.52"), "Monster Truck Madness 2, Version 2.00.52 (community patch)");
  assert.equal(installedVersionText(t, "2.00.30"), "Monster Truck Madness 2, Version 2.00.30 (beta)");
  assert.equal(installedVersionText(t, null), "Monster Truck Madness 2, version unknown");
});

test("about: the original legal text loses its product and MMX version lines, keeps the copyrights", () => {
  const lines = originalLegalLines(LEGAL);
  assert.equal(lines[0], "Copyright \xa9 & (p) 1998 Microsoft Corporation. All rights reserved.");
  assert.ok(lines.includes("Copyright \xa9 1998 Terminal Reality Inc. All rights reserved."));
  assert.ok(!lines.some((line) => line.includes("MMX") || line.includes("<<1>>") || /Madness\x99 2$/.test(line)));
  assert.deepEqual(originalLegalLines(null), []);
});

test("about: the text names OpenMTM2 and its version first, then the installed game", () => {
  const about = aboutText(t, { openmtm2Version: "0.6.2", exeVersion: "2.00.42", legalRaw: LEGAL });
  assert.equal(about.text[0], "OpenMTM2 0.6.2");
  assert.equal(about.text[1], "Installed version: Monster Truck Madness 2, Version 2.00.42");
  assert.deepEqual(about.pairs[0], ["OpenMTM2", "Version 0.6.2"]);
  assert.deepEqual(about.pairs[1], ["Installed version:", "Monster Truck Madness 2, Version 2.00.42"]);
  assert.ok(about.text.includes("Original game"));
  assert.ok(!about.text.some((line) => line.includes("MMX")));
  // No legal text in the install: OpenMTM2's lines alone.
  assert.ok(!aboutText(t, { openmtm2Version: "0.6.2", exeVersion: null, legalRaw: null }).text.includes("Original game"));
});

test("about: OpenMTM2's credits come first, in their own words", () => {
  assert.deepEqual(openmtm2Credits(t).map((line) => line.text), [
    "OpenMTM2", "Open source web implementation of MTM2", "",
    "Developed by", `${AUTHOR} & collaborators`, "",
    "Special thanks to Loren Burkholder for enhanced graphics.", "",
    "Built on OpenPhotex technology.",
  ]);
  assert.equal(AUTHOR, "Juan Pablo Utreras");
});

test("about: the install has the About art, the credits strip and the legal text", { skip: skipWithoutStock() }, async () => {
  const vfs = stockVfs();
  assert.ok((await vfs.read("UI\\ABOUT.BMP")) || (await vfs.read("UI\\ABOUT480.BMP")));
  assert.ok(await vfs.read("UI\\CREDLIST.BMP"));
  assert.ok(await vfs.read("UI\\LEGAL.TXT"));
});
