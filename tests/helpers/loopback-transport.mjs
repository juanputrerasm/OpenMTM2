/*
  An in-memory transport (transport.js) for tests: every member of a loopback network hears the
  others. Delivery is queued and happens on `network.flush()`, so a test decides when messages
  arrive; `drop` loses best-effort messages to try what loss does. `star` makes it like Community
  Patch 3's direct connect: messages still reach everyone, but a client hears only of the host
  joining and leaving (MONSTER_EXE_ANALYSIS.md 14.5).
*/
import { createEmitter } from "../../src/net/transport.js";

/** A network of loopback transports. `join(name)` adds a member; the first is the host. */
export function createLoopbackNetwork({ drop = 0, random = Math.random, star = false } = {}) {
  const members = new Map();
  let nextId = 1;
  let host = null;
  const queue = [];

  function deliver(fromId, to, bytes, reliable) {
    for (const [id, m] of members) {
      if (id === fromId || (to !== null && to !== id)) continue;
      if (!reliable && drop > 0 && random() < drop) continue;
      queue.push(() => members.has(id) && m.events.emit("message", fromId, bytes.slice()));
    }
  }

  function join(name) {
    const id = nextId++;
    const events = createEmitter();
    const member = { id, name, events };
    if (host === null) host = id;
    // In a star, only the host and the newcomer hear of each other.
    const hears = (a, b) => !star || a === host || b === host;
    for (const m of members.values()) {
      if (hears(m.id, id)) queue.push(() => m.events.emit("peer", { id, name, joined: true }));
      if (hears(id, m.id)) queue.push(() => events.emit("peer", { id: m.id, name: m.name, joined: true }));
    }
    members.set(id, member);
    return {
      self: id,
      name,
      isHost: () => host === id,
      host: () => host,
      peers: () => [...members.keys()].filter((k) => k !== id && (!star || k === host || id === host)),
      send(to, bytes, opts = {}) {
        if (!members.has(id)) throw new Error("Transport closed");
        deliver(id, to ?? null, bytes, !!opts.reliable);
      },
      on: events.on,
      close() {
        if (!members.delete(id)) return;
        for (const m of members.values()) if (!star || m.id === host || id === host) queue.push(() => m.events.emit("peer", { id, name, joined: false }));
        if (host === id) {
          // The lowest id left takes over, as DirectPlay's host migration does.
          host = members.size ? Math.min(...members.keys()) : null;
          for (const m of members.values()) queue.push(() => m.events.emit("host", host));
        }
      },
    };
  }

  /** Deliver everything queued so far (and what that causes), up to `limit` rounds. */
  function flush(limit = 100) {
    for (let round = 0; queue.length && round < limit; round++) {
      const now = queue.splice(0);
      for (const run of now) run();
    }
  }

  return { join, flush, members: () => [...members.keys()] };
}
