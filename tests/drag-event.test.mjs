/*
  A drag weekend (src/game/events/drag-event.js, MONSTER_EXE_ANALYSIS.md 6.4): qualifying, the
  bracket and its byes, the lanes, settling a pairing, simulating one, the final order.
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONALITIES, bracketSize, canSimulate, chooseLane, closeQualifying, createDragEvent, currentPairing, finalOrder, firstRound, launchOffset,
  recordPass, roundName, simulateOthers, simulatePairing, stageDepth, winOdds,
} from "../src/game/events/drag-event.js";

const field = (n, personality = "steady") => Array.from({ length: n }, (_, i) => ({ name: i ? `Cpu${i}` : "You", truck: `T${i}.TRK`, player: i === 0, personality }));
/** A random source that hands out these values in turn. */
const seq = (...values) => { let k = 0; return () => values[k++ % values.length]; };
/** A seeded source, for runs that only need to be repeatable. */
const seeded = (seed = 1) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const MID = () => 0.5;
/** An event of `n` drivers, qualified: the baseline 4 s, the player in `et`. With MID every steady driver computes 4.03 s. */
function qualified(n, et = 3.5, random = MID, personality = "steady") {
  const event = createDragEvent({ strip: { file: "DRAG3.SIT", name: "B.C. Place" }, field: field(n, personality) });
  closeQualifying(event, [{ et, lane: 0 }], 4, random);
  return event;
}
const clean = (et) => ({ et, code: null });
const seeds = (event, round) => event.bracket[round].map((p) => p.drivers.map((i) => (i === null ? null : event.drivers[i].seed)));

test("a field is 2 to 16, in a bracket of 2, 4, 8 or 16", () => {
  assert.throws(() => createDragEvent({ strip: {}, field: field(1) }));
  assert.throws(() => createDragEvent({ strip: {}, field: field(17) }));
  assert.deepEqual([2, 3, 4, 5, 8, 9, 16].map(bracketSize), [2, 4, 4, 8, 8, 16, 16]);
  const event = createDragEvent({ strip: {}, field: field(16) });
  assert.deepEqual([0, 1, 2, 3].map((r) => roundName(event, r)), ["Round of 16", "Round of 8", "Semi-final", "Final"]);
  assert.equal(roundName(createDragEvent({ strip: {}, field: field(2) }), 0), "Final");
});

test("the first round: the two best seeds can meet only in the final", () => {
  assert.deepEqual(firstRound(2), [[1, 2]]);
  assert.deepEqual(firstRound(4), [[1, 4], [2, 3]]);
  assert.deepEqual(firstRound(8), [[1, 8], [4, 5], [3, 6], [2, 7]], "CP4 2.0.52.4's standard draw");
  assert.deepEqual(firstRound(16), [[1, 16], [8, 9], [5, 12], [4, 13], [3, 14], [6, 11], [7, 10], [2, 15]]);
  const sixteen = firstRound(16);
  const half = (seed) => Math.floor(sixteen.findIndex((pair) => pair.includes(seed)) / 4);
  assert.notEqual(half(1), half(2));
  assert.ok(sixteen.every(([a, b]) => a + b === 17));
});

test("qualifying: the player's own time; a computer driver's from the baseline by pace, scatter and launch", () => {
  const event = qualified(4);
  assert.equal(event.baseline, 4);
  assert.equal(event.drivers[0].qualify, 3.5);
  // Steady: pace 1, no scatter at the middle, a launch of half its 0.12 s reaction.
  assert.equal(event.drivers[1].qualify, 4.06);
  assert.equal(event.drivers[0].seed, 1);
  assert.equal(event.drivers[0].lanePace[0], 3.5);
  assert.equal(event.phase, "bracket");
});

test("qualifying: a computed time beats the baseline by 3% at most, without a floor", () => {
  const event = createDragEvent({ strip: {}, field: field(2, "quick") });
  // The fastest a quick driver computes: no foul, the scatter all the way down, no launch delay.
  closeQualifying(event, [{ et: 5 }], 4, seq(0.99, 0, 0, 0.99));
  const fast = event.drivers[1].qualify;
  assert.ok(fast < 4 && fast >= 4 * 0.97, `${fast}`);
});

