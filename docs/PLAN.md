# OpenMTM2 plan: from empty repo to first playable race

## Context

OpenMTM2 is an online, open reimplementation of Monster Truck Madness 2 (retail 2.00.42). It reads the user's own install and is built on OpenPhotex, Three.js, OPFS and Web Workers, like JSTrackViewer.

Two reverse-engineering passes produced `docs/MONSTER_EXE_ANALYSIS.md` (game structure, rules, files) and `docs/MTM2_PHYSICS.md` (a code-derived simulation spec). The physics is implemented **from those docs**. It is not fitted to replays, and JSTrackViewer's `vehicle-sim.js` is not a source of truth.

**Decisions taken**
- **UI:** HTML screens mirroring MTM2's flow, plus an optional classic skin using the UI.POD BMPs. The in-race HUD, finder and cockpit are drawn by the engine, faithfully.
- **Look:** classic by default; an enhanced setting reuses JSTrackViewer's shadows and sun flare.
- **Physics:** a new pure-TypeScript OpenPhotex module, `src/sim/mtm2/`, vendored into OpenMTM2.
- **Render prep** (track and truck loading, terrain mesh, BIN models, palettes): copy the MTM-only pieces from JSTrackViewer into OpenMTM2 now; promote them into OpenPhotex later.
- **Out of scope:** moving JSTrackViewer's Test Drive onto the new sim (a later plan). Community Patch 3 support comes later.
- **First playable:** one Circuit race against CPU trucks, with countdown, laps, checkpoints and a results screen.

**Clean-room rule:** the git-ignored `re/` folder is read only to put facts into `docs/`. Code is written from `docs/`, and no decompiled code is ever copied or published.

**What the design pass found**
1. Stock SIT files store only the odd-numbered *straight* course segments (`ctype,cspeed_type = 1,0`). The engine builds the arcs (even segments, `ctype 2`) and the bank angle at load time. This must be traced in `re/` first; the autopilot depends on it.
2. OpenPhotex's course parser keeps only `start`, `end`, `speedLimit` and `trackWidth`, converted to editor space. The sim needs raw feet and the other fields.
3. JSTrackViewer's physics space is scene-flipped. The sim works in game feet (x right, y up, z forward), and exactly one render module converts.
4. The 19 PODs total about 131 MB. `POD.INI` names are lowercase while the files are uppercase, so every lookup must ignore case.

---

## Architecture

### OpenMTM2 layout

The app is a static site: no bundler, three@0.169.0 from jsDelivr through an import map, served locally with `python3 -m http.server 8080`, published with GitHub Pages and `.nojekyll`, Apache-2.0.

