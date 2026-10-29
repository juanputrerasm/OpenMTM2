/*
  An online room (docs/MULTIPLAYER.md; the protocol is OpenMTM2 Server's docs/PROTOCOL.md): the
  lobby and race over a room server. It offers what legacy-session.js offers, so the Multiplayer
  screen, the Races screen and the race share one code path; ids are the server's member ids.
  No DOM: runs in the page and under Node in tests.

  `createRoomSession({ server, room, me, hasTrack, trackCrc, now })`:
    server      room-transport.js, connected
    room        the room as `create` or `join` answered it
    me          { name, truck, skill }
    hasTrack    (sit) -> boolean
    trackCrc    (sit) -> Promise<number>, the track's checksum (the classic game's CRC-32 over its POD)

  Events: "change", "chat", "notice", "start", "left" ({ reason }). Extra over the classic session:
  `state().room` (code, name, locked, maxPlayers), `setComputers(n)`, `start({ computers })`, and team lines
  (`teamChat(text, memberIds)`, where the server says it routes them: `canTeamChat()`).
*/
import { createEmitter } from "./transport.js";
import { LOCATION } from "./legacy-session.js";
import { MTM2_NET_VERSION } from "./vendor/mtmnet/mtm2-packets.js";

/** The lobby measures its round trip every 5 s; the Latency column changes when it moves by more than this. */
export const ROOM_PING_MS = 5000, LATENCY_STEP_MS = 40;
/** How long the race waits for the server's results before going on without them. */
export const RESULTS_WAIT_MS = 35000;

/** Computer drivers' ids in a race: they are not members, so they get ids no member has. */
const computerId = (vehicle) => 0x7f000000 + vehicle;

