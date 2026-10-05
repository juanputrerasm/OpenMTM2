/* Initialize menu sound and music once, both after a previous install and after a new copy. */
import { createAudio } from "../audio/audio-engine.js";
import { attachMenuSounds } from "../audio/menu-sounds.js";
import { createMenuMusic } from "../audio/menu-music.js";

/** Create and unlock the shared context during a user gesture, before a first install is copied. */
export function primeMenuAudio(context) {
  if (!context.menuAudio) {
    context.menuAudio = createAudio(context.assets, context.settings.sound);
    context.detachMenuSounds = attachMenuSounds(document, context.menuAudio, context.settings);
    window.__openmtm2Menu = context.menuAudio;
  }
  return context.menuAudio.resume();
}

export function startMenuAudio(context) {
  primeMenuAudio(context);
  if (!context.menuMusic) context.menuMusic = createMenuMusic(context.menuAudio, context.settings);
  // Start immediately when autoplay is allowed. If a browser requires a gesture, the menu-sound
  // listener resumes this already queued voice on the first interaction.
  context.menuMusic.start();
}
