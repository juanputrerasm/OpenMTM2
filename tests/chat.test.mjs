// Chat in a network race (src/game/chat.js): settings, the feed, commands, channels and the gamepad wheel.

import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_RUN, QUICK_MESSAGES, chatChannels, chatSettings, chatShown, feedAdd, feedLive, feedOpacity, isMuted, nextChannel,
  parseChat, setMuted, wheelSlot,
} from "../src/game/chat.js";

test("chat settings: defaults, the game's old on and off, ranges kept", () => {
  assert.deepEqual(chatSettings(undefined), { mode: "all", lines: 6, fadeS: 8, muted: [] });
  assert.equal(chatSettings({ chat: false }).mode, "off");
  assert.equal(chatSettings({ chat: true }).mode, "all");
  assert.equal(chatSettings({ chat: "team" }).mode, "team");
  assert.equal(chatSettings({ chat: "loud" }).mode, "all");
  assert.equal(chatSettings({ chatLines: 40 }).lines, 10);
  assert.equal(chatSettings({ chatFadeS: 1 }).fadeS, 4);
  assert.deepEqual(chatSettings({ muted: ["Rex", 4, " "] }).muted, ["Rex"]);
});

test("muting is by name, any case, each name once", () => {
  let muted = setMuted([], "Rex", true);
  muted = setMuted(muted, "rex ", true);
  assert.deepEqual(muted, ["rex"]);
  assert.equal(isMuted(muted, "REX"), true);
  assert.deepEqual(setMuted(muted, "Rex", false), []);
});

test("what each chat mode shows over the race", () => {
  const say = { name: "Rex", text: "hi" }, team = { ...say, team: true }, whisper = { ...say, private: true }, notice = { text: "x", notice: true };
  assert.deepEqual([say, team, whisper, notice].map((l) => chatShown(l, "all")), [true, true, true, true]);
  assert.deepEqual([say, team, whisper, notice].map((l) => chatShown(l, "team")), [false, true, true, true]);
  assert.deepEqual([say, team, whisper, notice].map((l) => chatShown(l, "off")), [false, false, false, false]);
});

test("the feed: repeats count up, one sender's run is held, the oldest go, lines fade", () => {
  const line = (from, text) => ({ from, name: `P${from}`, text });
  let feed = [];
  feed = feedAdd(feed, line(1, "gg"), 0);
  feed = feedAdd(feed, line(1, "gg"), 100);
  feed = feedAdd(feed, line(1, "gg"), 200);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].count, 3);
  assert.equal(feed[0].at, 200, "a repeat keeps the line up");
  for (let i = 0; i < 5; i++) feed = feedAdd(feed, line(2, `spam ${i}`), 300 + i);
  assert.equal(feed.filter((item) => item.line.from === 2).length, CHAT_RUN);
  assert.equal(feed.at(-1).line.text, "spam 4");
  for (let i = 0; i < 8; i++) feed = feedAdd(feed, line(3 + i, "hi"), 400 + i);
  assert.equal(feed.length, 6);
  const item = { at: 0 };
  assert.equal(feedOpacity(item, 7000, 8), 1);
  assert.equal(feedOpacity(item, 7500, 8), 0.5);
  assert.deepEqual(feedLive([item, { at: 5000 }], 8000, 8), [{ at: 5000 }]);
});

test("typed commands: whisper to the longest name that fits, reply, team, mute, help", () => {
  const names = ["Rex", "Rex Junior", "Mud Dog"];
  assert.deepEqual(parseChat("hello"), { kind: "say", text: "hello" });
  assert.deepEqual(parseChat("//slash"), { kind: "say", text: "/slash" });
  assert.deepEqual(parseChat("/w Rex Junior nice jump", names), { kind: "whisper", name: "Rex Junior", text: "nice jump" });
  assert.deepEqual(parseChat("/w rex hi", names), { kind: "whisper", name: "Rex", text: "hi" });
  assert.deepEqual(parseChat("/w Nobody hi", names), { kind: "noPlayer", text: "Nobody" });
  assert.deepEqual(parseChat("/w Rex", names), { kind: "usage", command: "w" });
  assert.deepEqual(parseChat("/r ok"), { kind: "reply", text: "ok" });
  assert.deepEqual(parseChat("/t go left"), { kind: "team", text: "go left" });
  assert.deepEqual(parseChat("/all gg"), { kind: "say", text: "gg" });
  assert.deepEqual(parseChat("/mute mud dog", names), { kind: "mute", name: "Mud Dog" });
  assert.deepEqual(parseChat("/unmute Gone", names), { kind: "unmute", name: "Gone" });
  assert.deepEqual(parseChat("/help"), { kind: "help" });
  assert.deepEqual(parseChat("/dance"), { kind: "unknown", name: "dance" });
});

test("channels: all, then team and reply when there are such", () => {
  assert.deepEqual(chatChannels(), ["all"]);
  const both = chatChannels({ team: true, reply: true });
  assert.deepEqual(both, ["all", "team", "reply"]);
  assert.equal(nextChannel("all", both), "team");
  assert.equal(nextChannel("reply", both), "all");
  assert.equal(nextChannel("team", ["all"]), "all");
});

test("the quick-message wheel: the stick's way, clockwise from the top, nothing at rest", () => {
  assert.equal(wheelSlot(0, 0), -1);
  assert.equal(wheelSlot(0.2, -0.2), -1);
  assert.equal(wheelSlot(0, -1), 0);
  assert.equal(wheelSlot(1, 0), 2);
  assert.equal(wheelSlot(0, 1), 4);
  assert.equal(wheelSlot(-1, 0), 6);
  assert.equal(wheelSlot(-0.7, -0.7), 7);
  assert.equal(QUICK_MESSAGES.length, 8);
});
