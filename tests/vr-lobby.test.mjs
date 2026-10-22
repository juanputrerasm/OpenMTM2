import { test } from "node:test";
import assert from "node:assert/strict";
import { LOBBY_RACE_TYPES, MAX_OPPONENTS, createLobby, opponentFiles } from "../src/game/vr/lobby.js";
import { itemUsable, itemValue } from "../src/game/vr/menu.js";

const TRACKS = [
  { file: "TPARK.SIT", name: "Farm Road 29", raceType: "circuit", defaultLaps: 3, weatherMask: 0b10000011 },   // Clear, Cloudy, Night
  { file: "DRAG.SIT", name: "A Drag Strip", raceType: "drag", defaultLaps: 1 },
  { file: "MAIN.SIT", name: "Voodoo Island", raceType: "rally", defaultLaps: 1, weatherMask: 0b1 },
  { file: "SUMMIT1.SIT", name: "Arena Rumble", raceType: "summit", defaultLaps: 5, weatherMask: 0 },
];
const TRUCKS = ["BIGFOOT", "DIGGER", "SNAKEBIT", "CRUSHER", "BEARFOOT"].map((n) => ({ file: `${n}.TRK`, name: n[0] + n.slice(1).toLowerCase() }));

/** The board's items by label, and a way to step one. */
function work(menu) {
  const item = (label) => menu.items.find((i) => i.label === label);
  return {
    value: (label) => itemValue(item(label)),
    step: (label, direction = 1) => { menu.hover(menu.items.indexOf(item(label))); menu.change(direction); },
    choose: (label) => { menu.hover(menu.items.indexOf(item(label))); return menu.select(); },
    item,
  };
}

test("the lobby opens on what was chosen last, and offers only the races the port runs", () => {
  const menu = createLobby({ tracks: TRACKS, trucks: TRUCKS, choices: { track: "MAIN.SIT", truck: "DIGGER.TRK", opponents: 5, weather: 0 }, onStart() {} });
  const w = work(menu);
  assert.deepEqual([w.value("Track"), w.value("Truck"), w.value("Opponents"), w.value("Weather")], ["Voodoo Island", "Digger", "4", "Clear"]);
  assert.deepEqual(menu.lines, ["Rally Race"]);
  // Stepping through the tracks never lands on the drag strip.
  const seen = new Set();
  for (let i = 0; i < 6; i++) { w.step("Track"); seen.add(w.value("Track")); }
  assert.deepEqual([...seen].sort(), ["Arena Rumble", "Farm Road 29", "Voodoo Island"]);
  assert.deepEqual([...LOBBY_RACE_TYPES], ["circuit", "rally", "summit"]);
  // Nothing stored, or things that are gone: the first of each.
  const fresh = work(createLobby({ tracks: TRACKS, trucks: TRUCKS, choices: { track: "GONE.SIT", truck: "GONE.TRK" }, onStart() {} }));
  assert.deepEqual([fresh.value("Track"), fresh.value("Truck"), fresh.value("Opponents")], ["Farm Road 29", "Bigfoot", "3"]);
});

test("a track brings its own length and only the weather it allows", () => {
  const menu = createLobby({ tracks: TRACKS, trucks: TRUCKS, choices: { track: "TPARK.SIT", weather: 7 }, onStart() {} });
  const w = work(menu);
  assert.deepEqual([w.value("Laps"), w.value("Weather")], ["3", "Night"]);
  w.step("Laps"); w.step("Laps");
  assert.equal(w.value("Laps"), "5");
  // Farm Road allows Clear, Cloudy and Night, and a draw among them.
  const weathers = [];
  for (let i = 0; i < 4; i++) { w.step("Weather"); weathers.push(w.value("Weather")); }
  assert.deepEqual(weathers, ["Random", "Clear", "Cloudy", "Night"]);
  // Voodoo Island allows only Clear, and is one lap long.
  w.step("Track");
  assert.deepEqual([w.value("Track"), w.value("Laps"), w.value("Weather")], ["Voodoo Island", "1", "Clear"]);
  w.step("Weather");
  assert.equal(w.value("Weather"), "Clear");
  // A Rumble is timed: the length is in minutes.
  w.step("Track");
  assert.deepEqual([menu.lines[0], w.value("Minutes")], ["Summit Rumble", "5"]);
  assert.equal(w.item("Laps"), undefined);
  // The length stays between 1 and 99.
  for (let i = 0; i < 10; i++) w.step("Minutes", -1);
  assert.equal(w.value("Minutes"), "1");
  for (let i = 0; i < 120; i++) w.step("Minutes");
  assert.equal(w.value("Minutes"), "99");
});

