import test from "node:test";
import assert from "node:assert/strict";
import { createStrings, locName } from "../src/game/strings.js";
import { parseLoc } from "../src/vendor/openphotex/index.js";
import { skipWithoutStock, stockVfs } from "./helpers/stock.mjs";

test("strings: the tag shows without a table, a table swaps it, arguments fill <<n>>", () => {
  const plain = createStrings();
  assert.equal(plain("Lap:"), "Lap:");
  assert.equal(plain("<<1>> says \"<<2>>\"", "Mark", "hi"), "Mark says \"hi\"");
  const t = createStrings([{ tag: "Lap:", text: "Aplay:" }, { tag: "Lap:", text: "later duplicates lose" }]);
  assert.equal(t("Lap:"), "Aplay:");
  assert.equal(t("Best:"), "Best:");
});

test("strings: names for the LOC files", () => {
  assert.equal(locName("UI\\MTM2-PIG.LOC"), "Pig Latin");
  assert.equal(locName("UI/mtm2-fun.loc"), "Fun");
  assert.equal(locName("UI\\SPANISH.LOC"), "SPANISH");
});

test("the stock Pig Latin table rewords the HUD labels and keeps unknown tags", { skip: skipWithoutStock("POD.INI") }, async () => {
  const t = createStrings(parseLoc(await stockVfs().read("UI\\MTM2-PIG.LOC")));
  assert.equal(t("Lap:"), "Aplay:");
  assert.equal(t("Clock:"), "Ockclay:");
  assert.equal(t("Determining times for remaining trucks..."), "Determining times for remaining trucks...");
});
