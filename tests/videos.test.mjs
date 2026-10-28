/*
  The game's videos (game/videos.js, MONSTER_EXE_ANALYSIS.md 5, "Results"): EXTRAS.INI's [Video] lists, and which list a
  race's video comes from.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { videoPath, parseVideoLists, pickVideo, raceVideoKey } from "../src/game/videos.js";

const INI = `[Video]\r\nStartScene=2\r\nStartScene0=Videos\\MSLogo.smk\r\nStartScene1=Videos\\TRI.smk\r\nStartScene2=Videos\\Open.smk\r\n
Demo=0\r\nDemo0=Videos\\Open.smk\r\nWin=2\r\nWin0=Videos\\Win\\win01.smk\r\nWin1=Videos\\Win\\win03.smk\r\n
LoseWCW0=Videos\\LoseWCW\\lose11.smk\r\nLoseWCW1=Videos\\LoseWCW\\lose17.smk\r\n[Other]\r\nWin0=nope.smk\r\n`;

test("EXTRAS.INI's lists: as many as the count says, or the numbered keys while they last", () => {
  const lists = parseVideoLists(INI);
  assert.deepEqual(lists.StartScene, ["VIDEOS/MSLOGO.SMK", "VIDEOS/TRI.SMK"], "the count is 2: the third is not played");
  assert.deepEqual(lists.Win, ["VIDEOS/WIN/WIN01.SMK", "VIDEOS/WIN/WIN03.SMK"]);
  assert.deepEqual(lists.LoseWCW, ["VIDEOS/LOSEWCW/LOSE11.SMK", "VIDEOS/LOSEWCW/LOSE17.SMK"], "no count: keys from 0 while there");
  assert.equal(lists.Demo, undefined, "a count of 0 is no list");
  assert.equal(videoPath(".\\Videos\\x.smk"), "VIDEOS/X.SMK");
});

test("a race's video: Win first, Lose last, Other between; the WCW lists after a Summit Rumble", () => {
  assert.equal(raceVideoKey(1, 8), "Win");
  assert.equal(raceVideoKey(8, 8), "Lose");
  assert.equal(raceVideoKey(4, 8), "Other");
  assert.equal(raceVideoKey(1, 4, true), "WinWCW");
  assert.equal(raceVideoKey(2, 2, true), "LoseWCW");
  const lists = parseVideoLists(INI);
  assert.equal(pickVideo(lists, "Win", (p) => p.endsWith("WIN03.SMK"), () => 0), "VIDEOS/WIN/WIN03.SMK", "only videos the install has");
  assert.equal(pickVideo(lists, "Other"), null);
});
