/*
  Extension modes in an online room (docs/EXTENSIONS.md, "Over the network"): the owner's state keyed
  by vehicle number, taken back in another machine's truck order; net-race's pacing; and a follower's
  Tag runtime kept in step with the owner's.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createTag, tagStep } from "../src/game/extensions/tag.js";
import { createHockey } from "../src/game/extensions/hockey.js";
import { extensionNetFromWire, extensionNetOwnFromWire, extensionNetOwnToWire, extensionNetToWire } from "../src/game/extensions/race-loader.js";
import { createExtensionSession } from "../src/game/extensions/session-loader.js";
import { createNetRace, MODE_HZ } from "../src/net/net-race.js";

// The owner's machine has vehicles 3, 1, 2 as its trucks 0, 1, 2; the follower's has 1, 2, 3.
const ownerVehicles = [3, 1, 2], followerVehicles = [1, 2, 3];
const vehicleOf = (list) => (i) => list[i];
const localOf = (list) => (v) => { const i = list.indexOf(v); return i < 0 ? null : i; };
const across = (id, state) => extensionNetFromWire(id, JSON.parse(JSON.stringify(extensionNetToWire(id, state, vehicleOf(ownerVehicles)))), localOf(followerVehicles), 3);

test("Tag's state reaches another machine in its own truck order", () => {
  const tag = createTag(3, () => 0);
  // Owner's truck 0 (vehicle 3) is It; it tags truck 2 (vehicle 2) once the hold is over.
  tagStep(tag, 6, 1, [[0, 2]]);
  const got = across("tag", { ...tag, over: false });
  assert.equal(got.it, followerVehicles.indexOf(2));
  assert.equal(got.safe, followerVehicles.indexOf(3));
  assert.deepEqual([got.event.from, got.event.to], [followerVehicles.indexOf(3), followerVehicles.indexOf(2)]);
  assert.equal(got.points[followerVehicles.indexOf(3)], tag.points[0]);
  assert.equal(got.points[followerVehicles.indexOf(1)], tag.points[1]);
});

test("Hockey's teams, goals and scorer reach another machine in its order, with the puck", () => {
  const game = createHockey({ puck: { radius: 1 } }, [0, 1, 1], 3);
  game.goals = [2, 0, 1];
  game.event = { kind: "goal", team: 0, scorer: 0, own: -1 };
  const puck = { pos: [1, 2, 3], vel: [0, 0, 0], bvel: [0, 0, 0], rates: [0, 0, 0], euler: [0, 0, 1] };
  const got = across("hockey", { ...game, resets: 2, over: false, puck });
  assert.deepEqual(got.teams, [1, 1, 0], "vehicle 1 and 2 on blue, vehicle 3 on red");
  assert.deepEqual(got.goals, [0, 1, 2]);
  assert.equal(got.event.scorer, followerVehicles.indexOf(3));
  assert.equal(got.event.own, -1);
  assert.equal(got.resets, 2);
  assert.deepEqual(got.puck.pos, [1, 2, 3]);
});

test("net-race: the owner sends the mode's state at its pace and at once on an event; a follower takes it", () => {
  const wire = {
    toWire: (s, vOf) => extensionNetToWire("tag", s, vOf),
    fromWire: (d, lOf, n) => extensionNetFromWire("tag", d, lOf, n),
  };
  const owner = createNetRace({ entrants: ownerVehicles.map((vehicle, i) => ({ vehicle, owned: i === 0 })), rateHz: 20, mode: wire });
  const tag = { ...createTag(3, () => 0), over: false };
  const sent = (now, state) => owner.collect({ modeNet: state }, now).filter((e) => e.kind === "mode");
  assert.equal(sent(0, tag).length, 1);
  assert.equal(sent(50, tag).length, 0, "nothing new");
  assert.equal(sent(60, { ...tag, events: 1, it: 2 }).length, 1, "a tag goes at once");
  assert.equal(sent(60 + 1000 / MODE_HZ, { ...tag, events: 1, it: 2 }).length, 1);

  const follower = createNetRace({ entrants: followerVehicles.map((vehicle, i) => ({ vehicle, owned: i === 0 })), rateHz: 20, mode: wire });
  const [e] = sent(1000, { ...tag, events: 2, it: 1 });
  assert.equal(follower.receive(JSON.parse(JSON.stringify(e))), true);
  const [cmd] = follower.commands();
  assert.equal(cmd.name, "mode");
  assert.equal(cmd.value.it, followerVehicles.indexOf(ownerVehicles[1]));
  follower.authority(true);
  assert.deepEqual(follower.commands(), [{ name: "modeAuthority", value: true }]);
});

/** Enough of the worker for a Tag runtime. */
function tagWorld(authority) {
  const trucks = [0, 1, 2].map((i) => ({ state: { pos: [i * 50, 0, 0], heliTimer: 0 }, remote: i !== 0, params: {} }));
  const race = { clock: 0, startTime: 0, trucks: trucks.map(() => ({ place: 0 })), over: false };
  const env = {
    step: 1 / 60, trucks, race, levelBoxes: [], walls: [], course: [], specs: trucks.map((t) => ({ start: { pos: t.state.pos } })),
    ramps: [], ground: { height: () => 0, waterLevelFt: -1000 }, weather: () => 0, watchHeadway: () => {}, net: { authority },
  };
  return { session: createExtensionSession({ mode: "tag", minutes: 5, it: 0 }, env), race, env };
}

