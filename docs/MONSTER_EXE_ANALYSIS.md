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
for Summit Rumbles, which also draws the scoring rules, see section 6.3). The number is the screen
height (`0x644654`: 200, 400 or 480) and both files are opened from `art` (`STARTUP.POD` has
`ART\DATA200`, `DATA400`, `DATA480` and the `KOTH` set): the `.RAW` is `width x height` 8-bit
palette indices, row by row, the `.ACT` 768 bytes of RGB (0x4d5bd0; a missing `.ACT` keeps the
current palette, a missing `.RAW` is the error "Cannot find data raw").

**About screen** (view class `CAboutScreen`, dialog 7009, set up at 0x51d392, scrolled at
0x51dca0). A full 640 x 480 screen like the Hall Of Fame: the backdrop `UI\ABOUT.BMP` (a
Community Patch 3 `UI.POD` has `ABOUT480.BMP` and a large `NMABOUT.BMP` instead) with a
Continue button (`CONTBTN.BMP`) at (449, 404). The layout, in the 640 x 480 rectangles the
dialog's captions carry:

| Part | Rectangle (left, top, right, bottom) |
|---|---|
| Two caption and value pairs at the top right | (400, 10, 600, 24) and (435, 25, 600, 59); (400, 50, 600, 64) and (435, 65, 600, 79) |
| Text box | (10, 205, 365, 465) |
| Credits box | x 384, y 127, 254 px tall, as wide as the strip (constants at 0x51cf02) |

- The text box shows `UI\LEGAL.TXT` (a CRLF text file in `UI.POD`) with `<<1>>` filled with
  the program's version, major then two-digit minor and build: `2.00.42`. Its first two lines
  are the product name and `Version <<1>> MMX`.
- The credits are one tall bitmap, `UI\CREDLIST.BMP` (237 x 7604 in the retail `UI.POD`).
  500 ms after the screen opens it scrolls up through the credits box at **24 pixels per
  second** (a 50 ms timer; the row shown at the top is `elapsed ms x 24 / 1000`). It starts with
  the strip's top at the box's top, and when the strip's last 254 rows are in the box the screen
  leaves by itself, as Continue does.

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

### Default lap count

Each catalogue entry (0x128 bytes from `CRace + 0x2d54`: the count, then per track `+0x2d58`
race type, `+0x2d5c` default laps, `+0x2d60` the SIT name) gets its default laps when
`CRace::init` reads the SIT's header. It reads the line after `Track Race Type` and
`@Redbook Audio Track`; when that line starts with `!` (the MTM2 `!ambient sound,track
length,weather mask` header), the next line is read as `%d,%f,%d`, else the length is 6000 ft.
Then:

| Race type | Default laps |
|---|---|
| Circuit | `trunc(15000 / track length + 1)` (3 for the 6000 ft default) |
| Summit Rumble | 5 (minutes: the round is `laps * 60` seconds, `0x63f5c8`) |
| Rally, drag | 1 |

Choosing a track (0x418f00) copies the entry's laps into the race's lap count (`0x6407a4`)
unless the menu gives one of its own (1 or more).

Stock Circuit defaults (lengths read with OpenPhotex): The Heights 11665.5 ft, 2 laps; Torture
Pit 1579.7 ft, 10 laps; every other Circuit about 5800 to 6300 ft, 3 laps.

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

**The Fly-By field is overloaded.** It is a leftover: MTM1's alpha and beta track selection had a
fly-by button that would have played an `.AVI` preview of the track, and the feature was never
finished and was dropped from MTM1, so no code plays a fly-by. MTM2 still reads the line
(0x551f90, into `0x701510`, after the logo and map lines) and reuses it: if it reads `Sonic`, the
engine sets `0x6407d8`, a hidden "hard track" switch used by the physics on Professional (section
8.6) and by the autopilot (MTM2_PHYSICS.md 14.22). Stock SITs: every track says `Track` except
**Crazy '98** and **Torture Pit**, which say `Sonic`.

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

The renderer-facing consequences are separate from collision. Type 7 is non-colliding but keeps
its authored orientation. Types 8 and 9 yaw around the vertical axis to face the camera. An
animated BIN is a control model containing frame model names rather than polygons; those named
BINs supply the geometry and compatible frames blend in a loop. The SIT's backdrop model list is
drawn without depth testing and follows the camera, independently of ordinary placed objects.

Terrain and ground-box tiles use the game's two-pixel overlap treatment: the UV rectangle crops
two legacy pixels from each edge of a tile. The pixels are the tile's own: an atlas slot is as
wide as the track's widest tile, so where a track mixes 64 and 256 px tiles (custom tracks such
as Valparaiso Racing) the 64 px ones are cropped by eight atlas texels, and an HD replacement
by two pixels of the legacy tile it replaces. The atlas still keeps a clamped skirt outside the
cropped rectangle so filtering cannot sample an adjacent tile.

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

Finishing does not stop the simulation (the race loop is `0x52fb40`, the lap routine `0x52ee50`):

- The first truck to complete the race's laps (`laps == 0x6407a4`) sets the race-over flag
  `0x6407a8`. In single player every truck's finish lap (`0x9f5818`) becomes the lap it is on
  plus one, at most the race's laps, so the others only finish the lap they are on. That truck
  goes on autopilot (`+0x894`, `+0xfb0` flags), the finish commentary plays (`0x428300`), and if it
  is the player's the camera becomes the **RaceCam** (view 4) on it.
- Every lap completed after that is checked (`0x52ee50` again): a truck reaching its finish lap
  gets its finish commentary (`0x428050`), and if the player has finished, the RaceCam moves to the
  best-placed truck still racing.
- When no active truck is still short of its finish lap, a **cooldown of 5 seconds** (`0x6407ac` =
  0x50000) is armed. It counts down in the race loop (`0x6407ac -= dt`), the simulation, the
  trucks, the camera and the HUD all still running. When it reaches zero the end flag
  `0x640794` is set, and the next pass goes to the end of the race (`0x53034c`): the fast
  simulation below, which does nothing when everyone has already finished, then the results.
- Quitting from the Escape menu before that goes to the same place, so the remaining trucks are
  **fast-simulated** to give them times: the tick runs with dt = 0x4000 (0.25 s) up to 960 times
  (240 s of race time) while "Determining times for remaining trucks" is shown, until every truck
  has its laps.
- Demo mode (`0x9f675c`) sets the end flag at once with a timer of 30 s in a drag race (`0x1e0000`)
  and 90 s otherwise (`0x5a0000`). A Summit Rumble arms `0x6407ac` with the round length instead and goes
  to the results when it runs out, without the 5 s.
- The port adds a guard the game lacks: after the player has finished it waits at most two
  minutes for the others (a stuck CPU truck), then fast-simulates them.

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
"Get Ready!" commentary. **The start lights** are the track's own `STLITE.BIN` gantry (a SIT object over
the start line), whose lamps are faces textured `STRTRED.RAW` (5 faces) and `STRTGRN.RAW` (5).
`0x548de0(on)` runs from the same code, with `on` = 1 every frame of the countdown and 0 once it
is over, and acts only when `on` changes: it locks each lamp texture and fills every texel with a
single palette index, `STRTRED` with 1 when on and 0 when off, `STRTGRN` with 0 when on and 2
when off. In the stock level palettes index 0 is black, 1 dark red (128, 0, 0) and 2 green
(0, 128, 0): the red lamps glow through the countdown, then go dark as the green ones light. The value it sets is the **gear** (truck `+0x58c`, the index into the
gear ratios at `+0x568`): every frame of the countdown, while the race clock is at most 3 s,
every truck is put in **Park** (1), which sets both brakes and drives no wheel (MTM2_PHYSICS.md
section 7), so revving the engine moves nobody. At zero every truck goes into **first** (4)
and `raceStartTime` is stamped (`0x6f5f98`, from the player's driver); the CPU trucks also get
two flags set (`+0x694` when `0x656950` is 0, and `+0xfb0`), not traced further. In a Rumble, `0x6407ac` is armed with the round length (`0x63f5c8` seconds); when it
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

Exactly (`0x41b330`, from the code):

- **The zone and summit tests are axis-aligned point tests** on the truck's position, ignoring the
  boxes' angles. The boxes are the **gates** (the first two type 6 boxes, section 6.2; not the
  tripled detectors). A truck is inside a box when `|dx| < 0.5 * width`, `|dz| < 0.5 * length` and
  `|dy| < 0.5 * height` (the constant at `0x6078b0` is the double 0.5; sizes are full extents).
  State 2 when inside the zone box, else 1 when inside the summit box, else 0.
- Order each tick: the previous states are kept; each truck's knock-off cooldown (16.16 fixed
  point, 0x20000 = 2 s) counts down by the frame time, not below 0; the state is computed; the
  knock-off test runs (state 0 now, not 0 last tick, cooldown 0: score -50 and the cooldown set
  to 2 s); then a per-truck accumulator gains the frame time, and when it passes 1 s (0x10000)
  it loses 1 s and the score gains 10 in state 2 or loses 1 in state 0 (the doubles at
  `0x6078b8` and `0x6078c0` are 50 and 10). A score can go negative.
- The sounds `buzzer3.wav` (knock-off), `buzz3.wav` (-1) and `shutter.wav` (+10) play for the
  human driver only. The scoring code calls `0x42a090(truck, code)` with -2 for a knock-off, -1 for
  each point lost off the summit and +1 for each +10. It plays only for the local player's truck
  (`0xa2fd70`) with sound on (`0x63f4f0`, `0x657420` set, `0x6573ac` clear). One handle
  (`0x671898`) holds the last scoring sound:
  - -2: the previous scoring sound is stopped (`0x4641a0`), then `buzzer3.wav` plays at gain 1.4;
  - -1: `buzz3.wav` at gain 1.5, skipped while the previous scoring sound still plays (`0x464450`);
  - +1: `shutter.wav` at gain 1.25, skipped likewise.
  The gain is stored at the voice's `+0x70` (`0x463dd0`, section 13). They are flat, not placed
  in the world. There is no scoring or knock-off commentary.
- The round: when the countdown ends, `0x6407ac` is set to `laps * 60` seconds (laps being the
  Rumble's minutes, default 5) and the race ends when it runs out. Every truck's course (the
  SIT's 12-segment arena path) is followed by the CPU autopilot as in a Circuit, with its target
  speed never below 17 ft/s outside drag races (`0x4805d0`); there are no laps or checkpoints
  tests (section 6.2 is skipped in mode 4).
- Nothing in the CPU code reads the zone or the summit (the globals holding their positions are
  used only by scoring, the HUD and prop placement), so CPU trucks never aim for the summit: they
  follow the course, and in the three stock Rumbles they stay outside the zone and only lose
  points. The human player is the only one who scores.
- Places are by score, highest first.
- **The start** is the SIT's slots, shuffled (`0x4195d0`), as in every race. An add-on Rumble can put them all far
  from its zone: Scream3 Cemetery's eight stand on the high ground at (3550 to 3610, 3573 to 3648), outside the ring of
  stands round its pit, 800 ft from the zone at (4139.5, 4301.5). The port (`src/game/race-setup.js` `rumbleGrid`)
  then starts the trucks in a ring inside the zone instead: its own correction, not the game's.
- **A level with fewer than two type 6 boxes** (add-on Rumbles such as The Sumo Pit have one):
  mode 4 still skips the checkpoint tests, so the port scores it as a Rumble with the one box as
  the zone and no summit (no box at all: neither). What the game reads for a missing box was not
  traced; run as a Circuit instead, every pass through the box would count as a lap.
- **Where the big losses come from** (the same code, checked again): the boxes have a height, and
  the test is on the truck's centre, so a truck thrown into the air above its box is "off the
  summit" as much as one pushed off the edge. SUMMIT1's summit box spans 119 to 161 ft over a deck
  at 138, SUMMIT2's 240 to 272 over ground at 242, SUMMIT3's 151 to 189. Each exit costs 50 with only
  the 2 s cooldown between them, so bouncing in and out costs 50 every time, on top of the
  1 a second while outside. The helicopter is not offered in this mode.

The score is a float at truck `+0xf50`, sent in every network state packet in this mode. The
loading screen (Title.c 0x4d5b5c) prints the same four rules: "+10 in scoring zone", "-50 per
knock off", "-1 point off summit", "0 points outside zone".

### 6.4 Drag racing (dormant)

Mode 1 is an MTM1 leftover. No stock SIT uses it, the track list calls it unsupported, and only
remnants of it run:

- the checkpoints are copied to the drag-lane table (`0x6e9d88`) as gates; in drag mode the
  checkpoint test uses the gate directly (section 6.2);
- the keyboard keeps a drag gate (`+0x8fc` segments passed below 4: no switching between Reverse
  and first) and the gearbox a staging rule (below 3: Park and Neutral adjacent);
- the rear axle counter-steers 25% more in this mode (section 8.7);
- the Christmas tree is drawn by `0x548ff0` (seven lamps a side with the labels "Prestage",
  "Stage", "\\", " Get Set", "/", "Go", "Disqualify" at `0x651700`, colours `0x69, 0x69, 0x6f,
  0x6f, 0x6f, 0xd6, 0x9c`) and painted into `TRLFACE.RAW` by `0x548800`; the lamp bits come from
  `0x548cb0`: a lane state 1 gives 1 (prestaged), 2 gives 3 (staged), 99 gives 0x40
  (disqualified); while `bothStaged` (`0x6ee8f4`) is 2 the amber `1 << (int(timer x 8) + 1)` is
  added (timer `0x64764c`), and at 3 Go (0x20).

**None of it is driven.** `0x548800`, `0x548cb0` and `0x548ff0` have no callers (the one call to
`0x548ff0`, at `0x5492c0`, is in a routine nothing calls); the left and right lamp words
`0xa2f210` and `0xa2f230` are read there and written nowhere; `bothStaged`, `0x6ee758` and the
tree timer are only cleared by the level loader (`0x5523d6`, `0x552482`, `0x55341e`).

The port rebuilds drag racing as an addition (`src/game/drag-race.js`), from these remnants, the
strips' data, and the rules below.

**Source of the rules.** The pass's rules, numbers and codes are not read from `MONSTER.EXE`
2.00.42, where nothing drives them. They come from a description of drag racing that the author
of Community Patch 3 wrote for this project
(`https://www.mtm2.com/~mtmg/misc/drag_racing_cp3.md`). **He provided no source code:** the
document is prose and tables that state behaviour and rules only, and nothing in this port was
written from, or with sight of, the MTM2 or CP3 sources. The document gives as its own
grounds the 1998 MTM2 source, the CP3 source and a decompile of MTM1's `MONSTER.EXE` (August
1996). That
document says the pass survived in the MTM2 source; why the retail build does not run it is
**open** (compiled out, or a routine this analysis has not found: the constants 2.0, 0.5, 30 and
33 s near `bothStaged` are what to look for). Where the port follows a CP3 correction in place of
the 1998 behaviour, the list says so.

**The strip.** A drag SIT (race type 1) has eight checkpoints with fixed meanings:

| Checkpoint | Meaning |
|---|---|
| 0 | prestage beam |
| 1 | stage beam |
| 2 | start beam: breaking it before the green is the red light |
| 3 | finish beam |
| 4, 6 | centre line of lane 0, lane 1 |
| 5, 7 | outer edge of lane 0, lane 1 |

The beams run across both lanes (on the MTM1 strips the stage beam 1.5 ft after the prestage
beam and the start beam 2.5 ft after that); the lane lines face outward. The grid has two slots, one per lane. **The lanes are the courses:** lane 0 drives
course 1 and lane 1 course 2, so on a drag strip Professional's course 2 rule (section 9) does
not apply. A strip with no course 2 gets lane 0's course mirrored across the strip (the port's).
A J-drag runs out, turns and comes back; its finish beam faces the other way and lies across the
way out (`DRAG5.SIT`: 67 ft down the strip from the start beam, across both lanes), so the
trucks pass it from in front as they leave and it counts only on the way back. On an MTM1 strip
the header's Fly-By field holds a number, the strip's base elapsed time for computer trucks
(`DRAG3.SIT`: 3.67, `DRAG.SIT`: 4.83, `DRAG5.SIT`: 12.43), used by MTM1's drag event only. The
MTM1 strips read (`DRAG`, `DRAG3`, `DRAG5`) each have a course 2 down lane 1.

**State.** `bothStaged`: 0 prestaging, 1 staging, 2 the tree, 3 green. Per truck `ap.staged`:
0 nothing, 1 prestaged, 2 staged, 3 launched, and from 95 up the truck is out:

| Code | Meaning |
|---|---|
| 95 | not a disqualification: a truck that was already disqualified ran into this one before it finished, so the pass is to be run again |
| 96 | not finished 33 s after the green |
| 97 | over its lane's centre line or edge (CP3: also backing up after the green) |
| 98 | did not prestage or stage in time |
| 99 | red light |

**The pass.**

| Phase | Rule |
|---|---|
| Prestage | each truck drives to the prestage beam. The phase ends when both have prestaged, or when one has and 30 s have passed (the port counts them from the start of the phase); a truck that has not is out (98) |
| Stage | the trucks creep to the stage beam. The phase ends when both are staged and 2.0 s have passed since the last one staged, or when one is staged and 30 s have passed; a truck that has not is out (98) |
| Tree | 0.5 s, then green; the lamps are those of `0x548cb0` above |
| Launch | a computer truck launches on the green. The port delays it by a reaction time by difficulty (0.55, 0.38, 0.24 s plus up to 0.15 s), an addition |
| Run | the elapsed time runs **from the green**, not from the truck's own start, so the reaction time is inside it. The reaction time is the start beam's crossing time minus the green |
| Timeout | a truck not finished 33 s after the green is out (96) |