test("qualifying: no time seeds last, for a player who is out and for a computed false start", () => {
  const event = createDragEvent({ strip: {}, field: field(3) });
  // The first computer driver's launch roll is a foul (under 5% x 0.8); the second's is not.
  closeQualifying(event, [{ et: null, out: true }], 4, seq(0.01, 0.5, 0.5, 0.5, 0.5, 0.5));
  assert.equal(event.drivers[0].qualify, null);
  assert.equal(event.drivers[1].qualify, null);
  assert.equal(event.drivers[2].seed, 1);
  assert.deepEqual([event.drivers[0].seed, event.drivers[1].seed].sort(), [2, 3]);
});

test("byes: a seed the field does not reach sends its pair's driver straight through", () => {
  const event = qualified(5);
  assert.deepEqual(seeds(event, 0), [[1, null], [4, 5], [3, null], [2, null]], "the standard draw's order");
  assert.equal(event.bracket[0][0].how, "bye");
  assert.equal(event.bracket[1][0].drivers[0], 0, "seed 1 is in the semi-final already");
  assert.equal(currentPairing(event).pair, 1);
  assert.equal(event.round, 0);
});

test("the lanes: the better seed chooses; a computer driver takes the lane it has been quicker in", () => {
  const event = qualified(2);
  const mine = currentPairing(event);
  assert.equal(mine.chooser, 0);
  assert.equal(mine.lanes, null, "a player with the choice is asked");
  chooseLane(event, 1);
  assert.deepEqual(currentPairing(event).lanes, [1, 0]);
  // The player seeds last: the computer driver chooses, by a coin while it has run in neither lane.
  const other = qualified(2, 9, seq(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9));
  const pairing = currentPairing(other);
  assert.equal(other.drivers[pairing.drivers[pairing.chooser]].player, false);
  assert.ok(pairing.lanes);
  assert.equal(pairing.lanes[0] + pairing.lanes[1], 1);
});

test("a pass: the lower time at hundredths wins and moves up; the loser is out in that round", () => {
  const event = qualified(4);
  chooseLane(event, 0);
  const { drivers } = currentPairing(event);
  assert.equal(recordPass(event, [clean(3.514), clean(3.6)], MID), "settled");
  assert.deepEqual(event.bracket[0][0].times, [3.51, 3.6]);
  assert.equal(event.bracket[1][0].drivers[0], drivers[0]);
  assert.equal(event.drivers[drivers[1]].out, 0);
  assert.equal(event.drivers[drivers[1]].beatenBy, drivers[0]);
  assert.equal(event.drivers[drivers[0]].lanePace[0], 3.5, "the quicker qualifying pass in that lane stands");
});

test("one truck disqualified: the other wins, finished or not", () => {
  const event = qualified(2);
  chooseLane(event, 0);
  assert.equal(recordPass(event, [{ et: null, code: 96 }, { et: null, code: 99 }], MID), "double dq");
  chooseLane(event, 0);
  assert.equal(recordPass(event, [{ et: null, code: null }, { et: null, code: 99 }], MID), "settled");
  assert.equal(event.winner, 0);
  assert.equal(event.phase, "done");
});

test("a dead heat, two disqualifications or a spoilt pass run the whole pairing again, the times kept on show", () => {
  const event = qualified(2);
  chooseLane(event, 0);
  assert.equal(recordPass(event, [clean(3.501), clean(3.499)], MID), "dead heat");
  assert.deepEqual(event.last.times, [3.5, 3.5]);
  assert.equal(currentPairing(event).lanes, null, "the lane is chosen again");
  chooseLane(event, 1);
  // A disqualified truck hit the clean one: both run again, the disqualified one too.
  assert.equal(recordPass(event, [{ et: null, code: 95 }, { et: null, code: 99 }], MID), "rerun");
  assert.ok(!event.bracket[0][0].over);
  chooseLane(event, 1);
  assert.equal(recordPass(event, [null, clean(4)], MID), "settled");
  assert.equal(event.winner, 1, "a truck missing from the strip is out");
});