export function createRoomSession({ server, room, me, hasTrack = () => true, trackCrc = async () => -1, now = () => Date.now() }) {
  const events = createEmitter();
  const self = server.info.you.id;
  let snapshot = room;
  const members = new Map();
  const local = { truck: me.truck ?? "", skill: me.skill ?? 1, location: LOCATION.MULTIPLAYER, ready: false, team: 0 };
  // `ownLatency`: this player's last measured round trip to the server, ms.
  let closed = false, race = null, lastPing = 0, sentLatency = null, ownLatency = null;
  /** The track we last reported having (`sit:crc`), so a change is answered once. */
  let checkedTrack = null;

  const changed = () => events.emit("change", state());
  const notice = (code, text, extra = {}) => events.emit("notice", { code, text, ...extra });
  const isHost = () => snapshot.owner === self;
  const settings = () => snapshot.settings;
  const nameOf = (id) => members.get(id)?.name ?? "A player";
  const profile = (fields) => server.send("profile", fields);

  function adopt(next) {
    snapshot = next;
    members.clear();
    for (const m of next.members) members.set(m.id, m);
    checkTrack();
  }
  /** When the room's track changes: tell the room whether we have it, and which version (its checksum). */
  function checkTrack() {
    const t = settings().track;
    const key = t ? `${t.sit}:${t.crc}` : null;
    if (key === checkedTrack) return;
    checkedTrack = key;
    if (!t) return;
    if (!hasTrack(t.sit)) {
      profile({ content: { sit: t.sit, crc: -1 } });
      notice("noTrack", `You do not have this track: ${t.name || t.sit}.`);
      return;
    }
    trackCrc(t.sit).then((crc) => {
      if (checkedTrack !== key || closed) return;
      profile({ content: { sit: t.sit, crc: crc >>> 0 === crc ? crc : -1 } });
      if (t.crc !== -1 && crc !== -1 && crc !== t.crc) notice("trackVersion", `Your copy of ${t.name || t.sit} is a different version from the owner's.`);
    }).catch(() => {});
  }
  /** What another member's track report says, once. */
  function contentNotice(before, m) {
    const t = settings().track;
    if (!t || m.id === self || !m.content || m.content.sit !== t.sit) return;
    if (before?.content && before.content.sit === m.content.sit && before.content.crc === m.content.crc) return;
    if (m.content.crc === -1) notice("theyLackTrack", `${m.name} does not have the track ${t.name || t.sit}.`);
    else if (t.crc !== -1 && m.content.crc !== t.crc) notice("trackVersion", `${m.name} has a different version of ${t.name || t.sit}.`);
  }

  // ---- The server's messages ----
  const off = [
    server.on("member", ({ member }) => {
      const before = members.get(member.id);
      const fresh = !before;
      members.set(member.id, member);
      snapshot = { ...snapshot, members: [...members.values()] };
      if (fresh) notice("joined", `${member.name} has joined the room.`);
      contentNotice(before, member);
      changed();
    }),
    server.on("left", ({ member, reason }) => {
      const name = nameOf(member);
      members.delete(member);
      snapshot = { ...snapshot, members: [...members.values()] };
      notice("left", reason === "removed" ? `${name} was removed from the room.` : `${name} has left the room.`, { name });
      changed();
    }),
    server.on("owner", ({ member }) => {
      snapshot = { ...snapshot, owner: member };
      notice("host", member === self ? "You now own the room." : `${nameOf(member)} now owns the room.`);
      changed();
    }),
    server.on("room", ({ room: next }) => { adopt(next); changed(); }),
    server.on("chat", (m) => events.emit("chat", { from: m.from, name: m.name, text: m.text, private: !!m.private, team: !!m.team })),
    server.on("kicked", ({ reason }) => end(reason === "removed" ? "removed" : "closed")),
    server.on("shutdown", ({ text }) => notice("shutdown", text || "The server is shutting down.")),
    server.on("closed", () => end("lost")),
    server.on("starting", ({ race: r }) => startRace(r)),
    server.on("waiting", (m) => race?.waiting(m)),
    server.on("synced", (m) => race?.synced(m)),
    server.on("race", ({ from, e }) => race?.event(from, e)),
    server.on("results", (m) => race?.results(m)),
    server.on("state", (s) => race?.state(s)),
  ];

  // ---- What this player does ----

  function setLocation(location) { local.location = location; profile({ location }); changed(); }
  function setReady(ready) { local.ready = !!ready; profile({ ready: local.ready }); changed(); }
  function setTruck(truck) { local.truck = truck; profile({ truck }); changed(); }
  function setSkill(skill) { local.skill = skill; profile({ skill }); changed(); }
  function chat(text, to = null) {
    const t = String(text).slice(0, 160);
    server.request("chat", to ? { text: t, to } : { text: t }).catch((err) => notice("error", err.message));
    events.emit("chat", { from: self, name: members.get(self)?.name ?? me.name, text: t, private: !!to, own: true });
  }
  /** A team line to `teammates` (member ids), where the server routes them (`canTeamChat`). */
  function teamChat(text, teammates) {
    const t = String(text).slice(0, 160);
    const ids = [...new Set(teammates)].filter((id) => Number.isInteger(id) && id > 0 && id !== self && members.has(id));
    if (ids.length) server.request("chat", { text: t, team: ids }).catch((err) => notice("error", err.message));
    events.emit("chat", { from: self, name: members.get(self)?.name ?? me.name, text: t, team: true, own: true });
  }
  const canTeamChat = () => !!server.info?.features?.includes?.("teamChat");
  const quick = (text) => chat(text);
  const joinTeam = (team) => { local.team = team; profile({ team }); changed(); };

  // ---- The owner's settings ----

  function requireHost() { if (!isHost()) throw new Error("Only the room's owner can do that."); }
  const putSettings = (fields) => server.request("settings", fields).catch((err) => notice("error", err.message));
  async function setTrack(track) {
    requireHost();
    const crc = hasTrack(track.sit) ? await trackCrc(track.sit).catch(() => -1) : -1;
    await putSettings({ track: { sit: track.sit, name: track.name ?? "", crc: crc >= 0 ? crc >>> 0 : -1 } });
  }
  const setLaps = (laps) => { requireHost(); putSettings({ laps }); };
  const setWeather = (weather) => { requireHost(); putSettings({ weather }); };
  const setComputers = (computers) => { requireHost(); putSettings({ computers }); };
  /** An extension mode by its id (game/extensions/loader.js), or "" for a plain race. */
  const setMode = (mode) => { requireHost(); putSettings({ mode }); };
  const kick = (id) => { requireHost(); server.request("kick", { member: id }).catch((err) => notice("error", err.message)); };
  /** Whether the owner may start: a track every member has (none reported lacking it), and everyone else ready. */
  const canStart = () => {
    const t = settings().track;
    return isHost() && !!t && [...members.values()].every((m) => m.id === self || (m.ready && !(m.content?.sit === t.sit && m.content.crc === -1)));
  };
  /** Start (owner): the server seats everyone. Random weather is drawn here, from what the track allows. */
  function start({ resolveWeather = () => 0, computers = [] } = {}) {
    requireHost();
    const w = settings().weather;
    const weather = w < 0 ? resolveWeather() : w;
    server.request("start", { weather, computers: computers.slice(0, settings().computers) }).catch((err) => notice("error", err.message));
  }

  // ---- The race ----

  function startRace(r) {
    local.location = LOCATION.RACING;
    local.ready = false;
    const entrants = r.entrants.map((e) => ({
      dpid: e.computer ? computerId(e.vehicle) : e.member, vehicle: e.vehicle, name: e.name, truck: e.truck,
      computer: e.computer, local: e.member === self,
    }));
    race = createRaceLink(entrants, r);
    events.emit("start", { sit: r.sit, track: r.track, laps: r.laps, weather: r.weather, mode: r.mode, entrants, host: isHost() });
    changed();
  }

  function createRaceLink(entrants, r) {
    const link = createEmitter();
    const mine = entrants.find((e) => e.local);
    let syncWait = null, resultWait = null, seq = 0, startAt = null;
    const release = () => {
      const wait = Math.max(0, Math.min(5000, startAt - server.clock()));
      setTimeout(() => { syncWait?.({ complete: true, missing: [] }); syncWait = null; }, wait);
    };
    const out = {
      entrants,
      on: link.on,
      /** Tell the server we have loaded; resolves at the start time it gives once everyone has. */
      sync() {
        server.send("loaded");
        return new Promise((resolve) => {
          syncWait = resolve;
          // The server gave up waiting for us (a very slow load) and started already.
          if (startAt !== null) release();
        });
      },
      sendPositions(positions) { if (isHost()) server.send("race", { e: { kind: "positions", positions } }); },
      outgoing(e) {
        if (e.kind === "state") {
          seq = (seq + 1) & 0xffff;
          server.sendState({ ...e, seq: e.seq ?? seq, time: now() });
          return;
        }
        const { kind, vehicle, next, split, code, lamps, data } = e;
        const fields = { kind, vehicle, next, split, code, lamps, data };
        for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
        server.send("race", { e: fields });
      },
      /** Send our result and wait for everyone's (or the server's timeout). Resolves to the results by vehicle number. */
      async exchangeResults(result) {
        link.emit("waiting", { left: [] });
        const answer = new Promise((resolve) => {
          resultWait = resolve;
          setTimeout(() => resolve(null), RESULTS_WAIT_MS);
        });
        server.send("result", { laps: result.laps ?? 0, total: Math.max(0, result.total ?? 0), best: result.best ?? 0, lapsLed: result.lapsLed ?? 0 });
        const got = await answer;
        resultWait = null;
        return new Map(Object.entries(got?.results ?? {}).map(([v, x]) => [Number(v), x]));
      },
      leave() { if (mine) server.send("race", { e: { kind: "gone", vehicle: mine.vehicle } }); },
      finish() {
        race = null;
        local.location = LOCATION.RESULTS;
        local.ready = false;
        profile({ location: local.location, ready: false });
        changed();
      },
      // From the server:
      waiting({ left }) { link.emit("waiting", { left }); },
      synced(m) {
        startAt = m.startAt;
        if (syncWait) release();
      },
      event(from, e) { link.emit("event", e); },
      state(s) { link.emit("event", { kind: "state", ...s }); },
      results(m) { resultWait?.(m); },
    };
    return out;
  }

  // ---- Upkeep ----

  /** Call every second or so: measures the round trip for the Latency column. */
  function update() {
    if (closed || now() - lastPing < ROOM_PING_MS) return;
    lastPing = now();
    server.ping().then((ms) => {
      const v = Math.round(ms);
      ownLatency = v;
      if (sentLatency === null || Math.abs(v - sentLatency) > LATENCY_STEP_MS) { sentLatency = v; profile({ latency: v }); }
    }).catch(() => {});
  }

  function end(reason) {
    if (closed) return;
    closed = true;
    for (const f of off) f();
    race = null;
    events.emit("left", { reason });
  }
  function leave() {
    if (closed) return;
    race?.leave();
    server.request("leave").catch(() => {});
    end("left");
  }

  function state() {
    const s = settings();
    const t = s.track;
    const players = [...members.values()].map((m) => {
      const mineNow = m.id === self;
      return {
        dpid: m.id, name: m.name, truck: mineNow ? local.truck : m.truck, skill: mineNow ? local.skill : m.skill,
        location: mineNow ? local.location : m.location, ready: mineNow ? local.ready : m.ready, team: m.team,
        version: MTM2_NET_VERSION, latency: mineNow ? ownLatency ?? 0 : m.latency, local: mineNow, computer: false, isHost: m.id === snapshot.owner,
        missingTrack: !!t && m.content?.sit === t.sit && m.content.crc === -1,
        otherVersion: !!t && t.crc !== -1 && m.content?.sit === t.sit && m.content.crc !== -1 && m.content.crc !== t.crc,
        client: m.client ?? "", classicClient: !!m.classic,
      };
    });
    return {
      kind: "rooms", self, hostId: snapshot.owner, isHost: isHost(),
      game: { track: t ? { sit: t.sit, name: t.name || t.sit } : null, laps: s.laps, weather: s.weather, teamPlay: false, crc: t?.crc ?? null, computers: s.computers, mode: s.mode },
      room: { code: snapshot.code, name: snapshot.name, locked: snapshot.locked, maxPlayers: snapshot.maxPlayers, public: snapshot.public, classic: !!snapshot.classic },
      players, racing: !!race, canStart: canStart(),
    };
  }

  adopt(room);
  // Our own profile, as the room should show it.
  profile({ truck: local.truck, skill: local.skill, location: local.location, ready: false });

  return {
    on: events.on, state, update, leave,
    setLocation, setReady, setTruck, setSkill, chat, teamChat, canTeamChat, quick, ridicule: () => {}, horn: () => {}, yeehaw: () => {}, joinTeam,
    setTrack, setLaps, setWeather, setTeamPlay: () => {}, setComputers, setMode, kick, addComputer: () => null, removeComputer: () => {},
    canStart, start,
    raceLink: () => race,
    isHost,
  };
}
