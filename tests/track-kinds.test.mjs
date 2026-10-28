/*
  Which tracks the checkpoint modes (Combat, Race & Rumble) are offered on (game/extensions/track-kinds.js), and the
  Races screen's rule that the bar's GO refuses a mode the track cannot take (app/flow.js).
*/
import test from "node:test";
import assert from "node:assert/strict";
import { hasCheckpoints } from "../src/game/extensions/track-kinds.js";
import { COMBAT_EXTENSION } from "../src/game/extensions/combat.js";
import { RNR_EXTENSION } from "../src/game/extensions/race-rumble.js";
import { resolveGameMode } from "../src/app/flow.js";

const kinds = {
  circuit: { raceType: "circuit" },
  rally: { raceType: "rally" },
  cpr: { raceType: "circuit", game: "CPR" },
  evoRally: { raceType: "rally", game: "EVO2" },
  evoMission: { raceType: "circuit", game: "EVO2", freeRoamOnly: true },
  drag: { raceType: "drag" },
  summit: { raceType: "summit" },
  freeroam: { raceType: "freeroam", freeRoamOnly: true },
};

test("only circuits and rallies with checkpoints are checkpoint tracks", () => {
  const yes = Object.entries(kinds).filter(([, track]) => hasCheckpoints(track)).map(([name]) => name);
  assert.deepEqual(yes, ["circuit", "rally", "cpr", "evoRally"]);
  assert.equal(hasCheckpoints(null), false);
});

test("Combat and Race & Rumble take the checkpoint tracks alone", () => {
  for (const extension of [COMBAT_EXTENSION, RNR_EXTENSION]) {
    for (const track of Object.values(kinds)) assert.equal(extension.acceptsTrack(track), hasCheckpoints(track), `${extension.id} ${track.raceType}`);
  }
});

test("a mode the track cannot take resolves to no mode, so GO refuses it", () => {
  assert.equal(resolveGameMode("combat", kinds.drag), null);
  assert.equal(resolveGameMode("combat", kinds.summit), null);
  assert.equal(resolveGameMode("combat", kinds.rally), "combat");
});
