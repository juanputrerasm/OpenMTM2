# Community Patch 3: analysis of monster.exe 2.0.52

This is a reverse-engineering survey of the Community Patch 3 (CP3) executable. It records what CP3
adds to Monster Truck Madness 2 so OpenMTM2 can offer the same behaviour. It complements
`MONSTER_EXE_ANALYSIS.md`, which covers the retail 2.00.42 build, and repeats nothing from it.

The facts here come from our own analysis of the executable (a Ghidra decompile kept in the
git-ignored `re/cp3/`). They do not come from the CP3 author's own documents. Function names
(`FUN_...`) and global addresses are for this exact build. Anything not confirmed in code is marked
**hypothesis**.

---

## 1. Build

| Item | Value |
|---|---|
| File | `monster.exe`, 7,954,432 bytes, MD5 `8d4acd1cf8b2668a26887aadb856a1f6` |
| Version resource | FileVersion and ProductVersion **2.0.52.0** |
| Machine | PE32+ x86-64, image base 0x140000000, DPI-aware manifest |
| Toolchain | MSVC (linker 14.51), statically linked MFC |
| New imports | Media Foundation (`MFPlat`, `MFReadWrite`) for MP4 video, GDI+ for PNG, `WS2_32` for its own UDP networking, `dbghelp` for a crash handler, `DINPUT8` |

It is a 64-bit rebuild of the game, not a patch of the 1998 binary. Every address differs from
2.00.42. The INI file is still `.\system\monster.ini`, and the registry key is still
`SOFTWARE\Microsoft\Microsoft Games\Monster Truck Madness\2.0`.

## 2. Features OpenMTM2 already covers

These are documented elsewhere and only listed here:

- the non-bitmap menus, HD resolutions and UI scale (`CHANGELOG.md` M16)
- HD art: `.SI2`, PNG and TGA textures, normal maps, extended `.BIN` (`CHANGELOG.md` M16, `STANDALONE_ASSETS.md`)
- free roam, quick race, drag race and drag weekend (`MONSTER_EXE_ANALYSIS.md` 6.4)
- UDP direct connect (`MONSTER_EXE_ANALYSIS.md` 14.5)
- the auto-stage key and the checkpoint finder

## 3. Hidden or not-yet-ported features

The INI reader (`FUN_14018bbb0`) and the option screens name these. "Port" says whether OpenMTM2
has the feature.

| Feature | INI key or label | What it does | Port |
|---|---|---|---|
| AI Speed | `[Game] aiSpeed` | Scales computer trucks' speed and torque (section 5) | Added with this doc |
| Commentary pacing | `[Sound] commentarySilence` | Scales the announcer's pauses (section 4.1) | Added (CP3 voice commentary) |
| Centre commentary | `[Sound] centreCommentary`, "Commentary from Center" | Plays the announcer on the centre channel. **Hypothesis**: not traced | No |
| AI mode and caution | `aiMode`, `aiCornerMargin`, `aiTerrainCaution` | Computer driving style settings next to `aiSpeed`. Not traced yet | No |
| Computer horn and yee-haw | `aiYeeHaw`, `aiHorn`, `aiSfxReduce` ("Opponents Yee-Haw", "Opponents Horn", "Reduce Yee-Haw/Horn Freq.") | Switches for the computer trucks' horn and yee-haw sounds, and a lower rate | No |
| Off-centre collisions | `offCentreCollision` | Not traced yet | No |
| Tournament driver form | "on form", "off day", "PERFECT", "DISASTER", "confident", "error prone"... | In tournaments, each computer driver gets a form factor that multiplies its target speed on top of AI Speed (section 5) | No |
| Tournament fields | `FORMAT=`, `SCORING=`, `SONIC=`, `AISPEED=`, `FIELD=`, `ROUNDS=` | Tournament saves carry their own format, scoring table, sonic trucks and AI Speed | AI Speed only |
| Mirrors | `cockpitMirror*`, `chaseMirror*`, `mirrorShrink`, `keyMirror` | A rear-view mirror in the cockpit, placed and sized by the INI, and one in the chase views | Cockpit: the game's own; chase: no |
| Racing line | `raceLine`, `keyRaceLine` | Draws the course line | No |
| Look camera and sticky views | `keyLookCamera`, `stickyView`, `stickyViewP`, `stickyViewH` | A free-look key and a view that keeps its pitch and heading | No |
| Info overlay | `showInfoOverlay` | An on-screen information panel. Not traced | No |
| Drag split screen | `dragSplitScreen`, `keySplitScreen` | Shows both drag lanes at once | No |
| Demo mode | "Demo Mode (60sec idle)" | Starts the demo after 60 s idle on the menus | No |
| Track flyby menu | `menuFlyby`, "Track Flyby Menu" | A flyby behind the menus | No |
| Replay browser | "Saved Replays", `.rpl` | Lists and plays saved replays | Yes |
| Live menu layout | `menu_layout.txt`, keys F4, F5, F6, F8 | F4 windowed or borderless, F5 reloads the layout file, F6 writes every key used, F8 audits | Not applicable |
| Network diagnostics | `.\system\netdiag.on` | Writes `netdiag.txt` | Not applicable |

