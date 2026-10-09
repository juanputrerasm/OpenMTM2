/*
  The trucks' sound in a race: per truck the engine's three loops, a skid loop that follows the
  surface, and one-shots for gear changes, hull impacts, landings and splashes. The sim sends each
  truck's `sound` state with its pose (worker/sim-worker.js soundOf); the choices are in
  game/sound-model.js. The player's truck is heard unpositioned, the others where they are.
*/
import { YEEHAW_GAIN, engineVoices, gearSound, hornSample, impactSound, skidAmount, skidSample } from "../game/sound-model.js";

const ENGINE_LOOPS = [["idle", "STARTIDL"], ["mid", "M1-2-M2"], ["accel", "ACCEL3B"]];
/** Trucks farther than this from the listener get no skid voice, and their one-shots are skipped, feet. */
const AUDIBLE_FT = 900;

export function createTruckAudio(audio, { count, player = 0, random = Math.random, kookyHorn = false, onHit = () => {} }) {
  const pick = (n) => 1 + Math.floor(random() * n);
  const trucks = Array.from({ length: count }, () => ({
    engine: null, heli: null, skid: null, skidName: null, gear: null, impactBusy: false, cooldown: 0, started: false,
  }));
  let disposed = false, lastHorn = -1;

  function startEngine(t, i, pose) {
    t.started = true;
    t.engine = {};
    for (const [key, name] of ENGINE_LOOPS) {
      audio.play(name, {
        loop: true, gain: 0, randomStart: true, position: i === player ? null : pose.current.pos,
      }).then((voice) => {
        if (disposed) voice?.stop();
        else t.engine[key] = voice;
      });
    }
  }

  function oneShot(name, gain, i, pose, rate = 1) {
    audio.play(name, { gain, rate, position: i === player ? null : pose.current.pos });
  }

  /** The horn (0x429490) and YeeHaw (0x429350) of a truck, from where it is. */
  function horn(i, pos) {
    const h = hornSample(kookyHorn, lastHorn, random);
    lastHorn = h.index;
    audio.play(h.name, { gain: h.gain, position: i === player ? null : pos });
  }
  function yeehaw(i, pos) {
    audio.play("YEEHAW", { gain: YEEHAW_GAIN, position: i === player ? null : pos });
  }

  /** `listener` is the camera's position in game feet; `clock` the race clock in seconds, or null. */
  function update(dt, poses, listener, clock) {
    poses.forEach((pose, i) => {
      const t = trucks[i], s = pose.sound;
      if (!s) return;
      const pos = pose.current.pos;
      const near = i === player || Math.hypot(pos[0] - listener[0], pos[2] - listener[2]) < AUDIBLE_FT;
      t.cooldown = Math.max(0, t.cooldown - dt);

      // The engine.
      if (!t.started && near) startEngine(t, i, pose);
      if (t.engine) {
        const v = engineVoices({
          rpm: s.rpm, throttle: s.throttle, airborne: s.airborne, raceClock: clock, player: i === player, random: random(),
        });
        for (const [key] of ENGINE_LOOPS) {
          const voice = t.engine[key];
          if (!voice) continue;
          voice.setGain(near ? v[key].gain : 0);
          voice.setRate(v[key].rate);
          if (i !== player) voice.setPosition(pos);
        }
      }

      // Skids: the surface's loop at the loudest tire's slip.
      const slip = Math.max(0, ...s.tires.map(skidAmount));
      const wanted = near && slip > 0.05 && s.speed > 6
        ? skidSample({ type: s.surface, spinning: s.throttle > 0.4 && s.speed < 30, speed: s.speed, pick }) : null;
      if (wanted !== t.skidName) {
        t.skid?.then?.((voice) => voice?.stop());
        t.skidName = wanted;
        t.skid = wanted ? audio.play(wanted, { loop: true, gain: 0, position: i === player ? null : pos }) : null;
      }
      if (t.skid) {
        t.skid.then((voice) => {
          if (!voice) return;
          voice.setGain(0.8 * slip);
          if (i !== player) voice.setPosition(pos);
        });
      }

      // Well up in the air with all four wheels off the ground, a truck may honk or whoop.
      t.airTime = s.airborne === 4 && !s.heli && s.clearance > 16 ? (t.airTime ?? 0) + dt : 0;
      if (near && t.airTime > 0.4 && t.cooldown === 0 && random() < dt * 0.5) {
        if (random() < 0.5) horn(i, pos); else yeehaw(i, pos);
        t.cooldown = 6;
      }

      // The helicopter that sets a stuck truck back on its wheels (`huey`).
      if (s.heli && !t.heli && near) t.heli = audio.play("HUEY", { loop: true, gain: 0.8, position: i === player ? null : pos });
      if (t.heli && (!s.heli || !near)) { t.heli.then((voice) => voice?.stop()); t.heli = null; }
      if (t.heli && i !== player) t.heli.then((voice) => voice?.setPosition(pos));

      // Gear changes, hull impacts, landings, splashes.
      if (near) {
        const gear = gearSound(t.gear, s.gear);
        if (gear && t.gear !== null) oneShot(gear, 0.8, i, pose);
        if (s.hit) onHit(s.hit.sitIndex, s.hit.force, pos, i);
        // The game starts a hull impact's sound only when the truck's last one has finished.
        const impact = impactSound(s.impact, false, pick);
        if (impact && !t.impactBusy) {
          t.impactBusy = true;
          audio.play(impact.name, { gain: impact.gain, position: i === player ? null : pos })
            .then((voice) => (voice ? voice.done : null)).finally(() => { t.impactBusy = false; });
        }
        if (s.splash && t.cooldown === 0) { oneShot(random() < 0.5 ? "SPLASH" : "SPLASH1", 0.9, i, pose); t.cooldown = 0.6; }
      }
      t.gear = s.gear;
    });
  }

  function dispose() {
    disposed = true;
    for (const t of trucks) {
      for (const voice of Object.values(t.engine ?? {})) voice?.stop();
      t.skid?.then?.((voice) => voice?.stop());
      t.heli?.then?.((voice) => voice?.stop());
    }
  }

  return { update, dispose, horn, yeehaw };
}
