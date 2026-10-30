/*
  The drag weekend in progress (`context.dragWeekend`): the event (game/events/drag-event.js) with what its passes are
  run with, the strip, the trucks, the difficulty and the weather. It hosts the event: it picks the field, sets up each
  pass for the race screen and hands the pass's results back to the event. It lives for the session only.
*/
import { cpuNames } from "../game/race-setup.js";
import { PERSONALITIES, closeQualifying, createDragEvent, currentPairing, recordPass, stageDepth } from "../game/events/drag-event.js";
import { currentDriver, getProfiles } from "./profile-store.js";

/** The lanes. */
export const LEFT = 0, RIGHT = 1;

/**
 * Start a weekend on `track` with `size` drivers (2 to 16): the player in their truck, and computer drivers in trucks
 * drawn from `trucks` (the catalogue's, not hidden), each with a personality drawn for the weekend.
 */
export function startDragWeekend(context, { track, trucks, playerTruck, playerName, size, difficulty, weather, aiSpeed = null, random = Math.random, field: given = null }) {
  const others = trucks.filter((t) => t.file !== playerTruck);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const kinds = Object.keys(PERSONALITIES);
  // A tournament brings its own drivers (app/tournament.js): they keep their trucks and are given a personality each.
  const field = given ? given.map((d) => (d.player ? { ...d } : { ...d, personality: kinds[Math.floor(random() * kinds.length)] })) : [{ name: playerName, truck: playerTruck, player: true }];
  const names = cpuNames(context.settings?.aiNames);
  for (let i = 0; !given && i < size - 1; i++) {
    field.push({
      // Past the game's eight names a second round of them is numbered.
      name: `${names[i % names.length]}${i >= names.length ? " II" : ""}`, truck: (others[i % Math.max(1, others.length)] ?? trucks[0]).file,
      player: false, personality: kinds[Math.floor(random() * kinds.length)],
    });
  }
  context.dragWeekend = { event: createDragEvent({ strip: { file: track.file, name: track.name }, field }), track, trucks, difficulty, weather, aiSpeed, seen: null };
  return context.dragWeekend;
}

/**
 * Who takes the strip for the weekend's next pass, the truck the camera rides first:
 * `[{ name, file, player, slot, driver, launch, stageDepth }]` (`slot` the lane, `driver` the event's driver or null).
 * Qualifying is the player alone in `lane`, with the measurement truck beside them: a plain computer truck that leaves
 * on the green, whose time is the weekend's baseline. A pairing runs in the lanes the event holds, its computer
 * drivers with the launches it rolled.
 */
export function passEntrants(weekend, lane = LEFT) {
  const { event } = weekend;
  const entrant = (driver, slot, launch) => {
    const d = event.drivers[driver];
    return { name: d.name, file: d.truck, player: d.player, slot, driver, launch: d.player ? undefined : launch, stageDepth: stageDepth(d) };
  };
  if (event.phase === "qualifying") {
    return [entrant(0, lane), { name: "Pace", file: event.drivers[1].truck, player: false, slot: 1 - lane, driver: null, launch: 0 }];
  }
  const pairing = currentPairing(event);
  const entrants = pairing.drivers.map((driver, slot) => entrant(driver, pairing.lanes[slot], pairing.launch[slot]));
  return entrants.sort((a, b) => Number(b.player) - Number(a.player));
}

/** Run the weekend's next pass on the race screen. `lane` is the player's in qualifying. */
export async function runPass(context, lane = LEFT) {
  const weekend = context.dragWeekend;
  const entrants = passEntrants(weekend, lane);
  const driver = currentDriver(await getProfiles(context));
  return context.router.go("race", {
    track: weekend.track, mode: "drag", laps: 1, difficulty: weekend.difficulty, opponents: [], weather: weekend.weather, aiSpeed: weekend.aiSpeed ?? null,
    truck: entrants[0].file, trucks: weekend.trucks, setup: entrants[0].player ? { ...driver.garage } : undefined,
    drag: { kind: weekend.event.phase === "qualifying" ? "qualify" : "pairing", entrants },
  }, { replace: true });
}

/**
 * Take a pass's results from the race screen (`{ kind, results: [{ driver, lane, et, code }] }`), once. Returns the
 * pairing's outcome (game/events/drag-event.js `recordPass`), "qualified", or null when there was nothing to take.
 */
export function takePass(weekend, pass, random = Math.random) {
  if (!pass || weekend.seen === pass) return null;
  weekend.seen = pass;
  const { event } = weekend;
  const of = (driver) => pass.results.find((r) => r.driver === driver);
  if (pass.kind === "qualify" && event.phase === "qualifying") {
    const mine = of(0);
    closeQualifying(event, [{ et: mine?.et ?? null, out: !mine || mine.code !== null, lane: mine?.lane }], of(null)?.et ?? null, random);
    return "qualified";
  }
  const pairing = pass.kind === "pairing" ? currentPairing(event) : null;
  if (!pairing) return null;
  return recordPass(event, pairing.drivers.map((driver) => of(driver) ?? null), random, pairing.hasPlayer ? "driven" : "watched");
}
