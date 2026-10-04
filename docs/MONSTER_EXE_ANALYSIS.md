# Monster Truck Madness 2: analysis of MONSTER.EXE

This is a reverse-engineering survey of the retail Monster Truck Madness 2 executable, written as
the foundation for OpenMTM2. It records how the game is put together, what it reads, the rules it
enforces and the numbers it uses, so that OpenMTM2 can reproduce the game's behaviour without
copying its code.

It complements what the sibling projects already know:

- **OpenPhotex** reads every data format named here (POD, SIT, LVL, TRK, BIN, RAW/ACT, TTY...).
  This document does not re-describe those formats; it describes what the game DOES with them.
- **JSTrackViewer** `docs/MTM2_PHYSICS_NOTES.md` and `docs/MTM2_REPLAY_FORMAT.md` hold the
  measured physics and the replay format. Section 20 lists where this analysis corrects them.

Every fact below carries an address in the analysed build. Anything not confirmed in code is
marked **hypothesis**.

---

## 0. Method and build

### Install analysed

`~/games/mtm2`, a retail install with the official patch applied.

| Item | Value |
|---|---|
| File | `MONSTER.EXE`, 2,925,568 bytes, MD5 `38dda9b53456201fc038cda40a7c1862` |
| Version resource | FileVersion and ProductVersion **2.00.42** (the November 1998 patch build; `PATCH.RTF` says the patch sets 2.00.42) |
| PE timestamp | 900451983 = 14 July 1998 |
| Machine | i386 PE32, image base 0x400000, no ASLR, no relocation needed at runtime |
| Toolchain | MSVC 5 (linker 3.10 reported by the PE header, MFC 4.x "Afx...40s" classes), incremental linking (a 1,500-entry jump-thunk table at 0x401000-0x406fff) |
| Debug info | `D:\METAL\CRUSH2\test\monster.pdb` (PDB 2.0, not shipped). The internal codename is **"Crush 2"**, project folder `METAL` |
| Same file | `~/Downloads/mtm2pat/MONSTER.EXE` is byte-identical |

**This is not the build JSTrackViewer's physics notes used.** Those notes were taken from
2.0.41 (`MONSTER.EX_`, 1 April 1998, 2,920,448 bytes). Code moved by a few hundred bytes per
region between the two (Main.c +0x40, Truck.c +0x1e0, Demo.c +0x610), and `.rdata` and `.data`
moved by 0x1000. **Struct offsets are identical; absolute addresses are not.** Every address in
this document is for 2.00.42.

| Section | VA | Virtual size |
|---|---|---|
| `.text` | 0x401000 | 0x2055d5 |
| `.rdata` | 0x607000 | 0x36f72 |
| `.data` | 0x63e000 | 0x6bbd70 (only 0x20000 initialised; the rest is BSS, about 7 MB of static game state) |
| `.idata` | 0xcfa000 | 0x43d3 |
| `.rsrc` | 0xcff000 | 0x1ee3b |

Game code occupies 0x401000-0x5a0000; MFC 4.2 and the MSVC runtime fill 0x5a0000-0x607000.

### Tools

- Ghidra 12.1.4 headless (`brew install ghidra`), full auto-analysis, then every function
  decompiled to C (7,745 functions, all decompiled without failure).
- A call graph rebuilt through the incremental-link thunks (Ghidra's own caller counts read zero
  for almost everything because every call goes through a thunk).
- Capstone for spot disassembly; pefile for headers, resources and string tables.
- OpenPhotex for every look inside a POD.

The decompiled output stays outside this repository. Nothing here is game code; only facts,
layouts and constants.

### Source modules

Assertion messages carry the original source paths, which give a module map of the code.

| Module | Code range | What it is |
|---|---|---|
| `engine/Clipper.c` | 0x4130d0-0x413c15 | polygon clipper ("Ran out of clipped verts!") |
| `core/RACE.CPP` | 0x417ad0-0x41b330 | `CRace`: content catalogue, truck setup, save/load game |
| `core/Trucksfx.c` | 0x41bbd0-0x42a8fe | all truck, world and commentary sound |
| `core/Sky.c` | 0x42b430 | sky textures, sun and moon |
| `engine/Boss.c`, `Animate.c`, `Keyframe.c` | 0x42d360-0x432100 | keyframed and texture-animated models |
| (UI dialogs) | 0x432cc0-0x44ce00 | options, controls, calibration, multiplayer dialogs |
| `core/Main.c` | 0x44cee0-0x450171 | startup, INI load/save, file helpers |
| `engine/Model.c` | 0x4504a0-0x4518b7 | BIN model loader |
| `support/network.cpp` | 0x4534a0-0x45a000 | DirectPlay session layer |
| `mfc/HighScor.cpp` | 0x45fe90-0x460681 | Hall of Fame |
| `core/Object.c` | 0x467120-0x467a46 | object table |
| *(no assertions)* | 0x467a46-0x4bb4b0 | **the simulation**: rigid bodies, truck, tires, collisions, autopilot |
| `core/Truck.c` | 0x4bb4b0-0x4c2a00 | truck loading, defaults, SIT vehicle writer |
| `mfc/Metalapp.cpp` and UI forms | 0x4c5000-0x4d3000 | the MFC application and its screens |
| `core/Level.c`, `Title.c`, `MtmFont.cpp`, `ProjNet.cpp` | 0x4d4d70-0x4dd000 | level load, title/loading screens, fonts, game-level networking |
| `cockpit/*`, `core/Cockpit.c` | 0x4e3e40-0x4ec64b | cockpit, dashboard and finder |
| `wincore/Winddraw.cpp`, `winvmem.cpp`, `core/PODMAIN.CPP` | 0x4f3ce0-0x4f7100 | DirectDraw, renderer DLL binding, POD list |
| `core/Ground.c` | 0x4f73d0-0x502ef0 | terrain, ground boxes, lighting, ground types |
| UI forms (results, garage, multiplayer...) | 0x505000-0x51e000 | |
| `support/objmsg.cpp` | 0x51e230-0x51ec2f | FourCC event bus |
| `cockpit/pkbitmap.cpp`, `core/ENVMAP.CPP` | 0x520520-0x5226d9 | packed bitmaps (PBM/PBG), environment mapping |
| `engine/Matrix.c`, `core/View.c` | 0x5278f0-0x52fb40 | matrices, 3D windows, cameras, HUD text |
| `core/TruckDmg.c` | 0x531e40-0x5334ac | crash damage |
| `sound/radio.cpp` | 0x545f30-0x548500 | voice chat |
| Drag strip | 0x548800-0x549000 | Christmas tree, staging |
| `core/Simobj.c` | 0x54ec00-0x555a90 | SIT loader and writer, sim object lists |
| `engine/texture.cpp`, `2d.c`, `Pcx.c` | 0x559d20-0x5649d1 | texture cache, 2D, palettes, screenshots |
| `core/Demo.c` | 0x564ca0-0x56831b | demo and instant-replay recorder |
| `engine/pod.cpp` | 0x569080-0x56a460 | POD archive mounting |
| `support/TRIStr.cpp` | 0x56b456-0x56bfb8 | strings |
| CD audio, sound devices | 0x56cd30-0x573f70 | Redbook, DirectSound setup, force feedback |
| `core/weather.cpp` | 0x574420-0x57bbd0 | weather |
| `mfccore/*`, `support/TRIList.cpp`, `engine/font.cpp` | 0x57c930-0x5948e0 | UI framework, lists, fonts |

---

## 1. Program structure

MTM2 is an **MFC application wrapped around a C engine**. The menus, garage, multiplayer lobby,
results and Hall of Fame are MFC form views (`CMCReplayFormView`, `TRITabs`, `CDragListBox`...)
drawn with bitmaps from `UI.POD`. The race itself is a classic TRI C engine: hundreds of globals,
"current object" pointers (`0x6cef34` current truck, `0x6f6074` current body), and fixed tables.

The two halves talk through an **event bus** (`support/objmsg.cpp`, `CSender`/receivers) whose
messages are FourCC pairs. Codes seen: `game`/`engn` (race engine starts), `!gam`/`engn` (race
engine stops), `netw`, `conn`, `disc`, `disd`, `sess`, `host`, `hchg` (host change), `play`,
`pchg` (player change), `prdy`/`prdz` (player ready), `truk`, `trck`, `laps`, `skil`, `team`,
`chat`, `chau`, `nmsg`, `sync`, `rslt`, `load`, `over`, `rain`, `dlog`, `!dlg`, `butn`, `info`.

### Startup

1. MFC `InitInstance` (Metalapp.cpp). A memory check warns below 40 MB.
2. `MONSTER.INI` is read (`.\system\monster.ini`, sections `[Sound]`, `[Graphics]`, `[Control]`,
   `[Game]`, `[Help]`, `[CD-ROM]`, `[Keys]`, `[Fonts]`, `[Video]`) by 0x44d350 and written back by
   0x44e790. The registry key `HKLM\SOFTWARE\Microsoft\Microsoft Games\Monster Truck Madness\2.0`
   holds `InstalledPath`, `ProductID` and the driver name `DriverX`.
3. `player.pro` (the player profile) is loaded; if absent, defaults are set (0x44cee0),
   including a three-level setting chosen from the measured CPU speed (below 133, 133-149,
   above 149; **hypothesis**: MHz, choosing the detail level).
