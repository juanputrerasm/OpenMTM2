/*
  A network race's glue between the network sessions and the race screen (docs/MULTIPLAYER.md,
  MONSTER_EXE_ANALYSIS.md 14.4). It speaks neutral events, so the classic session (MTM2's packets)
  and the room session (the room protocol) share it:

    { kind: "state", vehicle, pos, bvel, euler, steer, throttle, brakeRear, brakeFront?, gear, autoShift, score, seq? }
    { kind: "split", vehicle, next, split }      a truck's checkpoint pass
    { kind: "positions", positions }             start positions by vehicle number
    { kind: "go" }                               the race starts now
    { kind: "gone", vehicle }                    that player left the race
    { kind: "damage", vehicle, code }            { kind: "lights", vehicle, lamps }
    { kind: "horn", vehicle }                    { kind: "yeehaw", vehicle }
    { kind: "mode", data }                       an extension's state from the room owner (rooms only)
    { kind: "modeTruck", vehicle, data }         an extension's state for the trucks one machine drives (rooms only)
    { kind: "wheels", vehicle, lost, axles, wear, repairs, pits }   a truck's Wheels damage (rooms only)

  Vehicle numbers are the network's (the game's 1-based slots); local indexes are the race
  screen's trucks, the local player always 0. `receive` turns events into commands for the sim
  worker (drained by `commands()`, sent with the next tick) and into things the screen shows
  (`effects()`); `collect` turns a tick's reply into the events this machine sends.
*/

/** How often the room owner sends an extension's state when nothing happened (an event goes at once). */
export const MODE_HZ = 5;
/** How often a truck's wheel wear is sent when only the wear changed (a lost wheel or a repair goes at once). */
export const WHEEL_WEAR_HZ = 1;

/**
 * @param {{ entrants: { vehicle: number, owned: boolean }[], rateHz: number, policy?: string,
 *   mode?: { toWire(state, vehicleOf), fromWire(data, localOf, count), ownToWire?(state, vehicleOf), ownFromWire?(data, localOf, count) } }} options
 *   `entrants` in local order (index 0 the local player); `owned` trucks are simulated here and sent (the player's, and
 *   the computer trucks' on the host). `mode`: an extension race in a room (game/extensions/race-loader.js).
 */
