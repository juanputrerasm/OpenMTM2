/*
  The menus' music: `MUSIC\SEX.MOD`, a six-channel tracker module from SOUND.POD, played by the
  port's own player (OpenPhotex renders it to PCM once; the page loops it). It plays under the
  menus and stops for a race.
*/
export function createMenuMusic(audio, settings, module = "SEX") {
  let voice = null, wanted = false;
  const allowed = () => settings.menuMusic !== false && !settings.sound?.muted && (settings.sound?.music ?? 0.6) > 0;
  return {
    start() {
      wanted = true;
      if (voice || !allowed()) return;
      voice = audio.playMod(module, { gain: 0.8 });
    },
    stop() {
      wanted = false;
      voice?.then((v) => v?.stop());
      voice = null;
    },
    /** The options changed (volume, mute, the switch): start or stop to match. */
    refresh() {
      if (wanted && allowed() && !voice) voice = audio.playMod(module, { gain: 0.8 });
      else if (!allowed() && voice) { voice.then((v) => v?.stop()); voice = null; }
    },
  };
}