4. PODs are mounted (section 2).
5. `UI\MTM2.loc` is loaded (the localisation table, section 17).
6. Start videos play: `[Video] StartScene0..2` = `MSLogo.smk`, `TRI.smk`, `Open.smk` (Smacker,
   `SMACKW32.DLL`).
7. The renderer is chosen (section 18) and the UI shell opens on the Start screen.

### UI screens

From the screen-state names (0x514175): **Start Screen**, **Driver Check-in**, **Race Screen**
(track and race choice), **Garage** (truck and setup), **Multiplayer Screen**, **Hall Of Fame**,
**Viewing Results**, **Instant Replay**. Dialogs: hardware/graphics, sound, radio, controls
(keyboard, joystick, wheel calibration, custom key and button binding), "Full Autopilot", driver
registration.

The UI art is resolution-independent BMPs from `UI.POD` (`UI\*.bmp`), button sounds from
`UI.POD\SOUND`, and the race loading screen uses `DATA%d.RAW`/`.ACT` (or `KOTH%d.RAW`/`.ACT`
for Summit Rumbles, which also draws the scoring rules, see section 6.3).

### Resolution sets

The game renders at `gamePIXX` x `gamePIXY` from the INI and keeps three sets of 2D art keyed on
the height: `_200` (320x200), `_400` (640x400) and `_480` (640x480). Fonts (`fnto_480.RAW`,
`fnt1_400.RAW`...), cockpit data (`.200`, `.400`, `.480`), the finder (`fi%d.raw`) and puffs
all follow it. Any other height raises "Invalid screen resolution!".

---

## 2. POD mounting and file lookup

`PODMAIN.CPP` 0x4f3ce0, `engine/pod.cpp` 0x569080-0x56a460.

- **`POD.INI`** in the game folder lists the archives: a count, then one path per line. The
  stock file mounts 19: `startup`, `music`, `sound`, `truck2`, `cockpit`, `ui`, then the 13 track
  PODs.
- If `POD.INI` is missing the game falls back to `system\startup.pod`, `system\truck.pod`,
  `system\game.pod` and `system\ui.pod` (a development layout).
- **At most 99 PODs** ("Too many .POD files at once!").
- **Only POD1** is understood: an 0x54-byte header (entry count + 80-byte comment) and
  0x28-byte directory entries.
- **Lookup** (0x569910): the requested path is upper-cased and compared, exactly, with every
  entry of every POD **in mount order; the first match wins**. Only if no POD has it is the
  path opened as a loose file on disk (0x56a2a0). Writes always go to disk.

Consequences for OpenMTM2: a track POD can override stock files only if it is listed BEFORE the
stock POD that holds them, and files are addressed by full path (`WORLD\TPARK.SIT`,
`ART\FOO.RAW`, `DATA\SOUND003.TXT`), case-insensitively.

---

## 3. Content discovery

`CRace::init` (0x417ad0) builds the track and truck catalogues by enumerating **every `.TRK`
entry and every `.SIT` entry across all mounted PODs** (0x569ab0, at most 100 of each). Trucks
are opened from the `truck` folder and tracks from `world`. There is no registry of content: drop
a POD with a `WORLD\X.SIT` into `POD.INI` and it is a track.

`truck.vox` and `mission1.vox` are fallbacks used only when no POD yields any `.TRK` or `.SIT`:
plain lists of loose files for a development build.

### Hidden content

