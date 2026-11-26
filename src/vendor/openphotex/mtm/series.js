/*
  Community Patch 4 2.0.52.4's tournament files, `Tournaments\*.trn` (presets) and `*.trs` (a season in progress;
  `autosave.trs` the running one), OpenMTM2 docs/CP4_ENGINE_UPDATES.md 9.4. Text `key=value` lines after a first line
  `MTM2 Series 1.0`; unknown keys are ignored and absent keys keep their defaults.

    .trn   NAME, DESCR, FORMAT (0 standard: at most 8 entrants, circuits and rallies; 1 drags only: 16),
           SCORING (0 classic, 1 championship), SONIC, AISPEED (absent: the player's), FIELD (opponents),
           ROUNDS (at most 128), R=<track file>,<pod>,<laps>,<weather> a round (weather 0 random; -2 reads as 0)
    .trs   adds PROGRESS=1, CURROUND, PLAYERTRUCK, BANKED, ENTRANTS (at most 16),
           E=<truck file>,<pod>,<isPlayer>,<total points>,<name> an entrant,
           RP=<points>/<place>/<contested> a round's result for each entrant (the entrants' order, round after round),
           X=<hex> an entrant's opaque computer state (kept as written; may be ignored)

  This module is the text codec only; what a game does with a season is its own.
*/
export const SERIES_MAGIC = "MTM2 Series 1.0";
export const SERIES_MAX_ROUNDS = 128;
export const SERIES_MAX_ENTRANTS = 16;
export const SERIES_MAX_FILES = 64;
const int = (v, d = 0) => { const n = parseInt(v ?? "", 10); return Number.isFinite(n) ? n : d; };
export function parseSeries(input) {
    const text = typeof input === "string" ? input : new TextDecoder("latin1").decode(input);
    const lines = text.split(/\r\n|\r|\n/);
    if (lines[0]?.trim() !== SERIES_MAGIC)
        throw new RangeError(`series: the first line must be "${SERIES_MAGIC}"`);
    const out = { name: "", description: "", format: 0, scoring: 0, sonic: false, aiSpeed: null, field: 7, rounds: [], progress: null };
    const entrants = [];
    const rp = [];
    const ai = [];
    let progress = false, currentRound = 0, playerTruck = "", banked = 0, entrantCount = 0, roundCount = -1;
    for (const raw of lines.slice(1)) {
        const eq = raw.indexOf("=");
        if (eq < 0)
            continue;
        const key = raw.slice(0, eq).trim().toUpperCase(), value = raw.slice(eq + 1).trim();
        switch (key) {
            case "NAME":
                out.name = value;
                break;
            case "DESCR":
                out.description = value;
                break;
            case "FORMAT":
                out.format = int(value) === 1 ? 1 : 0;
                break;
            case "SCORING":
                out.scoring = int(value) === 1 ? 1 : 0;
                break;
            case "SONIC":
                out.sonic = int(value) !== 0;
                break;
            case "AISPEED":
                out.aiSpeed = int(value, 100);
                break;
            case "FIELD":
                out.field = Math.max(0, int(value));
                break;
            case "ROUNDS":
                roundCount = Math.min(SERIES_MAX_ROUNDS, Math.max(0, int(value)));
                break;
            case "R": {
                if (out.rounds.length >= SERIES_MAX_ROUNDS)
                    break;
                const [track = "", pod = "", laps, weather] = value.split(",").map((v) => v.trim());
                const w = int(weather);
                out.rounds.push({ track, pod, laps: Math.max(1, int(laps, 1)), weather: w === -2 ? 0 : w });
                break;
            }
            case "PROGRESS":
                progress = int(value) === 1;
                break;
            case "CURROUND":
                currentRound = Math.max(0, int(value));
                break;
            case "PLAYERTRUCK":
                playerTruck = value;
                break;
            case "BANKED":
                banked = int(value);
                break;
            case "ENTRANTS":
                entrantCount = Math.min(SERIES_MAX_ENTRANTS, Math.max(0, int(value)));
                break;
            case "E": {
                if (entrants.length >= SERIES_MAX_ENTRANTS)
                    break;
                const parts = value.split(",");
                entrants.push({ truck: (parts[0] ?? "").trim(), pod: (parts[1] ?? "").trim(), player: int(parts[2]) !== 0, points: int(parts[3]), name: parts.slice(4).join(",").trim(), ai: null });
                break;
            }
            case "RP": {
                const [points, place, contested] = value.split("/");
                rp.push({ points: int(points), place: int(place), contested: int(contested) !== 0 });
                break;
            }
            case "X":
                ai.push(value);
                break;
            default: break;
        }
    }
    if (roundCount >= 0 && out.rounds.length > roundCount)
        out.rounds.length = roundCount;
    if (progress) {
        const list = entrantCount ? entrants.slice(0, entrantCount) : entrants;
        list.forEach((e, i) => { e.ai = ai[i] ?? null; });
        const results = [];
        if (list.length)
            for (let k = 0; k < rp.length; k += list.length)
                results.push(rp.slice(k, k + list.length));
        out.progress = { currentRound, playerTruck, banked, entrants: list, results };
    }
    return out;
}
export function writeSeries(s) {
    if (s.rounds.length > SERIES_MAX_ROUNDS)
        throw new RangeError(`series: at most ${SERIES_MAX_ROUNDS} rounds`);
    const clean = (v) => v.replace(/[\r\n]/g, " ");
    const out = [SERIES_MAGIC, `NAME=${clean(s.name)}`, `DESCR=${clean(s.description)}`, `FORMAT=${s.format}`, `SCORING=${s.scoring}`, `SONIC=${s.sonic ? 1 : 0}`];
    if (s.aiSpeed !== null)
        out.push(`AISPEED=${Math.round(s.aiSpeed)}`);
    out.push(`FIELD=${s.field}`, `ROUNDS=${s.rounds.length}`);
    for (const r of s.rounds)
        out.push(`R=${clean(r.track)},${clean(r.pod)},${r.laps},${r.weather}`);
    const p = s.progress;
    if (p) {
        if (p.entrants.length > SERIES_MAX_ENTRANTS)
            throw new RangeError(`series: at most ${SERIES_MAX_ENTRANTS} entrants`);
        out.push("PROGRESS=1", `CURROUND=${p.currentRound}`, `PLAYERTRUCK=${clean(p.playerTruck)}`, `BANKED=${p.banked}`, `ENTRANTS=${p.entrants.length}`);
        for (const e of p.entrants)
            out.push(`E=${clean(e.truck)},${clean(e.pod)},${e.player ? 1 : 0},${Math.round(e.points)},${clean(e.name)}`);
        for (const round of p.results)
            for (const r of round)
                out.push(`RP=${Math.round(r.points)}/${Math.round(r.place)}/${r.contested ? 1 : 0}`);
        for (const e of p.entrants)
            if (e.ai !== null)
                out.push(`X=${e.ai}`);
    }
    return `${out.join("\r\n")}\r\n`;
}