test("a follower's Tag decides nothing itself and shows the owner's game", () => {
  const owner = tagWorld("owner"), follower = tagWorld("follower");
  for (const w of [owner, follower]) w.race.clock = 6;
  // The same touch happens on both machines; only the owner tags.
  owner.session.touch(0, 1);
  follower.session.touch(0, 1);
  owner.session.tick();
  follower.session.tick();
  assert.equal(owner.session.view(6).it, 1);
  assert.equal(follower.session.view(6).it, 0, "the follower waits for the owner");
  // Same truck order here, so the state goes straight across.
  follower.session.applyNet(extensionNetFromWire("tag", extensionNetToWire("tag", owner.session.netState(), (i) => i + 1), (v) => v - 1, 3));
  assert.equal(follower.session.view(6).it, 1);
  assert.deepEqual(follower.session.view(6).points, owner.session.view(6).points);
  // The owner leaves: the follower takes over and tags from now on.
  follower.env.net.authority = "owner";
  follower.race.clock = 20;
  follower.session.touch(1, 2);
  follower.session.tick();
  assert.equal(follower.session.view(20).it, 2);
});

/** A small world for a session: `positions` the trucks' places, `payload` the extension's simulation data. */
function world(payload, positions, authority = "owner") {
  const trucks = positions.map((pos, i) => ({
    state: { pos: [...pos], heliTimer: 0, bvel: [0, 0, 0], matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, remote: i !== 0, params: {}, recovery: {},
  }));
  const race = { clock: 0, startTime: 0, trucks: trucks.map(() => ({ place: 0, finished: false, lap: 1 })), over: false };
  const env = {
    step: 1 / 60, trucks, race, levelBoxes: [], walls: [], course: [], specs: trucks.map((t) => ({ start: { pos: t.state.pos } })),
    ramps: [], ground: { height: () => 0, waterLevelFt: -1000 }, weather: () => 0, watchHeadway: () => {}, net: { authority },
  };
  return { session: createExtensionSession(payload, env), race, env, trucks };
}

test("Tag with MTM64's rules in the session: a 300 s round, It passed by nearness, and the cooldown sent", () => {
  const w = world({ mode: "tag", minutes: 9, it: 0, scoring: { rules: "mtm64" } }, [[1000, 0, 1000], [1020, 0, 1000], [1500, 0, 1000]]);
  assert.equal(w.race.roundSeconds, 300);
  w.race.clock = 0.5;
  w.session.tick();
  const view = w.session.view(0.5);
  assert.equal(view.it, 1, "20 ft is within the catch radius");
  assert.equal(view.rules, "mtm64");
  assert.ok(view.pass > 2.9);
  assert.equal(w.session.netState().passUntil, 3.5);
  assert.equal(w.session.score(0), 50);
  w.race.clock = 300;
  w.session.tick();
  assert.ok(w.race.over, "the round ends at 300 s");
});

test("Chase in the session: busts by distance on the owner, sent to a follower; the clock gives it to the cops", () => {
  const payload = { mode: "race-rumble", variant: "chase", teams: [0, 1, 1], roles: [0, 1, 1], laps: 2, minutes: 1 };
  const owner = world(payload, [[0, 0, 0], [20, 0, 0], [200, 0, 0]]);
  const follower = world(payload, [[0, 0, 0], [20, 0, 0], [200, 0, 0]], "follower");
  owner.race.clock = follower.race.clock = 2;
  owner.session.touch(0, 2);
  owner.session.tick();
  follower.session.tick();
  assert.deepEqual(owner.session.view(2).busts, [0, 1, 0]);
  assert.equal(owner.session.view(2).event.kind, "bust");
  assert.equal(owner.session.score(1), 1);
  assert.deepEqual(follower.session.view(2).busts, [0, 0, 0], "the follower waits for the owner");
  follower.session.applyNet(extensionNetFromWire("race-rumble", extensionNetToWire("race-rumble", owner.session.netState(), (i) => i + 1), (v) => v - 1, 3));
  assert.deepEqual(follower.session.view(2).busts, [0, 1, 0]);
  owner.race.clock = 3;
  owner.session.tick();
  assert.deepEqual(owner.session.view(3).busts, [0, 1, 0], "no bust in the 3 s after one");
  owner.race.clock = 60;
  owner.session.tick();
  assert.ok(owner.race.over);
  assert.equal(owner.session.view(60).winner, 1, "time up: the cops");
  assert.deepEqual(owner.race.trucks.map((t) => t.place), [3, 1, 2], "the cops first, by busts");
});

/** A Combat machine: its own truck first, the other machine's second (`remote`). */
function combatMachine(authority, rules = {}) {
  const trucks = [0, 1].map((i) => ({
    state: { pos: [i * 50, 0, 0], euler: [0, 0, 0], heliTimer: 0, bvel: [0, 0, 0], matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], tires: [0, 1, 2, 3].map(() => ({ penetration: -1 })) },
    remote: i !== 0, params: { hubs: [[3, -2, 5], [-3, -2, 5], [3, -2, -5], [-3, -2, -5]], tireWidthFt: 2, tireRadiusFt: 2.5 }, recovery: {},
  }));
  const race = { clock: 1, startTime: 0, checkpoints: [], course: [], trucks: trucks.map(() => ({ place: 0, finished: false, lap: 1, laps: 0, checkpoint: 0 })), over: false };
  const env = { step: 1 / 60, trucks, race, course: [], watchHeadway: () => {}, net: { authority } };
  const session = createExtensionSession({ mode: "combat", laps: 3, toughness: "normal", credits: true, startCredits: 500, aggression: "low", ...rules }, env);
  return { session, race, trucks, c: session.debug.combat };
}
// Machine A (the owner) has vehicles 1, 2 as its trucks 0, 1; machine B (a follower) has 2, 1.
const toB = (id, data) => extensionNetOwnFromWire(id, JSON.parse(JSON.stringify(extensionNetOwnToWire(id, data, (i) => [1, 2][i]))), (v) => [2, 1].indexOf(v), 2);
const toA = (id, data) => extensionNetOwnFromWire(id, JSON.parse(JSON.stringify(extensionNetOwnToWire(id, data, (i) => [2, 1][i]))), (v) => [1, 2].indexOf(v), 2);

