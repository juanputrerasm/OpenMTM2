/*
  The page's connection to an OpenMTM2 room server (OpenMTM2 Server's openmtm2d): online rooms
  (docs/MULTIPLAYER.md; the protocol is the server project's docs/PROTOCOL.md). No DOM beyond
  WebSocket, which the caller may supply.

      const server = await connectRooms({ url: "rooms.example.org", name: "Juan" });
      const { rooms } = await server.request("list");
      const { room } = await server.request("join", { room: "ABC123" });
      server.on("chat", (m) => ...);  server.on("state", (s) => ...);   // binary truck state, decoded
*/
import { createEmitter } from "./transport.js";
import { ROOM_PROTOCOL, ROOM_PATH, encodeState, decodeState } from "./vendor/mtmnet/room-messages.js";

/** The default port of openmtm2d. */
export const ROOM_PORT = 47660;
/**
 * A ping this often while connected, so the server knows we are still here: it drops a member silent for 2 minutes
 * (its `idleTimeoutS`), and a Cloudflare Worker has no other way to tell a dead connection.
 */
export const KEEPALIVE_MS = 15000;

/**
 * The WebSocket address for what a player typed: "rooms.example.org" is wss://rooms.example.org/play; this computer
 * and plain addresses on a home network use ws://, with the server's own port when none is given.
 */
export function roomServerUrl(text) {
  let s = String(text ?? "").trim();
  if (!s) throw new Error("Type the server's address.");
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, "ws");
  if (!/^wss?:\/\//i.test(s)) {
    const host = s.split(/[/:]/)[0];
    const plain = host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[");
    s = `${plain ? "ws" : "wss"}://${s}`;
    if (plain && !/^wss?:\/\/(\[[^\]]+\]|[^/:]+):\d+/i.test(s)) s = s.replace(/^(wss?:\/\/(\[[^\]]+\]|[^/:]+))/i, `$1:${ROOM_PORT}`);
  }
  const url = new URL(s);
  if (url.pathname === "/" || url.pathname === "") url.pathname = ROOM_PATH;
  return url.href;
}

/**
 * Connect and say hello. Resolves to the server: `info` (`{ you: { id }, server: { name, motd, version }, limits }`),
 * `request(type, fields)` (resolves to the result; rejects with an Error carrying `code`), `send(type, fields)` (no
 * answer wanted), `sendState(state)`, `ping()`, `clock()`, `on(type, fn)` for the server's messages, "state" for truck
 * state and "closed" ({ code, reason }), `close()`, and `alive`.
 */
export function connectRooms({ url, name, client = "OpenMTM2", WebSocketImpl = globalThis.WebSocket, now = () => Date.now() }) {
  const href = roomServerUrl(url);
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocketImpl(href); } catch (err) { reject(new Error(`Cannot reach ${href}: ${err.message}`)); return; }
    ws.binaryType = "arraybuffer";
    const events = createEmitter();
    const pending = new Map();
    let nextId = 1, opened = false, helloDone = false;
    // The server's clock minus ours, from the best (shortest) ping.
    let offset = 0, bestRtt = Infinity, rtt = null;
    let keepalive = null;

    const request = (type, fields = {}) => new Promise((res, rej) => {
      if (ws.readyState !== 1) { rej(new Error("Not connected to the server.")); return; }
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ type, id, ...fields }));
    });
    const server = {
      url: href, info: null,
      get alive() { return ws.readyState === 1; },
      request,
      send(type, fields = {}) { if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...fields })); },
      sendState(s) { if (ws.readyState === 1) ws.send(encodeState(s)); },
      on: events.on,
      /** Measure the round trip; returns it in ms. */
      async ping() {
        const t = now();
        const r = await request("ping", { t });
        const trip = now() - t;
        rtt = trip;
        if (trip <= bestRtt) { bestRtt = trip; offset = r.server - (t + trip / 2); }
        return trip;
      },
      /** Our clock in the server's time. */
      clock: () => now() + offset,
      get latency() { return rtt; },
      close() { ws.close(1000); },
    };

    ws.onopen = async () => {
      opened = true;
      try {
        server.info = await request("hello", { protocol: ROOM_PROTOCOL, name: String(name ?? "Driver").slice(0, 24) || "Driver", client });
        helloDone = true;
        keepalive = setInterval(() => { if (ws.readyState === 1) request("ping", { t: now() }).catch(() => {}); }, KEEPALIVE_MS);
        await server.ping().catch(() => {});
        resolve(server);
      } catch (err) {
        reject(err);
        ws.close();
      }
    };
    ws.onerror = () => { if (!opened) reject(new Error(`No OpenMTM2 server answers at ${href}.`)); };
    ws.onclose = (e) => {
      clearInterval(keepalive);
      const why = e.code === 4003 ? "This address is banned from the server." : e.code === 4000 ? "The server speaks another version of the room protocol."
        : e.code === 4004 ? "You were removed from the server." : e.code === 4010 ? "The server stopped hearing from this computer and closed the connection."
        : e.code === 1001 ? "The server shut down." : "The connection to the server was lost.";
      for (const p of pending.values()) p.rej(new Error(why));
      pending.clear();
      if (!helloDone) reject(new Error(why));
      events.emit("closed", { code: e.code, reason: why });
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") {
        const s = decodeState(new Uint8Array(e.data));
        if (s) events.emit("state", s);
        return;
      }
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.id !== undefined && pending.has(m.id) && (m.type === "result" || m.type === "error" || m.type === "pong")) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.type === "error") p.rej(Object.assign(new Error(m.message), { code: m.code })); else p.res(m);
        return;
      }
      if (m.type === "error") { events.emit("error", m); return; }
      events.emit(m.type, m);
    };
  });
}
