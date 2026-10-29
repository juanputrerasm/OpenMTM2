/*
  The start and menu music: SOUND\SPLASH.WAV from MUSIC.POD, with the loop points in its KLP.
  It plays under the menus and stops for a race. While the jukebox plays in its place (`yieldTo`, audio/jukebox.js) it is
  silent.
*/
export function createMenuMusic(audio, settings, sample = "SPLASH", { yieldTo = () => false } = {}) {
  let voice = null, wanted = false;
  const allowed = () => settings.menuMusic !== false && !settings.sound?.muted && (settings.sound?.music ?? 0.6) > 0 && !yieldTo();
  const stopVoice = () => {
    voice?.then((v) => v?.stop());
    voice = null;
  };
  return {
    start() {
      wanted = true;
      if (voice || !allowed()) return;
      voice = audio.play(sample, { loop: true, gain: 0.8, bus: "music" });
    },
    stop() {
      wanted = false;
      stopVoice();
    },
    /** The options changed (volume, mute, the switch): start or stop to match. */
    refresh() {
      if (wanted && allowed() && !voice) voice = audio.play(sample, { loop: true, gain: 0.8, bus: "music" });
      else if (!allowed() && voice) stopVoice();
    },
    /** The mounted PODs changed: stop the old loop and read its sample again if it is still wanted. */
    reload() {
      stopVoice();
      if (wanted && allowed()) voice = audio.play(sample, { loop: true, gain: 0.8, bus: "music" });
    },
  };
}
