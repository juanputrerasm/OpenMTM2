/*
  Speaking a phrase (MONSTER_EXE_ANALYSIS.md 12, "Commentary (Trucksfx.c)", 0x421600): its clips are read and joined
  end to end into one sound, as the game builds one buffer, and played once on the commentary bus at 0.7, the rest of
  the mix ducked under it. Driver names come from each truck's own name clips. A clip the install lacks is left out,
  so a phrase still comes out; a phrase whose clips are all missing is not said. With `whole` (CP3's announcer, whose
  drag calls need CP3's own Sound.POD) a phrase missing any clip is not said at all.
*/
import { COMMENTARY_GAIN, NUMBER_CLIPS, nameClip, parseSpec } from "../game/commentary.js";

/** The clip names of a phrase `{ script, args, numbers }` for `drivers` (`{ waves }` each, in entrant order). */
export function phraseClips({ script, args, numbers = null }, drivers) {
  return parseSpec(script).map((token) => {
    if (token.kind === "wav") return token.name;
    if (token.kind === "number") return NUMBER_CLIPS[numbers?.[token.arg]] ?? null;
    return nameClip(drivers[args[token.arg - 1] - 1]?.waves, token.variant);
  });
}

/**
 * Join decoded clips into one buffer: `buffers` are AudioBuffer-like (`numberOfChannels`, `length`, `sampleRate`,
 * `getChannelData`), all at the context's rate; mono clips feed every channel. `make(channels, length, rate)` makes
 * the buffer (the context's `createBuffer`).
 */
export function joinClips(buffers, make) {
  const list = buffers.filter(Boolean);
  if (!list.length) return null;
  const channels = Math.max(...list.map((b) => b.numberOfChannels));
  const length = list.reduce((sum, b) => sum + b.length, 0);
  const out = make(channels, length, list[0].sampleRate);
  for (let c = 0; c < channels; c++) {
    const into = out.getChannelData(c);
    let at = 0;
    for (const b of list) {
      into.set(b.getChannelData(Math.min(c, b.numberOfChannels - 1)), at);
      at += b.length;
    }
  }
  return out;
}

/**
 * @param {ReturnType<import("./audio-engine.js").createAudio>} audio
 * @param {{ drivers: { name: string, waves: string[] }[], gain?: number, whole?: boolean }} options
 */
export function createCommentaryAudio(audio, { drivers, gain = COMMENTARY_GAIN, whole = false }) {
  let disposed = false, current = null, speaking = false;
  return {
    /** Whether a phrase is being said (the game's 0x464450): the queue keeps quiet meanwhile. */
    get speaking() { return speaking; },
    /** Say a phrase `{ script, args }`; resolves when it has been said (or could not be). */
    async speak(phrase) {
      if (disposed || speaking || !audio.context) return;
      speaking = true;
      try {
        const clips = phraseClips(phrase, drivers);
        if (whole && clips.some((name) => !name)) return;
        const names = clips.filter(Boolean);
        const decoded = await Promise.all(names.map((name) => audio.sample(name).then((d) => d?.buffer ?? null).catch(() => null)));
        if (disposed || (whole && decoded.some((b) => !b))) return;
        const joined = joinClips(decoded, (channels, length, rate) => audio.context.createBuffer(channels, length, rate));
        if (!joined) return;
        audio.setDucking?.(true);
        current = audio.playBuffer(joined, { gain, bus: "commentary" });
        await current.done;
      } finally {
        current = null;
        speaking = false;
        if (!disposed) audio.setDucking?.(false);
      }
    },
    dispose() {
      disposed = true;
      current?.stop();
      audio.setDucking?.(false);
    },
  };
}