test("the launch layer: about 5% of launches are false starts at risk 1, a choker's grow in the semi-final and final", () => {
  const event = createDragEvent({ strip: {}, field: field(8, "choker") });
  const rate = (round) => {
    const random = seeded(7);
    let fouls = 0;
    for (let k = 0; k < 20000; k++) if (launchOffset(event, event.drivers[1], round, random) < 0) fouls++;
    return fouls / 20000;
  };
  const base = 0.05 * PERSONALITIES.choker.risk;
  assert.ok(Math.abs(rate(0) - base) < 0.01);
  assert.ok(Math.abs(rate(1) - base * 2.5) < 0.015);
  assert.ok(Math.abs(rate(2) - base * 3.5) < 0.015);
  assert.ok(rate(2) > 0.12 && rate(2) < 0.2, "about one final in six");
  for (const p of Object.values(PERSONALITIES)) assert.ok(0.05 * p.risk >= 0.04 - 1e-9 && 0.05 * p.risk <= 0.07 + 1e-9);
  assert.ok(stageDepth({ personality: "wild" }) > stageDepth({ personality: "steady" }));
  assert.ok(stageDepth({ personality: "wild" }) <= 0.85);
  assert.equal(stageDepth({ personality: null }), undefined);
});

test("simulate: only two computer drivers, from their own qualifying times and the pairing's launches; a false start loses", () => {
  const event = qualified(4, 9);
  // The player seeds last and meets seed 1 in pair 0.
  assert.ok(!canSimulate(event));
  assert.throws(() => simulatePairing(event));
  assert.equal(winOdds(event), null);
  recordPass(event, [clean(4), clean(3)], MID, "driven");
  assert.ok(canSimulate(event));
  const odds = winOdds(event, seeded(3));
  assert.ok(odds > 0.2 && odds < 0.8, `${odds}`);
  const pairing = currentPairing(event);
  pairing.entry.launch = [-0.4, 0.05];
  assert.equal(simulatePairing(event, MID), "settled");
  assert.equal(event.last.how, "simulated");
  assert.equal(event.last.dq[0], true);
  assert.equal(event.last.winner, 1);
});

test("run all others: every pairing of computer drivers in the round, and none with a player", () => {
  const event = qualified(8, 3.5, seeded(11));
  simulateOthers(event, seeded(5));
  assert.equal(event.round, 0);
  assert.deepEqual(event.bracket[0].map((entry) => entry.over), [false, true, true, true]);
  assert.ok(currentPairing(event).hasPlayer);
});

test("the final order: the winner, then by the round each went out in, then by best time", () => {
  const event = qualified(4, 3.5, seeded(2));
  chooseLane(event, 0);
  recordPass(event, [clean(3.5), clean(3.9)], seeded(4));
  simulateOthers(event, seeded(6));
  assert.equal(event.round, 1);
  const finalists = [...currentPairing(event).drivers];
  if (!currentPairing(event).lanes) chooseLane(event, 0);
  recordPass(event, finalists.map((i) => clean(i === 0 ? 3.4 : 3.8)), seeded(8));
  assert.equal(event.phase, "done");
  assert.equal(event.winner, 0);
  const order = finalOrder(event);
  assert.equal(order[0], 0);
  assert.equal(order[1], finalists.find((i) => i !== 0));
  const [third, fourth] = [order[2], order[3]].map((i) => event.drivers[i]);
  assert.ok(third.out === 0 && fourth.out === 0 && (third.best ?? Infinity) <= (fourth.best ?? Infinity));
});

test("the state is plain data: it survives a round trip through JSON", () => {
  const event = qualified(8, 9, seeded(3));
  const copy = JSON.parse(JSON.stringify(event));
  assert.deepEqual(copy, event);
  simulateOthers(copy, seeded(9));
  assert.ok(copy.bracket[0].filter((entry) => entry.over).length >= 3);
});
