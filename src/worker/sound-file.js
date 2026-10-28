/*
  A sound as OpenMTM2 finds it: by STEM, probing SOUND\<stem>.OGG, then SOUND\<stem>.MP3, then the game's own
  SOUND\<stem>.WAV, each through every mounted archive, the way ART\<stem>.PNG and .TGA stand in for a .RAW
  (art-texture.js). A sound recorded as `FARM.WAV`, `FARM.OGG` or plain `FARM` is one sound, so a POD that adds
  `SOUND\FARM.OGG` replaces that track's music, and `SOUND\HORN.MP3` a truck's horn. A file whose bytes are not the
  format its name says is passed over. The browser decodes it (audio/audio-engine.js); `only: "WAV"` asks for the
  game's own file when the browser could not decode the replacement.

  The `.KLP` loop points stay the WAV's stem's (`SOUND\<stem>.KLP`), counted in the file's own samples: the page
  scales them by the rate the file was made at (`sourceRate`) to the rate it was decoded at.
*/
import { audioSampleRate, detectAudioFormat } from "../vendor/openphotex/audio/probe.js";

/** The order replacements are looked for in: OGG loops without gaps, MP3 next, the game's WAV last. */
export const SOUND_EXTENSIONS = Object.freeze(["OGG", "MP3", "WAV"]);

/** A sound's name as the game writes it ("farm.wav", "HORN", "music\\x.ogg") to the stem looked up: "FARM". */
export const soundStem = (name) => String(name ?? "").toUpperCase().replace(/^.*[\\/]/, "").replace(/\.(WAV|MP3|OGG)$/, "");

/**
 * The first usable file for a stem: `{ bytes, format, extension, sourceRate }`, or null when no archive has one.
 * @param {{ read(path: string): Promise<Uint8Array | null> }} vfs
 */
export async function findSound(vfs, stem, { only = null } = {}) {
  for (const extension of only ? [only] : SOUND_EXTENSIONS) {
    const bytes = await vfs.read(`SOUND\\${stem}.${extension}`);
    if (!bytes) continue;
    const format = detectAudioFormat(bytes);
    if (format !== extension.toLowerCase()) continue;
    return { bytes, format, extension, sourceRate: audioSampleRate(bytes) };
  }
  return null;
}
