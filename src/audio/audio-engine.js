/*
  Sound in the browser: one Web Audio graph for the game, with master, effects and music
  volumes, a sample cache fed by the asset worker (`SOUND\*.WAV` with their `.KLP` loop
  points), looping and one-shot voices, and positioned voices for the other trucks and the world.

  Positions are game feet; the scene mirrors z, so a position's z is negated for the listener.
  The audio context starts suspended until the page has had a click or key, and `resume` is
  safe to call as often as wanted.
*/
import { loopRegion } from "../game/sound-model.js";

/** Distance model for positioned voices, feet: full volume inside REF, fading over the next ROLL. */
const REF_FT = 40, MAX_FT = 1400;

export function createAudio(assets, volumes = {}) {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) return createSilentAudio();
  const ctx = new AudioContextClass();
  const master = ctx.createGain(), effects = ctx.createGain(), music = ctx.createGain();
  effects.connect(master);
  music.connect(master);
  master.connect(ctx.destination);
  const buffers = new Map();
  let active = 0;

  /** The decoded sample (and its loop region in seconds, or null) for a name; null when the install lacks it. */
  function sample(name) {
    const key = String(name).toUpperCase().replace(/\.WAV$/, "");
    if (!buffers.has(key)) {
      buffers.set(key, assets.call("sound", { name: key }).then(async (data) => {
        if (!data) return null;
        const buffer = await ctx.decodeAudioData(data.wav);
        const region = loopRegion(data.klp, buffer.length);
        return { buffer, loop: region ? { start: region.start / buffer.sampleRate, end: region.end / buffer.sampleRate } : null };
      }).catch(() => null));
    }
    return buffers.get(key);
  }

  function setVolumes(v) {
    const level = (x, fallback) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback);
    master.gain.value = v.muted ? 0 : level(v.master, 1);
    effects.gain.value = level(v.effects, 1);
    music.gain.value = level(v.music, 0.6);
  }
  setVolumes(volumes);

  /**
   * Start a sample. Options: `gain`, `rate`, `loop` (use its loop points), `position` ([x, y, z]
   * feet; unpositioned when absent), `bus` ("effects" or "music"), `randomStart`. Resolves to a
   * voice `{ setGain, setRate, setPosition, stop }`, or null when the sample is missing.
   */
  async function play(name, { gain = 1, rate = 1, loop = false, position = null, bus = "effects", randomStart = false } = {}) {
    const data = await sample(name);
    if (!data) return null;
    const source = ctx.createBufferSource();
    source.buffer = data.buffer;
    source.playbackRate.value = rate;
    const volume = ctx.createGain();
    volume.gain.value = gain;
    let panner = null;
    source.connect(volume);
    if (position) {
      panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "linear";
      panner.refDistance = REF_FT;
      panner.maxDistance = MAX_FT;
      panner.rolloffFactor = 1;
      panner.positionX.value = position[0];
      panner.positionY.value = position[1];
      panner.positionZ.value = -position[2];
      volume.connect(panner);
      panner.connect(bus === "music" ? music : effects);
    } else {
      volume.connect(bus === "music" ? music : effects);
    }
    let offset = 0;
    if (loop) {
      source.loop = true;
      if (data.loop) { source.loopStart = data.loop.start; source.loopEnd = data.loop.end; }
      if (randomStart) offset = Math.random() * (data.loop?.end ?? data.buffer.duration);
    }
    let stopped = false;
    active++;
    const done = new Promise((resolve) => { source.onended = () => { stopped = true; active--; resolve(); }; });
    source.start(0, offset);
    return {
      done,
      get stopped() { return stopped; },
      setGain: (g) => { volume.gain.value = g; },
      setRate: (r) => { source.playbackRate.value = r; },
      setPosition: (p) => {
        if (!panner) return;
        panner.positionX.value = p[0]; panner.positionY.value = p[1]; panner.positionZ.value = -p[2];
      },
      stop: () => { if (!stopped) { try { source.stop(); } catch { /* already stopped */ } } stopped = true; },
    };
  }

  /** A tracker module's rendered PCM looped as music (or as the bus given); resolves like `play`. */
  async function playMod(name, { gain = 1, bus = "music" } = {}) {
    const data = await assets.call("mod", { name }).catch(() => null);
    if (!data) return null;
    const buffer = ctx.createBuffer(2, data.left.length, data.sampleRate);
    buffer.copyToChannel(data.left, 0);
    buffer.copyToChannel(data.right, 1);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = data.loopStartFrame / data.sampleRate;
    source.loopEnd = buffer.duration;
    const volume = ctx.createGain();
    volume.gain.value = gain;
    source.connect(volume);
    volume.connect(bus === "music" ? music : effects);
    source.start();
    active++;
    let stopped = false;
    return { get stopped() { return stopped; }, setGain: (g) => { volume.gain.value = g; }, stop: () => { if (!stopped) { try { source.stop(); } catch { /* done */ } active--; } stopped = true; } };
  }

  /** Place the listener: the camera's position in the scene and its forward and up directions. */
  function setListener(position, forward, up) {
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = position.x; l.positionY.value = position.y; l.positionZ.value = position.z;
      l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    }
  }

  return {
    context: ctx, sample, play, playMod, setVolumes, setListener,
    /** For tests and debugging: the context state, the samples asked for and the voices playing. */
    stats: () => ({ state: ctx.state, samples: buffers.size, voices: active }),
    resume: () => (ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve()),
    suspend: () => ctx.suspend().catch(() => {}),
    dispose: () => ctx.close().catch(() => {}),
  };
}

/** The same interface with no output, for browsers without Web Audio and for tests. */
export function createSilentAudio() {
  const voice = { done: Promise.resolve(), stopped: true, setGain() {}, setRate() {}, setPosition() {}, stop() {} };
  return {
    context: null, stats: () => ({ state: "none", samples: 0, voices: 0 }), sample: async () => null, play: async () => voice, playMod: async () => voice, setVolumes() {}, setListener() {},
    resume: async () => {}, suspend: async () => {}, dispose: async () => {},
  };
}
