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
| `src/install/` | `picker.js` (`showDirectoryPicker`, or `<input webkitdirectory>` as fallback), `validate-exe.js`, `pod-ini.js`, `install-manifest.js` |
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

- Folder picker; validation: MONSTER.EXE is 2,925,568 bytes, its PE timestamp is 900451983 and its version is 2.00.42. Anything else gets a "not supported yet" message.
- `POD.INI` parse; copy `POD.INI` and the PODs into OPFS **from the asset worker** (Safari's OPFS writes only work there), with progress, `navigator.storage.persist()` and a quota check.
- `vfs.js` with mount order, first match and case-insensitive names; cached POD indexes.
- `catalog.js` with CHUCK/WAR/GRAVEY behind flags.
- **Accept:**
  - Picking `~/games/mtm2` works in Chrome (directory picker) and Firefox (webkitdirectory).
  - A reload skips the install step.
  - The catalog shows 13 visible tracks and the stock trucks.
  - Node tests cover `pod-ini`, `validate-exe` (synthetic PE) and VFS first match (synthetic PODs built with OpenPhotex `writePod1`).

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
- Wheels against wheels for truck pairs (`0x491950` -> `0x490790` -> `0x48b5d0` -> `0x491e20`); hull points already keep racing trucks apart.
- Truck against truck in the drive session (it is in OpenPhotex; the session has one truck until the AI trucks).

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
**Status: in progress.** Done: Start, Race select (Circuit tracks, the track's default laps, the number of opponents, difficulty), Garage, the game's choice of CPU trucks and its shuffled start grid, the loading screen (`ART\DATA480.RAW`), the race (every truck drawn, the 3 s countdown, the game's HUD rows, missed-checkpoint and final-lap messages, pause, the camera key), "Determining times for remaining trucks" and Results, plus the game's Full Autopilot as a setting. A 1-lap Farm Road 29 race runs start to results in headless Chromium with no console errors. Left: the acceptance runs in Chrome, Firefox and Safari and the frame-rate check; the start-light model (`stlite.bin`) instead of the text lights.

- **Flow:** Start → Race select (Circuit tracks, laps, difficulty) → Garage (truck pick) → Loading screen (`DATA%d.RAW`) → race → "Determining times…" → Results.
- **The race:** 3 s countdown with start lights; HUD with Place n/8, Lap n/n, time and best lap; pause; helicopter key.
- **CPU trucks:** names Mark, Greg, Rich, Brett, Gaither, Chuck, Terry, Joe; `defaultOpponents` random catalogue trucks (MONSTER_EXE_ANALYSIS.md 9).
- **From M6:** the track's default lap count; `fastSimulateRemaining` for the trucks still racing when the player finishes.
- **Accept:**
  - Farm Road 29, 3 laps, Intermediate, against 7 CPU trucks (7 opponents chosen), played start to finish in Chrome, Firefox and Safari.
  - Missing a checkpoint does not count the lap; flipped CPUs recover; the results order agrees with the sim.
  - No console errors and 60 fps on a mid-range laptop.

### Later (separate plans)

| # | Milestone |
|---|---|
| M8 | Rally and Summit Rumble |
| M9 | Garage tuning, driver profiles, Hall of Fame, options and bindings, classic skin, LOC strings |
| M10 | Weather and the enhanced look |
| M11 | Sound and music (engine, skids, ambience, MUSIC.POD + KLP; Redbook music and Smacker videos are unavailable) |
| M12 | Cockpit, finder, map, all 10 cameras |
| M13 | Damage deformation |
| M14 | Instant replay |
| M15 | Multiplayer (WebRTC; each client owns its truck) |
| M16 | Community Patch 3 support |

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
