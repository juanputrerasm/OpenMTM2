/*
  Loose Wheels (docs/EXTENSIONS.md, "Mutator: Loose Wheels"; game/extensions/loose-wheels.js and loose-wheels-session.js):
  Combat's wheels in every race, with the wheels coming back after a wait or the pit crew.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REPAIR_S, LOOSE_WHEELS, REPAIR_CHOICES, callPit, createWheelState, damagePercent, damageText, dentsOf, needsRepair, repairDue, restoreWheels,
  wheelHit, wheelView,
} from "../src/game/extensions/loose-wheels.js";
import { IMPACT, WHEEL_CAP } from "../src/game/extensions/combat.js";
import { extensionById, looseWheelsFor } from "../src/game/extensions/loader.js";
import { createMutatorSession } from "../src/game/extensions/session-loader.js";
import { DEFAULT_SETTINGS } from "../src/app/settings.js";

const FULL = LOOSE_WHEELS.wheel;
// A front-left hit (end +1, side -1): the front left wheel (1) is near, the front right (0) far.
const front = (amount) => ({ kind: "front", amount, side: -1, end: 1 });

test("off by default; back on after 8 s; the choices are 5, 8, 12 s or never", () => {
  assert.equal(DEFAULT_SETTINGS.looseWheels, false);
  assert.equal(DEFAULT_SETTINGS.looseWheelsRepairS, 8);
  assert.equal(DEFAULT_REPAIR_S, 8);
  assert.deepEqual([...REPAIR_CHOICES], [5, 8, 12, 0]);
});

test("a race takes Loose Wheels only when switched on, under MTM2 physics, offline, and in a mode that asks for it", () => {
  const on = { looseWheels: true, looseWheelsRepairS: 12 };
  assert.deepEqual(looseWheelsFor(on), { mode: "loose-wheels", repairS: 12 });
  assert.equal(looseWheelsFor({ looseWheels: false }), null);
  assert.equal(looseWheelsFor(on, { physics: "mtm1" }), null);
  assert.equal(looseWheelsFor(on, { physics: "evo2" }), null);
  assert.equal(looseWheelsFor(on, { online: true }), null);
  assert.equal(looseWheelsFor(on, { extension: extensionById("combat") }), null, "Combat has its own wheels");
  assert.equal(looseWheelsFor(on, { extension: extensionById("hockey") }), null);
  assert.ok(looseWheelsFor(on, { extension: extensionById("race-rumble") }), "Race & Rumble asks for it");
  assert.equal(looseWheelsFor({ looseWheels: true, looseWheelsRepairS: 0 }).repairS, 0, "never: the pit crew only");
  assert.equal(looseWheelsFor({ ...on, crashDamage: false }), null, "only with Crash damage on");
});

test("wear: a hit wears the struck corner by Combat's shares, at most WHEEL_CAP of a pool; a scrape does nothing", () => {
  const t = createWheelState();
  assert.deepEqual(wheelHit(t, front(IMPACT.least - 1)).off, []);
  assert.deepEqual(t.wheels, [FULL, FULL, FULL, FULL]);
  wheelHit(t, front(100));
  assert.equal(t.wheels[1], FULL - 60, "near: 0.6");
  assert.equal(t.wheels[0], FULL - 20, "far: 0.2");
  wheelHit(t, front(140));
  assert.equal(t.wheels[1], FULL - 60 - FULL * WHEEL_CAP, "capped");
});

test("a worn-out wheel struck again comes off; the auto-repair's clock starts", () => {
  const t = createWheelState();
  t.wheels[1] = 0;
  const out = wheelHit(t, front(50), 12);
  assert.deepEqual(out.off, [1]);
  assert.equal(t.lost[1], true);
  assert.equal(t.downSince, 12);
  assert.deepEqual(wheelHit(t, front(50), 13).off, [], "already off");
  assert.equal(t.downSince, 12);
});

test("a violent hit pops the struck wheel at once; a huge one tears the struck end's axle away", () => {
  const t = createWheelState();
  assert.deepEqual(wheelHit(t, front(LOOSE_WHEELS.popAt)).off, [1]);
  const u = createWheelState();
  const out = wheelHit(u, { kind: "rear", amount: LOOSE_WHEELS.axleAt, side: 1, end: -1 });
  assert.deepEqual(out.off.sort(), [2, 3]);
  assert.equal(out.axle, 1);
  assert.deepEqual(u.axles, [false, true]);
});

test("a roll wears all four and takes none off; a landing only off when hard", () => {
  const t = createWheelState();
  t.wheels = [0, 0, 0, 0];
  assert.deepEqual(wheelHit(t, { kind: "roll", amount: 40, side: 1, end: 1 }).off, []);
  const u = createWheelState();
  wheelHit(u, { kind: "landing", amount: 100, side: 1, end: -1 });
  assert.deepEqual(u.wheels, [FULL - 10, FULL - 10, FULL - 10, FULL - 10]);
  assert.deepEqual(wheelHit(u, { kind: "landing", amount: LOOSE_WHEELS.popAt, side: 1, end: -1 }).off, [2]);
});

test("the pit crew: only with something to fix, held for 2 s, then everything back", () => {
  const t = createWheelState();
  assert.equal(needsRepair(t), false);
  assert.equal(callPit(t, 5), false);
  wheelHit(t, front(LOOSE_WHEELS.axleAt), 5);
  assert.equal(callPit(t, 6), true);
  assert.equal(callPit(t, 6.5), false, "already on it");
  assert.equal(repairDue(t, 7.9, 0), false);
  assert.equal(repairDue(t, 8, 0), true);
  const lost = t.lost;
  restoreWheels(t, FULL, { pit: true });
  assert.deepEqual(t, { wheels: [FULL, FULL, FULL, FULL], lost: [false, false, false, false], axles: [false, false], downSince: null, pitUntil: null, repairs: 1, pits: 1 });
  assert.equal(t.lost, lost, "the same array: the lost-wheel ground holds it");
});

test("the wait: due `repairS` after the first wheel came off; never at 0", () => {
  const t = createWheelState();
  wheelHit(t, front(LOOSE_WHEELS.popAt), 10);
  assert.equal(repairDue(t, 17.9, 8), false);
  assert.equal(repairDue(t, 18, 8), true);
  assert.equal(repairDue(t, 1000, 0), false);
  const v = wheelView(t, 15, 8);
  assert.equal(v.wheels[1], -1);
  assert.equal(v.back, 3);
  assert.equal(v.pit, null);
});

/** Trucks as the worker has them, enough for the runtime: the player first, a computer truck second. */
function machine(payload) {
  const trucks = [0, 1].map((i) => ({
    state: {
      pos: [i * 50, 0, 0], euler: [0, 0, 0], heliTimer: 0, bvel: [0, 0, 0], matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      controls: { throttle: 1, brakeFront: 0, brakeRear: 0 }, tires: [0, 1, 2, 3].map(() => ({ penetration: 0, onGround: true, grip: 1 })),
    },
    autopilot: i === 1, params: { hubs: [[3, -2, 5], [-3, -2, 5], [3, -2, -5], [-3, -2, -5]], tireWidthFt: 2, tireRadiusFt: 2.5 }, recovery: {},
  }));
  const race = { clock: 3, startTime: 3, trucks: trucks.map(() => ({ place: 0 })) };
  const session = createMutatorSession(payload, { step: 1 / 60, trucks, race });
  return { session, trucks, race, wheels: session.debug.wheels };
}