The pass ends when every truck is finished or out. A red light does not end the other truck's
pass. One truck may run alone (CP3: the 1998 code never went green with one). The Disqualify
lamp shows 96, 97 and 99.

- **The beams (CP3).** A beam is broken by the **front tyre** only, never the bodywork (the 1998
  test used the body's corners, so a truck whose nose overhangs its tyre could not stage), and
  only where the tyre passes through the beam between its ends (a test by projection alone read
  a J-drag's reversed finish beam as broken from the start line). The port takes the tyre's
  leading point, on the truck's centre line, and counts a beam only when the tyre passes it from
  behind.
- **The lanes (CP3, as MTM1 had it).** Each truck is judged against its own lane's two lines,
  crossed outward (the 1998 code judged both trucks against lane 0's). The port tests the
  truck's centre.
- **Backing up (CP3).** More than 2 ft/s backwards for 0.5 s after the green, a wheel on the
  ground, is out (97). Backing up while staging is allowed.
- **A truck that is out is judged no more** (CP3). The port also holds a disqualified truck on
  its brakes.
- **Staging a computer truck.** The autopilot drives to `checkpoint[bothStaged]` at
  `clamp((distance x 2 x decel_k) ^ 1/4, 0, 2.0)` ft/s (`MAX_STAGE_SPEED` 2 ft/s) and holds the
  truck once the tree runs. `decel_k` is **not known**; the port uses 1. The port stops the front
  tyre a quarter of a foot past the prestage beam, then a quarter of the way into the gap between
  the stage and start beams, measured on the strip (2.5 ft on the MTM1 strips; CP3 measures the gap too, and lets each
  driver choose the depth, up to 85%).
- **Auto Stage.** The game's Auto Stage key (S) hands the player's truck to the autopilot
  (`controlflag` 3) until it has staged, then gives it back. The port has the key (T, since S is
  Brake) and a Game option that does the same in every pass, on by default; without either the
  player stages by hand, in any gear.
- **A single race on a drag strip (CP3):** one lap, one computer opponent picked at random (the
  list takes no more than one), or none.
- **The timing slip (CP3):** both lanes' reaction and elapsed times. The port shows it under the
  tree.

**The drag weekend.** The event around the pass: qualifying, a bracket, a winner. MTM1 had one
inside its tournaments; MTM2 cut it (the structures are commented out in its source, and the
dialogs `IDD_DRAGDRAW` (4401), `IDD_MCDRAGFINALS` (312) and `IDD_DRAGPYRAMID` (219) are resource
IDs with no code); CP3 rebuilt it as its Drag Weekend. The port follows **CP3's rules**, as the
same document describes them (its section 7; again a description, no source code), in
`src/game/events/drag-event.js`, hosted by `src/app/drag-weekend.js`.

- **The field** is 2 to 16 drivers on one strip. The bracket is the field rounded up to 2, 4, 8
  or 16, and a seed the field does not reach is a **bye**, settled at once. The rounds are the
  Round of 16, the Round of 8, the Semi-final and the Final.
- **Qualifying.** The player runs one pass alone, in the lane they like. Beside them runs a
  **measurement truck**: a plain computer truck with no personality and no launch offset, whose
  elapsed time is the weekend's **baseline**. Each computer driver's qualifying time is computed:
  `baseline / pace`, scattered by 4% either way (less for a consistent driver), about 1 run in 25
  scrappy at 10 to 22% slower (more often for a risky driver), then the launch (below; a computed
  false start is no time), then a soft cap: a computed time beats the baseline by about 3% at
  most, on a curve that flattens out, since a floor would make dead heats. Fastest first is the
  seeding; no time seeds last.
- **The first round** by seed puts the two best in opposite halves (8 drivers: 1 v 8, 4 v 5,
  2 v 7, 3 v 6), and the winner of pair p goes to pair p / 2. CP3 itself lays out 1 v N,
  2 v N - 1 in order, which its author names as a bug (seeds 1 and 2 meet before the final); the
  port uses the order he gives as the fix.
- **The lanes.** The better seed chooses and the other takes what is left. A computer driver
  takes the lane it has been quicker in this weekend, or a coin.
- **A pairing** is driven (the player is in it), watched (two computer trucks on autopilot) or
  simulated (computed: each driver's own qualifying time as the base, then their form, the
  scatter, the launch and the cap). Run All Others simulates every pairing of two computer
  drivers left in the round. Watching and simulating use the same lanes and the same launch
  roll. Win odds for a pairing come from the same numbers and are for show.
- **Settling.** Times are compared at hundredths, rounded.

  | Situation | Result |
  |---|---|
  | both have a real elapsed time (1 to 30 s) and they differ | the lower wins |
  | one is disqualified | the other wins, finished or not |
  | one has no time but is not disqualified | the other wins with a real time |
  | a dead heat | the whole pairing is run again |
  | both disqualified | the whole pairing is run again |
  | code 95 (a disqualified truck hit the clean one) | as a double disqualification: the whole pairing is run again |

  The times of a pass that is run again stay on show.
- **The launch layer.** One function gives every computer launch, driven or simulated: a
  reaction offset in seconds. Positive is a slow start, which a driven pass adds by itself since
  the elapsed time runs from the green. Negative is a false start: driven, the truck leaves that
  long before the green and the start beam gives a real red light; simulated, it loses. The foul
  rate is about 5% at risk 1.0, from about 4% for a calm driver to about 7% for an error-prone
  one. The "choker" is steady early, then has 2.5 times the risk in the semi-final and 3.5 times
  in the final. A nervier driver also stages deeper (up to 85% of the gap).
- **Form.** Each new round gives everyone still in it a new form.
- **The end.** The final order is by the round each driver went out in, then by best elapsed
  time. A drag round inside a CP3 tournament scores by that order.

The port's own, where the description gives no number: the five personalities and their values
(`PERSONALITIES`: pace 0.99 to 1.02, the share of the scatter, risk 0.8 to 1.4, the slowest
reaction 0.08 to 0.22 s), a false start's lead of 0.3 to 0.5 s on the green, the cap's curve
(`3% x (1 - exp(-gain / 3%))`), form as 1% either way on the pace, a failed qualifier's simulated
base of 1.08 baselines, and the staging depth `0.2 + (risk - 0.8) x 0.75`. Not taken: confidence
across rounds and seasons, and the split screen. Whether a driven false start always breaks the
start beam before the green is **to be checked in play** (CP3 found a truck staged shallow
absorbs it into a rolling start).

**MTM1's event, for reference** (the document's section 6, from its author's reading of the MTM1
decompile; not what the port runs). A field of 2, 4 or 8 with no byes, inside a tournament. The
player qualifies alone in the left lane (33.33 s when out); each computer truck gets the strip's
Fly-By number plus or minus 0.5 s without running; qualifying pays 100, 90, 80, 70, then 60
points. First round 1 v 8, 4 v 5, 3 v 6, 2 v 7. The player always picks the lane. A pairing of
two computer trucks is watched or skipped (base plus or minus 0.5 s, drawn until they differ).
Times are truncated to hundredths; a tie or a double disqualification runs the pairing again,
and after code 95 the wronged truck runs again alone. A round won pays 250, the final
`(7 - starting round) x 50`, a pass lost 200 unless by a red light. A tournament, when the port
has one, may want these in place of CP3's.

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

**Points** (`0x4192c0`, run when the results are built; a drag race differs): the players are ordered by laps then
race time and given the place. The base by place is 900, 700, 500, 400, 300, 200, 150, 100. In a race of more
than one lap the one truck with the fastest lap (a tie gives none) gets 100 more, and the winner `floor(100 / laps)`
more (each truck's share is 100 / laps times its flag `+0x900`, which only the winner had in the retail screenshot:
1050, 700, 500, 400 in a 2 lap Rookie race). A one lap race gives the base only (900 in a Hall of Fame screenshot).

The Winner's Circle artwork labels a seven-column table: Place, Player Name, Truck, Skill Level,
Points, Time and Fast Lap. Its two black panels are 3D views of the first- and second-place trucks,
not text panels. Results show per-truck place, time, laps and the winner model (`winner.bin`, `WINNASS*.RAW`),
then a video (0x4c64c7 to 0x4c68bb): `Win` when the player placed first, `Lose` when last (its place equals the
number of trucks, `CRace + 0xa0f8`), `Other` for any place between; after a Summit Rumble (the track's race type,
`+0x2d58` of its catalogue entry, is 4) the same with `WCW` appended (`WinWCW`, `LoseWCW`, `OtherWCW`: the
wrestling-themed videos). The list's length is its `[Video]` count key (`Win=11`), or, without one, the keys `Win0`,
`Win1`, ... found in turn (0x4c51d0); one is picked at random and played by its `[Video]` key (0x4c4f50), the INI being
`system\extras.ini` (string 135). The retail `EXTRAS.INI` lists 11, 12 and 12 videos for Win, Lose and Other, 4, 6 and 6
for the WCW sets (`OtherWCW` repeats `LoseWCW`'s first three), under `VIDEOS\`; the files are Smacker (OpenPhotex
`docs/SMK.md`). The Hall of Fame persists in the file `MTM2 High Scores` (section 16). `highscor.mtr` and its
`%d,%s,%d,%s,%d,%f,%f` lines (reader 0x4c7150, writer 0x4c7540) are dead code in 2.00.42: the two call only each
other, and nothing calls the writer.

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

### Force feedback (`0x572ae0`)

DirectInput force feedback for a joystick or wheel, run once a frame for the player's truck. The game's debug
overlay (`0x573f70`) names its five effects: a constant force ("Raw" x, y), a spring ("SpringXK"), a damper, a
friction, and a periodic shake. `MONSTER.INI [Control]` holds the settings (read at `0x44d350`, written at
`0x44e790`):

| Key | Meaning |
|---|---|
| `useForceFeedback` | on or off |
| `forceFeedbackStrength` | 0 to 100, default 70; the code uses it as a 0..1 scale (x 0.01) |
| `forceFeedbackSpringStrength` | 0 to 100, default the strength; scales the centring spring |
| `forceFeedbackWheel` | the device is a wheel: one axis, so fore-aft forces are folded into the lateral one |

It runs only in a race, with `joystickActive` 2 or 3 (a joystick or wheel, not the keyboard or the digital
gamepad), and not under autopilot or in a replay; otherwise every effect is zeroed. Each frame:

1. **Wheels** (`0x572890`, for each of the four tires): a tire on the ground counts as a contact and gives its
   surface code (`type * 100`, the value at `+0xbc` shifted right 16); a tire in the air counts as 1300. On 300 or
   1300 (water) the damper grows with the tire's depth in the water (`0.25 * min(1, depth / radius + 0.1)`);
   elsewhere the friction grows with the tire's load (`+0x8c`). Each surface met gets a weight, 30 for 1100 (Wood),
   40 for 1400, 1 for the rest, summed per surface. With both front tires in the air the friction is -0.3.
2. **The jolt.** `J = F * 6.25e-5 + dv / dt * 0.02`, with `F` the contact and collision forces in the body's force
   sum (`0x46cfe0`, lbf, body axes), `dv` the bottoming damper's velocity change (`0x46ba80`, ft/s) and `dt` the
   frame time. The vertical part is folded into the horizontal one: x and z are scaled by `|J.y| / |J.xz| + 1`, so
   the push's size is `|J.xz| + |J.y|`. A wheel then takes `x +- |z|`. A jolt is held for 0.5 s (less below a
   size of 0.4), and a new one replaces it only when it is larger on either axis. While a jolt is held it is the
   constant force, and there is no shake.
3. **Otherwise**, with a tire on the ground, the constant force leans the stick the way the truck tilts (a world
   vector of `-0.25` per contact, put in body axes, as `2 x|x|` sideways and `1.7 z|z|` fore-aft). Moving faster
   than 0.1 ft/s (`speed = sqrt(5 vx^2 + vz^2)`, body ft/s), the surface with the largest weight sets the
   **shake**: each axis an amplitude with a random sign (a wheel only the lateral one), with `r` a fresh
   `rand() / 32768`, a base frequency, and a cap on the frequency:

   | Surface | Amplitude | Base | Cap (Hz) |
   |---|---|---|---|
   | 0 | `0.405 r + 0.135` | 0.85 | 9 |
   | 100, and any code not listed | `0.09 r + 0.03` | 0.85 | 9 |
   | 200 (Dirt) | `r^2 + 0.15` | 0.6 | 7 |
   | 400 (Mud) | `0.36 r + 0.12` | 0.85 | 9 |
   | 600 (Grass) | `0.315 r + 0.105` | 0.85 | 9 |
   | 700 (Gravel) | `1.2 r^2 + 0.15` | 1.1 | 12 |
   | 900 (Snow) | `0.27 r + 0.09` | 0.85 | 9 |
   | 1100 (Wood) | 0.3, fore-aft only (a wheel: lateral) | 1.6 | 15 |
   | 1200 (Rocks) | `18 r^2` | 0.9 | 10 |
   | 1400 | 0.7, fore-aft only (a wheel: lateral) | 1.0 | 20 |
   | 300, 500, 800, 1300 | none | | |

   The amplitudes are times the strength, and below 4 ft/s also times `speed / 4`; the frequency is
   `base * speed / 8`, at most the cap. The shake is sent every 0.2 s.
4. **The spring's** stiffness follows the cornering: `k += (|F_lat| * 0.0003125 - 0.4 - k) * 0.4`, at least 0,
   with `F_lat` the player's front axle's lateral tire force less the rear one's (`0x47eb30`, lbf).
5. The constant force is times the strength, and the effects are sent one per frame in turn (all five when a jolt
   begins).

The spring, damper and friction resist the stick or wheel; only the jolt and the shake are felt as motion.

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

### 8.2b The helicopter and the pterodactyl

The flight timer `heliTimer` (+0x1078) starts at 15 s (0x41700000) and counts down; `0x46ed90` runs the
truck's flight, and `0x54f570` draws the flyer for every truck with the timer above 0.
- **Draw:** `HELI.BIN` at the truck's helicopter position (`+0x1794..+0x179c`, feet) raised 12 ft (0xc00 units of
  1/256 ft, kept at least 10 units over the ground), its heading `+0x17a0` plus half a turn (0x8000), scale 0x2000. The model is real
  size (about 8 x 8 x 22 ft). For the **player's** truck, when the counter `0x651798` is 2, `TERYL.BIN` is drawn
  instead: it is a list of four wing frames (`TERYL1` to `TERYL4`, wingspan 30 ft). The counter goes up by one
  (modulo 3) at each press of the Helicopter key that starts a call, so the second call of every three
  brings the pterodactyl. Textures `NEWHELO1/2.RAW` and `JPTER*.RAW`.
- **Flight (0x46ed90):** timer from 15 down to 11.5 s: the flyer waits at the spot where the lift-off put it,
  turning to face the truck. From 11.5 to 10 s it spirals in at 40 ft per second of timer (that is the radius and
  the height above the truck, 60 ft down to 0) and turns toward the truck at twice the angle left per
  second. Below 10 s it hangs over the truck's position, the heading the truck's, and carries it: the
  truck's pitch, roll and heading drain at 0.1 of the lift-off error per second, x and z toward the
  course segment's start, the hover height rising 5 ft/s and, for the last 4 s, falling.
- **Sounds** (0x41bbd0, while `heliTimer` is above 0): the helicopter plays `huey.wav` at gain 1.4 from its own position
  (`+0x1794`), started again whenever it ends. The pterodactyl has no `huey`: a timer (`+0x98`, in 1/65536 s) runs
  down and at 0 plays `Teradcy1.wav` or `Teradcy2.wav` at random, gain 1.5, from the pterodactyl, then is set to 1
  to 5 seconds.
- **Animation:** `TERYL.BIN` is an animated BIN (sig 0x20, four frames, all with the same vertex layout), so the
  frames blend into each other as morph targets. `HELI.BIN` holds the airframe only (no rotor geometry, nothing
  wider than 8 ft); the port adds a spinning main and tail rotor as an addition.
- **The key** (scan 0x640858, only outside a drag race and Summit Rumble): with `heliTimer` zero it is set to -15 and
  the counter goes up; otherwise it is set to 0. In the player's truck that timer is only counted while the hull rests on the
  ground with no wheel down (`updateStuck`), so in the original the key did nothing for a truck that could still
  drive: it called the helicopter only for a truck lying stuck.
- **This port** changes that: the key works at any time and at once. The truck stays frozen in the air, the
  helicopter spirals in over 1.5 s, carries it 4 s to the nearest point of the course (straights and arcs) with
  the heading the course runs there and pitch and roll levelled, sets it down in 1.5 s, and climbs away.
  Pressed again during the flight, it lets go where it is. The CPU trucks keep the game's flight above.

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
  onto it (Professional) or helicoptered back (Rookie, Intermediate), section 6.2. (The port
  sends the helicopter below Professional; on Professional the truck drives back through the gate itself,
  the helicopter only after 45 s. It also sends it when a truck makes no headway for 6 s.)
