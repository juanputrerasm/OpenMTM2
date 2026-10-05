import test from "node:test";
import assert from "node:assert/strict";
import { createMenuMusic } from "../src/audio/menu-music.js";
import { playMenuSound } from "../src/audio/menu-sounds.js";
import { VOICE_COMMENTARY_ENABLED, createCommentaryAudio } from "../src/audio/commentary-audio.js";
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

test("announcer clips use their own bus and duck the race", async () => {
  const calls = [];
  const audio = {
    setDucking(on) { calls.push(["duck", on]); },
    async play(name, options) {
      calls.push(["play", name, options]);
      return { done: Promise.resolve(), stop() {} };
    },
  };
  const commentary = createCommentaryAudio(audio, {
    drivers: [],
    texts: { "ready.wav go.wav": "Ready, go!" },
  });
  const spoken = commentary.speak({ spec: "ready.wav go.wav", args: [] });
  assert.equal(spoken.line, "Ready, go!");
  await spoken.done;
  assert.deepEqual(calls, [
    ["duck", true],
    ["play", "ready.wav", { gain: 0.7, bus: "commentary" }],
    ["play", "go.wav", { gain: 0.7, bus: "commentary" }],
    ["duck", false],
  ]);
});

test("announcer text can be prepared without starting voice or ducking music", () => {
  const calls = [];
  const commentary = createCommentaryAudio({
    play() { calls.push("play"); },
    setDucking(on) { calls.push(["duck", on]); },
  }, { drivers: [{ name: "Player", waves: [] }], texts: { "(<<1>> hasfin.wav": "<<1>> has finished" } });
  assert.equal(commentary.line({ spec: "(<<1>> hasfin.wav", args: [1] }), "Player has finished");
  assert.deepEqual(calls, []);
});

test("voice commentary is disabled while text commentary remains available", () => {
  assert.equal(VOICE_COMMENTARY_ENABLED, false);
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
