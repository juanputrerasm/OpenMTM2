/*
  The world's sound in a race: the level's ambience (`DATA\SOUNDnnn.TXT`: one-shots that fire at
  random intervals while the weather's bit is set in their mask, and loops), the rain, thunder
  after lightning, the music from `MUSIC.POD`, and the checkpoint and lap sounds. Ambient
  one-shots are heard from a random spot around the listener, as the file gives no positions.
*/
import { RAIN_UNDERWATER_PITCH, nextDelay, objectHitSound, rainJitter, rainOnRoof, roofGain, underwaterMix } from "../game/sound-model.js";
import { weatherMaskIncludes } from "../vendor/openphotex/mtm/sound.js";

/**
 * A tracker module's extra gain over a WAV loop. A rendered module averages about -16 dBFS RMS (SEX.MOD) while the
 * engine's loops reach -2.5 to -12 dBFS (ACCEL3B, M1-2-M2, STARTIDL): even after the effects' trim the engine sat some
 * 9 dB over the music. About 7 dB more brings the module to the engine's level; the master's limiter takes the peaks.
 */
export const MOD_MUSIC_GAIN = 2.2;

const THUNDER = ["THUNDR3B", "THUNDR5", "THUNDR6B", "THUNDR9B"];
/** The rain loop's level in the port's mix. */
const RAIN_LOOP_GAIN = 0.55;
/** The slowest a truck may close on an object for its sound, ft/s (the port's floor; the game has none). */
export const HIT_MIN_SPEED = 2;

/** The stock checkpoint and lap sounds (MONSTER_EXE_ANALYSIS.md, "Track ambience"). */
export const STOCK_CUES = Object.freeze({ checkpoint: "airhorn.wav", lap: "check2.wav" });

/** The checkpoint and lap sounds a level's script names, the stock ones in place of any it does not name. */
export function checkpointSounds(script) {
  return { checkpoint: script?.checkpointWav || STOCK_CUES.checkpoint, lap: script?.finishLapWav || STOCK_CUES.lap };
}

/**
 * @param {ReturnType<import("./audio-engine.js").createAudio>} audio
 * @param {{ ambient: object|null, weather: number, music: string|null, random?: () => number,
 *   objects?: { sitIndex: number, positionFt: number[], sound: string, moving: boolean }[],
 *   hitInfo?: Map<number, { hitSound: string|null, type: number }>, musicOff?: () => boolean }} options
 *   `objects` are the level's things that sound by themselves (a train, a crossing bell, a crowd);
 *   `hitInfo` what each collision box makes when it is hit; `musicOff` whether the jukebox plays in the music's place.
 */