There are no cheat codes, console or god-mode strings, and no command-line switches.

## 4. Commentary

CP3 keeps the retail announcer (the queue, the shuffle bags, the camera-only rule and the
"who is talked about" weight, `MONSTER_EXE_ANALYSIS.md` 12) and changes it in four ways.

### 4.1 Shorter pauses

`[Sound] commentarySilence` is read as a whole percent, clamped to 0 to 200, **default 60**. When a
phrase is queued (`FUN_140207d00`), its silence figure is multiplied by `commentarySilence / 100`.
With the default, the announcer only needs 60% of the retail quiet time before the next line.
This is the main reason CP3 talks more.

### 4.2 Larger shuffle bags

Each phrase entry has a script, a line and a flag. The flag is the number of driver names in the
line, plus 256 when the line may only be said while the truck the camera follows is in the event
(the retail camera-only rule).

| Group | Retail lines | CP3 lines | Lines CP3 adds |
|---|---|---|---|
| Race intro | 4 | 17 | `start_01`, `start_02`, `start_07`, `start_11`, `start_12`, `start_18`, `stump_01`, `rock_04`, `whobe2`, `coltry`, `tearstan`, `prove`, `tuffrace` |
| Summit Rumble intro | 6 | 13 | `king_01`, `load_07`, `sum_12`, `sum_13`, `add_12`, `whobe2`, `coltry` |
| Move | 4 | 8 | camera only: `pass_10 )<<1>>`, `pass_12a *<<1>> pass_12b`, `pass_08`, `(<<1>> start_08` |
| Pass | 6 | 10 | `(<<1>> pass_09` (camera), `pass_14` (camera), `track_4a *<<1>> track_4b` (camera), `pass_11` (camera) |
| Clash | 13 | 28 | camera only: `crash_09`, `crash_12` to `crash_16`, `add_24`, `gen_07`, `(<<1>> game_01`, `(<<1>> sum_18`, `add_31`, `gen_29`, `sum_19`, `mkeblood`; and `(<<2>> gen_23` |
| Flipped (helicopter) | 6 | 18 | camera only: `gen_09`, `gen_15`, `gen_30`, `gen_32`, `gen_40`, `smelrose`, `thunkit`, `gen_04`, `unbeliev`, `keepontr`; and `gen_16a *<<1>> gen_16b`, `(<<1>> overcent` |
| Missed checkpoint | 2 | 3 | `gen_03` ("Don't forget to hit your checkpoints.") |
| Winner | 7 | 11 | `(<<1>> haswon`, `(<<1>> stage12`, `(<<1>> hasone`, `win_01` |
| Spin (frozen water) | 2 | 3 | `rink_01` |
| Blimp | 2 | 3 | `blimp_03` |

The English lines are in the executable next to each script and go in the port's phrase table.
`stage12`, `hasone` and the drag clips (section 4.4) are not in the stock `SOUND.POD`; every other
clip is. Retail ships those clips but never says them.

### 4.3 New race calls

| Call | Trigger | Priority / silence / life (s) | Lines |
|---|---|---|---|
| Weather intro | Instead of the race intro: in Foggy, Dense Fog, Snow, Night or Pitch Black (2, 3, 5, 7, 8), half the time. In Night or Pitch Black, half of those use the night bag. In Snow, half use the snow bag. Otherwise the fog bag is used | said at once | night: `night_01`, `night_02`; snow: `snow_01`, `snow_02`; fog: `fog_01` to `fog_05`, `wea_02` |
| Track intro | Instead of the race intro on `snake.sit`, half the time (checked before the weather intro) | said at once | `snake_01`, `snake_02` |
| Final lap | The player's truck starts its last lap, in a race of more than one lap | 3 / 0.5 / 8 | `add_35` "One more lap to go." |
| Road sign | The player's or watched truck hits a type 1 box (a post: road signs), at most once every 40 s | 10 / 8 / 3 | `(<<1>> signcake`, `truktime`, `alivkill` |
| Detour | It hits a type 2 box (a barricade), at most once every 60 s | 10 / 8 / 3 | `(<<1>> detour` |
| Train | It hits a type 10 box (a train) | 10 / 8 / 3 | `train_01`, `train_02`, `train_03` |
| Gone long | Next to "going your way", when a truck field (`+0x8f8`) moves the other way. **Hypothesis**: not a place, since the line is "<<1>> is gone 'cuz it took too long." Not ported | 18 / 12 / 3 | `(<<1>> gonelong` (CP3 `Sound.POD` only) |

Road signs, trains and the cow are never said in a drag race. Retail says road signs and trains at
once. CP3 queues them.

