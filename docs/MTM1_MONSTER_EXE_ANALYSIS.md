# Monster Truck Madness (1996): analysis of MONSTER.EXE

A reverse-engineering survey of the retail Monster Truck Madness executable, written for OpenMTM2.
It answers four questions:

1. How does MTM1's physics differ from MTM2's, so that it can be offered as an option?
2. How do drag races work, in full? MTM2 only kept remnants (`MONSTER_EXE_ANALYSIS.md` 6.4).
3. How do tournaments work? MTM2 dropped them and left the `.TRN` files behind as dead data.
4. What is left of the pre-release game ("Metal Crush", "Heavy Metal Truck") and of its scrapped
   features, and can any of it still be reached?

It is a companion to `MONSTER_EXE_ANALYSIS.md` and `MTM2_PHYSICS.md` and does not repeat them:
where MTM1 does what MTM2 does, it says so and points there. Every fact carries an address in the
analysed build. Anything not confirmed in code is marked **hypothesis** or **not traced**.

The short answers:

- **Physics: it is the same simulation.** MTM2's vehicle model is MTM1's, function for function,
  with the same constants and the same default truck. Four things differ, the largest being
  water drag (section 4).
- **Drag racing** is complete and is described in section 5 down to the timers.
- **Tournaments** are a list of events run one after another with points added up (section 6).
- **The Heavy Metal Truck "Quick'n'Ugly" menu is in the executable but nothing can open it**
  (section 2.2). The fly-by video was never more than a message box and a SIT line that was
  later reused for something else (2.4, 2.5). **Free roam survives** as race type 0, with one
  unlisted track that uses it (2.6).

---

## 0. Method and build

| Item | Value |
|---|---|
| Install | `~/games/mtm1` (`MONSTER.EXE`, `GAME.POD`, `STARTUP.POD`, `TRUCK.POD`, `UI.POD`) |
| File | `MONSTER.EXE`, 3,109,888 bytes, MD5 `aad423d05b1890c8e0b1854125df3323` |
| Version resource | FileVersion and ProductVersion **1.00** |
| About box (dialog 114) | "Version 1.00.63" |
| PE timestamp | 839608620 = 9 August 1996, 16:37 UTC |
| Machine | i386 PE32, image base 0x400000, relocations present |
| Toolchain | MSVC 4.x (linker 3.10), MFC 4, **not** incrementally linked (no jump-thunk table) |
| Debug info | `D:\METAL\CRUSH\test\monster.pdb` (not shipped). MTM2's is `D:\METAL\CRUSH2\test\monster.pdb`: the codename was **"Crush"**, in a project folder `METAL` |
| Imports | `smackw32.dll` (Smacker video), `DDRAW`, `WINMM`, MFC linked statically |

| Section | VA | Virtual size |
|---|---|---|
| `.text` | 0x401000 | 0x11e58f |
| `.rdata` | 0x520000 | 0x1dc68 |
| `.data` | 0x53e000 | 0x44fa5c (0x11000 initialised, the rest static game state) |
| `.idata` | 0x98e000 | 0x3234 |
| `.rsrc` | 0x992000 | 0x172c0c |
| `.reloc` | 0xb05000 | 0x2416a |

Game code is 0x401000-0x4e0000; the C runtime and MFC follow. There are no assertion strings
with source paths in this build, so there is no module map by file name.

### Tools

`tools/re/` (see its README), run with `RE_TARGET=mtm1`; the workspace is `re/mtm1/`, built by
`tools/re/decompile.sh mtm1`. Beyond the MTM2 tools:

- Ghidra's auto-analysis finds only two thirds of this binary's code, because the rest is MFC
  handlers reached through message maps. `FindFuncs.java` makes functions of what is left
  (8,201 functions, about 97% of `.text`).
- `rsrc.py` dumps the dialogs, menus and string tables; `msgmap.py` lists every MFC message map
  with its command ids and handlers. Together they say which button calls what.
- `match.py` pairs MTM1 functions with MTM2 functions (the linker kept their order), `fdiff.py`
  diffs a pair with addresses blanked, and `dconsts.py` compares the tunable globals each side
  reads. Section 4 rests on these.
- OpenPhotex for everything inside the PODs.

The decompiled output stays in `re/` and is never published.

---

## 1. Program structure

As in MTM2: an MFC application (`CMetalDoc`, `CMainFrame`, `CTRIView`, and one form view per
screen) around the C engine. The application object has two layers: an engine layer shared with
Terminal Reality's flight games (message map `0x523f30`) and the game layer (`0x5258e0`).

### Screens: the application state

