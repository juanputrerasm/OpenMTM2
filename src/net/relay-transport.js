/*
  A relay room as a transport.js transport (docs/MULTIPLAYER.md "Relay rooms"; OpenMTM2 Server docs/PROTOCOL.md):
  the game's own packets, carried between the room's members inside the room server's connection, so that
  legacy-session.js plays the game's lobby and race protocol with Community Patch 3 and 4 there, as it does over
  CP3's direct connect (MONSTER_EXE_ANALYSIS.md 14.5). No DOM: runs in the page and under Node in tests.

  How the relay stands in for CP3's direct connect (as CP3's developer proposed; the parts we assume are listed in
  docs/MULTIPLAYER.md for them to confirm):

    - a player's id is its room member id (the server's, 1..65535), which its packets carry in their header;
    - one relay payload is one game packet, its 12-byte header included, as on the direct connect;
    - flags bit 0 asks for reliable delivery, as `SendGame`'s `reliable` (the WebSocket is reliable anyway);
    - the room's `member`, `left` and `owner` messages are the direct connect's joined, left and host-changed
      events, and the host is the room's owner: the server chooses, every client follows.

      const transport = createRelayTransport(server, room);
      const session = createLegacySession({ transport, me, profile: PROFILES.cp4 });
*/
import { createEmitter } from "./transport.js";

/** Relay frame flags (the client's own; the server passes them on). */
export const RELAY_RELIABLE = 1;

/**
 * @param server room-transport.js, connected with the "cp3-relay/1" capability
 * @param room   the relay room as `create` or `join` answered it
 */
export function createRelayTransport(server, room) {
  const events = createEmitter();
  const self = server.info.you.id;
  const members = new Map(room.members.map((m) => [m.id, m]));
  let owner = room.owner || null;
  let closed = false;
  const offs = [
    server.on("relay", ({ from, payload }) => {
      if (!closed && from !== self && members.has(from)) events.emit("message", from, payload);
    }),
    server.on("member", ({ member }) => {
      if (closed) return;
      const known = members.has(member.id);
      members.set(member.id, member);
      if (!known && member.id !== self) events.emit("peer", { id: member.id, name: member.name, joined: true });
    }),
    server.on("left", ({ member }) => {
      if (closed || !members.has(member)) return;
      const name = members.get(member)?.name ?? "";
      members.delete(member);
      if (member === self) { events.emit("lost", "removed"); return; }
      events.emit("peer", { id: member, name, joined: false });
    }),
    server.on("owner", ({ member }) => {
      if (closed) return;
      owner = member || null;
      if (owner) events.emit("host", owner);
    }),
    server.on("kicked", () => { if (!closed) events.emit("lost", "removed"); }),
    server.on("closed", ({ reason }) => { if (!closed) events.emit("lost", reason ?? "closed"); }),
  ];

  return {
    self,
    name: room.name,
    kind: "relay",
    peers: () => [...members.keys()].filter((id) => id !== self),
    host: () => owner,
    isHost: () => owner === self,
    send(to, bytes, { reliable = false } = {}) {
      if (closed) return;
      server.sendRelay(to ?? 0, bytes, reliable ? RELAY_RELIABLE : 0);
    },
    on: events.on,
    close() {
      if (closed) return;
      closed = true;
      for (const off of offs) off();
      events.clear();
    },
  };
}