test("the runtime: a lost wheel flies and its stub drags; the pit crew holds the truck, then puts it back", () => {
  const { session, trucks, race, wheels } = machine({ mode: "loose-wheels", repairS: 8 });
  assert.equal(createMutatorSession(null, {}), null);
  wheelHit(wheels[0], front(LOOSE_WHEELS.popAt), 0);
  session.debug.per[0].prevVel = null;
  // Thrown as the worker would: through a hit is the usual way; here the view still shows the wheel off.
  assert.equal(session.view().trucks[0].wheels[1], -1);
  trucks[0].state.bvel = [0, 0, 30];
  session.afterTruckStep(trucks[0]);
  assert.equal(trucks[0].state.tires[1].grip, 0, "no grip on a lost wheel");
  assert.ok(trucks[0].state.bvel[2] < 30, "the stub drags");
  assert.deepEqual(session.action("pit", 0), { pit: LOOSE_WHEELS.pitS });
  session.afterTruckStep(trucks[0]);
  assert.equal(trucks[0].state.controls.throttle, 0);
  assert.equal(trucks[0].state.controls.brakeFront, 1);
  race.clock += 2;
  session.tick();
  assert.equal(session.view().trucks[0].wheels[1], 1, "back on");
  assert.equal(session.view().trucks[0].repairs, 1);
  assert.deepEqual(session.action("pit", 0), { nothing: true });
});

