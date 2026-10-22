/*
  A drag weekend: Community Patch 3's drag event around the pass (MONSTER_EXE_ANALYSIS.md 6.4,
  "The drag weekend"). Qualifying seeds a field of 2 to 16, a bracket with byes pairs them, and
  each pairing is driven, watched or simulated until one driver is left.

  State and bracket maths only: it runs no races and picks neither its field nor its strip. A
  host (app/drag-weekend.js now, a tournament later) gives it both, runs each pass it asks for
  (game/drag-race.js) and hands back the pass's results. The state is plain data, so a host can
  store it. Pure, so it runs under Node.

  The rules are CP3's as its author described them in writing; he provided no source code. The
  numbers that description gives are used as given (the 4% scatter, one scrappy run in 25 of 10
  to 22%, the 3% cap, the 5% foul rate and its 4 to 7% range, the choker's 2.5 and 3.5). The
  personalities' own values, the reaction times and the shape of the cap are the port's.
*/
import { createStrings, msg } from "../strings.js";

/** The field an event takes. */
export const MIN_FIELD = 2;
export const MAX_FIELD = 16;
/** An elapsed time that can be a real pass, seconds. */
const PLAUSIBLE_ET = Object.freeze([1, 30]);
/** The pass's codes that count here (game/drag-race.js `OUT`): 95 is the re-run flag, 96 and up a disqualification. */
const RERUN = 95;

/** A computed time's scatter, the share of runs that are scrappy and what they cost, and how far under the baseline a computed time can go. */
const SCATTER = 0.04;
const SCRAPPY_RATE = 1 / 25;
const SCRAPPY_COST = Object.freeze([0.10, 0.22]);
const BASELINE_CAP = 0.03;
/** The share of launches that are false starts at risk 1. */
const FOUL_RATE = 0.05;
/** A false start's lead on the green, seconds (the port's: the tree runs half a second). */
const FOUL_LEAD_S = Object.freeze([0.3, 0.5]);

/**
 * The computer drivers' personalities (the port's values). `pace`: how quick, as a share of the
 * baseline's speed. `spread`: how much of the scatter the driver has. `risk`: the foul rate's
 * multiplier, 0.8 (4%) to 1.4 (7%), which also sets how deep the driver stages. `reaction`: the
 * slowest launch, seconds after the green. `choker`: the risk is multiplied in the semi-final and
 * the final.
 */
export const PERSONALITIES = Object.freeze({
  steady: { pace: 1.0, spread: 0.5, risk: 0.8, reaction: 0.12 },
  quick: { pace: 1.02, spread: 1, risk: 1.1, reaction: 0.1 },
  hesitant: { pace: 0.99, spread: 0.8, risk: 0.8, reaction: 0.22 },
  wild: { pace: 1.01, spread: 1.2, risk: 1.4, reaction: 0.08 },
  choker: { pace: 1.01, spread: 0.6, risk: 0.9, reaction: 0.1, choker: true },
});
const CHOKER_RISK = Object.freeze({ semi: 2.5, final: 3.5 });

/** Times are compared at hundredths, rounded. */
export const hundredths = (seconds) => Math.round(seconds * 100) / 100;
const plausible = (et) => et !== null && et !== undefined && et >= PLAUSIBLE_ET[0] && et <= PLAUSIBLE_ET[1];
const between = ([low, high], random) => low + (high - low) * random();

/** The bracket for a field: the field rounded up to 2, 4, 8 or 16. */
export function bracketSize(field) {
  let size = 2;
  while (size < field) size *= 2;
  return size;
}

/**
 * The first round by seed, top to bottom, for a bracket of `size`: `[[1, 8], [4, 5], [2, 7], [3, 6]]`.
 * The two best can meet only in the final, the four best only from the semi-finals. (CP3 lays
 * out 1 v N, 2 v N - 1 in order, which its author names as a bug; this is the order he gives
 * as the fix.)
 */
export function firstRound(size) {
  let order = [1, 2];
  while (order.length < size) order = order.flatMap((seed) => [seed, order.length * 2 + 1 - seed]);
  return Array.from({ length: size / 2 }, (_, p) => [order[p * 2], order[p * 2 + 1]]);
}

const pairEntry = () => ({ drivers: [null, null], times: [null, null], dq: [false, false], rerun: false, winner: null, over: false, how: null, lanes: null, launch: null });

/**
 * A new event, waiting for qualifying. `field`: `[{ name, truck, player, personality }]`, 2 to 16
 * drivers; a computer driver without a personality is steady.
 */
