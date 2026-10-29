/*
  A classic network game: Monster Truck Madness 2's own lobby and race protocol over DirectPlay
  (MONSTER_EXE_ANALYSIS.md 14), so OpenMTM2 plays with the retail game. No DOM: runs in the page
  and under Node in tests.

  `createLegacySession({ transport, me, hasTrack, trackCrc, now })`:
    transport   transport.js; the bridge's in the page, the loopback in tests. Its ids are DPIDs.
    me          { name, truck, skill } this player
    hasTrack    (sit) -> boolean, whether the track is installed
    trackCrc    (sit) -> Promise<number>, its checksum (packet 0x25)

  The screens read `state()` and listen for "change", "chat", "notice", "start", "race", "sound",
  "left" ({ reason }). The race screen uses `raceLink()` once the race starts.

  The host's player list (MONSTER_EXE_ANALYSIS.md 14.2): the host announces every player with 0x81
  and 0x82, which is all a Community Patch 3 direct connect client hears of the others (14.5). The
  truck name's form (H) is used as the analysis guesses it.
*/
import { createEmitter } from "./transport.js";
import { msg } from "../game/strings.js";
import {
  encodePacket, decodePacket, TYPES, GUARANTEED, MTM2_NET_VERSION, BARRIER, EXIT_CANCELLED,
  stateFields, stateFromPacket, pingTime, pingMs,
} from "./vendor/mtmnet/mtm2-packets.js";

/** Locations (the Status column, 0x514175). */
export const LOCATION = Object.freeze({
  START: 1, DRIVERS: 2, RACES: 3, GARAGE: 4, MULTIPLAYER: 5, HALL: 6, RESULTS: 7, REPLAY: 8, RACING: 9,
});
/** The words below are tags (game/strings.js): the screens show them through `t`. */
const LOCATION_TEXT = { 1: msg("Start Screen"), 2: msg("Driver Check-in"), 3: msg("Race Screen"), 4: msg("Garage"), 5: msg("Multiplayer Screen"), 6: msg("Hall Of Fame"), 7: msg("Viewing Results"), 8: msg("Instant Replay"), 9: msg("Racing!") };
const SKILL_TEXT = [msg("Rookie"), msg("Intermediate"), msg("Professional")];

/** The Status column for a player. */
export function statusText(p) {
  if (p.ready) return p.location === LOCATION.RACING ? msg("Racing!") : msg("Ready");
  return LOCATION_TEXT[p.location] ?? msg("Unknown");
}
/** The Latency column: local, unknown, or Low / Normal / High by the round trip. */
export function latencyText(p) {
  if (p.local) return msg("Local");
  if (p.latency === null || p.latency === undefined) return msg("Unknown");
  return p.latency < 500 ? msg("Low") : p.latency < 1501 ? msg("Normal") : msg("High");
}
/** A player's round trip in ms, for a figure beside the Latency column's word; null when none is measured. */
export const latencyMs = (p) => (Number.isFinite(p?.latency) && (p.latency > 0 || !p.local) ? Math.round(p.latency) : null);
/** The Level column. */
export const skillText = (skill) => SKILL_TEXT[skill] ?? "";
/** The Player column's suffix for a version other than 2.00.42's ("Version 2.04"). */
export function versionText(version) {
  if (!version || version === MTM2_NET_VERSION) return "";
  const minor = version & 0xff;
  return ` (Version ${version >> 8}.${minor < 10 ? "0" : ""}${minor})`;
}

/** The sync barrier waits up to 120 s, the results barrier 30 s; both resend every second. */
export const SYNC_WAIT_S = 120, RESULTS_WAIT_S = 30;
/** The lobby pings the next human every 5 s for the Latency column. */
export const PING_EVERY_MS = 5000;

