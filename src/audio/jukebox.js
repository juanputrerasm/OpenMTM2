/*
  The jukebox's player: the mounted music (worker/jukebox-list.js) played piece after piece on the music channel, in
  the player's order (game/jukebox.js), round the list without end. It plays on the menus' audio context and not on a
  race's own view of it, so it goes on through the menus and the races alike; while it is on, the menus' music and the
  tracks' music are left silent (audio/menu-music.js, ui/screens/race.js).

  A piece plays once from start to end: a WAV whole, its KLP loop points unused; an OGG or MP3 that replaces it as the
  game would take it (worker/sound-file.js); a tracker module as rendered up to its end or its loop point, raised as the
  tracks raise one (MOD_MUSIC_GAIN). Only the piece playing is kept decoded.
*/
import { MOD_MUSIC_GAIN } from "./world-audio.js";
import { loadJukebox, nextPlayable, orderedEntries, saveJukebox } from "../game/jukebox.js";

/**
 * @param {ReturnType<import("./audio-engine.js").createAudio>} audio the menus' mixer
 * @param {{ call(type: string, payload?: object): Promise<any> }} assets the asset worker
 * @param {{ onActive?: (on: boolean) => void }} [options] told when the jukebox starts or stops standing in for the game's music
 */
export function createJukebox(audio, assets, { onActive = () => {} } = {}) {
  const ctx = audio.context;
  const state = loadJukebox();
  const listeners = new Set();
  let entries = null, listing = null;
  let paused = false, loading = false, failures = 0;
  let voice = null, generation = 0, startedAt = 0, offset = 0;
  /** The piece decoded last: `{ id, buffer, gain }`. */
  let piece = null;

  const changed = () => {
    saveJukebox(state);
    for (const listener of listeners) listener();
  };

  /** The music in the player's order. */
  async function list() {
    listing ??= assets.call("jukebox").then((all) => { entries = all ?? []; return entries; }).catch(() => { listing = null; return entries ?? []; });
    await listing;
    return orderedEntries(entries ?? [], state.order);
  }
  const ids = async () => (await list()).map((entry) => entry.id);

  /** The decoded piece, or null when it cannot be played. */
  async function decode(entry) {
    if (!ctx) return null;
    if (entry.kind === "mod") {
      const data = await assets.call("mod", { name: entry.stem }).catch(() => null);
      if (!data) return null;
      const buffer = ctx.createBuffer(2, data.left.length, data.sampleRate);
      buffer.copyToChannel(data.left, 0);
      buffer.copyToChannel(data.right, 1);
      return { id: entry.id, buffer, gain: MOD_MUSIC_GAIN };
    }
    const read = (only) => assets.call("sound", only ? { name: entry.stem, only } : { name: entry.stem }).catch(() => null);
    const data = await read(null);
    if (!data) return null;
    try {
      return { id: entry.id, buffer: await ctx.decodeAudioData(data.bytes), gain: 1 };
    } catch {
      // An OGG or MP3 this browser cannot decode gives way to the game's WAV, as the race's music does (audio-engine.js).
      if (data.format === "wav") return null;
      const wav = await read("WAV");
      return wav ? { id: entry.id, buffer: await ctx.decodeAudioData(wav.bytes).catch(() => null), gain: 1 } : null;
    }
  }

  function silence() {
    generation++;
    const playing = voice;
    voice = null;
    playing?.stop();
  }

  /** Load `id` and play it from `from` seconds, unless paused (then it waits, loaded, for `resume`). */
  async function start(id, from = 0) {
    silence();
    const mine = generation;
    state.current = id;
    offset = from;
    if (!id) { changed(); return; }
    loading = true;
    changed();
    const entry = (await list()).find((e) => e.id === id);
    let next = piece?.id === id ? piece : null;
    if (!next && entry) {
      piece = null;
      next = await decode(entry);
    }
    if (mine !== generation) return;
    loading = false;
    if (!next?.buffer) {
      // A piece that does not play is passed over, once round the list at most.
      changed();
      if (++failures < (await ids()).length) advance(1);
      else stop();
      return;
    }
    failures = 0;
    piece = next;
    if (paused || !state.on) { changed(); return; }
    const playing = audio.playBuffer(piece.buffer, { gain: piece.gain, bus: "music", offset: from });
    voice = playing;
    startedAt = (ctx?.currentTime ?? 0) - from;
    playing.done.then(() => { if (voice === playing) { voice = null; offset = 0; advance(1); } });
    changed();
  }

  async function advance(step) {
    const id = nextPlayable(await ids(), new Set(state.skip), state.current, step);
    return start(id, 0);
  }

  /** Where the piece is, seconds. */
  const position = () => (voice && ctx ? Math.max(0, ctx.currentTime - startedAt) : offset);

  function stop() {
    const was = state.on;
    state.on = false;
    paused = false;
    loading = false;
    offset = 0;
    silence();
    changed();
    if (was) onActive(false);
  }

  const api = {
    /** The music in the player's order: `[{ id, kind, stem, format, menu, tracks }]`. */
    list,
    /** Play `id`, or the piece it was on, or the first: the jukebox now stands in for the game's music. */
    async play(id = null) {
      const was = state.on, wasPaused = paused;
      state.on = true;
      paused = false;
      failures = 0;
      if (!was) onActive(true);
      // Play with nothing picked while paused: go on where it stopped.
      if (id === null && was && wasPaused) return start(state.current, offset);
      const all = await ids();
      const skipped = new Set(state.skip);
      return start(id ?? (all.includes(state.current) && !skipped.has(state.current) ? state.current : nextPlayable(all, skipped, null, 1)), 0);
    },
    pause() {
      if (!state.on || paused) return;
      offset = position();
      paused = true;
      silence();
      changed();
    },
    resume() {
      if (!state.on || !paused) return;
      paused = false;
      start(state.current, offset);
    },
    stop,
    next: () => { failures = 0; return advance(1); },
    previous: () => { failures = 0; return advance(-1); },
    /** The player's order, as ids. */
    setOrder(order) {
      state.order = [...order];
      changed();
    },
    /** Leave a piece out of the playing, or put it back. */
    setSkipped(id, skip) {
      state.skip = skip ? [...new Set([...state.skip, id])] : state.skip.filter((s) => s !== id);
      changed();
      if (skip && id === state.current && state.on && !paused) advance(1);
    },
    /** The mounted archives changed: read the music again; a piece no longer there gives way to the next. */
    async reload() {
      listing = null;
      const all = await ids();
      if (state.on && state.current && !all.includes(state.current)) advance(1);
      else changed();
    },
    /** At start: play on where it was left, if it was on. */
    resumeIfOn() {
      if (state.on) { onActive(true); start(state.current, 0); }
    },
    /** Called on every change; returns the call that stops it. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get on() { return state.on; },
    status: () => ({ on: state.on, paused, loading, current: state.current, position: position(), duration: piece?.id === state.current ? piece.buffer.duration : null, skip: [...state.skip] }),
  };
  return api;
}
