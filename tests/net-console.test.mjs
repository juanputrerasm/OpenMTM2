// The console in a network race (src/ui/net-console.js) and the host's start rules (src/app/net.js `startProblem`).

import test from "node:test";
import assert from "node:assert/strict";
import { NET_CONSOLE_COMMANDS, findPlayer, keepNetCommands, netConsoleCommands } from "../src/ui/net-console.js";
import { startProblem } from "../src/app/net.js";

const t = (tag, ...args) => tag.replace(/<<(\d)>>/g, (_, n) => String(args[n - 1]));

test("a network race keeps only the commands that act at once", () => {
  const all = Object.fromEntries(["info", "music", "overlap", "backdrop", "physics", "restart", "addbot", "truck", "laps", "finish", "map", "weather", "fps", "quit"].map((n) => [n, {}]));
  const kept = Object.keys(keepNetCommands(all)).sort();
  assert.deepEqual(kept, ["fps", "info", "music", "quit"]);
  for (const name of ["overlap", "restart", "truck", "addbot", "physics", "backdrop", "laps", "finish", "map", "weather"]) assert.ok(!NET_CONSOLE_COMMANDS.has(name), name);
});

test("players are found by their number in players or by name", () => {
  const players = [{ name: "Rex" }, { name: "Rexy" }, { name: "Mud Dog" }];
  assert.equal(findPlayer(players, "2").name, "Rexy");
  assert.equal(findPlayer(players, "rex").name, "Rex");
  assert.equal(findPlayer(players, "mud").name, "Mud Dog");
  assert.ok(findPlayer(players, "re").error, "two names start with re");
  assert.ok(findPlayer(players, "9").error);
  assert.ok(findPlayer(players, "").error);
});

function fakeContext({ host = true } = {}) {
  const kicked = [];
  const players = [
    { dpid: 1, name: "Ann", local: true, isHost: host, truck: "BIGFOOT.TRK", latency: 40 },
    { dpid: 2, name: "Ben", truck: "GRAVE.TRK", latency: 120 },
    { dpid: 3, name: "Bot", computer: true, truck: "X.TRK" },
  ];
  const session = { state: () => ({ players }), isHost: () => host, kick: (id) => kicked.push(id), chat: () => {} };
  return { context: { t, settings: { net: {} }, net: { session } }, kicked };
}

test("mute, unmute and kick from the console; only the host kicks", () => {
  const { context, kicked } = fakeContext();
  let saved = 0;
  const commands = netConsoleCommands(context, { save: () => saved++ });
  assert.match(commands.players.run([], ""), /1\s+Ben/);
  assert.equal(commands.mute.run([], "ben"), "Ben is muted.");
  assert.deepEqual(context.settings.net.muted, ["Ben"]);
  assert.match(commands.players.run([], ""), /muted/);
  assert.equal(commands.unmute.run([], "BEN"), "Ben is no longer muted.");
  assert.deepEqual(context.settings.net.muted, []);
  assert.equal(saved, 2);
  assert.equal(commands.kick.run([], "1"), "Removing Ben.");
  assert.deepEqual(kicked, [2]);
  assert.throws(() => commands.kick.run([], "Bot"), /No player is called Bot/, "a computer is not a player to kick");

  const guest = fakeContext({ host: false });
  assert.equal(netConsoleCommands(guest.context, { save: () => {} }).kick.run([], "Ben"), "Only the host can remove players.");
  assert.deepEqual(guest.kicked, []);
});

test("the host cannot start while a player lacks the track, or a truck unless allowed", () => {
  const players = [
    { name: "Ann", local: true, truck: "BIGFOOT.TRK" },
    { name: "Ben", truck: "CUSTOM.TRK", ready: true },
    { name: "Bot", computer: true, truck: "ODD.TRK" },
  ];
  const st = (over = {}) => ({ game: { track: { sit: "TPARK.SIT" } }, players, canStart: true, ...over });
  const hasTruck = (file) => file !== "CUSTOM.TRK";
  assert.equal(startProblem(st({ game: { track: null } })).text, "Choose a track on the Races screen first.");
  const lacking = startProblem(st({ players: [players[0], { ...players[1], missingTrack: true }] }), { hasTruck });
  assert.deepEqual(lacking.args, ["Ben"]);
  assert.match(lacking.text, /Without the track/);
  const truck = startProblem(st(), { hasTruck });
  assert.deepEqual(truck.args, ["Ben (CUSTOM.TRK)"]);
  assert.equal(startProblem(st(), { hasTruck, allowMissingTrucks: true }), null);
  assert.equal(startProblem(st({ canStart: false }), { hasTruck, allowMissingTrucks: true }).text, "Every player must be Ready.");
});
