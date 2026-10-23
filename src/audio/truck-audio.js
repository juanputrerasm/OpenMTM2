/*
  The trucks' sound in a race: per truck the engine's three loops, a corner and a wheelspin loop on
  each rear tire that follow its surface, the water and bridge loops, and one-shots for gear changes,
  hull impacts and splashes. The sim sends each truck's `sound` state with its pose
  (worker/sim-worker.js soundOf); the rules are in game/sound-model.js. The player's truck is heard
  unpositioned, the others where they are.
*/
import {
  BRIDGE_SURFACES, YEEHAW_GAIN, bridgeVoice, cornerSample, engineVoices, gearSound, hornSample, impactSound, skidRate, skidSurface,
  spinAction, spinSample, splashGain, tireSliding, variantPicker, wadeGain,
  MTM1_SKID_SPEED, mtm1CornerSample, mtm1SkidSample, mtm1SpinSample, mtm1Variant,
} from "../game/sound-model.js";

const ENGINE_LOOPS = [["idle", "STARTIDL"], ["mid", "M1-2-M2"], ["accel", "ACCEL3B"]];
/** The rear tires (RR, RL): the only ones with skid voices. */
const REAR = [2, 3];
/** Trucks farther than this from the listener get no skid voice, and their one-shots are skipped, feet. */
const AUDIBLE_FT = 900;

/** How long a hull impact's level lingers as the bar the next knock must clear (it falls to a third in this time). */
const IMPACT_FADE_S = 2;

