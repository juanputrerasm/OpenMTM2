/*
  The network race glue (src/net/net-race.js, docs/MULTIPLAYER.md) and the loopback transport.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createNetRace } from "../src/net/net-race.js";
import { createLoopbackNetwork } from "./helpers/loopback-transport.mjs";

const entrants = [{ vehicle: 2, owned: true }, { vehicle: 1, owned: false }, { vehicle: 3, owned: false }];
const reply = (extra = {}) => ({
  net: [{ truck: 0, pos: [1, 2, 3], bvel: [0, 0, 10], euler: [0, 0, 1], steer: 0, throttle: 1, brakeRear: 0, gear: 4, autoShift: true, score: 0 }],
  race: { started: true, clock: 10, trucks: [{ laps: 0, checkpoint: 0 }, {}, {}] },
  ...extra,
});

test("our truck's state goes out at the send rate, by vehicle number", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  const sent = [];
  for (let ms = 0; ms <= 1000; ms += 1000 / 60) sent.push(...net.collect(reply(), ms).filter((e) => e.kind === "state"));
  assert.equal(sent.length, 5, "4 a second, the first at once");
  assert.equal(sent[0].vehicle, 2);
  assert.ok(sent[1].seq > sent[0].seq);
});

test("a remote state becomes a worker command for its local truck; our own and unknown vehicles are ignored", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  assert.equal(net.receive({ kind: "state", vehicle: 3, pos: [0, 0, 0] }), true);
  assert.equal(net.receive({ kind: "state", vehicle: 2, pos: [0, 0, 0] }), false);
  assert.equal(net.receive({ kind: "state", vehicle: 7, pos: [0, 0, 0] }), false);
  const [cmd] = net.commands();
  assert.equal(cmd.name, "remote");
  assert.equal(cmd.value[0].truck, 2);
  assert.deepEqual(net.commands(), []);
});

test("start positions are put in local order; the race starts once", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  const positions = Array.from({ length: 9 }, (_, i) => [i, 0, 0]);
  net.receive({ kind: "positions", positions });
  assert.equal(net.receive({ kind: "go" }), true);
  assert.equal(net.receive({ kind: "go" }), false);
  const [pos, go] = net.commands();
  assert.deepEqual(pos.value.map((p) => p[0]), [2, 1, 3]);
  assert.equal(go.name, "raceStart");
});

test("a leaver's truck is handed to the autopilot and its updates stop counting", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  net.receive({ kind: "gone", vehicle: 1 });
  assert.equal(net.receive({ kind: "state", vehicle: 1, pos: [0, 0, 0] }), false);
  assert.deepEqual(net.commands(), [{ name: "handOver", value: 1 }]);
  assert.deepEqual(net.effects(), [{ kind: "gone", truck: 1 }]);
});

test("a checkpoint pass and a damage change are sent once", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  let code = 0;
  net.collect(reply(), 0, () => code);
  const r = reply();
  r.race.clock = 25;
  r.race.trucks[0] = { laps: 0, checkpoint: 1 };
  code = 0b1001;
  const out = net.collect(r, 10, () => code).filter((e) => e.kind !== "state");
  assert.deepEqual(out, [{ kind: "split", vehicle: 2, next: 1, split: 25 }, { kind: "damage", vehicle: 2, code: 9 }]);
  assert.deepEqual(net.collect(r, 20, () => code).filter((e) => e.kind !== "state"), []);
});

test("remote horn, YeeHaw, damage and lights are effects by local index", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  net.receive({ kind: "horn", vehicle: 3 });
  net.receive({ kind: "damage", vehicle: 1, code: 5 });
  assert.deepEqual(net.effects(), [{ kind: "horn", truck: 2 }, { kind: "damage", truck: 1, code: 5 }]);
});

test("loopback: messages arrive on flush, the host migrates to the lowest id left", () => {
  const network = createLoopbackNetwork();
  const a = network.join("A"), b = network.join("B"), c = network.join("C");
  const got = [];
  c.on("message", (from, bytes) => got.push([from, bytes[0]]));
  a.send(null, new Uint8Array([7]), { reliable: true });
  b.send(c.self, new Uint8Array([8]));
  assert.equal(got.length, 0);
  network.flush();
  assert.deepEqual(got, [[a.self, 7], [b.self, 8]]);
  let host = null;
  c.on("host", (id) => (host = id));
  a.close();
  network.flush();
  assert.equal(host, b.self);
  assert.ok(b.isHost());
});

test("Wheels damage: an owned truck's wheels go out at once on a lost wheel, the wear alone at most once a second", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  const wheels = (w) => reply({ wheelsOwn: [{ truck: 0, lost: 0, axles: 0, wear: [1, 1, 1, 1], repairs: 0, pits: 0, ...w }] });
  assert.equal(net.collect(wheels({}), 0).filter((e) => e.kind === "wheels").length, 0, "whole wheels at the start: nothing to say");
  const lost = net.collect(wheels({ lost: 2, wear: [1, 0, 1, 1] }), 10).filter((e) => e.kind === "wheels");
  assert.deepEqual(lost, [{ kind: "wheels", vehicle: 2, lost: 2, axles: 0, wear: [1, 0, 1, 1], repairs: 0, pits: 0 }]);
  assert.equal(net.collect(wheels({ lost: 2, wear: [0.9, 0, 1, 1] }), 500).filter((e) => e.kind === "wheels").length, 0, "wear only, too soon");
  assert.equal(net.collect(wheels({ lost: 2, wear: [0.9, 0, 1, 1] }), 1100).filter((e) => e.kind === "wheels").length, 1);
  assert.equal(net.collect(wheels({ lost: 0, wear: [1, 1, 1, 1], repairs: 1 }), 1200).filter((e) => e.kind === "wheels").length, 1, "a repair at once");
});

test("Wheels damage: another machine's truck's wheels become a worker command for its local truck", () => {
  const net = createNetRace({ entrants, rateHz: 4 });
  assert.equal(net.receive({ kind: "wheels", vehicle: 3, lost: 1, axles: 0, wear: [0, 1, 1, 1], repairs: 0, pits: 0 }), true);
  assert.equal(net.receive({ kind: "wheels", vehicle: 2, lost: 1, axles: 0 }), false, "our own truck");
  const [cmd] = net.commands();
  assert.equal(cmd.name, "wheelsOwn");
  assert.deepEqual(cmd.value, [{ truck: 2, lost: 1, axles: 0, wear: [0, 1, 1, 1], repairs: 0, pits: 0 }]);
});
