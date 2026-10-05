import test from "node:test";
import assert from "node:assert/strict";
import { garageSummary, raceLengthLabel, raceTypeName, trackPreviewName } from "../src/game/menu-data.js";

test("classic menu labels and stock track preview artwork", () => {
  assert.equal(raceTypeName("summit"), "Summit Rumble");
  assert.equal(raceLengthLabel("summit"), "Minutes");
  assert.equal(raceLengthLabel("rally"), "Laps");
  assert.equal(trackPreviewName("TPARK.SIT"), "FARM");
  assert.equal(trackPreviewName("MYTRACK.SIT"), "MYTRACK");
  assert.equal(garageSummary({ transferSetting: 1500, tireCut: 1, suspension: 0 }), "1500 m/s");
});