### 4.4 Summit Rumble calls

None of these are in retail. They follow the Summit Rumble points.

| Call | Trigger | Priority / silence / life (s) | Lines |
|---|---|---|---|
| Holding the top | Every 10th point a truck scores while on top | 16 / 14 / 3 | `(<<1>> sum_05`, `(<<1>> sum_07`, `(<<1>> sum_08`, `add_33`, `add_34 )<<1>>`, `game_02` |
| Knocked off | A truck on top is pushed off and loses points | 6 / 4 / 1.5 | `(<<1>> add_02`, `(<<1>> add_05`, `(<<1>> add_06`, `sum_17`, `terr_12` |
| Steps out | A truck leaves the top by itself | 12 / 8 / 1.5 | `(<<1>> add_10` |
| New points leader | The truck with the most points changes | 8 / 5 / 2 | `(<<1>> add_03`, `add_04a *<<1>> add_04b`, `(<<1>> add_11`, `(<<1>> game_06`, `(<<1>> gen_28`, `(<<1>> gen_37`, `gen_41`, `game_07`, `add_21` |

Move and pass are not said in a Summit Rumble. Clash needs 8 s of silence there, as in retail.

### 4.5 Drag race calls

Retail says nothing in a drag race. CP3 talks through the staging, the start and the finish. The
drag status values are those of `MONSTER_EXE_ANALYSIS.md` 6.4.

| Call | Trigger | Priority / silence / life (s) | Line |
|---|---|---|---|
| Time to prestage | Up to twice while a truck has not prestaged | said at once | `(<<1>> STAGE5, n, SECONDS, STAGE6` "<<1>> has <<2>> seconds to prestage." |
| Time to stage | Up to twice while a truck has not staged | said at once | `(<<1>> STAGE5, n, SECONDS, STAGE7` "<<1>> has <<2>> seconds to stage." |
| Prestaged | A truck prestages | said at once | `(<<1>> STAGE1` "<<1>> is prestaged." |
| Staged | A truck stages | said at once | `(<<1>> STAGE2` "<<1>> is staged." |
| Red light | A truck leaves before the green | 1 / 0 / 8 | `(<<1>> STAGE3` "<<1>> has red lighted." |
| Jump | After the start, the truck ahead off the line | 6 / 0 / 3 | `(<<1>> stage4 )<<2>>` "<<1>> has the jump on <<2>>." |
| Disqualified | Crossing the centre line, crossing the outside edge, reversing on the track, or the time limit | 1 / 0 / 8 | `STAGE8`, `STAGE13`, `STAGE14`, `STAGE9` "<<1>> has been disqualified for ..." |
| Heat winner | The winner of a drag pass | 0 / 0 / 8 | `(<<1>> STAGE11` "<<1>> has won the heat." in a weekend, else the winner bag |

The countdowns are said 10 s and 20 s into the prestage and stage phases (each 30 s long), for each
truck that has not prestaged or staged yet, so `n` is 20, then 10. `n` is said with the number clips:
`ZERO.WAV` to `TWENTY.WAV`, `THIRTY.WAV`, `FORTY.WAV` and `FIFTY.WAV` (`SEVENTEE.WAV` for 17). These
clips are only in CP3's `Sound.POD`. Drag calls are made for both lanes, not only the player's
and the watched truck.

### 4.6 Unchanged

Move, pass, lead, edge, going your way, clash, cow, water, spin, ice, air, roll, wheelie, flipped,
missed checkpoint, has finished, stealth and blimp keep their retail figures and triggers. The
winner's life rises from 1 s to 8 s.

## 5. AI Speed

- **Setting.** `[Game] aiSpeed` is a whole percent, **default 100**. It is clamped to **70 to 130**
  when read and on its slider. The slider is labelled "AI Speed".
- **Overrides.** A tournament stores its own value (`AISPEED=` in the tournament save), and a
  network session can too. While one of these is set it is used instead, and the slider shows
  "N% (locked)".
- **Target speed.** When `aiSpeed` is not 100, each computer truck's autopilot target speed is
  multiplied by `aiSpeed / 100`. This happens last: after the 17 ft/s floor (not in drag races)
  and after the segment's speed limit (`MTM2_PHYSICS.md` 12). The player's truck is never scaled.
  In a tournament the target is also multiplied by the driver's form factor.
- **Second AI routine.** CP3 has another computer-driving routine (`FUN_1401a5510`), chosen per
  frame by `FUN_1401a54d0` when an extra mode is on (**hypothesis**: the `aiMode` key). It scales
  its own target the same way but keeps it at or above 17 ft/s. OpenMTM2 ports only the classic
  routine.
- **Torque.** When `aiSpeed` is not 100, the engine torque of each computer truck this machine
  drives is multiplied by `aiSpeed / 100`, next to the Professional sonic-truck torque bonus
  (x1.1) for computer trucks. Trucks driven by another machine are not scaled.
