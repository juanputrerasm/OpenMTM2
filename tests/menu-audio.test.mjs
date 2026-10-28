import test from "node:test";
import assert from "node:assert/strict";
import { createMenuMusic } from "../src/audio/menu-music.js";
import { playMenuSound } from "../src/audio/menu-sounds.js";
import { createCommentaryAudio } from "../src/audio/commentary-audio.js";
import { createWorldAudio } from "../src/audio/world-audio.js";

test("menu music loops SPLASH.WAV on the music bus", async () => {
  const calls = [];
  const voice = { stop() { calls.push(["stop"]); } };
  const audio = {
    play(name, options) { calls.push([name, options]); return Promise.resolve(voice); },
  };
  const settings = { menuMusic: true, sound: { music: 0.6, muted: false } };
  const music = createMenuMusic(audio, settings);
  music.start();
  assert.deepEqual(calls[0], ["SPLASH", { loop: true, gain: 0.8, bus: "music" }]);
  music.stop();
  await Promise.resolve();
  assert.deepEqual(calls[1], ["stop"]);
});

test("menu music reloads its loop after the POD-backed sample cache changes", async () => {
  const calls = [], voices = [
    { stop() { calls.push(["stop", 1]); } },
    { stop() { calls.push(["stop", 2]); } },
  ];
  const audio = {
    play(name, options) {
      calls.push(["play", name, options]);
      return Promise.resolve(voices.shift());
    },
  };
  const music = createMenuMusic(audio, { menuMusic: true, sound: { music: 0.6, muted: false } });
  music.start();
  music.reload();
  await Promise.resolve();
  assert.deepEqual(calls, [
    ["play", "SPLASH", { loop: true, gain: 0.8, bus: "music" }],
    ["play", "SPLASH", { loop: true, gain: 0.8, bus: "music" }],
    ["stop", 1],
  ]);
});

test("ordinary and special menu sounds honor mute", () => {
  const calls = [];
  const audio = {
    resume() { calls.push("resume"); },
    play(name, options) { calls.push([name, options]); },
  };
  const settings = { sound: { muted: false } };
  playMenuSound(audio, settings, "CONOPTUP");
  playMenuSound(audio, settings, "TRACK", 0.7);
  settings.sound.muted = true;
  playMenuSound(audio, settings, "GOOFF");
  assert.deepEqual(calls, [
    "resume", ["CONOPTUP", { gain: 0.6 }],
    "resume", ["TRACK", { gain: 0.7 }],
  ]);
});

test("a phrase plays as one sound: its clips joined, on the commentary bus at 0.7, the race ducked", async () => {
  const calls = [];
  const clip = (n) => ({ numberOfChannels: 1, length: n, sampleRate: 22050, getChannelData: () => new Float32Array(n) });
  const audio = {
    context: { createBuffer: (channels, length, rate) => ({ numberOfChannels: channels, length, sampleRate: rate, getChannelData: () => new Float32Array(length) }) },
    setDucking(on) { calls.push(["duck", on]); },
    sample: async (name) => (name === "missing.wav" ? null : { buffer: clip(name === "ready.wav" ? 100 : 50) }),
    playBuffer(buffer, options) { calls.push(["play", buffer.length, options]); return { done: Promise.resolve(), stop() {} }; },
  };
  const commentary = createCommentaryAudio(audio, { drivers: [] });
  const said = commentary.speak({ script: "ready.wav missing.wav go.wav", args: [] });
  assert.equal(commentary.speaking, true);
  await said;
  assert.equal(commentary.speaking, false);
  assert.deepEqual(calls, [["duck", true], ["play", 150, { gain: 0.7, bus: "commentary" }], ["duck", false]]);
});

test("a track WAV loops on the music bus", () => {
  const calls = [];
  const audio = {
    play(name, options) { calls.push([name, options]); return Promise.resolve(null); },
    playMod() { throw new Error("not a MOD"); },
  };
  const world = createWorldAudio(audio, { ambient: null, weather: 0, music: "FARM.WAV" });
  assert.deepEqual(calls, [["FARM.WAV", { loop: true, gain: 1, bus: "music" }]]);
  world.dispose();
});
