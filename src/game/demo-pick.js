/*
  Monster Demo's race (ui/screens/race.js, `demo`): a Circuit or a Rally picked at random from the tracks the install
  has (hidden ones left out), in the default mode, with as many computer trucks as Options, Game, Computer opponents
  says. The player's own list from the Races screen is taken when there is one; else that many trucks picked at random
  from the Monster Truck Madness trucks other than the player's. The player's truck drives itself with them. Pure, so
  it runs under Node.
*/

/** The track types a demo races on. */
export const DEMO_RACE_TYPES = Object.freeze(["circuit", "rally"]);

/** Up to `count` of `list`, picked at random without repeats. */
function sample(list, count, random) {
  const pool = [...list], out = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
}

/**
 * The demo's race: `{ track, truck, opponents }` (files for the trucks), or null when the install has no track or
 * truck for one. `tracks` and `trucks` are the catalog's; `settings` the player's (`defaultOpponents`,
 * `opponentTrucks`); `playerTruck` the driver's last truck; `avoid` a track file not to pick again when there is
 * another (the demo just shown).
 */
export function pickDemoRace({ tracks, trucks, settings = {}, playerTruck = null, avoid = null, random = Math.random }) {
  const races = tracks.filter((t) => DEMO_RACE_TYPES.includes(t.raceType) && !t.hidden && !t.freeRoamOnly);
  const fresh = races.length > 1 ? races.filter((t) => t.file !== avoid) : races;
  const shown = trucks.filter((t) => !t.hidden);
  const player = shown.find((t) => t.file === playerTruck) ?? shown[0];
  if (!fresh.length || !player) return null;
  const track = fresh[Math.floor(random() * fresh.length)];
  const count = Math.max(0, Math.min(7, Number.isInteger(settings.defaultOpponents) ? settings.defaultOpponents : 3));
  const known = new Set(shown.map((t) => t.file));
  const chosen = Array.isArray(settings.opponentTrucks)
    ? settings.opponentTrucks.filter((file, i, all) => known.has(file) && file !== player.file && all.indexOf(file) === i).slice(0, 7)
    : null;
  const opponents = chosen ?? sample(shown.filter((t) => t.file !== player.file && (!t.game || t.game === "MTM")).map((t) => t.file), count, random);
  return { track, truck: player.file, opponents };
}