export function createDragEvent({ strip, field }) {
  if (field.length < MIN_FIELD || field.length > MAX_FIELD) throw new Error(`A drag weekend takes ${MIN_FIELD} to ${MAX_FIELD} drivers, not ${field.length}.`);
  const size = bracketSize(field.length);
  const rounds = Math.log2(size);
  return {
    phase: "qualifying", strip, baseline: null, size, round: 0, winner: null,
    drivers: field.map((d) => ({
      name: d.name, truck: d.truck, player: !!d.player, personality: d.player ? null : d.personality in PERSONALITIES ? d.personality : "steady",
      form: 1, qualify: null, seed: null, best: null, lanePace: [null, null], out: null, beatenBy: null,
    })),
    bracket: Array.from({ length: rounds }, (_, r) => Array.from({ length: size >> (r + 1) }, pairEntry)),
    /** What the last pass, simulation or bye came to, for the host to show. */
    last: null,
  };
}

/** A round's name: the Final, the Semi-final, then the Round of 8 and of 16; `t` translates it (game/strings.js). */
export function roundName(event, round, t = createStrings()) {
  const left = event.bracket.length - round;
  return left === 1 ? t(msg("Final")) : left === 2 ? t(msg("Semi-final")) : t(msg("Round of <<1>>"), 2 ** left);
}

/** A driver's risk in a round: a choker's grows in the semi-final and the final. */
function riskOf(event, driver, round) {
  const p = PERSONALITIES[driver.personality];
  const left = event.bracket.length - round;
  return p.risk * (p.choker ? (left === 1 ? CHOKER_RISK.final : left === 2 ? CHOKER_RISK.semi : 1) : 1);
}

/**
 * The launch layer: a computer driver's reaction offset for one launch, seconds. Positive is a
 * slow start, added to the elapsed time since that runs from the green. Negative is a false
 * start: driven, the truck leaves that long before the green and the start beam gives the red
 * light; simulated, it loses the pass. `round` is null in qualifying.
 */
export function launchOffset(event, driver, round, random = Math.random) {
  const p = PERSONALITIES[driver.personality];
  const risk = round === null ? p.risk : riskOf(event, driver, round);
  if (random() < FOUL_RATE * risk) return -between(FOUL_LEAD_S, random);
  return p.reaction * random();
}

/**
 * How deep a computer driver stages, as a share of the gap between the stage and start beams:
 * the nervier, the deeper, up to 85%.
 */
export function stageDepth(driver) {
  const p = PERSONALITIES[driver.personality];
  return p ? Math.min(0.85, 0.2 + (p.risk - 0.8) * 0.75) : undefined;
}

/** The soft cap: a computed time beats the baseline by 3% at most, on a curve that flattens out, not a floor (a floor would make dead heats). */
function capped(time, baseline) {
  const gain = (baseline - time) / baseline;
  return gain <= 0 ? time : baseline * (1 - BASELINE_CAP * (1 - Math.exp(-gain / BASELINE_CAP)));
}

/**
 * A computed pass for a computer driver, from `base` seconds: scattered by 4% (less for a steady
 * driver), now and then scrappy, the launch added, capped against the baseline. Returns the
 * time, or null for a false start.
 */
function computedTime(event, driver, base, launch, random) {
  if (launch < 0) return null;
  const p = PERSONALITIES[driver.personality];
  let time = base * (1 + SCATTER * p.spread * (random() * 2 - 1));
  if (random() < SCRAPPY_RATE * p.risk) time *= 1 + between(SCRAPPY_COST, random);
  return hundredths(capped(time + launch, event.baseline));
}

/**
 * Close qualifying. `passes[i]` is what player i made of their pass alone, `{ et, out, lane }`.
 * `baseline` is the measurement truck's elapsed time: a plain computer truck that ran beside the
 * player, the yardstick every computed time comes from (without one, the fastest player's time
 * stands in). Each computer driver's time is computed from it by their pace; a computed false
 * start is no time. Fastest first is the seeding; no time seeds last.
 */
export function closeQualifying(event, passes, baseline, random = Math.random) {
  if (event.phase !== "qualifying") throw new Error("Qualifying is over.");
  const { drivers } = event;
  drivers.forEach((d, i) => {
    if (!d.player) return;
    const pass = passes[i];
    d.qualify = pass && !pass.out && plausible(pass.et) ? hundredths(pass.et) : null;
    noteTime(d, d.qualify, pass?.lane);
  });
  const played = drivers.filter((d) => d.player && d.qualify !== null).map((d) => d.qualify);
  event.baseline = plausible(baseline) ? baseline : played.length ? Math.min(...played) : 10;
  for (const d of drivers) {
    if (d.player) continue;
    d.qualify = computedTime(event, d, event.baseline / PERSONALITIES[d.personality].pace, launchOffset(event, d, null, random), random);
    if (d.qualify !== null) d.best = d.qualify;
  }
  const order = drivers.map((_, i) => i).sort((a, b) => (drivers[a].qualify ?? Infinity) - (drivers[b].qualify ?? Infinity) || a - b);
  order.forEach((i, k) => { drivers[i].seed = k + 1; });
  // A seed the field does not reach is a bye: the driver it would have met goes through at once.
  firstRound(event.size).forEach(([a, b], p) => { event.bracket[0][p].drivers = [order[a - 1] ?? null, order[b - 1] ?? null]; });
  event.phase = "bracket";
  event.round = 0;
  event.bracket[0].forEach((entry, p) => {
    if (entry.drivers[0] !== null && entry.drivers[1] !== null) return;
    Object.assign(entry, { winner: entry.drivers[0] !== null ? 0 : 1, over: true, how: "bye" });
    advance(event, 0, p);
  });
  nextRound(event, random);
}