export function createTruckAudio(audio, { count, player = 0, random = Math.random, kookyHorn = false, mtm1Sounds = false, onHit = () => {} }) {
  const pick = (n) => 1 + Math.floor(random() * n);
  const trucks = Array.from({ length: count }, () => ({
    engine: null, heli: null, gear: null, impactBusy: false, cooldown: 0, started: false,
    rear: REAR.map((tire) => ({ tire, code: -1, corner: null, spin: null })), sliding: [false, false, false, false], throttle: 0, brake: 0,
    inWater: false, wade: null, bridges: BRIDGE_SURFACES.map(() => null),
  }));
  // The corner and the wheelspin each keep their own last variant, as their routines do.
  const cornerPick = variantPicker(random), spinPick = variantPicker(random);
  let disposed = false, lastHorn = -1;
  audio.preload?.([
    "SUSPEN1", "SUSPEN3", "SUSPEN5", "SUSPEN6", "2NDGEAR", "3RDGEAR", "SPLASH1", "WTR-ABV1", "YEEHAW", "HUEY", "TERADCY1", "TERADCY2",
    "SKID-C2", "SKID-D1", "SKID-D2", "SKID-G1", "SKID-G2", "SKID-G3", "SNWSKID5", "SNWSKID6", "SNWSKID7", "SPINICE", "SPINROC1", "SPINROC2", "SPINROC3",
  ]);

  /** A looping voice kept by its handle: `{ promise, voice, ended }`, `voice` once it has started. */
  function loopVoice(name, gain, rate, position) {
    const handle = { promise: null, voice: null, ended: false };
    handle.promise = audio.play(name, { loop: true, gain, rate, position }).then((voice) => {
      if (disposed || handle.ended) voice?.stop();
      else if (voice) handle.voice = voice;
      else handle.ended = true;
      return voice;
    });
    return handle;
  }
  const playing = (handle) => !!handle && !handle.ended && !(handle.voice?.stopped);
  const stopLoop = (handle) => { if (!handle) return null; handle.ended = true; handle.voice?.stop(); return null; };

  /**
   * Start a rear tire's corner or spin loop for its surface, unless one plays (0x4297a0, 0x429840). With "MTM1 sounds"
   * (MTM1_MONSTER_EXE_ANALYSIS.md 6.7) MTM1's samples, and only from the RL tire: MTM1 has one of each a truck.
   */
  function startSkid(r, kind, i, pos) {
    if (playing(r[kind])) return;
    if (mtm1Sounds && r.tire !== 3) return;
    const sample = mtm1Sounds
      ? kind === "corner" ? mtm1CornerSample(r.code) : mtm1SpinSample(r.code, mtm1Variant(random))
      : kind === "corner" ? cornerSample(r.code, cornerPick) : spinSample(r.code, spinPick);
    r[kind] = sample ? loopVoice(sample.name, sample.gain * (i === player ? 1 : 0.9), skidRate(random), i === player ? null : pos) : null;
  }

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

      // Skids (0x41bbd0, 0x47c480, 0x477520): no braking skid, a corner loop and a spin loop per rear tire.
      if (!near) {
        for (const r of t.rear) { r.corner = stopLoop(r.corner); r.spin = stopLoop(r.spin); }
      } else {
        // A rear tire on a new surface: the loops that play start over with the new surface's sample.
        REAR.forEach((k, j) => {
          const r = t.rear[j], code = skidSurface(s.tires[k]?.surface, s.tires[k]?.onGround, s.weather);
          if (code === r.code) return;
          r.code = code;
          for (const kind of ["corner", "spin"]) if (playing(r[kind])) { r[kind] = stopLoop(r[kind]); startSkid(r, kind, i, pos); }
        });
        const slid = t.sliding.some(Boolean);
        t.sliding = s.tires.map((tire, k) => tireSliding(t.sliding[k], tire, s.speed));
        const slides = t.sliding.some(Boolean);
        if (!slid && slides) for (const r of t.rear) startSkid(r, "corner", i, pos);
        if (slid && !slides) for (const r of t.rear) r.corner = stopLoop(r.corner);
        const spin = spinAction({ throttle: s.throttle, wasThrottle: t.throttle, forward: s.forward, tires: s.tires });
        if (spin === "start") for (const r of t.rear) startSkid(r, "spin", i, pos);
        if (spin === "stop") for (const r of t.rear) { r.corner = stopLoop(r.corner); r.spin = stopLoop(r.spin); }
        if (i !== player) for (const r of t.rear) for (const kind of ["corner", "spin"]) r[kind]?.voice?.setPosition(pos);
      }
      t.throttle = s.throttle;
      // MTM1's brake skid (0x43d050): the brake going on from fully off, fast enough: each rear tire's, once.
      if (mtm1Sounds && near && s.brake > 0 && t.brake <= 0 && s.speed > MTM1_SKID_SPEED) {
        for (const r of t.rear) {
          const sample = mtm1SkidSample(r.code, mtm1Variant(random));
          if (sample) oneShot(sample.name, sample.gain * (i === player ? 1 : 0.9), i, pose);
        }
      }
      t.brake = s.brake ?? 0;

      // Water (0x41bbd0): a splash on going in, by how fast the truck came down, and the wading loop while in.
      // A truck along the water's edge goes in and out: a splash needs half a second out of the water before it.
      if (near && s.inWater && !t.inWater && (t.dryFor ?? Infinity) > 0.5) {
        const gain = splashGain(s.vy);
        if (gain !== null) oneShot("SPLASH1", gain, i, pose);
      }
      t.dryFor = s.inWater ? 0 : (t.dryFor ?? Infinity) + dt;
      t.inWater = !!s.inWater;
      if (near && s.inWater) {
        if (!playing(t.wade)) t.wade = loopVoice("WTR-ABV1", wadeGain(s.speed), 1, i === player ? null : pos);
        t.wade.voice?.setGain(wadeGain(s.speed));
        if (i !== player) t.wade.voice?.setPosition(pos);
      } else t.wade = stopLoop(t.wade);

      // Bridges (0x41ec90): BRIDGE1 while a tire on the ground stands on wood (1100) or 1400 and the truck moves.
      BRIDGE_SURFACES.forEach((code, b) => {
        const on = near && s.tires.some((tire) => tire.onGround && Math.floor(tire.surface / 100) * 100 === code);
        const v = on ? bridgeVoice(s.speed) : null;
        if (!v) { t.bridges[b] = stopLoop(t.bridges[b]); return; }
        const gain = v.gain * (i === player ? 1 : 0.9);
        if (!playing(t.bridges[b])) t.bridges[b] = loopVoice("BRIDGE1", gain, v.rate, i === player ? null : pos);
        t.bridges[b].voice?.setGain(gain);
        t.bridges[b].voice?.setRate(v.rate);
        if (i !== player) t.bridges[b].voice?.setPosition(pos);
      });

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

      // Gear changes and hull impacts.
      if (near) {
        const gear = gearSound(t.gear, s.gear);
        // One gear sound at a time per truck (the game stops the last before the next), and not within a second of the last.
        t.gearCooldown = Math.max(0, (t.gearCooldown ?? 0) - dt);
        if (gear && t.gear !== null && t.gearCooldown === 0) {
          t.gearVoice?.then((voice) => voice?.stop());
          t.gearVoice = audio.play(gear, { gain: 0.8, position: i === player ? null : pose.current.pos });
          t.gearCooldown = 1;
        }
        // The object's sound comes from the object, `offset` feet from the truck.
        if (s.hit) onHit(s.hit.sitIndex, s.hit.force, s.hit.offset ? [0, 1, 2].map((k) => pos[k] + s.hit.offset[k]) : pos, i);
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
      }
      t.gear = s.gear;
    });
  }

  function dispose() {
    disposed = true;
    for (const t of trucks) {
      for (const voice of Object.values(t.engine ?? {})) voice?.stop();
      for (const r of t.rear) { stopLoop(r.corner); stopLoop(r.spin); }
      stopLoop(t.wade);
      t.bridges.forEach(stopLoop);
      t.heli?.then?.((voice) => voice?.stop());
    }
  }

  return { update, dispose, horn, yeehaw };
}
