/*
  Headless laps for the computer trucks: a race of the track's grid, every truck on autopilot, for a fixed time, with
  what went wrong counted per truck and per course segment. The measure behind docs/CHANGELOG.md "Computer trucks at
  the limit" and "Computer trucks keeping control".

    node tools/cpu-laps.mjs --sit TPARK --difficulty 2 --seconds 240
    node tools/cpu-laps.mjs --pod ~/Downloads/VALPO4.POD --sit VALPO4 --difficulty 2 --seconds 300 --watch 25

  `--pod` mounts an archive ahead of the retail ones (a track's own POD); the retail archives are read from
  $OPENMTM2_GAMES/mtm2 (default ~/games/mtm2). `--sit` is the SIT or SI2 file's stem. Options: `--ai omtm2|mtm2|mtm1`
  (Advanced, Computer trucks), `--sonic` (Sonic trucks on Professional), `--aispeed 70..130`, `--fps` (opponent frame
  rate), `--nocontrol`, `--norecovery`, `--noreturn`, `--nounstick` (the port's layers off, to weigh each),
  `--watch <segment>` (an event log on that segment), `--json <file>` (every figure).

  Columns: laps, checkpoints, best lap (s), average speed (ft/s), slides (travel over 0.35 rad off the nose at 25 ft/s
  or more, three wheels down), spins (nose over 1.75 rad off the course), stops (under 5 ft/s over 1.5 s) and their
  seconds, helicopter lifts, missed gates, teleports, seconds in reverse, in recovery (racer-recovery.js), facing
  the wrong way, over 40 ft off the line, and the widest cross-track error. Reads local game files: never a test.
*/
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { parsePod, readPodEntry, mtm2Sim: S } = await import(join(ROOT, "src/vendor/openphotex/index.js"));
const { createVfs } = await import(join(ROOT, "src/worker/vfs.js"));
const { buildTrackRender } = await import(join(ROOT, "src/worker/track-build.js"));
const { buildCatalog } = await import(join(ROOT, "src/worker/catalog.js"));
const { createSession, STEP } = await import(join(ROOT, "src/worker/sim-worker.js"));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? true : arr[i + 1]] : null).filter(Boolean));
const STOCK = process.env.OPENMTM2_GAMES ? join(process.env.OPENMTM2_GAMES, "mtm2") : join(process.env.HOME ?? "", "games/mtm2");
const RETAIL = ["STARTUP.POD", "MUSIC.POD", "SOUND.POD", "TRUCK2.POD", "COCKPIT.POD", "UI.POD", "TPARK.POD", "ALASKA.POD", "JUNK.POD", "CRAZY98.POD", "SNAKE.POD", "MAIN.POD", "AZTEC.POD", "OUTBACK.POD", "ROCKQRY.POD", "BAJA.POD", "SUMMIT1.POD", "SUMMIT2.POD", "SUMMIT3.POD"];
function mount(path, name = path.split("/").pop()) {
  const bytes = new Uint8Array(readFileSync(path));
  return { name, family: "MTM", game: "MTM2", archive: parsePod(bytes), readEntry: async (e) => readPodEntry(bytes, e) };
}
const extra = args.pod && args.pod !== "stock" ? [mount(args.pod)] : [];
const vfs = createVfs([...extra, ...RETAIL.map((n) => mount(join(STOCK, n), n))]);
const difficulty = Number(args.difficulty ?? 2);
const seconds = Number(args.seconds ?? 300);
const aiBehaviour = args.ai ?? "omtm2";
const { tracks } = await buildCatalog(vfs);
const want = (args.sit ?? "TPARK").toUpperCase();
const track = tracks.find((t) => t.file.toUpperCase().startsWith(want));
if (!track) { console.error("no track", want, tracks.map((t) => t.file)); process.exit(1); }
const build = await buildTrackRender(vfs, track.path);
const raceCourse = (difficulty === 2 && build.sim.proRaceCourse) || build.sim.raceCourse || build.sim.course;
const which = raceCourse === build.sim.proRaceCourse ? "course 2 (pro)" : raceCourse === build.sim.raceCourse ? "course 1" : "primary";
const grid = build.sim.grid;
const fallback = Object.values(build.truckModels).find(Boolean);
const trucks = grid.map((g) => ({ truck: build.truckModels[g.file] ?? fallback, start: { pos: g.pos, heading: g.heading }, autopilot: true }));
const init = {
  heights: build.heights.slice().buffer, clr: build.sim.clr.slice().buffer, textureValues: build.sim.textureValues.slice().buffer,
  ra0: build.sim.ra0?.slice().buffer ?? null, ra1: build.sim.ra1?.slice().buffer ?? null, boxes: build.sim.boxes, ramps: build.sim.ramps, topCrush: build.sim.topCrush ?? [],
  course: raceCourse, routeCourses: (build.sim.routeCourses ?? []).filter((c) => c && c !== raceCourse),
  sonicTrack: build.sim.sonicTrack || (difficulty === 2 && !!args.sonic), waterLevelFt: build.waterLevelFt, weather: 0, difficulty,
  opponentFps: Number(args.fps ?? 30), aiSpeed: Number(args.aispeed ?? 100), aiBehaviour, rules: "mtm2",
  trucks, race: { checkpoints: build.sim.checkpoints, laps: 99, mode: "circuit" },
};
const session = createSession(init);
// Experiments: switch the port's layers off after the session is built.
for (const t of session.trucks) {
  if (args.noreturn && t.racerRecovery) t.racerRecovery.returns = false;
  if (args.nounstick && t.racerRecovery) t.racerRecovery.unsticks = false;
  if (args.norecovery) t.racerRecovery = null;
  if (args.nocontrol) t.cpuControl = null;
}
const watch = args.watch !== undefined ? Number(args.watch) : null;