| Content | What gates it |
|---|---|
| `CHUCK.TRK` (Chuck's car as a monster truck) | Cheat CHUCK sets `0x63f5d4 = 666`, "Restart the game to drive Chuck's car as a Monster Truck." `showHiddenTruck` in the INI. **The retail PODs contain no `CHUCK.TRK`**: the cheat only works when an add-on POD supplies it |
| `WAR.SIT` "Torture Pit" (PainCity), in `SNAKE.POD` | `0x63f5d0 = 666`, set by driving to a spot on Sidewinder Canyon (section 15) |
| `GRAVEY.SIT` "The Graveyard" (Rotterdam), in `JUNK.POD` | `showHiddenTrack` in the INI (**hypothesis**: also unlocked by progress) |

`CRace::init` names `war.sit`/`WAR.SIT` and `CHUCK.TRK` explicitly to filter them.

### Stock tracks (from the SIT headers, read with OpenPhotex)

| POD | SIT | Name | Locale | Type | CD track | Ambient | Weather mask |
|---|---|---|---|---|---|---|---|
| ALASKA | ALASKA | The Heights | Kitcanawana, AK | Circuit | 3 | 5 | all |
| AZTEC | AZTEC | The Excavation | Sierra Miguel Mountains | Circuit | 9 | 2 | all |
| BAJA | BAJA | Tumbleweed Flats | Margaritaville, TX | Rally | 7 | 8 | all |
| CRAZY98 | CRAZY98 | Crazy '98 | Margaritaville, TX | Circuit | 6 | 14 | all |
| JUNK | GRAVEY | The Graveyard (hidden) | Rotterdam | Circuit | 4 | 13 | 0x90 (Rain, Night) |
| JUNK | JUNK | Scrapyard Run | Margaritaville, TX | Circuit | 5 | 4 | all |
| MAIN | MAIN | Voodoo Island | Margaritaville, TX | Rally | 8 | 1 | all |
| OUTBACK | AUSSIE | Tinhorn Junction | Margaritaville, TX | Rally | 3 | 7 | all |
| ROCKQRY | ROCKQRY | Breakneck Ridge | Irwindale California | Circuit | 10 | 9 | all |
| SNAKE | SNAKE | Sidewinder Canyon | Chilean Mountains | Rally | 7 | 6 | all |
| SNAKE | WAR | Torture Pit (hidden) | PainCity | Circuit | 6 | 0 | 0x1 (Clear) |
| SUMMIT1 | SUMMIT1 | Arena Rumble | Irwindale California | Summit Rumble | 10 | 10 | 0x1 (Clear) |
| SUMMIT2 | SUMMIT2 | Pyramid Rumble | Irwindale California | Summit Rumble | 3 | 11 | all |
| SUMMIT3 | SUMMIT3 | Hypercube Rumble | Irwindale California | Summit Rumble | 10 | 12 | all |
| TPARK | TPARK | Farm Road 29 | Bubba's Backyard | Circuit | 2 | 3 | all |

"Ambient" is the number of the `DATA\SOUNDnnn.TXT` ambience script in `SOUND.POD` (section 12).
"CD track" is the Redbook track that plays as race music. `DATA\<track>.TXT` in each track POD
is an empty stub; the track description comes from the SIT header.

### Default trucks

`Truck.c` 0x4bfa10 builds fallback bodies if a TRK fails: `dx1` "Default Ford", `hx1` "Default
Chevy", `gx1` "Default Dodge", all on `tire1.bin`. Models (0x4bfa10, 0x4bb730): the body is
`<truckModelBaseName>.bin`, with lower levels of detail `<base>0.bin`, `<base>1.bin`... (a
missing one reuses the next better); the **tires** are `<tireModelBaseName>16l/r.bin`,
`10l/r`, `08l/r` (left and right, three levels of detail); then the TRK's axle model.

---

## 4. The SIT as the engine sees it

The SIT writer (0x553230) is the authoritative statement of what the engine keeps per track.
OpenPhotex already parses every field; this is the in-memory side.

Header fields, in order: `Race Track Name`, `Race Track Locale`, `Track Longtitude, Latitude`,
`Track Logo .BMP file`, `Track Map .BMP file`, `Track Fly-By .AVI file`, `Track Announcer .WAV
file`, `Track Description .TXT file`, `Track Race Type`, `@Redbook Audio Track`, `!ambient
sound, track length, weather mask`, `viewmode, spotd, spotp, spoth, zoom`, `$racetime,
raceStartTime, dragDebugTimer`, `controlflag, autoShift, autoStage, bothStaged, bothStagedPrev`,
`stageComFlag, bonusLapFlag`, then a vehicle block marked "Your Truck (Not used anymore)", then
the sections.

**The Fly-By field is overloaded.** If it reads `Sonic`, the engine sets `0x6407d8` (0x551f90),
a hidden "hard track" switch used by the physics on Professional (section 8.6). Stock SITs: every
track says `Track` except **Crazy '98** and **Torture Pit**, which say `Sonic`.

| Table | Base | Count global | Stride | Notes |
|---|---|---|---|---|
| Vehicles | 0xa98490 | 0xa2fd60 | 0x17ac | the live trucks, section 8.3 |
| Player truck pointer | `[0xa2fd70]` | | | into the vehicle table |
| Ramps | 0xa2f270 | 0xa2fd74 | 0x118 | |
| Boxes | 0xa35430 | 0xa31e84 | 0x2a4 | scenery, movable objects, checkpoints |
| Top crush | 0xa30338 | 0xa35428 | 0x2b8 | crushable cars (must be keyframed) |
| Checkpoints | 0x6f1c48 | | 0x2a4 | copies of type 6 boxes, in sequence |
| Drag lane checkpoints | 0x6e9d88 | | 0x2a4 | used in drag mode |
| Course segments (AI) | `[0x6f1c1c]` | | 0x38 | from `*** Course ***` |

Limits raised as errors: "Too many players for situation", "Too many checkpoints on this sit",
"Too many trains", "Too many sims!", "FATAL! Too many objects!".

Box `type 6` is a checkpoint; `type 10` is a moving object ("train"). Types 1 (post), 2 (barricade), 4 (pylon) and 10
pick the collision sound; 8 and 9 are camera-facing (their length and width are made equal, a
cylinder); 6, 7 and 8 never enter the collision list (0x5543c0).

**The sky** (0x42b430): the LVL's sky `.RAW`, or by weather `DUSKSKY` (Dusk), `NITESKY` (Night),
`CCLOUDS` (Rain), and `CLOUDY2` on an old-MTM level or when a file is missing. Its palette is
not its own: entries 192-207 of the sky's `.ACT` are copied into the game palette at 230-245,
the indices the sky art uses; in Cloudy weather those 16 colours are greyed.

**The stadium** (`*** Stadium ***`, 0x564ca0): `!stadiumFlag,x,z,sx,sz,stadiumModelName` (an old
form without the `!` line is `flag name` with x = z = 64, sx = 8, sz = 10). The model stands at
cell (x, z), that is (32x, h, 32z) ft, unrotated, where h is the ground height (the Snow-aware
0x5017e0) at the footprint's low corner (x - sx/2, z - sz/2); it also loops `crowd.wav` there.

**Ground boxes drawn** (0x500b80, 0x4fcbe0): every cell whose `.RA0` and `.RA1` heights differ is
drawn as a box from the grid record (lower, upper, six `.CL0` face words, a corner flags byte).
A side face is drawn only where the neighbouring cell's box does not cover it (`lower <
neighbour lower` or `neighbour upper < upper`), clipped where it meets the terrain, and a
terrain cell entirely inside a box is not drawn (0x4fc370). On Arena Rumble this draws a 140 ft
ring of `13CROAD` walls around the floor, inside the stadium's lowest stands; whether the game
really shows them that way is still to be checked against the running game.

**Which boxes are drawn** (0x54ec00): a box with a model, whose `priority` line is at most the
MONSTER.INI `detailLevel` (the stock SITs use 0, 1 and 2; the stock MONSTER.INI says 2). A
checkpoint (type 6) is drawn only on an old-MTM level (LVL line 1 = 4) outside drag mode, and
even then not when its model name's fourth letter is `O` (`CKBOX`, `CKBOXN`) unless a debug flag
(0x640784) is set. So on MTM2's own tracks checkpoints are invisible. In a Summit Rumble the
first two checkpoints are the scoring zone and the summit (SUMMIT1: 64x64x92 and 128x128x42).

---

## 5. The race loop and time

`0x52fb40` runs one race from load to results. Its shape:

1. Load the SIT (0x551d10), set up trucks (0x4198a0), load sounds, weather, textures, cockpit.
2. Post `game`/`engn` on the event bus.
3. Every frame, in this order:
   - debug situation load/save (when enabled);
   - `0x5543c0` sims, `0x5665b0` replay recorder, `0x505740`, `0x41b330` Summit scoring;
   - **`0x5859a0` the game tick** (single player) or `0x451e70` (network);
   - `0x417740`, `0x42e720` animation, `0x4df070` effects, `0x560740`, `0x5745e0` weather,
     `0x5466a0` radio;
   - network sync (`0x58e1f0`), damage broadcast `0x532900`, **`0x52f3a0` render and HUD**,
     `0x585200`, `0x533590`, `0x41fd20` sound, flip;
   - **compute the next frame's dt.**
4. On exit post `!gam`/`engn`, stop sound and radio.

### Time base

- Time is **16.16 fixed point seconds**: 0x10000 = 1 s. Race timers, countdowns, replay
  stamps and the `time` field of replay records all use it.
- `dt` (`0x682d88`) = (timer ticks since last frame) / 18, clamped to `[0, 0x644614]`. With the
  multimedia timer at 1 ms resolution (`timeBeginPeriod(1)`), **hypothesis**: the timer counts in
  units of 1/(65536*18) s, so dt comes out in 1/65536 s.
- **The simulation runs once per rendered frame with that variable dt** (section 8.1). There is
  no fixed physics rate.

### End of race

When the player finishes a single-player Circuit or Rally, the remaining CPU trucks are
**fast-simulated** to give them times: the tick runs with dt = 0x4000 (0.25 s) up to 960 times
(240 s of race time) while "Determining times for remaining trucks" is shown (0x53034c).

---

## 6. Game modes and rules

`0x6f58d8` holds the mode, copied from the SIT's race type:

| Code | Mode | UI string |
|---|---|---|
| 1 | Drag race | (code exists, see 6.4) |
| 2 | Circuit race | 400 "Circuit Race" |
| 3 | Rally race | 401 "Rally Race" |
| 4 | Summit Rumble (King of the Hill) | 403 "Summit Rumble" |
| other | | 402 "Unsupported Race Type" |

### 6.1 Start

The countdown is driven from the autopilot code (0x4805d0): `racetime` against a 3.0 s limit
(`0x647630 = 3.0`), the start-light model (`stlite.bin`, `STRTRED.RAW`/`STRTGRN.RAW`) and the
"Get Ready!" commentary. At zero every truck's state goes to 4 (go) and `raceStartTime` is
stamped. In a Rumble, `0x6407ac` is armed with the round length (`0x63f5c8` seconds); when it
runs out the race loop ends the race.

### 6.2 Circuit and Rally: checkpoints and laps

`0x485af0`, run for every truck every tick (not in mode 4):

- The truck's next checkpoint is `+0xfa8` (`nextcheckpoint`). Only that checkpoint counts.
- **Two copies per checkpoint** (set up with the level, after the boxes load): every type 6
  box, in file order, is copied to the drag-lane table `0x6e9d88` as it is (the **gate**) and to
  `0x6f1c48` with its width (box +0x68) x3 and height (+0x6c) x2 (the **detector**); length
  (+0x64, along the box's z) is unchanged. Sizes are full extents (a model's extents replace the
  SIT values, x 1/256 ft) and the bounding radius (+0x74) is the half diagonal (`0x5495e0`). A
  type 0 box standing within a checkpoint's footprint becomes type 11.
- Test, against the detector (the gate in drag mode): sphere pretest
  `|truck - cp| < (cp radius + truck radius +0xfb8) * 2`, then the truck-against-box test of
  `MTM2_PHYSICS.md` section 7.3 (`0x4a52b0`, the 12 hull points swept from last step; the wheel
  sweep is skipped), giving a penetration depth; then **direction**: the hull contact point's
  velocity (`bvel + omega x r`, to world, into the checkpoint's frame) must be positive along
  the checkpoint's z. Passing backwards does not count.
- Outside drag mode, a forward crossing of the detector is then tested against the gate: if the
  truck overlaps it the checkpoint counts, otherwise it is a **missed checkpoint** (reported once,
  until the state changes). So driving beside a gate, within the detector's triple width, is a
  miss.
- The split is the race time minus `depth / speed along the axis`, the moment of crossing.
- On a pass: segment time stored in a per-lap split table (truck `+0x910`, 20 checkpoints per
  lap, so a lap holds at most 20 checkpoints); segment counter `+0x8fc` (capped at 90); the
  checkpoint index advances; in network games the split is broadcast (packet 0x0b).
- When the index reaches the lap's checkpoint count, the lap closes: lap time summed into
  `+0xfa4`, fastest lap kept in `+0xfa0`, laps counter `+0x8f4` incremented, the "final lap"
  logic (0x52ee50) runs and the index wraps to 0. `bonusLapFlag` adds a bonus lap.
- **Missed checkpoint** (see above): for the player, the announcer
  speaks after a one-second delay, either "Now listen. What part of the word "checkpoint" do you
  not understand?" (59%) or "<<1>> has just missed a checkpoint. Turn around buddy." A **CPU
  truck** is recovered:
  - on **Professional**, it is placed at the checkpoint it missed: x and z set to the
    checkpoint's, y raised 10 ft from its own, velocity zeroed (`0x6f5a18` is a zero vector), rates and
    pitch/roll zeroed, heading set to the checkpoint's psi, then moved **20 ft back** along the
    checkpoint's axis (so it drives through the gate again);
  - on **Rookie and Intermediate**, the **helicopter** picks it up: `heliTimer` (+0x1078) is set
    to -6 s and `0x470190` starts the lift. While the timer runs, the truck step skips the normal
    physics and flies the truck with `0x46ed90` instead.

Rally and Circuit share this code; they differ in the course layout and lap count (a rally is
one lap through checkpoints).

### 6.3 Summit Rumble scoring

`0x41b330`, every tick in mode 4. Checkpoint 0 is the **scoring zone**, checkpoint 1 the
**summit**. Each truck's state is 2 inside the zone box, 1 on the summit box but outside the zone,
0 elsewhere. Then, per truck:

- every whole second of race time: **+10 points** in state 2, **-1 point** in state 0, nothing in
  state 1;
- leaving the summit (state 1 or 2 last tick, 0 now) with the cooldown at zero: **-50 points**
  and a 2-second cooldown (0x20000) before it can happen again.

The score is a float at truck `+0xf50`, sent in every network state packet in this mode. The
loading screen (Title.c 0x4d5b5c) prints the same four rules: "+10 in scoring zone", "-50 per
knock off", "-1 point off summit", "0 points outside zone".

### 6.4 Drag racing (dormant)

Mode 1 is fully coded but no stock SIT uses it and the track list calls it unsupported. It is
an MTM1 leftover, kept working:

- separate 4-checkpoint lane tables (`0x6e9d88`); finishing is checkpoint 4;
- staging: "Prestage" and "Stage" lamps on the Christmas tree (`TRLFACE.RAW`, 0x548800-0x549000),
  `autoStage` and `bothStaged` state, a staging hotkey;
- the rear axle counter-steers 25% more in this mode (section 8.7).

The `TOURNEY\*.TRN` files in `STARTUP.POD` ("Monster Truck Triathlon", "Doug's Tournament of
Evil", "Whirlwind Circuit Madness") reference MTM1 tracks (`DRAG5.SIT`, `CIRC4.SIT`,
`ISLAND.SIT`) and **no code in MONSTER.EXE reads them**. They are dead data.

### 6.5 Difficulty

`0x6407bc`: 0 Rookie, 1 Intermediate, 2 Professional. It changes:

- the transfer ratio the truck actually gets (Rookie x1.25, Professional x0.75, section 8.5);
- the CPU trucks' autopilot gains (`+0x8b8`/`+0x8c0` = 0.5 Rookie, 0.75 Intermediate, 1.0 Pro);
- with the `Sonic` track flag on Professional: two simulation gains (0x647634 1.75 to 2.0,
  0x647658 0.45 to 1.0) and engine torque x1.1 for CPU trucks (x0.9 when a truck has the
  `+0x176c` flag set).

### 6.6 Results and Hall of Fame

Results show per-truck place, time, laps and the winner model (`winner.bin`, `WINNASS*.RAW`),
then win, lose or "other" videos chosen at random from `[Video] Win*`, `Lose*`, `Other*`,
`WinWCW*`, `LoseWCW*`. The Hall of Fame persists in `highscor.mtr`, one line per entry written as
`%d,%s,%d,%s,%d,%f,%f` (0x4c7540): **hypothesis** rank, player name, skill level, truck name,
points, time, fastest lap.

---

## 7. Controls

`0x584490`, every tick, for the player truck unless autopilot is on.

### Throttle and brakes

Keyboard input ramps instead of switching. The routine first scales the frame time by 0x7fff
in 16.16 (`dt' = dt * 0x7fff / 0x10000`, about dt / 2), so every stored rate runs at half speed:

- throttle `+0x560` rises at **3.5 dt'** (about 1.75 per second) to 1.0 and decays at **8 dt'**;
- brakes `+0x2b4` (front axle) and `+0x524` (rear axle) rise at 3.5 dt' and decay at 8 dt';
- the throttle decays on release **only with autoShift**: without it, releasing accelerate
  leaves the throttle where it is until the brake key clears it (as read from the code; to be
  checked in play);
- with `autoShift` on, holding brake when the truck is stopped or rolling backwards selects
  reverse and the brake key then drives it; pressing accelerate while in reverse selects first
  again. Without `autoShift`, or while moving forward, brake only brakes.

### Steering

The steering angle `s` (`+0x298`, front axle) is shaped:

    lin = sign * 0.45 * (|s| / 0.45) ^ (1 / e_prev)   the linear angle, with last frame's e
    lin -= dt' (left held) or += dt' (right held), clamped to +-0.45;
         a side not held returns lin towards 0 by 4 dt' without crossing it
    s   = sign(lin) * 0.45 * (|lin| / 0.45) ^ e
    e   = (1 + 0.25 * r) * clamp(|bvel.z| * 0.025, 1.0, 1.1)
    r   = steeringResponse * 0.1          (MONSTER.INI [Control], default 10, so r = 1)

So full lock is **±0.45 rad**, keyboard steering is non-linear (exponent 1.25 at low speed rising
to 1.375 above 44 ft/s), and steering response is a user setting.

**Four-wheel steering:** the rear axle `+0x508` = **-0.33 x front**, and -0.4125 x front in drag
mode.

### Joystick, gamepad and wheel

`[Control] joystickActive` picks the device: 0 keyboard, 1 gamepad, 2 joystick or wheel, 3 the
same with a separate rudder axis. The keyboard routine always runs first.

**Gamepad (1)** is digital (`0x585da0`): each frame the stick sets the Turn Left, Turn Right,
Accelerate and Brake key states when it is more than `nullZone` raw units from its calibrated
centre (left of centre is left, up is accelerate), and the keyboard routine above does the rest,
ramps and all.

**Joystick or wheel (2, 3)** is analog (`0x5853b0`), once per simulation sub-step before the
trucks move, and it overwrites what the keyboard set. It does nothing in a replay or while the
truck is under autopilot. With `n = nullZone / 65536`:

    x  = (stick x - centre) / (centre - min, or max - centre on the right)     -1..1
    x  = x + n, clipped at 0, when x <= 0;  x - n, clipped at 0, otherwise
    x  = x / (1 - n)
    x  = x * 0.75 on Rookie, except in a drag race
    s  = sign(x) * min(1, |x| * 1.11) ^ e
    e  = (1 + 2 * r) * clamp(|bvel.z| * 0.025, 1.0, 1.1)        r as for the keyboard
    front steer = 0.45 * s;  rear = -0.33 x front (-0.4125 x in a drag race)

So the stick reaches full lock at 90% of its throw, and its curve is much steeper than the
keyboard's (exponent 3 at low speed with the default response).

The pedal axis `y` is the stick's y (or, with `useThrottleFlag`, a separate throttle axis around
the midpoint of its range; with mode 3 and no throttle flag, the rudder axis), normalised the
same way with the same dead zone, and negated when `swapBrakeAndThrottle` is set. Negative is
forward:

