/*
  The announcer (game/commentary.js) as MONSTER_EXE_ANALYSIS.md 12, "Commentary (Trucksfx.c)", has it: the phrase table
  with its lines, the queue (0x4213a0), the shuffle bags (0x421ef0) and the lines said only with the camera's truck in
  them; and the phrase as one joined sound (audio/commentary-audio.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUPS, PHRASES, QUEUE_SLOTS, createBag, createCommentaryQueue, createPhrasePicker, nameClip, parseSpec, phraseText, specArgs, textSeconds,
} from "../src/game/commentary.js";
import { joinClips, phraseClips } from "../src/audio/commentary-audio.js";

test("a phrase script: plain clips and driver names in three voices", () => {
  assert.deepEqual(parseSpec("(<<1>> pull.wav *<<2>> allway.wav"), [
    { kind: "name", variant: "(", arg: 1 }, { kind: "wav", name: "pull.wav" },
    { kind: "name", variant: "*", arg: 2 }, { kind: "wav", name: "allway.wav" },
  ]);
  assert.deepEqual(parseSpec("terr_04a.wav *<<1>>, terr_04b.wav").map((t) => t.kind), ["wav", "name", "wav"]);
  assert.deepEqual(specArgs("(<<1>> pass_13.wav )<<2>>"), [1, 2]);
  const waves = ["bfootf.wav", "bfootu.wav", "bfootd.wav"];
  assert.equal(nameClip(waves, "*"), "bfootf.wav");
  assert.equal(nameClip(waves, "("), "bfootu.wav");
  assert.equal(nameClip(waves, ")"), "bfootd.wav");
});

test("every phrase parses, has its line, and names the drivers its line names; every group has its figures", () => {
  for (const [group, list] of Object.entries(PHRASES)) {
    assert.ok(GROUPS[group], `${group} has figures`);
    for (const p of list) {
      assert.ok(parseSpec(p.script).some((t) => t.kind === "wav"), `${group}: ${p.script}`);
      if (group !== "go" && group !== "blimp") assert.ok(p.text.length > 0, `${group}: ${p.script} has a line`);
      const inText = [...p.text.matchAll(/<<(\d)>>/g)].map((m) => Number(m[1]));
      assert.ok(inText.every((n) => specArgs(p.script).includes(n)), `${group}: ${p.text}`);
    }
  }
  assert.deepEqual([GROUPS.move.priority, GROUPS.move.silence, GROUPS.move.life], [10, 6, 3]);
  assert.deepEqual([GROUPS.clash.priority, GROUPS.clash.silence, GROUPS.clash.summitSilence, GROUPS.clash.life], [4, 3, 8, 2]);
});

test("the shuffle bag never draws the one drawn last, and moves each draw to the back", () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const next = createBag(["a", "b", "c", "d"], random);
  let last = null;
  for (let k = 0; k < 200; k++) {
    const item = next();
    assert.notEqual(item, last);
    last = item;
  }
  assert.equal(createBag(["only"])(), "only");
});

test("the queue: one phrase at a time, the ready one with the lowest priority, after its silence, gone after its life", () => {
  const q = createCommentaryQueue();
  q.add("move", [1, 2]);        // priority 10, 6 s of silence
  q.add("clash", [1, 3]);       // priority 4, 3 s
  q.add("missedCheckpoint", [1]); // priority 2, 8 s
  assert.equal(q.tick(0.1, true), null, "nothing while a phrase plays");
  assert.equal(q.tick(2, false), null, "2 s of silence: none ready");
  // Lives run out: the clash's 2 s are gone, the others' 3 s are nearly.
  let got = null;
  for (let t = 0; t < 2 && !got; t += 0.1) got = q.tick(0.1, false);
  assert.equal(got, null, "the clash lived 2 s and is gone; the others need more silence than they have life");
  const r = createCommentaryQueue();
  r.add("hasFinished", [1]);   // priority 5, 2 s
  r.add("finishWinner", [2]);  // priority 0, no silence
  assert.equal(r.tick(0.05, false).group, "finishWinner");
  assert.equal(r.tick(0.05, false), null, "the next waits for its silence");
  let next = null;
  for (let t = 0; t < 2.5 && !next; t += 0.05) next = r.tick(0.05, false);
  assert.equal(next.group, "hasFinished");
  const full = createCommentaryQueue();
  for (let k = 0; k < QUEUE_SLOTS + 5; k++) full.add("air", [1]);
  assert.equal(full.size, QUEUE_SLOTS);
  assert.equal(createCommentaryQueue({ summit: true }).add("clash", [1, 2]), true);
  assert.equal(full.add("go", []), false, "the start and GO are said at once, not queued");
});

test("a line for the camera's truck alone is used up and not said otherwise; the fear line names the truck ahead", () => {
  // random 0.9: the bag walks to its end each time; random 0: it takes the first.
  const p = createPhrasePicker(() => 0);
  const first = p.pick("move", { args: [1, 4] });
  assert.equal(first.script, "(<<1>> makemove.wav");
  const fear = p.pick("move", { args: [1, 4] });
  assert.equal(fear.script, "fear.wav )<<1>>");
  assert.deepEqual(fear.args, [4], "said of the truck ahead");
  assert.equal(p.pick("move", { args: [1, 4] }), null, "whobe: the camera's truck is not in it");
  assert.equal(createPhrasePicker(() => 0).pick("air", { args: [1] }).script, "(<<1>> doingair.wav");
  const kiss = createPhrasePicker(() => 0.9);
  kiss.pick("pass", { args: [1, 2] });
  assert.equal(phraseText("<<1>> inches past <<2>>.", ["Mark", "Greg"]), "Mark inches past Greg.");
  assert.ok(Math.abs(textSeconds("x".repeat(32)) - 2) < 1e-9);
  assert.throws(() => p.pick("nonsense"), /Unknown/);
});

test("a phrase is one sound: its clips joined end to end, names from each truck's wave files", () => {
  const drivers = [{ waves: ["af.wav", "au.wav", "ad.wav"] }, { waves: ["bf.wav", "bu.wav", "bd.wav"] }];
  assert.deepEqual(phraseClips({ script: "(<<1>> pass_13.wav )<<2>>", args: [2, 1] }, drivers), ["bu.wav", "pass_13.wav", "ad.wav"]);
  const clip = (values, channels = 1) => ({
    numberOfChannels: channels, length: values.length, sampleRate: 22050, getChannelData: () => Float32Array.from(values),
  });
  const made = [];
  const make = (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const b = { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
    made.push(b);
    return b;
  };
  const joined = joinClips([clip([1, 2]), null, clip([3, 4, 5], 2)], make);
  assert.equal(joined.numberOfChannels, 2);
  assert.deepEqual([...joined.getChannelData(0)], [1, 2, 3, 4, 5]);
  assert.deepEqual([...joined.getChannelData(1)], [1, 2, 3, 4, 5], "a mono clip feeds both channels");
  assert.equal(joinClips([null], make), null);
});
