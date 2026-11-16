/*
  Community Patch 4 beta 0.53 hotfix 4 and Traxx 1.8's engine rules in OpenMTM2 (docs/CP4_EXE_ANALYSIS.md 17): the
  CP3 normal maps' strength as an option kept at 100 %, the terrain detail on the ground boxes as an option off by
  default, the track lights' allWx, glow, cone and 128 cap, and the limits hotfix 4 keeps instead of overrunning.
  The render files import three.js, which node does not resolve here, so they are checked by their text.
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS, migrateSettings } from "../src/app/settings.js";
import { parseSitLight, SIT_LIGHT_HEADER } from "../src/vendor/openphotex/index.js";

const source = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("normal map strength: an option at 100 % (CP4 uses 220 % from hotfix 4), clamped to 0..300, scaling CP3 art only", () => {
  assert.equal(DEFAULT_SETTINGS.cp4NormalMapStrength, 100);
  assert.equal(migrateSettings({ cp4NormalMapStrength: 900 }).cp4NormalMapStrength, 300);
  assert.equal(migrateSettings({ cp4NormalMapStrength: -5 }).cp4NormalMapStrength, 0);
  const ts = source("render/track-scene.js");
  assert.match(ts, /const cp3NormalScale = \(mesh, own = 1\) => \(mesh\.normalScaleY === 1 \? own : own \* normalMapStrength\);/);
  assert.match(ts, /const s = cp3NormalScale\(mesh, mesh\.normalStrength \?\? 1\); material\.normalScale\.set\(s, -s\);/);
  for (const screen of ["race", "fly-by", "replay"]) {
    assert.match(source(`ui/screens/${screen}.js`), /setNormalMapStrength\(context\.settings\.cp4NormalMapStrength \?\? 100\);/, screen);
  }
  assert.match(source("ui/options-panel.js"), /slider\(msg\("Normal map strength"\)/);
});

test("ground boxes: the terrain detail only when the option is on (off by default), in world XZ, with the mask's shares", () => {
  assert.equal(DEFAULT_SETTINGS.cp4GroundBoxDetail, false);
  const ts = source("render/track-scene.js");
  assert.match(ts, /detail: terrainDetail && groundBoxDetail \? build\.terrain\.detail \?\? null : null/);
  assert.match(ts, /geometry\.setAttribute\("detailShare", new THREE\.BufferAttribute\(terrainMaskShares\(boxes\.positions, detail\.mask, worldFt\), 1, true\)\);/);
  assert.match(source("ui/screens/race.js"), /groundBoxDetail: context\.settings\.cp4GroundBoxDetail === true/);
  assert.match(source("ui/options-panel.js"), /toggle\(msg\("Detail on ground boxes"\), "cp4GroundBoxDetail"/);
});

test("track lights: allWx read (13th field), the first 128 kept, the glow facing the box's +Z, the distance step, no pool under 1 ft", () => {
  assert.equal(parseSitLight("64,8,1,1,1,2,6,125,10,3.5,1,0,1").allWx, 1);
  assert.equal(parseSitLight("64,8,1,1,1,2,6,125,10,3.5,1,0").allWx, 0);
  assert.equal(SIT_LIGHT_HEADER, "Llight rad,hgt,r,g,b,glow,glowRad,coneLen,coneRim,coneBase,bright,aimOff,allWx");
  const build = source("worker/track-build.js");
  assert.match(build, /export const TRACK_LIGHTS_MAX = 128;/);
  assert.match(build, /if \(trackLights\.length >= TRACK_LIGHTS_MAX\) break;/);
  assert.match(build, /head: \[x \+ l\.hgt \* m\[1\], y \+ l\.hgt \* m\[4\], z \+ l\.hgt \* m\[7\]\]/);
  assert.match(build, /allWx: l\.allWx \?\? 0,/);
  const lights = source("render/track-lights.js");
  assert.match(lights, /export const BRIGHT_STEP_FT = 120 \* 32;/);
  assert.match(lights, /Math\.trunc\(\(zViewFt \* 256\) \/ \(BRIGHT_STEP_FT \* 256\)\) === 0 \? 1 : 0\.2/);
  assert.match(lights, /new THREE\.PlaneGeometry\(2 \* l\.glowRad, 2 \* l\.glowRad\)/);
  assert.match(lights, /const facingMe = toLamp\.lengthSq\(\) > 0 \? -toLamp\.dot\(item\.facing\) \/ toLamp\.length\(\) : 0;/);
  assert.match(lights, /const shown = night \|\| item\.allWx;/);
  assert.match(lights, /const base = l\.coneBase \/ 2;/);
  assert.match(lights, /items\.filter\(\(item\) => item\.l\.rad >= 1\)/);
});

import { CP4_LIMITS, withCp4Limits } from "../src/game/cp4-limits.js";

test("hotfix 4's limits: the first 10 placed trucks, 5 backdrops, the primary and 4 extended courses of 249 segments, 100 ramps, 10 + 40 ambient sounds", () => {
  assert.deepEqual({ ...CP4_LIMITS }, { trucks: 10, ramps: 100, backdrops: 5, courses: 5, segments: 249 });
  const course = (n) => ({ segments: Array.from({ length: n }, (_, i) => ({ i })) });
  const sit = {
    trucks: [{ playerSlot: true, name: "P" }, ...Array.from({ length: 12 }, (_, i) => ({ name: `T${i}` }))],
    backdropModelNames: ["A", "B", "C", "D", "E", "F", "G"],
    primaryCourse: course(300),
    extendedCourses: [course(10), course(20), course(30), course(40), course(50), course(60)],
  };
  const log = [];
  const kept = withCp4Limits(sit, (line) => log.push(line));
  assert.equal(kept.trucks.length, 11);
  assert.ok(kept.trucks[0].playerSlot);
  assert.equal(kept.trucks.at(-1).name, "T9");
  assert.deepEqual(kept.backdropModelNames, ["A", "B", "C", "D", "E"]);
  assert.equal(kept.primaryCourse.segments.length, 249);
  assert.deepEqual(kept.extendedCourses.map((c) => c.segments.length), [10, 20, 30, 40]);
  assert.deepEqual(log, [
    "This track places 12 trucks; this build holds 10.",
    "This track lists 7 backdrop models; this build holds 5.",
    "This track defines 7 AI courses; this build holds 5.",
    "An AI course on this track has more than 249 segments; the rest were dropped.",
  ]);
  assert.equal(sit.trucks.length, 13, "the input is not changed");
  const small = { trucks: [{ playerSlot: true }], backdropModelNames: ["A"], primaryCourse: course(5), extendedCourses: [] };
  const none = [];
  withCp4Limits(small, (line) => none.push(line));
  assert.deepEqual(none, []);
  assert.match(source("worker/track-build.js"), /for \(const box of rampBoxes\.slice\(0, CP4_LIMITS\.ramps\)\) \{/);
  assert.match(source("worker/level-load.js"), /if \(!cpr\) sit = withCp4Limits\(sit, \(line\) => console\.info\(line\)\);/);
  const audio = source("audio/world-audio.js");
  assert.match(audio, /export const AMBIENT_LOOPS_MAX = 10;/);
  assert.match(audio, /export const AMBIENT_SHOTS_MAX = 40;/);
  assert.match(audio, /\.filter\(\(l\) => weatherMaskIncludes\(l\.weatherMask, current\)\)\.slice\(0, AMBIENT_LOOPS_MAX\)/);
});
