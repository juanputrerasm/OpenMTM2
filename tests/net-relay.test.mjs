/*
  CP4 relay rooms (docs/MULTIPLAYER.md "Relay rooms"): the relay as a transport (src/net/relay-transport.js), and the
  classic session in CP4's layouts with OpenMTM2 hosting (src/net/legacy-session.js `profile`), the host's side of
  CP4's post-load barrier (CP4_EXE_ANALYSIS.md 9) included.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createEmitter } from "../src/net/transport.js";
import { createRelayTransport, RELAY_RELIABLE } from "../src/net/relay-transport.js";
import { createLoopbackNetwork } from "./helpers/loopback-transport.mjs";
import { createLegacySession } from "../src/net/legacy-session.js";
import { PROFILES, CP4_NET_VERSION, decodePacket } from "../src/net/vendor/mtmnet/mtm2-packets.js";
import { encodeRelay, decodeRelay } from "../src/net/vendor/mtmnet/room-messages.js";

function fakeServer(id) {
  const events = createEmitter();
  const sent = [];
  return { info: { you: { id } }, on: events.on, emit: events.emit, sent, sendRelay: (member, payload, flags) => sent.push({ member, payload, flags }) };
}

test("relay frames: the tag, the member, the payload", () => {
  const bytes = encodeRelay({ member: 0x1234, flags: 1, payload: Uint8Array.from([7, 8]) });
  assert.deepEqual([...bytes], [0xc3, 1, 0x34, 0x12, 7, 8]);
  assert.deepEqual({ ...decodeRelay(bytes), payload: [...decodeRelay(bytes).payload] }, { flags: 1, member: 0x1234, payload: [7, 8] });
});

test("the relay transport: members are peers, the owner is the host, packets in and out", () => {
  const server = fakeServer(5);
  const t = createRelayTransport(server, { name: "CP4 night", owner: 2, members: [{ id: 2, name: "Fila" }, { id: 5, name: "Juan" }] });
  assert.equal(t.self, 5);
  assert.deepEqual(t.peers(), [2]);
  assert.equal(t.host(), 2);
  const seen = [];
  t.on("message", (from, bytes) => seen.push([from, [...bytes]]));
  t.on("peer", (p) => seen.push(["peer", p.id, p.joined]));
  t.on("host", (id) => seen.push(["host", id]));
  server.emit("relay", { from: 2, flags: 0, payload: Uint8Array.from([1]) });
  server.emit("relay", { from: 9, flags: 0, payload: Uint8Array.from([2]) }); // not a member: dropped
  server.emit("member", { member: { id: 9, name: "Ann" } });
  server.emit("relay", { from: 9, flags: 0, payload: Uint8Array.from([3]) });
  server.emit("left", { member: 2 });
  server.emit("owner", { member: 5 });
  assert.deepEqual(seen, [[2, [1]], ["peer", 9, true], [9, [3]], ["peer", 2, false], ["host", 5]]);
  assert.equal(t.isHost(), true);
  t.send(null, Uint8Array.from([4]), { reliable: true });
  t.send(9, Uint8Array.from([5]));
  assert.deepEqual(server.sent.map((s) => [s.member, s.flags]), [[0, RELAY_RELIABLE], [9, 0]]);
});

test("in a relay room OpenMTM2 hosts in CP4's layouts: its version, the raceId, the 0x28 / 0x29 barrier", async () => {
  const network = createLoopbackNetwork();
  const names = ["Host", "Ann"];
  const transports = names.map((n) => network.join(n));
  const heard = [];
  transports[1].on("message", (from, bytes) => heard.push(decodePacket(bytes, PROFILES.cp4)));
  let clock = 1000;
  const sessions = transports.map((transport, i) => createLegacySession({
    transport, me: { name: names[i], truck: "BIGFOOT.TRK", skill: 1 }, hasTrack: () => true, trackCrc: async () => 0x1234,
    profile: PROFILES.cp4, now: () => clock,
  }));
  network.flush();
  const [host, ann] = sessions;
  assert.ok(heard.some((p) => p.kind === "info" && p.version === CP4_NET_VERSION), "the host announces CP4's version");
  await host.setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  network.flush();
  await new Promise((r) => setTimeout(r, 0));
  network.flush();
  ann.setReady(true);
  network.flush();
  const links = [];
  for (const s of sessions) s.on("start", () => links.push(s.raceLink()));
  host.start();
  network.flush();
  const start = heard.find((p) => p.kind === "start");
  assert.ok(start?.raceId && start.raceId % 2 === 1, "the 0x14 carries an odd raceId");
  const [hostLink, annLink] = links;
  assert.equal(annLink.raceId, start.raceId);
  const hostDone = hostLink.sync();
  network.flush();
  const annDone = annLink.sync();
  network.flush();
  clock += 300;
  await new Promise((r) => setTimeout(r, 300));
  network.flush();
  await new Promise((r) => setTimeout(r, 300));
  network.flush();
  assert.equal((await hostDone).complete, true, "the host heard Ann's 0x28");
  assert.equal((await annDone).complete, true, "Ann got the host's 0x29");
  assert.ok(heard.some((p) => p.kind === "raceRelease" && p.raceId === start.raceId));
  for (const s of sessions) s.leave();
});