test("the field: up to seven opponents, never more than there are other trucks", () => {
  const w = work(createLobby({ tracks: TRACKS, trucks: TRUCKS, onStart() {} }));
  for (let i = 0; i < 10; i++) w.step("Opponents");
  assert.equal(w.value("Opponents"), String(TRUCKS.length - 1));
  for (let i = 0; i < 10; i++) w.step("Opponents", -1);
  assert.equal(w.value("Opponents"), "0");
  assert.equal(MAX_OPPONENTS, 7);
  // One truck in the catalogue: nobody to race against, and the item cannot be chosen.
  const alone = createLobby({ tracks: TRACKS, trucks: TRUCKS.slice(0, 1), onStart() {} });
  assert.equal(itemUsable(alone.items.find((i) => i.label === "Opponents")), false);
});

test("opponents: the stored ones first, without the player's truck, then the catalogue's order", () => {
  assert.deepEqual(opponentFiles(TRUCKS, "BIGFOOT.TRK", ["CRUSHER.TRK", "BIGFOOT.TRK", "GONE.TRK", "CRUSHER.TRK"], 3), ["CRUSHER.TRK", "DIGGER.TRK", "SNAKEBIT.TRK"]);
  assert.deepEqual(opponentFiles(TRUCKS, "DIGGER.TRK", 3, 2), ["BIGFOOT.TRK", "SNAKEBIT.TRK"]);
  assert.deepEqual(opponentFiles(TRUCKS, "DIGGER.TRK", ["BEARFOOT.TRK", "SNAKEBIT.TRK"], 1), ["BEARFOOT.TRK"]);
  assert.deepEqual(opponentFiles(TRUCKS, "DIGGER.TRK", undefined, 0), []);
  assert.equal(opponentFiles(TRUCKS, "DIGGER.TRK", [], 99).length, TRUCKS.length - 1);
});

test("starting hands over the whole choice; leaving and backing out both leave", () => {
  let started = null, left = 0;
  const menu = createLobby({
    tracks: TRACKS, trucks: TRUCKS, choices: { track: "TPARK.SIT", truck: "SNAKEBIT.TRK", opponents: ["BEARFOOT.TRK", "SNAKEBIT.TRK"], weather: "random" },
    onStart: (chosen) => { started = chosen; }, onLeave: () => { left++; },
  });
  const w = work(menu);
  assert.equal(w.value("Opponents"), "2");
  w.step("Opponents");
  assert.equal(w.choose("Start race"), true);
  assert.deepEqual([started.track.file, started.truck.file, started.laps, started.weather], ["TPARK.SIT", "SNAKEBIT.TRK", 3, "random"]);
  // The player's own truck is dropped from the stored field and the catalogue fills it up.
  assert.deepEqual(started.opponents, ["BEARFOOT.TRK", "BIGFOOT.TRK", "DIGGER.TRK"]);
  w.choose("Leave VR");
  menu.back();
  assert.equal(left, 2);
  // Without a way out the board has no such item.
  assert.equal(createLobby({ tracks: TRACKS, trucks: TRUCKS, onStart() {} }).items.some((i) => i.label === "Leave VR"), false);
});

test("names are put through the game's message table where it has them", () => {
  const menu = createLobby({ tracks: TRACKS, trucks: TRUCKS, onStart() {}, translate: (text) => `<${text}>` });
  assert.deepEqual(menu.lines, ["<Circuit Race>"]);
  assert.equal(itemValue(menu.items.find((i) => i.label === "<Weather>")), "<Clear>");
});

test("nothing to race on, or nothing to race in: no lobby", () => {
  assert.equal(createLobby({ tracks: TRACKS.filter((t) => t.raceType === "drag"), trucks: TRUCKS, onStart() {} }), null);
  assert.equal(createLobby({ tracks: TRACKS, trucks: [], onStart() {} }), null);
});