const events = [];
const course = session.course;
const n = session.trucks.length;
const names = grid.map((g) => g.file.replace(/\.TRK$/i, ""));

// Per truck metrics.
const M = session.trucks.map(() => ({
  slides: 0, spins: 0, stops: 0, stopTime: 0, lifts: 0, misses: 0, teleports: 0, recoverTime: 0, reverseTime: 0,
  slow: 0, inSlide: false, inSpin: false, stopRun: 0, lastPos: null, dist: 0, speedSum: 0, speedN: 0,
  bySeg: new Map(), maxCross: 0, offLine: 0, lapTimes: [], wasHeli: false, missBefore: false,
  wrongWayTime: 0, airTime: 0, cpuResets: 0,
}));
const segHeading = (seg, pos) => {
  if (!S.isArc(seg)) return Math.atan2(seg.end[0] - seg.start[0], seg.end[2] - seg.start[2]);
  const th = Math.atan2(pos[0] - seg.centre[0], pos[2] - seg.centre[2]);
  const span = S.wrapGame(seg.exitAngle - seg.entryAngle);
  return th + (span > 0 ? Math.PI / 2 : -Math.PI / 2);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const segStat = (m, i) => m.bySeg.get(i) ?? (m.bySeg.set(i, { slides: 0, spins: 0, stops: 0, misses: 0, lifts: 0, speed: 0, nSpeed: 0, time: 0 }), m.bySeg.get(i));

const steps = Math.round(seconds / STEP);
let started = false;
for (let k = 0; k < steps; k++) {
  session.step({});
  if (!S.raceStarted(session.race)) continue;
  for (let i = 0; i < n; i++) {
    const t = session.trucks[i], s = t.state, rt = session.race.trucks[i], m = M[i];
    const seg = course[s.ap.segment];
    const st = segStat(m, s.ap.segment);
    st.time += STEP;
    const [vx, , vz] = s.bvel;
    const speed = Math.hypot(vx, vz);
    const heli = s.heliTimer > 0;
    if (heli && !m.wasHeli) { m.lifts++; st.lifts++; }
    m.wasHeli = heli;
    if (m.lastPos) {
      const d = Math.hypot(s.pos[0] - m.lastPos[0], s.pos[2] - m.lastPos[2]);
      if (d > 40 && !heli) { m.teleports++; }
      else if (!heli) m.dist += d;
    }
    m.lastPos = [s.pos[0], s.pos[2]];
    if (heli) continue;
    m.speedSum += speed; m.speedN++;
    st.speed += speed; st.nSpeed++;
    const onGround = s.tires.filter((w) => w.onGround).length;
    if (onGround === 0) m.airTime += STEP;
    // Slide: travel more than 0.35 rad off the nose at speed, wheels down.
    const slip = Math.abs(Math.atan2(vx, vz));
    const sliding = speed > 25 && onGround >= 3 && slip > 0.35 && vz > 0;
    const slideEdge = sliding && !m.inSlide;
    if (slideEdge) { m.slides++; st.slides++; }
    m.inSlide = sliding;
    // Spin: nose more than 100 deg off the course direction.
    const err = seg ? Math.abs(wrap(segHeading(seg, s.pos) - s.euler[2])) : 0;
    const spun = err > 1.75;
    const spinEdge = spun && !m.inSpin;
    if (spinEdge) { m.spins++; st.spins++; }
    m.inSpin = spun;
    if (spun) m.wrongWayTime += STEP;
    // Stopped: under 5 ft/s for over 1.5 s.
    if (speed < 5) { m.stopRun += STEP; if (m.stopRun > 1.5) { m.stopTime += STEP; if (Math.abs(m.stopRun - 1.5) < STEP * 0.6) { m.stops++; st.stops++; } } }
    else m.stopRun = 0;
    if (speed < 20 && s.ap.target > 40) m.slow += STEP;
    if (s.controls.gear === S.GEAR.REVERSE) m.reverseTime += STEP;
    if (t.racerRecovery && t.racerRecovery.mode !== "course") m.recoverTime += STEP;
    const missed = rt.state === 3;
    if (missed && !m.missBefore) { m.misses++; st.misses++; }
    m.missBefore = missed;
    if (watch !== null && (s.ap.segment === watch || missed && !m.missBefore) ) {
      const ev = [];
      if (sliding && !m.inSlideW) ev.push("slide"); m.inSlideW = sliding;
      if (spun && !m.inSpinW) ev.push("spin"); m.inSpinW = spun;
      if (missed && !m.missBefore) ev.push("MISS");
      if (t.racerRecovery && t.racerRecovery.mode !== m.modeW) { ev.push("mode:" + t.racerRecovery.mode + (t.racerRecovery.phase ? "/" + t.racerRecovery.phase + "/" + t.racerRecovery.plan : "")); m.modeW = t.racerRecovery.mode; }
      if (t.cpuControl?.turn && !m.turnW) ev.push("3pt-turn"); m.turnW = !!t.cpuControl?.turn;
      if (ev.length) events.push(`${(k * STEP).toFixed(1).padStart(6)}s ${names[i].padEnd(9)} seg${String(s.ap.segment).padStart(3)} ${ev.join(",").padEnd(28)} pos=${s.pos[0].toFixed(0)},${s.pos[2].toFixed(0)} v=${speed.toFixed(0)} tgt=${(s.ap.target ?? 0).toFixed(0)} slip=${(Math.atan2(vx, vz) * 57.3).toFixed(0)} x=${(s.ap.crossTrack ?? 0).toFixed(0)} steer=${s.controls.steer.toFixed(2)} thr=${s.controls.throttle.toFixed(2)} brk=${s.controls.brakeRear.toFixed(2)} gnd=${onGround} cp=${rt.checkpoint}`);
    }
    const cross = Math.abs(s.ap.crossTrack ?? 0);
    if (cross > m.maxCross) m.maxCross = cross;
    if (cross > 40) m.offLine += STEP;
  }
}
const race = session.race;
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "-");
console.log(`\n${track.name} (${track.file}) ${which}, ${course.length} segments, difficulty ${difficulty}, ai=${aiBehaviour}, sonic=${init.sonicTrack}, aiSpeed=${init.aiSpeed}, ${seconds}s, ${n} trucks`);
console.log("truck      laps cps  best  avgV  slides spins stops stopS lifts miss  tele revS recS wrongS offS maxX");
const tot = { laps: 0, cps: 0, slides: 0, spins: 0, stops: 0, stopTime: 0, lifts: 0, misses: 0, teleports: 0, reverseTime: 0, recoverTime: 0, wrongWayTime: 0, offLine: 0, best: Infinity };
for (let i = 0; i < n; i++) {
  const m = M[i], rt = race.trucks[i];
  const best = rt.fastestLap || Infinity;
  tot.laps += rt.laps; tot.cps += rt.passed; tot.slides += m.slides; tot.spins += m.spins; tot.stops += m.stops; tot.stopTime += m.stopTime; tot.lifts += m.lifts; tot.misses += m.misses; tot.teleports += m.teleports; tot.reverseTime += m.reverseTime; tot.recoverTime += m.recoverTime; tot.wrongWayTime += m.wrongWayTime; tot.offLine += m.offLine; tot.best = Math.min(tot.best, best);
  console.log(`${names[i].padEnd(10)} ${String(rt.laps).padStart(4)} ${String(rt.passed).padStart(3)} ${fmt(best).padStart(5)} ${fmt(m.speedSum / m.speedN).padStart(5)}  ${String(m.slides).padStart(5)} ${String(m.spins).padStart(5)} ${String(m.stops).padStart(5)} ${fmt(m.stopTime, 0).padStart(5)} ${String(m.lifts).padStart(5)} ${String(m.misses).padStart(4)} ${String(m.teleports).padStart(5)} ${fmt(m.reverseTime, 0).padStart(4)} ${fmt(m.recoverTime, 0).padStart(4)} ${fmt(m.wrongWayTime, 0).padStart(6)} ${fmt(m.offLine, 0).padStart(4)} ${fmt(m.maxCross, 0).padStart(4)}`);
}
console.log(`TOTAL      ${String(tot.laps).padStart(4)} ${String(tot.cps).padStart(3)} ${fmt(tot.best).padStart(5)}        ${String(tot.slides).padStart(5)} ${String(tot.spins).padStart(5)} ${String(tot.stops).padStart(5)} ${fmt(tot.stopTime, 0).padStart(5)} ${String(tot.lifts).padStart(5)} ${String(tot.misses).padStart(4)} ${String(tot.teleports).padStart(5)} ${fmt(tot.reverseTime, 0).padStart(4)} ${fmt(tot.recoverTime, 0).padStart(4)} ${fmt(tot.wrongWayTime, 0).padStart(6)} ${fmt(tot.offLine, 0).padStart(4)}`);
// Hotspots by segment.
const hot = new Map();
for (const m of M) for (const [i, st] of m.bySeg) { const h = hot.get(i) ?? { slides: 0, spins: 0, stops: 0, misses: 0, lifts: 0, speed: 0, nSpeed: 0, time: 0 }; for (const k of Object.keys(h)) h[k] += st[k]; hot.set(i, h); }
const rows = [...hot.entries()].map(([i, h]) => ({ i, ...h, score: h.slides + 2 * h.spins + 2 * h.stops + 3 * h.misses + 3 * h.lifts })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 12);
if (rows.length) {
  console.log("\nhotspots (segment: kind, speed target, radius): slides spins stops misses lifts  avgV  time");
  for (const r of rows) {
    const seg = course[r.i];
    const desc = S.isArc(seg) ? `arc r=${seg.radius.toFixed(0)} v=${seg.speed.toFixed(0)} span=${(S.wrapGame(seg.exitAngle - seg.entryAngle) * 180 / Math.PI).toFixed(0)}deg` : `straight len=${Math.hypot(seg.end[0] - seg.start[0], seg.end[2] - seg.start[2]).toFixed(0)} v=${seg.speed.toFixed(0)} lim=${seg.speedLimit} w=${seg.trackWidth}`;
    console.log(`  #${String(r.i).padStart(3)} ${desc.padEnd(44)} ${String(r.slides).padStart(5)} ${String(r.spins).padStart(5)} ${String(r.stops).padStart(5)} ${String(r.misses).padStart(6)} ${String(r.lifts).padStart(5)} ${fmt(r.speed / r.nSpeed).padStart(5)} ${fmt(r.time, 0).padStart(5)}`);
  }
}
if (events.length) { console.log("\nevents:"); for (const e of events.slice(0, Number(args.maxevents ?? 80))) console.log(e); }
if (args.json) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(args.json, JSON.stringify({ track: track.file, which, difficulty, aiBehaviour, seconds, trucks: M.map((m, i) => ({ name: names[i], laps: race.trucks[i].laps, passed: race.trucks[i].passed, best: race.trucks[i].fastestLap, ...m, bySeg: [...m.bySeg.entries()] })) }, null, 1));
}
