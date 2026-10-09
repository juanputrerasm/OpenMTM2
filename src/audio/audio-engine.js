/*
  Sound in the browser: one Web Audio graph for the game, with master, effects and music
  volumes, a sample cache fed by the asset worker (`SOUND\*.WAV` with their `.KLP` loop
  points), looping and one-shot voices, and positioned voices for the other trucks and the world.

  Positions are game feet; the scene mirrors z, so a position's z is negated for the listener.
  The audio context starts suspended until the page has had a click or key, and `resume` is
  safe to call as often as wanted.
*/
import { attenuation, cullVoices, loopRegion } from "../game/sound-model.js";

/** The effects sit under the music by this much, so the many voices of a race do not bury it. */
const EFFECTS_TRIM = 0.5;
const MUSIC_TRIM = 1.4;
const MAX_SAME_ONE_SHOT = 3, MIN_REPEAT_S = 0.08;

export function createAudio(assets, volumes = {}) {
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextClass) return createSilentAudio();
  const ctx = new AudioContextClass();
  const master = ctx.createGain(), effects = ctx.createGain(), music = ctx.createGain(), commentary = ctx.createGain();
  // The game's mixer compresses its master; here a compressor keeps many loud voices from clipping.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12; limiter.knee.value = 10; limiter.ratio.value = 6; limiter.attack.value = 0.003; limiter.release.value = 0.25;
  effects.connect(master);
  music.connect(master);
  commentary.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);
  const buffers = new Map();
  let active = 0;
  let ducked = false, currentVolumes = {};
  // The mixer (game/sound-model.js): positioned voices fade with distance over the audible range, and only the loudest 16 sound.
  const live = new Set();
  // Once the race feeds the listener every frame, `mix` alone sets each voice's gain; a direct write would undo its fades.
  let mixing = false;
  const shots = new Map();
  // What was started lately, for finding a sound that plays more than it should: `recentPlays()` and `playCounts()` below.
  const playLog = [], counts = new Map();
  let range = 1000;
  const listenerFeet = [0, 0, 0];
  const levelOf = (rec) => {
    if (!rec.position) return rec.base;
    const d = Math.hypot(rec.position[0] - listenerFeet[0], rec.position[1] - listenerFeet[1], rec.position[2] - listenerFeet[2]);
    return rec.base * attenuation(d, range);
  };
  function mix() {
    const recs = [...live].filter((rec) => !rec.stopped);
    const levels = recs.map(levelOf);
    const keep = cullVoices(levels, undefined, recs.map((rec) => rec.kept));
    const now = ctx.currentTime;
    recs.forEach((rec, i) => {
      rec.kept = keep[i];
      rec.volume.gain.setTargetAtTime(keep[i] ? levels[i] : 0, now, 0.04);
    });
  }

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
    currentVolumes = v;
    const level = (x, fallback) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback);
    master.gain.value = v.muted ? 0 : level(v.master, 1);
    const effectsLevel = level(v.effects, 1), musicLevel = level(v.music, 0.6);
    effects.gain.value = effectsLevel * EFFECTS_TRIM * (ducked ? 0.35 : 1);
    music.gain.value = Math.min(1.5, musicLevel * MUSIC_TRIM) * (ducked ? 0.25 : 1);
    commentary.gain.value = effectsLevel;
  }
  function setDucking(on) {
    ducked = !!on;
    setVolumes(currentVolumes);
  }
  setVolumes(volumes);

  /**
   * Start a sample. Options: `gain`, `rate`, `loop` (use its loop points), `position` ([x, y, z]
   * feet; unpositioned when absent), `bus` ("effects", "music" or "commentary"), `randomStart`.
   * Resolves to a
   * voice `{ setGain, setRate, setPosition, stop }`, or null when the sample is missing.
   */
  async function play(name, { gain = 1, rate = 1, loop = false, position = null, bus = "effects", randomStart = false } = {}) {
    // A one-shot is not started again at once, nor more than three at a time (the mixer's own limit is 16 in all).
    const key = String(name).toUpperCase();
    const guarded = !loop && bus === "effects";
    if (guarded) {
      const now = ctx.currentTime;
      const mine = (shots.get(key) ?? []).filter((shot) => shot.end > now);
      shots.set(key, mine);
      if (mine.length >= MAX_SAME_ONE_SHOT || (mine.length && now - mine[mine.length - 1].start < MIN_REPEAT_S)) return null;
    }
    const data = await sample(name);
    if (!data) return null;
    playLog.push({ t: +ctx.currentTime.toFixed(2), name: key, loop, positioned: !!position, bus });
    if (playLog.length > 80) playLog.shift();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const source = ctx.createBufferSource();
    source.buffer = data.buffer;
    source.playbackRate.value = rate;
    if (guarded) shots.get(key)?.push({ start: ctx.currentTime, end: ctx.currentTime + data.buffer.duration / rate });
    const volume = ctx.createGain();
    const rec = { name: key, loop, base: gain, position: position ? [...position] : null, volume, stopped: false, startedAt: ctx.currentTime };
    volume.gain.value = levelOf(rec);
    let panner = null;
    source.connect(volume);
    if (position) {
      panner = ctx.createPanner();
      panner.panningModel = "equalpower";
      // Only the direction: the distance fade is the mixer's own (above).
      panner.distanceModel = "linear";
      panner.refDistance = 1;
      panner.maxDistance = 1e9;
      panner.rolloffFactor = 0;
      panner.positionX.value = position[0];
      panner.positionY.value = position[1];
      panner.positionZ.value = -position[2];
      volume.connect(panner);
      panner.connect(bus === "music" ? music : bus === "commentary" ? commentary : effects);
    } else {
      volume.connect(bus === "music" ? music : bus === "commentary" ? commentary : effects);
    }
    let offset = 0;
    if (loop) {
      source.loop = true;
      if (data.loop) { source.loopStart = data.loop.start; source.loopEnd = data.loop.end; }
      if (randomStart) {
        // Inside the loop, as the game starts its engine samples (a start in the attack would replay it).
        const from = data.loop?.start ?? 0, to = data.loop?.end ?? data.buffer.duration;
        offset = from + Math.random() * (to - from);
      }
    }
    let stopped = false;
    active++;
    const done = new Promise((resolve) => { source.onended = () => { stopped = true; rec.stopped = true; live.delete(rec); active--; resolve(); }; });
    live.add(rec);
    source.start(0, offset);
    return {
      done,
      get stopped() { return stopped; },
      setGain: (g) => { rec.base = g; if (!mixing) volume.gain.value = levelOf(rec); },
      setRate: (r) => { source.playbackRate.value = r; },
      setPosition: (p) => {
        if (!panner) return;
        rec.position = [p[0], p[1], p[2]];
        panner.positionX.value = p[0]; panner.positionY.value = p[1]; panner.positionZ.value = -p[2];
      },
      stop: () => { if (!stopped) { try { source.stop(); } catch { /* already stopped */ } } stopped = true; rec.stopped = true; live.delete(rec); },
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
    mixing = true;
    listenerFeet[0] = position.x; listenerFeet[1] = position.y; listenerFeet[2] = -position.z;
    mix();
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = position.x; l.positionY.value = position.y; l.positionZ.value = position.z;
      l.forwardX.value = forward.x; l.forwardY.value = forward.y; l.forwardZ.value = forward.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    }
  }

  return {
    context: ctx, sample, play, playMod, setVolumes, setDucking, setListener,
    /** The audible range in feet, which the weather sets (`soundRange`). */
    setRange(feet) { range = feet; },
    /** For tests and debugging: the context state, the samples asked for and the voices playing. */
    stats: () => ({ state: ctx.state, samples: buffers.size, sampleNames: [...buffers.keys()], voices: active }),
    /** For debugging: the last 80 sounds started, and how many times each name has been started. */
    recentPlays: () => [...playLog],
    playCounts: () => Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])),
    /** For debugging: every effect voice with its base gain, its mixed level and whether the mixer keeps it. */
    voiceReport() {
      const recs = [...live].filter((r) => !r.stopped), levels = recs.map(levelOf), keep = cullVoices(levels, undefined, recs.map((r) => r.kept));
      return recs.map((r, i) => ({ name: r.name, loop: r.loop, ageSeconds: +(ctx.currentTime - r.startedAt).toFixed(1), base: +r.base.toFixed(2), positioned: !!r.position, level: +levels[i].toFixed(3), mixed: keep[i] }));
    },
    resume: () => (ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve()),
    suspend: () => ctx.suspend().catch(() => {}),
    dispose: () => ctx.close().catch(() => {}),
  };
}

/** The same interface with no output, for browsers without Web Audio and for tests. */
export function createSilentAudio() {
  const voice = { done: Promise.resolve(), stopped: true, setGain() {}, setRate() {}, setPosition() {}, stop() {} };
  return {
    context: null, stats: () => ({ state: "none", samples: 0, sampleNames: [], voices: 0 }), sample: async () => null, play: async () => voice, playMod: async () => voice, setVolumes() {}, setListener() {}, setRange() {},
    setDucking() {}, resume: async () => {}, suspend: async () => {}, dispose: async () => {},
  };
}
