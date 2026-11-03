import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEAM_AIR, TAIL_RUNNING, beamAir, beamShows, blinkOn, headlightReach, lampHeading, lampLevel, lampTone, lampsAtStart, lensFacesViewer, lensGlow,
  START_LAMPS, headlightPool, lightIntensity, placeHeadlightPools, startLampCount, startLampGlow, startLampsLit, throwsBeam, toggleLamps,
} from "../src/game/truck-lights.js";
import { WEATHER_LOOK } from "../src/game/weather.js";

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

/* The port's own lamps, with "Truck lamps" (docs/VISUALS.md, "Lamps"). */

test("a tail lamp runs dim with the lamps on and burns full under the brakes, lamps on or off", () => {
  const side = { type: 1, pos: [-3, 2, -9] }, centre = { type: 1, pos: [0, 5, -6] };
  assert.equal(TAIL_RUNNING, 0.22);
  assert.equal(lampLevel(side, off), 0);
  assert.equal(lampLevel(side, lit), TAIL_RUNNING);
  assert.equal(lampLevel(side, { ...off, braking: true }), 1);
  assert.equal(lampLevel(side, { ...lit, braking: true }), 1);
  // The cab's third lamp is a brake lamp only; from the cockpit no tail lamp is seen.
  assert.equal(lampLevel(centre, lit), 0);
  assert.equal(lampLevel(centre, { ...off, braking: true }), 1);
  assert.equal(lampLevel(side, { ...lit, braking: true, cockpit: true }), 0);
  // Every other lamp is lit as the game lights it.
  for (const type of [0, 2, 3, 5, -1, 7]) {
    const lamp = { type, pos: [1, 2, 3] };
    for (const state of [off, lit, { ...lit, reverse: true }]) assert.equal(lampLevel(lamp, state), lightIntensity(lamp, state), `type ${type}`);
  }
});

test("a lamp glows in its own colour: headlights warm white, tail lamps red, reversing lamps white", () => {
  const [r, g, b] = lampTone({ type: 1 });
  assert.ok(r === 1 && g < 0.1 && b < g, "a deep red, not the art's pink");
  for (const type of [0, 3]) assert.ok(lampTone({ type })[2] < lampTone({ type })[0], "warm");
  assert.ok(Math.min(...lampTone({ type: 5 })) > 0.9);
  assert.equal(lampTone({ type: 2 }), null, "another kind keeps its art's colour");
});

test("a lit lens glows past white so the lens flares it, a headlight most, and less by day", () => {
  const head = { type: 0 }, tail = { type: 1 };
  assert.ok(lensGlow(head, 1, 0) > lensGlow(tail, 1, 0) && lensGlow(tail, 1, 0) > 1);
  assert.ok(lensGlow(head, 1, 1) < lensGlow(head, 1, 0.1));
  assert.ok(lensGlow(tail, TAIL_RUNNING, 0) < lensGlow(tail, 1, 0) / 3);
  assert.equal(lensGlow(head, 0, 0), 0);
});

test("a beam is seen by what is in the air: plainly in fog and at night, faintly in rain and snow, hardly on a clear day", () => {
  assert.ok(BEAM_AIR[3] > BEAM_AIR[2] && BEAM_AIR[2] > BEAM_AIR[5] && BEAM_AIR[5] > BEAM_AIR[4]);
  for (const dark of [6, 7, 8]) assert.ok(BEAM_AIR[dark] > BEAM_AIR[0] * 5 && BEAM_AIR[dark] < BEAM_AIR[2], `weather ${dark}`);
  assert.ok(BEAM_AIR[0] <= 0.05 && BEAM_AIR[1] < 0.1);
  assert.equal(beamAir(99), BEAM_AIR[0]);
  // A headlight lights the ground before it whenever it is on: fully in the dark, hardly in the sun.
  assert.equal(headlightReach(WEATHER_LOOK[8].light), 1);
  assert.ok(headlightReach(WEATHER_LOOK[7].light) > 0.85);
  assert.ok(headlightReach(1) > 0 && headlightReach(1) < 0.1);
  // Headlights and roof lamps with a cone throw a beam; nothing else does.
  assert.equal(throwsBeam({ type: 0, coneLength: 40 }), true);
  assert.equal(throwsBeam({ type: 3, coneLength: 40 }), true);
  assert.equal(throwsBeam({ type: 0, coneLength: 0 }), false);
  assert.equal(throwsBeam({ type: 1, coneLength: 40 }), false);
});

