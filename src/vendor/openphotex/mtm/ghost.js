/*
  A Time Attack ghost, `Ghosts\*.gst` beside the game (Community Patch 4 2.0.52.4, OpenMTM2
  docs/CP4_ENGINE_UPDATES.md 9.5): one best lap as text, "\n" line ends (a "\r" before one is
  tolerated), lines of at most 1,024 characters.

    MTM2GHOST 1
    track <file>                 at most 63 characters
    trackname <display name>     at most 95
    truck <file>                 at most 63
    truckname <display name>     at most 95
    driver <name>                at most 63
    laptime <seconds>            above 0, at most 1e6
    splits <n> <n times>         n 0..100, cumulative checkpoint times of the lap
    samples <n>                  n 2..200,000, then n lines of 29 numbers (9 significant digits, single spaces):

      1 time into the lap (never decreasing)   2-4 position   5-7 orientation (three angles)
      8-10 front axle position (body frame)    11-13 rear axle position   14-15 front, rear articulation
      16-17 front, rear steering   18-21 the FR, FL, RR, RL tyres' vertical offsets
      22-25 their rotation angles   26-29 their spin rates

  Recorded at 25 Hz from the player's own simulation, played back as recorded. Every value finite, |v| at most 1e7,
  |position| at most 1e6; a short or unterminated last line is an error. The game's axis and angle conventions were
  not published: this module reads and writes the numbers only. Names inside are data, never a path.
*/
export const GHOST_MAGIC = "MTM2GHOST 1";
export const GHOST_COLUMNS = 29;
export const GHOST_RATE_HZ = 25;
export const GHOST_MAX_SAMPLES = 200000;
export const GHOST_MAX_SPLITS = 100;
export const GHOST_MAX_LINE = 1024;
const LIMITS = { track: 63, trackname: 95, truck: 63, truckname: 95, driver: 63 };
/** Read a ghost; throws a RangeError naming what is wrong. */
export function parseGhost(input) {
    const text = typeof input === "string" ? input : new TextDecoder("latin1").decode(input);
    if (!text.endsWith("\n"))
        throw new RangeError("ghost: the last line is not terminated");
    const lines = text.slice(0, -1).split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    if (lines.some((l) => l.length > GHOST_MAX_LINE))
        throw new RangeError(`ghost: a line is over ${GHOST_MAX_LINE} characters`);
    if (lines[0] !== GHOST_MAGIC)
        throw new RangeError("ghost: not an MTM2GHOST 1 file");
    let at = 1;
    const keyed = (key) => {
        const line = lines[at++] ?? "";
        if (!line.startsWith(`${key} `) && line !== key)
            throw new RangeError(`ghost: expected "${key}"`);
        const value = line.slice(key.length + 1);
        if (LIMITS[key] !== undefined && value.length > LIMITS[key])
            throw new RangeError(`ghost: ${key} is over ${LIMITS[key]} characters`);
        return value;
    };
    const finite = (v, what, max = 1e7) => {
        const n = Number(v);
        if (v.trim() === "" || !Number.isFinite(n) || Math.abs(n) > max)
            throw new RangeError(`ghost: ${what} ${v} is out of range`);
        return n;
    };
    const track = keyed("track"), trackName = keyed("trackname"), truck = keyed("truck"), truckName = keyed("truckname"), driver = keyed("driver");
    const lapTime = finite(keyed("laptime"), "laptime", 1e6);
    if (!(lapTime > 0))
        throw new RangeError("ghost: laptime must be above 0");
    const splitParts = keyed("splits").split(" ").filter(Boolean);
    const nSplits = Number(splitParts[0]);
    if (!Number.isInteger(nSplits) || nSplits < 0 || nSplits > GHOST_MAX_SPLITS || splitParts.length !== nSplits + 1)
        throw new RangeError("ghost: bad splits line");
    const splits = splitParts.slice(1).map((v) => finite(v, "split"));
    const n = Number(keyed("samples"));
    if (!Number.isInteger(n) || n < 2 || n > GHOST_MAX_SAMPLES)
        throw new RangeError("ghost: samples must be 2..200000");
    if (lines.length - at !== n)
        throw new RangeError(`ghost: ${n} samples announced, ${lines.length - at} lines follow`);
    const samples = new Float64Array(n * GHOST_COLUMNS);
    for (let i = 0; i < n; i++) {
        const parts = lines[at + i].split(" ");
        if (parts.length !== GHOST_COLUMNS)
            throw new RangeError(`ghost: sample ${i + 1} has ${parts.length} values, not ${GHOST_COLUMNS}`);
        for (let c = 0; c < GHOST_COLUMNS; c++) {
            samples[i * GHOST_COLUMNS + c] = finite(parts[c], `sample ${i + 1} value ${c + 1}`, c >= 1 && c <= 3 ? 1e6 : 1e7);
        }
        if (i > 0 && samples[i * GHOST_COLUMNS] < samples[(i - 1) * GHOST_COLUMNS])
            throw new RangeError(`ghost: sample ${i + 1}'s time goes back`);
    }
    return { track, trackName, truck, truckName, driver, lapTime, splits, samples };
}
const sig = (v) => {
    const s = Number(v.toPrecision(9));
    return Object.is(s, -0) ? "0" : String(s);
};
/** A ghost's text ("\n" lines). Throws a RangeError for values the reader would refuse. */
export function writeGhost(g) {
    const n = g.samples.length / GHOST_COLUMNS;
    if (!Number.isInteger(n) || n < 2 || n > GHOST_MAX_SAMPLES)
        throw new RangeError("ghost: samples must be 2..200000 rows of 29");
    if (g.splits.length > GHOST_MAX_SPLITS)
        throw new RangeError("ghost: at most 100 splits");
    for (const [key, value] of [["track", g.track], ["trackname", g.trackName], ["truck", g.truck], ["truckname", g.truckName], ["driver", g.driver]]) {
        if (value.length > LIMITS[key] || /[\r\n]/.test(value))
            throw new RangeError(`ghost: ${key} does not fit`);
    }
    const out = [GHOST_MAGIC, `track ${g.track}`, `trackname ${g.trackName}`, `truck ${g.truck}`, `truckname ${g.truckName}`, `driver ${g.driver}`,
        `laptime ${sig(g.lapTime)}`, `splits ${[g.splits.length, ...g.splits.map(sig)].join(" ")}`, `samples ${n}`];
    for (let i = 0; i < n; i++)
        out.push(Array.from(g.samples.subarray(i * GHOST_COLUMNS, (i + 1) * GHOST_COLUMNS), sig).join(" "));
    const text = `${out.join("\n")}\n`;
    parseGhost(text);
    return text;
}