`0x49c770` (the application's virtual method at `+0x120`) switches screen. The state numbers:

| State | Screen |
|---|---|
| 1000 | Driver registration (`CMCDriverRegForm`), the opening screen |
| 1002 | Event menu (`CMCEventMenuForm`; in multiplayer `CMCMultiEventMenuForm` or `CMCEventJoinMenuForm`) |
| 1006, 1007, 1008 | Drag, Circuit, Rally setup |
| 1009 | Tournament setup |
| 1010 | Garage |
| 1011 | Pause |
| 1012 | Instant replay |
| 1014 | Zoom map (the track's overhead map) |
| 1015 | Hall of Fame |
| 1016 | Custom tournament editor |
| 1100, 1101 | run a drag pass (`0x4247a0`) |
| 1102 | Drag results (`CMCDragFinalsFormView`); 1103 plays `drag.smk` first |
| 1104 | Drag bracket (`CMCDragDrawFormView`) |
| 1200, 1201 | run a circuit race (`0x424910`); 1202 results; 1203 plays `circuit.smk` first |
| 1300, 1301 | run a rally (`0x424aa0`); 1302 results; 1303 plays `rally.smk` first |
| 1401 | start a tournament: opens the first event's setup screen (`0x49f910`). The branch that would *run* states 1400 and 1401 as a race is a message box, **"Not yet implemented."** (`0x424c30`), and is never reached |
| 1402 | Tournament results; 1403 plays `tourney.smk` first |
| 5000 | attract-mode demo (`0x424640`) |
| 9999 | the internal mission list (section 2.8). Nothing requests it |

A second variable, the **race phase** `0x5482dc` (saved in a game file as "Race Mode"), says what
the current event is doing: 0 in the menus, 1 drag qualifying, 3 drag elimination, 4 a drag match
being simulated, 6 circuit, 8 rally, 9 event finished.

The **race type** of the loaded track is `0x839ef4`, from the SIT's "Track Race Type" line:
0 free roam (section 2.6), 1 drag, 2 circuit, 3 rally.

### Videos

Smacker files on the CD, none in the installed PODs: `mslogo.smk`, `tri.smk` and `opening.smk`
at start (`0x49f770`), and a winner's clip per event type. The winner's clip plays only when the
player won: `circuit.smk` and `rally.smk` when the player's place (truck `+0x8f8`) is 1,
`drag.smk` when the event's champion record holds the player's truck, `tourney.smk` when the
player tops the totals.

### Attract mode

`0x49b810`, the idle timer of the registration and event screens: plays `opening.smk`, then
state 5000 with a counter that cycles 0, 1, 2: `circ5.sit` as a circuit, `demo.sit` as a rally,
`drag5.sit` as a drag race. The set-up callback `0x424ce0` picks random trucks (2 for the drag
race, 3 otherwise) and the computer drives all of them.

---

## 2. Heavy Metal Truck, Metal Crush and the scrapped features

### 2.1 The names

- **Metal Crush**, Terminal Reality's own title:
  - On exit the game calls `printf("Metal Crush (C) 1995 Terminal Reality Inc., All rights
    reserved.\n")` (`0x40d3d0`, called from `0x4907a5`). This runs on every retail exit; it is
    simply never seen, a GUI program having no console.
  - The base palette and light table are `metalcr2.act` and `metalcr2.lte` (`0x40d2e0`).
  - A DOS-style scrolling credits screen titled **"Metal Crush 0.50"** (`0x426860`, lines at
    `0x544930`): "Conceived, Designed, and Programmed by Mark Randel, Greg Seeheusen", "Music and
    Sound Effects by Kyle Richards", "Original Artwork and Animations by Chuck, Karl Hagood, Drew
    Haworth, Brad Heitmeyer, Mark Humphrey, Ray Rodriguez, Terry Simmons", "Creative Coordinator
    Joseph Selinske", "Biz/Resident Psychologist Brett Combs", "Metal Crush (c) 1995 Terminal
    Reality, Inc.". It draws over `vel2.raw` (a Terminal Velocity file name) and has **no
    caller**.
- **Heavy Metal Truck**, the name while it became a Microsoft title, survives in two dialog
  titles: "Heavy Metal Truck Editor" (dialog 161) and "Heavy Metal Truck Event Setup" (dialog
  192).
- An older About box (dialog 100) still reads **"Monster Truck Madness Beta 3, Build #46"**.

### 2.2 The Quick'n'Ugly menu

Dialog 196, titled **"Quick'n'Ugly"**, 139 x 170 dialog units, seven buttons:

| Button | Resource id | Handler | Sets the selection to |
|---|---|---|---|
| Drag Race | 1033 | `0x41dcd0` | 1 |
| Circuit Race | 1034 | `0x41dcb0` | 2 |
| Rally Race | 1035 | `0x41dd10` | 3 |
| Tournament | 1130 | (none: the message map listens for id **3104**, `0x41dd30`, selection 4) | |
| Truck Editor | 1037 | `0x41dd50` | 5 |
| Free Form Mode | 1038 | `0x41dcf0` | 0 |
| Cancel | 2 | default | |

Each handler stores the selection in `0x5439c8` and closes the dialog. The dialog class
(constructor `0x41dc20`, vtable `0x5223f0`, message map `0x522340`) and a launcher (`0x4245c0`:
construct, run modally, return the selection, or -1 on Cancel) are both complete.

**Is it accessible? No.** `0x4245c0` has no caller and its address appears nowhere in the image
as a pointer: no menu item, accelerator, message-map entry or state leads to it. Nothing reads
`0x5439c8` either, apart from the launcher returning it. Reaching it takes a code patch (any
reachable call redirected to `0x4245c0`), and even then choosing an entry would do nothing,
because whatever switched on the returned number is gone. The Tournament button would not even
close the dialog: its resource id was changed to 1130 after the map was written for 3104.

What the numbers 0 to 3 line up with is the race type of section 1 (0 free roam, 1 drag,
2 circuit, 3 rally): the menu was the development front end, replaced by the shipped screens.

### 2.3 The Heavy Metal Truck Editor

Dialog 161, with its class (constructor `0x42c5a0`, message map `0x522f50`) and a launcher
`0x424c50` that, like the menu's, **has no caller**. It is a truck builder:

- "Body Style" and "Tire Style" combo boxes (`0x42cd10`, `0x42cec0`), a large "Truck Picture"
  preview redrawn on a timer (`0x42e060`), and nine small bitmap buttons around it (rotate and
  zoom, by their bitmaps);
- **Load Truck...** (`0x42cf50`), **Save Truck...** (`0x42d0b0`), **Export Graphics...**
  (`0x42d210`), **Create Truck Pod...** (`0x42d310`), **Exit Editor**;
- a "Create Truck" wizard page (dialog 190): "Type the location and name of the bitmap (.bmp)
  file for your new custom truck", with Back, Next and Browse.

The code behind it is still there and was meant for exactly what Monster Truck Madness 2's
community later did by hand: it writes a `.TRK` (`0x4214a0`: `truckName`, `truckModelName`,
`tireModelName`, the four tires' `static_bpos`, "Scrape point %d (body axis) x,y,z", "Instrument
Cluster", "Wave File"), exports the truck's textures as one `bitmap.bmp` and reads an edited one
back (`0x42275b`), and packs `TRUCK\%s.TRK`, `MODELS\%s.BIN` and `SOUND\%s.WAV` into a POD named
`test.pod` (`0x422aa0`). Three built-in bodies exist as fallbacks (`0x421830`): "Default Ford",
"Default Chevy" and "Default Dodge", all on `tire1.bin`.

### 2.4 The Heavy Metal Truck Event Setup, and the fly-by

Dialog 192: lists of "Available Trucks" and "Available Tracks" with a picture of each, sample
captions "Indianapolis State Fairgrounds" and "Indianapolis, Illinois", **Go Truckin!** and
Cancel, and "There is a maximum of 8 trucks per event." when a ninth is added. Its class
(constructor `0x41b460`, message map `0x521f08`) is complete and **never constructed**.

Three of its buttons are the only fly-by code there ever was. Each opens a message box:

| Button id | Handler | Message |
|---|---|---|
| 1038 | `0x41c310` | "Hook for track fly-by AVI." |
| 1039 | `0x41c320` | "Hook for track information text." |
| 1037 | `0x41c330` | "Hook for track overhead map graphic." |

The other two hooks were filled in for the shipped screens (the description text and the map);
the fly-by never was. **No code plays a per-track video.**

In the retail screens the **"Fly By" button still exists** on the Drag, Circuit and Rally setup
screens (ids 2007, 2007 and 3405, drawn with `UI\FLYBYBTN.BMP`). Its handlers (`0x4b2c50`,
`0x4b3d30`, `0x4b73e0`) select the listed track and go to state 1014, the **zoom map**: the
button was given the "overhead map" job instead.

### 2.5 The SIT's fly-by line

Every SIT header has a line labelled "Track Fly-By .AVI file" (the SIT writer `0x437750` still
prints the label). Two readers look at it:

- The track catalogue (`0x49dd70`) copies it into each entry at `+0xc0` (`0x5d6e60`) and
  **nothing reads that copy**. A catalogue entry is 0x114 bytes at `0x5d6da0`: name `+0x00`,
  file `+0x50`, logo bitmap `+0x70`, map bitmap `+0x98`, fly-by `+0xc0`, description text
  `+0xe8`, race type `+0x110`.
- The SIT loader (`0x436d90`) keeps it in `0x5f9820` and gives it two unrelated meanings:
  - it is compared with **"Sonic"**; a match sets `0x54830c`, the computer trucks' boost flag
    (MTM2's `0x6407d8`, `MONSTER_EXE_ANALYSIS.md` section 4). Of the stock tracks only
    `CIRC1.SIT` (A Crazy Eight) has it;
  - on a drag strip it is read as a number with `atof`: the strip's **par time in seconds**,
    from which the computer's times are drawn (section 5.7).

| Stock SIT | The line holds |
|---|---|
| `DRAG`, `DRAG2`, `DRAG3`, `DRAG4`, `DRAG5` | 4.83, 4.84, 3.67, 11.21, 12.43 |
| `CIRC1` | Sonic |
| every other track | Track |

So the field never named a video in any shipped file.

### 2.6 Free roam

"Free Form Mode" is not gone from the engine: it is **race type 0**. With `0x839ef4 == 0`:

- the course follower and the speed controller are skipped altogether (`0x459a10` does nothing),
  so nothing drives a computer truck;
- checkpoints are not tested (`0x45f760`);
- the helicopter sets a truck down where it was picked up, with no course to aim at (`0x44cc90`);
- the directional finder is off (`0x48c870`), as it is in a drag race.

One stock track is of this type: **`WORLD\HILLCLIM.SIT`**, "Hill Climb Practice", locale "Shady
Shores Trailor Park, New Mexico", on the level `ARTIC.LVL`. `UI.POD` has its logo and map
(`UI\HILLCLIT.BMP`, `UI\HILLCLIM.BMP`) but no description text. **No menu lists it**: the three
setup screens each list one race type, and the executable never names the file. It can be loaded
with the debug prompt of section 3 (Z, then Ctrl+L, `hillclim.sit`).

### 2.7 Video leftovers

- `0x424030`, a text menu titled **"Terminal Video Interface"** with one entry, "2. Playback an
  .AVI file", which plays `d:\karl\fury.avi` through MCI (`open avivideo`, `close avivideo`).
  No caller.
- The Game Options dialog of the flight games is still in the resources (dialog 102: "Show
  Planet Briefings", "Show Videos", "Show Demo When Idle"), beside "Pilot Registration" and
  "Primary Flight Control".

### 2.8 The internal mission list

State 9999 runs `0x419cc0`: it reads a list from `mission1.vox` or, without that file, uses a
built-in one titled "Internal Mission List" (`drag.sit`, `dome.sit`, `demo.sit`, `island.sit`)
and runs the tracks in order through the race loop `0x418e80`. `dome.sit` was not shipped.
Nothing requests state 9999; the number otherwise only appears as a default help-context id.

### 2.9 Other leftovers

- End-of-mission screens from Terminal Velocity and Fury3 (`0x426460`-`0x4267b0`: "GAME OVER",
  "Winner!", "Retry Mission (Y/N)", "Level Complete", "Mission Complete", `epil.raw`), no
  callers.
- Thirty menu commands of the engine layer, ids 32788 to 32815, have handlers that return
  immediately (`0x491040`-`0x491200`). The shipped menu has none of them.
- `MODELS\TERYL*.BIN` (the pterodactyl) and `MODELS\REX*.BIN` (section 3) are in the PODs.

### 2.10 The zoom map, and the track's description

State 1014, `CMCZoomMapForm` (first update `0x4c2ee0`, paint `0x4c2f80`, message map `0x5271f0`), reached by the
"Fly By" buttons of 2.4:

- **The backdrop is the track's map bitmap**, the SIT's "Track Map .BMP file" (catalogue entry `+0x98`), read from
  `UI\` like every screen's art and stretched over the 640 x 480 screen. The stock maps are `UI\<stem>M.BMP`.
- **Over it the track's description is drawn**: the file the SIT's "Track Description .TXT file" line names
  (`+0xe8`), read whole from `WORLD\`, in the screen's first font, word-wrapped into the rectangle
  **(344, 26) to (624, 440)**. This is the same text the setup screens show beside the track list (`WORLD\CIRC1.TXT`:
  "The Crazy Eight", a blank line, then a paragraph). A drag strip's text also carries the venue's facts (opening
  date, capacity, operator).
- One button, OK (`okbtn.bmp`, id 1068), goes back (`0x4c3130`).
- **Nothing is played.** The screen starts no sound and no video; the SIT's "Track Announcer .WAV file" line
  ("Track" in every stock SIT) is not read by it, and the only sounds the menu screens play are the tab click and
  the focus sound.

The setup screens' small picture is the SIT's "Track Logo .BMP file" (`+0x70`, the stock `UI\<stem>T.BMP`).

**In OpenMTM2:** the Races screen shows an MTM1 track's logo as its preview and, when the map bitmap is mounted,
a Zoom button that opens the map with the description over it in the same rectangle (`src/ui/screens/race-select.js`).
Stock tracks need MTM1's `UI.POD` mounted; an add-on track carries its own.

---

## 3. Cheats and debug features

`0x42f900` keeps the last 8 keys typed during a race, newest first, at `0x57aa40`. A recognised
word plays `chkclick.wav`:

| Word | Effect |
|---|---|
| **GOLD** | toggles `0x548300`, the debug switch (below) |
| **FRAME** | toggles `0x548108`: the frame rate in the bottom right corner |
| **DANCE** | toggles `0x548100`: an oscilloscope of the sound mixer's output drawn across the screen (`0x417a10`) |
| **TREX** | turns the player's truck into the dinosaur: the body model becomes `REX.BIN` (with `REX1`-`REX4.BIN`, in `GAME.POD`), the tires move to x = +-4, y = -24, z = +5.67 and -4, the truck is lifted by 20 ft (`+0xfe4`), its radius `+0xfb8` becomes 30 and `+0x10a4` becomes -23. Not undone until the race ends |

With **GOLD** on:

| Key | Effect |
|---|---|
| Ctrl+Y | slew mode (`0x547f70`), as in MTM2 |
| Ctrl+T | cycles `controlflag` (`0x83a3c8`) 0, 1, 2, 3: below 2 the player has the throttle, below 3 the steering; 3 is the full autopilot |

Without GOLD (any time the chat line is not open):

| Key | Effect |
|---|---|
| Z | toggles `0x547f8c`, **Z mode**: the technical overlay (`0x417ba0`: zoom, sector, visible and total polygons, level, models, textures) and a physics line (`0x44a1b0`: velocity, controlflag, gear, course, substep count, throttle, brake) |
| - and = (Z mode) | zoom |
| Ctrl+L (Z mode) | prompt "Load situation :", loads any SIT by name (`0x417f80`) |
| Ctrl+S (Z mode) | prompt "Save situation :", writes the race as a SIT |
| X (Z mode) | toggles the computer trucks' control flag |

There is no CHUCK, NOLOCK, 3DFX or DEMO word in this build.

**In OpenMTM2** (`src/game/cheats.js`, `src/ui/gold-mode.js`): DANCE and TREX are typed as in the game. DANCE draws the
mixer's output over three guide lines. TREX draws the player's truck as the dinosaur when `REX.BIN` is mounted; the
simulation keeps the truck's own tires and hull.

The INI (`.\system\monster.ini`) holds every key binding under names that show the feature list
of the time: `keyAutoStage`, `keyHelicopter`, `keyYeeHaw`, `keyHorn`, `keyPitboard`, `keyCamera`,
`keyChat`; and `startupPodName`, `gamePodName`, `truckPodName`, `uiPodName`, which name the four
PODs (so they can be replaced without touching the executable).

---

## 4. Physics: MTM1 against MTM2

### 4.1 Method

MTM1's simulation is 0x446cd0-0x489000; MTM2's is 0x468e70-0x4bb4b0. `match.py` aligns the two
ranges (the functions are in the same order) and `fdiff.py` diffs each pair with addresses and
variable names blanked. What remains in a diff is real: a changed constant, an added call, a
moved field. `dconsts.py` then compares the start-up values of every global each pair reads.
The results are `re/mtm1/out/match_sim.tsv` and `re/mtm1/out/diff/`.

### 4.2 What is identical

Line for line, or differing only by what the compiler inlined:

| Part | MTM1 | MTM2 | `MTM2_PHYSICS.md` |
|---|---|---|---|
| Stepping: dt, substeps of at most 0.1 s, order of work | `0x44a1b0` | `0x46c0e0` | 4 |
| Truck step | `0x44d1e0` | `0x470810` | 14.1 |
| Rigid box step | `0x44d7e0` | `0x470d70` | 14.16 |
| Body matrices and Euler rates | `0x447390`, `0x44bb0b` | `0x468ee0`, `0x46e20b` | 9.4 |
| Force and moment sums, inertia | `0x44ad00`, `0x44aec0`, `0x44b290` | `0x46cfe0`, `0x46d270`, `0x46d730` | 8, 9 |
| Position integration | `0x44b4f0` | `0x46da30` | 9.3 |
| Tire geometry and contact | `0x459030`, `0x458e10`, `0x459210` | `0x47f7d0`, `0x47f520`, `0x47fa20` | 14.2, 14.10 |
| Tire normal load and grip limit | `0x4570c0` | `0x47d110` | 5.1 |
| Tire-cut factor table | `0x456c20` | `0x47cb50` | 2.3 |
| Longitudinal tire force, wheel spin, engine | `0x457afb` | `0x47dce0` | 5.2 |
| Lateral tire force | `0x4586a0` | `0x47eb30` | 5.3 |
| Tire force to body | `0x457270` | `0x47d310` | 14.6 |
| Drag and aerodynamic damping | `0x4509e0`, `0x450b70` | `0x474f90`, `0x475180` | 5.4 |
| Hull push-out, wheels and solid axles | `0x45211f`, `0x4523d0`, `0x456320` | `0x47681f`, `0x476b80`, `0x47bfa0` | 10 |
| Hull contact solvers | `0x4533d0`, `0x453aa0`, `0x453e90`, `0x4546b0`, `0x455360` | `0x477eb0`, `0x478790`, `0x478cd0`, `0x4798a0`, `0x47aab0` | 14.12 |
| Transmission and automatic shifting | `0x452b40` | `0x477520` | 5.2 |
| Post-step | `0x44dd80` | `0x471280` | 10 |
| Helicopter, drop-off, stuck and flipped checks | `0x44c200`, `0x44cc90`, `0x44ca30` | `0x46ed90`, `0x470190`, `0x46fd30` | 10.3 |
| Collision broadphase and truck-against-box | `0x460bb0`, `0x46197d` | `0x488d90`, `0x489f9d` | 7 |
| Course follower, steering and target speed | `0x45b5d0` | `0x481ea0` | 14.22 |
| Traffic avoidance | `0x45c880` | `0x483600` | 14.25 |
| Checkpoints (pre-step) | `0x45f760` | `0x487300` | 14.24 |

**The tunables are the same** (`dconsts.py` finds no difference in any tire, drag or autopilot
function): the grip constant 1.75 (`0x547878`), 0.45 (`0x54789c`), 0.725 (`0x547898`), the
rolling and brake drag 0.02 and 0.8, the 0.9 and 1.1 torque factors, the 800 rpm floor.

**The default truck is the same.** `0x4209b0` against MTM2's `0x4bd480`: all 127 values it
stores are equal, at the same offsets (weights 6000 + 2000 + 2000 lb, inertia, springs 2757.67
and 3909, the torque curve, the gear ratios, the autopilot gains). The Garage setters are the
same (`0x423320` tire cut, `0x423340` suspension, `0x423400` transfer gear with the same table
at `0x543d20` and the same x1.25 on Rookie and x0.75 on Professional). The Garage has the same
three settings and no more (a saved game writes "User Truck Settings (tire cut, suspension,
transfer gear)").

The truck object is laid out the same up to `+0x10a8`; MTM1's is 0x1164 bytes and ends soon
after, where MTM2's goes on with damage and lamps. The human-driver flag is `+0x113c` (MTM2
`+0x176c`).

### 4.3 What differs

1. **Water is far thicker.** The surface table `0x448380` gives type 3 (Water) the drag density
   **1.0**, where MTM2 has 0.15; every other row is equal (mu 1.0, 0.9, 0.4, 0.4, 0.7, 0.7, 0.6,
   0.2, 0.3, 0.8, 0.8, 0.6 for types 1 to 12, density 0.002377). The fluid-area routine
   `0x44fea0` tests for the density 1.0 where MTM2's `0x4740c0` tests for 0.15. A submerged
   part therefore drags 6.7 times harder in MTM1: water stops a truck.
2. **There is no deep water.** MTM1 has no type 13: no case for 1300 in the surface table, and
   the contact probe `0x44a880` has no depth-below-the-water-level branch (MTM2's `0x46c9e0`
   has). Water in MTM1 is only what the texture's `.TTY` entry says.
3. **No weather.** The grip limit is `cut factor x 1.75 x mu`; MTM2 multiplies by the weather
   factor as well (`MTM2_PHYSICS.md` 2.3). MTM1 has no rain or snow.
4. **No crash damage.** MTM2's hull contact routine (`0x475960`) reports impacts to the damage
   code and records the impact speed (`+0x1760`); MTM1's (`0x451550`) does neither.

5. **Wheels against wheels hit harder.** Of the truck-against-truck code this is the one routine
   that differs: the response to one truck's tire touching another's (MTM1 `0x467fd0`, MTM2
   `0x491e20`; `MTM2_PHYSICS.md` 14.20). Two things changed between the games:
   - **The speed the force is made from.** Both games make the force `|V . N| / dt x m`, with
     `N` the contact's direction and `m` the lighter truck's mass. In MTM2 `V` is **half the
     relative velocity** of the two contact points (the constant 0.5 at `0x60ef40`). In MTM1
     there is no 0.5: `V` is chosen axis by axis, in the struck truck's axes, as the relative
     velocity `vB - vA` unless the larger in magnitude of `vA` and `vB` is smaller still, in
     which case it is that one. Head-on at equal speeds the two games agree (the relative
     velocity is twice either truck's, so MTM1 takes one truck's and MTM2 half of the sum).
     **A moving truck that touches the wheel of a slow or standing one is hit twice as hard in
     MTM1**: the relative velocity is the mover's whole speed, where MTM2 takes half of it.
   - **The climb of spinning tires.** When the contact is on the tire's tread, both games add a
     force across the contact from the two tires' rim speeds (`radius x spin`). MTM1 adds both
     tires' rim speeds **always** and scales by **0.1**; MTM2 counts a tire only when it is on
     the ground and scales by **0.05**. A truck whose wheels are spinning is thrown at least
     twice as hard off another's tire in MTM1, and a wheel in the air still throws.

   Everything around it is equal: which wheels are tested, the geometry of the contact, the
   0.05 ft added to the push apart, and the rule that the faster truck is the one moved.

Compared routine by routine and found equal (the differences are the compiler's: a helper
inlined in one game and called in the other, operands reordered):

- **Hull against hull**: the pair test (`0x461150` / `0x4894a0`), the choice of the axis the
  relative motion leaves by soonest (`0x463640` / `0x48c3d0`), the push apart and the force
  (`0x465510` / `0x48eb70`, `0x465f50` / `0x48f6f0`, `0x463a20` / `0x48c8a0`). MTM2's only
  addition is the call to the damage routine with the hull point and the force.
- **The wheel pair test** in front of the response above (`0x462b20` / `0x48b5d0`,
  `0x469250` / `0x493410`).
- **Truck against box** (`0x46197d` / `0x489f9d`, `0x472a50` / `0x49f920`,
  `0x473cd0` / `0x4a12b0`), **top crush** (`0x4751b0` / `0x4a2d80`) and the box routines behind
  them (`0x4789b0` / `0x4a6390`, `0x479f1c` / `0x4a7fcc`, `0x47c2d0` / `0x4aad00`).
- **The hull on the ground** (`0x451550` / `0x475960`): the same forces. The branch keyed on
  **44.01 ft/s** (30 mph) that only MTM1 has decides which of three routines outside the
  simulation is called (`0x43f530`, `0x43f6d0`, `0x4417a0`: by their place, the impact sounds);
  MTM2 makes those calls per hull point instead. No force depends on it.
- **Scrape points**: both games keep the `.TRK`'s twelve points as read, at the same place in
  the truck (`+0x5a4 + 12 n`), and build the hull box from the same six of them.

So the harder truck-against-truck hits remembered from MTM1 have one cause in the 1.00 code,
the wheel contacts. Nothing was found that makes a hull-against-hull hit or a hit on an object
any harder.

Smaller, and not affecting how a truck drives:

- MTM1's wheel routine and transmission call sound routines directly (engine start when the rpm
  is zero, the shift, the reverse beeper).
- MTM2's rubber-banding (`0x48106c`) has two more constants, 5 and 0.1, than MTM1's `0x45ab3c`
  (**not traced**).
- MTM2's race-order routine (`0x485afc`) has the Summit Rumble additions.
- MTM1's per-truck control routine (`0x459b80`, 2,851 bytes) is MTM2's `0x4805d0` (1,020 bytes)
  **plus the whole drag state machine** of section 5.

**Not examined: multiplayer.** How a remote truck's state is applied (the DirectPlay layer at
`0x41eed0`-`0x41f2f0`) was not read in either game. The "lag shots" of an online race, a truck
flung by another whose position jumped, would come from there together with item 5: a remote
truck that jumps into a wheel has a large relative velocity for one step. That is an inference,
not a reading.

### 4.4 Consequence

"MTM1 physics" is not a second vehicle model. A truck alone, with the same geometry on the same
ground, behaves identically in both games. What a player remembers as MTM1's handling comes from:

- the **trucks' own geometry** (each `.TRK`'s tire positions and scrape points, which OpenPhotex
  already reads for MTM1);
- the **tracks**;
- **water** (items 1 and 2 above);
- **wheels touching wheels** (item 5), which throw trucks about twice as hard;
- the absence of weather and damage.

---

## 5. Drag racing

Race type 1. One or two trucks: `0x833c7c` is the count, `0x833ae0` and `0x833ae4` the truck
pointers (lane 1 and lane 2).

### 5.1 The strip

A drag strip's SIT has eight checkpoints, in the gate table at `0x82f230` (0x294 bytes each;
position x `+0x4c`, z `+0x54`, heading `+0x60`):

| Checkpoint | Is |
|---|---|
| 1, 2, 3 | the **prestage**, **stage** and **start** beams, across both lanes |
| 4 | the **finish** line |
| 5, 6 | lane 1's two boundaries |
| 7, 8 | lane 2's two boundaries |

### 5.2 State

Per truck:

| Field | Meaning |
|---|---|
| `+0x8fc` | the stage state (called `staged` below): 0 nothing, 1 prestaged, 2 staged, 3 the tree has run for this truck, then one more for each further gate; from 90 up the truck is out (5.5) |
| `+0x90c` | the truck's own stage timer |
| `+0x910`... | the split table: the time each gate was crossed, each stored as the difference from the gate before |
| `+0x920` | the reaction time (5.4) |
| `+0xfa4` | `dragTimer`, the elapsed time |
| `+0xfa8` | the next checkpoint |

Global:

| Address | Meaning |
|---|---|
| `0x833cc4` | `bothStaged`, the phase of the start: 0 prestaging, 1 staging, 2 the tree, 3 green |
| `0x547890` | the phase timer |
| `0x83a838` | the race clock |
| `0x83a5f0` | `raceStartTime`, the race clock at the green |
| `0x54807c` | auto-stage is driving the player |
| `0x5482ec` | "stage my truck for me" was accepted for this run |

Crossing a gate (`0x45e610`, the routine shared with circuits) adds 1 to `staged` and stores the
split. The announcer speaks when a truck prestages and when it stages.

### 5.3 The start (`0x459b80`, run for each truck each step)

The phase timer runs once staging has begun: with two trucks, from the moment either has
prestaged; with one, from the start.

| Phase | Becomes the next when | Then |
|---|---|---|
| 0 prestaging | both trucks are prestaged, or one is and the timer passes **30 s** (one truck: it is prestaged, or 30 s pass) | timers to zero |
| 1 staging | both are staged and **2.0 s** have passed since the second one staged, or one is staged and the timer passes **30 s** | timers to zero |
| 2 the tree | the timer passes **0.5 s** | `raceStartTime` = the race clock; the announcer says go |
| 3 green | | |

A truck that is behind the phase is put out with code 98: not prestaged once the phase is 1, not
staged once it is 2.

Each truck's `staged` becomes 3 when the phase is 2 or more and its own timer has passed 0.5 s.

**The computer's staging.** While the phase is 0 or 1 a computer truck's target speed is

    target = min(2 ft/s, (2 * a * (d - overhang)) ^ 0.25)

where `d` is the distance to the phase's beam (prestage in phase 0, stage in phase 1) along the
beam's heading, `overhang` is how far the front tires sit ahead of the truck's origin, and `a` is
the truck's `+0x8bc`, the deceleration its autopilot counts on (`MTM2_PHYSICS.md` 14.22). Past
the beam the target is -100, which holds the brakes. During the tree the target is -100 until
`staged` becomes 3, then the ordinary course follower takes over: **a computer truck launches as
its timer passes 0.5 s, on the green.**

**Park and Neutral.** While `staged` is below 3 the gear selector treats Park and Neutral as
neighbours, and the keyboard cannot go between Reverse and first (as MTM2 kept: its 6.4).

### 5.4 Timing

All times come from the split table, so they have the sub-step accuracy of a checkpoint crossing
(`race clock - penetration / speed`). When the finish (the fourth gate) is crossed:

    dragTimer     (+0xfa4) = time of crossing the finish - raceStartTime
    reaction time (+0x920) = time of crossing the start beam - raceStartTime

**The elapsed time runs from the green, not from the truck's own launch**, so a slow reaction
costs elapsed time. This is unlike a real strip, where the clock starts when the truck leaves.

### 5.5 Being put out

`staged` values from 90 up, set once (a truck already out keeps its code):

| Code | Cause |
|---|---|
| 99 | **Red light**: the truck crossed the start beam before the green (the beam's time is earlier than `raceStartTime`, or the phase was still below 3) |
| 98 | **Not staged in time** (5.3) |
| 97 | **Out of the lane**: before finishing, the truck overlaps one of its lane's two boundary boxes (the truck-against-box test `0x477bf0`) |
| 96 | **Timeout**: 33 s after the green without finishing |
| 95 | **Not a fault: run again.** A truck that was already out collided with this one before it finished (set in the truck-against-truck routine `0x461150`) |

The run ends (`0x5482d0`) when every truck is either out or has a `dragTimer`. One truck being
put out does not stop the other's run.

### 5.6 The Christmas tree

`0x41cff0` builds a lamp word per lane; `0x41d490` paints it into the texture `TRLFACE.RAW`
(64 x 64, on the tree model beside the strip) and `0x41d9c0` draws the same lamps as a HUD panel
with labels.

| Bit | Lamp | Label | Lit when |
|---|---|---|---|
| 0x01 | prestage | Prestage | the lane's truck is prestaged or staged |
| 0x02 | stage | Stage | the lane's truck is staged |
| 0x04, 0x08, 0x10 | ambers | \\, " Get Set", / | phase 2: bit `int(timer x 8) + 1`, so one amber at a time at 0.125, 0.25 and 0.375 s |
| 0x20 | green | Go | phase 3 |
| 0x40 | red | Disqualify | the lane's truck has code **99 only** (not 96, 97 or 98); nothing else is lit for that lane |

Rows in the texture, top to bottom: y 0-6, 9-16, 19-26, 30-36, 39-46, 49-54, 57-63. Palette
colours 0x69, 0x69, 0x6f, 0x6f, 0x6f, 0xd6, 0x9c.

Circuit and rally starts use the two textures `STRTRED.RAW` and `STRTGRN.RAW` instead
(`0x41d830`): red (0x9c) for the first 3 s, then green (0xd6).

### 5.7 A drag event

The Drag setup screen needs **2, 4 or 8 trucks** entered, or it refuses with "Because of pairing
requirements, you must select 2, 4, or 8 trucks before beginning a drag race." (`0x4b26e0`).

**Qualifying.** "Prepare To Qualify!", then the player runs the strip **alone** (phase 1,
set-up `0x425dc0`). The player's qualifying time is the run's `dragTimer`. A player who is put
out is offered "Requalify", "Cancel" (take the maximum time) or "Staging Tips"; a player who did
not stage in time is offered **Auto-Stage** ("Would you like your truck to be staged for you?"),
which reruns the pass with the autopilot staging the truck. The maximum time is **33.33 s**.

The computer does not run. Each computer entrant's time is

    time = PAR + rand() / 32768 - 0.5

with `PAR` the strip's par time (section 2.5): a uniform draw within half a second of par
(`0x4bbd60`).

The entrants are sorted by time and given **qualifying points**: 100, 90, 80, 70 for the first
four and 60 for everyone else; none for a maximum time. A "Qualifying Results" dialog shows the
order.

**The bracket** (`0x4bc170`, pairing `0x4bc030`). With the entrants numbered 0 (fastest) to n-1
by qualifying:

| Entrants | First round | Pairs |
|---|---|---|
| 2 | the final | 0 v 1 |
| 4 | semi-finals | 0 v 3, 1 v 2 |
| 8 | quarter-finals | 0 v 7, 3 v 4, 2 v 5, 1 v 6 (in that order down the bracket, so the semi-finals are the winners of the first two and of the last two) |

The bracket screen (state 1104) shows it and offers **Race**, **Skip** and **Cancel**.

- **Race** (`0x4bda10`) runs the current pair (state 1101, phase 3). In a pair with the player
  the "Choose Drag Lane" dialog asks Left or Right; otherwise the lanes are drawn at random.
- **Skip** (`0x4bdc40`) simulates the pair: each side that is not disqualified draws
  `PAR + rand() / 32768 - 0.5`, redrawn until the two differ, and the lower wins; a disqualified
  side loses to one that is not.

After a pass (`0x4bb910`): equal times show "The race ended in a tie!" and the pair runs again;
both trucks out shows "Both trucks have disqualified. Prepare to rerun the race."; otherwise a
"Drag Results" dialog (with a Replay button) names the winner, who moves to the next round
(`0x4bc490`): pair `m` feeds pair `m / 2`, as its first truck when `m` is even.

**Points** (`0x4bb6d0`, added to the qualifying points):

| For | Points |
|---|---|
| winning a quarter-final or a semi-final | 250 |
| winning the final | 350 with 8 entrants, 300 with 4, 250 with 2 |
| losing a pair, having left the line legally (`staged` above 2 and not 99) | 200 |
| the fastest single pass of the event (`0x4bf100`) | 50 |

Each entrant's record keeps its qualifying time, its last time, its fastest time, the points and
a time per round.

**Results.** State 1103 plays `drag.smk` if the player won the final, then the Drag results
screen (1102) lists the entrants and offers each to the Hall of Fame (`0x49e5a0`, category 0,
with the points and the fastest time).

### 5.8 The announcer in a drag race

`0x4496f0`, run once a step, only in a drag race: prompts a truck that has not prestaged at 10 s
and 20 s (saying how long is left of the 30) and the same for staging; calls a disqualification;
calls the holeshot (the first truck off the line, or the one with the earlier start-beam time);
calls the winner by `dragTimer`.

---

## 6. Tournaments

### 6.1 The file

`TOURNEY\*.TRN` in `STARTUP.POD`, and loose in a `tourney` folder for the player's own. Text,
labels and values on alternate lines:

    == Tournament Name ==
    Monster Truck Triathlon
    == Tournament Description File ==
    tri.txt
    == Has Drag Race Flag ==
    1
    == Number Of Tracks ==
    3
    == Track Entry #1 ==
    DRAG5.SIT,0
    == Track Entry #2 ==
    CIRC4.SIT,10
    == Track Entry #3 ==
    ISLAND.SIT,0

A track entry is `file,laps`; laps is 0 for a drag strip or a rally. The description file is
plain text shown on the Tournament screen. Three ship:

| File | Name | Events |
|---|---|---|
| `TRI.TRN` | Monster Truck Triathlon | DRAG5; CIRC4, 10 laps; ISLAND |
| `DOUG.TRN` | Doug's Tournament of Evil | DEMO; DRAG5; CIRC2, 5 laps; DRAG4; CIRC4, 20 laps |
| `WHIRL.TRN` | Whirlwind Circuit Madness | CIRC5, CIRC4, CIRC3, CIRC2, CIRC1, 2 laps each |

Limits: **16 tournaments**, **16 events** in one, 1 to 20 laps for a circuit. A tournament with
the drag flag needs 2, 4 or 8 trucks. The three stock ones cannot be deleted ("This is a
factory-default tournament").

### 6.2 The custom tournament editor

State 1016 (`CMCCustomTourneyView`, message map `0x527310`): a tournament name and description,
the list of available tracks and the list of events with add and remove, a lap count for the
selected circuit, and New, Delete and Save. It writes the file above (`0x4c6960`), as
`<name>.trn` or `<name> <n>.trn` when the name is taken.

### 6.3 Running one

The tournament is an array of event records, 0x12c8 bytes each, at `0x90aa78`; `0x90bd20` is the
event count, `0x90bd24` the current event, `0x90bd28` the tournament flag. The same trucks and
drivers enter every event.

1. **Race!** on the Tournament screen (`0x4b8040`) checks the truck count when the tournament
   has a drag event, reads the `.TRN` into the event records and requests state 1401, which
   opens event 0 (`0x49f910`): **that event's own setup screen** (Drag, Circuit or Rally, by the
   track's type) with the tournament flag `0x5e4f30` set, so the screen takes the event's track.
   From there the event runs exactly as a single event does, including a drag event's
   qualifying and bracket.
2. When an event's results screen is closed (`0x49fa00`), the next event's screen opens.
3. After the last event (`0x49fae0`): each truck's points are **added over all events** and the
   trucks sorted by the total. State 1403 plays `tourney.smk` if the player is first, then the
   Tournament results screen (1402) draws "POINTS TOTALS", the tournament's name and a table of
   Place, Truck (Driver) and Points. Each entry is offered to the Hall of Fame (category 3,
   points only).

There is no elimination between events and no carried-over time: a tournament is its points.

### 6.4 Points per event

- **Drag**: section 5.7.
- **Circuit and rally** (`0x4bffb0`, `0x4c11d0`), as MTM2 (`MONSTER_EXE_ANALYSIS.md` 6.6): 900,
  700, 500, 400, 300, 200, 150, 100 by place; in a circuit, 100 more for the fastest lap, and a
  share of 100 for **laps led**: `floor(100 / laps)` for every lap the truck finished in first
  place (counted in truck `+0x900`, `bonusLaps`), or the full 100 if it led them all.

The Hall of Fame keeps four categories: drag (points, fastest time), circuit (points, fastest
lap, average lap), rally and tournament.

### 6.5 The saved game

A saved game (`.mtm`, written by `0x445270`-`0x4462b0`) is text with labelled lines, and its
labels are the best description of the records above: per event "Race Type", "Race Started",
"Truck Count", then per truck "Truck Name", "Truck File", "Driver Name", "Active Flag", "Truck
Points Index", "Truck Times (qualify, last, fastest)", "Total Points", "Drag Round Times"; then
"Track Name", "Track File"; for a drag event "Pyramid Driver Count", "Current Round, Starting
Round", "Current Race Pair", and per pair "Driver Player Numbers", "Driver Times", "Driver
Disqualified Flag", "Driver Rerun Flag", "Winner", "Race Over"; "Number Of Laps"; and for the
whole game "Player Name", "Player Truck File", "Player Skill Level", "Race Mode, Race Count,
Current Race, Tournament Mode", "Tournament Name", "User Truck Settings (tire cut, suspension,
transfer gear)".

---

## 6.6 Particles and tire tracks

`MONSTER.INI` `partsFlag` (`0x548118`) is a level, 0 to 2, that a key steps up and down in a race. Its two effects
work on the ground's own texture: MTM1 has no dust sprites behind the wheels and no tire track models.

**The surface flags** (`0x4300c0`, the same table as MTM2's `0x4de180`): the value's type gives Cement 10, Dirt 13,
Water 1, Mud 5, Sand 9, Grass 5, Gravel 5, Snow 5, anything else 0. Bit 1 throws particles (every one of them but
Cement); bit 4 takes tracks (Dirt, Mud, Grass, Gravel, Snow).

**Particles** (level 2; `0x433980`, for each of the four tires every frame): a tire on the ground,
moving, with the truck moving, on a bit-1 surface, throws three particles from each of its three points (`+0xd8`,
`+0xe4`, `+0xf0`), nine a frame. Each leaves at the tire's velocity (`+0xfc`) times a random factor: 0.9 to 1.1
across (x and z), 0.5 to 1.5 up (y). That velocity (`0x448a20`) is a direction of the tire's (`+0xac`, not traced)
times half the rim speed (`radius x spin / 2`, in size), plus a random push across of up to 3 ft/s and along of up to
half the truck's forward speed, in body axes.
- The pool holds 256 (`0x7c1c10`, 52 bytes each, a ring: the 257th takes the first's place). A particle is a single
  point (`0x4a0f6b`) in one palette colour: the texel of the ground's texture under the place it was thrown from.
- It lives 3 s (`0x30000`), falls at 32 ft/s² (`-0x2000` in feet x 256), and (`0x4a0e20`) when falling below the
  ground it lands: it is gone, and the ground's texel where it landed takes its colour (`0x4a1440`).

**Tracks** (level 1 and up): a tire on a bit-4 surface lays a line (`0x4a16c0`, Bresenham, one texel a foot, at most
32 texels a step) from where it touched last to where it touches now, darkening each texel through the palette's
shade table. The line's width in texels (its fifth argument, pushed first at `0x433d0f`) is the tire's radius
(`+0x6c`) truncated to a whole number, not its width (`+0x74`): 2 texels for a tire of 2.x ft, 3 for the default
3.0 ft. The texels across run from `-width / 2` (integer division) to `width - 1 - width / 2`.

**How the ground is drawn on** (`0x4a1440`, `0x4a1130`): a cell that is drawn on gets a copy of its tile
(`TRTRK%d.RAW`, in the texture cache) and the cell's texture is pointed at it; the texel is found with the cell's own
turn and mirror (CLR bits 12-15). At most 32 cells hold copies, taken in turn: the 33rd cell drawn on gives the first
its own tile back, its marks gone.

## 6.7 Skid sounds

MTM1's skid sounds come from the same triggers as MTM2's (MONSTER_EXE_ANALYSIS.md 12, "Skids"), and one more that
MTM2 left unused. Each picks its sample by the surface under the tire (`type * 100`):

| Routine | Fired by | 0, 100 | 200, 400, 500, 600 | 300, 800, 900 | 700, 1000, 1100, 1200 |
|---|---|---|---|---|---|
| corner `0x43cac0` | a tire starting to slide, as MTM2's `0x47c480` (`0x456700`); the RL tire, looping | `corncem1` | `corndir1` | `cornice1` | `corndir1` |
| spin `0x43cd60` | full throttle on dust, as MTM2's `0x477520` (`0x452b40`); one a truck, looping | `spincem%d` | `spindir%d` | `spinice%d` | `spinroc%d` |
| skid `0x43d050` | the brake going on, from fully off, faster than 29.34 ft/s (`0x43d580`, `0x42eacc`); each rear tire, once | `skidcem%d` | `skiddir%d` | `skidice%d` | `skidroc%d` |

Other surfaces (1300, 1400) play nothing. `%d` is `(rand << 2) / 0x7fff`, 0 to 3. MTM1's archives hold `skidcem0`-`3`,
`skiddir0`-`3`, `spin*1`-`3` and the `corn*1`: a spin of variant 0, and any `skidice` or `skidroc`, is silent.
MTM2's `SOUND.POD` carries every one of these but `spinice1`-`3`. The spin and the corner stop as MTM2's do (`0x43d300`,
`0x43d3c0`). MTM1's engine (`engstart.wav`, then `idle1.wav` looping, `shift.wav`, `engstop.wav`, `0x43c930`,
`0x441350`) is not in MTM2's `SOUND.POD`, and its pitch, set in the mixer, is not traced.

## 6.8 Ground boxes and the world's edge

Read from the decompiled `MONSTER.EXE` (`re/mtm1/`); nothing here is decompiled code.

- **Loader `0x4a3dee`:** the level's `.RA0` and `.RA1` go into 18-byte records at `0x5f98c0`: +0 the lower height
  shifted left 7, +2 the upper, +4 the six `.CL0` face words, +0x10 the `.LTE`'s third byte. No field hides a box.
- **World draw `0x4a9990`:** from the view's cell (`(x & 0x1fe000) >> 13`) it walks rings of cells from 10 out to the
  view's own, and for each draws the terrain (`0x4a5610`) and the cell's box (`0x4a8df0`, `0x4a9060`). The other path,
  `0x4a9750`, walks the same rings through `0x4a9320`, which also asks `dx^2 + dz^2 < 0x7a`; the global `0x547ff4`
  picks the path (**hypothesis**: the renderer mode). **The ground is drawn only within about 11 cells (350 ft) of the view.**
- **Terrain `0x4a4bd0`:** the vertex window runs from the view's cell - 10 to + 11 unwrapped; only the height lookup is
  masked to the map, so the terrain continues across the map's seam.
- **Box `0x4a5dd0`:** nothing when lower equals upper; otherwise the box stands at its own cell, masked to the map
  (`(cell & 255) << 13`), **never beside the view**: a box across the seam is placed a whole world away and culled when
  all eight corners clip.

So MTM1 shows a ground box only while the view is within about 11 cells of the box's own, unwrapped cell. MTM2 draws
boxes beside the view across the seam (MONSTER_EXE_ANALYSIS.md, "The wrapping world"). ISLAND is the one stock level
this matters to: of its 1,496 boxes, 1,020 are a fence 400 ft high on the map's edge (rows 0 and 255, columns 254 and
255, faces textured `GALV.RAW`), while its land spans columns 24 to 215 and rows 9 to 232. In play the fence is never
seen, but it stays solid.

The port draws the world wrapped round the camera, with a longer draw distance. It leaves undrawn every MTM1 box on the
map's outer two cells; those boxes stay in the simulation (`worker/track-build.js` `mtm1EdgeBoxDrawn`). In play the game
does not draw even the stretch of ISLAND's north fence that a beach comes within 11 cells of (about 20 boxes), so the
distance rule above is not the whole story there; what else keeps them undrawn is not traced.

## 7. What this means for OpenMTM2

### 7.1 "MTM1 physics" as an option

Because the model is shared (section 4), the option is a small set of switches on the existing
simulation in OpenPhotex (`src/sim/mtm2/`), not a second simulation:

| Switch | MTM2 | MTM1 |
|---|---|---|
| Water drag density (surface type 3) | 0.15 | 1.0 |
| Deep water below the level's water height (type 13) | yes | no |
| Weather grip factor | Rain 0.8, Snow 0.6 | always 1 |
| Crash damage | yes | no |
| Wheel against wheel: the speed the force is made from | half the relative velocity | per axis, the relative velocity or the faster point's, whichever is smaller |
| Wheel against wheel: the spinning tires' climb | 0.05, tires on the ground only | 0.1, both tires always |

In OpenMTM2 it is a choice of the player's, the Physics list on the Game tab of Options (and the
console's `physics`), not something a track decides. Trucks need nothing: an MTM1 `.TRK`
already supplies its own geometry.

### 7.2 Drag racing

The port's pass (`src/game/drag-race.js`, `MONSTER_EXE_ANALYSIS.md` 6.4) follows a description
of the rules by Community Patch 3's author. MTM1's code agrees with it on the timers (30, 30,
2.0, 0.5 and 33 s), the codes 95 to 99 and the timing from the green, and settles these points:

- **`decel_k` is known.** The staging law's gain is the truck's `+0x8bc`, the deceleration its
  autopilot counts on, recomputed every step by the course follower (5.3); it is not a constant.
- **One truck does go green** in the 1996 game: qualifying is a one-truck pass, and the phase
  machine has a one-truck path throughout (5.3).
- **Each truck is judged against its own lane** (lane 1: checkpoints 5 and 6, lane 2: 7 and 8),
  with the ordinary truck-against-box test.
- **The beams are the ordinary checkpoint test**, on the hull points, as on a circuit. The front
  tyre rule is CP3's.
- There is **no backing-up rule** in 1996: code 97 is the lane boxes only.
- The Disqualify lamp lights for 99 only.
- The computer launches when its own timer passes 0.5 s, on the green, with no reaction delay.

What is new to build is the **event** around the pass (5.7): qualifying alone with par-based
computer times, the bracket of 2, 4 or 8 with its pairing, Race, Skip and the lane choice, the
tie and double-disqualification reruns, the Auto-Stage offer, and the points. The par time is in
the SIT's fly-by line, which OpenPhotex should expose as text so the game can read a number or
"Sonic" from it.

### 7.3 Tournaments

New work, all above the simulation: a `.TRN` reader and writer (OpenPhotex, since it is a game
file), the Tournament screen and the editor, an event list that walks the existing single-event
flow, and the points totals screen. The three stock tournaments are in `STARTUP.POD` of both
games, so they can be offered whenever the tracks they name are installed.

### 7.4 Extras worth having

- **Free roam**: race type 0 is a real mode. `HILLCLIM.SIT` can be listed (OpenMTM2 already
  reads it when its level is present) under its own type.
- **TREX, DANCE**: two more typed codes for `src/ui/gold-mode.js`, where the art is installed.
- The **Quick'n'Ugly** menu's layout is fully known (2.2), should the console or a debug menu
  want to pay tribute to it.

### 7.5 Ramps and checkpoints on MTM1 tracks

As MTM1 plays (seen in the game, **not traced** in its executable): a ramp's model (type 99,
`CRURAMP.BIN`) is drawn, where MTM2 leaves ramps unseen, and a checkpoint banner (`CKBAN1.BIN`
to `CKBAN4.BIN`, type 6) stands on two solid poles that stop a truck, while the banner between
them is passed under. In the model the poles are its one opaque mesh (`BAN06.RAW`, two posts
2.9 ft by 4 ft and 32 ft tall, 77 ft apart) and the banner its cut-out meshes. OpenMTM2 draws an
MTM1 track's ramps, and makes each separate opaque part of an MTM1 checkpoint's model an
immovable box (`worker/track-build.js` `solidParts`); MTM2 makes no checkpoint a collision box.

---

## 8. Additions to the MTM2 documents

Found while reading MTM1; the first two were checked in MTM2's code, the third was not.

- Truck `+0x900` is **`bonusLaps`, the count of laps finished in first place** (MTM2 `0x485afc`
  increments it when a lap closes with the place `+0x8f8` equal to 1). `MONSTER_EXE_ANALYSIS.md`
  6.6 calls it a flag "which only the winner had"; the share of 100 is per lap led.
- Truck `+0x920` is written as the drag reaction time by the same routine in MTM2.
- **Hypothesis**: the drag par time read from the fly-by line is unused in MTM2, since nothing
  there runs a drag event.

---

## 9. Open questions

- The two extra constants in MTM2's rubber-banding (4.3).
- Whether the loser's 200 points are tied to the side of the pair or to the lane, when the lanes
  were swapped (`0x7ea430`): the code tests the truck in lane 1 for the pair's first side.
- The fastest-lap bonus on a one-lap circuit and on a tie (read from MTM2's rule, not re-derived
  here).
- The INI key `kiethFlag`: read at start-up, use not traced.
- Multiplayer (the DirectPlay layer at `0x41eed0`-`0x41f2f0`) was not examined, in particular how
  a remote truck's state is applied (4.3).

---

## Appendix: address index

| Address | What |
|---|---|
| `0x40d3d0` | exit: prints the Metal Crush copyright line |
| `0x417a10` | DANCE oscilloscope |
| `0x417ba0`, `0x417f80` | Z mode overlay; load and save situation prompts |
| `0x418e80` | the race loop |
| `0x419cc0` | internal mission list |
| `0x41b460`, `0x41c310`-`0x41c330` | Heavy Metal Truck Event Setup; the three "Hook for..." boxes |
| `0x41cff0`, `0x41d490`, `0x41d9c0` | tree lamp word; tree texture; tree HUD panel |
| `0x41d830` | circuit and rally start lights |
| `0x41dc20`, `0x4245c0` | Quick'n'Ugly dialog; its launcher (no caller) |
| `0x4209b0` | default truck parameters |
| `0x4214a0`, `0x421830` | TRK writer; TRK reader |
| `0x423320`, `0x423340`, `0x423400` | Garage: tire cut, suspension, transfer gear |
| `0x424030` | Terminal Video Interface |
| `0x424640`, `0x424ce0` | attract demo; its truck set-up |
| `0x4247a0`, `0x424910`, `0x424aa0` | run a drag pass, a circuit, a rally |
| `0x424c50`, `0x42c5a0` | truck editor launcher (no caller); truck editor dialog |
| `0x425dc0` | drag qualifying set-up |
| `0x426860` | Metal Crush 0.50 credits |
| `0x42f900` | typed cheat words |
| `0x436d90`, `0x437750` | SIT loader; SIT writer |
| `0x445270`-`0x4462b0` | saved game writer and reader |
| `0x446cd0`-`0x489000` | the simulation |
| `0x448380` | surface table |
| `0x4496f0` | drag announcer |
| `0x44a1b0` | simulation stepping |
| `0x44d1e0` | truck step |
| `0x459b80` | per-truck control: speed control, race start, **drag state machine** |
| `0x45e610` | checkpoint pass, laps, drag timing |
| `0x461150` | truck against truck; sets drag code 95 |
| `0x49b810` | attract-mode timer |
| `0x49c770` | application state switch |
| `0x49dd70` | track catalogue scan |
| `0x49e5a0` | Hall of Fame entry |
| `0x49f910`, `0x49fa00`, `0x49fae0` | tournament: open an event, advance, totals |
| `0x4b26e0` | Drag setup: Race |
| `0x4b2c50`, `0x4b3d30`, `0x4b73e0` | the "Fly By" buttons (open the zoom map) |
| `0x4bb490`-`0x4bdc40` | drag bracket screen: results, points, qualifying, pairing, advance, Race, Skip |
| `0x4bf100`, `0x4bffb0`, `0x4c11d0`, `0x4c22a0` | results screens: drag, circuit, rally, tournament |
| `0x4c6960` | TRN writer |
| `0x5439c8` | Quick'n'Ugly selection |
| `0x547878` | grip constant 1.75 |
| `0x547f8c`, `0x548300` | Z mode; GOLD |
| `0x5482dc`, `0x839ef4` | race phase; race type |
| `0x5482fc` | difficulty |
| `0x54830c` | "Sonic" boost flag |
| `0x57aa40` | typed-key buffer |
| `0x5d6da0` | track catalogue |
| `0x5f9820` | the SIT's fly-by line |
| `0x7d6718`, `0x8143cc`, `0x833ae0` | player's truck; current truck; truck pointers |
| `0x7ea4a0` | key states by scan code |
| `0x82f230` | checkpoint gate table |
| `0x833cc4`, `0x547890`, `0x83a5f0`, `0x83a838` | `bothStaged`; phase timer; `raceStartTime`; race clock |
| `0x90aa78`, `0x90bd14`, `0x90bd20`, `0x90bd24`, `0x90bd28` | event records; current event; event count; current index; tournament flag |

### Object sounds

A SIT box's second sound name (a grandstand's `CROWD.WAV`, say) is registered as a continuous sound
at the box's place when the level loads (`0x436590` calls `0x40aa60` with volume 0x3f times the
INI's sound volume, and no repeat interval, which makes it a loop), as MTM2 does. The first name is
the hit sound (`SCREAMX.WAV` for Crazy Eight's stands).
