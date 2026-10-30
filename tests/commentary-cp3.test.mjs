/*
  Community Patch 3's announcer (docs/CP3_EXE_ANALYSIS.md 4; game/commentary.js, game/commentary-events.js): its
  larger bags, shorter pauses and new calls, behind Options, Advanced, "CP3 voice commentary".
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  CP3_GROUPS, CP3_PHRASES, CP3_SILENCE_SCALE, GROUPS, NUMBER_CLIPS, PHRASES, commentaryTables, createCommentaryQueue,
  createPhrasePicker, parseSpec,
} from "../src/game/commentary.js";
import { createCommentaryWatcher, cp3IntroGroup } from "../src/game/commentary-events.js";
import { createCommentaryAudio, phraseClips } from "../src/audio/commentary-audio.js";
import { DEFAULT_SETTINGS } from "../src/app/settings.js";

const groups = (out) => out.map((e) => e.group);

test("off by default; retail's tables stand when it is off", () => {
  assert.equal(DEFAULT_SETTINGS.cp3Commentary, false);
  const retail = commentaryTables();
  assert.equal(retail.phrases, PHRASES);
  assert.equal(retail.groups, GROUPS);
  assert.equal(retail.silenceScale, 1);
  const cp3 = commentaryTables({ cp3: true });
  assert.equal(cp3.phrases, CP3_PHRASES);
  assert.equal(cp3.groups, CP3_GROUPS);
  assert.equal(cp3.silenceScale, 0.6);
});

test("CP3's bags keep every retail line and reach the sizes the EXE lists", () => {
  for (const [group, lines] of Object.entries(PHRASES)) {
    const scripts = new Set(CP3_PHRASES[group].map((p) => p.script));
    for (const p of lines) assert.ok(scripts.has(p.script), `${group} keeps ${p.script}`);
  }
  const sizes = { introRace: 17, introSummit: 13, move: 8, pass: 10, clash: 28, flipped: 18, finishWinner: 11, missedCheckpoint: 3, spin: 3, blimp: 3 };
  for (const [group, n] of Object.entries(sizes)) assert.equal(CP3_PHRASES[group].length, n, group);
  for (const group of Object.keys(CP3_PHRASES)) assert.ok(CP3_GROUPS[group], `${group} has figures`);
});

test("CP3's figures: the winner waits 8 s, the new calls as traced", () => {
  assert.deepEqual(CP3_GROUPS.finishWinner, { priority: 0, silence: 0, life: 8 });
  assert.deepEqual(CP3_GROUPS.finalLap, { priority: 3, silence: 0.5, life: 8 });
  assert.deepEqual(CP3_GROUPS.summitHold, { priority: 16, silence: 14, life: 3 });
  assert.deepEqual(CP3_GROUPS.dragRedLight, { priority: 1, silence: 0, life: 8 });
  assert.equal(CP3_GROUPS.move, GROUPS.move, "unchanged groups keep retail's figures");
});

test("a queued phrase under CP3 is said once 60% of its silence is kept; retail's waits for all of it", () => {
  const retail = createCommentaryQueue();
  for (let i = 0; i < 10; i++) retail.tick(0.25, false);
  retail.add("pass", [1, 2]);
  assert.equal(retail.tick(0.5, false), null);
  assert.equal(retail.tick(0.75, false), null, "3.75 s quiet of 6: not under retail");
  assert.equal(CP3_SILENCE_SCALE, 0.6);
  const q = createCommentaryQueue({ groups: CP3_GROUPS, silenceScale: CP3_SILENCE_SCALE });
  for (let i = 0; i < 10; i++) q.tick(0.25, false); // 2.5 s quiet already
  q.add("pass", [1, 2]); // silence 6 s, 3.6 s under CP3; life 2.5 s
  assert.equal(q.tick(0.5, false), null, "3 s quiet: not yet");
  assert.equal(q.tick(0.75, false)?.group, "pass", "3.75 s quiet: said");
});

test("a bare <<n>> is a number, said with CP3's number clips", () => {
  assert.deepEqual(parseSpec("(<<1>> STAGE5.WAV <<2>> SECONDS.WAV"), [
    { kind: "name", variant: "(", arg: 1 }, { kind: "wav", name: "STAGE5.WAV" }, { kind: "number", arg: 2 }, { kind: "wav", name: "SECONDS.WAV" },
  ]);
  assert.equal(NUMBER_CLIPS[17], "SEVENTEE.WAV");
  const picker = createPhrasePicker(() => 0, CP3_PHRASES);
  const phrase = picker.pick("dragPrestageTime", { args: [1], numbers: { 2: 20 } });
  assert.deepEqual(phrase.numbers, { 2: 20 });
  assert.deepEqual(phraseClips(phrase, [{ waves: ["bf1", "bf2", "bf3"] }]), ["bf2", "STAGE5.WAV", "TWENTY.WAV", "SECONDS.WAV", "STAGE6.WAV"]);
});

test("CP3's intro: Summit's own, Snake Canyon's, then the weather's, else the race's", () => {
  const always = () => 0.9, never = () => 0.1;
  assert.equal(cp3IntroGroup({ summit: true, random: always }), "introSummit");
  assert.equal(cp3IntroGroup({ sit: "SNAKE.SIT", random: always }), "introSnake");
  assert.equal(cp3IntroGroup({ sit: "SNAKE.SIT", random: never }), "introRace");
  assert.equal(cp3IntroGroup({ weather: 7, random: always }), "introNight");
  assert.equal(cp3IntroGroup({ weather: 5, random: always }), "introSnow");
  assert.equal(cp3IntroGroup({ weather: 2, random: always }), "introFog");
  assert.equal(cp3IntroGroup({ weather: 0, random: always }), "introRace");
  // Night, the second coin lost: not the snow lines (not Snow), so the fog lines.
  let n = 0;
  assert.equal(cp3IntroGroup({ weather: 8, random: () => (n++ === 0 ? 0.9 : 0.1) }), "introFog");
});

// The watcher's frames, as in commentary-events.test.mjs.
const tire = (onGround = true, surface = 200) => ({ onGround, surface });
const truck = (pos = [0, 0, 0], sound = {}) => ({
  pos, up: 1, forwardY: 0,
  sound: { airborne: 0, clearance: 6, collide: 0, hit: null, heli: false, speed: 40, tires: [tire(), tire(), tire(), tire()], ...sound },
});
const frame = (now, rts, { sound = [], race = {}, ...rest } = {}) => ({
  now, watched: 0, checkpoints: 8, weather: 0, lamps: rts.map(() => 2), ...rest,
  race: { started: now >= 3, laps: 3, ...race, trucks: rts.map((rt, i) => ({ place: i + 1, finished: false, missed: false, laps: 0, checkpoint: 2, ...rt })) },
  trucks: rts.map((_, i) => truck([200 * i, 0, 0], sound[i])),
});

test("the final lap: the player starting the last lap of a race of more than one, under CP3 only", () => {
  const w = createCommentaryWatcher({ drivers: 2, cp3: true, random: () => 0.1 });
  w.update(frame(0.5, [{}, {}]));
  w.update(frame(3.1, [{ laps: 1 }, {}]));
  assert.deepEqual(groups(w.update(frame(60, [{ laps: 2 }, {}]))), ["finalLap"]);
  assert.deepEqual(groups(w.update(frame(61, [{ laps: 2 }, {}]))), []);
  const retail = createCommentaryWatcher({ drivers: 2 });
  retail.update(frame(0.5, [{}, {}]));
  retail.update(frame(3.1, [{ laps: 1 }, {}]));
  assert.deepEqual(groups(retail.update(frame(60, [{ laps: 2 }, {}]))), []);
});

test("road signs at most every 40 s, barricades every 60 s, trains each hit", () => {
  const types = { 5: 1, 6: 2, 7: 10 };
  const w = createCommentaryWatcher({ drivers: 1, cp3: true, hitType: (i) => types[i] ?? null, random: () => 0.1 });
  const hit = (now, sitIndex) => w.update(frame(now, [{}], { sound: [{ hit: sitIndex === null ? null : { sitIndex } }] }));
  hit(0.5, null); hit(3.1, null);
  assert.deepEqual(groups(hit(10, 5)), ["sign"]);
  hit(11, null);
  assert.deepEqual(groups(hit(30, 5)), [], "a sign within 40 s");
  hit(31, null);
  assert.deepEqual(groups(hit(51, 5)), ["sign"]);
  assert.deepEqual(groups(hit(52, 6)), ["barricade"]);
  assert.deepEqual(groups(hit(53, 7)), ["train"]);
  hit(54, null);
  assert.deepEqual(groups(hit(55, 7)), ["train"]);
});

test("the Summit Rumble: points on top every tenth time, knocked off, stepping out, a new leader", () => {
  const w = createCommentaryWatcher({ drivers: 2, summit: true, cp3: true, random: () => 0.1 });
  const at = (now, states, scores) => w.update(frame(now, scores.map((score) => ({ score })), { race: { summit: { states } } }));
  at(0.5, [0, 0], [0, 0]);
  at(3.1, [0, 0], [0, 0]);
  const said = [];
  for (let k = 1; k <= 10; k++) said.push(...groups(at(3.1 + k, [2, 0], [k * 5, 0])));
  assert.deepEqual(said, ["summitLeader", "summitHold"]);
  assert.deepEqual(groups(at(20, [1, 0], [50, 0])), ["summitOut"]);
  assert.deepEqual(groups(at(21, [0, 2], [40, 5])), ["summitKnocked"]);
  assert.deepEqual(groups(at(30, [0, 2], [40, 45])), ["summitLeader"]);
});

test("a drag pass: nothing without CP3; with it the staging, the countdowns, the red light, the lines and the winner", () => {
  const dragFrame = (now, phase, phaseTime, lamps, rts, started = false) => ({
    ...frame(now, rts), race: {
      started, laps: 1, drag: { phase, phaseTime, lamps }, trucks: rts.map((rt, i) => ({ place: i + 1, finished: false, laps: 0, dq: null, dqLine: null, reaction: null, ...rt })),
    },
  });
  assert.deepEqual(createCommentaryWatcher({ drivers: 2, drag: true }).update(dragFrame(1, "prestage", 1, [0, 0], [{}, {}])), []);
  const w = createCommentaryWatcher({ drivers: 2, drag: true, cp3: true, weekend: true });
  assert.deepEqual(groups(w.update(dragFrame(1, "prestage", 1, [0, 1], [{}, {}]))), ["dragPrestaged"]);
  const count = w.update(dragFrame(11, "prestage", 10, [0, 1], [{}, {}]));
  assert.deepEqual(count.map((e) => [e.group, e.args, e.ctx.numbers]), [["dragPrestageTime", [1], { 2: 20 }]]);
  assert.deepEqual(groups(w.update(dragFrame(12, "prestage", 11, [0, 1], [{}, {}]))), []);
  assert.deepEqual(groups(w.update(dragFrame(21, "prestage", 20, [0, 1], [{}, {}]))), ["dragPrestageTime"]);
  assert.deepEqual(groups(w.update(dragFrame(22, "stage", 0, [1, 1], [{}, {}]))), ["dragPrestaged"]);
  assert.deepEqual(groups(w.update(dragFrame(32, "stage", 10, [3, 1], [{}, {}]))), ["dragStaged", "dragStageTime"]);
  assert.deepEqual(groups(w.update(dragFrame(33, "go", 0, [3, 3], [{}, { dq: "red light" }], true))), ["go", "dragStaged", "dragRedLight"]);
});

test("a drag pass's lines out, the jump and the heat's winner", () => {
  const rows = (rts) => rts.map((rt, i) => ({ place: i + 1, finished: false, laps: 0, dq: null, dqLine: null, reaction: null, ...rt }));
  const at = (w, now, rts) => w.update({ ...frame(now, rts), race: { started: true, laps: 1, drag: { phase: "go", phaseTime: 1, lamps: [0, 0] }, trucks: rows(rts) } });
  const w = createCommentaryWatcher({ drivers: 2, drag: true, cp3: true, weekend: true });
  assert.deepEqual(groups(at(w, 1, [{}, {}])), ["go"]);
  const jump = at(w, 2, [{ reaction: 0.4 }, { reaction: 0.2 }]);
  assert.deepEqual(jump.map((e) => [e.group, e.args]), [["dragJump", [2, 1]]]);
  assert.deepEqual(groups(at(w, 3, [{ reaction: 0.4 }, { reaction: 0.2, dq: "out of lane", dqLine: "edge" }])), ["dragOutsideEdge"]);
  assert.deepEqual(groups(at(w, 9, [{ reaction: 0.4, finished: true }, { reaction: 0.2, dq: "out of lane", dqLine: "edge", place: 2 }])), ["dragHeatWinner"]);
  const v = createCommentaryWatcher({ drivers: 2, drag: true, cp3: true });
  at(v, 1, [{}, {}]);
  assert.deepEqual(groups(at(v, 2, [{ dq: "out of lane", dqLine: "centre" }, { dq: "reversing" }])), ["dragCentreLine", "dragReversing"]);
  assert.deepEqual(groups(at(v, 3, [{ dq: "out of lane", dqLine: "centre", place: 2 }, { dq: "reversing", finished: true, place: 1 }])), [], "a truck that is out does not win");
});

test("CP3's announcer leaves out a phrase missing a clip; retail's says what it has", async () => {
  const played = [];
  const clip = { numberOfChannels: 1, length: 10, sampleRate: 22050, getChannelData: () => new Float32Array(10) };
  const audio = {
    context: { createBuffer: (channels, length, rate) => ({ numberOfChannels: channels, length, sampleRate: rate, getChannelData: () => new Float32Array(length) }) },
    sample: async (name) => (name === "STAGE3.WAV" ? null : { buffer: clip }),
    playBuffer(buffer) { played.push(buffer.length); return { done: Promise.resolve(), stop() {} }; },
  };
  const drivers = [{ waves: ["a", "b", "c"] }];
  await createCommentaryAudio(audio, { drivers, whole: true }).speak({ script: "(<<1>> STAGE3.WAV", args: [1] });
  assert.deepEqual(played, []);
  await createCommentaryAudio(audio, { drivers }).speak({ script: "(<<1>> STAGE3.WAV", args: [1] });
  assert.deepEqual(played, [10]);
});