export function createNetRace({ entrants, rateHz, mode = null }) {
  const localOf = new Map(entrants.map((e, i) => [e.vehicle, i]));
  const vehicleOf = entrants.map((e) => e.vehicle);
  const owned = entrants.map((e) => !!e.owned);
  const interval = 1000 / rateHz;
  let nextSend = -Infinity;
  let seq = 0;
  let pending = [];
  let shown = [];
  let started = false;
  // What was last sent, so a change is sent once.
  const sentDamage = entrants.map(() => 0);
  const sentNext = entrants.map(() => null);
  const lastPass = entrants.map(() => 0);
  const gone = new Set();
  let nextMode = -Infinity, modeMark = null, nextOwn = -Infinity, ownMark = null;
  // Wheels damage: what was last sent per truck, and when the wear may go next.
  const sentWheels = entrants.map(() => null), nextWear = entrants.map(() => -Infinity);

  const command = (name, value) => pending.push({ name, value });

  /** One event from another machine. Returns whether it was used. */
  function receive(e) {
    const local = e.vehicle === undefined ? null : localOf.get(e.vehicle);
    if (e.vehicle !== undefined && (local === undefined || owned[local])) return false;
    switch (e.kind) {
      case "state":
        if (gone.has(local)) return false;
        command("remote", [{ ...e, truck: local }]);
        return true;
      case "split":
        command("split", { truck: local, next: e.next, split: e.split });
        return true;
      case "positions": {
        const byLocal = entrants.map((x) => e.positions[x.vehicle] ?? null);
        command("startPositions", byLocal);
        return true;
      }
      case "go":
        if (started) return false;
        started = true;
        command("raceStart", true);
        return true;
      case "gone":
        if (gone.has(local)) return false;
        gone.add(local);
        command("handOver", local);
        shown.push({ kind: "gone", truck: local });
        return true;
      case "mode": {
        const state = mode?.fromWire(e.data, (v) => localOf.get(v), entrants.length);
        if (!state) return false;
        command("mode", state);
        return true;
      }
      case "wheels": {
        const { vehicle, kind, ...wheels } = e;
        command("wheelsOwn", [{ ...wheels, truck: local }]);
        return true;
      }
      case "modeTruck": {
        const state = mode?.ownFromWire?.(e.data, (v) => localOf.get(v), entrants.length);
        if (!state) return false;
        command("modeOwn", { ...state, from: local });
        return true;
      }
      case "damage":
      case "lights":
      case "horn":
      case "yeehaw": {
        const { vehicle, kind, ...rest } = e;
        shown.push({ kind, truck: local, ...rest });
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * What this machine sends after a tick: the state of every owned truck at the send rate, and each checkpoint pass and
   * damage change at once. `reply` is the sim worker's tick reply; `damageCode(i)` a truck's current code; `now` in ms.
   */
  function collect(reply, now, damageCode = () => 0) {
    const out = [];
    const race = reply?.race;
    // The first machine whose countdown ends starts everyone's race (0x19); one that was told first stays quiet.
    if (race && !started && race.started) {
      started = true;
      out.push({ kind: "go" });
    }
    if (reply?.net && now >= nextSend) {
      nextSend = Math.max(now, nextSend + interval);
      seq++;
      for (const s of reply.net) {
        if (!owned[s.truck] || gone.has(s.truck)) continue;
        out.push({ ...s, kind: "state", vehicle: vehicleOf[s.truck], seq, truck: undefined });
      }
    }
    // The room owner's extension state: at MODE_HZ, and at once when something happened.
    if (reply?.modeNet && mode) {
      const s = reply.modeNet;
      const mark = `${s.events}:${s.resets ?? 0}:${s.phase ?? ""}:${s.it ?? ""}:${s.over}`;
      if (now >= nextMode || mark !== modeMark) {
        nextMode = now + 1000 / MODE_HZ;
        modeMark = mark;
        out.push({ kind: "mode", data: mode.toWire(s, (i) => vehicleOf[i] ?? 0) });
      }
    }
    // The state of the trucks this machine judges (a mode that judges each where it is driven): at MODE_HZ, at once on
    // a change that must be heard (`mark`), as this player's vehicle.
    if (reply?.modeOwn && mode?.ownToWire) {
      const s = reply.modeOwn;
      if (now >= nextOwn || s.mark !== ownMark) {
        nextOwn = now + 1000 / MODE_HZ;
        ownMark = s.mark;
        out.push({ kind: "modeTruck", vehicle: vehicleOf[0], data: mode.ownToWire(s, (i) => vehicleOf[i] ?? 0) });
      }
    }
    // Wheels damage: each owned truck's wheels, at once on a lost wheel or a repair, the wear alone at WHEEL_WEAR_HZ.
    for (const w of reply?.wheelsOwn ?? []) {
      const i = w.truck;
      if (!owned[i] || gone.has(i)) continue;
      const mark = `${w.lost}:${w.axles}:${w.repairs}:${w.pits}`, wear = (w.wear ?? []).join(",");
      const last = sentWheels[i];
      if (last && last.mark === mark && (last.wear === wear || now < nextWear[i])) continue;
      if (!last && !w.lost && !w.axles && !w.repairs && (w.wear ?? []).every((v) => v >= 1)) { sentWheels[i] = { mark, wear }; continue; }
      sentWheels[i] = { mark, wear };
      nextWear[i] = now + 1000 / WHEEL_WEAR_HZ;
      out.push({ kind: "wheels", vehicle: vehicleOf[i], lost: w.lost, axles: w.axles, wear: w.wear, repairs: w.repairs, pits: w.pits });
    }
    entrants.forEach((_, i) => {
      if (!owned[i]) return;
      const rt = race?.trucks?.[i];
      if (rt && race.started) {
        // The pass the truck has just made: its next checkpoint changed, or it finished a lap (0x0b).
        const mark = `${rt.laps}:${rt.checkpoint}`;
        if (sentNext[i] === null) sentNext[i] = mark;
        else if (sentNext[i] !== mark) {
          sentNext[i] = mark;
          // The split: race time since the truck's last pass (to the frame).
          const split = Math.max(0, (race.clock ?? 0) - lastPass[i]);
          lastPass[i] = race.clock ?? 0;
          out.push({ kind: "split", vehicle: vehicleOf[i], next: rt.checkpoint, split });
        }
      }
      const code = damageCode(i) >>> 0;
      if (code !== sentDamage[i]) {
        sentDamage[i] = code;
        out.push({ kind: "damage", vehicle: vehicleOf[i], code });
      }
    });
    return out;
  }

  /** The commands for the sim worker since the last call (send them with the next tick). */
  function commands() {
    const out = pending;
    pending = [];
    return out;
  }
  /** What the screen must show since the last call: remote horn, YeeHaw, damage, lights and leavers, by local index. */
  function effects() {
    const out = shown;
    shown = [];
    return out;
  }

  return {
    receive, collect, commands, effects,
    localOf: (vehicle) => localOf.get(vehicle) ?? null,
    vehicleOf: (local) => vehicleOf[local] ?? null,
    owned: (local) => !!owned[local],
    isGone: (local) => gone.has(local),
    /** This machine now decides the extension's state (the room's owner left), or no longer does. */
    authority: (on) => command("modeAuthority", !!on),
    /** Our own truck's horn, YeeHaw or headlights, to send at once. */
    local: (kind, extra = {}) => ({ kind, vehicle: vehicleOf[0], ...extra }),
  };
}