test("Combat online: each machine judges its own truck and sends it; the others take it, a wheel and a wreck told", () => {
  const a = combatMachine("owner"), b = combatMachine("follower");
  const own = b.session.netOwn();
  assert.equal(own.trucks[1], null, "B sends only the truck it drives");
  // B's truck is hurt and loses a wheel there.
  b.c.trucks[0].global = 400;
  b.c.trucks[0].lost[2] = true;
  const before = b.session.netOwn().mark;
  assert.notEqual(before, own.mark, "a lost wheel is sent at once");
  a.session.applyNetOwn({ ...toA("combat", b.session.netOwn()), from: 1 });
  const seen = a.session.view(1);
  assert.equal(seen.trucks[1].hp, 0.4);
  assert.equal(seen.trucks[1].wheels[2], -1);
  assert.deepEqual(seen.lost[1], [false, false, true, false], "its wheel is off here too");
  assert.equal(seen.loose.length, 1, "and flies off here as well");
  assert.ok(seen.log.some((e) => e.kind === "wheel" && e.truck === 1));
  // A's own truck is not B's to judge.
  a.c.trucks[0].global = 900;
  a.session.applyNetOwn({ ...toA("combat", { ...b.session.netOwn(), trucks: [null, { g: 0.1, e: 1, b: 1, w: [1, 1, 1, 1], l: [false, false, false, false], cr: 0, d: 0, wk: 0, rp: 0, wr: false, q: false, by: -1 }] }), from: 1 });
  assert.equal(a.c.trucks[0].global, 900);
  // B's truck wrecked by A's: A's machine gets the credit B owes, once however often it is sent.
  b.c.trucks[0].wrecked = true;
  const owedA = { ...b.session.netOwn(), owed: [{ hp: 0, wrecks: 0 }, { hp: 120, wrecks: 1 }] };
  const credits = a.c.trucks[0].credits;
  a.session.applyNetOwn({ ...toA("combat", owedA), from: 1 });
  a.session.applyNetOwn({ ...toA("combat", owedA), from: 1 });
  assert.equal(a.c.trucks[0].credits, credits + 120 + 1000);
  assert.equal(a.c.trucks[0].wrecks, 1);
  assert.equal(a.session.view(1).out[1], true, "B's truck is out here");
  assert.equal(a.race.trucks[1].outOfRace, true);
});