export function createLegacySession({ transport, me, hasTrack = () => true, trackCrc = async () => -1, now = () => Date.now(), random = Math.random }) {
  const events = createEmitter();
  const self = transport.self;
  /** Every player by DPID, this machine's included. */
  const players = new Map();
  const local = {
    dpid: self, name: me.name, truck: me.truck ?? "", skill: me.skill ?? 1, location: LOCATION.MULTIPLAYER, ready: false,
    team: 0, version: MTM2_NET_VERSION, latency: 0, local: true, computer: false, slot: null, barrier: 0, setup: [1, 1, 600, 1, 0],
  };
  players.set(self, local);
  let hostId = transport.host?.() ?? (transport.isHost?.() ? self : null);
  /** What the host set: the track `{ sit, name }`, laps, weather (-1 Random), team play, and the track's checksum. */
  const game = { track: null, laps: 3, weather: 0, teamPlay: false, crc: null, open: true };
  let pingTurn = 0, lastPing = 0;
  let race = null;
  let closed = false;

  const isHost = () => hostId === self;
  const send = (to, kind, fields = {}) => {
    if (closed) return;
    const bytes = encodePacket(kind, fields, self);
    transport.send(to ?? null, bytes, { reliable: GUARANTEED.has(TYPES[kind]) });
  };
  const changed = () => events.emit("change", state());
  const notice = (code, text, extra = {}) => events.emit("notice", { code, text, ...extra });

  function newPlayer(dpid, name) {
    if (players.has(dpid)) return players.get(dpid);
    const p = { dpid, name: name ?? "", truck: "", skill: 1, location: LOCATION.MULTIPLAYER, ready: false, team: 0, version: MTM2_NET_VERSION, latency: null, local: false, computer: false, slot: null, barrier: 0, setup: null };
    players.set(dpid, p);
    return p;
  }
  /**
   * The host's player list (14.2): everyone hears of the newcomer (0x81); the newcomer hears of every player already
   * listed (0x81), of the active ones (0x82) and of the host (0x88).
   */
  function announce(dpid) {
    if (!isHost()) return;
    const p = players.get(dpid);
    if (!p) return;
    send(null, "addPlayer", { name: p.name, dpid });
    for (const q of players.values()) if (q.dpid !== dpid && !q.computer) send(dpid, "addPlayer", { name: q.name, dpid: q.dpid });
    for (const q of players.values()) if (q.dpid !== dpid && !q.computer) send(dpid, "activatePlayer", { name: q.name, dpid: q.dpid, flag: 1 });
    send(dpid, "host", { dpid: self });
  }
  /** What a newcomer is told (MONSTER_EXE_ANALYSIS.md 14.3): our info, and from the host the game's settings. */
  function greet(dpid) {
    send(dpid, "info", {
      truck: local.truck, status: local.ready ? 1 : 0, version: MTM2_NET_VERSION, location: local.location,
      skill: local.skill, setup: local.setup, team: local.team, unknown1: 1, unknown2: 0,
    });
    if (!isHost()) return;
    if (game.track) send(dpid, "track", { sit: game.track.sit, name: game.track.name });
    send(dpid, "laps", { laps: game.laps });
    send(dpid, "weather", { weather: game.weather });
    send(dpid, "teamPlay", { on: game.teamPlay ? 1 : 0 });
    if (game.track && game.crc !== null) send(dpid, "checksum", { sit: game.track.sit, name: game.track.name, crc: game.crc });
  }

  // ---- Transport events ----
  const off = [
    transport.on("peer", ({ id, name, joined }) => {
      if (joined) {
        const known = players.has(id);
        const p = newPlayer(id, name);
        if (name && !p.name) p.name = name;
        // A player first heard of through the host's 0x81 was greeted then.
        if (!known) greet(id);
        announce(id);
      } else {
        // Ours: the host also tells the others with 0x83, for CP3 direct connect clients, who hear of no one else.
        if (isHost() && players.has(id)) send(null, "removePlayer", { dpid: id });
        gone(id);
      }
      changed();
    }),
    transport.on("host", (id) => {
      const was = hostId;
      hostId = id;
      if (id === self && was !== self) {
        // A new host (0x88), and in the lobby the game is cancelled (0x0e 9) and the list opened again.
        send(null, "host", { dpid: self });
        if (!race) {
          send(null, "exit", { code: EXIT_CANCELLED });
          for (const p of players.values()) p.ready = false;
          for (const [id2, p] of players) if (p.computer) players.delete(id2);
          game.open = true;
        }
      }
      notice("host", isHost() ? "You are now the host." : `${players.get(id)?.name ?? "Another player"} is now the host.`);
      changed();
    }),
    transport.on("lost", (reason) => end(typeof reason === "string" ? reason : reason?.reason ?? "lost")),
    transport.on("message", (from, bytes) => {
      let p;
      try { p = decodePacket(bytes); } catch { return; }
      // The game takes the sender from the packet, not from DirectPlay (14.1).
      receive(p.sender || from, p);
    }),
  ];

  function receive(from, p) {
    const who = players.get(from) ?? newPlayer(from);
    switch (p.kind) {
      case "info":
        Object.assign(who, { truck: p.truck, ready: !!p.status, version: p.version, location: p.location, skill: p.skill, setup: p.setup, team: p.team });
        if (p.version !== MTM2_NET_VERSION) {
          notice(p.version < MTM2_NET_VERSION ? "olderVersion" : "newerVersion",
            `${who.name || "A player"} runs ${p.version < MTM2_NET_VERSION ? "an older" : "a newer"} version of the game${versionText(p.version)}.`);
        }
        break;
      case "truck": who.truck = p.truck; break;
      case "skill": who.skill = p.skill; break;
      case "location": who.location = p.location; break;
      case "ready": case "ready0": who.ready = !!p.ready; break;
      case "track":
        game.track = { sit: p.sit, name: p.name };
        game.crc = null;
        if (!hasTrack(p.sit)) {
          send(from, "noTrack", { name: p.name });
          notice("noTrack", `You do not have this track: ${p.name}.`);
        } else {
          trackCrc(p.sit).then((crc) => { game.crc = crc; send(from, "checksum", { sit: p.sit, name: p.name, crc }); changed(); }).catch(() => {});
        }
        break;
      case "noTrack":
        notice("theyLackTrack", `${who.name} does not have the track ${p.name}.`);
        who.missingTrack = true;
        break;
      case "checksum":
        if (game.crc !== null && p.crc !== game.crc) notice("trackVersion", `${who.name} has a different version of ${p.name}.`);
        who.trackCrc = p.crc;
        break;
      case "laps": game.laps = p.laps; break;
      case "weather": game.weather = p.weather; break;
      case "teamPlay":
        game.teamPlay = !!p.on;
        notice("teams", game.teamPlay ? "Team Play is Active" : "Team Play is Inactive");
        break;
      case "joinTeam":
        who.team = p.team;
        notice("joinTeam", `${who.name} has joined team ${p.team + 1}.`);
        break;
      case "chat":
        events.emit("chat", { from, name: who.name, text: p.text, private: !!p.private });
        break;
      case "quick":
        events.emit("chat", { from, name: who.name, text: p.text, quick: true });
        break;
      case "ridicule":
        events.emit("sound", { kind: "ridicule", n: p.n, from, name: who.name });
        break;
      case "horn": case "yeehaw":
        if (race && p.truck >= 0) race.incoming({ kind: p.kind, vehicle: p.truck });
        else events.emit("sound", { kind: p.kind, from });
        break;
      case "ping":
        send(from, "pong", { time: p.time });
        break;
      case "pong":
        who.latency = Math.round(pingMs(p.time, pingTime(now())));
        break;
      case "exit":
        if (race) { race.hostEnded(p.code); break; }
        // The host cancelled: everyone is not ready again.
        for (const q of players.values()) q.ready = false;
        break;
      case "kick":
        end("removed");
        return;
      case "host":
        hostId = p.dpid;
        break;
      case "listState":
        game.open = !p.a;
        break;
      case "slot":
        if (players.has(p.dpid)) players.get(p.dpid).slot = p.slot;
        break;
      case "addPlayer": case "activatePlayer": {
        // The host's player list (14.2): a player not known yet is created, and greeted as on DirectPlay's create
        // player. Over CP3's direct connect this is the only news of the others (14.5).
        if (p.dpid === self) break;
        const known = players.has(p.dpid);
        const q = newPlayer(p.dpid, p.name);
        if (p.name && !q.name) q.name = p.name;
        if (!known) greet(p.dpid);
        break;
      }
      case "removePlayer":
        if (p.dpid !== self) gone(p.dpid);
        break;
      case "start":
        startRace({ sit: p.sit, laps: p.laps, weather: p.weather, host: from });
        break;
      default:
        if (race) race.packet(from, p);
        return;
    }
    changed();
  }

  /** A player left: by DirectPlay's report, or the host's 0x83. */
  function gone(id) {
    const p = players.get(id);
    if (!p) return;
    players.delete(id);
    if (race) race.leaver(p);
    notice("left", `${p.name} has left the game.`, { name: p.name });
  }

  // ---- What this player does ----

  function setLocation(location) {
    local.location = location;
    send(null, "location", { location });
    changed();
  }
  function setReady(ready) {
    local.ready = !!ready;
    send(null, "ready", { ready: local.ready ? 1 : 0 });
    changed();
  }
  function setTruck(truck) {
    local.truck = truck;
    send(null, "truck", { truck });
    changed();
  }
  function setSkill(skill) {
    local.skill = skill;
    send(null, "skill", { skill });
    changed();
  }
  /** Chat to everyone, or privately to one player (0x80). */
  function chat(text, to = null) {
    const t = String(text).slice(0, 81);
    send(to, "chat", { flag: 0, private: to ? 1 : 0, text: t });
    events.emit("chat", { from: self, name: local.name, text: t, private: !!to, own: true });
  }
  /** A quick message (0x0d, the game's `<<1>> says "<<2>>"`), shown here too. */
  function quick(text) {
    const t = String(text).slice(0, 43);
    send(null, "quick", { text: t });
    events.emit("chat", { from: self, name: local.name, text: t, quick: true, own: true });
  }
  const ridicule = (n) => send(null, "ridicule", { n });
  const horn = () => send(null, "horn", { truck: -1 });
  const yeehaw = () => send(null, "yeehaw", { truck: -1 });
  function joinTeam(team) {
    local.team = team;
    send(null, "joinTeam", { team });
    changed();
  }

  // ---- The host's settings ----

  function requireHost() { if (!isHost()) throw new Error("Only the host can do that."); }
  async function setTrack(track) {
    requireHost();
    game.track = { sit: track.sit, name: track.name };
    game.crc = await trackCrc(track.sit).catch(() => -1);
    for (const p of players.values()) { p.missingTrack = false; p.trackCrc = undefined; }
    send(null, "track", game.track);
    changed();
  }
  function setLaps(laps) {
    requireHost();
    game.laps = laps;
    send(null, "laps", { laps });
    changed();
  }
  function setWeather(weather) {
    requireHost();
    game.weather = weather;
    send(null, "weather", { weather });
    changed();
  }
  function setTeamPlay(on) {
    requireHost();
    game.teamPlay = !!on;
    send(null, "teamPlay", { on: on ? 1 : 0 });
    changed();
  }
  function kick(dpid) {
    requireHost();
    send(dpid, "kick");
  }
  // Computer opponents in a classic game are not offered: how the game announces them is not known (0x81 and 0x82
  // are the host's list of every player, 14.2).
  /** Whether the host may start: a track no player lacks (0x26), and every human ready. */
  const canStart = () => isHost() && !!game.track && [...players.values()].every((p) => p.local || p.computer || (p.ready && !p.missingTrack));

  /**
   * Start the race (host): shuffle the list (5n random swaps), close it, give every player its slot (its grid place and
   * vehicle number), then 0x14 with Random weather resolved (`resolveWeather`, from the track's allowed weathers).
   */
  function start({ weather = game.weather, resolveWeather = () => 0 } = {}) {
    requireHost();
    if (!game.track) throw new Error("Choose a track first.");
    const list = [...players.values()];
    for (let k = 0; k < 5 * list.length; k++) {
      const i = Math.floor(random() * list.length), j = Math.floor(random() * list.length);
      [list[i], list[j]] = [list[j], list[i]];
    }
    send(null, "listState", { a: 1, b: 0, c: 0 });
    list.forEach((p, i) => {
      p.slot = i + 1;
      send(null, "slot", { dpid: p.dpid, slot: p.slot });
    });
    const resolved = weather < 0 ? resolveWeather() : weather;
    send(null, "start", { sit: game.track.sit, laps: game.laps, weather: resolved });
    startRace({ sit: game.track.sit, laps: game.laps, weather: resolved, host: self });
  }

  function startRace({ sit, laps, weather }) {
    local.location = LOCATION.RACING;
    const entrants = [...players.values()].filter((p) => p.slot).sort((a, b) => a.slot - b.slot)
      .map((p) => ({ dpid: p.dpid, vehicle: p.slot, name: p.name, truck: p.truck, computer: p.computer, local: p.local }));
    race = createRaceLink(entrants);
    events.emit("start", { sit, track: game.track, laps, weather, entrants, host: isHost() });
  }

  // ---- In the race ----

  /**
   * The race's network side for the race screen: barriers, start positions, the race start, every truck's packets in
   * and out (as net-race.js events), results.
   */
  function createRaceLink(entrants) {
    const link = createEmitter();
    const byDpid = new Map(entrants.map((e) => [e.dpid, e]));
    const vehicleOfDpid = (dpid) => byDpid.get(dpid)?.vehicle;
    let barrier = null;
    const results = new Map();

    function waitBarrier(code, seconds) {
      local.barrier = code;
      return new Promise((resolve) => {
        const deadline = now() + seconds * 1000;
        const humans = () => [...players.values()].filter((p) => !p.local && !p.computer && byDpid.has(p.dpid));
        const tick = () => {
          const waiting = humans().filter((p) => p.barrier !== code);
          link.emit("waiting", { code, left: waiting.map((p) => p.name) });
          if (!waiting.length || now() >= deadline || closed) {
            clearInterval(barrier);
            barrier = null;
            resolve({ complete: !waiting.length, missing: waiting.map((p) => p.name) });
            return;
          }
          send(null, "barrier", { code });
        };
        clearInterval(barrier);
        barrier = setInterval(tick, 1000);
        tick();
      });
    }

    return {
      entrants,
      on: link.on,
      /** Wait for everyone to have loaded (the `sync` barrier). */
      sync: () => waitBarrier(BARRIER.SYNC, SYNC_WAIT_S),
      /** The host's start positions, by vehicle number (0x17, index 0 unused). */
      sendPositions(positions) { if (isHost()) send(null, "positions", { positions }); },
      /** One net-race.js event from this machine, as the game's packet. */
      outgoing(e) {
        switch (e.kind) {
          case "state": send(null, "state", { ...stateFields(e), vehicle: e.vehicle }); break;
          case "split": send(null, "split", { truck: e.vehicle, next: e.next, split: e.split }); break;
          case "damage": send(null, "damage", { vehicle: e.vehicle, code: e.code }); break;
          case "lights": send(null, "lights", { vehicle: e.vehicle, lamps: e.lamps }); break;
          case "horn": send(null, "horn", { truck: e.vehicle }); break;
          case "yeehaw": send(null, "yeehaw", { truck: e.vehicle }); break;
          case "go": send(null, "go", { zero: 0 }); break;
          case "gone": send(null, "gone"); break;
          default: break;
        }
      },
      /** A packet from another machine during the race. */
      packet(from, p) {
        switch (p.kind) {
          case "barrier": { const q = players.get(from); if (q) q.barrier = p.code; break; }
          case "positions": link.emit("event", { kind: "positions", positions: p.positions }); break;
          case "go": link.emit("event", { kind: "go" }); break;
          case "state": link.emit("event", { kind: "state", ...stateFromPacket(p) }); break;
          case "split": link.emit("event", { kind: "split", vehicle: p.truck, next: p.next, split: p.split }); break;
          case "damage": link.emit("event", { kind: "damage", vehicle: p.vehicle, code: p.code }); break;
          case "lights": link.emit("event", { kind: "lights", vehicle: p.vehicle, lamps: p.lamps }); break;
          case "gone": { const v = vehicleOfDpid(from); if (v) link.emit("event", { kind: "gone", vehicle: v }); break; }
          case "result":
            results.set(from, p);
            { const q = players.get(from); if (q) q.barrier = p.code; }
            break;
          default: break;
        }
      },
      incoming(e) { link.emit("event", e); },
      leaver(p) { const v = vehicleOfDpid(p.dpid); if (v) link.emit("event", { kind: "gone", vehicle: v }); },
      hostEnded(code) { link.emit("hostEnded", { code }); },
      /**
       * The results barrier: send ours (0x18) until every machine sent its own, up to 30 s. `mine`: `{ lapsLed, laps,
       * total, best }`. Resolves to the results by vehicle number.
       */
      async exchangeResults(mine) {
        const fields = { code: BARRIER.RESULTS, lapsLed: mine.lapsLed ?? 0, laps: mine.laps ?? 0, total: mine.total ?? 0, best: mine.best ?? 0 };
        local.barrier = BARRIER.RESULTS;
        const deadline = now() + RESULTS_WAIT_S * 1000;
        await new Promise((resolve) => {
          const tick = () => {
            const missing = [...players.values()].filter((p) => !p.local && !p.computer && byDpid.has(p.dpid) && !results.has(p.dpid));
            link.emit("waiting", { code: BARRIER.RESULTS, left: missing.map((p) => p.name) });
            if (!missing.length || now() >= deadline || closed) { clearInterval(barrier); barrier = null; resolve(); return; }
            send(null, "result", fields);
          };
          clearInterval(barrier);
          barrier = setInterval(tick, 1000);
          tick();
        });
        return new Map([...results].map(([dpid, r]) => [vehicleOfDpid(dpid), r]));
      },
      /** Leave the race early: our truck goes to the autopilot everywhere (0x1c). */
      leave() { send(null, "gone"); },
      /** The race is over for this machine: back to the lobby (the host also tells the others, 0x0e). */
      finish(code = 0) {
        clearInterval(barrier);
        if (isHost()) send(null, "exit", { code });
        race = null;
        local.location = LOCATION.RESULTS;
        local.ready = false;
        for (const p of players.values()) { p.slot = null; p.barrier = 0; }
        send(null, "location", { location: local.location });
        changed();
      },
    };
  }

  // ---- Upkeep ----

  /** Call every frame or so: pings the next human every 5 s for the Latency column. */
  function update() {
    if (closed || race || now() - lastPing < PING_EVERY_MS) return;
    lastPing = now();
    const humans = [...players.values()].filter((p) => !p.local && !p.computer);
    if (!humans.length) return;
    const p = humans[pingTurn++ % humans.length];
    send(p.dpid, "ping", { time: pingTime(now()) });
  }

  function end(reason) {
    if (closed) return;
    closed = true;
    for (const f of off) f();
    events.emit("left", { reason });
  }
  function leave() {
    if (race) race.leave();
    end("left");
    transport.close?.();
  }

  function state() {
    return {
      self, hostId, isHost: isHost(), game: { ...game },
      players: [...players.values()].map((p) => ({ ...p, isHost: p.dpid === hostId })),
      racing: !!race, canStart: canStart(),
    };
  }

  // Everyone already here is greeted, as if they had just joined.
  for (const id of transport.peers?.() ?? []) { newPlayer(id); greet(id); }

  return {
    on: events.on, state, update, leave,
    setLocation, setReady, setTruck, setSkill, chat, quick, canTeamChat: () => false, teamChat: () => {}, ridicule, horn, yeehaw, joinTeam,
    setTrack, setLaps, setWeather, setTeamPlay, kick, addComputer: () => null, removeComputer: () => {}, canStart, start,
    raceLink: () => race,
    isHost,
  };
}