- `y <= 0`: throttle = -y, brakes 0. With autoShift, in Reverse, first gear is selected (in a
  drag race only after 3 course segments).
- `y > 0.25`, autoShift, not in Park, rolling backwards or stopped (`bvel.z <= 0`, and in a drag
  race after 3 segments): Reverse is selected, brakes 0, and throttle = y (it drives backwards).
- otherwise: throttle 0, both brakes = y.

Joystick buttons give the shift requests (+1 / -1) and the bound actions (`buttonFunction0..7`).

### Other bindings

The `[Keys]` section stores DirectInput scan codes plus Windows VK codes for 29 actions:
Accelerate, Brake, Turn Left/Right, View Left/Right/Forward/Back, Up/Down Shift, AutoStage,
Next View, Cockpit View, Finder, Dashboard, Map, Names, Chat, View Next/Prev Chat, Pitboard,
Camera, Horn, Helicopter, YeeHaw, Next/Prev CD Track, Crash Damage, Pause, Escape, Control,
Radio, Headlights. Joystick buttons map to the same action numbers (`buttonFunction0..7`).
Gameplay-relevant ones:

- **Helicopter**: lifts a stuck truck and sets it back on its wheels (`heliTimer`, `heliTheta`...
  in the truck, `heli.bin`).
- **Crash Damage** (`0x647748`): toggles damage; turning it off repairs every truck.
- **Autopilot** levels in `0x6f5d8c`: 0 off, 1 and 2 (speed control, then full), 3 handled
  separately in drag mode for autostage.
- **Horn**, **YeeHaw** and the kooky horn are sounds broadcast to other players (packets 0x1d,
  0x1e).

---

## 8. The simulation

This section gives the overview. The full specification of the tire, suspension, contact,
collision and integration models is in **`MTM2_PHYSICS.md`**.

### 8.1 Stepping

`0x46c0e0`, called from the game tick:

    dt_sim = dt * (1/65536) * timescale        timescale 0x647640 = 1.0
    n      = 1, or ftol(dt_sim * 10) + 1 when dt_sim > 0.1
    dt_sim = dt_sim / n

then `n` times:

1. `0x5853b0`, `0x487300` (pre-step);
2. for every sim object, by kind: **kind 1** a free rigid body (moved boxes) `0x470d70`;
   **kind 4** a truck `0x470810`; kind 5 a marker;
3. `0x488d90` collision detection, filling a contact list per object (50 slots, 999 = ground);
4. `0x489f90` collision response for each contact;
5. `0x471280` post-step.

So **physics substeps never exceed 0.1 s, and at normal frame rates the simulation takes exactly
one step per frame.** A Rain weather sets the global grip factor `0x6cef70` to 0.8, Snow to 0.6.

`0x46c770` is an older copy of the same loop with no substepping. Nothing references it.

### 8.2 The truck step (0x470810)

For the current truck (`0x6cef34`):

1. `0x4e1ad0` autopilot inputs (CPU trucks, or the player with autopilot);
2. `0x480410` course following (with the reverse-course debug toggle `0x647564`);
3. `0x47f7d0` for each of the four tires (front axle right/left at `+0x4c`/`+0x160`, rear at
   `+0x2bc`/`+0x3d0`): ground contact, wheel spin, engine torque, tire forces;
4. `0x477520` transmission and suspension: automatic shifting (8.5), axle articulation;
5. gravity: weight = (`+0x5a0` + `+0x51c` + `+0x1040` + `+0x2ac`) pounds; mass = weight / 32.174;
6. `0x474f90`, `0x47c870`, `0x475180`, `0x475960`: forces and moments in body axes, including
   aerodynamic drag (`0x4740c0` uses rho = 0.002377 slug/ft3 and rho/2);
