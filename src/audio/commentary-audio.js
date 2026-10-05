/*
  Speaking a phrase: its clips one after another (the game assembles them into one buffer and
  plays that), driver names from each truck's own name clips. Missing clips are skipped, so a
  phrase still comes out when an install lacks one.
*/
import { nameClip, parseSpec, phraseText } from "../game/commentary.js";

/** FUN_00421600 is called with 0.7 for the start phrases; the others share it. */
export const COMMENTARY_GAIN = 0.7;
/** Voice clips remain available for later repair, but races do not play them for now. */
export const VOICE_COMMENTARY_ENABLED = false;

/**
 * @param {ReturnType<import("./audio-engine.js").createAudio>} audio
 * @param {{ drivers: { name: string, waves: string[] }[], texts?: Record<string, string>, gain?: number }} options
 */
export function createCommentaryAudio(audio, { drivers, texts = {}, gain = COMMENTARY_GAIN }) {
  let disposed = false, currentVoice = null;
  const lineFor = ({ spec, args }) => {
    const names = args.map((n) => drivers[n - 1]?.name ?? "");
    return texts[spec] ? phraseText(texts[spec], names) : null;
  };
  return {
    line: lineFor,
    /**
     * Say a phrase `{ spec, args }`; `args` are driver numbers (1-based). Returns the line of
     * text (or null) at once and `done`, which resolves when the last clip has played.
     */
    speak({ spec, args }) {
      const clips = parseSpec(spec).map((token) => (token.kind === "wav" ? token.name : nameClip(drivers[args[token.arg - 1] - 1]?.waves, token.variant)));
      const line = lineFor({ spec, args });
      const done = (async () => {
        audio.setDucking?.(true);
        try {
          for (const clip of clips) {
            if (disposed || !clip) continue;
            currentVoice = await audio.play(clip, { gain, bus: "commentary" });
            if (disposed) {
              currentVoice?.stop();
              break;
            }
            if (currentVoice) await currentVoice.done;
          }
        } finally {
          currentVoice = null;
          audio.setDucking?.(false);
        }
      })();
      return { line, done };
    },
    dispose() {
      disposed = true;
      currentVoice?.stop();
      audio.setDucking?.(false);
    },
  };
}
