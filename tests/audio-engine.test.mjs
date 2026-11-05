/*
  The audio engine (src/audio/audio-engine.js) against a stand-in Web Audio context that counts the writes to its
  parameters.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createAudio } from "../src/audio/audio-engine.js";

/** A parameter that counts how many times `value` is written. */
function param(value = 0) {
  const p = { writes: 0, _v: value, setTargetAtTime() { p.writes++; } };
  Object.defineProperty(p, "value", { get: () => p._v, set: (v) => { p._v = v; p.writes++; } });
  return p;
}
const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });

function fakeContext(state) {
  const listeners = [];
  const ctx = {
    state, currentTime: 0, sampleRate: 48000,
    destination: { maxChannelCount: 2, channelCount: 2 },
    listener: Object.fromEntries(["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map((k) => [k, param()])),
    sources: [], panners: [],
    createGain: () => node({ gain: param(1) }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createAnalyser: () => node({ getByteTimeDomainData() {} }),
    createBufferSource() { const s = node({ playbackRate: param(1), start() {}, stop() {} }); ctx.sources.push(s); return s; },
    createPanner() { const p = node({ positionX: param(), positionY: param(), positionZ: param() }); ctx.panners.push(p); return p; },
    decodeAudioData: async () => ({ duration: 2, sampleRate: 48000 }),
    addEventListener: (type, fn) => { if (type === "statechange") listeners.push(fn); },
    resume: async () => {},
    close: async () => {},
    run() { ctx.state = "running"; for (const fn of listeners) fn(); },
  };
  return ctx;
}

async function withContext(state, body) {
  const before = globalThis.AudioContext;
  const ctx = fakeContext(state);
  globalThis.AudioContext = function AudioContext() { return ctx; };
  try {
    const audio = createAudio({ call: async () => ({ bytes: new Uint8Array(8), klp: null, format: "wav" }) });
    await body(audio, ctx);
  } finally {
    globalThis.AudioContext = before;
  }
}

const frames = (voice, audio, n) => {
  for (let i = 0; i < n; i++) {
    voice.setPosition([i, 2, 3]);
    voice.setRate(1 + i / 1000);
    audio.setListener({ x: i, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  }
};

test("a suspended context gets no parameter writes, and the last asked for is written once it runs", async () => {
  await withContext("suspended", async (audio, ctx) => {
    const voice = await audio.play("SKID-D1", { loop: true, position: [0, 0, 0] });
    const panner = ctx.panners[0], source = ctx.sources[0];
    const at = { x: panner.positionX.writes, rate: source.playbackRate.writes, listener: ctx.listener.positionX.writes };
    // A race's frames while the context is not running: nothing reaches the graph, however many there are.
    frames(voice, audio, 500);
    assert.equal(panner.positionX.writes, at.x);
    assert.equal(source.playbackRate.writes, at.rate);
    assert.equal(ctx.listener.positionX.writes, at.listener);
    ctx.run();
    assert.equal(panner.positionX.writes, at.x + 1, "written once on running");
    assert.equal(panner.positionX.value, 499);
    assert.equal(panner.positionZ.value, -3);
    assert.equal(source.playbackRate.value, 1.499);
  });
});

test("a running context is written as it is asked", async () => {
  await withContext("running", async (audio, ctx) => {
    const voice = await audio.play("SKID-D1", { loop: true, position: [0, 0, 0] });
    const panner = ctx.panners[0];
    const before = panner.positionX.writes;
    frames(voice, audio, 10);
    assert.equal(panner.positionX.writes, before + 10);
    assert.equal(ctx.listener.positionX.value, 9);
  });
});

test("a voice stopped while the context was suspended is not written when it runs", async () => {
  await withContext("suspended", async (audio, ctx) => {
    const voice = await audio.play("WTR-ABV1", { loop: true, position: [0, 0, 0] });
    voice.setPosition([5, 5, 5]);
    voice.stop();
    const writes = ctx.panners[0].positionX.writes;
    ctx.run();
    assert.equal(ctx.panners[0].positionX.writes, writes);
  });
});