7. `0x46cfe0`, `0x469a40`, `0x46d270`, `0x46d730`: rotate into body axes, apply inertia
   (`+0x1044` Ixx, `+0x1048` Iyy, `+0x104c` Izz);
8. **explicit Euler**: angular rates `p, q, r` (`+0x1034`) += dt * angular acceleration; body
   velocity `bvel` (`+0xff8`) += dt * acceleration;
9. `0x46da30` position `ipos` (`+0xfe0`) from velocity; `0x46e200` Euler angles
   `theta, phi, psi` (`+0x101c`) from rates;
10. tires again (wheel positions after the move), then `0x471d70`.

While `heliTimer` (+0x1078) is positive, steps 1-10 are skipped and the helicopter code
`0x46ed90` carries the truck instead (constants 800, 4, 5, 11.5, 10, 40, pi/4).

A kind 1 rigid body (`0x470d70`) uses the same integrator with a box inertia
`I = m * (a^2 + b^2) / 12` from the box's length, width and height and its mass in slugs.

### 8.3 The truck object

The live truck is the vehicle table entry (`0xa98490 + i * 0x17ac`); `[0xa2fd70]` points at the
player's. Offsets confirmed in this build (the replay and SIT field names in brackets):

| Offset | Field |
|---|---|
| +0x4c, +0x160, +0x2bc, +0x3d0 | tire blocks, 0x114 bytes each (FR, FL, RR, RL) |
| +0x54 (tire +0x08) | tire cut 0/1/2 |
| +0xd8 (tire +0x8c) | surface grip factor for this tire |
| +0x50 (tire +0x04) | `on_gnd` |
| +0x274 / +0x4e4 | axle angle, front / rear |
| +0x280, +0x284 / +0x4f0, +0x4f4 | axle parameters (0.5, 2.0) |
| +0x294 / +0x504 | axle longitudinal position, front / rear (5.67, -4.0 ft by default) |
| +0x298 / +0x508 | steering angle, front / rear |
| +0x29c, +0x2a0 / +0x50c, +0x510 | suspension spring and damper, front / rear |
| +0x2a8 / +0x518 | 15000, front / rear (**hypothesis**: spring force limit) |
| +0x2ac / +0x51c | axle weight, lb (2000 each) |
| +0x2b4 / +0x524 | brake 0..1, front / rear (`faxle_brake_pct`, `raxle_brake_pct`) |
| +0x52c | engine rpm |
| +0x534 | engine torque this tick |
| +0x540, +0x544, +0x548, +0x54c | torque curve: scale, a, b, c |
| +0x550 | rpm limit (8500) |
| +0x558, +0x55c | upshift rpm (7000), downshift rpm (3500) |
| +0x560 | throttle 0..1 (`eng_throttle`) |
| +0x568 + 4 * gear | overall gear ratio table |
| +0x584 | transfer ratio |
| +0x58c | gear: 1 P, 2 R, 3 N, 4..6 first to third (`xm.gear`) |
| +0x590 | manual shift request, +1 / -1 |
| +0x5a0 | a fourth weight term (**hypothesis**: driver/engine) |
| +0x5b0..+0x63c | default body collision points (overridden by the TRK's scrape points) |
| +0x894, +0x898 | `ap.autopilot`, `ap.cnumber` (current course segment) |
| +0x89c, +0x8a0, +0x8a4 | autopilot target speed (min 17 ft/s), speed gain 1.2, torque gain 0.05 |
| +0x8a8, +0x8ac | `ap.speed_control`, `ap.course_control` |
| +0x8b8, +0x8c0 | autopilot difficulty gains |
| +0x8f4, +0x8fc | laps, segments |
| +0x910.. | split times, 20 per lap |
| +0xf50 | Summit Rumble score |
| +0xfa0, +0xfa4, +0xfa8 | fastest lap, total time, next checkpoint |
| +0xfb0 | `autoShift` (copied from the global setting) |
| +0xfe0 | `ipos` x, y, z (ft) |
| +0xff8 | `bvel` x, y, z (ft/s, body axes; z forward) |
| +0x101c | `theta, phi, psi` (rad) |
| +0x1034 | `p, q, r` (rad/s) |
| +0x1040 | body weight, lb (6000) |
| +0x1044, +0x1048, +0x104c | Ixx, Iyy, Izz, slug ft2 (5000, 5000, 7500) |
| +0x1050..+0x1070 | aero and damping terms (125, 150, 75, 1.5, 1.5, 5, 1000, 500, 50) |
| +0x1074 | drive type, 4 = four-wheel drive |
| +0x1078..+0x1090 | helicopter timer, angles and position |
| +0x10ac | TRK file name |
| +0x1130 | TRK `Instrument Cluster` name (default `richford`) |
| +0x1140, +0x1150 | TRK `Wave File` entries (default `default.wav`) |
| +0x1734..+0x1740 | the TRK's original axle z positions, before the 11.6 ft wheelbase clamp |
| +0x1760, +0x1764 | last impact force, `damageCode` |
| +0x176c | a per-truck flag scaling engine torque by 0.9 |
| +0x1770 | vehicle number |

**The SIT writer's record is not the live truck.** `0x6ee908` is the separate "Your Truck (Not
used anymore)" block that the SIT writer prints first; it never moves. The live player truck is
`[0xa2fd70]`, and the game itself reads `ipos` at `+0xfe0` of it every tick (section 15).

### 8.4 Default truck parameters

MTM2's TRK files carry geometry only. Every physical quantity is set in code, by `0x4bd480`,
the same for every truck:

| Quantity | Value |
|---|---|
| Body weight | 6000 lb |
| Front and rear axle weight | 2000 lb each (total 10,000 lb, 310.8 slugs) |
| Inertia Ixx, Iyy, Izz | 5000, 5000, 7500 slug ft2 |
| Front and rear axle position | +5.67 ft, -4.0 ft |
| Suspension spring | 2757.67 front, 3909 rear (before the Garage setting, 8.5) |
| Suspension damper | 3.5 * sqrt(spring) |
| Torque curve | T(rpm) = **1700 * (-2.367e-8 rpm^2 + 9.467e-5 rpm + 0.905)** lb ft |
| Torque peak | about 1700 lb ft at 2000 rpm, falling to zero near 8500 rpm (1056 at 6000) |
| Idle | 800 rpm floor |
| Rpm limit | 8500 |
| Auto upshift / downshift | above 7000 rpm / below 3500 rpm |
| Gear ratios (overall) | R -60, 1st 40.467, 2nd 24.017, 3rd 16.45 |
| Gear ratio steps | 2.46 : 1.46 : 1.00 |
| Transfer ratio | 1.185 (Garage 1500) |
| Drive | four-wheel |
| Autopilot | target speed floor 17 ft/s, gains 1.2 and 0.05 |

### 8.5 Garage settings

Stored per driver and applied when trucks are set up (`0x4198a0` calls the three setters):

**Transfer gear** (0x4c1300): the slider value 0..2000 picks `table[value / 100]` from
`0x647750`:

| Setting | 600 | 700 | 800 | 900 | 1000 | 1100 | 1200 | 1300 | 1400 | 1500 | 1600 | 1700 | 1800 | 1900 | 2000 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ratio | 1.682 | 1.609 | 1.565 | 1.5 | 1.4 | 1.36 | 1.306 | 1.269 | 1.222 | 1.185 | 1.143 | 1.107 | 1.069 | 1.034 | 1.0 |

then **x1.25 on Rookie and x0.75 on Professional**. (Below 600 the table is zero, which is why
the patch resets out-of-range transfer settings.)

**Suspension** (0x4c1210): setting 0, 1, 2 = soft, medium, hard. Springs are derived from the
static load on each axle:

    W          = front axle + body + rear axle weight
    k_front    = (-z_rear / (z_front - z_rear)) * W * 0.5 / s
    k_rear     = ( z_front / (z_front - z_rear)) * W * 0.5 / s
    damper     = 3.5 * sqrt(k)
    s          = 1.0 soft, 0.75 medium, 0.5 hard

**Tire cut** (0x4c11e0): 0, 1, 2 = shallow, medium, deep, stored in every tire.

### 8.6 Surface grip

Each tire looks up the ground type under it (`.TTY` value / 100, see OpenPhotex) and sets its
grip factor (`0x47cb50`). Type names follow Traxx's numbering, as JSTrackViewer uses:

| Type | Traxx name | Shallow | Medium | Deep |
|---|---|---|---|---|
| 1 | Cement | 1.0 | 0.9 | 0.8 |
| 2 | Dirt | 0.9 | 1.0 | 0.9 |
| 3 | Water | 0.8 | 0.9 | 1.0 |
| 4 | Mud | 0.8 | 0.9 | 1.0 |
| 5 | Sand | 0.8 | 0.9 | 1.0 |
| 6 | Grass | 0.9 | 1.0 | 0.9 |
| 7 | Gravel | 0.8 | 0.9 | 1.0 |
| 8 | Ice | 0.6 | 0.8 | 1.0 |
| 9 | Snow | 0.6 | 0.8 | 1.0 |
| 10 | Metal | 0.9 | 1.0 | 0.9 |
| 11 | Wood | 0.9 | 1.0 | 0.9 |
| 12 | Rocks | 0.8 | 0.9 | 1.0 |
| 0, 13+ | Default | 1.0 | 1.0 | 1.0 |

