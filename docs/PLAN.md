# OpenMTM2 plan

OpenMTM2 is a clean-room web version of Monster Truck Madness 2 that runs in the browser from the player's own
install. This page is the project's current state and its open work. How it was built, milestone by milestone, is in
[CHANGELOG.md](CHANGELOG.md); the game's facts are in [MONSTER_EXE_ANALYSIS.md](MONSTER_EXE_ANALYSIS.md) and
[MTM2_PHYSICS.md](MTM2_PHYSICS.md); the code's layout in [ARCHITECTURE.md](ARCHITECTURE.md).

The rules of the work are in `AGENTS.md`: a fact is read from the executable into the docs before it is coded, and a
behaviour the port adds is named as an addition, never passed off as the game's.

## Where it stands

| Area | State |
|---|---|
| Install, content, POD mounting, HD art, sound replacements | done |
| Simulation: trucks, objects, collisions, autopilot, race rules (OpenPhotex `sim/mtm2`) | done |
| Circuit, Rally, Summit Rumble, the drag strips; the results, points and Hall of Fame | done; browser playthroughs to do |
| Menus in both skins, driver profiles, Garage, options, the About screen, the Monster Manual | done |
| Cameras: the ten views, the cockpit and its side and rear panels, the View keys, GOLD and Z mode | done, to be tested |
| Sound: engines, skids, impacts, world and weather sounds, commentary, music, under water | done |
| Weather, lamps, crash damage, the blimp, the helicopter, replays and the `.rpl` format | done |
| The game's saves (`player.pro`, `MTM2 High Scores`): import and export | done, to be tested |
| Multiplayer (`MULTIPLAYER.md`): classic DirectPlay play, online rooms | built; retail test and CP3 handover to do |
| Community Patch 3 support | done but the items below |
| Other games' tracks and vehicles (CPR, 4x4 Evolution, TV, Fury3, Hellbender), MTM1 physics and tournaments | built, to be tested |
| Additions: extensions (`EXTENSIONS.md`), scenery (`VISUALS.md`), VR (`VR.md`), console, fly-by | built; see below |

## Open items

### The original game, still missing or approximated

1. **Saved races.** Traced and built (MONSTER_EXE_ANALYSIS.md 16, "Saved games"; pause menu, Save race; Options,
   Game, Load race). Left: a race saved by the retail game and loaded here, and the other way round, to be tested;
   the port keeps only the running lap's checkpoint times and does not save the objects' moved positions.
2. **Darkness in the dark weathers.** Dusk, Night and Pitch Black darken the cockpit art by the traced shade levels;
   how they darken the 3D world (the software renderer's fog tables) is not traced, and the port approximates it
   (`game/weather.js`).
3. **The finder showing itself.** The manual says the finder comes up after 5 s off the track; the code sets it from
   the autopilot routine (`0x486630`, a test against 160) and that test is not read yet.
4. **Hall of Fame size.** The port keeps ten entries a board; the game's manual says twenty. Read the table's limit
   (`0x45f5d0`, the board's `+0x1e`) and match it.
5. **Replays:** shadows and the lens flare while a replay plays, and the Winner's Circle's small replay window.
6. **Levels of detail.** The game swaps each truck's body between its `16`, `10` and `08` models by size on screen;
   the port draws the finest always. Not planned: it only lowers the picture. Damage still dents and knocks the lamps
   as the game does on every level.
7. **Hardware of the time:** force feedback and CD audio tracks. Force feedback could use the Gamepad API's rumble;
   CD audio has no browser counterpart. The game's CB Radio voice chat is not offered (the lobby's button is hidden).
8. **Cheat codes not done:** DEMO, NOLOCK, CHUCK and 3DFX (section 15).

### Facts still to read from the executable

- The `player.pro` fields with no use found yet (seven text lines, a list, three numbers) and the meaning of the last
  setting (`MONSTER_EXE_ANALYSIS.md` 16, 21).
- The saved-game layout (item 1 above).
- When `GOODY.BIN`'s parts are thrown off a damaged truck (`partsFlag`).
- The `0x5a0` weight term and `+0x2a8` and `+0x518` (15000) in the truck.
- The terrain's sink depth and rolling drag (marked as a hypothesis in `MTM2_PHYSICS.md`).
- How the game places the scenery models around the view in the wrapping world.
- In multiplayer, how a remote truck's state is applied (lag), and MTM2's rubber-banding constants.
- The ramp side walls: `MTM2_PHYSICS.md` 14.19 lists the response (`0x4b3540`) and the edge test (`0x4b17c0`) as not
  read, while OpenPhotex `collide/ramp.js` already pushes wheels and hull points out of the sides: check the code
  against the exe.
- The `/h` and `/j <ip>` command-line switches.
- Community Patch 3's texture cycle rate (the port uses 15 frames a second).

### To test in the browser

- The first-playable acceptance: Farm Road 29, 3 laps, 7 computer trucks, in Chrome, Firefox and Safari, at 60 fps on
  a mid-range laptop; a Rally and a Summit Rumble played through.
- Everything marked "to be tested" in the changelog's last entries, above all this round's cockpit views and View
  keys, the mirror switch, rain on the roof, the sound under water, the knocked lamps, crush cars in replays, the
  saves' import and export, and the Monster Manual.

### Multiplayer

- Step 1 against the retail game and the patched retail (DirectPlay helper, `MULTIPLAYER.md`).
- The CP3 handover: the room protocol written up for the CP3 developer to review.

### Additions with work left

- **Combat:** replays of its effects, and a camera shake on hits.
- **Drag weekends and tournaments:** the weekend kept in OPFS; the weekend's results in the Hall of Fame and the
  driver's tally; MTM1's own drag event (2, 4 or 8 entrants, no byes, par-time runs).
- **Other games:** the steep sides of Evolution's rocks stop nothing; Evolution 1's own box sizes; `.WAT` water,
  the detail texture and wakes; the handbrake, gears past third and transfer case keys; Evolution garage settings;
  CPR's lamps, cockpits and dents. Terminal Velocity, Fury3 and Hellbender objectives need their executables
  read.
- **Community Patch 3:** a view-angle Fresnel term, `.TXV` track version records. From the survey
  (`CP3_EXE_ANALYSIS.md` 3): trace and port `aiMode`, `aiCornerMargin`, `aiTerrainCaution`, the computer trucks' horn
  and yee-haw switches, tournament driver form, `centreCommentary` and `commentarySilence` as a setting.
- **Wheels damage:** online play (each machine sends its trucks' wheels, a room protocol addition), replays, and the
  `popAt` and `axleAt` figures tuned in play.
- **The wrapping world:** precision after hundreds of worlds in one direction; box against box, a Summit zone or a
  drag gate across the seam.
- **VR:** a run on a real headset, hand tracking, the remaining menus in the headset.
- **Scenery:** a headset run; ruts that lower the snow itself; a drawn lightning bolt; shadows of placed models in the
  wrapped copies; finer shadow cascades for the zoomed cameras.

### Later (separate plans)

- The other games' executables (Terminal Velocity, Fury3, Hellbender) for their own rules.
- A free replacement for the game's own art and sounds, so OpenMTM2 can run without an install (the Monster Manual
  and the About screen are written to need none of the game's text).