/** A stand-in for one of the scene's spot lights: it records where it was aimed, and has no way to be hidden. */
function poolSlot() {
  const point = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
  const position = point();
  return { intensity: -1, visible: true, position, target: { position: point() } };
}

test("switching the headlights on puts a pool on the ground; the pools are shown together while any is lit and hidden together while none is", () => {
  const slots = [poolSlot(), poolSlot(), poolSlot(), poolSlot()];
  const truck = { x: 10, y: 4, z: 20, heading: 0, lit: false };
  const env = { rich: true, headlights: false, daylight: 1, strength: 2.4, cameraX: 0, cameraZ: 0 };
  // By day, with the switch off, every pool is out, and none is in the scene for the shaders to sum.
  placeHeadlightPools(slots, [truck], env);
  assert.deepEqual(slots.map((s) => s.intensity), [0, 0, 0, 0]);
  assert.deepEqual(slots.map((s) => s.visible), [false, false, false, false]);
  // The switch on: the truck's own pool lights the ground, as strongly as the day leaves it, and the spare pools stay out.
  // All four are shown, the spare ones too: the shaders are of two kinds only, with the pools and without.
  truck.lit = true;
  placeHeadlightPools(slots, [truck], env);
  assert.equal(slots[0].intensity, 2.4 * headlightReach(1));
  assert.deepEqual(slots.slice(1).map((s) => s.intensity), [0, 0, 0]);
  assert.deepEqual(slots.map((s) => s.visible), [true, true, true, true]);
  // Thrown forward from just ahead of the truck. The scene's z is the game's z mirrored.
  assert.deepEqual([slots[0].position.x, slots[0].position.y, slots[0].position.z], [10, 7, -26]);
  assert.deepEqual([slots[0].target.position.x, slots[0].target.position.y, slots[0].target.position.z], [10, 2, -110]);
  // Off again: the same four pools, all put out and all hidden.
  truck.lit = false;
  placeHeadlightPools(slots, [truck], env);
  assert.equal(slots.length, 4);
  assert.deepEqual(slots.map((s) => s.intensity), [0, 0, 0, 0]);
  assert.deepEqual(slots.map((s) => s.visible), [false, false, false, false]);
});

test("the pools light the nearest trucks, and without Truck lamps only a weather that lights the lamps", () => {
  const slots = [poolSlot(), poolSlot()];
  const trucks = [
    { x: 0, y: 0, z: 300, heading: 0, lit: true },
    { x: 0, y: 0, z: 40, heading: Math.PI / 2, lit: true },
    { x: 0, y: 0, z: 80, heading: 0, lit: false },
  ];
  // The camera looks from the scene's origin. The truck at z 40 is nearer than the one at 300, and the unlit one is skipped.
  placeHeadlightPools(slots, trucks, { rich: true, headlights: false, daylight: 0, strength: 2.4, cameraX: 0, cameraZ: 0 });
  assert.equal(slots[0].intensity, 2.4);
  assert.equal(slots[0].position.x, 6);
  assert.equal(slots[1].position.z, -306);
  // As the game has it, a night weather lights every truck, switch or not. A clear day lights none.
  placeHeadlightPools(slots, trucks, { rich: false, headlights: true, daylight: 0.25, strength: 2.4, cameraX: 0, cameraZ: 0 });
  assert.equal(slots[0].intensity, 2.4);
  assert.equal(slots[1].intensity, 2.4);
  assert.equal(slots[0].position.x, 6);
  assert.equal(slots[1].position.z, -86);
  assert.deepEqual(slots.map((s) => s.visible), [true, true]);
  placeHeadlightPools(slots, trucks, { rich: false, headlights: false, daylight: 1, strength: 2.4, cameraX: 0, cameraZ: 0 });
  assert.deepEqual(slots.map((s) => s.intensity), [0, 0]);
  assert.deepEqual(slots.map((s) => s.visible), [false, false]);
});