test("Combat online: the owner decides the end and its rules are everyone's", () => {
  const a = combatMachine("owner", { toughness: "tough", credits: true, startCredits: 800 });
  const b = combatMachine("follower");
  b.session.applyNet(extensionNetFromWire("combat", JSON.parse(JSON.stringify(extensionNetToWire("combat", a.session.netState(), (i) => [1, 2][i]))), (v) => [2, 1].indexOf(v), 2));
  assert.equal(b.c.full.global, a.c.full.global, "the owner's toughness");
  assert.equal(b.c.trucks[0].credits, 800, "the owner's credits at the start");
  // A wreck on B's machine: B decides nothing, the owner ends it.
  b.c.trucks[1].wrecked = true;
  b.session.tick();
  assert.equal(b.race.over, false, "a follower waits for the owner");
  a.c.trucks[1].wrecked = true;
  a.c.order.push(1);
  a.session.tick();
  assert.equal(a.race.over, true);
  b.session.applyNet(extensionNetFromWire("combat", JSON.parse(JSON.stringify(extensionNetToWire("combat", a.session.netState(), (i) => [1, 2][i]))), (v) => [2, 1].indexOf(v), 2));
  assert.equal(b.race.over, true);
  assert.equal(b.session.view(1).winner, 1, "A's truck, B's truck 1, won");
});

test("net-race: every machine sends its own trucks' Combat state as its vehicle, at once on a change; another takes it", () => {
  const wire = {
    toWire: (s, vOf) => extensionNetToWire("combat", s, vOf),
    fromWire: (d, lOf, n) => extensionNetFromWire("combat", d, lOf, n),
    ownToWire: (s, vOf) => extensionNetOwnToWire("combat", s, vOf),
    ownFromWire: (d, lOf, n) => extensionNetOwnFromWire("combat", d, lOf, n),
  };
  const b = combatMachine("follower");
  const sender = createNetRace({ entrants: [2, 1].map((vehicle, i) => ({ vehicle, owned: i === 0 })), rateHz: 20, mode: wire });
  const sent = (now) => sender.collect({ modeOwn: b.session.netOwn() }, now).filter((e) => e.kind === "modeTruck");
  const [first] = sent(0);
  assert.equal(first.vehicle, 2, "as this player's vehicle");
  assert.equal(sent(50).length, 0);
  b.c.trucks[0].lost[1] = true;
  assert.equal(sent(60).length, 1, "a lost wheel goes at once");
  const receiver = createNetRace({ entrants: [1, 2].map((vehicle, i) => ({ vehicle, owned: i === 0 })), rateHz: 20, mode: wire });
  assert.equal(receiver.receive(JSON.parse(JSON.stringify(first))), true);
  const [cmd] = receiver.commands();
  assert.equal(cmd.name, "modeOwn");
  assert.equal(cmd.value.from, 1);
  assert.equal(cmd.value.trucks[1].g, 1);
  assert.equal(cmd.value.trucks[0], null);
});
