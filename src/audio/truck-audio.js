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

/** How long a hull impact's level lingers as the bar the next knock must clear (it falls to a third in this time). */
const IMPACT_FADE_S = 2;

export function createTruckAudio(audio, { count, player = 0, random = Math.random, kookyHorn = false, onHit = () => {} }) {
  const pick = (n) => 1 + Math.floor(random() * n);
  const trucks = Array.from({ length: count }, () => ({
    engine: null, heli: null, skid: null, skidName: null, gear: null, impactBusy: false, cooldown: 0, started: false,
  }));
  let disposed = false, lastHorn = -1;
  audio.preload?.(["SUSPEN1", "SUSPEN3", "SUSPEN5", "SUSPEN6", "2NDGEAR", "3RDGEAR", "SPLASH", "SPLASH1", "YEEHAW", "HUEY", "TERADCY1", "TERADCY2"]);

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
  function update(dt, poses, listener, clock, damaged = []) {
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
      // Which skid it is is decided without the random variant (`pick` of 1), so the loop runs on until the kind changes;
      // a variant is drawn only when a new loop starts. (Comparing the random names restarted the loop every frame.)
      const spec = { type: s.surface, spinning: s.throttle > 0.4 && s.speed < 30, speed: s.speed };
      // A skid starts above 0.08 of slip and runs on down to 0.03, so a tire hovering at the edge does not start and stop it every frame.
      const sliding = slip > (t.skidName ? 0.03 : 0.08) && s.speed > 6;
      const kind = near && sliding ? skidSample({ ...spec, pick: () => 1 }) : null;
      t.skidAge = (t.skidAge ?? 0) + dt;
      // A loop that is running stays at least a third of a second, whether it ends or gives way to another kind.
      if (kind !== t.skidName && !(t.skidName && t.skidAge < 0.35)) {
        t.skid?.then?.((voice) => voice?.stop());
        t.skidAge = 0;
        t.skidName = kind;
        t.skid = kind ? audio.play(skidSample({ ...spec, pick }), { loop: true, gain: 0, position: i === player ? null : pos }) : null;
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
      // Only the computer trucks: the player's horn and YeeHaw are the player's own keys.
      if (i !== player && near && t.airTime > 0.4 && t.cooldown === 0 && random() < dt * 0.5) {
        if (random() < 0.5) horn(i, pos); else yeehaw(i, pos);
        t.cooldown = 6;
      }

      // The helicopter (`huey.wav`, gain 1.4) hums from where it hangs; the pterodactyl that comes on every third call
      // has no hum and instead screeches (`Teradcy1/2.wav`, gain 1.5) at random 1 to 5 second intervals (0x41bbd0).
      const flyer = s.heliPos ?? pos;
      if (s.heli && s.heliTeryl && near) {
        t.screech = (t.screech ?? 0) - dt;
        if (t.screech <= 0) {
          audio.play(random() < 0.5 ? "TERADCY1" : "TERADCY2", { gain: 1.5, position: flyer });
          t.screech = 1 + random() * 4;
        }
      } else t.screech = 0;
      if (s.heli && !s.heliTeryl && !t.heli && near) t.heli = audio.play("HUEY", { loop: true, gain: 1.4, position: flyer });
      if (t.heli && (!s.heli || s.heliTeryl || !near)) { t.heli.then((voice) => voice?.stop()); t.heli = null; }
      if (t.heli) t.heli.then((voice) => voice?.setPosition(flyer));

      // Gear changes, hull impacts, landings, splashes.
      if (near) {
        const gear = gearSound(t.gear, s.gear);
        // One gear sound at a time per truck (the game stops the last before the next), and not within a second of the last.
        t.gearCooldown = Math.max(0, (t.gearCooldown ?? 0) - dt);
        if (gear && t.gear !== null && t.gearCooldown === 0) {
          t.gearVoice?.then((voice) => voice?.stop());
          t.gearVoice = audio.play(gear, { gain: 0.8, position: i === player ? null : pose.current.pos });
          t.gearCooldown = 1;
        }
        if (s.hit) onHit(s.hit.sitIndex, s.hit.force, pos, i);
        // The game starts a hull impact's sound only when the truck's last one has finished.
        // A new knock, not a truck lying on its hull: the game starts the sound whenever the last one has ended, so a rolled truck
        // resting on its roof crunched on to the end of the race. Here an impact must stand well above the level the truck has been
        // in contact at lately (`impactRef`), and be 1.2 s after the truck's last.
        t.impactGap = Math.max(0, (t.impactGap ?? 0) - dt);
        const knock = s.impact >= 900 && s.impact > (t.impactRef ?? 0) * 1.6 + 500;
        // The level is the recent peak, fading over a couple of seconds: after a crash the hull's scraping and
        // bouncing, far weaker than the hit but uneven, does not knock again and again.
        t.impactRef = Math.max(s.impact, (t.impactRef ?? 0) * Math.exp(-dt / IMPACT_FADE_S));
        const impact = knock ? impactSound(s.impact, !!damaged[i], pick) : null;
        if (impact && !t.impactBusy && t.impactGap === 0) {
          t.impactBusy = true;
          t.impactGap = 1.2;
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