test("the runtime: a computer truck's wheels come back after the wait even when the player's never do", () => {
  const { session, race, wheels } = machine({ mode: "loose-wheels", repairS: 0 });
  wheelHit(wheels[0], front(LOOSE_WHEELS.popAt), 0);
  wheelHit(wheels[1], front(LOOSE_WHEELS.popAt), 0);
  race.clock += LOOSE_WHEELS.cpuRepairS;
  session.tick();
  const v = session.view();
  assert.equal(v.trucks[0].wheels[1], -1, "the player's: the pit crew only");
  assert.equal(v.trucks[1].wheels[1], 1, "the computer's: back after the wait");
});

test("the runtime: a crash into a wall at speed, measured as Combat measures it, pops the struck wheel and throws it", () => {
  const { session, trucks } = machine({ mode: "loose-wheels", repairS: 8 });
  trucks[0].state.bvel = [0, 0, 130];
  session.tick();
  trucks[0].state.bvel = [0, 0, 0];
  session.tick();
  session.tick();
  const v = session.view();
  assert.equal(v.trucks[0].wheels[0], -1, "the front right: struck head on");
  assert.equal(v.loose.length, 1);
  assert.ok(v.log.some((e) => e.kind === "wheel" && e.truck === 0 && e.wheel === 0));
  assert.equal(session.movableBoxes().length, 1, "every truck meets it");
});

test("the board's damage: the weakest wheel's pool left; 0% only with a wheel off, with the wait or the pit crew's seconds", () => {
  const t = createWheelState();
  assert.equal(damagePercent(wheelView(t, 0, 8)), 100);
  wheelHit(t, front(100));
  assert.equal(damagePercent(wheelView(t, 0, 8)), 76, "the front left: 250 - 60");
  t.wheels[1] = 0;
  assert.equal(damagePercent(wheelView(t, 0, 8)), 1, "worn to nothing but still on");
  assert.equal(t.downSince, null, "no wait while every wheel is on");
  wheelHit(t, front(50), 10);
  assert.deepEqual(damageText(wheelView(t, 12.5, 8)), { percent: 0, extra: 6, pit: false });
  callPit(t, 13);
  assert.deepEqual(damageText(wheelView(t, 13.5, 8)), { percent: 0, extra: 2, pit: true });
});

test("another wheel lost while waiting starts the wait again, and the pit crew's hold", () => {
  const t = createWheelState();
  wheelHit(t, front(LOOSE_WHEELS.popAt), 0);
  assert.equal(repairDue(t, 7, 8), false);
  wheelHit(t, { kind: "rear", amount: LOOSE_WHEELS.popAt, side: 1, end: -1 }, 7);
  assert.equal(repairDue(t, 8.5, 8), false, "not 1 s after the second wheel");
  assert.equal(repairDue(t, 15, 8), true);
  const u = createWheelState();
  wheelHit(u, front(LOOSE_WHEELS.popAt), 0);
  callPit(u, 1);
  wheelHit(u, { kind: "rear", amount: LOOSE_WHEELS.popAt, side: 1, end: -1 }, 2.5);
  assert.equal(repairDue(u, 3.1, 0), false);
  assert.equal(repairDue(u, 4.5, 0), true);
});