test("the race builds the shaders for the pools shown and for the pools hidden before either is needed", () => {
  // docs/VISUALS.md, "Lamps": two shaders of each lit material, both built as the race starts, so the Headlights key
  // does not stop the picture. The scene's own state is the last built, and is put back.
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const weather = read("../src/render/weather-scene.js");
  assert.match(weather, /warmPools\(build\)/);
  // Without "Truck lamps" the pools' state is the weather's: the scene is still built once, for what is not drawn yet.
  assert.match(weather, /for \(const on of env\.richLamps \? \[!shown, shown\] : \[shown\]\)/);
  // On the first frame, with the trucks in the scene and what waits unseen (the helicopters), and before the race's clock
  // starts: the loading screen stays until the warm-up is done and the frames come steadily.
  const race = read("../src/ui/screens/race.js");
  assert.match(race, /if \(!poolsWarmed\) \{ poolsWarmed = true; weatherScene\.warmPools\(\(\) => scenery\.compile\(camera\)\); \}/);
  assert.match(race, /if \(\(poolsWarmed && steadyFrames >= WARM_FRAMES\) \|\| now - warmStart > WARM_LIMIT_MS\) \{/);
  assert.match(race, /if \(ready && !busy && !paused && !finishing\) \{/);
  // A shader is built for the picture the scene is drawn into as well as for its lights.
  assert.match(read("../src/render/scenery.js"), /const into = lens \? lens\.target : aa \? aa\.flat : null;/);
});

test("the start gantry's red bar is lit through the countdown and the green from the start, as the game has it", () => {
  // MONSTER_EXE_ANALYSIS.md 6.1: red filled with index 1 while the countdown runs and 0 after; green 0, then 2.
  assert.deepEqual(startLampsLit(true), { red: 1, green: 0 });
  assert.deepEqual(startLampsLit(false), { red: 0, green: 1 });
});

test("a start lamp bar is a row of round lamps, lit past white, glowing less by day", () => {
  // The stock bar is some 13 ft long: six lamps 2.2 ft apart, each 1.44 ft across in a bar 2 ft tall.
  assert.equal(startLampCount(13.06), 6);
  assert.equal(startLampCount(0.5), 1);
  assert.ok(START_LAMPS.radiusFt * 2 < 2 && START_LAMPS.radiusFt * 2 < START_LAMPS.pitchFt);
  // Red and green, each wholly its own colour.
  assert.ok(START_LAMPS.red[0] === 1 && START_LAMPS.red[1] < 0.1 && START_LAMPS.red[2] < 0.1);
  assert.ok(START_LAMPS.green[1] === 1 && START_LAMPS.green[0] < 0.2 && START_LAMPS.green[2] < 0.5);
  // Past white so the lens flares them, brighter than a tail lamp's glow, and less so by day.
  assert.ok(START_LAMPS.face > 1);
  assert.ok(startLampGlow(1, 0) > lensGlow({ type: 1 }, 1, 0));
  assert.ok(startLampGlow(1, 1) < startLampGlow(1, 0) && startLampGlow(1, 1) > 1);
  assert.equal(startLampGlow(0, 0), 0);
  // In the dark, their light reaches the trucks on the grid under the gantry.
  assert.ok(START_LAMPS.light > 0 && START_LAMPS.reachFt >= 50);
});

test("a truck's pool is its own lamps': from its headlights' middle, along their aim, as wide and far as their cones", () => {
  const lamp = (type, x, extra = {}) => ({ type, pos: [x, 2, 8.7], heading: 0, pitch: -0.1745, coneLength: 75, coneBase: 0.7, coneRim: 11, ...extra });
  const lights = [lamp(0, -2.4), lamp(0, 2.4), lamp(3, 0, { pos: [0, 5, -0.5], coneLength: 40, coneRim: 3 }), lamp(1, 3, { coneLength: 0 })];
  const pool = headlightPool(lights);
  // The headlights alone: the roof lamp counts only on a truck without headlights, a tail lamp never.
  assert.deepEqual(pool.pos.map((v) => +v.toFixed(3)), [0, 2, 8.7]);
  assert.ok(Math.abs(pool.dir[1] - Math.sin(-0.1745)) < 1e-9 && pool.dir[2] > 0.98);
  assert.ok(Math.abs(pool.angle - Math.atan2(11 + 2.4, 75)) < 1e-9);
  assert.equal(pool.reach, 150);
  assert.equal(headlightPool([lights[2]]).reach, 80);
  assert.equal(headlightPool([lights[3]]), null);
  assert.equal(headlightPool([]), null);
  // Placed by the truck's rotation: a truck turned to face +x throws it along +x, from its own lamps.
  const slots = [poolSlot()];
  const turned = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  placeHeadlightPools(slots, [{ x: 100, y: 10, z: 50, heading: Math.PI / 2, lit: true, pool, matrix: turned }],
    { rich: true, headlights: false, daylight: 0, strength: 2.4, cameraX: 0, cameraZ: 0 });
  assert.ok(Math.abs(slots[0].position.x - 108.7) < 1e-9 && Math.abs(slots[0].position.y - 12) < 1e-9 && Math.abs(slots[0].position.z + 50) < 1e-9);
  assert.ok(slots[0].target.position.x > 200);
  assert.equal(slots[0].angle, pool.angle);
  assert.equal(slots[0].distance, 150);
  // A lit truck whose lamps throw no beam lights no ground.
  placeHeadlightPools(slots, [{ x: 0, y: 0, z: 0, heading: 0, lit: true, pool: null, matrix: turned }],
    { rich: true, headlights: false, daylight: 0, strength: 2.4, cameraX: 0, cameraZ: 0 });
  assert.equal(slots[0].intensity, 0);
});

test("4x4 Evolution's lamp groups: paired with the TRK's lights, lit and facing by 0x44cc50 (EVO2_EXE_ANALYSIS.md 6.6)", async () => {
  const { evoLampGroup, evoLampLights, evoLampLevel, evoLampFacing } = await import("../src/game/truck-lights.js");
  assert.equal(evoLampGroup("LightHL"), "HL");
  assert.equal(evoLampGroup("LIGHTBC"), "BC");
  assert.equal(evoLampGroup("Lights"), null);
  const head = (x) => ({ type: 0, pos: [x, 1.7, 6.9], heading: 0 });
  const brake = (x) => ({ type: 1, pos: [x, 2, -6.7], heading: Math.PI });
  const rev = (x) => ({ type: 5, pos: [x, 2, -6.7], heading: Math.PI });
  const lights = [head(-1.8), head(1.8), brake(-2.1), brake(2.1), brake(0), rev(-2.1), rev(2.1)];
  const p = evoLampLights(lights);
  assert.equal(p.HL, lights[0]); assert.equal(p.FL, lights[0]); assert.equal(p.HR, lights[1]); assert.equal(p.FR, lights[1]);
  assert.equal(p.BL, lights[2]); assert.equal(p.BR, lights[3]); assert.equal(p.BC, lights[4]);
  assert.equal(p.RL, lights[5]); assert.equal(p.RR, lights[6]);
  // A brake lamp within 0.1 ft of the middle is the centre one.
  assert.equal(evoLampLights([brake(0.05)]).BC.pos[0], 0.05);
  const state = { lamps: 0, braking: false, reverse: false, cockpit: false, night: false };
  assert.equal(evoLampLevel(head(1), state), 0);
  assert.equal(evoLampLevel(head(1), { ...state, lamps: 2 }), 1);
  assert.equal(evoLampLevel(brake(2), state), 0.5, "a tail lamp runs at half");
  assert.equal(evoLampLevel(brake(2), { ...state, braking: true }), 1);
  assert.equal(evoLampLevel(brake(0), state), 0, "the centre lamp is a brake lamp only");
  assert.equal(evoLampLevel(rev(2), { ...state, reverse: true }), 1);
  assert.equal(evoLampLevel(head(1), { ...state, lamps: 2, cockpit: true }), 0);
  // Facing: full straight ahead of a headlight, nothing behind it; a rear lamp never under 0.7.
  assert.ok(Math.abs(evoLampFacing(head(0), [0, 1.7, 100]) - 1) < 1e-9);
  assert.equal(evoLampFacing(head(0), [0, 1.7, -100]), 0);
  assert.equal(evoLampFacing(brake(0), [100, 2, -6.7]), 0.7);
  assert.ok(evoLampFacing(brake(0), [0, 2, -100]) > 0.99);
});
