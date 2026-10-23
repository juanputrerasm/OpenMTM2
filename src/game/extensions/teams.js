/*
  Teams for the extension modes (docs/EXTENSIONS.md): Hockey, Soccer and Race & Rumble. A team is a
  number from 0; its name and colour come from these tables. Pure, so it runs under Node.
*/
import { msg } from "../strings.js";

export const TEAM_NAMES = Object.freeze([msg("Red"), msg("Blue"), msg("Green"), msg("Yellow")]);
/** The teams' colours, for the labels over the trucks, the map and the goal frames. */
export const TEAM_COLOURS = Object.freeze(["#ff4436", "#3f8cff", "#3fd16a", "#ffd23f"]);

/**
 * What the Computer Opponents dialog asks of each truck in a team mode (an extension's `teamPicker(settings)`):
 * `teams` the number of team colours to choose from (0: none), with their `teamNames` and `teamColours`; `roles` the
 * role names to choose from (null: none), and `roleColours` the colour of each role when the role is the side.
 */
export const TWO_TEAM_PICKER = Object.freeze({ teams: 2, teamNames: TEAM_NAMES, teamColours: TEAM_COLOURS, roles: null });

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

/**
 * Teams from the Computer Opponents dialog: `picks[i]` the team truck i was given there (a number below `teamCount`),
 * or null. A truck with no pick joins the smallest team so far (the lowest of those tied), so the sizes stay even;
 * without any pick at all it is `twoTeams`' random split for two teams.
 */
export function pickedTeams(count, picks = [], teamCount = 2, random = Math.random) {
  const given = (i) => {
    const team = picks?.[i];
    return Number.isInteger(team) && team >= 0 && team < teamCount ? team : null;
  };
  if (teamCount === 2 && !Array.from({ length: count }, (_, i) => given(i)).some((team) => team !== null)) return twoTeams(count, random);
  const teams = Array.from({ length: count }, (_, i) => given(i));
  const sizes = new Array(teamCount).fill(0);
  teams.forEach((team) => { if (team !== null) sizes[team]++; });
  for (let i = 0; i < count; i++) {
    if (teams[i] !== null) continue;
    const team = sizes.indexOf(Math.min(...sizes));
    teams[i] = team;
    sizes[team]++;
  }
  return teams;
}
