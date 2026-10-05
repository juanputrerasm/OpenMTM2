/*
  The start and menu music: SOUND\SPLASH.WAV from MUSIC.POD, with the loop points in its KLP.
  It plays under the menus and stops for a race.
*/
export function createMenuMusic(audio, settings, sample = "SPLASH") {
  let voice = null, wanted = false;
  const allowed = () => settings.menuMusic !== false && !settings.sound?.muted && (settings.sound?.music ?? 0.6) > 0;
  return {
    start() {
      wanted = true;
      if (voice || !allowed()) return;
      voice = audio.play(sample, { loop: true, gain: 0.8, bus: "music" });
    },
    stop() {
      wanted = false;
      voice?.then((v) => v?.stop());
      voice = null;
    },
    /** The options changed (volume, mute, the switch): start or stop to match. */
    refresh() {
      if (wanted && allowed() && !voice) voice = audio.play(sample, { loop: true, gain: 0.8, bus: "music" });
      else if (!allowed() && voice) { voice.then((v) => v?.stop()); voice = null; }
    },
  };
}
