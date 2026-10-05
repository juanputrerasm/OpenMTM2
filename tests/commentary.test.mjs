import test from "node:test";
import assert from "node:assert/strict";
import { PHRASES, createAnnouncer, createBag, nameClip, parseSpec, phraseText, specArgs, textSeconds } from "../src/game/commentary.js";

test("a phrase script: plain clips and driver names in three voices", () => {
  assert.deepEqual(parseSpec("(<<1>> pull.wav *<<2>> allway.wav"), [
    { kind: "name", variant: "(", arg: 1 }, { kind: "wav", name: "pull.wav" },
    { kind: "name", variant: "*", arg: 2 }, { kind: "wav", name: "allway.wav" },
  ]);
  assert.deepEqual(parseSpec("terr_04a.wav *<<1>>, terr_04b.wav").map((t) => t.kind), ["wav", "name", "wav"]);
  assert.deepEqual(parseSpec("win_02.wav )<<1>>")[1], { kind: "name", variant: ")", arg: 1 });
  assert.deepEqual(specArgs("(<<1>> pass_13.wav )<<2>>"), [1, 2]);
  assert.deepEqual(specArgs("whobe.wav"), []);
  // The truck's three wave files, in the order the .TRK lists them.
  const waves = ["bfootf.wav", "bfootu.wav", "bfootd.wav"];
  assert.equal(nameClip(waves, "*"), "bfootf.wav");
  assert.equal(nameClip(waves, "("), "bfootu.wav");
  assert.equal(nameClip(waves, ")"), "bfootd.wav");
  assert.equal(nameClip(null, "("), null);
});

test("every phrase in the table parses, and names at most two drivers", () => {
  for (const [group, list] of Object.entries(PHRASES)) {
    for (const spec of list) {
      const tokens = parseSpec(spec);
      assert.ok(tokens.length > 0 && tokens.some((t) => t.kind === "wav"), `${group}: ${spec}`);
      assert.ok(specArgs(spec).every((n) => n === 1 || n === 2), `${group}: ${spec}`);
    }
  }
});

test("a shuffle bag plays everything once before repeating, and never the same twice in a row", () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const next = createBag(["a", "b", "c", "d"], random);
  let last = null;
  for (let round = 0; round < 20; round++) {
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      const item = next();
      assert.notEqual(item, last);
      last = item;
      seen.add(item);
    }
    assert.equal(seen.size, 4);
  }
});

test("the announcer waits for a phrase to end, keeps a group quiet for a while, lets important ones through", () => {
  const a = createAnnouncer({ random: () => 0, gap: 3, groupGap: 14 });
  const first = a.say("pass", [4, 2], 10);
  assert.ok(first && first.group === "pass");
  assert.equal(a.say("wipeout", [1], 11), null, "still speaking");
  a.finished(12);
  assert.equal(a.say("pass", [4, 2], 13), null, "that group spoke less than 14 s ago");
  assert.equal(a.say("wipeout", [1], 13), null, "an equal priority too soon after the last");
  assert.ok(a.say("wipeout", [1], 15.5), "after the gap");
  a.finished(16);
  assert.ok(a.say("finishWinner", [3, 3], 16.5, { priority: 5 }), "a more important phrase goes through");
  a.finished(17);
  assert.equal(a.say("pass", [4, 2], 40) !== null, true, "much later the group may speak again");
  assert.throws(() => a.say("nonsense", [], 0), /Unknown/);
});

test("a phrase that names a driver nobody is named for is not said; text takes the names", () => {
  const a = createAnnouncer({ random: () => 0 });
  // The first of the 'move' bag with random 0 may or may not need a name; with none given it must not fail.
  const said = a.say("hasWon", [], 0);
  assert.equal(said, null);
  assert.equal(phraseText("<<1>> inches past <<2>>.", ["Mark", "Greg"]), "Mark inches past Greg.");
  assert.equal(phraseText("Get Ready!", []), "Get Ready!");
  assert.ok(Math.abs(textSeconds("x".repeat(32)) - 2) < 1e-9);
});
