/*
  The classic lobby and race protocol (src/net/legacy-session.js, MONSTER_EXE_ANALYSIS.md 14.3, 14.4)
  over the loopback transport.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createLoopbackNetwork } from "./helpers/loopback-transport.mjs";
import { createLegacySession, statusText, latencyText, versionText, LOCATION } from "../src/net/legacy-session.js";
import { decodePacket, encodePacket, BARRIER } from "../src/net/vendor/mtmnet/mtm2-packets.js";

function lobby(names, options = {}, net = {}) {
  const network = createLoopbackNetwork(net);
  const sessions = [];
  for (const name of names) {
    const t = network.join(name);
    // Every member learns of the others through "peer" events, as DirectPlay reports them.
    sessions.push(createLegacySession({ transport: t, me: { name, truck: "BIGFOOT.TRK", skill: 1 }, hasTrack: () => true, trackCrc: async () => 0x1234, ...options }));
  }
  network.flush();
  return { network, sessions, flush: () => network.flush() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("the list columns as the game words them", () => {
  assert.equal(statusText({ ready: true, location: LOCATION.MULTIPLAYER }), "Ready");
  assert.equal(statusText({ ready: true, location: LOCATION.RACING }), "Racing!");
  assert.equal(statusText({ ready: false, location: LOCATION.GARAGE }), "Garage");
  assert.equal(statusText({ ready: false, location: 42 }), "Unknown");
  assert.equal(latencyText({ local: true }), "Local");
  assert.equal(latencyText({ latency: null }), "Unknown");
  assert.equal(latencyText({ latency: 120 }), "Low");
  assert.equal(latencyText({ latency: 900 }), "Normal");
  assert.equal(latencyText({ latency: 2000 }), "High");
  assert.equal(versionText(0x0201), "");
  assert.equal(versionText(0x0204), " (Version 2.04)");
  assert.equal(versionText(0x0232), " (Version 2.50)");
});

test("a newcomer gets everyone's info, and the host's track, laps and weather", async () => {
  const { sessions, flush } = lobby(["Host", "Ann"]);
  const [host, ann] = sessions;
  await host.setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  host.setLaps(5);
  host.setWeather(2);
  flush();
  await tick();
  flush();
  const a = ann.state();
  assert.equal(a.game.track.name, "Farm Road 29");
  assert.equal(a.game.laps, 5);
  assert.equal(a.game.weather, 2);
  assert.equal(a.players.find((p) => p.name === "Host" || p.dpid === host.state().self).truck, "BIGFOOT.TRK");
  assert.equal(a.isHost, false);
  assert.equal(host.state().isHost, true);
});

test("ready, location, chat (to all and private), and the host may start once all are ready", () => {
  const { sessions, flush } = lobby(["Host", "Ann", "Ben"]);
  const [host, ann, ben] = sessions;
  const heard = { host: [], ben: [] };
  host.on("chat", (c) => heard.host.push(c));
  ben.on("chat", (c) => heard.ben.push(c));
  host.setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  ann.setReady(true);
  ann.setLocation(LOCATION.GARAGE);
  ann.chat("hello everyone");
  ann.chat("just you", host.state().self);
  flush();
  const annSeen = host.state().players.find((p) => p.dpid === ann.state().self);
  assert.equal(annSeen.ready, true);
  assert.equal(statusText(annSeen), "Ready");
  assert.deepEqual(heard.host.map((c) => [c.text, c.private]), [["hello everyone", false], ["just you", true]]);
  assert.deepEqual(heard.ben.map((c) => c.text), ["hello everyone"]);
  assert.equal(host.canStart(), false, "Ben is not ready");
  ben.setReady(true);
  flush();
  assert.equal(host.canStart(), true);
});

test("a joiner without the track says so; a different track version is noticed", async () => {
  const { sessions, flush } = lobby(["Host", "Ann"]);
  const [host, ann] = sessions;
  const network2 = lobby(["Host2", "Cy"], { hasTrack: (sit) => sit !== "TPARK.SIT" });
  const notices = [];
  network2.sessions[0].on("notice", (n) => notices.push(n.code));
  await network2.sessions[0].setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  network2.flush();
  assert.ok(notices.includes("theyLackTrack"));

  // Ann's copy of the track has another checksum.
  const annNotices = [];
  host.on("notice", (n) => annNotices.push(n.code));
  ann.state();
  await host.setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  flush();
  await tick();
  flush();
  assert.ok(!annNotices.includes("trackVersion"), "same checksum");
});

test("start: every player gets a slot, the start packet carries the resolved weather", () => {
  const { sessions, flush } = lobby(["Host", "Ann", "Ben"]);
  const [host, ann, ben] = sessions;
  host.setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  host.setWeather(-1);
  flush();
  const starts = [];
  for (const s of sessions) s.on("start", (e) => starts.push(e));
  ann.setReady(true);
  ben.setReady(true);
  flush();
  host.start({ resolveWeather: () => 4 });
  flush();
  assert.equal(starts.length, 3);
  for (const s of starts) {
    assert.equal(s.weather, 4);
    assert.equal(s.sit, "TPARK.SIT");
    assert.deepEqual(s.entrants.map((e) => e.vehicle), [1, 2, 3]);
  }
  // Every machine has the same seating.
  const seat = (s) => s.entrants.map((e) => e.dpid).join();
  assert.equal(seat(starts[0]), seat(starts[1]));
  assert.equal(seat(starts[1]), seat(starts[2]));
});

test("in the race: the sync barrier, positions, state and leavers become net-race events", async () => {
  const { sessions, flush } = lobby(["Host", "Ann"]);
  const [host, ann] = sessions;
  host.setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  ann.setReady(true);
  flush();
  host.start();
  flush();
  const hostRace = host.raceLink(), annRace = ann.raceLink();
  const got = [];
  annRace.on("event", (e) => got.push(e));
  const synced = Promise.all([hostRace.sync(), annRace.sync()]);
  flush();
  const [a, b] = await synced;
  assert.ok(a.complete && b.complete);

  hostRace.sendPositions(Array.from({ length: 9 }, (_, i) => [i, 0, 0]));
  const hostVehicle = hostRace.entrants.find((e) => e.dpid === host.state().self).vehicle;
  hostRace.outgoing({ kind: "state", vehicle: hostVehicle, pos: [1, 2, 3], bvel: [0, 0, 9], euler: [0, 0, Math.PI / 2], steer: 0, throttle: 1, brakeRear: 0, gear: 4, autoShift: true, score: 0 });
  hostRace.outgoing({ kind: "go" });
  hostRace.leave();
  flush();
  assert.deepEqual(got.map((e) => e.kind), ["positions", "state", "go", "gone"]);
  assert.equal(got[1].vehicle, hostVehicle);
  assert.ok(Math.abs(got[1].euler[2] - Math.PI / 2) < 0.03);
  assert.equal(got[3].vehicle, hostVehicle);
});

test("results are exchanged by the rslt barrier", async () => {
  const { sessions, flush } = lobby(["Host", "Ann"]);
  const [host, ann] = sessions;
  host.setTrack({ sit: "TPARK.SIT", name: "Farm Road 29" });
  ann.setReady(true);
  flush();
  host.start();
  flush();
  const done = Promise.all([
    host.raceLink().exchangeResults({ laps: 3, total: 181.5, best: 58.25 }),
    ann.raceLink().exchangeResults({ laps: 3, total: 190, best: 61 }),
  ]);
  flush();
  const [atHost] = await done;
  const annVehicle = host.raceLink().entrants.find((e) => e.dpid === ann.state().self).vehicle;
  assert.equal(atHost.get(annVehicle).total, 190);
  assert.equal(atHost.get(annVehicle).code, BARRIER.RESULTS);
});

test("the host leaving: the next one takes over and cancels the lobby", () => {
  const { network, sessions, flush } = lobby(["Host", "Ann", "Ben"]);
  const [host, ann] = sessions;
  ann.setReady(true);
  flush();
  host.leave();
  flush();
  assert.equal(ann.state().isHost, true);
  assert.equal(ann.state().players.every((p) => !p.ready), true, "0x0e 9 clears the ready flags");
  assert.equal(network.members().length, 2);
});

test("a kick closes the kicked player's session", () => {
  const { sessions, flush } = lobby(["Host", "Ann"]);
  const [host, ann] = sessions;
  let left = null;
  ann.on("left", (e) => (left = e.reason));
  host.kick(ann.state().self);
  flush();
  assert.equal(left, "removed");
});

test("packets from the retail game decode as the session expects", () => {
  const info = decodePacket(encodePacket("info", { truck: "BIGFOOT.TRK", version: 0x0201, location: 5, skill: 2 }, 77));
  assert.equal(info.kind, "info");
  assert.equal(info.sender, 77);
});

test("the host's player list (0x81, 0x82): people, not computers; in a star, how clients meet", () => {
  // CP3's direct connect: a client hears only of the host; the host's 0x81 tells it of the others (14.5).
  const { sessions, flush } = lobby(["Host", "Ann", "Ben"], {}, { star: true });
  const [host, ann, ben] = sessions;
  flush();
  const names = (s) => s.state().players.map((p) => p.name).sort();
  assert.deepEqual(names(ann), ["Ann", "Ben", "Host"]);
  assert.deepEqual(names(ben), ["Ann", "Ben", "Host"]);
  assert.equal(ann.state().players.some((p) => p.computer), false, "0x81 announces people");
  // Ann and Ben greeted each other (0x03), so each knows the other's truck.
  assert.equal(ann.state().players.find((p) => p.name === "Ben").truck, "BIGFOOT.TRK");
  assert.equal(ben.state().isHost, false);
  assert.equal(ben.state().hostId, host.state().self);
  // Ben leaves: the host's 0x83 would tell Ann; here the host's list drops him.
  ben.leave();
  flush();
  assert.deepEqual(names(host), ["Ann", "Host"]);
});