| Folder | Contents |
|---|---|
| `src/app/` | `main.js` (boot: route to Install or Start), `router.js` (screen stack), `settings.js` (localStorage), `profile-store.js` (OPFS JSON) |
| `src/install/` | `picker.js` (`<input webkitdirectory>` in every browser: Chromium's `showDirectoryPicker` hides `POD.INI`), `pod-ini.js`, `install-manifest.js` |
| `src/ui/screens/` | install, start, race-select, garage, loading, results, options, plus dev screens `dev-track` and `dev-drive` |
| `src/ui/` | `components/`, `classic-skin.js` (later) |
| `src/game/` | `race-setup.js`, `race-controller.js`, `sim-host.js` (worker) and `sim-host-inline.js` (same interface in-process, for tests and debugging), `interpolate.js`, `input/{keyboard,gamepad,bindings,input-sampler}.js`, `results.js` |
| `src/render/` | `renderer.js`, `world-frame.js` (**the only feet-to-scene conversion**), `terrain.js` (+ shader), `models.js`, `ground-boxes.js`, `sky.js`, `water.js`, `backdrop.js`, `lighting.js`, `look.js`, `truck-object.js`, `truck-lights.js`, `objects.js`, `cameras.js`, `hud.js`, `finder.js`, `fx/` |
| `src/worker/` | `asset-worker.js`, `sim-worker.js`, `opfs.js`, `pod-index.js`, `vfs.js` (POD.INI mount order, first match, case-insensitive, then loose files), `catalog.js`, `copy-install.js`, `track-render-build.js`, `terrain-builder.js` (**checkerboard split for MTM2**), `bin-decoder.js`, `texture-decoder.js`, `palette-resolver.js`, `image-decoder.js`, `keyframes.js`, `gbox-loader.js`, `checkpoint-list.js`, `truck/*`, `sim-world-build.js` (pure: parsed files to sim world input; runs in Node) |
| `src/shared/` | `worker-client.js`, `protocol.js`, `paths.js` |
| `src/vendor/openphotex/` | output of `npm run vendor` |
| `tests/` | `*.test.mjs` run with `node --test tests/`; `helpers/stock.mjs` skips tests when `~/games/mtm2` is absent |
| `docs/` | add `ARCHITECTURE.md`, `COORDINATES.md`, `PROTOCOL.md`, `INSTALL.md`; `AGENTS.md`/`CLAUDE.md` state the clean-room rules |

**Boundaries:**
- `src/worker/**` and `src/game/**` (except `input/`) never import three.js or the DOM, so Node tests can run them.
- Only `src/render/**` imports three.
- The vendored OpenPhotex is imported by relative path, because workers ignore import maps.

### Reused from JSTrackViewer (copy and adapt; JSTrackViewer stays untouched)

| Source | Becomes |
|---|---|
| `src/worker-client.js`, `src/shared/opfs.js`, `src/worker/pod-format.js` | infrastructure in `src/shared/` and `src/worker/` |
| MTM branch of `track-worker.js` `loadTrackAsync`, with `collectTransfers` | `track-render-build.js` |
| `sit-parser.js`, `terrain-builder.js`, `bin-decoder.js`, `texture-decoder.js`, `palette-resolver.js`, `image-decoder.js`, `keyframes.js`, `gbox-loader.js`, `checkpoint-list.js`, `worker/truck/*` | the matching `src/worker/` files |
| `scene.js` methods `_buildTerrain`, `_installTerrainShader`, `_buildBinModel`, `_createModelMaterial`, `_buildGroundBoxes`, `_buildSky`, `_buildBackdropModel`, `_buildWater`, `_applyLighting`, and the `traxx*Matrix` helpers | lifted into the small `src/render/` modules |
| `sun-flare.js` (+ `resources/flare`), `sun-shadows.js` | `src/render/fx/` |
| `drive/truck-object.js`, `drive/truck-lights.js`, `drive/drive-cameras.js`, `drive/drive-input.js` | `src/render/` and `src/game/input/` |
| `drive/world-frame.js` | the basis for `render/world-frame.js`, rewritten for game-frame feet |

### OpenPhotex additions

**New module `src/sim/mtm2/`.** It follows the AGENTS.md rules: portable (no DOM or worker globals), plain structured-cloneable data, test first, documented in `docs/SIM_MTM2.md`.

| File | Contents |
|---|---|
| `constants.ts` | every number, with its spec section reference, including `REFERENCE_DT` |
| `math.ts` | `M = Ry Rx Rz`, body/world transforms, Euler extraction, angle wraps; `Float64Array` scratch, no allocation in the step |
| `time.ts` | 16.16 fixed point to seconds and back |
| `world/terrain.ts` | checkerboard triangles, per-triangle normals, wrap at 8192 ft, snow freeze |
| `world/surface.ts`, `world/water.ts`, `world/ground-boxes.ts`, `world/ramps.ts` | surfaces, water depth and submerged area, temporary ground boxes, ramp heights and side walls |
| `world/objects.ts` | runtime objects from SIT boxes |
| `world/course.ts` | arc reconstruction (from the trace) and segment queries |
| `world/checkpoints.ts` | sphere pretest, oriented box, direction test |
| `truck/params.ts` | wheelbase clamp, springs from sag, transfer × difficulty, grip and torque gains |
| `truck/state.ts`, `truck/controls.ts`, `truck/drivetrain.ts`, `truck/tires.ts`, `truck/aero.ts` | state, input ramps and steering shaping, engine and gears, tire forces, drag and damping |
| `truck/contacts.ts` | ≤4 contacts, support split for 1/2/3/4 points, recovery, friction |
| `truck/forces.ts`, `truck/integrate.ts`, `truck/poststep.ts` | force/moment sums, integration, push-out and solid axles |
| `truck/recovery.ts`, `truck/damage.ts` | flip reset and helicopter, crash damage zones |
| `collide/{broadphase,sat,truck-box,truck-truck,ramp,topcrush,box-box,rigid-body}.ts` | object collisions |
| `ai/autopilot.ts`, `ai/traffic.ts` | CPU steering, target speed, passing and following |
| `race/rules.ts`, `race/summit.ts` | countdown, splits, laps, missed checkpoint, placings, fast-finish; Summit scoring |
| `session.ts` | `createMtm2Session(world, config)`, `stepMtm2Session(s, inputs, dt) → events`, `fastSimulateRemaining` |
| `snapshot.ts` | layout constants, `writeMtm2Snapshot` |

**New and extended readers**, each with a synthetic fixture test, a `stock.test.ts` check and a docs entry:
- **Course fields** in `src/mtm/sit.ts`: `ctype`, `cspeedType`, `cdecPoint`, `cspeed`, `lastEntry`, raw-feet `startFt`/`endFt`, and course direction. Additive only; the existing `start`/`end` stay for JSTrackViewer.
- **New readers:** `.KLP`, `SOUNDnnn.TXT`, `SUN.TXT`, `.LOC`, `powerbig` cockpit layout.
- **WAV ADPCM fallback**, only if stock WAVs need it.

After every core change: `npm test`, `npm run build`, vendor into OpenMTM2 and JSTrackViewer, and run JSTrackViewer's `node --test tests/`.

### Threads and timing
- **Main thread:** UI, three.js rendering, input, audio.
- **Asset worker:** VFS, catalog, install copy, render prep, sim world build.
- **Sim worker:** owns the session and steps a **fixed 1/60 s**.

How a frame works:
1. Each `requestAnimationFrame` posts `tick {tMs, seq, input}`.
2. The worker steps until it catches up, with at most 0.25 s of catch-up.
3. It returns a snapshot of the previous and current states, in pooled transferable buffers.
4. The main thread interpolates: positions blended, orientations converted to quaternions and slerped.

**Why a worker:** it is immune to render jank, the end-of-race fast simulation never blocks the UI, the worker runs the same code as the Node tests, and multiplayer can attach later.

**Step-length policy.** A few laws are written per step in the original and need care at 1/60 s:

| Law | Handling |
|---|---|
| AI steering `22·dt` term | evaluated at `REFERENCE_DT` = 1/30 (hypothesis, one documented constant) |
| Roof crush, bottoming damper (fractions per step) | converted as `1 − (1 − f)^(dt / REFERENCE_DT)` |
| `v/dt` "stop in one step" laws | left exact |

A debug "classic timing" option (variable step per frame, split above 0.1 s) is kept for comparison.

**Determinism:** fixed step, ordered iteration, seeded random numbers kept in the session, no `Date` or `Math.random` inside the sim. No SharedArrayBuffer, because GitHub Pages cannot send the COOP/COEP headers. The asset worker and the sim worker talk through a `MessageChannel`.

---

## Milestones

### M0: Scaffold (OpenMTM2)
**Status: done.**

- `index.html` with the import map, styles, router, `.nojekyll`, AGENTS.md (clean-room rules), stock-test helper, `docs/ARCHITECTURE.md`.
- Copy the infrastructure files; first OpenPhotex vendor.
- **Accept:** the local server shows a Start placeholder and `node --test tests/` passes.

### M1: Install and content (OpenMTM2)
**Status: done.**

- Folder picker; the folder must hold `POD.INI` (or `SYSTEM\POD.INI`) and the archives it lists. `MONSTER.EXE` is neither checked nor copied, so retail 2.0.41 and 2.00.42 installs both work.
- `POD.INI` parse; copy `POD.INI` and the PODs into OPFS **from the asset worker** (Safari's OPFS writes only work there), with progress, `navigator.storage.persist()` and a quota check.
- `vfs.js` with mount order, first match and case-insensitive names; cached POD indexes.
- `catalog.js` with CHUCK/WAR/GRAVEY behind flags.
- **Accept:**
  - Picking `~/games/mtm2` works in Chrome, Edge and Firefox (webkitdirectory).
  - A reload skips the install step.
  - The catalog shows 13 visible tracks and the stock trucks.
  - Node tests cover `pod-ini`, `inspect-source` and VFS first match (synthetic PODs built with OpenPhotex `writePod1`).

### M2: Sim foundations and readers (OpenPhotex)
**Status: done.** Checkpoint detection itself waits for M5's shared truck-against-box test. New readers: `.KLP`, `SOUNDnnn.TXT`, `SUN.TXT`, `.LOC`, `POWERBIG` (OpenPhotex `docs/MTM2_FILES.md`).

- **First:** trace in `re/` the SIT course loader, the arc and bank construction, and the `cspeed_type` remap. Write the facts into `MTM2_PHYSICS.md` §12 before any code.
- Extend the course reader; add the new readers.
- Implement `constants`, `math`, `time`, `world/terrain`, `world/surface`, `world/water`, `truck/params`, `truck/state`, `truck/controls`, `truck/drivetrain`, `world/course`, `world/checkpoints`.
- **Accept:** hand-computed formula tests pass; the terrain orientation (rows along z or along x) is settled by a stock test using SIT object rest heights; the portability test is green.

### M3: Track and truck rendering (OpenMTM2)
**Status: done** (developer track view; ramps without models wait for M5's ramp geometry).

- Copy and adapt the render-prep pieces and the `scene.js` methods listed above.
- `world-frame.js`: scene position = (2x, 1.5y, 16384 − 2z), rotation `S·M·S` with S = diag(1, 1, −1), models keep the 0.75 vertical stretch.
- `dev-track` screen.
- **Accept:**
  - All 15 SITs render, and the trucks match JSTruckViewer.
  - A Node test shows the terrain mesh triangle height equals the OpenPhotex sampler at 10k random points per track (< 1e-4 ft).

### M4: One truck driving, in the worker (OpenPhotex + OpenMTM2)
**Status: done.** The truck dynamics in OpenPhotex (`stepTruck`, `postStepTruck`, hull contacts, water drag, the stuck timer, reset and helicopter), the simulation worker with interpolation, keyboard and gamepad input (the game's analog joystick mode), the animated truck and the chase cameras (`dev-drive`). The reset and helicopter target the truck's course segment once M6 tracks it; until then they keep the heading and set the truck down in place. The helicopter model is drawn with the other effects (M12).

- OpenPhotex: tires, aero, contacts, forces, integrate, poststep, player reset, `session`, `snapshot`.
- OpenMTM2: sim worker and host, interpolation, keyboard and gamepad, truck object, Chase Near and Chase Far cameras, `dev-drive` screen.
- **Accept:** the invariant tests pass; on TPARK you can drive, jump, flip and reset, and the axles articulate; motion is smooth with interpolation; one truck costs < 2 ms per step.

### M5: Objects and collisions (OpenPhotex)
**Status: done** (every acceptance check passes). Ground boxes and level boxes are collision objects (physics 14.14, 14.15); immovable boxes are ground for hull points, wheels and tire contacts; pushable boxes move as rigid bodies with the inelastic force law and the box-corner-against-wheel test (14.16, 14.17), drawn where they end up; moving objects (type 10, such as TPARK's train) run on their `bvel` (14.18); ramp tops are ground (14.19; the stock game has ramps only on SNAKE and WAR, none with a model, and JUNK's bridges are ordinary boxes); truck against truck, hull points against hull boxes (14.20); box against box (14.21).

**Pending** (traced in part, written up as open in the physics doc):
- Ramp side walls (`0x4b2580`: the wheel test `0x4aa110` is read, its response `0x4b3540` and the edge test `0x4b17c0` are not). The edge test uses the edge-against-hull-box system (`0x494fb0`, `0x49b190` and its helpers) that top-crush cars use too, so both come together.
- Top-crush cars (section 7.6), on that same edge system; after M7 as planned.

- Broadphase, separating-axis tests, truck against box (immovable = ground, pushable = inelastic, wheel sweep), ground boxes, ramps, truck against truck, moving objects (type 10), free boxes.
- Top-crush and box-against-box may first act as immovable ground and get completed after M7.
- Confirm which SIT box types and flags are solid.
- **Accept:**
  - No tunnelling at 150 ft/s.
  - A truck parks on a box top at static sag.
  - Momentum is conserved when pushing a box.
  - A head-on hit between equal trucks ends with equal speeds.
  - Bridges and ground boxes carry the wheels on JUNK and TPARK.

### M6: Autopilot, recovery, race rules (OpenPhotex)
**Status: done.** The autopilot (physics 14.22, 14.23: following, steering, target speed, speed control, segment advance, rubber-banding) with the frame-time hypothesis (`AUTOPILOT_FRAME_DT`), traffic (14.25: pass targets, sides, passing, following speed, pulling alongside) with the time to the segment's end it ranks trucks by (14.24), course-aware recovery for CPU trucks, and the race rules (14.24: countdown, checkpoints with gate and detector, splits, laps, missed-checkpoint recovery, the finish, the race order). The session (`sim-worker.js`) runs any number of trucks with a race; headless 8-truck races finish on every stock Circuit track.

**Moved on:** the per-track default lap count and `fastSimulateRemaining` (0.25 s ticks, sub-steps of at most 0.1 s) are part of M7's race flow; Summit Rumble scoring (MONSTER_EXE_ANALYSIS.md 6.3), Rally specifics, the reversed course and GOLD mode come with those modes; the missed-checkpoint announcer with the sounds (M11).

### M7: First playable (OpenMTM2)
**Status: in progress.** Done: Start, Race select (all track types, the track's default laps or minutes, the chosen CPU trucks and weather), Garage, the game's choice of CPU trucks and its shuffled start grid, the loading screen (`ART\DATA480.RAW`), the race (every truck drawn, the 3 s countdown in Park with the start gantry's lamps, the compact game HUD, chase speedometer, tachometer and gear display, missed-checkpoint and final-lap messages, pause, the camera key), "Determining times for remaining trucks" and the Winner's Circle table, plus the game's Full Autopilot as a setting. The two black Winner's Circle panels are reserved for the future first- and second-place truck previews. A 1-lap Farm Road 29 race runs start to results in headless Chromium with no console errors. Left: the acceptance runs in Chrome, Firefox and Safari and the frame-rate check.

- **Flow:** Start → Race select (Circuit tracks, laps, difficulty) → Garage (truck pick) → Loading screen (`DATA%d.RAW`) → race → "Determining times…" → Results.
- **The race:** 3 s countdown with start lights; HUD with Place n/8, Lap n/n, time and best lap; pause; helicopter key.
- **CPU trucks:** names Mark, Greg, Rich, Brett, Gaither, Chuck, Terry, Joe; `defaultOpponents` random catalogue trucks (MONSTER_EXE_ANALYSIS.md 9).
- **From M6:** the track's default lap count; `fastSimulateRemaining` for the trucks still racing when the player finishes.
- **Accept:**
  - Farm Road 29, 3 laps, Intermediate, against 7 CPU trucks (7 opponents chosen), played start to finish in Chrome, Firefox and Safari.
  - Missing a checkpoint does not count the lap; flipped CPUs recover; the results order agrees with the sim.
  - No console errors and 60 fps on a mid-range laptop.

### M8: Rally and Summit Rumble (OpenMTM2)
**Status: in progress.** Done: Start offers Circuit Race, Rally Race and Summit Rumble; race select lists the mode's tracks (a Rumble's laps are minutes, default 5); Rally runs through the Circuit race code with one lap (every stock Rally track ends with CPU trucks only, headless); Summit scoring and the round timer (exe analysis 6.3, OpenPhotex `race/summit.ts`), the Rumble HUD (time, score, place) and a score table in Results. Left: a manual playthrough in the browser, and Rally specifics found on play. The reversed course and GOLD mode are debug cheats (exe analysis 15), not part of Rally or Rumble; they move to M9 with the options.

### Single-player completeness (before Multiplayer and CP3)

Each item is read from the executable into `docs/MONSTER_EXE_ANALYSIS.md` first, then built, with tests.

| # | Item | Status |
|---|---|---|
| 1 | Truck suspension parts as the game draws them: shocks (`SHOCK.RAW`), axle bars (`AXLEBAR.RAW`), the driveshaft, from the TRK's `shockTextureName`, `barTextureName`, `axlebarOffset`, `driveshaftPos` | done (exe analysis 10b) |
| 2 | The complete cockpit cabin: the cab model, its interior and the brake-light cab texture (`brlttcab.raw`), the side and rear panels and the view keys that turn the head | to do |
| 3 | Truck lights: the game's own lamp drawing never worked in play (the lamp code exists in the exe but nothing visible came of it), so this is **not original behaviour**; see the Additions section | moved to Additions |
| 4 | The recovery helicopter and pterodactyl models (`heli.bin`, `teryl.bin`), drawn for the CPU trucks' flight and for the player's | done (exe analysis 8.2b) |
| 5 | The blimp (`GOODY.BIN`): its flight along the course and its hum (`blimp2.wav`); the blimp commentary lines wait for the announcer | done (exe analysis 11) |
| 6 | A proper **BlimpCam** (0x52c280) | done |
| 7 | A proper **RaceCam** (0x52ba90) | done |
| 8 | The View keys that turn and zoom the chase camera, and the cockpit's side and rear views | in progress: Camera up and down (held, + and -) tilt the chase camera at the panel's rate within its pitches; the heading keys, the zoom keys and the cockpit's views are to do |
| 9 | The dust puffs the game spawns behind wheels on soft ground (`0x4de010`); the splash is done (M12); the sparks and tire tracks are Additions | done (exe analysis, Dust) |

Then the sound system fixes, and one UI for every MTM2 version (retail 2.00.42, Community Patch 1 and 2, then CP3).

### Additions (not in the original game)

Things the port adds on purpose. They are marked here so the original game's specification stays clear.

- **Truck lamps** (done): the TRK's lamps drawn with their lens glow and soft headlight beams, a lamp switch that starts on at Dusk, Night and Pitch Black, and the Headlights key (L). The exe has the lamp code (`docs/MONSTER_EXE_ANALYSIS.md` 11b) but it never showed in play.
- **Scrape sparks and tire tracks** (done): sparks where a hull point scrapes or hits, with dust on a hard hit, and treads on soft ground; Options switches Dust, Tire tracks and Sparks.
- **Names over the trucks** (done): the Names key (N) goes round off, the trucks' names, the drivers' names, on the course map and in labels above each truck in the world (the game has the driver names on the map only).
- **Cockpit G key** (done): in the cockpit view G goes round the cockpit, no cockpit with the gauges, no cockpit and no gauges.
- **Draw distance and track backdrops** (done): Options has a Draw distance slider (counted in terrain cells, see Options and menus below; it sets the camera's far plane, caps the fog and shrinks the sky dome to fit) and a Track backdrops switch, off by default.
- **POD.INI order and reload** (done): the track and truck lists keep the mount order (POD.INI's, then each archive's own), not the names'; lookups already took the first mounted file. Options, Data has Reload POD.INI: the folder is picked again (a browser keeps no handle on it), archives the file no longer lists are removed, new or changed ones copied, the rest kept.
- **Ground boxes smoothed** (done, not the game's): the game picks the face a wheel meets from a line through the truck's centre, trying a box's x faces, then y, then z, counting two crossings at most and taking the nearest with no direction test (`0x4a7fc0`, checked against the code), so on a floor of boxes a wheel is often resolved against a side: caught, or shoved sideways (up to 18 ft/s in one frame in a diagonal drive). The port's ground boxes (OpenPhotex `groundBoxesAround` `smoothFt`, `SimBox.openFaces`, `climbFt`) choose the face by where the wheel is: the top when the wheel is over the box and no more than 4 ft below it (so a step that high is climbed), else the nearest side that is not shared with a neighbouring box and that the wheel is just into (a wall). Level boxes (models) keep the game's test.
- **Computer trucks and the helicopter** (done, not the game's): a computer truck that misses a checkpoint or comes to rest is always fetched by the helicopter, on Professional too (the game sets it back on the course at once there), and one that stays within 12 ft for 6 s calls it, whatever its speed.
- **Colour key** (done): a cutout texel is cut when its palette colour is black at five bits a channel (below 8 in red, green and blue), as the game's 16-bit textures hold it: AZTEC.POD's fences key on (7, 7, 7).
- **Weather picture** (done): Foggy, Dense Fog, Snow and Pitch Black draw no sky, only the fog colour; Rain's fog is drawn at 0.6 of the code's colour; Pitch Black has almost no ambient light, so the headlights light the ground; in Snow the ice over water starts half formed and is full in 50 s.
- **Pause menu** (done): Resume, Restart race, Instant replay (the last minute, played over the paused race, Back returns to it), Options (the dialog; the sound sliders apply at once) and End race.
- **MTM1 tracks** (done, to be tested): a track read as MTM1 (OpenPhotex `detectSitOrigin`, JSTrackViewer's rule) says so in the Races list, draws its ground tiles without MTM2's two-pixel overlap, and gets its own flat sky (the level's sky art recoloured by its sky palette, a ceiling over the camera fading into the horizon colour, as JSTrackViewer's Classic sky). Options, Advanced switches both: MTM1 sky, MTM1 terrain overlap.
- **Races screen filter and after the race** (done, to be tested): a filter box above the track list; Winner's Circle's Continue goes to the Races screen; only computer trucks honk or whoop by themselves.
- **Small fixes** (done): an add-on track's preview is `UI\<stem>S.BMP` (then `UI\<stem>.BMP`); the Helicopter key works while the truck lies on its roof; a one-shot sound whose sample was still loading is dropped instead of playing late, and the common ones are loaded at the start; the Garage's transfer gear slider runs the other way.
- **Options and menus** (done): Options, Game has Sonic trucks (moved from Driver Check-in) and, at the bottom, Hall of Fame, Instant Replay (opens a `.rpl`) and Start screen; the draw distance is counted in terrain cells (32 ft each, 32 to 640, 128 the standard and the default); the start screen's title reads "OpenMTM2".
- **Options dialog** (done): the controls edit a draft; Apply uses it at once without storing it, Save uses and stores it, Close (and Escape, or a click outside) asks whether to save or discard when something changed. Game has the default number of computer opponents (0 to 7; choosing one drops the list picked on the Races screen, whose dialog has Remove all). The draw distance runs from 16 to 256 cells, 128 the default.
- **Loading report** (done): a track that cannot be loaded shows what failed, and Close goes back to the Races screen; files a track names that no archive has (models, model textures, ground textures) are listed with Race anyway beside Close. A SIT's level is the one it names (MTM1's HILLCLIM.SIT runs on ARTIC.LVL), not the one sharing its stem.
- **Replay list and impact sounds** (done): the replay's truck list names driver and truck; a hull impact must clear the recent peak (fading over 2 s), so the scraping after a crash does not repeat the SUSPEN knocks.
- **Monster Demo** (done): the start screen's button runs Farm Road 29 with eight computer trucks (the player's truck drives itself), the RaceCam moving to the next truck every 8 s, under the caption "Demo mode. Press any key to begin"; any key or click goes back to the start screen, and the demo starts again when its race ends.
- **Race teardown** (done): every cleanup of the race screen runs even when one fails, and what is set up after the screen was left is released at once (a skipped cleanup left the track's music and the simulation running under the menus). The draw distance follows the Options while racing. No sparks under water.
- **Water drops** (done): drops thrown up and out where a wheel runs through water, more and higher with speed, and a burst on entering it; Options switches Water splashes. Wheel dust is drawn 2.2 times the game's size and a collision's dark grey smoke 3.2 times.
- **Modern menus on the classic layout** (done): the modern skin lays every screen out as the classic one does on a plain 640 x 480 stage: the title, the labels the art would carry, the same panels, and the bottom bar drawn as real buttons (the current screen marked), plus a Back button on every screen but Start.
- **Version-aware menus** (done): the picked folder's `MONSTER.EXE` version is read (its FileVersion resource) and kept in the install manifest; only 2.00.41 and 2.00.42 get the classic menu art, any other build (CP3 among them) the modern menus. An install made before this was recorded is taken as retail.
- **Watermark** (done): "OpenMTM2 v0.5.2" in the game's font in the corner of every screen (`src/app/version.js`).
- **Camera shortcuts** (done): Ctrl or Alt with 1 to 9 and 0 pick the ten views (1 cockpit, 2 Chase Near, ...).
- **Helicopter rotors** (done): the model has none; a spinning main and tail rotor are added.
- **Instant helicopter** (done): the Helicopter key works at any time and at once; see the helicopter section of the exe analysis for how the original behaved.
- **Party modes** (done, to be tested): Hockey and Tag, chosen on the Races screen; see "Party modes" below.

#### Party modes: Hockey and Tag

Two games the original never had, on its tracks and with its trucks. The Races screen has a Mode list: Default (the track's own race, as before), Free Roam (the player alone, no checkpoints or laps), Fly-by (no truck, a camera to fly with), Hockey and Tag. A party mode has no checkpoints or laps. Fly-by goes straight to the track and skips the Garage. The countdown, the computer opponents, the Garage setup and the difficulty are the race's as always. The rules are pure functions (`src/game/hockey.js`, `src/game/tag.js`) that the simulation worker runs after the race tick; computer trucks drive with the Rumble driver's steering (`driveToPoint`, `src/game/rumble-ai.js`). The results are a Rumble's: place, then the score in the Points column and the game's length in the Time column. Party modes do not enter the Hall of Fame. The headset's race board (`VR.md`) starts the track's own race only, and the labels over the trucks are the flat screen's.

**Hockey** is played on Breakneck Ridge (`ROCKQRY.SIT`) in Snow, both locked while the mode is chosen, and offered only when the install has that track with its rink. The length box reads Goals: the first team to that many wins (1 to 99, 3 by default).

- *The rink is read from the level.* Breakneck Ridge's frozen lake holds the puck (`HPUCK.BIN`, type 0, mass 93.24 slugs, a 24 x 8 x 24 ft box) and two goal frames (`HPOST3.BIN`, type 7, which never collide), each with two invisible 4 x 4 x 20 ft posts (type 0, no model) at its mouth. The goals are the two `HPOST3.BIN` boxes, the posts the modelless boxes within 45 ft of each. The rink's long axis runs from one goal to the other; a goal's mouth is the span between the inner faces of its posts, and its top the frame's top. The ice is the level's water level; the rink reaches, from the midpoint of the two goals, along each of the two axes until the ground (without Snow's ice) rises to the water level.
- *Boards* (not in the level): walls 8 ft high and 2 ft thick standing on the ice, 8 ft inside the shore, with each corner cut at 45 degrees as far as needed (20 to 120 ft) for the cut's midpoint to be on the ice. They are drawn and they are solid for trucks and the puck alike. A truck more than 4 ft outside them (the cut corners counted square) for 2 s, which a pile-up can throw over them, is put back at its face-off spot.
- *The puck starts on the ice.* In the level it lies at 22 ft, below the 28.5 ft ice, and so is hidden until something knocks it up through. Hockey puts it at the rink's centre, its bottom 0.3 ft over the ice, and sends that pose to the screen before the first frame.
- *Rink grip.* On the game's ice (ground type 8, μ 0.2, shallow-cut tire factor 0.6, Snow's 0.6, the grip factor 1.75) a truck has about 0.13 of its load as grip, 2 ft/s² from rest, under the simulation's at-rest clamp (a truck slower than 0.1 ft/s after a step is stopped, 6 ft/s² at 1/60 s), so a truck standing on the frozen lake can never move off. In Hockey the trucks (not the puck) take the frozen water as gravel (type 7, μ 0.6, cut factor 0.8): about 0.5 of the load, 30 ft/s after 3.5 s of throttle, and slides. The puck keeps the game's ice. Sounds and wheel effects still see ice.
- *Teams.* The player's team is red or blue at random; the computer trucks then alternate, the other team first, so the teams differ by one truck at most. Red defends the goal nearer the rink's low-x end. Each truck has its driver's name over it in its team's colour, whatever the Names key shows, and the two goal frames are tinted red and blue (their texture made grey first, from half to full brightness, so the colour shows over its own red and blue stripes). The replay draws the boards and the tints again.
- *Face-off.* The trucks stand on their own half, facing the other goal, at (along, across) 40 ft and 28 ft, 40 ft and -28 ft, 95 ft and 55 ft, 95 ft and -55 ft from the centre for a team's first four trucks. At the start the race's 3 s countdown holds them there.
- *A goal* is the whole puck over the goal line (its centre past the line by the puck's half width) going out of the rink, between the posts and under the frame's top. The scoring team is the one attacking that goal; the truck that touched the puck last is credited with the goal when it is on that team (an own goal counts for the team only). The screen says who scored and the score, play goes on for 2.5 s with no further goal counted, then every truck and the puck go back to the face-off and are held for 3 s. A puck that leaves the rink (its centre 20 ft past the boards, 6 ft under the ice or 200 ft over it) is faced off again with no goal.
- *The end.* The goal that brings a team to the target ends the game after the 2.5 s. Places go by the team's score, then each truck's goals, then the entry order.
- *Unsticking* (the port's, on the rink only): with three or more hull points touching, the simulation stops a truck slower than 0.5 ft/s after a step, so one nosed into a board (or a truck) stays there whatever its throttle, and the helicopter would only set it down in place. A truck held still (under 0.05 ft/s) with the throttle over half for 0.5 s, in a gear that drives, is given 0.6 ft/s along its body the way the gear drives, each step until it moves.
- *Computer trucks.* Each team's truck nearest the puck attacks (the player's too, whose computer teammates then play round it); it stays the attacker until a teammate is 25 ft nearer. In a team of three or more the last computer truck defends: it waits 60 ft in front of its own goal while the puck is in the other half. The rest are wings, on alternate sides, waiting 70 ft behind the puck and 55 ft to its side on its line to the goal they attack. The attacker heads for a point behind the puck on that line, the puck's half width plus 14 ft back and 40 ft more per unit the cosine of its line to the puck falls short of 1; from the wrong side (the cosine below 0) the point is moved 36 ft to the side the truck is on. Once that cosine is above 0.85 and the truck faces the puck (cosine above 0.8; held down to 0.6 and 0.5) it carries the puck on its nose at 40 ft/s, aiming 10 ft past the goal's mouth: faster, the box-shaped puck flies off a face, wide. They never back up to a target, and keep at least 0.12 of their speed in a sharp turn (not the Rumble's 0.35: on ice a fast truck slides wide). Every truck is recovered as the player's is: set upright when it lies on its roof, never lifted for being slow.

**Tag** is played on any track in any weather it allows. The length box reads Minutes (1 to 99, 5 by default); the game ends when they have run out, counted from the end of the countdown, like a Rumble's round.

- *It* is one truck, picked at random from all of them at the start, and held in Park where it stands for 5 s after the countdown while the others get away (the others can still shove it). A hull touch with another truck (the pair test changed the trucks' forces) makes that truck It, with no hold after the tag; the new It may not tag back the truck that made it It for 10 s (the port's guards against tag-backs). The screen says who is It.
- *Score* starts equal for every truck (100 points). Once the opening 5 s hold is over, each whole second every free truck gains 1 point and It loses 1 point. A tag moves points from the truck tagged to the one that tagged it (at most what the victim has left): at least 8, up to 28 when the victim is in the lead, scaled by shared place among the field so tied trucks are worth the same. Places go by the most points; ties go by entry order. The HUD lists every driver with their score, the leader first, like a Rumble's, and tracks time as It. The Points column in Results shows the total.
- *Indicators.* An orange arrow hangs above the It truck, turned to face the camera, drawn in the world, so a wall or the ground between it and the camera hides it. It is hidden from inside that truck's own cab. The trucks' names follow the Names key.
- *Computer trucks.* It drives at a truck it may tag that is not on the helicopter, nearer first but with a bias toward those higher in the standings (55 ft divided by shared place), aiming ahead of it by the distance over 80 ft/s (at most 1.5 s). A ramp that faces that truck and lies on the way is taken as a launch when the truck is still 140 ft or more off. A solid object on the straight line (one that reaches 8 ft and stands 8 ft, not a checkpoint, a goal or a billboard) is gone around, 40 ft wide of it, and a quarry 14 ft or more above It is approached a step up the slope. With nobody to tag, It wanders like the others. The others do not drive the course. While It is more than 180 ft away, about 62% of their aims are a random point on the ground around the course (the course's extent plus 700 ft, or 1400 ft around the start grid where the course covers no ground), kept out of the water when another point is dry; about 30% head for high ground, a ridge, or the far side of an object within 520 ft (or a ramp pointing away from It); the rest run directly away. While It is closer, none wander: about 55% hide and the rest run. An aim is kept for 4 to 8 s, or until the truck arrives. They call the helicopter when they make no headway (12 ft in 6 s), except It while it is held. Every one of them drives at a point and is recovered as the player's is.

### Next features (planned)

Six features, in priority order. OpenPhotex already reads every file involved (CPR `.TRK`/`.TTX`, Evo SIT v6/v7, LVL, TEX, VEG, SMF, TIFF, AI lines, POD2), so none needs new format work or the Evo executables. The physics stays MTM2's: MTM2 trucks race on the other games' tracks.

| # | Feature | Status |
|---|---|---|
| F1 | Smooth shading on trucks and BIN models | built, to be tested |
| F2 | Content: Add game folder, POD manager | built, to be tested |
| F3 | CART Precision Racing tracks | built, to be tested |
| F4 | 4x4 Evolution 1 and 2 tracks, Free roam | built, to be tested |
| F5 | Z-mode cameras | built, to be tested (Z mode not traced in the exe) |
| F6 | In-game console | built, to be tested |

#### F1: smooth shading on trucks and BIN models

`worker/models.js` gives every triangle its face normal, so with the sun shadows on the low-poly bodies look faceted. JSTruckViewer's `bin-decoder.js` has the fix (`smoothBucketNormals`); JSTrackViewer has none.

- New pure module `src/shared/smooth-normals.js`, from JSTruckViewer: each corner takes the area-weighted average of the faces meeting at its position, across every texture group of the model (a texture seam is not a shading seam), leaving out faces bent more than 60 degrees from its own (bumpers, wheel wells and the cab keep their edges; a two-sided face's back copy drops out by the same test).
- `decodeModel` calls it last. Animated BIN frames are decoded by the same function, so their morph normals are smoothed too.
- Crash damage: `dent()` and `repair()` in `render/truck-object.js` call `computeVertexNormals()`, which is flat on these unindexed meshes. `dent()` runs the smoother over the body again; `repair()` puts the saved normals back.
- The classic look keeps the faceted shading (`flatShading` on its model materials); the enhanced look uses the smooth normals.
- **Tests:** a cube keeps hard edges; a low-poly cylinder's side normals come out radial; two texture groups sharing an edge shade continuously; a dented body has no flat normals.

#### F2: content from any game (Add game folder, POD manager)

A player may own a whole install or only a few PODs, so both ways in are offered, in Options, Data.

- **Add game folder:** a button with a line of text saying that OpenMTM2 reads MTM2, CART Precision Racing and 4x4 Evolution 1 and 2 tracks, and their vehicles in the future. The folder is picked as the MTM2 install is; its `POD.INI` is read and every archive it lists is copied and mounted. CPR and Evo installs carry a `POD.INI` as MTM2 does, so a folder without one is refused with a pointer to the POD manager.
- **POD manager:** a dialog listing every mounted archive in mount order: name, the game it was detected as, where it came from (the MTM2 install, an added folder, added by hand), format (POD1, POD2, EPD), entry and track counts, size. Add PODs (a file picker, several at once, from any game, no install needed), Remove, and Move up and down, since the order decides the first match.
- **Mount groups without the player seeing them:** every archive is tagged with its game from what it holds (POD2 and the SIT version for Evo, `detectSitOrigin` for CPR and MTM). A track's files are looked up in its own archive first, then in the archives of the same game, then in the rest. This keeps Evo's `STARTUP.POD` and `TRUCK.POD` and CPR's art names from shadowing MTM2's, whatever the order.
- The install manifest records the added folders and archives; Reload POD.INI and Clear browser game data cover them too.
- **Tests:** VFS lookups with same-named files in two games' archives; add, remove and reorder; a POD2 archive mounts and lists its SIT.

#### After the play tests (built, to be tested)

- **The caption bar** breaks a long message into lines, keeps the game's proportions on any window (it was stretched to the window's width) and holds a message long enough to read: 1.5 s, and a second more for every 16 letters past 24.
- **`distance <16-256>`** in the console, in a race and in a fly-by: the draw distance in terrain cells, as Options has it.
- **The clear-weather haze** starts at 15% of the draw distance (1200 ft at most) and ends at 97% of it, where it started at 35% and ended at 90%: the far ground fades in over a longer stretch. The weathers' own fogs are the game's and are unchanged.

#### Shared groundwork for F3 and F4

OpenPhotex:
- The terrain takes float heights in feet (CPR 16-bit at 1/64 step, Evo 16-bit at 1/32); MTM2 stays byte-exact.
- A triangle-mesh ground layer (height, normal and surface at a point, bucketed in a grid) laid over the terrain: the CPR road, and Evo models a truck drives on.
- A course per truck: the session takes several built courses and each truck's index, where it now takes course 1 and course 2.
- Checkpoints from CPR and Evo boxes. A gate's stored heading is authored either way round on these tracks, so each gate is turned to face along the course at load time (the port's rule).
- No checkpoint limit: the 20 per lap is the original executable's split table. The race keeps splits in a list; the HUD, replay, results and Hall of Fame are audited for the assumption, with a synthetic 30-checkpoint test.

OpenMTM2:
- The catalog gains `game` (MTM2, MTM1, CPR, EVO1, EVO2) and a type label: MTM2's read as today, the others `<type> (<game>)`, for example `Oval (CPR)` and `Rally (EVO2)`.
- `track-build.js` hands a CPR or Evo track to its own builder; both return the render and sim shapes of today, so the race screen, HUD, map, replay and results need nothing per game.
- Eight trucks at most: the first eight slots of the SIT's vehicle list (Evo has eight; Laguna has 37).
- Weather: the SIT's mask where it has one (Evo). A CPR track has none: it takes MTM2's sky and every MTM2 weather.

#### F3: CART Precision Racing tracks

Source: JSTrackViewer's `docs/cpr-racetrack-layer-implementation-guide.md` and `CPR_TRACK_LAYER_ANALYSIS.md`, OpenPhotex `docs/LEVELS.md`.

- **Type label:** Road, Oval (Speedway), Short Oval, Street, each followed by `(CPR)`; all run under the Circuit rules.
- **Terrain:** 16-bit heights, the checkerboard split, no LTE shading.
- **Road layer:** one mesh builder in OpenPhotex from the `.TRK` records (the closing segment included, only the slots between the outer walls) feeds the renderer and the sim's ground layer.
- **Walls:** each wall segment is a thin immovable box in the existing truck-against-box collision, as tall as its stack of panels. Catch fence art comes from CPR's own archives.
- **Surfaces:** the `.TTX` types (Road, Curb, Grass, Dirt, Rocks) mapped onto MTM2's surface types, with MTM2's grip (the port's mapping).
- **Courses:** a CPR SIT has five. The three racing lines (AI line 1 to 3) are shared out among the computer trucks; Pit road and Pit row are not used.
- **No pit lanes:** the three pit checkpoints are skipped, a lap is start/finish and the ordinary gates, and nothing of pit stops, fuel or pace laps is carried.
- **Scenery:** all four backdrop models; BIN objects through the existing model path.
- **Trees** (box type 3) are cards that face the camera and are passed through, as in JSTrackViewer. Objects standing on or over the road layer (walkways, gantries) are not solid either.
- **Road over ground:** the terrain is drawn behind everything inside the road's footprint (a mask of the road seen from above), so the ground never shows through a banked or cut road. Road textures are read by their own palettes.
- **Accept:** a headless race of eight trucks finishes on every stock CPR track at hand; Laguna played in the browser.
- **Risk:** the MTM2 autopilot on banked ovals may need a speed cap per segment.

#### F4: 4x4 Evolution 1 and 2 tracks, and Free roam

Source: JSTrackViewer's `docs/4X4_EVO_TRACK_RENDERING_ANALYSIS.md`, OpenPhotex `docs/EVO.md`; `~/dev/4x4e` and `~/dev/4x4e2` when a fact is missing.

- **Type label:** Circuit, Rally or Mission, followed by `(EVO1)` or `(EVO2)`.
- **Terrain:** heights, the `.TEX` tile table, water at half the LVL's value.
- **Models:** an SMF adapter giving the mesh shape `decodeModel` gives, with RAW + ACT + OPA and TIFF art; the VEG trees of Evo 2, instanced.
- **Collision**, as the SIT says: Evo 2's `collisionType` 1 (every stock rock and coral, nothing else) is driven on by the model's own surface; `collisionType` 0 is an upright box around the model; a model-less `CCollisionBox` is a deck when low and an obstacle when tall; other classes are passed through. Evo 1 keeps MTM's box types: trees (type 12) are passed through and their model-less child boxes are trunks. A surface counts as ground only when it is under the truck asking (OpenPhotex `createRoadGround().below`), so MTM2's physics are untouched. A boxed object the course runs through is not solid. **To do:** the steep sides of rocks stop nothing; Evo 1's own box sizes are not read.
- **Moving objects** (Evo 1's type 10, The Hill's semis) run as MTM2's do, and what is attached to one (`parent`, a semi's load) goes with it.
- **Wraps like MTM2:** the world is repeated around itself. Measured on the stock heightfields, the step across the seam is no larger than between ordinary neighbouring corners on Baja Beach (zero), Tri Baja 250, Pikes Peak and Truck Stop 101; Aspen alone does not meet (a median 40 ft step).
- **Race:** type 2 under the Circuit rules, type 3 under the Rally rules, with every `CCheckpoint` in file order, however many. Computer trucks follow the SIT course, cut to the real lap by the recorded AI lines (`lapRuns`).
- **Surfaces:** Evo has no known surface table: the ground is Dirt and anything under the water level is water (the port's default).
- **Sky:** MTM2's sky and weathers, as on a CPR track. A one-way rally (Pikes Peak) draws its course map with two ends.
- **Free roam:** a checkbox with its label on the Races screen, in the font of Weather and Laps. A free roam session has no checkpoints, laps, places or results; the clock runs and the pause menu ends it. The player drives alone: no computer trucks, and the Computer Opponents choice is disabled while the box is ticked. It is offered on every track.
- **Mission tracks** (El Norte, Obs Park) are listed like the others. They have no checkpoints, so they always load as free roam (the box ticked and locked). How the game plays a mission is not known; that is left open.
- **Accept:** a headless race of eight trucks finishes on ASPEN, THEHILL, TRIBAJA, BAJBEACH and PEAK; ELNORTE and OBSPARK load in free roam, with the player's truck only.
- **To do later:** the `.SDW` shadow overlay and the small vegetation (neither is in JSTrackViewer), the `.RTD` grid, `.WAT` water animation, Evo trucks, standalone `.LTE` tracks.
- **Risk:** bridges and tunnels that need more of a model than a flat deck.

#### F5: Z-mode cameras

Reported by RuDeE: in the game Z mode stays on after Ctrl+Y is pressed again, so one drives with its cameras and zoom; in the port leaving slew mode turns Z mode off and puts the zoom back to 1 (`ui/gold-mode.js`).

- **Built from the community key list and RuDeE's report, not from a trace:** Z mode outlives slew mode; - and + zoom (0.5x to 16x); Insert and Delete orbit; Ctrl+L (Alt+L in a browser) loads a SIT by name; Ctrl+4 and Ctrl+5 were already BlimpCam and RaceCam. The option adds the same keys to any race, and the Inertia view after the ten (Chase Near under 15 ft/s, Chase Far at 75, half as far again at 140). **Still to do, the facts:** `MONSTER_EXE_ANALYSIS.md` 15 marks Z mode as not yet traced. Read it from `re/` into the doc: what Z mode keeps when slew ends, the zoom steps and limits, the overlay's fields, Ctrl+4 and Ctrl+5, Ctrl+L, the orbit keys, and whatever else it holds.
- **As the game does it:** Z mode outlives slew mode; the zoom (0.5x to 16x), BlimpCam, RaceCam, the orbit and the overlay all work while driving; Ctrl+L loads a SIT by name (shared with F6's track command).
- **Additions:** Options, Game has a **Z-mode cameras** switch. With it on, the zoom keys (- and +) and the Z-mode cameras work in any race without GOLD mode or slew mode. A new **Inertia** view joins the view cycle: the chase camera's distance follows the speed, Chase Near when slow, beyond Chase Far when fast, eased.
- **Tests:** Z mode and the zoom survive leaving slew; the zoom's steps and limits; the Inertia distance as a function of speed.

#### F6: in-game console (lowest priority)

A drop-down console as in Quake III or Unreal Tournament, opened with the backquote key, with a history and name completion. Each command calls what the menus and GOLD mode already call:

| Command | Does |
|---|---|
| `addbot [truck]`, `kickbot [name]` | adds or removes a computer opponent (the race starts again) |
| `laps <n>` | sets the race's laps, from now on |
| `finish` | ends the race now (the fast simulation settles the rest) |
| `map <sit>` | loads a SIT by name or title (Ctrl+L's path) |
| `weather <name>` | changes the weather |
| `skill <level>` | the opponents' difficulty: rookie, intermediate, professional, sonic (the race starts again) |
| `truck <name>` | changes the player's truck (the race starts again) |
| `freeroam <0\|1>`, `restart`, `quit`, `clear`, `help` | free roam; the race again; the Races screen; the console emptied; the command list |

The simulation cannot take a truck in or out of a running race, so what changes who races starts the race again.

### Drag weekends

**Built, to be tested.** A drag event around the pass: qualifying, a bracket for 2 to 16 drivers with byes, a winner, by Community Patch 3's rules (MONSTER_EXE_ANALYSIS.md 6.4, "The drag weekend"). The rules come from the CP3 author's written description (`drag_racing_cp3.md` on mtm2.com); he provided no source code. On a drag strip the Races screen has a Drag weekend button (Resume while one is in progress).

| Piece | Where |
|---|---|
| The pass | `src/game/drag-race.js` |
| The event's rules: qualifying, the bracket and byes, the lanes, settling, simulating, the launch layer and personalities, the final order. Pure; it runs no races and is given its field and strip | `src/game/events/drag-event.js` (`src/game/events/` is also where a tournament's rules would go) |
| The host: picks the field, sets up each pass, hands its results to the event | `src/app/drag-weekend.js` (`context.dragWeekend`) |
| A pass for the event | `src/ui/screens/race.js`, the `drag` race parameter: who is in which lane, each computer driver's launch and stage depth, two computer trucks to watch; the results go back to the weekend |
| The screen: qualifying, the bracket with Race or Watch, Simulate, Run all others and Cancel, the win odds, the order | `src/ui/screens/drag-event.js`, on the plain stage in both skins |

**Not done**

- **Persistence:** the weekend lives for the session. The event's state is plain data, so storing it in OPFS beside the profiles is what is left.
- **Records:** a weekend adds nothing to the Hall of Fame or the driver's race counts.
- **Confidence** across rounds and seasons, the **split screen** for a watched pairing, and the one cut scene at the end of the weekend.
- **Tournaments:** planned as Stage 2 below (2.2). The event keeps its interface (a field in, an order out), so a tournament becomes its host in place of `drag-weekend.js`. MTM1's own drag event rules (points, no byes) are in `MTM1_MONSTER_EXE_ANALYSIS.md` 5.7.

### Stages 1 to 4: Races screen and fly-by, MTM1, more games, the wrapping world

**In progress** (Stage 1 built, to be tested). Three stages, each shippable on its own; Stage 4 (a world that truly wraps) follows them below. Stage 2 rests on the MTM1 decompile
(`docs/MTM1_MONSTER_EXE_ANALYSIS.md`). A fact missing from the docs is read from `re/` and written into the docs
first; nothing is built on a guess, and where a trace finds nothing the docs say so.

Order: 1.1, 1.3, 1.2 (a trace comes before 1.2); 2.1, 2.5, 2.4, 2.2, 2.3 (a trace comes before 2.3); 3.1, 3.2.

### Stage 1: UI, bug, fly-by

#### 1.1 Races screen (`src/ui/screens/race-select.js`, `styles/screens.css`)

**Built, to be tested.**

- **Sticky headings.** The `Track Name` / `Track Type` header row stays visible while the list
  scrolls: `position: sticky; top: 0` on the `thead th` of `.race-track-table`, with an opaque
  background. The `thead` is only added today when the classic art is absent (line 191); where
  the art carries the headings nothing changes. The filter box stays outside the scroll area.
- **Selection label** above the filter: `Selected track: <name> - <type label>`, using the
  existing `typeLabel(item)` (so "Laguna Seca - Road (CPR)"). Updated in `chooseTrack`.
- **Type 0 is free roam.** In `src/worker/catalog.js` an MTM SIT with `trackTypeCode === 0`
  gets `raceType: "freeroam"`, `freeRoamOnly: true` and the type label "Free roam" (today it is
  "unsupported" and Race is disabled). `SUPPORTED` in `race-select.js` gains it. The existing
  `showFreeRoam()` already ticks and locks the box for `freeRoamOnly`; add a disabled *look* for
  the Laps box and its label (a `.disabled` class, greyed), since `laps.disabled` alone is not
  visible on the classic art. `menu-data.js` `RACE_TYPE_NAMES` gains the name.
  OpenPhotex: `sitTrackTypeName` returns "Free roam" for 0 on MTM SITs (check; add if missing).
- Tests: `tests/vfs-catalog.test.mjs` (a type 0 SIT is listed as free roam only), `menu-data`.

#### 1.2 Animated BINs: do what the game does

**Built, to be tested.** Traced and written up (`MONSTER_EXE_ANALYSIS.md`, "Animated models"): the frames loop on the frame clock, each for the time the control file gives, joined by a Catmull-Rom spline through four frames. OpenPhotex reads the frame time (`frameSeconds`). The texture cycle's rate is not traced and stays at 15 a second.

Today (`src/worker/keyframes.js`, `updateTrackWorld` in `src/render/track-scene.js`): the frames
are morph targets blended linearly in a loop at a guessed **0.5 s per frame**.

1. **Trace** `engine/Animate.c` / `Keyframe.c` / `Boss.c` in MTM2 (`0x42d360`-`0x432100`,
   `tools/re/fn.py`, `cg.py`): what advances the frame (frame time, race clock or real time),
   the rate, whether frames are interpolated or stepped, loop or ping-pong, per-object phase,
   what the header's other words mean (OpenPhotex `readAnimated` reads only the count and
   names), and how `MRGL_KEYFRAME` / `KEYFRAME64` records differ from the control-file BIN.
   Cross-check with the pterodactyl (`TERYL.BIN`, analysis section 8.2b) and top-crush cars.
2. **Write it** into `docs/MONSTER_EXE_ANALYSIS.md` (a new "Animated models" subsection) and, for
   the file fields, OpenPhotex `docs/BIN.md` + `src/model/bin.ts`.
3. **Implement** in `keyframes.js` (data: rate, mode) and `updateTrackWorld` (playback).
   `TEXTURECYCLE` (currently 15 fps) is checked in the same pass.
4. Tests: `tests/keyframes.test.mjs` extended with the traced timing.

#### 1.3 Fly-by mode (new)

**Built, to be tested**, as its own screen (`src/ui/screens/fly-by.js`, route `fly-by`) and not as a parameter of the race screen: it shares the track build, the scene, the weather, the world's sound and the console with the race, and nothing of the trucks. The camera is `src/game/fly-camera.js`, the keys `src/game/input/fly-controls.js`. C goes round the control schemes while flying.

**Key tables** (Hellbender's as the user gave it):

| | Traxx (JSTrackViewer) | Terminal Velocity | Hellbender |
|---|---|---|---|
| Arrow Up, Down | forward, back (level) | nose down, nose up | nose down, nose up |
| Arrow Left, Right | turn | turn (banking) | turn (banking) |
| A, Z | climb, sink | throttle up, down | Z: slower |
| X | | | faster |
| F | | | turbo thrust (2.5 times the speed while held; the factor is the port's) |
| Page Up, Page Down | tilt up, down | Page Up: roll right | |
| Home | | roll left | |
| Mouse drag, wheel | look, zoom | | |

After the first play test: the Traxx scheme keeps JSTrackViewer's keys but not its rates, which cross a track in five seconds (300 ft/s along the ground, 150 up and down, 55 and 40 degrees a second); the craft banks 25 degrees into a turn and leans and levels at 25 degrees a second.

After the second: the sky dome rises with the camera once it is 200 ft up, so it is never flown into; the water is animated and rises and falls as in a race, and the level's moving objects run (`src/game/level-movers.js` steps them with the simulation's own routine, there being no simulation worker here); the console has `distance`.

The Terminal Velocity column is the flight engine's own default layout, read from the bindings MTM1's executable still carries (`leftKey`, `rightKey`, `upKey`, `downKey`, `throttleUpKey`, `throttleDownKey`, `rollLeftKey`, `rollRightKey`: the scan codes of the arrows, A, Z, Home and Page Up). The craft's speed (600 ft/s at full throttle) and rates are the port's.

A camera-only visit of the selected track: no truck, no simulation step, no HUD but a small
caption.

- **Races screen:** a `Fly-by` button on the row of Laps / Weather / Free roam, at the right
  edge, in the same type size (`.race-length-label` metrics). It works on every track.
- **Race screen** (`src/ui/screens/race.js`): a `flyBy` race parameter. It reuses the track
  load and scene, skips the sim worker session, trucks, opponents, audio of trucks, results.
  Escape opens the pause menu (Resume, Options, End).
- **Camera:** new `src/game/fly-camera.js` (pure: position, yaw, pitch, roll, speed; `update(dt,
  input)`), driven by one of three control schemes in `src/game/input/fly-controls.js`:
  - **Traxx**: JSTrackViewer's `src/nav.js` (`TrackCamera`): arrows move and turn, A/Z up and
    down, mouse drag to look, wheel to zoom, PageUp/PageDown pitch. Port its numbers.
  - **Terminal Velocity** and **Hellbender**: flight controls (pitch, yaw/roll, throttle up and
    down, afterburner). The key tables are taken from the games' own default bindings (their
    manuals/README; the MTM1 INI still lists TV's action names: `leftKey`, `upKey`,
    `throttleUpKey`, `rollLeftKey`...). The two tables are written into `docs/PLAN.md` for the
    user to confirm before they are coded.
  - The camera stays above the ground (`terrain height + margin`) using the track's height data.
- **Choosing the scheme:** Options, Controls gets "Fly-by controls" (setting `flyControls`:
  `traxx` | `tv` | `hb`, in `src/app/settings.js`); in fly-by a key cycles it and the caption
  names it; console command `flycontrols <traxx|tv|hb>`.
- **Console in fly-by:** only `map`, `weather`, `flycontrols`, `backdrop`, `overlap`, `music`,
  `sound`, `quit`, `help`, `clear` are registered; the rest are absent (not listed by `help`).
  Done where `race.js` builds the command table (line ~915).
- Tests: `fly-camera` (each scheme's motion, the ground clamp), `settings`, command list in fly-by.

### Stage 2: MTM1

#### 2.1 OpenPhotex groundwork

**Built** (the simulation's rules switch waits for 2.3): `logoBmp`, `mapBmp`, `descriptionTxt`, `announcerWav` and `dragParTime` on `parseMtmSit`, track type 0 named, `parseTrn` and `writeTrn` (`src/mtm/trn.ts`, `openphotex read` knows `.TRN`), documented in OpenPhotex `docs/MTM2_FILES.md`.

- `parseMtmSit` (`src/mtm/sit.ts`): expose `logoBmp` ("Track Logo .BMP file"), `mapBmp`
  ("Track Map .BMP file"), `descriptionTxt`, `announcerWav`, and `dragParTime` (the fly-by line
  as a number when it parses as one; `flyBy` and `sonicTrack` exist already).
- **TRN** (`src/mtm/trn.ts`, new): `parseTrn` / `writeTrn` for the labelled-line format
  (analysis 6.1: name, description file, has-drag flag, track count, `file,laps` entries),
  round-trip tested against the three stock files in `STARTUP.POD`. CLI `read` picks it up;
  `docs/MTM2_FILES.md` (or a new `MTM1_FILES.md`) documents it.
- **Sim rules switch** (`src/sim/mtm2/`): a `rules` option on the session, `"mtm2"` (default,
  byte-identical to today) or `"mtm1"`. See 2.3.

#### 2.2 Tournaments

**Built, to be tested:** the rules (`src/game/events/tournament.js`), the host (`src/app/tournament.js`, the run stored with the player's data so a reload keeps it), the screen with its editor, Open .TRN and Save as .TRN (`src/ui/screens/tournament.js`), the Tournament button beside Options on the Races screen (the Drag weekend button moved left of it), the Winner's Circle's Continue going back to the tournament, and the console's `tourney`, `tourney next`, `tourney prev` and `tourney goto <n>`. A drag event is a drag weekend of the tournament's drivers, scored by MTM1's drag points (`dragEventPoints`).

**Also built since:** laps led (the simulation counts the laps each truck closes in first place, the game's `bonusLaps`, and `race-points.js` gives `floor(100 / laps)` for each, or 100 for leading them all), and the Hall of Fame's tournament category (a finished tournament enters the player's total once; the Hall lists each tournament's board after the tracks).

**Not done:**
- **The drag event's own rules** are still CP3's weekend (byes, launch layer) whatever the physics; MTM1's event (2, 4 or 8 entrants, no byes, par-time computer runs from the SIT, its pairing) is not built. Its points are (`dragEventPoints`).
- **The player's own descriptions** are kept with the tournament, not as a separate text file; a saved `.TRN` names no description file.

- **Rules, pure:** `src/game/events/tournament.js` beside `drag-event.js`: a list of events
  (track, laps), the same field for all, per-event points, totals and final order
  (analysis 6.3, 6.4). Circuit/rally points reuse `src/game/race-points.js` (fix it to count
  **laps led**, analysis 8, with its test). A drag event inside a tournament runs
  `drag-event.js` with MTM1's event rules (2.3) and its points.
- **Host:** `src/app/tournament.js` (as `drag-weekend.js`): walks the events, starts each race
  through the normal flow, takes results back. State is plain data; persisted in OPFS
  (`userdata/tournament.json`) so it survives a reload, which also gives the drag weekend the
  persistence it lacks.
- **Screens:** a **Tournament** button on the Races screen next to Options (the same slot
  pattern as the Drag weekend button; "Resume tournament" while one runs).
  `src/ui/screens/tournament.js`: pick a tournament, see its events and description, Race;
  between events the standings; at the end "POINTS TOTALS". An **editor** (name, description,
  add/remove/reorder events, laps per circuit, New/Delete/Save) with **Open** and **Save as
  .TRN** (file pickers) plus the player's own kept in OPFS `userdata/tourney/`. Stock ones come
  from the mounted `TOURNEY\*.TRN` and cannot be deleted. Limits as the game: 16 tournaments,
  16 events, laps 1 to 20.
- **Eligibility:** a track is offered to the editor only if it has a race (`!freeRoamOnly`);
  a `.TRN` naming a missing or free-roam track loads with that event flagged and Race disabled.
  A tournament with a drag event needs 2, 4 or 8 trucks.
- **Console:** `tourney` (status), `tourney next` / `tourney prev` / `tourney goto <n>` move
  between events (the skipped event scores nothing), completing over event names.
- Hall of Fame gains the tournament category (`src/game/hall-of-fame.js`).
- Tests: tournament rules (totals, order, drag flag, limits), TRN round trip, host flow.

#### 2.3 MTM1 physics option

**Built, to be tested.** The trace is done and written into `MTM1_MONSTER_EXE_ANALYSIS.md` 4.3. It found **one** cause for the harder hits, in the wheel-against-wheel response (MTM1 `0x467fd0`, MTM2 `0x491e20`): MTM1 makes the force from the whole relative velocity where MTM2 takes half (so a mover that touches a slow truck's tire is hit twice as hard), and its spinning-tire climb is 0.1 for both tires always where MTM2's is 0.05 for tires on the ground. Hull against hull, truck against box, top crush, the hull on the ground and the scrape points are the same code in both games. Nothing was invented: the option holds those two and the four known before (water drag 1.0, no deep water, no weather grip, no crash damage).

- OpenPhotex: `Mtm2Rules`, `MTM2_RULES`, `MTM1_RULES`, `simRules(id)` (`src/sim/mtm2/constants.ts`); a ground carries its rules, `collideTrucks` takes them; MTM2's are the default everywhere (`test/sim-mtm2-rules.test.ts`).
- OpenMTM2: `PHYSICS_MODELS` in `src/app/settings.js` (a list: a later model is one more entry), the **Physics** list on the Game tab of Options, the console's `physics <id>` (restarts the race), the setting `physics`.
- Drag pass under MTM1 physics (`createDrag(..., "mtm1")`): no backing-up rule, the Disqualify lamp for a red light only, the computer launching on the green.

**Not done, and why:**
- The 1996 pass breaks the beams with the hull points and judges the lane by the truck overlapping its boundary boxes; the port keeps the front tire and the outward crossing in both rule sets.
- The staging gain from the truck's own deceleration (`+0x8bc`): the port's constant stays.
- **MTM1's drag event** (2, 4 or 8 entrants, par-time computer runs from the SIT, its pairing and points): the drag weekend runs CP3's event whatever the physics.
- **Not traced:** multiplayer (how a remote truck's state is applied, where "lag shots" would come from; it matters only with M15), and the two extra constants of MTM2's rubber-banding.

The plan as it was written:

**Not started.** A first pass over the truck-against-truck pairs with `tools/re/fdiff.py` shows the code is **not** only inlined differently there, so the collision trace has real material:

- `0x465f50` (MTM1) against `0x48eb70` (MTM2): two tests are the other way round (`!= 0` against `== 0`) and MTM2 has a call and three conditions MTM1 lacks.
- `0x467fd0` against `0x491e20`: MTM1 has a run of sign tests and comparisons, six groups of three, that MTM2 replaces with a single comparison and two flag tests.
- `0x469250` against `0x493410`: MTM2 starts from a 999999 sentinel MTM1 does not use.
- `0x461150` against `0x4894a0`: the same tests, reordered.

None of this is read yet: what the tests guard (which face or axis a hit is resolved on, a clamp on the impulse or the push-out) is the first thing to establish, in MTM1's code and then in `MTM2_PHYSICS.md` 14.20's terms. The switches in OpenPhotex are module constants today (`WATER_DRAG_DENSITY`, `WATER_TYPES`, `weatherGrip` in `sim/mtm2/constants.ts`), so `rules` has to be carried by the session to the ground, the surface and the water drag.

What is known (analysis section 4): the vehicle model is the same code and constants; the
confirmed differences are water drag density (1.0 vs 0.15), no deep water (type 13), no weather
grip factor, no crash damage. The user's recollection of **more violent collisions and "lag
shots"** is not explained by those, so a second trace comes first.

**Nothing is invented.** The MTM1 option holds only differences read from the 1.00 code. If the
trace finds no cause for the more violent collisions, the option ships with the confirmed
differences alone and the docs say so plainly.

1. **Deep comparison of the collision code** with `tools/re/fdiff.py` on the pairs whose diffs
   were only skimmed: truck against truck (`0x461150`/`0x4894a0`, `0x465510`/`0x48f6f0`,
   `0x465f50`/`0x48eb70`, `0x466930`/`0x490140`, `0x467fd0`/`0x491e20`, `0x469250`/`0x493410`),
   truck against box (`0x46197d`, `0x472a50`/`0x49f920`, `0x473cd0`/`0x4a12b0`), top crush
   (`0x4751b0`/`0x4a2d80`), box against box, the hull contact routine (`0x451550`/`0x475960`,
   the 44.01 ft/s branch), and rubber-banding (`0x45ab3c`/`0x48106c`). Look for restitution,
   impulse clamps, penetration correction and mass terms that MTM2 added or softened.
   Also the network side: how a remote truck's state is applied in MTM1 (`0x41eed0`-`0x41f2f0`),
   since "lag shots" are a multiplayer effect (document it; it only matters for M15).
2. **Scrape points:** compare how each game turns a `.TRK`'s scrape points and tire positions
   into the 12 hull points and 4 wheel points (MTM1 `0x421830` against MTM2 `0x4bddc0`, which
   `match.py` did not pair), and whether the stock MTM1 trucks' values differ in kind.
3. Write the findings into `docs/MTM1_MONSTER_EXE_ANALYSIS.md` section 4, then implement
   `rules: "mtm1"` in OpenPhotex as a set of named switches (`world/surface.ts`
   `WATER_DRAG_DENSITY`, `world/water.ts` deep water, `weatherGrip`, `truck/damage.ts`, plus
   whatever step 1 finds in `collide/*`), each covered by a test that the MTM2 default is
   unchanged.

In OpenMTM2:
- **Options, Game tab** (`src/ui/options-panel.js`): a **Physics** list (a `<select>`, not a
  toggle, and not on the Races screen), filled from a registry `PHYSICS_MODELS` in
  `src/app/settings.js` (`[{ id: "mtm2", label: "Monster Truck Madness 2" }, { id: "mtm1",
  label: "Monster Truck Madness" }]`) so later models are one more entry. Setting `physics`,
  default `mtm2`, passed in the race config to `sim-worker.js` and on to the session's `rules`.
  Console: `physics [id]` lists or sets it, completing over the registry (restarts the race).
- **Drag rules follow it.** With MTM1 physics the pass uses the 1996 rules (analysis 5 and
  7.2): beams by the hull-point checkpoint test, no backing-up rule, the Disqualify lamp for 99
  only, the computer launching on the green with no reaction delay, staging gain from the
  truck's deceleration; and the event uses MTM1's (2, 4 or 8 entrants, no byes, par-time
  computer runs from the SIT's `dragParTime`, MTM1 pairing and points). Implemented as a
  `rules` parameter on `drag-race.js` and `drag-event.js`; CP3 stays the default.

#### 2.4 MTM1 cheats (`src/game/cheats.js`, `src/ui/gold-mode.js`, analysis 3)

**Built, to be tested:** DANCE (the mixer's output as an oscilloscope over the race, from a tap on the audio engine's master) and TREX (the player's body drawn as `REX.BIN`, its four frames looping by the animated-model rule of 1.2, 24 ft over the wheels' hubs; a line says so when no mounted archive has the model). **TREX is drawn only:** the game also moves the tires and sets the hull's radius to 30 ft, which the simulation here does not do. The Z overlay has MTM1's physics line as far as the page knows it: the player's forward speed, gear, throttle and brake, and the physics model (the game's control flag, course and substep count are not shown).

- `CHEAT_CODES` gains **DANCE** (an oscilloscope of the audio output across the screen, from an
  `AnalyserNode` on the mixer in `src/audio/audio-engine.js`) and **TREX** (the player's body
  becomes `REX.BIN` with its four frames, tires at the analysis's positions, radius 30; only
  when the model is mounted, otherwise a console line says so).
- MTM1's Z mode needs no GOLD; keep OpenMTM2's current gating but add the physics line to the Z
  overlay (velocity, controlflag, gear, course, substeps, throttle, brake).
- Tests: `tests/cheats.test.mjs`.

#### 2.5 Track logo and zoom map

**Built, to be tested.** The trace (`MTM1_MONSTER_EXE_ANALYSIS.md` 2.10) found that MTM1's zoom screen plays nothing: what it shows with the map is the track's **description text**, in a fixed rectangle. That is what the Zoom dialog does; no sound was added, there being none to copy.

- **Preview:** for a track whose SIT names a logo, the Races screen preview tries
  `UI\<logoBmp>` first, then the existing `trackPreviewNames` (`src/game/menu-data.js`).
  The catalog carries `logoBmp` and `mapBmp`. Lookup goes through the track's own archive
  first (the VFS scoping already does this), so stock tracks need MTM1's `UI.POD` mounted and
  add-on tracks work from their own POD.
- **Zoom:** a `Zoom` button at the bottom right of the Races screen, shown only when the
  selected track's `mapBmp` resolves; it opens a modal `<dialog>` with the bitmap (decoded by
  the existing `uiImageUrl` in `src/ui/frame.js`), Escape or a click to close.
- **Track commentary, as MTM1 does it.** Trace first: `CMCZoomMapForm` (message map `0x5271f0`,
  class around `0x4c2ed0`-`0x4c3130`) and the "Fly By" handlers (`0x4b2c50`, `0x4b3d30`,
  `0x4b73e0`): which clip plays when the zoom map opens (the SIT's "Track Announcer .WAV file"
  line, a file by the track's stem, or a commentary phrase), from which folder, whether it
  stops on Close, and whether the description text is shown there too. Write it into
  `docs/MTM1_MONSTER_EXE_ANALYSIS.md` (a "Zoom map" subsection), then play it from the dialog
  through the existing menu audio (`src/audio/menu-sounds.js`), stopped when the dialog closes.
  Like the bitmaps: stock tracks need MTM1's archives mounted, add-on tracks use their own POD;
  no clip, no sound. The catalog carries `announcerWav`.
- Tests: preview name order; button hidden without the file; the clip's name resolution.

### Stage 3: game support

#### 3.1 CPR `.CAR` and 4x4 Evolution trucks

**Built, to be tested** (`src/worker/foreign-truck-build.js`, `tests/foreign-trucks.test.mjs`, run against the real archives: 29 CPR cars, 121 and 150 Evolution trucks).

- A vehicle of another game is named `<GAME>:<file>` ("CPR:DAVIS.CAR", "EVO2:CBLS24.TRK"), because the two Evolution games share file names; it is titled with its game, "Davis/Salles (CPR)", and listed after MTM's trucks in the Garage, Drivers and opponent lists.
- A CPR car: its `.CMD` body with the road-course wings, its four wheel models. An Evolution truck: its `.SMF` body and tires. The art is each game's own.
- **The port's rule for the physics:** MTM2's model throughout. The manifest gives the wheel positions and the twelve hull points; the tire model's bounds give the tire's radius and width (OpenPhotex `createTruckParams` takes `tireRadiusFt` and `tireWidthFt`; an MTM truck keeps the game's 3 ft by 4 ft); the weight, springs, engine and gearbox are the monster truck's. So a CART car drives like a small monster truck.
- The computer's default trucks stay MTM's own; another game's vehicle races when it is picked.
- **Not done:** the CPR driver's helmet, lamps, cockpits and crash dents (those are MTM2's own files, which these vehicles do not have), Evolution's paint colours and stock parts, each game's own engine and weight figures.

The plan as it was written:

OpenPhotex already parses them (`src/truck/cpr-car.ts`, `src/evo/trk.ts`, `parseTruckManifest`
returns their kinds) and JSTruckViewer renders them (`src/worker/cpr`, `src/worker/evo`).

- `catalog.js`: list `.CAR` (CPR mounts) and Evo `.TRK` as trucks with `game` and a label
  suffix "(CPR)" / "(EVO1)" / "(EVO2)"; today both are skipped by the `family !== "MTM"` test.
- `src/worker/truck-build.js`: per-kind builders adapted from JSTruckViewer (CMD/BIN bodies and
  wheels for CPR, SMF with RAW/ACT/OPA or TIFF for Evo), returning today's render shape.
- **Physics stays MTM2's** (as the tracks did): a mapping from each manifest to the sim's truck
  parameters (wheel positions and radius, hull points from the body's bounds, the default MTM2
  mass, springs and engine). Written up in `docs/PLAN.md` as the port's rule. Cockpits and
  damage dents fall back to none where the game has no equivalent.
- Garage, Drivers and opponent lists show them; tests on the catalog and the parameter mapping.

#### 3.2 Terminal Velocity, Fury3 and Hellbender levels

**Built, to be tested** (`src/worker/tv-track-build.js`, `tests/tv-levels.test.mjs`, run against Terminal Velocity's `CDROM.POD` and Hellbender's `GAME.POD`; no Fury3 archive was at hand).

- An archive with no track script but with these games' levels is detected as "TV" (Terminal Velocity and Fury3, whose files do not tell them apart) or "HB". Each surface level is listed as "Level (TV/F3)" or "Level (HB)", free roam and fly-by only, and no tournament takes it.
- The ground with its tiles, the objects of the `.DEF` (drawn, not collided with), the level's own sky, the start point of the `.NAV` for the truck and the fly-by camera. MTM2's trucks and physics; Dirt everywhere, no water.
- **Scale, the port's reading of JSTrackViewer's:** a cell is 32 ft; a height step 2 ft (Terminal Velocity, Fury3) or 1.5 ft (Hellbender); a model unit 1/128 or 1/64 of MTM's. A Hellbender level is 128 cells a side: as it wraps, it is laid out twice each way to fill the 256, its objects with it.
- **The sky is reachable on these levels only:** a ceiling fixed in the world, 640 ft over the level's lowest ground (the port's figure; the games' own ceiling is not known), where every MTM sky stays out of reach.
- **Not built:** tunnel levels, Hellbender's cavern and the objects in it and its floating levels' cut-out ground, powerups, texture animation, star-field skies, collision with objects, and any objective. Objectives as checkpoints need those games' executables.

The plan as it was written:

OpenPhotex reads them (`src/tv/*`: LVL, DEF, NAV, PUP, TDF, ANI, briefing) and JSTrackViewer
builds them (`track-loader.js`, `terrain-builder.js`, `def-loader.js`, `hb-underground.js`).

- `addon-store.js` / `vfs.js`: detect the three games' archives (family `TV`, `F3`, `HB`).
- `catalog.js`: one entry per level, type label "Level (TV)" etc., `freeRoamOnly: true`,
  `noTournament: true` (the editor's eligibility test already excludes free-roam-only).
- `src/worker/tv-track-build.js` (new, from JSTrackViewer): terrain, DEF objects, sky and
  palette, Hellbender's cavern layer; returns the common build result. Ground for the sim from
  `createTerrainFt`; objects are passed through at first (no collision), boxes later.
- Start position from the NAV start point (JSTrackViewer's `NAV_START_POINT`), the truck set on
  the ground there; fly-by starts at JSTrackViewer's eye height above it.
- **The sky is reachable on these levels only** (their ceiling and cavern layers are part of the world). On every other track the sky dome goes with the camera and is never reached, as the fly-by already has it.
- Playable as **free roam and fly-by only**. Objectives as checkpoints need those games'
  executables decompiled: listed under "Later" in `PLAN.md`, not planned here.
- Tests: catalog entries, a level builds headless, a free-roam session steps on it.

#### 3.3 Known gap: 4x4 Evolution vegetation (pending, not planned here)

Evo 1 and 2 tracks are missing vegetation support: the small vegetation and its placement
rules, how the `.VEG` trees and the `.SDW` shadow overlay are really drawn, and whether any of
it collides. Getting it right means reading the `~/dev/4x4e` and `~/dev/4x4e2` repositories or
decompiling the Evo executables. That work is expensive, so it is recorded in `docs/PLAN.md`
under "Pending" beside the TV/F3/HB executables (3.2), with what is missing and where the
answer lies, and nothing is built on guesses meanwhile.

### Before Stage 4: the third play test

Fixes and additions asked for after Stages 2 and 3, all built and to be tested in the browser.

- **Sparks** (`src/game/tire-effects.js`): few and uneven. While a hull scrapes faster than 12 ft/s each fifth of a second has a 30% chance of one spark; a hit over 1500 lb throws up to six, each with a 60% chance, and a contact that lasts is one hit (a burst no more than every 0.6 s). A tire against a tire throws none: OpenPhotex's `collideTrucks` now says whether hulls or only tires met.
- **Top crush** (`MTM2_PHYSICS.md` 14.27): a crush car's cab is a two-frame model, intact and flat, that the game stands at the frame its crush says; the port played it in time like any animated model, and never ran the crush. Now the SIT's `*** Top Crush ***` cars reach the simulation (`collideTruckTopCrush`), their two parts are no longer ordinary boxes, and the cab is blended by `crushShare` (0 intact, 1 its roof 0.25 ft over the body). **Not done:** the crush is not in replays, and the fly-by shows the cars intact.
- **Fly-by:** O shows the list of keys for the scheme in use; T follows the course (the straights joined into a loop, 28 ft over the ground, Up and Down change the speed; `follow <0|1>` in the console). T and not F, which is Hellbender's turbo. The camera, its keys and the list are now one controller (`src/ui/fly-controller.js`) that the race screen shares.
- **Spectator mode:** a box in the Computer Opponents dialog, ticked by itself when the grid is filled (eight trucks; a drag strip's two). The computer's trucks race alone, the player's own among them if picked. Go asks before starting. The RaceCam is the default; Left and Right change the truck watched, V the view, B switches to the fly camera and back (`fly <0|1>` and `watch <n>` in the console). The race is seen to its end: results come when every truck has finished, or two minutes after the winner. Not in free roam or fly-by. A drag weekend and a tournament are not watched.
- **Summit Rumble overlay:** every driver with their score, the leader first, under the time and the player's score. From play; the game's drawing code for it was not traced.
- **Evo 2 bridges** (a player's report, Deja Voodoo): the wheels measured the terrain under a deck while the hull met the deck, so a truck lay on its belly on a bridge or a rock with its wheels hanging. The simulation's post-step now gets each truck's own ground. The freeze reported after a helicopter drop under a bridge was not reproduced; its likely cause is the same mismatch throwing the truck with a force no step follows, so a truck whose state stops being finite or sane is now put back as it last stood (`stateIsSane`), and the wall lookup no longer walks cells for a position off the world.
- **Add-on archives** (a player's report): an archive with no track script had no game, and its trucks were never listed. `detectArchiveGame` now tells an archive by its vehicles too (MTM trucks, Evolution's `TRUCK.POD`, CPR's `RACECAR.POD`) and by Terminal Velocity and Hellbender levels; archives stored before are looked at again when mounted.
- **Under a bridge of ground boxes** (a player's report): the port's smoothed ground boxes took a box's top for any tire under its footprint, however far below, so a truck under a low deck was thrown up. A box whose bottom is over the truck's centre now carries none of its wheels, and its bottom is a ceiling to that truck. **Tibet Cliffslide itself has no ground boxes** (its `.RA0` and `.RA1` are equal everywhere): its bridges are a flat model and model-less boxes, and no jump was reproduced under them headless. Where on the track it happens is needed.

### Before Stage 4: the fourth play test

Built, to be tested in the browser.

- **Hellbender ground boxes:** a level's `.RA0`, `.RA1` and `.CL0` (the buildings and walls) are drawn and solid, laid out twice each way with the rest of the level, at Hellbender's 1.5 ft step (OpenPhotex `groundBoxesAround` takes the step; `buildGroundBoxMesh` too). Terminal Velocity levels get theirs the same way where they have any.
- **Sparks, again:** the last setting left almost none. Now about four a second while a hull scrapes faster than 6 ft/s, a burst of ten at most for a hit over 800 lb, a burst no more often than every 0.35 s; tires alone throw them at a fifth of those chances.
- **Performance, scenery in blocks** (`src/shared/object-chunks.js`): a model placed in more than 48 places is drawn as one instanced mesh per 512 ft block instead of one for the whole world, so blocks out of view or past the draw distance are skipped, in the picture and in the shadow map. Measured on 4x4 Evolution 2's Pikes Peak: 11,772 objects, of them 11,342 pines of 264 and 324 triangles, 3.4 million triangles that were drawn in full for every copy of the world the view touched. The simulation is not the cost there (0.14 ms a step with eight trucks). **Not measured:** the frame rate itself, which needs the browser. If it is still low, the next steps are fewer triangles for far trees (the models' own reduced groups, which are read and left out today) and no shadows from scenery past a distance.
- **Names (N):** written in the game's font, white with a black edge. The cycle has a fourth state after the drivers: the driver, and under it the truck in red. The course map shows the driver alone in that state.

### Stage 4: a world that truly wraps

**Built, to be tested in the browser.** The trace came first and is in `MONSTER_EXE_ANALYSIS.md`, "The wrapping world". It changed the design below: the game does not take distances the short way round and does not move the world with the camera. It **wraps every truck's position into the one world each frame** (`0x5559c0`), wraps moving objects the same way, and **draws each truck at the copy nearest the view** (`0x41bbd0`). That is what the port now does.

- **Simulation** (OpenPhotex `src/sim/mtm2/world/wrap.ts`, `test/sim-mtm2-wrap.test.ts`): `wrapTruck` after every step, x and z alone, as the game. So a truck is always inside the world, and every box, ramp, checkpoint and course segment is where it finds them however far it drives.
- **Across the seam, beyond the game:** the game subtracts positions as they are, so two things either side of the world's edge do not meet until one is wrapped across. The port's pair tests take the copy nearest (`withNearest`): truck against truck, against a box, a ramp, a top-crush car and a wall; ground boxes are placed beside the truck across the edge; the road and deck surfaces of CPR and Evolution levels are read wrapped. Marked in the code as the port's.
- **Drawing, as the game draws it.** The first build of this stage kept nine copies of the world around the middle one. That is not what the game does: its renderer (`0x5010f0`, `0x4f9ff0`) walks the cells around the view's cell and draws each once, beside the view, reading the map modulo 256. The port now does the same in blocks (`src/shared/object-chunks.js`, `placeBlocks` in `src/render/track-scene.js`): the ground, the ground boxes, a road, the scenery, each object that stands by itself, the water and the track lights are cut into 512 ft blocks, and every frame each block is moved by whole worlds to the copy nearest the camera. There is one world, drawn once; nothing is drawn twice and there are no copies.
- **The picture's space has no seam.** The watched truck is drawn at the copy nearest where it was drawn last (the simulation still wraps it, as the game does), the other trucks, the helicopter and the blimp beside it, and the fly camera's place runs on unwrapped. So the camera, the tire tracks, the dust and the sparks never jump a world, and shadows are cast by whatever is in sight. What is placed in the simulation's world and read by the page (the course for the BlimpCam, the RaceCam and the map, the finder, the level's sounds) is asked with the position wrapped. A replay's frames either side of the seam are blended across it, and following the course in fly-by goes across the edge.
- **Checked headless:** a truck driven off the edge comes in at the other side at speed with no jump in the picture; a wall across the seam stops it where the same wall inside does; two trucks either side push each other; a lap by four computer trucks finishes on twelve stock tracks (none of whose courses reaches the edge).

**Not done:**
- After very many worlds in one direction the picture's coordinates grow large enough to lose precision (some hundreds of worlds): the picture is not brought back toward the origin.
- How the game picks the placed objects (the models) around the view was not traced; the port places each block of them nearest the camera, the rule the game applies to its trucks.
- A checkpoint or a course segment that itself lies across the seam: the game wraps each end by itself, which the port keeps; no stock track has one.
- Box against box across the seam, and a Summit zone or a drag gate on it.
- A level whose edges do not meet (CPR's, Evolution's Aspen) shows a cliff at the seam, as its heightfield has it.

The plan as it was written:

A flaw in the port: the world is not endless. The terrain's height is asked for modulo 8192 ft, and the scene draws the track once with eight fixed copies around it (`createTrackWorld` in `src/render/track-scene.js`), but nothing else wraps. A truck's position is unbounded, so driving off the middle tile reaches copies that are only drawn: their boxes, ramps, checkpoints and course are not there for the simulation, and after a second tile the drawn world ends. MTM2's world is a torus: drive far enough one way and you are back where you began, with every object, wall and checkpoint in its place. This stage makes the port the same. three.js is no obstacle: it is a matter of where things are placed each frame.

#### 4.1 Trace the game first (docs, then code)

Read from `re/` into `MONSTER_EXE_ANALYSIS.md` and `MTM2_PHYSICS.md` (a new "The wrapping world" section); nothing below is to be built on a guess:

- **Positions:** whether a truck's `ipos` (`+0xfe0`) is itself wrapped (and when: on the conversion to 1/256 ft integers in `0x46da30`, or only in lookups), or left to grow.
- **Lookups:** the mask used on every position that reaches the terrain (`0x501820`), the ground boxes (`0x553fa0`), the surface (`0x503060`) and the sector tables the renderer and the collision broadphase (`0x488d90`) walk.
- **Distances:** how object against truck, truck against truck, the checkpoint test (`0x485af0`), the course follower (`0x480410`), the helicopter and the cameras take the difference of two positions across the seam (the shortest way round, or not at all).
- **Drawing:** how the renderer picks what to draw around the camera (cells and objects by sector, modulo 256), and where the far plane and the fog sit against half a world (4096 ft), so that a thing is never seen twice.
- **The exceptions:** a stadium (drawn in place of the world), and what the game does with a moving object or a course that crosses the seam.

#### 4.2 Simulation (OpenPhotex `src/sim/mtm2/`)

- One helper for the torus (`world/wrap.ts`): a position brought into the world, and the shortest difference between two positions. Every distance in the simulation goes through it.
- Trucks, boxes and moving objects keep their positions as the game does (4.1), and each consumer is made seam-aware: ground boxes, the collision broadphase and every pair test, ramps, top-crush cars, checkpoints and their detectors, the course follower and the autopilot's look-ahead, traffic avoidance, the helicopter and recovery, Summit zones, the drag gates.
- **Every level wraps, whatever its game.** `noWrap` goes: a CART Precision Racing or 4x4 Evolution level is a torus like an MTM one, at its own size. Where a level's edges do not meet (CPR's, and Evo's Aspen with its 40 ft step) the seam is a cliff as the heightfield has it; whether to ease the last cells into each other is decided when it is seen, as an addition marked as such. The road layer, the walls and a mesh ground (`createRoadGround`) wrap with the terrain.
- **Tests:** a truck driven across the seam meets the same box, ramp and checkpoint as one that reaches them from inside; a headless lap on a stock track started one world away gives the same times as the lap in place; two trucks either side of the seam collide.

#### 4.3 Drawing (`src/render/`, `src/ui/screens/race.js`, `fly-by.js`)

- **The world follows the camera.** The nine copies stay (they share every geometry and texture) and every level gets them, CPR's and Evo's too; the block is moved each frame so that its middle tile is the one the camera is in. With the far plane at most a world away, what is seen is always complete, however far the camera goes.
- **Everything that moves is placed nearest the camera:** trucks, moved boxes and moving objects, the helicopter, the blimp, effects (dust, sparks, tracks, splashes), name labels and lamps are each drawn at their position shifted by whole worlds to the copy closest to the camera, the test the game makes in its own way (4.1).
- **Around it:** the sun's shadow cascades and their casters, the sun flare's sight line, the water plane, the weather's particles, the sky (already centred on the camera), sound positions against the listener, the course map and the replay (positions recorded as the simulation holds them, drawn the same way).
- The fly-by camera wraps as a truck does.
- **Tests:** the block's placement from a camera position; the nearest copy of a point from a camera across a seam and across a corner; a replay recorded across the seam plays back unbroken.

#### 4.4 Order

4.1, then 4.3's camera-following block and nearest-copy placement (which alone ends the visible edge), then 4.2 by consumer, most used first: ground boxes and collisions, checkpoints, the course follower.

### Pending, low priority
- **Executables not decompiled** (costly; nothing is guessed meanwhile): 4x4 Evolution 1 and 2, for the vegetation (Stage 3.3; the `~/dev/4x4e` and `~/dev/4x4e2` repositories may answer it first); Terminal Velocity, Fury3 and Hellbender, for objectives as checkpoints (Stage 3.2).
- **Game file formats for player data:** decode `player.pro` (the driver profile, versioned, ProjNet.cpp 0x4dae90) and `highscor.mtr` (the Hall of Fame, written by 0x4c7540) so profiles and the Hall of Fame can be imported from, and exported to, a real install. Until then both are JSON in OPFS.
- **GOODY.BIN blimp** that follows the course on every track but Rumbles (M10, optional).

### Later (separate plans)

| # | Milestone |
|---|---|
| M8 | Rally and Summit Rumble |
| M9 | **In progress.** Done: Garage tuning (suspension, transfer gear, tire cut), driver profiles (JSON in OPFS, each with its own Garage setup and race tally), Hall of Fame (top ten per track and mode, JSON in OPFS), options with rebindable keys and the game's switches. Also done: the classic skin (the game's own menu art from UI.POD, with a switch back to the modern layout) and the HUD in the game's bitmap fonts. Also done: the game's message tables (UI\\MTM2-FUN.LOC, MTM2-PIG.LOC and any other .LOC in the install) as a Wording option that rewords the HUD, difficulty names and key names, and GOLD mode (reversed course, autopilot levels, collision boxes, slew and Z mode, screenshots, FRAME). Left in M9: the weather cycle key (M10), Ctrl+L, BlimpCam and RaceCam, and routing more of the menu text through the message tables. The GOODY.BIN blimp that follows the course is an optional extra (M10) |
| M10 | **Mostly done.** Weather: a Weather choice on the Races screen (only what the track's mask allows, or Random), the grip in the sim, the weather's sky, fog and light level, rain with lightning, snow, and the trucks' headlights in Dusk, Night and Pitch Black; GOLD mode's Ctrl+W cycles it. Enhanced look: cascaded sun shadows, and the sun, moon and lens flare from the game's own `SUN.TXT` and textures. Track rendering also uses OpenPhotex's JSTrackViewer palette ranking, including METALCR2 for Crazy '98's palette-less REX art; crops two pixels from every edge of a legacy terrain and ground-box tile; draws type 8 and 9 camera-facing objects as billboards; resolves and blends animated BIN keyframes; and draws the SIT backdrop models around the camera. Pending (low priority): the GOODY.BIN blimp; the fog tables for the dark weathers (the port approximates both); rain, thunder and wind sounds (M11); shadows of the placed models in the wrapped copies of the world (the terrain's are done, with Natural light); objects hiding the sun from the flare Also done: the game's own snowflake sheet and raindrops for Snow and Rain, ice that spreads over the water in Snow (100 s), the water bobbing a quarter foot every eight seconds, the camera under water (320 ft fog in the weather's fog colour, no sky, water seen from below), the water surface as the game draws it (eight `RIPPL` frames, a quarter second a step, translucent by weather), and wheel spray with ripples from `STARTUP.POD` (the particle constants are approximated). Per-track `.ANI` texture animations are not implemented: no stock level has its `DWATA` or `IS8WT` frames in use |
| M11 | **Done apart from the items below.** Web Audio with master, effects and music volumes: each truck's three engine loops from the game's own routine, skids and wheelspin by surface, gear changes, hull impacts, landings, splashes, the recovery helicopter, the horn (Space), camera switch (V) and YeeHaw (Y), objects' own hit sounds from the SIT and the sounds they make by themselves (train, crossing bell, crowds), train horns; the level's per-track ambience, serialized so its one-shots do not overlap or form echo-like bursts, rain, thunder, checkpoint and lap sounds, music loop from `MUSIC.POD` (or a `.MOD`); `SOUND\SPLASH.WAV` from `MUSIC.POD` as the start and menu music; the menu's screen, track, Garage slider, GO and ordinary click sounds from `UI.POD`. The port prioritises commentary about the player's own race and does not announce unrelated world events. Announcer voice playback is temporarily disabled, including its Options switch, until its sequencing is corrected. Announcer text (the English lines read from `MONSTER.EXE`) is dropped for now so the port does not depend on the executable. Pending: voice commentary; when the announcer speaks is the port's design (the game's own triggers are not traced); `RAINRF8` and underwater and cockpit sounds; blimp and helicopter-in-the-sky sounds; the weather phrases (`fog_`, `snow_`, `night_`) which the EXE does not reference; voice chat, Redbook tracks, force feedback; Smacker videos (unavailable) |
| M12 | **Done apart from the items below.** The course map (Map key, Tab or M; Names key N: the SIT's primary course as a double-line road, centred on the player and turning with its heading, trucks as pulsing plus signs with their place; from `0x4e2410`), the chase gauges laid out as in the game with the red `NEEDLE.BIN` needle, the Dashboard key (G), an MPH or KPH Speed option, the HUD's Lead and Back gap, the HUD text in the game's grey with its shadow and 15 px rows, all ten camera views (the View key V, Shift reverses: the chase cameras with the exe's distances, pitches, heading offsets, zooms and terrain avoidance; BlimpCam and RaceCam are the port's own approximations), the cockpit view (the eye at (0, 4, 1) ft in the body frame, the panel, needles, steering wheel frames, shifter, shift light and a live rear-view mirror from `COCKPIT.POD`) the finder ring (Finder key F, any view), the caption bar for every in-race message (camera changes read `Chase Far of Bear Foot`) and eased camera changes. Left: the cockpit's side and rear panels (looking left, right and back), the View keys that turn and zoom the chase camera, the real BlimpCam (follows the blimp) and RaceCam (trackside) routines, and the pitboard (no drawing code found, probably unused) |
| M13 | **Done apart from the items below.** Crash damage as `core/TruckDmg.c` does it (exe analysis 10): the 12 hull points are the zones, each step a hull point is in contact the sim reports it with the impact force, the zone's level (0 to 3) rises and the body's vertices within 2 ft (1.5 ft for zones 5 to 12) are pushed in along the zone's direction by a little more at every level (OpenPhotex `truck/damage.ts`, `render/truck-object.js` `dent`), for every truck. Damaged trucks play `suspen1`/`suspen3` on impact. The X key toggles it with the game's messages in the caption bar and repairs every truck when it goes off; Options has the switch. The game's own default is off, the port's is on. Left: the knocked lights, the scrape sparks, `GOODY.BIN` parts, and the lower levels of detail (the port draws one body model) |
| M14 | **Done apart from the items below.** The recorder keeps a frame every quarter second (a record per truck, one per object that moved) in a ring of 2240 records through every race (`game/replay.js`); the results screen's Instant Replay button plays it back in the race's own scene with the VCR controls (play, pause, rewind, fast forward, slow, frame step, scrub, camera on any truck in any of the ten views, zoom and rotate, damage replayed from the damage codes), and Save writes the game's own `.rpl` text format (OpenPhotex `parseMtmReplay` / `writeMtmReplay`), which Options > Open replay reads again, so replays from the game and the Community Patch play too. The race now ends as the game's does: the simulation goes on after the player finishes, with the RaceCam, and the results come 5 s after the last truck. Left: sound in the replay, shadows and the lens flare in the replay, the game's own results-screen replay window and the demo (`.dmo`) files |
| M15 | Multiplayer (WebRTC; each client owns its truck) |
| M16 | Community Patch 3 support (the CP3 author's docs: ENGINE_LIMITS, AUTHORING_HD_ART, CPOD_LONG_NAMES, MONVERT_HANDOVER, GLTF_EXTRAS_SPEC, TERRAIN_DETAIL_MASK, written descriptions only: he provided no source code; JSTrackViewer and JSTruckViewer as references). **Done:** the build is read from `MONSTER.EXE` (above 2.00.42 a community patch, below 2.00.41 a beta) and the menus start modern on a patch, classic otherwise (Options: Automatic, Classic, Modern); POD.INI mounts as on retail. HD art by stem (`ART\<stem>.PNG` → `.TGA` → `.RAW`, square powers of two 32 to 1024, JSTrackViewer's decoder) for models, trucks, the blimp, helicopter and previews, and the sky; `<stem>_N` normal maps (DirectX green-down) on lit materials; `MRGL_MATERIAL` flags mapped as JSTrackViewer does (unlit, alpha test over blend, two-sided, tint, additive, no depth write, Phong specular and emissive, MATERIAL2 normal strength); `.SI2` tracks in the catalog (preferred over a `.SIT` of the same stem); box type 12 lights from the SIT's `L` block (OpenPhotex `parseSitLight`: pool radius on the ground, lamp height, colour, glow sprite and cone, brightness, aim offset), lit at night with the 8 nearest as real lights; box type 13 movers (travel like a train, no horn or crossing bell); four-tire sets (`16FR/16FL/16RR/16RL`). Also done: HD terrain art (scaled to 256 px tiles in the atlas), `_AO` maps (ambient light only), the glass `TEXSOLID` second pass, the MTM1 tracks CP3's GAME.POD carries (a SIT whose level is missing, such as MTM1's HILLCLIM, is left out of the list), Professional's course 2 for every truck (MONSTER_EXE_ANALYSIS.md 9), drag races (an addition, 6.4: one pass by the rules the CP3 author described in writing, with no source code provided, with prestaging and staging by hand or by Auto Stage, the half-second tree, the beams broken by the front tyre, red lights, the lane, reversing and timeout disqualifications, the re-run flag, the timing slip, lane 1 on the SIT's course 2 or the mirrored course, and one opponent or none) and a Rumble driver for the computer trucks (an addition, `game/rumble-ai.js`: a flow field to the zone over the ground and the ground boxes, tables as a second layer, jumps off rising ground with a run-up, holding and pushing in the zone). The terrain detail mask and detail normals (`<level>_MASK`, `<level>_DTL` or a generated pattern, world space every 64 ft, strength 1x to 5x by the mask with occlusion at 0.6 of it), HD ground tiles' `_N` maps as a second atlas, and the sky reflected by materials with `reflectivity` and by glass; Options switches Terrain detail and Reflections (written from the docs alone: no track with a mask or a reflective material was at hand to check them against). `MRGL_TEXTURECYCLE` animated textures (MTM1's helicopter rotor), 15 frames a second. **Not done:** a view-angle Fresnel term, `.TXV` track version records. |
| VR | **Done in an emulator, not yet on a headset** (`docs/VR.md`): WebXR `immersive-vr` with six degrees of freedom at life size; a cab view from a seat read off the truck's body, inside a roll cage with the game's own dials, and two chase views; horizon lock; the controllers as the game's joystick, or the hands held as on a wheel; pause, options, race setup and results on boards in the headset; `tools/serve.mjs` serving the game folder to a headset's browser, which then keeps the app and the game and needs the PC no more (a service worker and a copy of the app, `docs/ARCHITECTURE.md` "Without a server"). The renderer was made cheaper for it with instanced scenery and one block-based wrapped world, with terrain in chunks. Pending: a run on real hardware and what it shows; hand tracking; the remaining menus in the headset |
| Scenery | **Done, checked on the flat screen only** (`docs/VISUALS.md`): scenery of the port's own, each part with a switch on the Options screen's Scenery page. The page leads with a preset, Auto, Off, Low, High or Max, and Custom is the one that shows the switches. Each part off draws as before. The ground smoothed (a cubic patch on each of the game's triangles with its creases rounded, relief on ground too steep to drive, an adaptive mesh at two levels of detail cut finest where the cameras are, drawn trucks seated on it; the simulation untouched). Water with waves, the level's sky in it, light through its depth from a map of the ground (the bed seen through it, black in the dark), a shore, a view from under it, and ice in Snow. Fog as a layer the eye looks through, in every material, with the sky veiled by it, lying on a floor that follows the land and the course so a truck climbs out of Foggy on a crest; rain and snow as fields in the air placed by the graphics card. In Rain, wet ground and puddles where water would stand. In Snow, snow with depth: deep on level ground, thin on slopes and clear along the course, lifting the ground as it settles. No rain or snow under bridges and in tunnels. Light of the port's own in the enhanced look: a sun in the colour of its hour, the sky's and the ground's light in the colours of the level's own art, the ground casting shadows, a shade under each truck, trees lit as round things with clean edges, and a curve that rolls bright light off. The ground's tiles filtered for the distance, with grain over them and cliffs that do not smear. A deeper haze, and the game's backdrops seen through it, off by default. Trucks that mirror the sky and glint, on matt tires. Lamps of the port's own: lenses that glow, beams as light in the air, tail lamps that run dim and brake bright, headlights on the ground by each truck's switch, lamps that move with a dent. On the flat screen, bright lights that glow. Fog whose banks and wisps stand in the air, a snow line that wanders instead of following the mesh, ice in plates that stars where a truck lands on it, and what the trucks throw up and leave behind (dust that billows and takes the light, powder, chips, mist, drops, clods, sparks that streak from the body where it strikes and only at speed, bubbles under water, smoke and rubber from tires that slide or spin, ruts from every tire pressed into earth and snow), in the instant replay too. Pending: a run in a headset, where none of it has been seen; ruts that lower the snow's own surface (they are drawn on it); a drawn lightning bolt; shadows of the placed models in the wrapped copies of the world; a zoomed camera (BlimpCam, RaceCam) still takes its shadows from cascades fitted round the camera, which are coarse that far from it |
### M9 menu layout refinement

The classic menu controls use the empty regions and labels already present in the `UI.POD`
backdrops:

- Start contains only the Web Page, Monster Demo, Monster Manual and Driver Check-in switches.
  Web Page opens `https://mtm2.com/`; the demo and online manual remain deferred. Menu music is
  requested as soon as the installed game boots, subject to the browser's autoplay policy.
- Driver Check-in has one editable driver-name combo box. Choosing an existing name selects that
  profile; entering a new name creates it. The skill selector has no extra label. Truck selection
  is on this screen only, above the future mini-garage truck preview.
- Races lists every available race type in one two-column Track Name and Track Type table. The
  selected track labels the small value as Laps or Minutes immediately to its left and applies the corresponding amount.
  Its stock BMP fills the preview region, Weather lists only the track's allowed weather, and Computer
  Opponents opens a two-list dialog for choosing the actual CPU trucks.
- Garage contains tuning only. The transfer display combines its value with the tire-cut letter
  (`s`, `m`, `d`) and suspension letter (`s`, `m`, `h`), for example `1500 m/s`.
- Hall Of Fame always lists every available track in the track selector. Its one table follows the
  artwork's columns: Place, Player, Truck display name, Skill Level, Points and Time. Points remain
  blank where the stored result has none.
- Every framed menu screen has an Options button at the top right. It opens a modal containing the
  available settings, with Hall Of Fame, Use a different install and Clear browser game data
  actions at the bottom. Clearing is confirmed first and removes the copied install, profiles,
  Hall Of Fame entries and preferences.
- Winner's Circle leaves the first- and second-place black panels empty for future 3D truck
  previews. The table follows the artwork's Place, Player Name, Truck, Skill Level, Points, Time
  and Fast Lap columns without drawing a second header row.

---

## Verification

**1. Formula tests (OpenPhotex, synthetic, hand-computed)**
- Engine: T(2000) ≈ 1699.4 lb ft, T(6000) ≈ 1056, the ×0.9 and ×1.1 gains.
- Suspension: soft front k ≈ 2068 lb/ft, c = 3.5√k.
- Wheelbase clamp: +7 / −6 ft becomes +6.3 / −5.3.
- Transfer table and difficulty scaling.
- Grip: μ × cut factor × 1.75 × weather for all 13 types.
- C(α) at every table point and midpoint; the 10 ft/s floor; friction circle on Intermediate but not Rookie.
- Contact support split for 2, 3 and 4 contacts.
- Euler: ±13 clamp and the gimbal-guard continuity.
- Terrain: both triangles of even and odd cells, wrap, snow freeze.
- Control ramps and steering exponent.
- Checkpoint direction test, splits, Summit scoring with its cooldown, countdown at exactly 3.0 s.

**2. Invariant tests (synthetic worlds)**
- Rest at static sag (within 1%) on soft, medium and hard.
- Static hold on a slope.
- Free fall at g.
- Energy never increases after landing with the throttle closed.
- Stopping distance at least `v²/(2·0.8·μ·K·g)` and consistent across dt of 1/30, 1/60 and 1/120.
- Top speed per gear no higher than the rev-limit speed.
- No tunnelling.
- Penetration never deeper than 0.25 ft after the post-step.
- Byte-identical snapshots across two runs.
- No NaN across 10k random starting poses.

**3. Headless races (OpenMTM2 `tests/headless-race.test.mjs`, skip without an install)**
- 8 CPU trucks, 3 laps, every Circuit and Rally track, all three difficulties.
- Assert: everyone finishes; checkpoint order is monotonic; helicopter use stays bounded; no NaN; nothing goes below the terrain skin; placings are consistent.
- Lap times are logged for information, never used as targets.

**4. Stock tests (OpenPhotex):** course counts per track, continuous arc headings, terrain orientation, and every stock KLP, SOUND, SUN and powerbig file parses.

**5. In the browser:** dev overlays (16 contact points with normals and force arrows, physics-versus-mesh height heatmap, course arcs and AI aim points, checkpoint boxes, step-time graph) plus a manual checklist per milestone.

**6. Optional:** a qualitative comparison with CP3 `.rpl` replays (lap-time band, finishing order). Never used for tuning.

---

## Risks

| Risk | Mitigation |
|---|---|
| The autopilot needs the arcs and bank that are built at load time | Trace them first in M2; the sim uses only raw-feet course fields, never the editor-space ones |
| Physics doc §13 details are still open | Read them from `re/` into the doc before porting (M6); until then the `+0x5a0` weight is 0 |
| Terrain orientation and diagonal parity, renderer against physics | One shared parity function, the mesh-versus-sampler test, the SIT rest-height test |
| Left-handed game frame against right-handed three.js | All conversion in `render/world-frame.js`, tested with known headings |
| Step-dependent laws | The `REFERENCE_DT` constant; invariant tests at three step sizes |
| Which SIT boxes are solid | Confirmed in M5 (physics 14.15) |
| WAV codecs (ACM/ADPCM) | Check in M11; OpenPhotex decoder as fallback |
| Safari OPFS writes are worker-only; storage quota | Copy from the asset worker; request persistence and show the space used |
| Every sim change re-vendors into two repos | Keep a sub-barrel with stable exports; run JSTrackViewer's tests on every vendor |
| Performance with 8 trucks and up to 600 ground boxes | Sphere culling and 3×3-cell locality; budget < 4 ms per step for 8 trucks |
