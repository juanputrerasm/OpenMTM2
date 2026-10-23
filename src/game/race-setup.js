/*
  Who races and where they start (MONSTER_EXE_ANALYSIS.md section 9, "Who races" and "The
  grid"). Pure, so it runs under Node.

  The game flags `defaultOpponents` random catalogue trucks for the CPU, makes the player
  driver 0, adds a CPU driver for each flagged truck other than the player's (in catalogue
  order), and shuffles the first start slots among the drivers.
*/
import { msg } from "./strings.js";

/** The default CPU driver names (0x551f90). */
export const CPU_NAMES = Object.freeze(["Mark", "Greg", "Rich", "Brett", "Gaither", "Chuck", "Terry", "Joe"]);
/** The longest name Options lets a computer driver have. */
export const CPU_NAME_MAX = 16;
/**
 * The computer drivers' names with the player's own (Options, Advanced): `custom[i]`, trimmed, where it is a name, else
 * the game's.
 */
export function cpuNames(custom) {
  return CPU_NAMES.map((name, i) => {
    const own = typeof custom?.[i] === "string" ? custom[i].trim().slice(0, CPU_NAME_MAX) : "";
    return own || name;
  });
}
/** The built-in `defaultOpponents` (MONSTER.INI). */
export const DEFAULT_OPPONENTS = 3;

/**
 * The race's entrants, the player first: `[{ name, file, player, slot }]`, `slot` the start-grid
 * slot. `trucks` are catalogue trucks (`{ file, hidden }`), `slots` the grid's size; `names` the computer drivers'
 * (`cpuNames`). It is `raceDrivers` then `seatDrivers`.
 */
export function raceEntrants({ slots, random = Math.random, ...rest }) {
  return seatDrivers(raceDrivers({ ...rest, slots, random }), slots, random);
}

/**
 * Who races, the player first, `[{ name, file, player }]`, before they are given their places: what `raceEntrants`
 * draws. Drawn for a full grid (`slots` 8), the first of them are those a smaller grid would have, so the trucks to
 * build can be known before the track says how many slots it has (`seatDrivers` keeps as many as there are).
 */
export function raceDrivers({ playerTruck, trucks, slots = 8, opponents = DEFAULT_OPPONENTS, playerName = "You", random = Math.random, spectator = false, names = CPU_NAMES }) {
  const catalogue = trucks.filter((t) => !t.hidden);
  // Spectator mode (the port's): nobody drives. `playerTruck` is then the first of the computer's trucks, under the
  // last of the computer's names, which no other entrant can have.
  const drivers = [spectator ? { name: names[names.length - 1], file: playerTruck, player: false } : { name: playerName, file: playerTruck, player: true }];
  if (Array.isArray(opponents)) {
    const byFile = new Map(catalogue.map((t) => [t.file.toUpperCase(), t]));
    const selected = [...new Set(opponents.map((file) => String(file).toUpperCase()))];
    for (const file of selected) {
      const truck = byFile.get(file);
      if (truck && (spectator || truck.file !== playerTruck) && drivers.length < Math.min(8, slots)) {
        drivers.push({ name: names[drivers.length - 1], file: truck.file, player: false });
      }
    }
  } else {
    // The game's default path: up to 5 * opponents draws, each flagging a catalogue truck. Only MTM's own trucks are
    // drawn: another game's vehicle (a CPR car, an Evolution truck) races when the player picks it.
    const own = catalogue.filter((t) => !t.game || t.game === "MTM");
    if (own.length) catalogue.splice(0, catalogue.length, ...own);
    const flagged = new Set();
    for (let tries = opponents * 5; tries > 0 && flagged.size < opponents; tries--) {
      flagged.add(Math.min(catalogue.length - 1, Math.floor(random() * catalogue.length)));
    }
    catalogue.forEach((t, i) => {
      if (flagged.has(i) && t.file !== playerTruck && drivers.length < Math.min(8, slots)) {
        drivers.push({ name: names[drivers.length - 1], file: t.file, player: false });
      }
    });
  }
  return drivers;
}

/** `drivers` (`raceDrivers`) on a grid of `slots`: as many as it holds, the start slots shuffled among them. */
export function seatDrivers(drivers, slots, random = Math.random) {
  const seated = drivers.slice(0, Math.min(8, slots));
  const order = seated.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return seated.map((d, i) => ({ ...d, slot: order[i] }));
}