export function createWorldAudio(audio, { ambient, cues = ambient, weather, music, random = Math.random, objects = [], hitInfo = new Map(), onEvent = () => {}, musicOff = () => false }) {
  // The checkpoint and lap sounds: the level's script's (`cues`, its SOUNDnnn.TXT, which a race's instant replay passes
  // without its ambience), or the stock ones when it has none or names a WAV the install lacks (checkpointSounds).
  const cueNames = checkpointSounds(cues);
  for (const key of ["checkpoint", "lap"]) {
    const name = cueNames[key];
    if (name === STOCK_CUES[key] || !audio.sample) continue;
    audio.sample(name).then((data) => { if (!data) cueNames[key] = STOCK_CUES[key]; }).catch(() => { cueNames[key] = STOCK_CUES[key]; });
  }
  audio.preload?.([...new Set([cueNames.checkpoint, cueNames.lap, STOCK_CUES.checkpoint, STOCK_CUES.lap])]);
  let current = weather, disposed = false;
  const loops = [];
  let ambientShot = null, ambientLeft = Infinity, ambientVoice = null, ambientPending = false;
  let lastAmbientWav = null;
  let musicVoice = null, rainVoice = null, roofVoice = null;
  /** Where the listener is (`setListener`): under water, in the cockpit, under cover. */
  let place = { underwater: false, cockpit: false, covered: false };
  const pending = [];
  audio.preload?.([...new Set([...hitInfo.values()].map((info) => info.hitSound))]);

  function later(seconds, fn) {
    pending.push({ left: seconds, fn });
  }

  function startLoops() {
    for (const voice of loops.splice(0)) voice.then((v) => v?.stop());
    if (!ambient) return;
    for (const loop of ambient.loops) {
      if (!weatherMaskIncludes(loop.weatherMask, current)) continue;
      loops.push(audio.play(loop.wav, { loop: true, gain: Math.min(1, loop.volume), randomStart: true }));
    }
  }

  function startRain() {
    rainVoice?.then((v) => v?.stop());
    rainVoice = current === 4 ? audio.play("RAIN4", { loop: true, gain: RAIN_LOOP_GAIN }) : null;
  }

  /** The rain's pitch jitters each frame, lower under water; on the roof it drums only in the cockpit under open sky (0x57581b). */
  function stepRain() {
    if (current === 4) {
      const jitter = rainJitter(random);
      rainVoice?.then((v) => v?.setRate(jitter * (place.underwater ? RAIN_UNDERWATER_PITCH : 1)));
    }
    const roof = rainOnRoof({ weather: current, ...place });
    if (roof && !roofVoice) roofVoice = audio.play("RAINRF8", { loop: true, gain: roofGain(RAIN_LOOP_GAIN) });
    else if (!roof && roofVoice) { roofVoice.then((v) => v?.stop()); roofVoice = null; }
    if (roofVoice) { const jitter = rainJitter(random); roofVoice.then((v) => v?.setRate(jitter)); }
  }

  function startMusic() {
    // The jukebox plays in its place (audio/jukebox.js).
    if (!music || musicOff()) return;
    // A level may name a tracker module instead of a WAV loop; the module is raised to the engine's level (MOD_MUSIC_GAIN).
    musicVoice = /\.mod$/i.test(music) ? audio.playMod(music, { gain: MOD_MUSIC_GAIN }) : audio.play(music, { loop: true, gain: 1, bus: "music" });
  }

  // The port plays SOUNDnnn.TXT as one ambience programme for the track. Pick one
  // weather-eligible entry, wait its interval, and wait for it to finish before scheduling
  // another. Independent row timers make The Heights' birds and eagles pile up.
  function scheduleAmbientShot() {
    const eligible = (ambient?.oneShots ?? []).filter((shot) => weatherMaskIncludes(shot.weatherMask, current));
    if (!eligible.length) { ambientShot = null; ambientLeft = Infinity; return; }
    const fresh = eligible.filter((shot) => shot.wav.toLowerCase() !== lastAmbientWav);
    const choices = fresh.length ? fresh : eligible;
    ambientShot = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
    ambientLeft = nextDelay(ambientShot.timerMin, ambientShot.timerMax, random);
  }

  function playAmbientShot(listener) {
    const shot = ambientShot;
    if (!shot || ambientPending || ambientVoice) return;
    ambientShot = null;
    ambientLeft = Infinity;
    ambientPending = true;
    lastAmbientWav = shot.wav.toLowerCase();
    const angle = random() * Math.PI * 2, distance = 150 + random() * 500;
    audio.play(shot.wav, {
      gain: Math.min(1.5, shot.volume),
      position: [listener[0] + Math.sin(angle) * distance, listener[1] + 20, listener[2] + Math.cos(angle) * distance],
    }).then((voice) => {
      ambientPending = false;
      if (disposed) { voice?.stop(); return; }
      if (!voice) { scheduleAmbientShot(); return; }
      ambientVoice = voice;
      voice.done.finally(() => {
        if (ambientVoice !== voice) return;
        ambientVoice = null;
        if (!disposed) scheduleAmbientShot();
      });
    }).catch(() => {
      ambientPending = false;
      if (!disposed) scheduleAmbientShot();
    });
  }

  scheduleAmbientShot();
  startLoops();
  startRain();
  startMusic();

  // Objects with a sound of their own: a moving one (the train) rumbles while it is within
  // earshot, a crossing bell rings while a train is close to it, a crowd roars when you are near.
  const emitters = objects.map((o) => ({ ...o, voice: null, pos: [...o.positionFt] }));
  /** The objects whose hit sound is still playing: an object sounds again only once its last one has finished (0x428bc0). */
  const sounding = new Set();
  let trainHornAt = -1e9, clock = 0;
  const near = (a, b, range) => Math.hypot(a[0] - b[0], a[2] - b[2]) < range;
  function updateEmitters(listener, moved) {
    // Crossing bells and horns answer trains only; a Community Patch 3 mover (type 13) has neither.
    const trains = emitters.filter((e) => e.moving && e.train !== false);
    for (const e of emitters) {
      const p = moved.get(e.sitIndex);
      if (p) e.pos = p;
      const bell = /^cross/i.test(e.sound);
      const active = bell ? trains.some((t) => near(t.pos, e.pos, 600)) : near(listener, e.pos, e.moving ? 1500 : 700);
      if (active && !e.voice) e.voice = audio.play(e.sound, { loop: true, gain: bell ? 0.8 : 0.9, randomStart: true, position: e.pos });
      else if (!active && e.voice) { e.voice.then((v) => v?.stop()); e.voice = null; }
      if (e.voice) e.voice.then((v) => v?.setPosition(e.pos));
    }
    for (const t of trains) {
      if (near(listener, t.pos, 650) && clock - trainHornAt > 30) {
        trainHornAt = clock;
        audio.play(random() < 0.5 ? "TR-HORN" : "TR-HORN2", { gain: 1, position: t.pos });
        onEvent("train");
      }
    }
  }

  function update(dt, listener, moved = new Map()) {
    clock += dt;
    updateEmitters(listener, moved);
    stepRain();
    if (!ambientPending && !ambientVoice && ambientShot) {
      ambientLeft -= dt;
      if (ambientLeft <= 0) playAmbientShot(listener);
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      pending[i].left -= dt;
      if (pending[i].left <= 0) { pending[i].fn(); pending.splice(i, 1); }
    }
  }

  return {
    update,
    /** The weather changed (GOLD mode): the loops that depend on it start over. */
    setWeather(next) {
      current = next;
      startLoops();
      startRain();
      if (!ambientPending && !ambientVoice) scheduleAmbientShot();
    },
    /**
     * Where the listener is each frame: `underwater` (the camera under the water level), `cockpit` (the cockpit view)
     * and `covered` (a deck, a tunnel's roof, over the camera).
     */
    setListener({ underwater = false, cockpit = false, covered = false } = {}) {
      place = { underwater: !!underwater, cockpit: !!cockpit, covered: !!covered };
    },
    /** Lightning flashed: the thunder follows after a moment. */
    thunder() {
      later(0.4 + random() * 2.2, () => { if (!disposed) audio.play(THUNDER[Math.floor(random() * THUNDER.length)], { gain: 0.9 }); });
    },
    /**
     * A truck touched an object: the object's own sound, from where it is. As in the game (0x428bc0 asks 0x464450 whether
     * the object's last sound still plays), a truck that stays against it does not start it again over itself.
     * `speed` is how fast the truck closed on it, ft/s; the game has no floor, the port asks for `HIT_MIN_SPEED` so a
     * truck resting against a fence does not set it off again each time its sound ends.
     */
    hit(sitIndex, speed, position, { sourceUnder = false } = {}) {
      const info = hitInfo.get(sitIndex);
      if (!info || !(speed >= HIT_MIN_SPEED) || sounding.has(sitIndex)) return;
      const sound = objectHitSound(info);
      if (!sound) return;
      sounding.add(sitIndex);
      if (/^cowpain/i.test(sound.name)) onEvent("cow");
      const quiet = () => sounding.delete(sitIndex);
      // Muffled from under water, by where it starts and where it is heard (game/sound-model.js `underwaterMix`).
      const mix = underwaterMix(sourceUnder, place.underwater);
      audio.play(sound.name, { gain: Math.min(2.5, sound.gain) * mix.gain, rate: mix.rate, position })
        .then((voice) => { if (voice?.done) voice.done.finally(quiet); else quiet(); })
        .catch(quiet);
    },
    /** The jukebox started or stopped: the track's music stops for it, or comes back after it. */
    refreshMusic() {
      if (disposed) return;
      if (musicOff() && musicVoice) { musicVoice.then((v) => v?.stop()); musicVoice = null; }
      else if (!musicOff() && !musicVoice) startMusic();
    },
    checkpoint() { audio.play(cueNames.checkpoint, { gain: 0.9 }); },
    lapDone() { audio.play(cueNames.lap, { gain: 0.9 }); },
    dispose() {
      disposed = true;
      for (const voice of loops) voice.then((v) => v?.stop());
      musicVoice?.then((v) => v?.stop());
      rainVoice?.then((v) => v?.stop());
      roofVoice?.then((v) => v?.stop());
      ambientVoice?.stop();
      for (const e of emitters) e.voice?.then((v) => v?.stop());
    },
  };
}
