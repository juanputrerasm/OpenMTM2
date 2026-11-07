import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LOADING_BAR, LOAD_MESSAGES, barFill, raceAndSkill, raceInfoLines } from "../src/game/loading-bar.js";

test("the loading bar sits where MTM2 draws it, in 640 x 480 terms", () => {
  assert.deepEqual([LOADING_BAR.x, LOADING_BAR.y, LOADING_BAR.width, LOADING_BAR.height], [34, 416, 570, 28]);
  assert.deepEqual([...LOADING_BAR.box], [33, 415, 605, 445]);
});

test("the bar fills count / steps of its width, held to the steps", () => {
  assert.equal(barFill(0, 9), 0);
  assert.equal(barFill(9, 9), 570);
  assert.equal(barFill(8, 9), Math.floor((8 * 570) / 9));
  assert.equal(barFill(40, 30), 570);
  assert.equal(barFill(-2, 30), 0);
  assert.equal(barFill(3, 0), 0);
});

test("a race load's eight messages stop the 9-step bar one short of full", () => {
  assert.equal(LOAD_MESSAGES.length, 8);
  assert.equal(LOADING_BAR.loadSteps, 9);
  assert.equal(LOADING_BAR.finishSteps, 30);
});

test("the track build only gives the game's loading messages", () => {
  const source = readFileSync(new URL("../src/worker/track-build.js", import.meta.url), "utf8");
  const said = [...source.matchAll(/progress\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(said.length >= 6);
  for (const text of said) assert.ok(LOAD_MESSAGES.includes(text), text);
});

test("the race and skill lines over the bar are worded as the game's", () => {
  assert.deepEqual(raceAndSkill("Farm Road 29", 2), { race: "Race : Farm Road 29", skill: "Skill : Professional" });
  assert.deepEqual(raceAndSkill("", 0), { race: "", skill: "Skill : Rookie" });
  assert.equal(raceAndSkill("X", 7).skill, "");
});

test("the top left lines say the track and its type, the truck, mode, physics, AI and cameras, leaving out what is missing", () => {
  const lines = raceInfoLines({ track: "Farm Road 29", trackType: "Circuit Race", truck: "Bigfoot", mode: "Default", physics: "Monster Truck Madness 2", ai: "OMTM2", cameras: "OMTM2" });
  assert.deepEqual(lines, ["Track: Farm Road 29 (Circuit Race)", "Truck: Bigfoot", "Game mode: Default", "Physics: Monster Truck Madness 2", "Computer AI: OMTM2", "Cameras: OMTM2"]);
  assert.deepEqual(raceInfoLines({ track: "Aztec", truck: "Rex" }), ["Track: Aztec", "Truck: Rex"]);
});
