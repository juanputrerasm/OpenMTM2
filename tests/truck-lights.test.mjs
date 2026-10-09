import test from "node:test";
import assert from "node:assert/strict";
import { beamShows, blinkOn, lampHeading, lampsAtStart, lensFacesViewer, lightIntensity, toggleLamps } from "../src/game/truck-lights.js";

const off = { lamps: 0, braking: false, reverse: false, cockpit: false, night: false };
const lit = { ...off, lamps: 2, night: true };

test("the lamp switch starts on at dusk and night and the key toggles it", () => {
  assert.equal(lampsAtStart(true), 2);
  assert.equal(lampsAtStart(false), 0);
  assert.equal(toggleLamps(0), 2);
  assert.equal(toggleLamps(2), 0);
});

test("headlights follow the switch, also from the cockpit", () => {
  const head = { type: 0, pos: [1, 2, 3] };
  assert.equal(lightIntensity(head, off), 0);
  assert.equal(lightIntensity(head, lit), 1);
  assert.equal(lightIntensity(head, { ...lit, cockpit: true }), 1);
});

test("side brake lamps glow dim with the lamps, 0.6 braking, full both", () => {
  const side = { type: 1, pos: [-3, 2, -9] };
  assert.equal(lightIntensity(side, off), 0);
  assert.equal(lightIntensity(side, { ...off, braking: true }), 0.6);
  assert.equal(lightIntensity(side, { ...off, lamps: 2 }), 0.4);
  assert.equal(lightIntensity(side, { ...lit, braking: true }), 1);
  assert.equal(lightIntensity(side, { ...off, braking: true, cockpit: true }), 0);
});

test("the centre brake lamp lights only when braking", () => {
  const centre = { type: 1, pos: [0, 4.5, 0] };
  assert.equal(lightIntensity(centre, lit), 0);
  assert.equal(lightIntensity(centre, { ...off, braking: true }), 0.6);
  assert.equal(lightIntensity(centre, { ...lit, braking: true }), 1);
});

test("reverse lamps need reverse gear; other types follow the switch", () => {
  assert.equal(lightIntensity({ type: 5, pos: [0, 0, 0] }, { ...off, reverse: true }), 1);
  assert.equal(lightIntensity({ type: 5, pos: [0, 0, 0] }, off), 0);
  assert.equal(lightIntensity({ type: 4, pos: [0, 0, 0] }, lit), 1);
  assert.equal(lightIntensity({ type: 4, pos: [0, 0, 0] }, off), 0);
  assert.equal(lightIntensity({ type: 2, pos: [0, 0, 0] }, lit), 1);
  assert.equal(lightIntensity({ type: -1, pos: [0, 0, 0] }, { ...off, night: true }), 1);
});

test("blinking, beacon spin, beams and which side a lens faces", () => {
  const blink = { msOn: 300, msOff: 700 };
  assert.equal(blinkOn(blink, 100), true);
  assert.equal(blinkOn(blink, 300), false);
  assert.equal(blinkOn(blink, 1100), true);
  assert.equal(blinkOn({ msOn: 0, msOff: 0 }, 5000), true);
  assert.equal(lampHeading({ heading: 1, spin: -Math.PI * 2 }, 0.25), 1 - Math.PI / 2);
  assert.equal(beamShows({ coneLength: 75 }, 1, true), true);
  assert.equal(beamShows({ coneLength: 75 }, 1, false), false);
  assert.equal(beamShows({ coneLength: 0 }, 1, true), false);
  // A rear lamp (heading pi) is seen from behind the truck, not from the front.
  const rear = { pos: [0, 0, -9], heading: Math.PI };
  assert.equal(lensFacesViewer(rear, [0, 3, -30]), true);
  assert.equal(lensFacesViewer(rear, [0, 3, 30]), false);
});