test("a counted hit dents the struck corner's outermost hull zones; a landing or a roll does not", () => {
  const hull = [[-3.67, 0, 9.2], [3.67, 0, 9.2], [-3.67, 2.56, 9.2], [3.67, 2.56, 9.2], [-2.61, 5.23, 1.89], [2.61, 5.23, 1.89],
    [-2.14, 5.23, -0.8], [2.1, 5.23, -0.8], [-3.67, 2.82, -9.2], [3.67, 2.82, -9.2], [-3.67, 0, -9.2], [3.67, 0, -9.2]];
  assert.deepEqual(dentsOf(hull, front(100)).map((d) => d.zone).sort(), [1, 3], "front left");
  assert.deepEqual(dentsOf(hull, { kind: "rear", amount: 100, side: 1, end: -1 }).map((d) => d.zone).sort(), [10, 12]);
  assert.equal(dentsOf(hull, front(100))[0].force, 20000);
  assert.deepEqual(dentsOf(hull, { kind: "landing", amount: 200, side: 1, end: 1 }), []);
  assert.deepEqual(dentsOf(hull, front(5)), []);
});

test("the runtime: a repair keeps the ground's lost-wheel list; the wait clears no dents, the pit crew does", () => {
  const { session, race, wheels } = machine({ mode: "loose-wheels", repairS: 8 });
  const held = wheels[0].lost;
  wheelHit(wheels[0], front(LOOSE_WHEELS.popAt), 0);
  race.clock += 8;
  session.tick();
  assert.equal(wheels[0].lost, held);
  assert.deepEqual(held, [false, false, false, false]);
  assert.equal(session.view().trucks[0].pits, 0);
  wheelHit(wheels[0], front(LOOSE_WHEELS.popAt), race.clock - race.startTime);
  session.action("pit", 0);
  race.clock += LOOSE_WHEELS.pitS;
  session.tick();
  assert.equal(session.view().trucks[0].pits, 1);
});

test("online: a machine sends the wheels of the trucks it drives, and the others show them (rooms' wheels event)", () => {
  const owner = machine({ mode: "loose-wheels", repairS: 8 });
  wheelHit(owner.wheels[0], front(LOOSE_WHEELS.popAt), 0);
  const [mine, cpu] = owner.session.netOwn();
  assert.equal(mine.truck, 0);
  assert.equal(mine.lost, 0b10, "the front left wheel off");
  assert.equal(mine.axles, 0);
  assert.equal(mine.wear[1], 0);
  assert.equal(cpu.lost, 0);

  // On the other machine truck 0 is driven remotely: its wheels come from the event.
  const other = machine({ mode: "loose-wheels", repairS: 8 });
  other.trucks[0].remote = true;
  assert.equal(other.session.netOwn().some((u) => u.truck === 0), false, "a remote truck is not this machine's to send");
  other.session.applyNetOwn([{ ...mine }]);
  assert.equal(other.session.view().trucks[0].wheels[1], -1, "thrown here too");
  assert.ok(other.session.view().log.some((e) => e.kind === "wheel" && e.truck === 0 && e.wheel === 1));
  other.session.applyNetOwn([{ ...mine, lost: 0, wear: [1, 1, 1, 1], repairs: mine.repairs + 1 }]);
  assert.equal(other.session.view().trucks[0].wheels[1], 1, "a repair puts it back");
  // A truck this machine drives is never overwritten.
  other.session.applyNetOwn([{ truck: 1, lost: 15, axles: 3 }]);
  assert.equal(other.session.view().trucks[1].wheels[0], 1);
});
