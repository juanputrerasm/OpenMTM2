/*
  The room servers the Connect screen offers (src/app/net.js): multiplayer.openmtm2.workers.dev and localhost first, then
  the servers the player has used, newest first.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROOM_SERVERS, RECENT_ROOM_SERVERS, rememberServer, roomServerList } from "../src/app/net.js";

test("the list starts with multiplayer.openmtm2.workers.dev and localhost, then the servers used, each once", () => {
  assert.deepEqual(DEFAULT_ROOM_SERVERS, ["multiplayer.openmtm2.workers.dev", "localhost"]);
  assert.deepEqual(roomServerList({}), ["multiplayer.openmtm2.workers.dev", "localhost"]);
  assert.deepEqual(roomServerList({ recentServers: ["rooms.example.org", "LOCALHOST", " rooms.example.org ", 7] }),
    ["multiplayer.openmtm2.workers.dev", "localhost", "rooms.example.org"]);
});

test("a server used goes first among the remembered ones, without repeats or defaults, up to the limit", () => {
  let recent = [];
  recent = rememberServer(recent, "a.example");
  recent = rememberServer(recent, "b.example");
  recent = rememberServer(recent, "A.example");
  assert.deepEqual(recent, ["A.example", "b.example"]);
  assert.deepEqual(rememberServer(recent, "multiplayer.openmtm2.workers.dev"), recent, "a default server is already listed");
  assert.deepEqual(rememberServer(recent, "  "), recent);
  for (let i = 0; i < 20; i++) recent = rememberServer(recent, `s${i}.example`);
  assert.equal(recent.length, RECENT_ROOM_SERVERS);
  assert.equal(recent[0], "s19.example");
});
