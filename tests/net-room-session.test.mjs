/*
  An online room's session (src/net/room-session.js) against a stand-in server: the lobby state the
  Multiplayer screen reads, the track checks, the race link's barrier, state frames and results.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createEmitter } from "../src/net/transport.js";
import { createRoomSession } from "../src/net/room-session.js";
import { roomServerUrl } from "../src/net/room-transport.js";
import { LOCATION, statusText } from "../src/net/legacy-session.js";
import { decodeState, encodeState } from "../src/net/vendor/mtmnet/room-messages.js";

function fakeServer(you = 1) {
  const events = createEmitter();
  const sent = [], states = [], requests = [];
  return {
    info: { you: { id: you }, server: { name: "Test", motd: "" }, limits: { maxPlayers: 8 } },
    on: events.on,
    emit: (type, m = {}) => events.emit(type, { type, ...m }),
    send: (type, fields = {}) => sent.push({ type, ...fields }),
    request: async (type, fields = {}) => { requests.push({ type, ...fields }); return { type: "result" }; },
    sendState: (s) => states.push(decodeState(encodeState(s))),
    clock: () => Date.now(),
    ping: async () => 30,
    sent, states, requests,
  };
}
const room = (over = {}) => ({
  code: "ABC234", name: "Mud Pit", owner: 1, locked: false, public: true, maxPlayers: 8, state: "lobby",
  settings: { track: null, laps: 3, weather: 0, mode: "", computers: 0, damage: true, collisions: true },
  members: [{ id: 1, name: "Ann", truck: "", skill: 1, location: 5, ready: false, team: 0, latency: null, content: null }],
  race: null, ...over,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

test("room addresses: wss for names, ws with the server's port for this computer", () => {
  assert.equal(roomServerUrl("rooms.example.org"), "wss://rooms.example.org/play");
  assert.equal(roomServerUrl("localhost"), "ws://localhost:47660/play");
  assert.equal(roomServerUrl("192.168.1.5:9000"), "ws://192.168.1.5:9000/play");
  assert.equal(roomServerUrl("https://rooms.example.org/custom"), "wss://rooms.example.org/custom");
  assert.throws(() => roomServerUrl("  "));
});

test("the lobby as the Multiplayer screen reads it: owner, members, ready, own profile sent", () => {
  const server = fakeServer(1);
  const s = createRoomSession({ server, room: room(), me: { name: "Ann", truck: "BIGFOOT.TRK", skill: 2 } });
  assert.deepEqual(server.sent.at(-1), { type: "profile", truck: "BIGFOOT.TRK", skill: 2, location: LOCATION.MULTIPLAYER, ready: false });
  const notices = [];
  s.on("notice", (n) => notices.push(n.code));
  server.emit("member", { member: { id: 2, name: "Ben", truck: "GRAVE.TRK", skill: 0, location: 4, ready: true, team: 0, latency: 120, content: null } });
  const st = s.state();
  assert.equal(st.kind, "rooms");
  assert.equal(st.isHost, true);
  assert.equal(st.room.code, "ABC234");
  const ben = st.players.find((p) => p.dpid === 2);
  assert.equal(statusText(ben), "Ready");
  assert.equal(st.players.find((p) => p.local).truck, "BIGFOOT.TRK");
  assert.deepEqual(notices, ["joined"]);
  assert.equal(s.canStart(), false, "no track yet");
  server.emit("owner", { member: 2 });
  assert.equal(s.isHost(), false);
  assert.throws(() => s.setLaps(4));
});

test("track checks: we report our copy; others' missing or different copies are noticed", async () => {
  const server = fakeServer(2);
  const s = createRoomSession({
    server, room: room({ members: [room().members[0], { id: 2, name: "Ben", content: null }] }), me: { name: "Ben" },
    hasTrack: (sit) => sit === "TPARK.SIT", trackCrc: async () => 0xdeadbeef,
  });
  const notices = [];
  s.on("notice", (n) => notices.push(n.code));
  server.emit("room", { room: room({ settings: { ...room().settings, track: { sit: "TPARK.SIT", name: "Farm Road 29", crc: 0x1234 } }, members: [room().members[0], { id: 2, name: "Ben" }] }) });
  await tick();
  assert.deepEqual(server.sent.at(-1), { type: "profile", content: { sit: "TPARK.SIT", crc: 0xdeadbeef } });
  assert.ok(notices.includes("trackVersion"), "our copy differs from the owner's");
  server.emit("member", { member: { id: 1, name: "Ann", content: { sit: "TPARK.SIT", crc: -1 } } });
  assert.ok(notices.includes("theyLackTrack"));
  assert.equal(s.state().players.find((p) => p.dpid === 1).missingTrack, true);
});

test("a race: seating, the loading barrier, state frames, events, results, back to the lobby", async () => {
  const server = fakeServer(1);
  const s = createRoomSession({ server, room: room(), me: { name: "Ann", truck: "BIGFOOT.TRK" } });
  const starts = [];
  s.on("start", (e) => starts.push(e));
  server.emit("starting", { race: { id: 1, sit: "TPARK.SIT", track: { sit: "TPARK.SIT", name: "Farm Road 29" }, laps: 2, weather: 3, mode: "", entrants: [
    { vehicle: 1, member: 2, computer: false, name: "Ben", truck: "GRAVE.TRK", owner: 2 },
    { vehicle: 2, member: null, computer: true, name: "Bot", truck: "X.TRK", owner: 1 },
    { vehicle: 3, member: 1, computer: false, name: "Ann", truck: "BIGFOOT.TRK", owner: 1 },
  ] } });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].host, true);
  assert.equal(starts[0].weather, 3);
  assert.deepEqual(starts[0].entrants.map((e) => [e.vehicle, e.local, e.computer]), [[1, false, false], [2, false, true], [3, true, false]]);
  const link = s.raceLink();
  const got = [];
  link.on("event", (e) => got.push(e));

  let synced = false;
  const sync = link.sync().then(() => { synced = true; });
  assert.equal(server.sent.at(-1).type, "loaded");
  await tick();
  assert.equal(synced, false);
  server.emit("synced", { startAt: Date.now(), serverTime: Date.now() });
  await sync;

  link.outgoing({ kind: "state", vehicle: 3, pos: [1, 2, 3], bvel: [0, 0, 1], euler: [0, 0, 1], steer: 0.1, throttle: 1, brakeRear: 0, brakeFront: 0, gear: 2, autoShift: true, score: 0, seq: 70000 });
  assert.equal(server.states[0].vehicle, 3);
  assert.equal(server.states[0].seq, 70000 & 0xffff);
  link.outgoing({ kind: "split", vehicle: 3, next: 1, split: 12.5, extra: "dropped" });
  assert.deepEqual(server.sent.at(-1), { type: "race", e: { kind: "split", vehicle: 3, next: 1, split: 12.5 } });
  link.sendPositions([null, [1, 2, 3]]);
  assert.equal(server.sent.at(-1).e.kind, "positions");

  server.emit("race", { from: 2, e: { kind: "horn", vehicle: 1 } });
  server.emit("state", { vehicle: 1, seq: 4, pos: [0, 0, 0] });
  assert.deepEqual(got.map((e) => e.kind), ["horn", "state"]);

  const results = link.exchangeResults({ laps: 2, total: 100, best: 49 });
  assert.deepEqual(server.sent.at(-1), { type: "result", laps: 2, total: 100, best: 49, lapsLed: 0 });
  server.emit("results", { race: 1, results: { 1: { laps: 2, total: 110, best: 52, lapsLed: 0 }, 3: { laps: 2, total: 100, best: 49, lapsLed: 2 } } });
  const map = await results;
  assert.equal(map.get(1).total, 110);
  link.finish();
  assert.equal(s.raceLink(), null);
  assert.equal(s.state().players.find((p) => p.local).location, LOCATION.RESULTS);
});

test("kicked or disconnected: the session ends with the reason", () => {
  const server = fakeServer(2);
  const s = createRoomSession({ server, room: room(), me: { name: "Ben" } });
  const reasons = [];
  s.on("left", (e) => reasons.push(e.reason));
  server.emit("kicked", { reason: "removed" });
  server.emit("closed", {});
  assert.deepEqual(reasons, ["removed"], "once");
});

test("team lines: sent to the teammates in the room where the server routes them, and marked when heard", () => {
  const server = fakeServer(1);
  const members = [room().members[0], { id: 2, name: "Ben" }, { id: 3, name: "Cal" }];
  const s = createRoomSession({ server, room: room({ members }), me: { name: "Ann" } });
  const heard = [];
  s.on("chat", (c) => heard.push(c));
  assert.equal(s.canTeamChat(), false, "an older server: no team channel");
  server.info.features = ["teamChat"];
  assert.equal(s.canTeamChat(), true);
  // Self, a stranger and a repeat are left out.
  s.teamChat("cover the goal", [2, 1, 9, 2]);
  assert.deepEqual(server.requests.at(-1), { type: "chat", text: "cover the goal", team: [2] });
  assert.deepEqual([heard.at(-1).team, heard.at(-1).own], [true, true]);
  server.emit("chat", { from: 2, name: "Ben", text: "on it", private: false, team: true });
  assert.deepEqual([heard.at(-1).name, heard.at(-1).team, heard.at(-1).private], ["Ben", true, false]);
});

test("the owner cannot start while a member reported not having the track", () => {
  const server = fakeServer(1);
  const track = { sit: "TPARK.SIT", name: "Farm Road 29", crc: 5 };
  const members = [room().members[0], { id: 2, name: "Ben", ready: true, content: { sit: "TPARK.SIT", crc: -1 } }];
  const s = createRoomSession({ server, room: room({ members, settings: { ...room().settings, track } }), me: { name: "Ann" }, hasTrack: () => true, trackCrc: async () => 5 });
  assert.equal(s.canStart(), false);
  assert.equal(s.state().players.find((p) => p.dpid === 2).missingTrack, true);
  server.emit("member", { member: { id: 2, name: "Ben", ready: true, content: { sit: "TPARK.SIT", crc: 5 } } });
  assert.equal(s.canStart(), true);
});
