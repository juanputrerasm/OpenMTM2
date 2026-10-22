/*
  The page's side of the desktop helper (OpenMTM2 Server's openmtm2-bridge): classic multiplayer
  through DirectPlay (docs/MULTIPLAYER.md). No DOM beyond WebSocket, which the caller may supply.

      const helper = await connectBridge({ token });           // ws://127.0.0.1:47650/bridge
      const sessions = await helper.enumerate("192.168.1.20");
      const transport = await helper.join(sessions[0].instance, "Juan");   // or helper.host({ ... })
      // transport is a transport.js transport; its ids are DirectPlay player IDs.
*/
import { createEmitter } from "./transport.js";

export const BRIDGE_URL = "ws://127.0.0.1:47650/bridge";
export const BRIDGE_STATUS_URL = "http://127.0.0.1:47650/";

/** Whether the helper answers on this computer: `{ running, busy }`. */
export async function bridgeStatus(url = BRIDGE_STATUS_URL, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(url, { cache: "no-store" });
    const body = await res.json();
    return { running: body?.name === "openmtm2-bridge", busy: !!body?.busy, protocol: body?.protocol ?? null };
  } catch {
    return { running: false, busy: false, protocol: null };
  }
}

/**
 * Open the helper and pair with its token. Resolves to the helper: `enumerate(ip)`, `host(options)`, `join(instance,
 * playerName, password)`, `close()`, `on("log" | "closed")`.
 */
export function connectBridge({ url = BRIDGE_URL, token = "", WebSocketImpl = globalThis.WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url);
    ws.binaryType = "arraybuffer";
    const events = createEmitter();
    const pending = new Map();
    let nextId = 1;
    let transport = null;
    let opened = false;
    /**
     * What arrives while a host or join is under way: the first packets come before the answer (a CP3 host greets a
     * newcomer at once), so they wait here and are replayed once the session listens.
     */
    let early = null;
    const later = (fn) => { if (early) early.push(fn); };

    const request = (type, params = {}) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, type, ...params }));
    });

    ws.onopen = async () => {
      opened = true;
      try {
        await request("hello", { token });
        resolve(helper);
      } catch (err) {
        reject(err);
      }
    };
    ws.onerror = () => { if (!opened) reject(new Error("The helper is not running on this computer.")); };
    ws.onclose = (e) => {
      const why = e.code === 4001 ? "Wrong pairing token." : e.code === 4002 ? "Another page is using the helper." : "The helper closed the connection.";
      for (const p of pending.values()) p.rej(new Error(why));
      pending.clear();
      if (!opened) reject(new Error(why));
      transport?.lost(why);
      events.emit("closed", { code: e.code, reason: why });
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") {
        const view = new DataView(e.data);
        if (view.byteLength < 8) return;
        const from = view.getUint32(0, true), bytes = new Uint8Array(e.data.slice(8));
        if (transport) transport.message(from, bytes); else later(() => transport?.message(from, bytes));
        return;
      }
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.id && pending.has(m.id) && (m.type === "result" || m.type === "error")) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.type === "error") p.rej(new Error(m.message)); else p.res(m);
        return;
      }
      if (m.type === "log") events.emit("log", m.text);
      else if (transport) transport.event(m);
      else later(() => transport?.event(m));
    };

    /** The transport for a session this helper is in. */
    function makeTransport(info) {
      const tEvents = createEmitter();
      const peers = new Map(info.players.filter((p) => !p.local).map((p) => [p.id, p]));
      let hostPlayer = info.hostPlayerId ?? (info.isHost ? info.playerId : null);
      const t = {
        self: info.playerId,
        name: info.session?.name ?? "",
        peers: () => [...peers.keys()],
        peerName: (id) => peers.get(id)?.name ?? "",
        host: () => hostPlayer,
        isHost: () => hostPlayer === info.playerId,
        send(to, bytes, { reliable = false } = {}) {
          if (ws.readyState !== 1) return;
          const out = new Uint8Array(5 + bytes.length);
          new DataView(out.buffer).setUint32(0, to ?? 0, true);
          out[4] = reliable ? 1 : 0;
          out.set(bytes, 5);
          ws.send(out.buffer);
        },
        on: tEvents.on,
        close() { request("leave").catch(() => {}); },
        // From the socket:
        message: (from, bytes) => tEvents.emit("message", from, bytes),
        event(m) {
          if (m.type === "player" && !m.local) {
            if (m.joined) peers.set(m.id, m); else peers.delete(m.id);
            tEvents.emit("peer", { id: m.id, name: m.name, joined: m.joined });
          } else if (m.type === "host") {
            hostPlayer = m.local ? info.playerId : m.playerId;
            tEvents.emit("host", hostPlayer);
          } else if (m.type === "lost") {
            tEvents.emit("lost", m.reason ?? "lost");
          }
        },
        lost: (why) => tEvents.emit("lost", why),
      };
      return t;
    }

    /** Start a host or join; what comes before its answer is kept for the transport it makes. */
    async function begin(type, params, name) {
      early = [];
      try {
        const info = await request(type, params);
        transport = makeTransport(info);
        if (name) transport.name = name;
        const held = early;
        // The session subscribes as soon as it has the transport; the held packets follow right after.
        setTimeout(() => { for (const fn of held) fn(); }, 0);
        return transport;
      } finally {
        early = null;
      }
    }

    const helper = {
      on: events.on,
      /** The sessions a host offers (an IP), or on the local network (no IP). */
      async enumerate(ip = "", { all = false, timeoutMs = 1000 } = {}) {
        return (await request("enum", { ip, all, timeoutMs })).sessions;
      },
      /** Host a session as the game does (`<<1>>'s Truckin' Game`, up to 8, migrate host). Resolves to its transport. */
      host: ({ name, playerName, maxPlayers = 8, migrateHost = true }) => begin("host", { name, playerName, maxPlayers, migrateHost }),
      join: (instance, playerName, password = "") => begin("join", { instance, playerName, password }),
      /** Community Patch 3's direct connect (MONSTER_EXE_ANALYSIS.md 14.5): host on a UDP port (2350 by default). */
      hostCp3: ({ playerName, port }) => begin("host", { kind: "cp3", playerName, port }, `${playerName}'s game`),
      /** Join a CP3 direct connect host by its address and port. */
      joinCp3: ({ ip, port, playerName }) => begin("join", { kind: "cp3", ip, port, playerName }, `${ip}:${port}`),
      close() { ws.close(1000); },
    };
  });
}