These factors multiply each surface's base friction coefficient (Cement 1.0 down to Ice 0.2,
see `MTM2_PHYSICS.md` section 2.3), and the weather factor (Rain 0.8, Snow 0.6) multiplies on top. The depth (value % 100) is used
separately (**hypothesis**: sink depth and rolling drag, not yet traced).

### 8.7 Other constants in the simulation block

| Value | Where | Reading |
|---|---|---|
| 32.174 | 8 sites | g, ft/s2 |
| 0.031081 | many | 1/g, pounds to slugs |
| 0.002377, 0.0011885, 0.00059425 | 0x4740c0, 0x475180, 0x474f90 | air density and its halves |
| 14.67, 29.34, 58.68, 102.69 | tires, transmission | 10, 20, 40, 70 mph in ft/s |
| 0.0833333 | inertia | 1/12 |
| 500000 | 0x46cfe0 | |
| 16000, 3200 | 0x47dce0 | |
| 1800, 900 | 0x487c60 | |
| 0.45, -0.45, 0.33, 1.25 | autopilot steering | the same steering limits as the player |
| 1/30 | autopilot integrator | |

---

## 9. AI (autopilot)

CPU trucks and the player's autopilot use the same code.

- **Courses** come from the SIT's `*** Course ***` block (`c1Count, course_direction`, then per
  segment `ctype, cspeed_type`, `cstart`, `cend`, `cdec_point, cspeed, lastentry`,
  `cSpeedLimit, cTrackWidth`; MTM2 adds extended courses). In memory each segment is 0x38 bytes
  at `[0x6f1c1c]`; the truck follows `ap.cnumber`.
- **Speed control** (0x4805d0): target = the segment's `cspeed` when set (> 10), never below
  17 ft/s; a P controller on the predicted acceleration (engine torque through the current gear
  and transfer, minus drag and brake losses) with gain `+0x8a0` = 1.2 sets throttle and brake.
- **Course control** (0x481ea0, 0x483600): steering toward the segment, clamped to ±0.45 with
  the same 0.33 rear counter-steer, integrated at 1/30.
- **Difficulty** scales the gains (section 6.5). On a missed checkpoint a CPU truck is placed
  onto it (Professional) or helicoptered back (Rookie, Intermediate), section 6.2.
- Default CPU driver names (0x551f90): Mark, Greg, Rich, Brett, Gaither, Chuck, Terry, Joe
  (presumably the developers).

---

## 10. Crash damage

`core/TruckDmg.c`, 0x532140, called from collision response with the impact force (`+0x1760`):

- `damageCode` (`+0x1764`) holds **12 zones x 2 bits**: zone *n* (1..12) at bits `2n..2n+1`.
- Level from the impact force: up to 10000 = 1, up to 30000 = 2, above = 3. A zone only gets
  worse.
- Every damageable vertex within the zone's radius of the impact is pushed in, in all three LODs
  at once (16, 10 and 08). Radii (`0x650ef8`, squared before use): 512 for zones 1-4, 384 for
  zones 5-12, in model units.
- Off when Crash Damage is toggled off (`0x647748`); toggling off repairs (`0x4c17f0`).
- Damage is replicated in network games (packet 0x20 from 0x532900).
- `GOODY.BIN` is loaded alongside (**hypothesis**: the parts that fly off, `partsFlag`).

---

## 11. Cameras, cockpit and HUD

Camera state at `[0x6504bc]`: `+0x10` target truck, `+0x18` view mode, `+0x34..+0x48` pan
state. Modes (0x52d180):

| Mode | Name |
|---|---|
| 0 | Cockpit |
| 1 | Chase Near |
| 2 | Chase Far |
| 3 | BlimpCam |
| 4 | RaceCam |
| 5 | Chase Front |
| 6 | Chase Left |
| 7 | Chase Right |
| 8 | Chase Big Rear |
| 9 | Chase Big Front |

Demo mode cycles the camera between trucks every 10 seconds. `stickyView` keeps the chosen
view across races. `boomZoom` sets the chase distance.

HUD text (0x52d8f0): `Place: n/8`, `Lap: n/n`, `Time Remaining`, `Best:`, `Clock:`, `Lead:` and
`Back:` gaps, "All trucks on final lap!", `fps : %f` with the FRAME cheat. The cockpit
(`COCKPIT.POD`, `Cockpit.c`, `Ckptutil.c`) is a packed-bitmap dashboard per resolution with a
speedometer and tachometer needle (`needle.bin`), gear indicator "P R N 1 2 3", mirror, the
**finder** (an arrow to the next checkpoint, `fi%d*.raw`), the **map** and the **pitboard**.