/** A race time as the HUD prints it, `%02d:%05.2f` (minutes, seconds). */
export function formatRaceTime(seconds) {
  const s = Math.max(0, seconds);
  const minutes = Math.trunc(s / 60);
  return `${String(minutes).padStart(2, "0")}:${(s - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/** "1st", "2nd", ... as the standings list prints places. */
export function ordinal(place) {
  return [msg("1st"), msg("2nd"), msg("3rd"), msg("4th"), msg("5th"), msg("6th"), msg("7th"), msg("8th")][place - 1] ?? `${place}th`;
}

/** A Summit Rumble's drivers for the overlay, best score first (ties in grid order): `[[name, score], ...]`. */
export function summitBoard(trucks, names) {
  return trucks.map((row, i) => ({ name: names[i] ?? `Driver ${i + 1}`, score: Math.round(row.score ?? 0), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i).map((row) => [row.name, String(row.score)]);
}

/**
 * The start of a Summit Rumble whose SIT puts every start slot well away from its scoring zone (an add-on such as
 * Scream3 Cemetery, whose slots stand on the high ground outside the ring of stands round its pit). The game puts the
 * trucks where the SIT says (0x4195d0 only shuffles the slots); the port, where all slots are farther than
 * `RUMBLE_FAR_FT` (and than the zone's own size) from the zone's centre, sets them instead in a ring inside the zone, a
 * little over its top, facing its centre, to come down onto its floor. `zone` is the zone's gate
 * (`{ position, size }`, game feet, as the simulation builds it); a grid it does not change is returned as it is.
 */
export const RUMBLE_FAR_FT = 400;
export function rumbleGrid(grid, zone) {
  if (!zone?.position || !zone.size || !grid.length) return grid;
  const [cx, cy, cz] = zone.position, [sx, sy, sz] = zone.size;
  const far = Math.max(RUMBLE_FAR_FT, sx, sz);
  if (!grid.every((slot) => Math.hypot(slot.pos[0] - cx, slot.pos[2] - cz) > far)) return grid;
  const radius = Math.min(sx, sz) * 0.3, top = cy + sy / 2 + 6;
  return grid.map((slot, i) => {
    const a = (i / grid.length) * Math.PI * 2;
    const x = cx + Math.sin(a) * radius, z = cz + Math.cos(a) * radius;
    return { ...slot, pos: [x, top, z], heading: Math.atan2(cx - x, cz - z), moved: true };
  });
}

/**
 * A port addition for the party modes (docs/EXTENSIONS.md): a track with fewer start slots than trucks (a free roam
 * level, whose SIT or script places one truck or none) gets more, set out behind and beside its first slot (or its
 * `start` when it has none) in pairs `PARTY_GRID_ACROSS_FT` apart, a row every `PARTY_GRID_BACK_FT`, all facing its way.
 * Each new slot rides as high over the ground (`heightAt(x, z)`, feet) as the first one does, and none comes within
 * `PARTY_GRID_CLEAR_FT` of a slot already there. A grid that holds `count` already is returned as it is.
 */
export const PARTY_GRID_ACROSS_FT = 30, PARTY_GRID_BACK_FT = 40, PARTY_GRID_CLEAR_FT = 20;
/** How high over the ground a filled slot is held when the first one gives no height to copy, feet (MTM2's grids). */
const PARTY_RIDE_FT = 6;
export function fillGrid(grid, count, heightAt = null, start = null) {
  const slots = grid ?? [];
  if (slots.length >= count) return slots;
  const first = slots[0] ?? (start?.pos ? { file: "", pos: [...start.pos], heading: start.heading ?? 0 } : null);
  if (!first) return slots;
  const out = slots.length ? [...slots] : [first];
  const h = first.heading ?? 0;
  const fwd = [Math.sin(h), Math.cos(h)], right = [Math.cos(h), -Math.sin(h)];
  const ground = (x, z) => (heightAt ? heightAt(x, z) : null);
  const base = ground(first.pos[0], first.pos[2]);
  const ride = base === null || !Number.isFinite(base) ? null : Math.max(2, Math.min(20, first.pos[1] - base));
  const clear = (x, z) => out.every((slot) => Math.hypot(slot.pos[0] - x, slot.pos[2] - z) >= PARTY_GRID_CLEAR_FT);
  for (let row = 0; out.length < count && row < 16; row++) {
    for (const across of [0, 1, -1, 2, -2]) {
      if (out.length >= count) break;
      const x = first.pos[0] - fwd[0] * row * PARTY_GRID_BACK_FT + right[0] * across * PARTY_GRID_ACROSS_FT;
      const z = first.pos[2] - fwd[1] * row * PARTY_GRID_BACK_FT + right[1] * across * PARTY_GRID_ACROSS_FT;
      if (!clear(x, z)) continue;
      const g = ground(x, z);
      const y = ride !== null && Number.isFinite(g) ? g + ride : g !== null && Number.isFinite(g) ? g + PARTY_RIDE_FT : first.pos[1];
      out.push({ file: "", pos: [x, y, z], heading: h, filled: true });
    }
  }
  return out;
}
