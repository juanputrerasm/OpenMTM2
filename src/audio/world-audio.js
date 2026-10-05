/*
  The world's sound in a race: the level's ambience (`DATA\SOUNDnnn.TXT`: one-shots that fire at
  random intervals while the weather's bit is set in their mask, and loops), the rain, thunder
  after lightning, the music from `MUSIC.POD`, and the checkpoint and lap sounds. Ambient
  one-shots are heard from a random spot around the listener, as the file gives no positions.
*/
import { nextDelay, objectHitSound } from "../game/sound-model.js";
import { weatherMaskIncludes } from "../vendor/openphotex/index.js";

const THUNDER = ["THUNDR3B", "THUNDR5", "THUNDR6B", "THUNDR9B"];

/**
 * @param {ReturnType<import("./audio-engine.js").createAudio>} audio
 * @param {{ ambient: object|null, weather: number, music: string|null, random?: () => number,
 *   objects?: { sitIndex: number, positionFt: number[], sound: string, moving: boolean }[],
 *   hitInfo?: Map<number, { hitSound: string|null, type: number }> }} options
 *   `objects` are the level's things that sound by themselves (a train, a crossing bell, a crowd);
 *   `hitInfo` what each collision box makes when it is hit.
 */
export function createWorldAudio(audio, { ambient, weather, music, random = Math.random, objects = [], hitInfo = new Map(), onEvent = () => {} }) {
  let current = weather, disposed = false;
  const loops = [];
  const timers = (ambient?.oneShots ?? []).map((shot) => ({ shot, left: nextDelay(shot.timerMin, shot.timerMax, random) }));
  let musicVoice = null, rainVoice = null;
  const pending = [];

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
    rainVoice = current === 4 ? audio.play("RAIN4", { loop: true, gain: 0.55 }) : null;
  }

  function startMusic() {
    if (!music) return;
    // A level may name a tracker module instead of a WAV loop.
    musicVoice = /\.mod$/i.test(music) ? audio.playMod(music, { gain: 0.8 }) : audio.play(music, { loop: true, gain: 1, bus: "music" });
  }

  startLoops();
  startRain();
  startMusic();

  // Objects with a sound of their own: a moving one (the train) rumbles while it is within
  // earshot, a crossing bell rings while a train is close to it, a crowd roars when you are near.
  const emitters = objects.map((o) => ({ ...o, voice: null, pos: [...o.positionFt] }));
  const lastHit = new Map();
  let trainHornAt = -1e9, clock = 0;
  const near = (a, b, range) => Math.hypot(a[0] - b[0], a[2] - b[2]) < range;
  function updateEmitters(listener, moved) {
    const trains = emitters.filter((e) => e.moving);
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
    for (const t of timers) {
      t.left -= dt;
      if (t.left > 0) continue;
      t.left = nextDelay(t.shot.timerMin, t.shot.timerMax, random);
      if (!weatherMaskIncludes(t.shot.weatherMask, current)) continue;
      const angle = random() * Math.PI * 2, distance = 150 + random() * 500;
      audio.play(t.shot.wav, {
        gain: Math.min(1.5, t.shot.volume),
        position: [listener[0] + Math.sin(angle) * distance, listener[1] + 20, listener[2] + Math.cos(angle) * distance],
      });
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
    },
    /** Lightning flashed: the thunder follows after a moment. */
    thunder() {
      later(0.4 + random() * 2.2, () => { if (!disposed) audio.play(THUNDER[Math.floor(random() * THUNDER.length)], { gain: 0.9 }); });
    },
    /** A truck hit an object: the object's own sound, from where it is. */
    hit(sitIndex, force, position) {
      const info = hitInfo.get(sitIndex);
      if (!info || force < 600 || clock - (lastHit.get(sitIndex) ?? -1e9) < 0.6) return;
      const sound = objectHitSound(info);
      if (!sound) return;
      lastHit.set(sitIndex, clock);
      if (/^cowpain/i.test(sound.name)) onEvent("cow");
      audio.play(sound.name, { gain: Math.min(2.5, sound.gain), position });
    },
    checkpoint() { if (ambient?.checkpointWav) audio.play(ambient.checkpointWav, { gain: 0.9 }); },
    lapDone() { if (ambient?.finishLapWav) audio.play(ambient.finishLapWav, { gain: 0.9 }); },
    dispose() {
      disposed = true;
      for (const voice of loops) voice.then((v) => v?.stop());
      musicVoice?.then((v) => v?.stop());
      rainVoice?.then((v) => v?.stop());
      for (const e of emitters) e.voice?.then((v) => v?.stop());
    },
  };
}