The cockpit layout is the text file `powerbig.200/.400/.480` in `COCKPIT.POD` (documented by
the MTM2 community's Trackville cockpit guide, archived at web.archive.org):

| Entry | 640x480 stock value |
|---|---|
| Background panels (front, left, right, back) | `pbig480.raw`, `pbigl480.raw`, `pbigr480.raw`, `pbigb480.raw` (640x480, pure black is transparent) |
| 3D window position and size | `0,88,640,240` (the window is fixed at 640x285; only the top offset takes effect) |
| Speedometer centre, radius, needle, zero angle, degrees per mph, face redraw box | `153,319`, `32`, `needle.bin`, `304.5`, `2.65`, `124,296,19,47` |
| Tachometer centre, radius, needle, zero angle, degrees per rpm, face redraw box | `435,307`, `24`, `needle.bin`, `153.0`, `0.0261`, `438,287,12,45` |
| Steering wheel position and size, erase window, base name | `145,330,350,150`, `174,362,466,480`, `PW480` (frames `C00`, `L05`..`L35`, `R05`..`R35` in 5 degree steps) |
| Mirrors: count, position and size, angles, translation, zoom | `1`, `535,120,105,48`, `0,0,32768`, `0,0,0`, `49152` (the last three are MTM1 leftovers) |
| Mirror frame bitmap position and size, name | `532,115,108,56`, `fordm480.raw` |
| Shifter base name, position and size | `ps480` (frames `P`, `N`, `R`, `1`, `2`, `3`), `496,272,128,192` |
| Shift light bitmap, position and size | `pl480.raw`, `378,261,18,19` |

The speedometer and tachometer zero angles and scales also drive the chase-view gauges. The gear
readout (292,418 to 346,427) is hard-coded.

The cockpit is drawn in layers: black, 3D window, mirror, redraw boxes, panels, steering wheel,
then finder, shifter and shift light. `.AAI` files are anti-alias overlays for the panels,
wheel frames and finder ring, made by TRI's `AARaw.exe`.

**Finder:** a 60x60 ring (`FI480.RAW` + `.AAI`) with the checkpoint number centred in it, a
12x6 arrow (`FI480GA.RAW` green, `FI480RA.RAW` red) under its apex, and a 6x6 dot
(`FI480GD.RAW`, `FI480RD.RAW`) that circles the ring. Green means the truck is lined up with the
checkpoint. It sits at the fixed screen box 574,7 to 635,67 and cannot be moved or resized.

### Instant replay and demos

`Demo.c`. While racing (single player only), `0x5665b0` records a snapshot **every 0x4000
ticks (0.25 s, 4 Hz)** into a ring of **2240 records of 0x6c bytes** at `0xafba20`. Record kinds:
0 a truck (`0x566d30`, the full replay record of JSTrackViewer's `MTM2_REPLAY_FORMAT.md`:
`ipos`, `bvel`, angles, rates, number, steering, tire angles, throttle, brakes, course, damage,
gear), 1 a box that is moving, 2 a top-crush object; trains appear in every snapshot, other
boxes only while they move. Playback (`CMCReplayFormView`, VCR buttons: play, pause, rewind, fast forward,
frame step, zoom, rotate, save, open) interpolates between records. The same data saved to text
is the `.rpl`/demo format (`demoLevel`, `weather`, `vehicleCount`, `detailLevel`,
`demoRecordPtr`, `demoRecordCount`, `Original object locations`, then records; writer 0x5659f0,
reader 0x565050).

---

## 12. Sound and music

DirectSound, with a software mixer, ACM for compressed WAVs and a **built-in MOD player**
("%u-channel MOD"). `[Sound]` in MONSTER.INI configures rate, bits, speaker mode, volumes, MOD
stereo separation, `UseRedBook` and `UseModMusic`.

- **Music**: Redbook CD audio (the SIT's CD track, next/previous CD track keys) or the MOD
  and WAV loops in `MUSIC.POD` (`AZTEC`, `BREAK`, `FARM`, `GRAVEX`, `ROCKX`, `SCRAP`, `SPLASH`,
  `SURF`, `VOODOO`, each `.WAV` + `.KLP`).
- **`.KLP` loop files**: text, `count loopStart loopEnd` in samples, `0` for "to the end"
  (`IDLE2M1.KLP` = `1 86339 0`).
- **Engine**: start, idle and rev loops (`STARTIDL`, `IDLE2M1`, `M1-2-M2`, `M2-2-M1`, `ACCEL3B`),
  gear change sounds (`2ndgear.wav`, `3rdgear.wav`).
- **Skids by surface** (0x41d2b0): concrete `skid-c2`, dirt `skid-d%d`, grass and gravel
  `skid-g%d`, ice and snow `spinice`/`snwskid%d`, rocks `spinroc%d`/`cornroc%d`.
- **World**: crashes, suspension, rollover, horn, YeeHaw, splash, underwater, trains
  (`tr-horn`, `train22.wav`), helicopter (`huey`), blimp, crowd, and object-specific hits by
  model name (`strike`, `hickz`, `flush`, `barn1`, `cowpain`, `doctor`, `coffin`).
- **Track ambience** `DATA\SOUNDnnn.TXT` (`SOUND.POD`), chosen by the SIT's ambient number:

      checkpoint wav file            e.g. airhorn.wav
      finish lap wav file            e.g. check2.wav
      number of one-shots
      wavName, vol, timerMin, timerMax, weatherMask      repeated
      number of looped ambients
      wavName, vol, weatherMask                          repeated

  One-shots fire at random intervals between the two timers (seconds) when the current
  weather's bit is set in the mask.
- **Commentary**: an announcer system (`Trucksfx.c` 0x421600) with event-triggered phrases
  (start, lead changes, passes, air, water, trains, missed checkpoints, finishes), each a WAV
  plus the same line as on-screen text, with `<<1>>`/`<<2>>` driver-name slots. `[Game]
  commentaryFlag` and `textCommentaryFlag` switch them. The phrase table is built into the EXE;
  `..\core\comment.txt` is a development override.
- **Radio**: real-time **voice chat** in network games (`sound/radio.cpp`), captured with
  DirectSoundCapture, compressed with ACM at `radioCompression` levels and queued in chunks.
  Also "Remote Ridicule" canned taunts (`tri%d.wav`).
- Force feedback (DirectInput) with spring, damper and lateral force from the tires; improved by
  the patch.

---

## 13. Weather

`0x657878` holds the weather; `0x574420` names it:

| Code | Weather | Fog | Notes |
|---|---|---|---|
| 0 | Clear | | |
| 1 | Cloudy | | `cloudy2` sky |
| 2 | Foggy | yes | |
| 3 | Dense Fog | yes | |
| 4 | Rain | yes | grip x0.8, rain sounds, lightning and thunder |
| 5 | Snow | | grip x0.6, snowflakes (`SNOW0-3.RAW`, `SNOFLAKS.RAW`) |
| 6 | Dusk | yes | `dusksky` |
| 7 | Night | yes | `nitesky`, headlights and brake lights matter |
| 8 | Pitch Black | yes | |

A track's `weatherMask` bit *n* allows weather *n*. `useRandomWeather` picks from the allowed
set. Rain also drives a lightning model (`boltTimer`, `flashTimer`, `light%d.wav`, thunder).

**Lens flare** (`STARTUP.POD` `DATA\SUN.TXT`, read by `weather.cpp`): type (point or offset),
initial position (256 = 1 ft), master radius (full-screen size), then 10 layers of
`texture, axis position, radius, texX1, texY1, texX2, texY2`, then 9 visibility-check rays. The
flare is drawn along the screen axis through the sun; it hides when the rays are blocked.

---

## 14. Networking

DirectPlay (`DPLAYX.DLL`, imported by ordinal: DirectPlayCreate, DirectPlayEnumerate,
DirectPlayLobbyCreate), up to 8 players, sessions named `<<1>>'s Truckin' Game`, with an
"AutoConnect test session" for development and the MSN Gaming Zone button. Team play exists
("Team Play is Active", `JTeamBtn`).

Lobby: player list with name, skill level, truck, latency and status (Normal, Racing!, Ready,
Start Screen, Driver Check-in, Race Screen, Garage, Multiplayer Screen, Hall Of Fame, Viewing
Results, Instant Replay); host changes track; missing-track checks ("You do not have this
track!!!"); the patch adds version and track-checksum warnings. Chat with private messages.

**Each machine simulates and owns its own truck** and broadcasts its state every frame. All
packets share a header `{u32 size, u32 0, u32 flags, u8 type, ...}`:

| Type | Sender | Meaning |
|---|---|---|
| 0x02 | 0x58dff0, every frame | truck state (below) |
| 0x06, 0x0d | 0x4dc00e | Remote Ridicule, chat |
| 0x0b | 0x4dc230 | checkpoint split: vehicle, checkpoint, time |
| 0x17 | 0x58e8b0 | sync ("Waiting for other players") |
| 0x19 | 0x4dc2f0 | race start |
| 0x1b | 0x511ff0 | lobby |
| 0x1d, 0x1e | 0x429490, 0x429350, 0x41e030 | horn, YeeHaw and engine start sounds |
| 0x1f | 0x585200, every frame | |
| 0x20 | 0x532900 | crash damage |
| 0x80 | 0x4ce2e0, 0x515790 | lobby control |

**Truck state, type 0x02, 73 bytes:**

| Field | Encoding |
|---|---|
| `ipos` | 3 floats |
| `bvel` | 3 floats |
| `theta, phi, psi` | each quantised to a byte, 256 per turn (x 40.7437), sent widened to float |
| throttle | byte, x255 |
| rear brake | byte, x255 |
| steering | byte, x 256 / 2pi |
| gear | byte |
| autoShift | byte |
| vehicle number | byte |
| Summit score | float, mode 4 only |

The **instant replay is disabled** when more than one networked player is in the race.

---

## 15. Cheats and debug features

Typed during a race. `0x5859a0` keeps the last 8 keys, newest first, at `0xcf5128`:

| Code | Effect |
|---|---|
| **GOLD** | toggles `0x6407c0`, the debug-key master switch (below) |
| **FRAME** | toggles the frame-rate display |
| **NOLOCK** | toggles `0x63f5cc` (**hypothesis**: frame-rate lock) |
| **3DFX** | copies `UI\triglide.dll` out of `UI.POD` to the game folder (the Glide renderer) |
| **DEMO** | toggles demo camera mode (cycles views and trucks) |
| **CHUCK** | unlocks `CHUCK.TRK` after a restart |

**GOLD mode keys**, from the community's list at mtm2.com/~mtmg/gold.php. The weather cycle, the
autopilot cycle and the slew freeze flag are confirmed in code; the rest is not yet traced:

| Key | Effect |
|---|---|
| Ctrl+Y | **Slew mode**: freezes the simulation (`0x63f524`) and moves the truck freely: arrows move, Q/A up and down, Shift faster, End/PgDn yaw, Home/PgUp roll, F5/F8 pitch, Ins/Del and keypad +/- orbit the camera, Z enters Z mode |
| Z (in slew) | Z mode: technical overlay (zoom, sector, visible and total polygons, level, model count), -/+ zoom 0.5x to 16x, Ctrl+4/Ctrl+5 BlimpCam and RaceCam, Ctrl+L load a .SIT by name |
| Ctrl+W | cycles the 9 weather states ("Weather: %s") |
| Ctrl+T | cycles autopilot: off, auto throttle, full autopilot |
| Ctrl+B | shows the collision boxes: solid, wireframe, off |
| 0 (4 in slew) | writes consecutive screenshots (PCX in software, RAW in hardware) |
| (Ctrl key) | reverse course direction (`0x647564`), debug overlay toggles |

**Torture Pit unlock** (0x585da0): on Sidewinder Canyon (`Snake.sit`), park the player truck
where `x / 32` is 155..159 and `z / 32` is 182..186, that is **x 4960-5119 ft, z
5824-5983 ft**. The game plays a scream and says "The torture room is open. Restart the game to
enter."

Debug leftovers: "VCR MODE" demo controls (normal, pause, slow, reverse, fast forward, fast
reverse, load demo, save demo), "Commentary tester", `DebugUI.txt` dump of UI and network state,
texture cache statistics, sector and polygon counts, screenshots as PCX (`vel%s.pcx`) and RAW.

---

## 16. Persistent files

| File | Written by | Contents |
|---|---|---|
| `system\monster.ini` | 0x44e790 | all settings (sections above) |
| `player.pro` | ProjNet.cpp 0x4dae90 | the driver profile, versioned ("Version is newer than supported") |
| `highscor.mtr` | 0x4c7540 | Hall of Fame, CSV-like text |
| saved games | RACE.CPP 0x41a557/0x41aea2 | text, header `MonsterTruckMadness 2.00`, version-checked |
| `*.sit` | Simobj.c 0x553230 | the debug "Save situation" writes a full SIT of the live state, `temp.sit` too |
| registry | Metalapp.cpp | `InstalledPath`, `ProductID`, `DriverX` |

---

## 17. Other data the EXE uses

- **`UI\MTM2.loc`, `MTM2-FUN.LOC`, `MTM2-PIG.LOC`**: the "TRI Message System". Text: header
  `TRI Message System`, `256`, `LOC`, then records `@@TAG` (the English key) / optional
  `@@COMMENT` / `@@STRING` (the translation). Every on-screen string goes through it
  (0x523a50). `MTM2-PIG.LOC` is a **Pig Latin** test localisation; `MTM2-FUN.LOC` another test.
  `MTM2.loc` itself is not in `UI.POD`, so the English keys are used as is.
- **`UI\RADIODLG.RGN`**: a raw Win32 `RGNDATA` for the shaped radio dialog window.
- **`STARTUP.POD`**: palettes and fog for the software renderer (`FOG\VGA.LTE/.MAP`,
  `OLDMTM.LTE/.MAP`), `STARTUP\FONT.NDX`, `DATA\SUN.TXT`, shared art and models, a zero-byte
  `DEMO\DEMO1.DMO`, and the dead `TOURNEY\*.TRN`.
- **Where files live** (stock PODs): textures `ART\*.RAW` with a same-stem `ART\*.ACT`, models
  `MODELS\*.BIN`, sounds `SOUND\*.WAV`/`.KLP`, trucks `TRUCK\*.TRK`, tracks `WORLD\*.SIT` and
  `LEVELS\*.LVL`, and the per-track files below in `DATA\`.
- **Per track** (`DATA\<name>.*`): `.ANI` texture animation, `.RA0-.RA5` and `.CL0-.CL2` ground
  boxes, `.CLR`, `.LTE` (if missing the game re-shades: "Light source shading the world..."),
  `.TEX`, `.TTY`, `FOG\<name>.MAP`, `LEVELS\<name>.LVL`, `WORLD\<name>.SIT`, all read by
  OpenPhotex.

---

## 18. Renderers and the TRI*.DLL interface

With `useDirect3D = 0` MTM2 draws with its **built-in 8-bit software rasteriser** (palette,
`.LTE` light tables, `.MAP` fog tables, perspective correction as an option). With
`useDirect3D = 1` it loads `rendererDLLPath` (0x4f44b0), checks `APIDLLInformation` and binds 27
functions:

`APIDLLInformation, init, kill, toggle, setVideoMode, restoreVideoMode, beginScene, endScene,
lockFrame, unlockFrame, selectTexture, updateTexture, setMipMapLevel, drawPolygon, drawPolygon2,
addParticle, flushParticleList, add3dLine, flushLineList, clear, clearZBuffer, clearZBox,
setFogColor, setColorTable16, sync, GetDisplayContext, ReleaseDisplayContext`

| DLL | Hardware | Imports |
|---|---|---|
| `TRID3D.DLL` | Direct3D (any card) | DDRAW |
| `TRIGLIDE.DLL` | 3dfx Voodoo | `glide2x.dll` |
| `TRINEC.DLL` | NEC/VideoLogic PowerVR | `sgl.dll` |
| `TRIREND.DLL` | Rendition Verite | `redline.dll`, `verite.dll` |

The interface is immediate mode: the engine transforms, clips (`Clipper.c`) and lights
polygons itself and hands the DLL screen-space polygons, particles and lines. Textures are
uploaded as 16-bit via a colour table built from the 8-bit palettes.
Each texture's palette is the `.ACT` of the same stem in `ART\` (`cTextureMap::load`, 0x55a690),
or the current palette (0x682a88) when there is none. All four DLLs share PDB
paths under `D:\METAL\CRUSH2\test\`.

---

## 19. What this means for OpenMTM2

Concrete behaviours OpenMTM2 should reproduce, beyond what JSTrackViewer's Test Drive does:

1. **Content model**: mount archives from a list in priority order, first match wins, then
   loose files; discover tracks as every `.SIT` and trucks as every `.TRK` in the mounted set.
   OPFS can hold the user's PODs plus a `POD.INI`-like list.
2. **Time**: 16.16 seconds everywhere; one simulation step per frame with dt capped at 0.1 s per
   substep. In a Worker the natural design is a fixed step, which is fine: the original's
   variable step is an implementation accident, not a feature.
3. **Truck defaults** (8.4), **Garage settings** (8.5), **surface grip x tire cut** (8.6),
   **weather grip** (13), **steering shaping** (7) and **difficulty scaling** (6.5) are now known
   exactly and can replace guesses.
4. **Rules**: checkpoint sequencing with the direction test and CPU respawn (6.2), Summit
   scoring (6.3), the 3-second countdown (6.1), fast-simulated finishing times (5).
5. **AI**: course segments with speed targets and a P controller (9).
6. **Network**: state broadcast per truck with the 73-byte layout (14) is a good model for
   WebRTC/WebSocket play; each client owns its truck.
7. **Replays**: 4 Hz records of trucks, moved boxes and top-crush objects (section 11) are what
   Instant Replay and CP3 `.rpl` files contain; recording them is cheap and gives replays,
   ghosts and test fixtures.
8. **Data files** worth adding readers for (in OpenPhotex): `.KLP`, `SOUNDnnn.TXT`, `SUN.TXT`,
   `.LOC`, `.RGN`, and the `.200/.400/.480` cockpit sets.

---

## 20. Corrections to existing notes

Against JSTrackViewer `docs/MTM2_PHYSICS_NOTES.md`:

| Note says | This analysis finds |
|---|---|
| "The live truck is NOT laid out like the saved record"; `+0xfe0` holds static start positions | The SIT writer's first block, `0x6ee908` "Your Truck (Not used anymore)", is the static one. The live trucks at `0xa98490 + i * 0x17ac` (player `[0xa2fd70]`) have `ipos` at `+0xfe0`, and the game reads it there every tick (torture-room check, network packet) |
| Physics update rate about 30 Hz | There is no fixed rate. The simulation steps once per frame (substeps only above 0.1 s); 30 Hz was the frame rate of the capture session |
| "MTM2 hard-codes its physics", values to be measured | They are hard-coded and now read out: section 8.4 |
| Gear ratios 2.02 : 1.29 : 1.00 from a replay | Code says overall ratios 40.467 / 24.017 / 16.45, steps 2.46 : 1.46 : 1.00; the transfer (1.185 default, x1.25 Rookie, x0.75 Pro) multiplies them. The replay fit mixes in tire slip and a transfer setting |
| Upshift about 6000 rpm | Upshift threshold 7000, downshift 3500 (`+0x558`, `+0x55c`); the measured 6000 depends on the assumed wheel radius |
| Steering lock ±0.45 | Confirmed, with the non-linear keyboard shaping of section 7 and rear counter-steer -0.33 |
| Surface grip numbers "NOT MEASURED" (`surfaces.js`) | Section 8.6 has the game's table, per tire cut |
| `0xaf38b8` demo buffer, 2.0.41 addresses | In 2.00.42 the replay ring is at 0xafba20 (stride 0x6c, 2240 records); all 2.0.41 absolute addresses are shifted |

---

Against JSTrackViewer's drive code (terrain diagonals, tire model, suspension, contacts,
ground boxes, wheelbase, water, rubber-banding), see `MTM2_PHYSICS.md` section 11.

## 21. Open questions

In order of payoff for OpenMTM2:

Items 1 to 3 of the first edition (tire model, suspension, collision response, aerodynamics)
are answered in `MTM2_PHYSICS.md`, as are collisions with every object kind, the helicopter and
the autopilot's steering and speed laws (its section 12); its section 13 lists the small details
left.

1. When `GOODY.BIN` parts spawn.
2. The `0x5a0` weight term and the meaning of `+0x2a8`/`+0x518` (15000).
3. The `player.pro` and saved-game layouts, and the Hall of Fame field meanings.
4. Packet 0x1f and the exact sync/lobby protocol.
5. The `/h` and `/j <ip>` command-line switches documented by the patch readme (not found as
   strings; probably parsed inside the MFC command-line override).

## Appendix: address index

| Address | What |
|---|---|
| 0x417ad0 | `CRace::init`, catalogues |
| 0x4198a0 | `CRace::setupTrucks` |
| 0x41b330 | Summit Rumble scoring |
| 0x44cee0 | profile load, startup defaults |
| 0x44d350, 0x44e790 | INI read, write |
| 0x46c0e0 | simulation stepping |
| 0x470810 | truck step |
| 0x470d70 | rigid body step |
| 0x47cb50 | surface grip by tire cut |
| 0x47dce0 | drivetrain and wheel torque |
| 0x4805d0 | autopilot speed control and start countdown |
| 0x485af0 | checkpoints, laps, CPU respawn |
| 0x4bd480 | truck default parameters |
| 0x4c0360 | SIT vehicle writer |
| 0x4c11e0, 0x4c1210, 0x4c1300 | tire cut, suspension, transfer setters |
| 0x4f3ce0 | POD.INI |
| 0x4f44b0 | renderer DLL binding |
| 0x52d180 | camera names |
| 0x52fb40 | race loop |
| 0x532140 | crash damage |
| 0x551f90 | SIT loader |
| 0x553230 | SIT writer |
| 0x5659f0 | demo writer |
| 0x5665b0 | instant replay recorder |
| 0x569080, 0x569910, 0x56a2a0 | POD mount, lookup, open |
| 0x574420 | weather names |
| 0x584490 | player controls |
| 0x5859a0, 0x585da0 | cheats, game tick |
| 0x58dff0 | network truck state |
| 0x6407bc | difficulty |
| 0x6407c0 | GOLD debug switch |
| 0x6407d8 | Sonic track flag |
| 0x647748 | crash damage on |
| 0x657878 | weather pointer |
| 0x682d88 | frame dt (16.16) |
| 0x6f58d8 | game mode |
| 0xa2fd60, 0xa2fd70, 0xa98490 | vehicle count, player truck pointer, vehicle table |