/** Keep a driver's time: their best pass, and their best in that lane. */
function noteTime(driver, time, lane) {
  if (time === null || time === undefined) return;
  if (driver.best === null || time < driver.best) driver.best = time;
  if ((lane === 0 || lane === 1) && (driver.lanePace[lane] === null || time < driver.lanePace[lane])) driver.lanePace[lane] = time;
}

/** Put a settled pair's winner into the next round: pair p's goes to pair p / 2, as its first driver when p is even. */
function advance(event, round, pair) {
  const entry = event.bracket[round][pair];
  const winner = entry.drivers[entry.winner], loser = entry.drivers[1 - entry.winner];
  if (loser !== null) Object.assign(event.drivers[loser], { out: round, beatenBy: winner });
  if (round + 1 < event.bracket.length) event.bracket[round + 1][pair >> 1].drivers[pair & 1] = winner;
  else { event.winner = winner; event.phase = "done"; }
}

/** Move on when the round is settled: everyone still in gets a new form, and the pairings their launches and lanes. */
function nextRound(event, random) {
  if (event.phase !== "bracket") return;
  if (event.bracket[event.round].every((entry) => entry.over)) {
    event.round++;
    for (const entry of event.bracket[event.round]) {
      for (const i of entry.drivers) if (i !== null && !event.drivers[i].player) event.drivers[i].form = 1 + (random() * 2 - 1) * 0.01;
    }
  }
  for (const entry of event.bracket[event.round]) if (!entry.over) arm(event, entry, event.round, random);
}

/** The better seed of a pairing, as a slot. */
const chooserOf = (event, entry) => (event.drivers[entry.drivers[0]].seed <= event.drivers[entry.drivers[1]].seed ? 0 : 1);

/**
 * Roll what a pairing is run with, once, so that watching it and simulating it are the same
 * pass: each computer driver's launch, and the lanes when a computer driver has the choice (the
 * lane it has been quicker in this weekend, else a coin).
 */
function arm(event, entry, round, random) {
  const drivers = entry.drivers.map((i) => event.drivers[i]);
  if (!entry.launch) entry.launch = drivers.map((d) => (d.player ? null : launchOffset(event, d, round, random)));
  if (entry.lanes) return;
  const slot = chooserOf(event, entry), chooser = drivers[slot];
  if (chooser.player) return;
  const [left, right] = chooser.lanePace;
  const lane = left !== null && right !== null && left !== right ? (left < right ? 0 : 1) : random() < 0.5 ? 0 : 1;
  entry.lanes = slot === 0 ? [lane, 1 - lane] : [1 - lane, lane];
}

/**
 * The pairing to run next, or null: the round's first one not settled. `drivers` are its two
 * (indexes), `hasPlayer` whether a player is in it, `chooser` the slot of the better seed, who
 * picks the lane, `lanes` each slot's lane (null until a player who has the choice makes it,
 * `chooseLane`), `launch` each computer driver's launch offset.
 */
export function currentPairing(event) {
  if (event.phase !== "bracket") return null;
  const pair = event.bracket[event.round].findIndex((entry) => !entry.over);
  const entry = event.bracket[event.round][pair];
  return {
    round: event.round, pair, entry, drivers: entry.drivers, hasPlayer: entry.drivers.some((i) => event.drivers[i].player),
    chooser: chooserOf(event, entry), lanes: entry.lanes, launch: entry.launch,
  };
}

/** The better seed's lane, when a player has the choice: the other driver takes what is left. */
export function chooseLane(event, lane) {
  const pairing = currentPairing(event);
  pairing.entry.lanes = pairing.chooser === 0 ? [lane, 1 - lane] : [1 - lane, lane];
}

/**
 * A pass was run. `results[slot]` is what each driver made of it: `{ et, code }` (`code` the
 * pass's code from 95 up, or null), or null for a truck that was not on the strip. `how` is
 * "driven" or "watched". Returns the outcome: "settled", or "dead heat", "double dq", "rerun" or
 * "no result", after which the whole pairing is run again (its times stay on show).
 */
