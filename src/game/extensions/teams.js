/*
  Teams for the extension modes (docs/EXTENSIONS.md): Hockey, Soccer and Race & Rumble. A team is a
  number from 0; its name and colour come from these tables. Pure, so it runs under Node.
*/
import { msg } from "../strings.js";

export const TEAM_NAMES = Object.freeze([msg("Red"), msg("Blue"), msg("Green"), msg("Yellow")]);
/** The teams' colours, for the labels over the trucks, the map and the goal frames. */
export const TEAM_COLOURS = Object.freeze(["#ff4436", "#3f8cff", "#3fd16a", "#ffd23f"]);

/**
 * Two teams of `count` trucks, the player's (truck 0) first: team 0 or 1 by `random`, then the others
 * alternate, the other team first, so the sizes differ by at most one.
 */
export function twoTeams(count, random = Math.random) {
  const mine = random() < 0.5 ? 0 : 1;
  return Array.from({ length: count }, (_, i) => (mine + i) % 2);
}

/**
 * Teams of `size` trucks in entry order: trucks 0 to size-1 are team 0, and so on, at most `max` teams (the
 * trucks past them join the last team). Returns `{ teams, slots }`, `slots[i]` the truck's place in its team.
 */
export function teamsOf(count, size = 2, max = TEAM_NAMES.length) {
  const teams = [], slots = [];
  for (let i = 0; i < count; i++) {
    const team = Math.min(max - 1, Math.floor(i / size));
    teams.push(team);
    slots.push(teams.filter((t) => t === team).length - 1);
  }
  return { teams, slots };
}
