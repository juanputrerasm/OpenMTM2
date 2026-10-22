/*
  Extension modes in an online room (docs/EXTENSIONS.md, "Over the network"): the owner's state keyed
  by vehicle number, taken back in another machine's truck order; net-race's pacing; and a follower's
  Tag runtime kept in step with the owner's.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { createTag, tagStep } from "../src/game/extensions/tag.js";
import { createHockey } from "../src/game/extensions/hockey.js";
import { extensionNetFromWire, extensionNetToWire } from "../src/game/extensions/race-loader.js";
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