export function recordPass(event, results, random = Math.random, how = "driven") {
  const { entry, round, pair } = currentPairing(event);
  const read = results.map((r) => ({
    et: r && !r.code && plausible(r.et) ? hundredths(r.et) : null, dq: !r || (r.code ?? 0) > RERUN, rerun: r?.code === RERUN,
  }));
  read.forEach((r, slot) => noteTime(event.drivers[entry.drivers[slot]], r.et, entry.lanes?.[slot]));
  return settle(event, round, pair, read, how, random);
}

/**
 * Settle a pairing of two computer drivers without running it: each driver's own qualifying time
 * is the base, then their form, the scatter, the launch the pairing was armed with (a false
 * start loses) and the cap.
 */
export function simulatePairing(event, random = Math.random, pair = currentPairing(event)?.pair) {
  const round = event.round, entry = event.bracket[round]?.[pair];
  if (!entry || entry.over || entry.drivers.some((i) => i === null || event.drivers[i].player)) throw new Error("Only a pairing of two computer drivers can be simulated.");
  const read = entry.drivers.map((i, slot) => {
    const d = event.drivers[i];
    const et = computedTime(event, d, (d.qualify ?? event.baseline * 1.08) / d.form, entry.launch[slot], random);
    return { et, dq: et === null, rerun: false };
  });
  return settle(event, round, pair, read, "simulated", random);
}

/** Run All Others: simulate every pairing of two computer drivers left in the round. A pairing that must go again is simulated again. */
export function simulateOthers(event, random = Math.random) {
  if (event.phase !== "bracket") return;
  const round = event.round;
  event.bracket[round].forEach((entry, pair) => {
    if (entry.over || entry.drivers.some((i) => event.drivers[i].player)) return;
    for (let tries = 0; tries < 50 && !entry.over && event.round === round; tries++) simulatePairing(event, random, pair);
  });
}

/** Whether the round has a pairing of two computer drivers left to simulate. */
export function canSimulate(event) {
  const pairing = currentPairing(event);
  return !!pairing && !pairing.hasPlayer;
}

function settle(event, round, pair, read, how, random) {
  const entry = event.bracket[round][pair];
  entry.times = read.map((r) => r.et);
  entry.dq = read.map((r) => r.dq);
  entry.rerun = read.some((r) => r.rerun);
  entry.how = how;
  let winner = null, outcome = "settled";
  // A truck hit by a disqualified one counts as a double disqualification: the whole pairing goes again.
  if (entry.rerun) outcome = "rerun";
  else if (read[0].dq && read[1].dq) outcome = "double dq";
  // One disqualified: the other wins, finished or not.
  else if (read[0].dq !== read[1].dq) winner = read[0].dq ? 1 : 0;
  else if (read[0].et === null && read[1].et === null) outcome = "no result";
  // One never finished: the other wins with a real time.
  else if (read[0].et === null || read[1].et === null) winner = read[0].et === null ? 1 : 0;
  else if (read[0].et === read[1].et) outcome = "dead heat";
  else winner = read[0].et < read[1].et ? 0 : 1;
  event.last = { round, pair, outcome, how, drivers: [...entry.drivers], times: [...entry.times], dq: [...entry.dq], winner };
  if (winner === null) {
    // Run again with new launches; the lanes a computer driver chose are chosen again, a player is asked again.
    entry.launch = null;
    entry.lanes = null;
    arm(event, entry, round, random);
    return outcome;
  }
  entry.winner = winner;
  entry.over = true;
  advance(event, round, pair);
  nextRound(event, random);
  return outcome;
}

/**
 * The chance that the current pairing's first driver wins, from the numbers a simulation uses
 * (display only), or null when a player is in it: a player has no computed time.
 */
export function winOdds(event, random = Math.random, samples = 400) {
  const pairing = currentPairing(event);
  if (!pairing || pairing.hasPlayer) return null;
  const drivers = pairing.drivers.map((i) => event.drivers[i]);
  let wins = 0, counted = 0;
  for (let k = 0; k < samples; k++) {
    const [a, b] = drivers.map((d) => computedTime(event, d, (d.qualify ?? event.baseline * 1.08) / d.form, launchOffset(event, d, pairing.round, random), random));
    if ((a === null && b === null) || a === b) continue;
    counted++;
    if (b === null || (a !== null && a < b)) wins++;
  }
  return counted ? wins / counted : 0.5;
}

/**
 * The final order (driver indexes): the winner, then by the round each driver went out in, the
 * later the better, and within a round by best elapsed time.
 */
export function finalOrder(event) {
  const { drivers } = event;
  const rank = (i) => (i === event.winner ? Infinity : drivers[i].out ?? (event.phase === "done" ? -1 : event.round));
  return drivers.map((_, i) => i).sort((a, b) => rank(b) - rank(a) || (drivers[a].best ?? Infinity) - (drivers[b].best ?? Infinity) || (drivers[a].seed ?? 99) - (drivers[b].seed ?? 99) || a - b);
}