- Default CPU driver names (0x551f90): Mark, Greg, Rich, Brett, Gaither, Chuck, Terry, Joe
  (presumably the developers).
- **Who races** (single player). `CRace::init` (0x417ad0) flags `defaultOpponents` catalogue
  trucks for the CPU (MONSTER.INI `[...]` key `defaultOpponents`, built-in default 3; the stock
  INI here says 2): it draws `rand() * count / 0x7fff` up to `5 * defaultOpponents` times and
  flags each truck not yet flagged, stopping at `defaultOpponents`. `CRace::setupTrucks`
  (0x4198a0) makes the player driver 0 with the chosen truck and adds a CPU driver for each
  flagged truck other than the player's, in catalogue order (so drawing the player's truck
  leaves one opponent fewer), at most 8 drivers.
- **Professional takes course 2.** The loader (`0x4e0970`) builds the SIT's primary course as
  course **0** (`0x4e13b0(0)`) and its extended courses as courses 1, 2, ... (`0x4e13b0(k)`); course
  `n` is at `0x70cc28 + n * 0x6d68` (`0x4e1ad0`), its segment count at `-4`, its direction at `-8`.
  At the race start (`0x551f90`, outside a drag race) every truck's course (`+0xfb4`) is set to
  **course 2** when the difficulty is Professional (`0x6407bc` = 2) and course 2 has segments
  (`0x71a6f4`), otherwise to **course 1**: the trucks race the SIT's first extended course, or its
  second on Professional, never the primary one. The primary course is the map's outline
  (`0x4e1e90` reads course 0 into the map's points). The off-course re-pick (`0x486630`) searches
  course 1, or 2 on Professional, the same way (MTM2_PHYSICS.md 14.24). The stock SITs agree: each
  one's first extended course is a near copy of its primary one, the second a different line.
  A SIT with no extended course leaves course 1 empty; the port races its primary course then.
- **The grid** (0x4195d0): the drivers take the SIT's start slots in order, then the positions
  and headings are shuffled among them by a random permutation, so the player starts in a
  random one of the first `drivers` slots.

---

## 10. Crash damage

`core/TruckDmg.c`, `0x531e40` to `0x5334ac`. What the code does, read in full:

- **Zones are the 12 hull points.** Zone *n* (1 to 12) is the truck's *n*th hull (scrape) point,
  at body position `+0x5a4 + 12 n` (the TRK's scrape points). The collision response
  (`0x475960`, `0x48eb70`) runs for each hull point whose contact depth is at least -0.25 ft
  (the 12 points of `+0x808`), once per frame, and calls the damage routine `0x532140` with the
  zone and the truck's last impact force (`+0x1760`). In a single-player race every truck is
  damaged, not only the player's.
- **Switch.** `allowCrashDamage` (`0x647748`, MONSTER.INI, **0 by default**). The Crash Damage
  key (default scan code 0x2D, X) flips it and shows "Crash damage on", or "Crash damage off,
  truck repaired" (one truck) or "Crash damage off, trucks repaired" for 3 seconds; switching off
  repairs every truck (`0x4c17f0`, `0x4c1490`: the vertices go back to their stored copies).
- **Level.** `damageCode` (`+0x1764`) holds 12 zones x 2 bits, zone *n* at bits `2n` to `2n+1`.
  The level is 0 for a force of 0 or less, 1 up to 10000, 2 up to 30000 and 3 above. A zone's
  level only rises. A truck with any bit set is "damaged": its hull impacts play `suspen1` or
  `suspen3` instead of `suspen5` or `suspen6` (section 8).
- **Damageable vertices.** When a truck's models load (`0x532fa0`) each of the three levels of
  detail of the body (16, 10 and 08) gets, per zone, the list of its vertices that lie within
  the zone's radius of the zone's point. Model units are 1/256 ft (the BIN's own). Radii
  (`0x650ef8`): 512 (2 ft) for zones 1 to 4 and 384 (1.5 ft) for zones 5 to 12.
- **The push** (`0x5323e0`) runs on every call, whatever the level, for each of the three models in turn: each listed vertex whose
  *current* position is within the radius of the zone's point (in model units) moves by the
  zone's direction `D` (`0x650f30`, three signs per zone) times `(level + 1) x 16` plus a random
  0 to 8 units (`((level + 1) x 0xfffe + rand) x 16 >> 16`), every call, each vertex drawing its own
  random. Over several frames of contact a dent builds up: level 3 pushes 64 to 72 units (about
  a quarter foot) a call. `D` by zone 1 to 12 (x, y, z): (+,+,-), (-,+,-), (+,-,-), (-,-,-),
  (+,-,-), (-,-,-), (+,-,+), (-,-,+), (+,-,+), (-,-,+), (+,+,+), (-,+,+).
- With the lowest level of detail (the last of the three) the push also moves the truck's lights (`+0x1178`,
  0x68 bytes each) that lie near the zone's point and turns their cones by a random amount (section 11b). The
  levels of detail are the game's own (the body's `16`, `10` and `08` models, the tires' `16l`..`08r`); the
  renderer picks one by the model's size on the screen, and every one of them is dented.
- `0x531e40` also throws two scrape sparks every eighth of a second from a zone in contact while
  the truck is moving.
- Damage is replicated in network games (packet 0x20 from 0x532900). `GOODY.BIN` is loaded
  alongside (**hypothesis**: the parts that fly off, `partsFlag`).

---

## 10b. The truck's suspension parts

Read from the truck draw `0x54cdb0` (axles), `0x54bc00` (bars and shocks), `0x54bf00` (driveshaft)
and the ribbon routine `0x54b650`. Distances are 1/256 ft in the code, feet here. The TRK
supplies `axlebarOffset` (`+0x1744`, x y z), `driveshaftPos` (`+0x1750`), `shockTextureName`
(`+0x1110`, default `shock.raw`), `barTextureName` (`+0x1120`, default `axlebar.raw`) and
`axleModelName`; a truck's axles stand at the TRK's static z of its right front and right rear tire
(`+0x1734`, `+0x173c`), at the axle's current height and tilted by its articulation (`+0x274`, `+0x4e4`).

- **Axle bars**, two per axle: a ribbon from the axle's end (axle frame: x +-512, y -79, z 79
  toward the chassis, so behind the front axle and ahead of the rear) to a chassis point in
  the body frame: x +-(offset.x pulled in 0.1 ft toward the centre), y the offset's y held at 2 ft
  below the body origin or lower plus 39.68 units, z the offset's z. Half width 40.96 units.
- **Shocks**, four per axle: a ribbon from the foot on the axle (x +-542, y +84, z +-71) to the
  top on the body (x +-542, y 0, z = the axle's z +-71.68). Half width 38.4 units.
- **Ribbons** (`0x54b650`) are flat quads that face the viewer: the width is perpendicular to the
  line of sight, the texture runs across the width (u 4 to 250 of 256) and along the length (v 4 to
  250), stretched once between the two ends.
- **Driveshafts**, two: `drvshaft.bin` (unit length along z, radius 0.2 ft) scaled to the distance
  in the y-z plane between the transfer point (`driveshaftPos`) and the axle's centre, which
  changes as the axle moves, and turned to point from one to the other.
- The textures have no palette of their own; they use the model palette like the truck's models.

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

**Chase camera geometry** (`0x52b780` sets a mode's values, `0x52b110` places the camera each frame,
with `gViewPan` on, its default). The camera object at `[0x6504bc]`: `+0x00` distance, `+0x04`
pitch, `+0x0c` heading offset, `+0x14` zoom, `+0x18` mode, in 16.16 fixed point with angles 65536
to the turn and distances in 1/256 ft:

| Mode | distance | pitch | heading offset | zoom |
|---|---|---|---|---|
| 1 Chase Near | 0x1555 (21.3 ft) | 0x800 (11.25 deg) | 0 | 0xc000 |
| 2 Chase Far | 0x2aaa (42.7 ft) | 0x800 | 0 | 0x10000 |
| 5 Chase Front | 0x1555 | 0x800 | 0x8000 (180 deg) | 0xc000 |
| 6 Chase Left | 0x1555 | 0x800 | 0x4000 (90 deg) | 0xc000 |
| 7 Chase Right | 0x1555 | 0x800 | 0xc000 (270 deg) | 0xc000 |
| 8 Chase Big Rear | 0x1555 | 0xa00 (14.06 deg) | 0 | 0x6000 |
| 9 Chase Big Front | 0x1555 | 0x800 | 0x8000 | 0x6000 |

The camera heading follows the truck's yaw plus the offset by 4 per second of the remaining
difference. The camera sits at the truck's position (x, y, z) minus `sin(h) cos(p) d`, plus
`sin(p) d`, minus `cos(h) cos(p) d`, `d` the distance. To keep it over the ground the pitch is
raised in 0x200 steps (at most 0x3fff) until the camera at full distance is above the terrain,
then `d` is the largest of 32 equal steps that stays above it. The View keys turn the heading
offset and pitch, and two more keys change the zoom in steps of 0x1000 (0x1000 to 0x20000);
in the camera control panel (`0x50d970`, polled while its buttons are held, in a chase view only:
mode not 0) the heading offset and the pitch each move by a quarter of the frame time a frame
(`dt / 4`, so 0x4000 a second, 90 degrees), the heading offset wrapping at 0x10000 and the pitch
held to -0x3fff..0x3fff, which the placement (`0x52b110`) then lifts to 0 when below it; choosing
a view sets the mode's own pitch again (`0x52b780`);
the keyboard's View keys do the same in the camera key routine (`0x52cd90`), in any view but the cockpit (or in
slew mode): View Left adds `dt / 4` to the heading offset and View Right takes it away (wrapping at 0x10000), View
Forward adds `dt / 4` to the pitch (held at 0x3fff) and View Back takes it away (held at -0x3fff). Their default
scan codes (`[Keys]`, the value table behind `0x640910`): View Left 0x52 (Insert), View Right 0x53 (Delete), View
Forward 0x4a (keypad minus), View Back 0x4e (keypad plus); Next View is 0x2f (V), Cockpit View 0x47 (keypad 7),
Camera 0x25 (K, the watched truck, next or with Shift the one before). The zoom keys are scan codes 0x0d (=,
zoom in: `+0x14` less 0x1000, at least 0x1000) and 0x0c (-, zoom out: plus 0x1000, at most 0x20000), and they work
only in slew mode or Z mode (section 15); outside Z mode each frame sets the zoom from the view again. (The
Monster Manual, `MONSTER.HLP`, says `-` and `=` give a wide-angle view in any external view; 2.00.42's code takes
them only in those modes. The manual's other camera keys agree with the code: keypad plus points the camera up,
keypad minus down, Insert and Delete left and right, and in the cockpit plus looks back and minus shows the mirror);
View Next steps the mode 0 to 9 (Shift reverses). BlimpCam (3, `0x52c280`) and RaceCam (4, `0x52ba90`) place the camera by their own rules and set its zoom from the
horizontal distance `h` to the truck: `65536 / (h x 0.0625)` held to 0x1000..0x8000, a telephoto (about 4 to 10
degrees of view at the base of 60 degrees):
- **BlimpCam**: the target point is 1000 ft above the course's centre (`0x730728`, the average of the
  straights' midpoints). The camera is the point 100 ft from the truck on the line toward it, looking back at the
  truck, its pitch held within 0x3000 (67.5 degrees).
- **RaceCam**: the course segment `cnumber` (`+0x898`, the course with arcs between its straights) names the
  straight the truck is heading for (the next one, when it is on an arc). The camera stands a quarter of the
  way along it, or at the middle of a straight longer than 320 ft when the truck is nearer the middle than the start;
  it is held at least 14 ft over the highest of ten ground samples between it and the truck; and it is
  no farther than `(view cells - 2) x 32` ft from the truck. Pitch within 0x37ff (78.7 degrees).
- **The blimp** (`GOODY.BIN`, set up `0x5334a0`, flight `0x533590`, present at detail level 2 or more in a Circuit or
  Rally, never in a Rumble): it starts over the first straight, 100 ft above the ground, and flies to the start of
  each straight in turn at 20 ft/s, switching when within 100 ft. Its heading turns toward the target by
  pi/8 of the angle left per second; it climbs or sinks at the distance to 100 ft above the highest ground in 11 samples at
  20 ft steps ahead (on its heading and a diagonal 25 ft either side), a sink at 0.3 of that. It is drawn
  except in the BlimpCam, and hums (`blimp2.wav`, looped from the blimp, volume 1.4 and pitch 1.5 outside the BlimpCam).
**Cockpit** (0): the eye
is the point (0, 4, 1) ft in the truck's own frame, looking along the whole body's orientation
(`0x553cf0`). The cockpit's 3D window is 640 x 285 at y 88 and the panel art covers the rest.

**Caption bar**: switching view (`0x52d180`) shows `<view name> of <truck name>` (`%s of %s`, the
name looked up through the message table, the truck's display name) through the message routine
`0x414660` for two seconds. Retail screenshots show it as the game's large font (FNT2) on a dark
rectangle centred at the bottom of the view (about 30 px tall, 10 px above the edge at 480 lines);
the port sends every in-race message through it (final lap, missed checkpoint, GOLD switches).
The finder is also visible in the chase views in retail screenshots, so the port lets the Finder
key show or hide it in any view.

**Finder** (`0x4ed31d`): at the top right
(x = width - 66, y = 7), a 60 x 60 ring with the next checkpoint's number (the truck's
`+0xfa8` index plus one) in the middle, a 12 x 6 arrow at the ring's top, and a 6 x 6 dot that
circles the ring at the checkpoint's bearing from the truck's heading. Both are green while the
bearing is within 22.5 degrees of straight ahead (16-bit angle 0x3001 to 0x4fff) and red
otherwise. **Gear strip** (`0x4ebe40`): the text `P R N 1 2 3` centred at the bottom
(y = height - 17 at 480) in a small font on a black box, with a red vertical bar at the current
gear's character. **Pitboard**: only its key name and a menu bitmap exist; no drawing code was
found, so it is treated as an unused leftover.

HUD text (0x52d8f0): `Place: n/8`, `Lap: n/n`, `Time Remaining`, `Best:`, `Clock:`, `Lead:` and
`Back:` gaps, "All trucks on final lap!", `fps : %f` with the FRAME cheat. In a Circuit or Rally the
race HUD is two boxes at the top left, labels left and values right-aligned, times as
`%02d:%05.2f` (minutes, seconds):

- rows 1 to 3: `Lap:` the current lap's time so far (truck `+0xf50[lap]`), `Best:` the fastest
  lap (`+0xfa0`), `Clock:` the race clock (0 until the start);
- rows 5 and 6: `Place:` `place/trucks` (`+0x8f8`), `Lap:` `laps + 1` (at most the race's laps)
  `/laps`.

- row 4, `Lead:` when the player is first, else `Back:` (HUD routine `0x52d8f0`, near `0x52e5ce`): the
  gap, printed unsigned as `%02d:%05.2f`. In first place it compares the player with the truck
  in second, otherwise with the truck one place ahead. Let B be the rear one of the two and n its
  count of checkpoints passed in its current lap (`+0xfa8`), L its lap index (`+0x8f4`): each
  truck's time is the sum of its segment times (`+0x910`, 20 per lap) for the first n checkpoints
  of lap L plus its closed laps' times (`+0xf50[0..L)`), and the gap is B's minus the other's.
  Before either has passed a checkpoint it reads `00:00.00`. The port keeps each truck's
  crossing times (`src/game/timing.js`), which gives the same number.

- **Course map** (Map key; `0x64077c` is 0 off, 1 on, 2 on with names; drawn by `0x4e2410`, hidden
  in views 0 and 1, the cockpit ones): an overlay on the 3D window. The loop is built once at
  load (`0x4e1e90`) from the course's type 1 segments: each one's start x and z, then its end x
  and z (x 64 as integers, at most 512 points), in order and closed, so a corner between two
  straights is a chamfer. A second pass (`0x4e2160`) gives each point the unit bisector of its two
  edges (the path's normal when they are within 0.98 of in line), turned to the same side of the path each time (reversed unless it lies clockwise of the edge back to the previous point), and `0x4e2720` draws two
  lines per edge, the loop moved 3072 (48 ft) either way along those offsets. The view is
  translated by minus the player's x and z, turned by minus its yaw (`+0x1024`, 65536 per turn)
  and drawn at a fixed depth, so the truck points up. Two retail screenshots put the player's marker at about 75% of the width and 52% of the height, which is where the port draws it.
  Each truck (`0x4e1b30`) is a five-pixel plus whose grey pulses through 16 palette steps, with
  its place number 3 px below (`%s (%d)`, name and place, in mode 2), colour 1 for the player and
  7 for the rest, drawn only when 6 to 7 px inside the window. The port's pixels per foot
  (0.09 at 480 lines) is measured against a game screenshot, not read from the projection.
- **Chase gauges**: the dial centres in the 640 x 480 screenshot are about (105, 390) for the
  speedometer and (533, 390) for the tachometer, numbers 72 px out, the needle's tip about 50 px
  out; the HUD text is a light grey with a one-pixel black shadow, rows 15 px apart.
- **At higher resolutions** (measured in a 2560 x 1440 Community Patch 3 screenshot; the CP3 author
  provided no source code): the HUD fonts are drawn at a whole-number scale, 2 at 1440 lines, with
  every font pixel 2 x 2 and the shadow 1 font pixel off. The timing board is FNTO, its rows 30 px
  (15 font pixels) apart, its first letter at x = 12 and its first row's glyph tops at y = 48 (3/640
  of the width and 16/480 of the height), the values' right edge 396 px (198 font pixels) from the
  labels' left. The gauges' numbers are FNT1 at the same scale. The dial centres fit (106, 391) and
  (533, 391) in 640 x 480 terms, x scaled by the width over 640 and y by the height over 480 (424,
  1173 and 2132, 1173), with the numbers 73 x 3 = 219 px out (the radius scales with the height,
  so the dials stay round). The finder ring is 60 x 60 at the font scale (120 px), centred 72 px
  (36 x 2) from the right edge and at y = 111 (37/480 of the height). The ring art (`FI480`) is
  colour (0, 0, 128) between radii 22 and 30. In that screenshot the gauges' numbers are white
  without a shadow and the gear strip uses a 3 x 5 pixel font that no stock font sheet holds.
A standings list, `1st - ` to `8th - ` with each truck's name, is drawn instead when its
toggle (`0x6505ec`) is on. That toggle is `showInfoOverlay` (MONSTER.INI), flipped by the key at scan code
0x18 (O). In a Summit Rumble (the HUD routine's Rumble branch) it draws `Time Remaining:` and the time left as
`%02d:%05.2f` centred at the top, each over a dark box (with the full cockpit the cockpit's own box routine), then a
list down the left from x = 6: the trucks sorted by score (`+0xf50`), highest first, each row `%s%s` (the
ordinal, `1st - ` to `8th - `, and the truck's name) and its score as `%d` right-aligned, rows a font height apart,
the player's own row in colour 0xf9; the sort also sets each truck's place (`+0x8f8`). The cockpit
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

**Looking round the cab** (`Cockpit.c`, `0x4ec530`, run each frame in the cockpit view): the head's turn
(`0x63f51c`, 16-bit angle) is 0 unless a View key is held (and no chat line is being typed): View Back gives
0x8000, View Right 0x4000, View Left 0xc000 (a joystick hat or its View buttons do the same). The camera's
heading adds the turn in the cockpit view only (`0x52b110`), so the eye stays at (0, 4, 1) ft and looks back,
right or left. When the turn changes the panel bitmap is swapped for the powerbig file's matching background
(front, left for 0xc000, right for 0x4000, back for 0x8000) and recoloured for the weather (below). With the head
turned only the panel is drawn: the needles, steering wheel, shifter, shift light and gear strip are drawn for the
front view only (`0x4ebf80`), and so is the rear-view mirror (`0x4ed1c0`, `0x5751c0`). The mirror's own switch is
View Forward in the cockpit: with the full cockpit (`viewCockpit` 2) and the head forward, a press (or a new
press of its joystick button) flips `0x7b52cc`, and the mirrors are drawn only while it is set. It lies in zeroed
memory and nothing else writes it, so **the mirror is off when the game starts** and View Forward turns it on. The trucks' headlights count as "forward cockpit" only with the head forward
(section 11b).

**The panels in the weather.** Loading a panel (`0x4ec530`) recolours every non-zero pixel through the level's
light table (`DATA\<track>.LTE`, read by `0x55c540` into `0x6a71f8`, 256 entries per level) at a level set by the
weather: Cloudy 13, Foggy 14, Dense Fog 12, Rain 13, Snow 14, Dusk 11, Night 8, Pitch Black 5; Clear keeps the
art as it is. The same table and levels darken the steering wheel, shifter and finder art (`0x4e9ed0`,
`0x4ea110`, `0x4eabb0`, `0x4eb490`, all in `Ckptutil.c`): these are the "bitmap routines" of section 13.

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
reader 0x565050). The writer prints, per vehicle, the truck file then the driver name (interleaved), and the ring's write
pointer and count; records are written from the start of the ring. The port records the same
frames (`game/replay.js`) and reads and writes the file with OpenPhotex.

- **Top-crush records** (kind 2, `0x5665b0`, played by `0x566f00`): a crush car's record holds its position
  (`+0x28`), the three words at `+0x94` in the velocity slot and its angles (`+0x40`), and its number; its rates
  slot is not written. How far the roof is crushed (`+0x84`, the crushed share) is in no record, so playback moves
  the cars and leaves each one crushed as it is now: a replay shown after the race has every car as the race left
  it, from the first frame. The `.rpl` format has no field for it either.
- **Demos.** There is no separate demo format. The debug VCR menu's "7. Load demo" and "8. Save demo"
  ("Load which demo :", "Save demo (CR to abort) :") call the same reader and writer as the `.rpl` files, and the
  exe names no `.dmo` file; `DEMO\DEMO1.DMO` in `STARTUP.POD` is an empty leftover. The DEMO cheat and the start
  screen's demo are camera modes over a live race, not playback.
- **Object numbers.** A box record's number, and the line order of `Original object locations`, index the box table
  (count `0xa31e84`), not the SIT's box list: the SIT loader puts type 99 boxes in the ramp table and the top-crush cars
  in their own, so those are not counted. Where a SIT opens with ramps (Mud Pie `CIRC5.SIT` and the drag strips have
  six, `DEMO.SIT` one) object n is a later SIT box: a Community Patch 3 replay of Mud Pie lists 289 originals for the
  SIT's 295 boxes, original n at SIT box n + 6. The port records and plays numbers through this order
  (worker/track-build.js `replayBoxOrder`).
- **Timing.** The recorder adds each frame's time (16.16 ticks, `0x682d88`) to an accumulator (`0x65695c`) and takes a
  snapshot when it passes 0x3fff, so the rate follows the clock, not the physics step. The ring's write pointer
  (`0x656960`) wraps at 0x8bf and the count (`0x656964`) stops at 0x8c0. With eight trucks a snapshot is about eight
  records, so the ring holds about 280 snapshots: some **70 s**.
- **Playback.** A frame index (`0x566150`, at most 2240 entries, "Too many demo indicies!") pairs each new time with its
  first record. The clock follows real time (`0x568040`); the VCR modes (`0xb36ce0`) are 1 half speed, 2 normal,
  3 reverse, 4 double, 5 double reverse. Between frame i and i + 1 each record is blended with the record of the same
  kind and number by `k = (clock - t_i) / (t_{i+1} - t_i)` (`0x566f00`): position, velocity and rates linearly, theta
  linearly, and phi, psi, both steering angles and the four tire angles as 16-bit binary angles (the short way round);
  throttle and brakes linearly; course, damage and gear from frame i. No curve, and the velocities are not used.
- **Loading.** The reader (`0x565050`) reads `demoRecordCount` from the header and then exactly that many records, with
  no check against the ring's 2240, and closes the file. A file of more than 2240 records writes past the ring, over
  the vehicle number table (`0xb36b20`), the VCR mode, the vehicle count and the frame index: **MTM2 cannot load a
  replay longer than its ring.** More than nine vehicle numbers stops the load ("Demo fixup hose").
- **Community Patch 3** (read from its 64-bit executable in the same way; nothing from its author): the same 4 Hz
  snapshots (`0x140150410`, the same 0x3fff test) and the same blending (`0x14014ca30`), in a ring of **0x80000
  records** (524,288, about 4.5 hours of eight trucks; the pointer wraps at 0x7ffff, the frame index holds as many).
  Its reader (`0x14014cfb0`) also reads exactly `demoRecordCount` records with no cap and ignores what follows, so CP3
  loads the long replays the port saves. A new option, `replayWheelSpin` (`0x140724728`), leaves the recorded tire
  angles unapplied.
- **More frames, compatibly.** Both games stamp every record with its time and blend by those stamps, so records taken
  more often would still play at the right speed, but MTM2's ring would then cover less time. Since neither reads past
  `demoRecordCount`, the port keeps the game's 4 Hz records as they are and writes its own extra samples after them
  (OpenPhotex `writeMtmReplay`, "OpenMTM2 samples"): a 16 Hz recording that both games load as their own 4 Hz one.
  The port blends through the frames on a curve (Catmull-Rom) rather than straight lines, and its "Save for MTM2"
  keeps the newest 2240 records.

---

### 11b. The truck's lamps

(The exe has this code, but in play the lamps never showed; the port draws them as an addition, see `docs/CHANGELOG.md`, "Additions".)

The TRK lists up to 14 lamps (`Number of Lights`; 0xe or more is an error "Too many lights"), read by
`0x4bddc0` into 0x68-byte records from truck `+0x1178` (count at `+0x1174`). A record holds, in float
words: `[0]` type, `[1..3]` body position (ft), `[4..6]` the current position (a copy that damage
moves), `[7]` lens bitmap radius (ft), `[8]` heading and `[9]` its current copy, `[10]` pitch and
`[11]` its copy, `[12]` spin speed (rad/s), `[13]` cone length, `[14]` base radius, `[15]` rim
radius, `[16..19]` the cone texture name, `[20..23]` the lens bitmap name, `[24]`/`[25]` ms on and
ms off. A TRK without a lamp section gets four defaults (`0x4c1890`): two headlights (type 0,
`headlite.raw`, cone 75 ft, radius 0.7 to 11 ft, `litefuzz.raw`, pitch -10 degrees) and two brake
lamps (type 1, `brltroun.raw`, radius 0.8). Every shipped MTM2 truck has its own list, like
Monster's: two type 0 headlights (radius 1.25, heading 0, pitch -10 degrees, a 75 ft cone of
`litefuzz.raw`), two type 1 side lamps and one centre lamp (x = 0) on the cab (`brltchev.raw`,
`brlttcab.raw`, ...), type 5 reverse lamps (`brltrv.raw`), and for some trucks type 3 running lights
(a 40 ft cone) or type 4 beacons (7 ft cones of `redfuzz.raw` or `bluefuzz.raw` spinning at -2 pi rad/s,
some blinking 300 ms on, 700 off). The art is in `SOUND.POD`/`TRUCK2.POD` (lens bitmaps, 64 x 64, each
with its own `.ACT`) and `STARTUP.POD` (the cones' `*FUZZ.RAW`, 256 x 256 noise).

`0x579f10` calls `0x57a080` per lamp for every truck, every frame. The truck's **lamp switch** (`+0x1170`)
starts at 2 when the weather's lamp flag (`0x657878 + 4`: Dusk, Night, Pitch Black) is set, else 0. The
**Headlights key** (default L, scan code 38; not with Ctrl held) sets it to 2, or to 0 when it was not 0,
for the player's truck and sends packet 0x1f in a network game. A lamp's brightness `b`
by type, with "cockpit" the viewer sitting in this truck in the cockpit view (`viewCockpit` 2, head
not turned):

| Type | Lit |
|---|---|
| 0, 3 | switch = 2 and (not cockpit, or the forward cockpit): 1.0 |
| 1 | not cockpit. On the centre line (x = 0): rear brake `+0x524` > 0.01 gives 0.6, 1.0 with the switch on. Elsewhere: 0.6 when braking plus 0.4 when the switch is on |
| 2 | not cockpit, switch > 0: 1.0 |
| 5 | not cockpit, the current gear ratio (`+0x568 + 4 x gear`) negative (reverse): 1.0 |
| below 0 | the lamp flag: 1.0 |
| others (4) | switch = 2: 1.0 |

A lamp with `msOff` above 0 is lit only while `clock mod (on + off) < on`. A lit lamp's lens is a
flat bitmap decal on its body position (rotated by its heading, mirrored for lamps with x > 0), drawn
only when the viewer is in the half space the heading faces; the glow's strength is `b` times a fade
that is 1 inside the view range and 0.2 beyond it (in Foggy, Dense Fog and Snow weather also scaled
by the angle to the viewer). Where the lamp has a positive cone length and the lamp flag is set, the
beam is a six-sided truncated cone (base radius at the lamp, rim radius at the cone length) textured with
the cone bitmap and added to the scene; a beacon's heading advances by its spin speed over time.
Damage (section 10) also knocks the lamps askew. The push `0x5323e0` runs once for each of the body's three
levels of detail; with the third (index 2) it also goes through the lamps, so every damage call moves them,
whatever detail is drawn. A lamp whose current position is within 2 ft of the zone's point (distance squared
under 4): if it has a cone (`[13]` above 0), its current heading `[9]` and pitch `[11]` each take a random step of
up to 0.349 rad (20 degrees) either way (`rand * 0.349 * 2 / 32768 - 0.349`), held within 0.349 rad of the
lamp's own heading `[8]` and pitch `[10]`; then its current position moves along the zone's direction `D`
(section 10) by `rand / 65536` (0 to 0.5 ft) on x and y and a fifth of that on z.

### 11c. The sky dome

`0x42bca0` draws the dome when `skyTextureFlag` (Graphics, `0x63f4f8`) is not 0; with 0, a flat colour
cap and one textured quad are drawn instead. The dome is 16 sides around the viewer and four
rings of elevation, 0.0196 rad (1.1 degrees, not 0), 22.5, 45 and 67.5 degrees: vertex = (sin a cos e, sin e,
cos a cos e). Each side takes 64 texels of the 256 x 256 sky across (u = 64 x side), so the art repeats four times
around the horizon, and the rows go from 254 at the horizon through 170.7 and 85.3 to 2 at the top ring
(v = (1 - ring / 3) x 256, clamped to 2..254). Above 67.5 degrees the dome is open, and `0x42bca0` first draws a flat square (half width 0.556 of the dome radius, at the dome's radius height) in one colour read from a pixel of the sky texture (`0x6a93f8`, `0x695f68`), under the dome quads. The port uses the average of the texture's row 2, the colour at the top ring's edge.
The port builds exactly that dome (`skyGeometry`); it used a hemisphere with the texture stretched over it twice, which
repeated at the top.

---

## 12. Sound and music

DirectSound, with a software mixer, ACM for compressed WAVs and a **built-in MOD player**
("%u-channel MOD"). `[Sound]` in MONSTER.INI configures rate, bits, speaker mode, volumes, MOD
stereo separation, `UseRedBook` and `UseModMusic`.

- **Music**: Redbook CD audio (the SIT's CD track, next/previous CD track keys) or the MOD
  and WAV loops in `MUSIC.POD` (`AZTEC`, `BREAK`, `FARM`, `GRAVEX`, `ROCKX`, `SCRAP`, `SPLASH`,
  `SURF`, `VOODOO`, each `.WAV` + `.KLP`). `SOUND\SPLASH.WAV` is the start and menu music.
- **`.KLP` loop files**: text, `count loopStart loopEnd` in samples, `0` for "to the end"
  (`IDLE2M1.KLP` = `1 86339 0`).
- **Engine**: start, idle and rev loops (`STARTIDL`, `IDLE2M1`, `M1-2-M2`, `M2-2-M1`, `ACCEL3B`),
  gear change sounds (`2ndgear.wav`, `3rdgear.wav`).
  **The engine routine** (`0x41e030`, every frame per truck) keeps three loops playing,
  `startidl` (idle), `m1-2-m2` (mid) and `accel3b` (under throttle), each started at a random
  point in its loop. With `rpm` (`+0x52c`), `throttle` (`+0x560`) and `n` the wheels off the
  ground (4 minus the tires with their on-ground flag set):
  - pitch: `f = (n * 0.02 + 1) * rpm / 3700`; the rate is `1 + 0.5 (f - 1)`, or for `f < 1`
    the inverse of `1 + 0.5 (1/f - 1)`; clamped to 0.625..1.6; then `+ (2 u - 1) * 0.07` for a
    random `u`; times the truck's own scale (`+0x94`). Mid plays at that rate, accel at 0.65 of
    it, idle at the scale alone;
  - idle weight: 1 below 1000 rpm, falling linearly to 0 at 3000. Through the last 1.5 s of the
    countdown the running part (1 - idle weight) is held at 0 and ramps up to 1 at the start.
    Idle's gain is the idle weight times 0.97 for the player's truck, 0.85 for the others;
  - the other two share `(1 - idle weight) * k * (rpm * 5e-5 + throttle * 0.3 + 0.55)`; the accel
    weight is `taper * throttle * 0.8 + (rpm - 5500) / 2750`, clamped to 0..1, with `taper` 1
    below 2000 rpm, falling to 0.2 at 7000; mid gets `(1 - 0.95 w)` of the share and accel
    `(0.2 + 0.8 w)`;
  - the player's truck plays unpositioned, the others in 3D; with all four wheels off the ground
    and no helicopter flight, a large enough vertical speed may trigger YeeHaw.
  Samples have loop points in a `.KLP` beside them (the game starts them at random offsets).
- **The mixer** (software DirectSound mixer; `0x525260` starts a sound, `0x563800` runs each frame, `0x462d60` computes one
  sound's levels):
  - A sound object (0x10c bytes) holds its place, velocity, gain (`+0x70`), pitch (`+0xc4`, `+0xc8`), range scale (`+0xd8`,
    1.0) and flags; 140 handles at most (`0x6bcc90`, 0x14c bytes each). Flag `0x400` is a menu sound that always plays; the others
    only play while their group bit is on (`0x657398`).
  - **Audible range** (`0x41f980`, set on every race start): 1000 ft, or 500 in Foggy, 300 in Dense Fog, 800 in Rain and
    700 in Snow (`0x570290` stores the range `R`, `R^2` for the cut-off and `sqrt(R)`). A sound beyond `R` is silent; inside, its
    gain is `1 - sqrt(d) / (sqrt(R) x range scale)`, that is `1 - sqrt(d / R)`: 0.5 at a quarter of the range, 0.29 at half. A
    positioned sound is also panned and, with flags clear, given a pitch shift from the speeds (doppler) and a cone gain.
  - **Inaudible**: a sound whose left, right and mixed gains are all below 1/128 (`0x657378`) is not mixed (priority class 1);
    an audible one is class 3, or 2 while its sequence number is below `0x657458`.
  - **At most 16** sounds are mixed (`0x657450` = 16; `0x563800`): the audible ones are sorted by class, then age, then
    loudness (`0x563ab0`), and every sound past the sixteenth, or of class 1, is stopped (`0x4625d0`, stop). The master gain
    is smoothed with a product of the sounds' own scale factors.
  - The player's truck is not positioned; the other trucks play at 0.9 of the scale and their engine idle at 0.85.
  The port's `audio-engine.js` does the same: its own distance fade by `soundRange(weather)`, only the loudest 16 mixed,
  and a compressor on the master standing in for the game's master smoothing. The effects bus sits at 0.5 of the
  effects setting, the music at 1.4 of the music setting (`EFFECTS_TRIM`, `MUSIC_TRIM`).
- **Volumes** (`[Sound]` in `MONSTER.INI`, read by `0x570b50`, defaults in brackets): `MasterLVol`, `MasterRVol` (67),
  `SfxVol` (75), `ModGameMusicVol` (50), `MasterStereoSeperation`, `ModSeperation` (70). `0x5715b0` turns `SfxVol` and
  `ModGameMusicVol` into fractions and multiplies each by the master pair: one gain pair for effects (`0xb5fd88`) and
  one for music (`0xb5ff10`), the second for sounds started with flag `0x400` (`0x525260`). So the game's MOD music
  sits about 3.5 dB under its effects. Its MOD player (`0x5580f0`) loads each sample as a mixer sound; no division
  by the channel count was found. OpenPhotex's offline `renderMod` scales each channel by 1.35 over the square root
  of the channel count (about -16 dBFS RMS for `SEX.MOD`, 6 channels). The engine's loops are far hotter (`ACCEL3B`
  -2.5, `M1-2-M2` -5.6, `STARTIDL` -12 dBFS RMS), so even past the effects' trim the engine sat about 9 dB over a
  module. The port plays a MOD 2.2 times (about 7 dB) over a WAV track (`audio/world-audio.js` `MOD_MUSIC_GAIN`).
- **Skids** (`0x41bbd0` each frame per truck, the physics triggers `0x47c480` and `0x477520`). Every name below is
  MTM2's own; `SOUND.POD` also carries MTM1's skid set (`corncem%d`, `corndir%d`, `cornice%d`, `spincem%d`,
  `spindir%d`, `skidcem%d`, `skiddir%d`, `skidice%d`, `skidroc%d`, picked by MTM1's `0x43cac0`, `0x43cd60`,
  `0x43d050`), which MTM2 never plays.
  - Only the **rear tires** (RR and RL, `+0x2bc` and `+0x3d0`) have skid voices: three loops each, a corner skid
    (`0x41db00`), a wheelspin (`0x41d2b0`) and a brake skid (`0x41d6d0`). A tire's surface is its value's
    `type * 100`, -1 in the air; in Snow every surface but 1400 counts as 900 (Snow), and 1300 as 800 (Ice).
  - **Samples by surface** (the variant is random and never the one the routine played last, up to ten tries):

    | Surface | Corner (`0x41db00`) | Wheelspin (`0x41d2b0`) | Gain |
    |---|---|---|---|
    | 200, 400, 500, 600 (Dirt, Mud, Sand, Grass) | `skid-d1`/`2` | `skid-d1`/`2` | 1.1 |
    | 700, 1200 (Gravel, Rocks) | `skid-g1`..`3` | `skid-g1`..`3` | 1.3 |
    | 300, 800, 900, 1300 (Water, Ice, Snow, Deep water) | `snwskid5`..`7` (x0.35) | `spinice` (x1) | |
    | 1000, 1100, 1400 (Metal, Wood) | `cornroc1` (absent from `SOUND.POD`: silent) | `spinroc1`..`3` (x1) | |
    | anything else (Cement, Default) | `skid-c2` | `skid-c2` | 0.7 |

    The gain is that times the truck's scale (1 for the truck the camera follows, 0.9 for the others); the pitch is the
    truck's pitch scale plus a uniform `+-0.1`. They loop (`skid-c2` and `spinice` on their KLP, the rest whole) until
    stopped.
  - **Corner skid** (`0x47c480`, every step): with the truck's speed above 29.34 ft/s, each tire on the ground is
    *sliding* while its lateral coefficient `C(alpha)` (tire `+0x88`, MTM2_PHYSICS.md 14.5) is past 0.975 in size, and
    stops at below 0.95 (between, it keeps its state); slower, or in the air, none slides. When the first of the four
    starts sliding, both rear corner loops start (each only if not already playing, `0x4297a0`); when the last stops,
    both stop (`0x4296e0`).
  - **Wheelspin** (`0x477520`, every step): at full throttle (exactly 1.0) with the forward speed `|v_z|` between 1 and
    58.68 ft/s, every tire on the ground whose surface has the dust flag (8 in `0x4de180`'s low byte: Cement, Dirt and
    Sand) throws dust, and if any did both rear spin loops start (if not playing, `0x429840`). Letting go of full
    throttle, or full throttle at `|v_z|` of 1 or less or above 102.69 ft/s, stops all six skid loops (`0x429680`).
  - **Brake skid**: `0x41d6d0` (`skid-c2`, `skid-d%d`, `snwskid%d`, `skid-g%d`) is reached only through `0x4298e0`,
    which nothing calls in 2.00.42: braking makes no skid sound.
  - **A rear tire changing surface** (`0x41bbd0`) stops each of its three loops that is playing and starts it again with
    the new surface's sample; loops that are not playing stay off.
- **Water** (`0x41bbd0`): a truck is *in water* (not in Snow) when a tire's hub is under the water level, a tire stands
  on surface 300 or 1300, or a hull point is under the water. On going in, `splash1.wav` (one-shot) at
  `0.1 - v_y / 9` (`v_y` the world vertical speed, ft/s), played only when that is above 0 and at most 1.7. While in
  water (and the camera above it) `Wtr-abv1.wav` loops (KLP) at `0.1 + |v| / 10`, at most 1.2; it stops on leaving the
  water. `SOUND\SPLASH.WAV` (`MUSIC.POD`) is never a sound effect: only `0x4207f0` names it, as the menu music.
- **Under water** (`0x41f980` sets `0x6719a0` each frame: the camera below the water level, never in Snow). With the
  listener under water, a truck that is itself in water (`0x41bbd0`) has its engine and skid loops and its
  gear-change sounds at 0.65 of their pitch (`0x6078dc`) and does not start `Wtr-abv1`; the change in or out sets the
  mixer's master level to 0.75 (`0x6078e0`) and back to 1. A one-shot from the world (a collision, an object's hit, `0x429cb0`, `0x428bc0`) is played at a volume by where
  it is and where the listener is: source in the air and listener in the air 1, source under water only 1 (and 0.9 of
  its pitch), listener under water only 0.2, both under water 1.2 (and 0.65 of its pitch, from the listener).
- **Rain** (`0x57581b`, each frame, weather 4): `rain4.wav` loops at volume 0.25 with its pitch jittered by up to
  1.5% each frame (`1 + (rand / 16384 - 1) * 0.015`), at 0.6 of that pitch with the camera under water. **Rain on
  the roof**: `rainrf8.wav` loops at volume 0.7 with the same jitter while it rains, the camera is not under water,
  the view is the cockpit (mode 0) and the camera's terrain cell has no cover over it (`0x502510`: the cell's table
  entry at `0x7f09d8` is above the camera; a cell without one reads 0x40000, open sky); otherwise it stops. This is
  the only sound in the exe that depends on the cockpit view. The loop meant for Night (`0xb66510`) is never
  created, so nothing plays there.
- **Bridges** (`0x41ec90`, from `0x41bbd0`, once for surface 1100 (Wood) and once for 1400): while the truck moves
  faster than 2 ft/s and any of its four tires on the ground stands on that surface, `bridge1.wav` loops (KLP) from the
  middle of those tires' contact points, at `speed / 60` (at most 1.4) times the truck's scale and at a pitch of
  `speed / 90` held to 0.3..1.0; otherwise it stops.
- **Winner's Circle crowd** (`0x519212`): when the race's first place is the player's own truck, the Results window
  shows the art with the first frame lit (`ResWin1.bmp`) and starts `crowd.wav` looping on its KLP (flags 0x1f, as
  the interface sounds); with the player second it shows `ResWin2.bmp` and no crowd.
- **Hull impacts** (`0x429080`, called from the contact response at `0x46ba80`): `suspen5` or
  `suspen6` (random) while the truck is undamaged (`damageCode` 0), `suspen1` or `suspen3` once
  it is not, at x1.8 from the truck's emitter, and only when the truck's previous impact sound
  has finished (`0x464450` asks whether a handle still plays). The exe has no other truck crash
  sample: `crash_01`, `05`, `08` and `11` are announcer voice clips (referenced at `0x42452c`),
  so they must never play as impact sounds.
- **World**: crashes, suspension, rollover, horn, YeeHaw, splash (`splash1` only), underwater, trains
  (`tr-horn`, `train22.wav`), helicopter (`huey`), blimp, crowd, and object-specific hits by
  model name (`strike`, `hickz`, `flush`, `barn1`, `cowpain`, `doctor`, `coffin`).
- **MOD music** (`UseModMusic`, the "%u-channel MOD" player at 0x5580f0): `MUSIC\SEX.MOD` in
  `SOUND.POD` is a six-channel ProTracker module ("(C) Terminal Reality", 14 orders, about 96 s
  at 22 kHz); a level whose music name ends in `.mod` plays one too. OpenPhotex's `parseMod` and
  `renderMod` read and play ProTracker modules (the effects are listed in `src/audio/mod.ts`).
- **Menu interface sounds** (`UI.POD`): `STARTOFF.WAV` when changing screens, `TRACK.WAV` when
  changing the selected track, `SLIDERUP.WAV` and `SLIDERDN.WAV` when raising and lowering the
  Garage transfer gear, `GOOFF.WAV` for GO, and `CONOPTUP.WAV` for an ordinary click.
- **Object sounds** (SIT, under "@sound effect entries", two names): the sound an object makes
  when something hits it (`0x428bc0` plays it from the object's place, called on every contact by the
  collision code, and only when the object's previous sound has finished, `0x464450`; with none, by type: 1 post
  `hitPost1`, 2 barricade `barricad`, 4 pylon `pylon`, 10 train `crash1`) and the sound it makes by
  itself, looping (TPARK's train `TRAIN22.WAV`, a crossing's `cross5.wav`, a stand's `CROWD.WAV`).
  Gains by name prefix: `strike` becomes `strike1` x3, `hickz` x2, `flush` x1.5, `hay` x0.6,
  `dino` x2.2, `rock` x1.3, `barn1` x2, `cowpain` x4, `doctor` x2.5, `coffin` x2.8.
  The contacts that call `0x428bc0`, with the body under test (`0x6f6074`) as the object, are the box tests
  themselves, so only a real touch of the box the collision response uses makes the sound, never a hit beside it:
  a hull point that goes deeper into the box than its stored depth (`0x4aad00`; not while the checkpoint test
  `0x485af0` runs, which sets `0x6f60bc` to 1), a tire contact point inside it (`0x4a7fc0`), a wheel's
  suspension on one of its faces (`0x4a5da0`), one of its corners inside a wheel (`0x49f920`), and `0x49c620`
  (two calls, not traced further). No force or speed threshold is applied. The port reports the same contacts
  from OpenPhotex's `collideTruckBox` with the truck's closing speed, and asks for at least 2 ft/s (port's rule)
  so a truck resting against an object does not set it off again each time its sound ends.
- **Horn and YeeHaw** (`0x429490`, `0x429350`): `horn1.wav` at the truck's horn volume, or with
  the kooky horn on one of `horn1`, `horn-a` and `horn-f` (the last two x1.5, never the same
  twice); `yeehaw.wav` at x1.8. High in the air with all four wheels off the ground (`0x41e030`)
  a truck randomly honks or whoops.
- **Commentary phrases**: each is a script of clips. Plain `name.wav` tokens, and `(<<n>>`,
  `*<<n>>`, `)<<n>>` for driver n's name clip in one of three voices: the three names under a
  truck's "Wave File" in its `.TRK` (for Bigfoot `bfootf`, `bfootu`, `bfootd`): `*` the first,
  `(` the second, `)` the third. The script string is followed in the EXE by the English line
  (`<<n>>` for the name), which goes through the message table (`.LOC`) like every string. These
  lines are the commentary's part of the "MTM2.loc" the game loads (`UI\MTM2.loc`, which no POD
  ships, so the English keys stand): the port keeps them as message tags (`game/commentary.js`).
  See **Commentary (Trucksfx.c)** below for when each group is said.
- **Commentary (Trucksfx.c)**, traced from 0x4213a0 (the queue), 0x421600 (the announcer), 0x421ef0 (the
  shuffle bags) and each group's trigger and speaker:
  - **The queue** (0x4213a0, run each frame in 0x41fd20): up to 32 waiting phrases, each a speaker routine with
    two truck arguments and four figures: a **priority** (lower first), a **silence** the announcer must have kept
    before it, a **delay** before it may be said, and a **life** after which it is dropped (times kept as 16.16
    seconds, counting down by the frame time). Each frame the waiting phrases are ordered: those ready (alive, past
    their delay, the silence kept) first; among them the lower priority, then the one longer past its delay, then
    the one with less life left; the first is said (its speaker is called) and removed. One phrase a frame. The
    silence counts up only while no phrase is playing (0x464450) and restarts at 0 while one is.
  - **Who is talked about**: every trigger gives each truck in it a weight, 1 for the player's truck, 1 for the
    truck the camera follows (`+0x10` of the camera record at 0x6504bc), 0 for any other; a two-truck event takes
    the larger. A weight of 0 schedules nothing, so the announcer only ever talks about the player's truck and the
    one being watched. With weight 1 every trigger asks for no delay; its other figures:

    | Group | Trigger (caller) | Priority | Silence s | Life s |
    |---|---|---|---|---|
    | move (0x4225b0) | the truck ahead of the player changes, past its third segment (race order, 0x483600) | 10 | 6 | 3 |
    | pass (0x422b80) | the player passes the truck it was following (0x483600) | 8 | 6 | 2.5 |
    | lead (0x4232f0) | the player closes on two or more trucks ahead at once (**hypothesis**, 0x483600) | 6 | 6 | 2.5 |
    | edge (0x423730) | the player passes farther from the course's line than the truck passed (**hypothesis**) | 15 | 8 | 3 |
    | going your way (0x423b40) | a truck gains a place (places, 0x487300) | 8 | 6 | 2.5 |
    | clash (0x424060) | two trucks collide (the truck pair test, 0x4894a0) | 4 | 3 (8 in a Summit Rumble) | 2 |
    | cow (0x424890) | a truck hits `cow.bin` moving | 10 | 8 | 3 |
    | water (0x4255d0) | a wheel's ground turns to water or deep water (types 3, 13; tire step 0x46a2c0) | 15 | 8 | 3 |
    | spin (0x425b00) | a wheel's ground turns to frozen water (type 8, Snow's lakes) | 15 | 8 | 3 |
    | ice (0x425ec0) | a wheel's ground turns to snow (type 9) | 15 | 8 | 3 |
    | air (0x4262e0) | all four wheels more than 30 ft over the ground, the truck turning slower than 1 rad/s | 13 | 8 | 3 |
    | roll (0x4267d0) | a hard hull contact on a roof point (hull points 5 to 8) | 13 | 8 | 3 |
    | wheelie (0x426c40) | a hard hull contact on exactly the two tail points (13 and 15, or 14 and 16) | 20 | 8 | 3 |
    | flipped (0x4270e0) | the helicopter's flight starts (`heliTimer` 15, 0x46ed90) | 2 | 8 | 3 |
    | missed checkpoint (0x427d20) | the player's missed-checkpoint count-down runs out | 2 | 8 | 3 |
    | has finished (0x428050) | a truck finishes, not first | 5 | 2 | 3 |
    | has won (0x428300) | the race's winner is decided (network) | 0 | 0 | 1 |
    | winner (0x4220f0) | the leader finishes | 0 | 0 | 1 |
    | stealth (0x41c740, in 0x41bbd0) | a truck with its lamps off in weathers 7 and 8 (the dark ones) | 10 | 8 | 3 |
    | blimp (0x428500) | the camera turns to the blimp | 100 | 5 | 0.1 |

    No group is said in a drag race (race type 1); move, pass, lead and winner wait for the truck's third
    segment. The start (0x4277ff: four lines for a race, six for a Summit Rumble), GO (0x427640), the road signs
    (0x424e6f) and the trains (0x425125) are said at once, not queued.
  - **The speakers** each draw from their own shuffle bag (0x421ef0, RANDGEN: an item taken at random and moved to
    the back, so none repeats before the rest). Some lines are said only when the truck the camera follows is in
    the event (and, for move and pass, within about 60 ft of the other): `whobe`, `pass_01`; `its/allway2`,
    `pass_03b`, `pass_05`, `pass_06`; `clash`, `pisthead`, `getatten`, `seerear`, `bitedust`, `gotbreak`, the four
    `crash_` and `add_01`; `amphib`; `ridediff`, `whirly`, `whirly2`; `add_17`. A line drawn when it may not be said
    is used up and nothing is said. `kisslead` only when the truck passed was leading (now second); `flyfin` only
    past three quarters of the lap and not in a Summit Rumble. `<<1>>` is the first truck of the event (the player
    for move, pass and lead; the one ahead for `fear`), `<<2>>` the second.
  - **Saying it** (each speaker, then 0x421600): the voice when `commentaryFlag` is set (bit 2 of 0x657398) and no
    phrase is playing: the clips are read and joined into one buffer (they must share a format) and played at 0.7.
    The line when `textCommentaryFlag` (0x67199c) is set and no other message is up (0x414250): one second plus a
    thirty-second per character (0x414660).
  - Lines in the table that nothing says in 2.00.42: `remodel`, `wrekball`, `detour2`.
- **Track ambience** `DATA\SOUNDnnn.TXT` (`SOUND.POD`), chosen by the SIT's ambient number:

      checkpoint wav file            e.g. airhorn.wav
      finish lap wav file            e.g. check2.wav
      number of one-shots
      wavName, vol, timerMin, timerMax, weatherMask      repeated
      number of looped ambients
      wavName, vol, weatherMask                          repeated

  One-shots fire at random intervals between the two timers (seconds) when the current
  weather's bit is set in the mask. This is separate from the announcer. For example, The
  Heights selects `SOUND005.TXT`, whose daytime entries are birds and eagles and whose dark
  weather entries are owl, bear and wolf sounds. The port serializes the eligible one-shots:
  it chooses one entry, waits that entry's random interval, lets the sample finish, then chooses
  and schedules another. This preserves each track's own ambience without several independent
  timers producing overlapping, echo-like bursts.
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

**What each weather does to the picture** (`0x5745e0`, `0x5753b0`, `0x503210`, `0x503290`). Every
weather sets a fog colour (RGB): Foggy (140, 140, 140), Dense Fog (139, 139, 139), Rain
(72, 74, 72), Snow (192, 192, 192), Dusk, Night and Pitch Black black, and Clear and Cloudy
(140, 140, 140). The fog's end is `viewRange * k * 8192` in 24.8 fixed point, with `viewRange`
(`0x64cfb0`) 16 and `k` = 10/16 (Foggy, 320 ft), 4/16 (Dense Fog, 128 ft) and 1 (Snow, 512 ft),
starting at 0. Rain, Dusk, Night and Pitch Black do not fog but cut the view at
`viewRange * 0x4000` = 1024 ft; Clear and Cloudy use the same cut-off with the daylight colours.
Rain also starts the rain and lightning code (0x575b50, 0x577c30, `light%d.wav`), Snow the
snowflakes (0x575b50 with 35.0 against Rain's 130.0). The fog tables (`FOG\<track>.MAP`) the
software renderer used for the darkness of Dusk, Night and Pitch Black are not traced; the port
approximates them (src/game/weather.js).

**Darkness by weather, as far as it is read.** The weather routine itself (`0x5745e0`, `0x5753b0`) sets
only the fog colour (black for Dusk, Night and Pitch Black alike), builds and installs a fog table for it
(`0x55d230(r, g, b, 10, 0xf5)`, `0x55e5d0`), sets the renderer's fog colour (`0x4f5d70`) and the view cut;
nothing in it tells Night from Pitch Black. Three bitmap routines (`0x4ea010`, `0x4ea1fe`, `0x4eac32`)
recolour every non-zero pixel of a bitmap through a shade table of sixteen levels, `0x6a71f8[level * 256 +
pixel]`, with the level taken from the weather: Cloudy 13, Foggy 14, Dense Fog 12, Rain 13, Snow 14, Dusk
11, Night 8, Pitch Black 5 (Clear is left as drawn). So the game darkens that art to 5/16 in Pitch Black and
8/16 at Night. The bitmaps are the cockpit's (section 11, "The panels in the weather"), and the table is the
level's `.LTE` light table, not a fixed sixteen steps; whether the 3D ground takes the same level is not traced. Two
more tests single Pitch Black out: the routine at about `0x4e...` (decompiled near `DAT_0063f54c`, a truck's
heading sine and cosine) runs only when the weather is not Pitch Black (or `0x468450` returns more than
0x3fff), read as the truck's shadow, **hypothesis**; and `0x5225d0` (the lens flare) is skipped in Pitch
Black, Foggy and Dense Fog. Nothing read so far has a headlight lighting the ground: the lamp code draws
lens decals and cones (section 11b).

**In OpenMTM2** Pitch Black has no sun and almost no ambient light, so the trucks' headlights (an addition)
are what lights the ground, and nothing casts a sun shadow. A race that started in Pitch Black used to keep
the sun on (the shadow helper took an intensity of 0 as none given): fixed in `render/sun-shadows.js`.

**Water** (`0x5043e0` surface, `0x4f9...` water update, `0x4fb5a0` fog, `0x42b630` background, `0x5609c0` wake):
- **The surface is an animated texture**, not a colour: eight `RIPPL100-800.RAW` frames (grey
  water with glints, 64 x 64, `STARTUP.POD`) played in the order 1 2 3 4 5 6 7 8 7 6 5 4 3 2
  (14 steps), a step every 16384 / 65536 = a quarter second (held in Snow). One copy covers each
  32 ft terrain cell, with the usual two-pixel crop (UV 8 to 248 of 256), at the water level, over
  every cell with a corner below it. It is blended translucent by weather: 0xc000 / 65536 (0.75)
  in the clear, Cloudy and the fogs, 0x8000 (0.5) in Rain, 0x4000 (0.25) at Dusk and Night, 0x1000
  (0.0625) in Pitch Black and 0xf000 (0.94) in Snow.
- The water level is `level * 256` plus a sinusoid: its phase gains one eighth of a second's
  worth of a turn each second, so it bobs by 64 / 256 = a quarter foot every eight seconds. In
  Snow it stays put (the water is ice).
- A camera below the water level (never in Snow) gets distance fog from 0 to 320 ft (a factor
  of `distance * 0xffff / 320`, full beyond), and the game fills the screen with the weather's fog
  colour instead of drawing the sky. The same test sets the underwater sound filter.
- In Snow, a terrain cell with a corner under the water is drawn a second time with `SNOW0` to
  `SNOW3` (the cloud noise in `STARTUP.POD`, chosen by `(x & 1) + 2 (z & 1)`) at a translucency
  that starts at nothing and gains 1/200 of 65536 a second up to 0x7fff, so ice spreads over the
  water in about 100 seconds and ends half opaque.
- **Spray and ripples.** Each frame a truck's tires (`0x54afd0`, three contact points of each
  of four calls) that touch water (surface code 0x514) or, in Rain, any ground, start a particle
  in a ring of 256 (`0x560600`): three seconds of life, position and velocity from the truck's
  own velocity with a random 0.5 to 1.5 and 0.9 to 1.1 of it, gravity 8192 / 256 = 32 ft/s squared.
  Particles are drawn as `WAKEBLOB.RAW` billboards sized by distance (`0x5609c0`); one that
  falls back through the water level is added to a list of at most 31 ripples drawn as flat
  2 ft squares of `SPLATRIP.RAW` (rings).
- **Rain and Snow particles** (`0x575f70`, called from `0x574fd0`): world-space sprites in a field
  around the camera, a cell of a sheet each: Rain uses `NDROP1-3.RAW` (each two drops, so six
  cells) and Snow `SNOFLAKS.RAW` (a 4 x 4 sheet).
- **Texture animations** (`DATA\<track>.ANI`, loaded at `0x42e120`, stepped at `0x42e720`): a
  count, then per animation the base texture's name, `frames,interval` and the frame names. A
  clock gains the frame time and the frame shown is `clock / interval % frames`, the interval
  in 16.16 seconds (9830 is 0.15 s, 16384 a quarter second). The base name is looked up in the
  level's loaded texture table and the slot's name is replaced by the frame's. No stock level
  lists its water frames (`DWATA1-4`, `IS8WT000-300`) in its texture list or any model, so the
  animation has nothing to act on in the stock tracks.

**Lens flare** (`STARTUP.POD` `DATA\SUN.TXT`, read by `weather.cpp`): type (point or offset),
initial position (256 = 1 ft), master radius (full-screen size), then 10 layers of
`texture, axis position, radius, texX1, texY1, texX2, texY2`, then 9 visibility-check rays. The
flare is drawn along the screen axis through the sun; it hides when the rays are blocked.

---

## 14. Networking

Traced in retail 2.00.42 (`MONSTER.EXE`, SHA-1 `f4fbce51d5ab14699ad2df4c0f45d994907b6d23`, the same
file as the patched retail `MONSTER.EXE.old.EXE`). Ghidra's decompile misses much of `network.cpp`
(0x4584a0 to 0x45ab00); that part was read from the disassembly. **H** marks a hypothesis.

### 14.1 DirectPlay calls

`DPLAYX.DLL` is imported by ordinal: 1 DirectPlayCreate, 2 DirectPlayEnumerateA, 4
DirectPlayLobbyCreateA. No CoCreateInstance.

- `0x4597e0` calls `DirectPlayCreate(&spGuid, ...)` and asks the object for **IID_IDirectPlay2A**
  (`9D460580-A822-11CF-960C-0080C7534E82`), kept at `0x646d70`. The game is ANSI DirectPlay 2
  throughout. The lobby object (IDirectPlayLobbyA) is at `0x646d74`.
- **Application GUID** (at `0x6499f0`): `{6CD1C6E0-96FB-11D1-A268-00A024F2C995}`, bytes in wire order
  `e0 c6 d1 6c fb 96 d1 11 a2 68 00 a0 24 f2 c9 95`. guidInstance is always GUID_NULL.
- **Service providers:** `0x459500` lists whatever `DirectPlayEnumerateA` reports; nothing is hard
  coded. The GUID table at `0x60c1c8` holds the DirectPlay IIDs, the address data types and the TCP/IP
  (`36E95EE0-8577-11CF-960C-0080C7534E82`) and modem SP GUIDs.
- **Send rate:** after DirectPlayCreate, net `+0x28` is **4 when the SP is TCP/IP, else 8**. The state
  is sent every `0x10000 / rate` (16.16 seconds): **4 Hz on TCP/IP**, 8 Hz on IPX, modem and serial.
- **No IP address in the normal path.** EnumSessions and Open get no address; DirectPlay's own TCP/IP
  dialog asks for it. The retail exe has no `/h` or `/j` switches (open question 5 is about a later
  build). The lobby-launched path (`0x458360`, used by the Zone) and a developer "Lobby test session"
  (`0x458510`, the only `CreateAddress(DPAID_INet, ip)`) and "AutoConnect test session" (`0x459ff0`)
  are leftovers.

**Sessions** (DPSESSIONDESC2 at session `+0x14`):

| Call | Address | Facts |
|---|---|---|
| Create | `0x459970` | dwSize 0x50; dwFlags **0x46** (KEEPALIVE 0x40, MIGRATEHOST 0x4, and the undocumented 0x2), 0x42 when migrate-host (net `+0x15`, default on) is off; dwMaxPlayers from "No. of Players (2-8)", default 8; name default RC 11000 `<<1>>'s Truckin' Game`; empty password; **dwUser1 to 4 = 0**; `Open(desc, DPOPEN_CREATE)` |
| Enumerate | `0x459550` | desc with only dwSize and the application GUID; timeout **1000 ms**; `DPENUMSESSIONS_AVAILABLE`; the callback keeps the name and dwMaxPlayers |
| Join | `0x459890` | `Open(desc, DPOPEN_JOIN)` |
| Close | `0x459ba0` | Close and Release both interfaces |

After a successful open, net `+0x10` is 0 on the host and 1 on a client. SetSessionDesc, groups,
SetPlayerData, SendChatMessage and SecureOpen are never used.

**Players:** `0x459c90` calls `CreatePlayer` with a DPNAME whose short and long names are both the
driver name, and **no player data**. One player per machine. Team play is done with game packets, not
DirectPlay groups.

**Send** (`0x45a540`): `Send(idFrom = own DPID, idTo, flags, wire, size)`. idTo is a player's DPID or
**0 (all players)**, which is what almost every call uses. Flags are **DPSEND_GUARANTEED (1)** for the
packets marked G below, else **0x4** (not in the DX5/6 headers; **H**: the old "try once", i.e. not
guaranteed). Over TCP/IP, guaranteed means TCP and the rest UDP.

**Receive** (`0x45a5c0`, polled by `0x455b00`): GetMessageCount, then
`Receive(&from, &to, DPRECEIVE_TOPLAYER, ...)` with a growing buffer. Messages from the own DPID are
dropped. The sending player is found from the **DPID inside the packet** (wire `+8`), not from
DirectPlay's idFrom. System messages handled:

| DPSYS | Code | Action |
|---|---|---|
| CREATEPLAYERORGROUP | 0x3 | players only: new remote player from the DPID and the **long** name |
| DESTROYPLAYERORGROUP | 0x5 | removes the player |
| SESSIONLOST | 0x31 | Close |
| HOST | 0x101 | the new host broadcasts 0x88 (`0x456580`) |

Every other system message (player data, chat, group membership) is ignored.

### 14.2 Packet format

Little-endian, IEEE floats, ANSI NUL-terminated strings, packed. Barrier codes are C multi-character
constants (`'sync'` = 0x73796e63, `'rslt'` = 0x72736c74) sent as u32. In memory a packet has a 12-byte
local prefix `{u32 size, u32 sender object, u32 allocation flags}` that is **never sent**. The wire
form starts with a 12-byte header:

| Offset | Field |
|---|---|
| +0 | u8 type |
| +1 | 3 bytes padding (not initialised) |
| +4 | u32 0 (never checked) |
| +8 | u32 sender DPID |

The payload starts at +0xC. Sizes below are wire sizes. G = guaranteed; everything else is not.
"All" = to all players.

**Game packets** (factory `0x4d7d50`, dispatch `0x4d8c60`):

| Type | Size | Payload (offsets from wire start) | Sent | Received |
|---|---|---|---|---|
| 0x01 | 16 | +C u8 ready | (no sender found) | ready flag |
| 0x02 | 61 | truck state, table below | `0x58dff0` from `0x58e1f0`, 4 or 8 Hz, all; the host also sends the computer trucks' | `0x58e590`, into slot[vehicle] |
| 0x03 | 92 | +20 char[20] truck name; +34 s16 (default 1, **H**); +36 s16 (default 0, **H**); +38 u8 status; +3A **u16 version 0x0201**; +3C u32 location; +40 u32 skill (0 Rookie, 1 Intermediate, 2 Professional); +44 5 x u32 (defaults 1, 1, 600, 1, 0; **H**: truck setup); +58 u32 team | `0x4cc298`, to each new remote player, G | version lower, higher or different than 0x201 gives a warning |
| 0x06 | 16 | +C u32 n | Remote Ridicule, all | plays `tri<n>.wav`, "Remote Ridicule from <<1>>" |
| 0x0b | 24 | +C u32 truck, +10 u32 checkpoint, +14 f32 split time | `0x4dc230` from the checkpoint code: own truck, and the host's computer trucks; all | `0x58e670` |
| 0x0d | 56 | +C char[44] quick message | all | `<<1>> says "<<2>>"` |
| 0x0e | 16 | +C u32 race exit code (9 = cancelled) | host at race exit; a new host in the lobby (9) | race: ends it; lobby: clears ready flags |
| 0x0f | 32 | +C char[20] truck name | all | truck column |
| 0x10 | 16 | +C u32 skill | all | Level column |
| 0x11 | 16 | +C u32 location (screen) | G | Status column |
| 0x12 | 112 | +C char[20] SIT file; +20 char[80] track name | host, on a change and to joiners, G | track check, then 0x1a or 0x25 |
| 0x13 | 16 | +C u8 ready | all | ready flag |
| 0x14 | 36 | +C char[20] SIT; +20 s16 laps or minutes; +22 s16 weather (Random already resolved) | host Start, G | load the race |
| 0x15 | 16 | +C u32 barrier FourCC | barrier `0x4dbc40`, every 1 s, G | player's last barrier code |
| 0x16 | 16 | +C s16 laps | host, G to joiners | laps |
| 0x17 | 120 | +C 9 x {f32 x, y, z}: start position per truck index | host only, once after the `sync` barrier, all | `0x58e5e0` sets every truck's position |
| 0x18 | 32 | +C u32 `rslt`; +10 u32 laps led; +14 u32 laps; +18 f32 total time; +1C f32 best lap or Summit score | `rslt` barrier, G | results table |
| 0x19 | 16 | +C u32 0 | `0x4dc2f0`, when the local countdown passes 3.0 s, all | when this race has not started: start now (gear 4, race clock 3.0) |
| 0x1a | 92 | +C char[80] track name | client to host | "<<1>> does not have the track" |
| 0x1b | 16 | +C s32 weather (-1 Random) | host, G to joiners | weather |
| 0x1c | 12 | none | a player leaving the race | that truck goes to autopilot |
| 0x1d | 16 | +C s32 truck (-1 in the lobby) | horn | 3D horn, or `horn1.wav` in the lobby |
| 0x1e | 16 | +C s32 truck (-1 in the lobby) | YeeHaw | 3D YeeHaw, or `yeehaw.wav` |
| 0x1f | 20 | +C u32 vehicle, +10 u32 lamp switch (0 or 2) | `0x585200`, on the Headlights key | the truck's lamp switch |
| 0x20 | 20 | +C u32 vehicle, +10 u32 damage code (12 zones x 2 bits) | `0x532900`, when the code changed | the truck's damage, visuals refreshed |
| 0x21 | 16 | +C u8 team play | G | "Team Play is Active/Inactive" |
| 0x22 | 48 | +C char[32] team name, +2C u32 team | | new team |
| 0x23 | 16 | +C u32 team | G | "<<1>> has joined <<2>>" |
| 0x24 | 12 | none | host kick or cancel, G | the receiver closes |
| 0x25 | 116 | +C char[20] SIT; +20 char[80] name; +70 u32 CRC | host to joiners, client after a track change | "different version of <<2>>" |
| 0x80 | 96 | +C u8 flag (**H**); +D u8 private; +E char[82] text | lobby chat, all or one player (private); the reply dialog sends G | "Private from ..." or "<<1>>: ..."; 20-line in-race buffer |

**Truck state, type 0x02** (61 bytes):

| Offset | Field | Encoding |
|---|---|---|
| +0C | ipos | 3 x f32 (truck `+0xfe0`) |
| +18 | bvel | 3 x f32 (`+0xff8`) |
| +24, +28, +2C | theta, phi, psi | f32 holding a whole byte value, angle x 256 / 2pi mod 256 |
| +30 | steering | f32, same coding (`+0x298`) |
| +34 | throttle | u8, x 255 |
| +35 | rear brake | u8, x 255 |
| +36 | gear | u8 |
| +37 | autoShift | u8 |
| +38 | vehicle number | u8 |
| +39 | Summit score | f32 (mode 4 only; other modes send whatever is there) |

**Net-layer packets** (dispatch `0x456740`, none guaranteed):

| Type | Size | Payload | Meaning |
|---|---|---|---|
| 0x81 | 96 | char[80] name, u32 DPID | add a player to the list (any player, people included) |
| 0x82 | 100 | the same plus u8 (1) | add it if unknown, and put it in the active list |
| 0x83 | 16 | u32 DPID | remove player |
| 0x84 | 16 | u32 time in 1.179648 MHz ticks (`timeGetTime x 1179.648`) | ping |
| 0x85 | 16 | the echoed time | reply; RTT in ms = delta x 1000 / 0x120000 |
| 0x86 | 96 | u32 DPID, char[80] | rename |
| 0x87 | 20 | u32 DPID, u16 slot | grid slot |
| 0x88 | 16 | u32 new host DPID | host change |
| 0x89 | 20 + n | u8, u8 compression, u32 chunk, u16 samples, ACM data | voice radio |
| 0x8a | 16 | 3 x u8 | player list closed or opened |

**The host's player list** (`0x456008`; the same code in CP3 at `0x1400c3060`): when the host adds a
player to its list, it sends 0x81 about that player to everyone. To the newcomer it then sends 0x81
for each player already listed, 0x82 (flag 1) for each player in the active list, and 0x88 naming
the host. A receiver (CP3 `0x1400c5980`) creates a player it does not know on 0x81, as it does for
DirectPlay's create-player message. On 0x82 it does the same if needed, then moves the player into
the active list. Over DirectPlay these repeat what DirectPlay reports. Over CP3's direct connect
(14.5) they are how clients learn the other players at all.

**Track checksum** (`0x569e50`): CRC-32/MPEG-2 (polynomial 0x04C11DB7, MSB first, initial
0xFFFFFFFF, no final XOR) over the **whole POD** holding `WORLD\<SIT>`, -1 when none does, cached per
POD.

### 14.3 Lobby

The Multiplayer Screen (dialog 7306, backdrop `NETWORK.BMP`) lists the players with the columns
Player, Level, Truck Name, Latency and Status (RC 1220 to 1224), a chat pane, a chat entry with a
target list (Everyone, or one player for a private message), and the Ready, Not Ready, Disconnect,
Send, Team and End Game buttons. The connect dialogs are Connect (3008: Host, Join), Host a Network
Game (7002: session name, protocol) and Join a Network Game (7001: protocol, session list, Auto
Select). INI keys `networkChatFlag` and `latencyDisplay`.

- **A player joins:** DirectPlay reports the new player. Every machine sends it 0x03 (G). The host
  also sends 0x12 track, 0x16 laps, 0x1b weather, 0x21 team play (all G) and 0x25 checksum. A joiner
  without the track answers 0x1a.
- **In the lobby:** 0x0f truck, 0x10 skill, 0x11 location and 0x13 ready. The player list
  (`0x514175`) shows:
  - Player: the name, with " (Host)" for the host, and " (Version <<1>>.<<2>>)" (RC 1045, the
    version's high byte, then the low byte with a leading zero below 10) when its version is not
    0x0201.
  - Level: Rookie, Intermediate or Professional.
  - Truck Name: the truck table's display name for the truck file it sent.
  - Latency: "Local" for this machine, else by the round trip: "Unknown" (none yet), "Low" (under
    500 ms), "Normal" (under 1501 ms), "High".
  - Status: when ready, "Ready" ("Racing!" in a race); otherwise by location: 1 Start Screen,
    2 Driver Check-in, 3 Race Screen, 4 Garage, 5 Multiplayer Screen, 6 Hall Of Fame, 7 Viewing
    Results, 8 Instant Replay, 9 Racing!, any other value Unknown. Every 5 s the lobby pings the next human in turn
  (`0x4c9eb0`) for the Latency column.
- **The players' slots:** the net object keeps a pending and an active list. A player's 1-based place
  in the active list is its **vehicle number and grid position**. Computer opponents are entries in
  the same list, marked as computer players.
- **Start (host):** shuffle the active list (5n random swaps, `0x4554f0`); close the list (`0x455600`):
  send 0x8a, drop the pending players ("The host did not select you"), send 0x87 {DPID, slot} for each
  player; then send 0x14.

### 14.4 Race

1. Every machine loads the race.
2. **`sync` barrier:** "Waiting for other players (<<1>>)", 0x15 every second, 120 s limit.
3. The host broadcasts **0x17**, the start positions of every truck.
4. Each machine runs its own 3 s countdown. The first to pass 3.0 s sends **0x19**; the others start at
   once. There is no other clock sync and no packet carries a time stamp.
5. Every frame `0x58e1f0` sends the state (0x02) at the send rate, and applies what arrived.
6. Computer trucks are simulated by the host, which sends their 0x02 and 0x0b. (**H**: clients run
   their autopilot too, overwritten by the packets.)
7. **End:** each machine works out the results; a `rslt` barrier ("Synchronizing Scores", 30 s)
   exchanges 0x18 for each local player. The host broadcasts 0x0e when it leaves the race.

**Remote trucks** are full physics bodies on every machine. On each 0x02 the receiver sets the body
velocity, the three angles (wrapped to +-pi), throttle, both brakes from the rear brake, steering,
gear, autoShift and score. The **position is snapped only when more than 1 s has passed since that
truck's last snap**; in between the local simulation drives the truck from the last controls and
velocity. There is no interpolation or extrapolation code. Collisions with remote trucks are resolved
on each machine against its own copy (**H**: the MTM1 "lag shots", the owner never feels the hit and
the next snap moves the truck). Damage is owned by the truck's machine and replaces the local copy on
0x20.

**A player leaves:** DirectPlay reports it; in a race that truck goes to autopilot on every machine
(not in Summit). A removed player sees "You have been removed from the game." **The host leaves:**
with migrate-host on, DirectPlay picks a new host, which broadcasts 0x88; in the lobby it also sends
0x0e(9) and reopens the list, dropping computer players.

**Network tick** (`0x451e70`) differs from the single-player tick (`0x5859a0`): it empties the
typed-key queue without reading it, so **no cheats and no Torture Pit check** in a network race. The
**instant replay is disabled** when more than one networked player is in the race.

### 14.5 Community Patch 3

CP3's `monster.exe` (2.0.52.0, a 64-bit rebuild) keeps the application GUID and still loads
`dplayx.dll`, so it can use DirectPlay TCP/IP. It adds its own **UDP/IP (direct connect)** mode, which
its author recommends. Its author published no source code. What follows was traced from the
executable (`tools/re/decompile.sh cp3`; the source file is named `support\network.cpp`).

**The game layer is unchanged.** Direct connect replaces DirectPlay underneath the game. The game
sends (`0x1400c7fb0`) and receives (`0x1400c5080`) the same packets as in 14.2, without the local
12-byte prefix, and still takes a packet's sender from its own header. A player's ID is its direct
connect ID: the host is 1, and joiners get 2, 3 and so on, in order. The transport's events stand in
for DirectPlay's system messages:

| Event | Becomes |
|---|---|
| a player joined (ID, name) | create player |
| a player left | destroy player |
| the connection was lost | session lost |
| this machine is the host now | host change |

Clients hear of a join only through the host's 0x81 and 0x82 (14.2, "The host's player list").

**Reliability.** The game's send mode picks it:

| Mode | Sent |
|---|---|
| 2 | reliable |
| 1 | unreliable |
| any other | the truck state (0x02) unreliable, everything else reliable |

**Transport.** One UDP socket per machine, in WinSock's non-blocking mode.

- **Ports:** the host binds `[Network] Port` in `monster.ini` (default 2350). A joiner binds any
  free port and sends to the host's port, at the address in `[Network] Host`.
- **A star:** clients send only to the host, which relays.
- **Size:** a datagram is a 20-byte header and at most 1200 bytes of payload. Every value is
  little-endian.

| Offset | Field |
|---|---|
| 0 | u32 `0x3355544d` ("MTU3") |
| 4 | u8 type |
| 5 | u8 0 |
| 6 | u16 payload length |
| 8 | u32 A: the sequence number (type 2, 3), the sender's clock (9, 10), otherwise 0 |
| 12 | u32 B: the sender's ID (for relayed data, the original sender's) |
| 16 | u32 C: the target's ID, 0 for everyone |
| 20 | payload |

| Type | Name | Payload | What happens |
|---|---|---|---|
| 1 | data | a game packet | Unreliable. The host passes it on to every other peer the target matches, and keeps it when the target is 0 or itself |
| 2 | reliable data | a game packet, at most 1024 bytes | Every copy is acknowledged with type 3. Delivered in order of A, which counts from 1 per pair of machines. Up to 16 early ones are held, and 256 recent numbers are remembered to drop repeats. The acknowledgement goes before the check, so an early message with no room left to hold it is acknowledged and lost. The host relays it as type 1 is relayed, numbered on each onward link |
| 3 | ack | none | A is the sequence acknowledged |
| 4 | connect | none | A joiner sends it every 200 ms, for up to 3 s, until the host answers |
| 5 | connected | none | The host's answer to 4; B is the host's ID (1) |
| 6 | join | char[32] name | Sent every 150 ms, for up to 4 s, until 7 comes. The host gives a new machine the next ID and reports "joined", then answers 7 to every copy |
| 7 | welcome | u32 the joiner's ID | |
| 8 | leave | u32 the sender's ID | Sent to every peer on closing. The host reports "left". A client that gets it from the host reports the connection lost |
| 9 | ping | none | Each machine pings each peer every second; A is its tick count |
| 10 | pong | none | Echoes A. The round trip starts at 100 ms and is smoothed as 0.875 x old + 0.125 x new; samples of 10 s or more are ignored |
| 11 | roster | u32 n (at most 8), then n x { u32 ID, 4-byte IPv4 address, u16 port }, address and port in network order | Sent by the host to every peer every 2 s; its own entry is not in it |

- **Resending:** an unacknowledged reliable message goes again after 1.5 x the round trip,
  between 60 and 1200 ms.
- **Limits:** a peer holds 64 unacknowledged messages, and the host 8 peers.
- **Timeout:** a peer that sent nothing for 8 s is dropped. The host reports "left".
- **Host migration:** when a client loses the host this way, the lowest ID in the last roster,
  other than the old host's, takes over.
  - If that is this machine, it becomes the host, adds every roster entry as a peer, and
    continues numbering after the highest ID.
  - Otherwise it reaches the new host at that entry's address.
  - With no roster, the connection is lost.
- **Testing aids:** `[Network] SimLatencyMs` (0 to 2000), `SimJitterMs` (0 to 1000) and
  `SimLossPct` (0 to 90) delay and drop incoming datagrams.

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
| R | **reverse course direction** (`0x647564`): in the controls routine (`0x584490`) the key-state array at `0x694ee0` is indexed by DirectInput scan code, and scan code 0x13 (R) flips the flag while GOLD is on. Scan code 0x0B (0) is the screenshot key, 0x2D (X) toggles the CPU trucks' flag at `0xa9a4d0`. |

**Z mode, traced** (the in-race key routine `0x585da0`, beside the weather cycle; the overlay `0x52d540`): Z (scan code 0x2c) flips
Z mode (`0x63f4f4`) whenever GOLD is on and no chat line is typed; it does not need slew mode, and leaving slew
mode leaves it as it is. While it is on:
- the overlay draws `Zoom: %f` (the base zoom over the camera's), `Sector: %d %d Vis poly: %d Total: %d` (the
  camera's x and z over 8192, that is 32 ft cells, the polygons drawn, and `(2 viewRange + 1)^2` cells), `Level:
  %s Models: %d` and two more lines of renderer statistics;
- `=` and `-` zoom the camera by 0x1000 in 0x1000..0x20000 (section 11), and the view's own zoom is no longer set
  each frame, so the zoom stays;
- X (0x2d), in a single-player race with more than one truck, flips every computer truck's autopilot (`+0x894`,
  from the second truck on): with it off they stop driving;
- Ctrl+L asks for a SIT name ("Load situation: ") and loads it.
The View keys orbit the camera in Z mode and slew mode as they do in any chase view (section 11).

**In OpenMTM2** (`src/ui/gold-mode.js`): typing GOLD or FRAME during a race works as in the game
(the last 8 letters are compared). With GOLD on, R reverses the course, Ctrl+T cycles the
player's autopilot (off, speed control only, full), Ctrl+B cycles the collision boxes (off,
wireframe, solid), Ctrl+Y is slew mode, Z the technical overlay in slew mode, and 0 (4 in slew
mode) saves a screenshot as a PNG download. Z mode stays on when slew mode is left, so its zoom
(- and +), its orbit (Insert and Delete) and Ctrl+L (load a SIT by name) work while driving, as the trace above
confirms. Ctrl+4 and Ctrl+5 pick BlimpCam and
RaceCam at any time. Alt works in place of Ctrl, since browsers keep
Ctrl+T and Ctrl+W. Z goes on and off with GOLD at any time and X in Z mode stops and restarts the computer
trucks, as traced above. Not done: the DEMO, NOLOCK, CHUCK and 3DFX codes.

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
| `player.pro` | 0x4ca6d0 (list), ProjNet.cpp 0x4da480 (one driver); read by 0x4ca1d0, 0x4dae90 | the drivers, text (below) |
| `MTM2 High Scores` | HighScor.cpp 0x460560; read by 0x460317 | the Hall of Fame, enciphered text (below) |
| `highscor.mtr` | 0x4c7540, 0x4c7150 | dead code: never called (section 6.6) |
| saved games | RACE.CPP 0x41a557/0x41aea2 | text, header `MonsterTruckMadness 2.00`, version-checked |
| `*.sit` | Simobj.c 0x553230 | the debug "Save situation" writes a full SIT of the live state, `temp.sit` too |
| registry | Metalapp.cpp | `InstalledPath`, `ProductID`, `DriverX` |

---

**`player.pro`** (in the game folder, text, lines ending CR LF; each value on its own line, read with `fgets` and
`atoi`, the line's last character dropped). The list (`0x4ca1d0`): the file version (103 in 2.00.42; the driver
reader refuses 104 and up with "Version is newer than supported"), the number of drivers, the selected driver (1
when 0), then each driver (`0x4dae90`, written by `0x4da480`). A driver, by version (older files stop earlier and
keep the defaults of `0x4da110` for the rest):

| Version | Lines | Field (driver object) | Default |
|---|---|---|---|
| all | name | `+0x08` | |
| 103 | integer | `+0x88` | 0 |
| 102 and up | integer (kept as a byte) | `+0xa0` | 0 |
| 102 and up | seven text lines | `+0xa4 + 24 i`, set one by one through `0x4da450` | empty |
| 101 and up | a count `n`, then `n` pairs of a text line and an integer | a list at `+0x8c` | none |
| all | integer, integer, integer (a short) | `+0x40`, `+0x30`, `+0x44` | 0, 0, 0 |
| all | text, text | `+0x48` (a truck: the catalogue's first truck by default), `+0x60` (a track: the current track by default) | |
| all | four integers | `+0x78`, `+0x7c`, `+0x80`, `+0x84` | 1, 1, 600, 1 |

**Hypothesis** for the four integers: the Garage setup, as the race takes a driver's setup (`0x4198a0` passes
tire cut, suspension and transfer in that order; 600 is the transfer slider's lowest setting, section 8.5), then
one more setting (1 by default). The seven text lines and the list are not used by any code read so far.

**`MTM2 High Scores`** (the name is string 134, in the game folder; HighScor.cpp). The file is the Hall of Fame
as text, enciphered in 8-byte blocks (`0x522210`, `0x522290`, `0x522370`): a TEA-like cipher with a 128-bit key
`k = 5657cd21 1e8ed81f f7041c22 75055f5e` (little-endian words), the constant `D = 0x60cd2161` (`0x64f194`) and
`R = 64` rounds. Blocks are two little-endian words `(v0, v1)`. With `p` the bytes read so far including this
block and `s` a running total (0 at the start), a block is deciphered by setting `sum = (p + R) D + s`, then `R`
times: `v1 -= ((v0 >>> 7) + k3) ^ ((v0 << 6) + k2) ^ (sum + v0)`, `v0 -= ((v1 << 6) + k0) ^ ((v1 >>> 7) + k1) ^
(sum + v1)`, `sum -= D` (32-bit arithmetic); then `s += floor(v0 / R) + floor(v1 / R)` from the deciphered words.
Enciphering is the same in reverse (`v0` first, `sum` rising from `p D + s`, `s` taken from the plain words). The
last block is padded with zero bytes. The text: the number of tracks, then per track its name (the catalogue's
track name) on a line, the number of entries, and per entry seven lines (`0x45e230`, read by `0x45e3a0`): the date
(`_strdate`, `MM/DD/YY`), the driver's name, the truck's display name, the time (a float: the race time, a lap
time, or a Summit Rumble's length in seconds), the points, the skill level (0 Rookie, 1 Intermediate, 2
Professional), and `1` for a Summit Rumble entry or `0` for a race. After a race (the results code from
`0x4c6150`) a race puts in each of the player's lap times (truck `+0xf50[lap]`) as its own entry, then the race
time (`+0xa17c` of a results row) of each other driver in the list at `0x646c40` (**hypothesis**: the drivers of a
network game); a Summit Rumble puts in each driver's score with the round's length as the time. Each entry is
offered to the track's table, which keeps the best (`0x45f5d0`).

## 17. Other data the EXE uses

- **`UI\MTM2.loc`, `MTM2-FUN.LOC`, `MTM2-PIG.LOC`**: the "TRI Message System". Text: header
  `TRI Message System`, `256`, `LOC`, then records `@@TAG` (the English key) / optional
  `@@COMMENT` / `@@STRING` (the translation). Every on-screen string goes through it
  (0x523a50). `MTM2-PIG.LOC` is a **Pig Latin** test localisation; `MTM2-FUN.LOC` another test.
  `MTM2.loc` itself is not in `UI.POD`, so the English keys are used as is.
- **Bitmap fonts** (`MtmFont.cpp`, 0x4d6c10; loader 0x591200, glyph finder 0x591700): four font
  objects (Small LCD, Small, Medium, Large) are loaded from `ART\FNT*_<h>.RAW` (+ `.ACT`) for the
  screen height `h` (200, 400 or 480). At 480: `FNTO` (Small LCD, 248 x 330), `FNT1` (Small and
  Medium, 248 x 330) and `FNT2` (Large, 384 x 520). At 400: `FNTO` and `FNTP` 132 x 432, `FNT1`
  148 x 464. The loader is given the sheet size, and background colour 255. Layout: a **marker
  row** (colour 254) marks the top of each glyph box, one run per glyph; the glyphs hang below it
  until the next marker row; runs read line by line, left to right, give `!` to `~` (94 glyphs),
  a box for the missing 0x7F, then 0x80 to 0xFF (128), then a last marker row ends the sheet.
  Glyph pixels are colour 0 (a mask the game recolours). Space has no glyph. `STARTUP\FONT.NDX`
  (95 widths, text) and `FONT.BIN` belong to a separate startup font.
- **`UI\RADIODLG.RGN`**: a raw Win32 `RGNDATA` for the shaped radio dialog window.
- **`STARTUP.POD`**: palettes and fog for the software renderer (`FOG\VGA.LTE/.MAP`,
  `OLDMTM.LTE/.MAP`), `STARTUP\FONT.NDX`, `DATA\SUN.TXT`, shared art and models, a zero-byte
  `DEMO\DEMO1.DMO`, and the dead `TOURNEY\*.TRN`.
- **Where files live** (stock PODs): textures `ART\*.RAW`, usually with a same-stem `ART\*.ACT`, models
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
   Texture palettes follow OpenPhotex's origin-aware ranking from JSTrackViewer: a same-stem
   `.ACT`, POD1 palette metadata, the mounted `METALCR2.ACT`, the bundled MTM palette, then the
   level palette. For MTM2 model art and shared terrain, METALCR2 precedes the level palette.
   This is required by Crazy '98's REX textures such as `SAURHULL.RAW`, which have no companion
   `.ACT` and are not authored against `CRAZY98.ACT`.
2. **Time**: 16.16 seconds everywhere; one simulation step per frame with dt capped at 0.1 s per
   substep. In a Worker the natural design is a fixed step, which is fine: the original's
   variable step is an implementation accident, not a feature.
3. **Truck defaults** (8.4), **Garage settings** (8.5), **surface grip x tire cut** (8.6),
   **weather grip** (13), **steering shaping** (7) and **difficulty scaling** (6.5) are now known
   exactly and can replace guesses.
4. **Rules**: checkpoint sequencing with the direction test and CPU respawn (6.2), Summit
   scoring (6.3), the 3-second countdown (6.1), fast-simulated finishing times (5).
5. **AI**: course segments with speed targets and a P controller (9).
6. **Network**: state broadcast per truck with the 61-byte layout (14) is a good model for
   WebSocket play; each client owns its truck.
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
3. The meaning of `player.pro`'s seven text lines, its list and its first numbers (the layout is in section 16),
   and the saved-game layout.
4. Answered in section 14: 0x1f is the headlights, and the lobby, barriers and start are traced.
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
| 0x4597e0 | DirectPlayCreate, IDirectPlay2A |
| 0x459970 | session create |
| 0x45a540, 0x45a5c0 | send, receive |
| 0x4d8c60 | game packet dispatch |
| 0x58e1f0 | network send and apply, every frame |
| 0x569e50 | track checksum |
| 0x6407bc | difficulty |
| 0x6407c0 | GOLD debug switch |
| 0x6407d8 | Sonic track flag |
| 0x647748 | crash damage on |
| 0x657878 | weather pointer |
| 0x682d88 | frame dt (16.16) |
| 0x6f58d8 | game mode |
| 0xa2fd60, 0xa2fd70, 0xa98490 | vehicle count, player truck pointer, vehicle table |

## Driver Check-in truck preview

`MODELS\GARAGE.BIN` (24 KB, textures `GARAGE1` to `GARAGE4`, a room about 48 x 48 x 24 ft) is the mini garage the
selected truck is shown in on Driver Check-in (the right-hand window of `DRIVER.BMP`, 242 x 184 at 354, 199) and, with
`winner.bin`, in the results window (`0x5191f0`, `0x519212`). The port stands the selected truck on the floor and
turns it slowly, seen from a corner; the game's exact camera is not known.

**Winner's Circle and Hall of Fame.** `RESWIN1.BMP` and `RESWIN2.BMP` (631 x 187, drawn at about 7, 78 over `RESULTS.BMP`) light
the first frame or the second green; the player's own frame is lit (RESWIN2 when the player came second). The first-place
preview (114 x 85 at 35, 96) is `WINNER.BIN` (a globe with a crown over it, `WINNASS1` to `5`) with the winner's truck standing on
the globe; the second-place preview (113 x 85 at 493, 157) is a still shot of the truck in the mini garage. Beside them,
the name, truck and skill, and Points, Lap (fastest) and Time, in a yellow italic font. The list shows `RESULT<n>.BMP` place
icons and the player's row in blue. The Hall of Fame shows the selected row's details at the left and the crowned
truck in the black window (194 x 146 at 398, 75), for every entry.

## Dust, tire tracks and sparks

**Dust puffs** (`smokeEffectFlag`, `0x640748`). `0x4de010` takes a free slot in a pool of 96 (0x44 bytes each, from `0x702794`) when
the flag is on, the weather is neither Rain nor Snow and the camera is near: position, a life of 1.5 to 3.5 s
(`(rand << 17) / 0x7fff + 0x18000` in 16.16), a half size of 384 to 640 units (1.5 to 2.5 ft) and one of two kinds,
`PUFF2` or `PUFF3`. `0x4de390` draws it as a camera-facing quad that grows by a foot over its life, showing frame
`floor(12 x age / life)` of `PUFF2_01` to `PUFF2_12` (or `PUFF3_`), 64 x 64 images with an `.ACT` each, fainter with the ground's
light. `0x4deab0` decides per tire: a tire on a surface with flag 8 set, with the truck faster than 10 mph (`|bvel.z| x 0.6818`)
and within 512 ft of the camera, puffs at its contact point 0.5 ft up each frame; above 20 mph a second puff at its pair with even
odds. `0x4de300` and `0x4de9e0` put single puffs at a point (hits and landings).

The port draws wheel dust at 2.2 times these sizes, and a collision's smoke dark grey at 3.2 times (additions).

**Backdrops** are drawn in the sky pass with depth off; in three.js the backdrop group has to share the sky's group order (0), or the sky dome paints over it.

**Tire tracks** (`tireTrackFlag`, `0x64074c`): the flag is read from `MONSTER.INI` and never used; `ART\TREAD.RAW` (a herringbone tread) is
unused art. The port draws tracks on soft ground as an addition.

**Sparks**: `0x531e40` throws two scrape sparks every eighth of a second from a hull zone in contact while the truck moves. The port draws
them (and a burst with dust on a hard hit) as points under gravity; it is an addition, as the game shows none.

## Reflections

`MONSTER.INI` `[Graphics]` has two switches, read at 0x44d350: `reflectionFlag` (`0x640750`) and
`truckReflectionFlag` (`0x64075c`). Both work only with a 3D card (`0x644664`); the software renderer has neither.

**Water** (`reflectionFlag`; the frame routine `0x52f3a0`). When the level has water, the camera is above it and
`0x5036e0` finds the water in view, the frame is drawn twice. First mirrored in the water's plane: the camera's height
becomes `2 x level - y` and its roll and pitch are turned over, and the sky, the objects, the trucks, the terrain (flat
shaded, `flatShadeFlag` held on for it) and the weather are drawn, but not the water itself (`0x64cfb8` marks the pass).
Then the frame as always over it: the translucent water shows the world mirrored.

**Trucks** (`truckReflectionFlag`, which needs `reflectionFlag` too; `0x5225d0`, `core/ENVMAP.CPP`). After a truck's
body is drawn, unless the weather is Foggy, Dense Fog or Pitch Black and never in the water's mirrored pass, each of its
textured faces that faces the camera (`0x4eda10`) is drawn again in `ART\CLOUDENV.RAW` (256 x 256, `STARTUP.POD`),
translucent at 128 of 255. A vertex's texel: `e` the unit direction from the eye to it, `n` the camera's unit view axis,
`r = 2 (e . n) e - n`, and `(u, v) = (128 + 128 r.x, 128 + 128 r.z)`. It is a reflection of the view and not of the
face: no normal is read, so the clouds slide over the body as it crosses the screen. In Rain, Dusk and Night
(`0x522ee0`) the texture's indices become `(i >> 4) - 26`: the sixteen sky colours at palette entries 230 to 245, so the
body mirrors that weather's sky.

## The wrapping world

The world is a torus 8192 ft (256 cells of 32 ft) a side. How the game keeps it one, read from the code:

- **A truck's position is wrapped every frame.** `0x5559c0`, called from the frame loop (`0x585dab`), goes through
  every truck and, for x (`+0xfe0`) and z (`+0xfe8`) alone: above 8192.0 it subtracts 8192, below zero it adds 8192.
  So a truck is always inside the one world, and everything placed in it (boxes, ramps, checkpoints, the course) is
  where the truck finds it however far it drives. Nothing else of the truck is touched: not its velocity, and not
  its height.
- **A moving object's position is wrapped the same way** where it is stepped (`0x5543c0`: `+0x4c` and `+0x54`).
- **What is placed is brought into the world when it loads:** a box, a ramp or a top-crush car with a negative x or
  z gets 8192 added (`0x5495e0`, `0x549b40`, `0x54a000`), a course segment's ends likewise (`0x4e097b`), and
  `0x42d870` wraps both ends of a pair of points both ways.
- **Lookups by cell are masked.** The terrain, the surface and the ground boxes are read through the cell of a
  position, `(trunc(256 x) >> 13) & 255` (`MTM2_PHYSICS.md` 2.1, 14.14), so they repeat without a seam.
- **A truck is drawn at the copy nearest the view.** `0x41bbd0` fills a truck's drawing record from its position and
  then, against the view's position (`0x66fd40`, `0x66fd48`, copied each frame from the view object's `+0x1c` and
  `+0x24` by `0x41f980`): when the truck is more than 4096 ft beyond the view on an axis it is moved 8192 ft back,
  and the other way likewise. So a truck just across the seam from the camera is seen beside it, not a world away.
- **No distance is taken the short way round in the simulation.** No routine in the simulation's address range
  (`0x468e70` to `0x4bb4b0`) uses 8192 or 4096: a pair test (truck against truck, truck against a box) subtracts the
  two positions as they are. Two things either side of the seam are therefore a world apart to the game, and do not
  meet until one of them has been wrapped across.
- **The ground is drawn as a window around the view, not as copies of the world.** The world's draw routine
  (`0x5010f0`) takes the view's cell, `(x & 0x1fe000) >> 13` of the view's position in 1/256 ft, and first has
  `0x4f9ff0` lay out the cells in sight: from the corners of the view it finds the least and greatest cell offsets,
  widens them by two cells, clamps them to the view range (`0x64cfb0`, `0x64cfb4`, in cells), and for every offset in
  that rectangle places the cell at `(view cell + offset) * 8192` units, which is not wrapped, while reading the
  cell's height and tile from `((row & 255) * 256) + (col & 255)`. Then it walks the cells ring by ring from the edge
  of the range in to the view's own cell, and for each calls the terrain cell's draw (`0x4fc370`) and `0x500b80`,
  which masks the cell to 0..255 and, where the cell's two ground-box heights differ, draws its ground box
  (`0x4fcbe0`). So every cell and ground box is drawn once, beside the view, whichever side of the map's edge its data
  is on; nothing is drawn twice and there is no second world. **Not traced:** how the placed objects (the models) are
  picked and placed around the view, and the stadium's exception.

## Animated models

`engine/Keyframe.c`, `0x431530` (load) and `0x431960` (play; reached only through the model-type table at `0x64c448`,
so no direct call names it).

An animated BIN (signature 0x20) is a control record, used in memory as it is on disk:

| Offset | Meaning |
|---|---|
| `+0x00` | 0x20 |
| `+0x08` | frame count |
| `+0x0c` | **the time one frame lasts**, 16.16 seconds |
| `+0x10` | the animation's clock (0 in the file) |
| `+0x14` | pointer to the working model (0 in the file) |
| `+0x18` | the frame names, 16 bytes each |
| `+0x118` | pointers to the loaded frames |

- **Loading:** every named frame is loaded; the working model is a copy of the first. Each frame must have the working
  model's vertex count ("Key frame vertex mismatch") and is scaled to its magnify.
- **Playing**, each time the model is drawn: `position = clock / frame time`, a frame number and a fraction `t`; then the
  record's clock is set to `frame clock mod (frame count x frame time)`, where the frame clock `0x644618` is the sum of
  every frame's `dt` (section 5). So **every animated model in the world is at the same point of its loop**, the frames
  **loop** (no ping-pong), and a model's time does not start when it comes into view.
- **Between frames the vertices follow a Catmull-Rom spline** through four frames, the one before (`a`), the current
  (`b`), the next (`c`) and the one after (`d`), each index wrapped round the list:

      a: -0.5 t^3 +     t^2 - 0.5 t
      b:  1.5 t^3 - 2.5 t^2 + 1
      c: -1.5 t^3 + 2   t^2 + 0.5 t
      d:  0.5 t^3 - 0.5 t^2

  The weights are taken to 16.16 and applied to the integer vertex words. It is not a linear blend: halfway between two
  frames the weights are -1/16, 9/16, 9/16, -1/16.
- **Normals:** after the vertices move, the face records of the working model are walked and the normals of opcodes
  0x18 and 0x19 recomputed (`0x431380`, `0x4311d0`); opcode 0x17 is skipped.

Frame times in the files at hand: `TERYL.BIN` 0.25 s (four frames, a flap a second), `CEILTAL0.BIN` 0.25 s,
`PUMPJACK.BIN` 0.5 s, `REX.BIN`, `WREC1.BIN` and `OSCFAN0.BIN` 1 s. OpenPhotex gives it as `frameSeconds`.

**In OpenMTM2:** `src/shared/keyframe-spline.js` (the weights), used by `render/track-scene.js` for placed models and
`render/heli-object.js` for the pterodactyl; the frames are morph targets. The port had blended two frames linearly at
a fixed half second a frame (an eighth for the pterodactyl). **Not traced:** where `MRGL_TEXTURECYCLE` faces take their
frame from (the port steps them 15 times a second), and the in-record `MRGL_KEYFRAME` opcode, which no stock model uses.
