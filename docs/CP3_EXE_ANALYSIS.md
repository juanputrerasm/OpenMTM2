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
| Steering model | `[Control] steerCurveMode`, `steerRange`, `steerExpo`, `steerSpeedSens`, `steeringResponse`, `nullZone` ("Steering Model", "Steering Sensitivity", "Steering Expo", "Steering Range") | A choice of stick curves, "Original (1998)" or Expo, with its own figures (section 11) | Yes (Options, Keys, Gamepad) |
| AI Speed | `[Game] aiSpeed` | Scales computer trucks' speed and torque (section 5) | Added with this doc |
| Commentary pacing | `[Sound] commentarySilence` | Scales the announcer's pauses (section 4.1) | Added (CP3 voice commentary) |
| Centre commentary | `[Sound] centreCommentary`, "Commentary from Center" | Plays the announcer on the centre channel, **default on**; `lfeLevel` (0 to 200) beside it. How the DLL routes it is not traced | Yes (section 7) |
| AI mode and caution | `[Control] aiMode`, `aiCornerMargin`, `aiTerrainCaution` | A second computer-driving routine (section 8), default off; margin 50 to 120 and caution 25 to 200 percent, both default 100 | No |
| Computer horn and yee-haw | `aiYeeHaw`, `aiHorn`, `aiSfxReduce` ("Opponents Yee-Haw", "Opponents Horn", "Reduce Yee-Haw/Horn Freq.") | Switches for the computer trucks' horn and yee-haw high in the air, and a lower rate (section 7) | Yes |
| Off-centre collisions | `offCentreCollision` | Not traced yet | No |
| Tournament driver form | "on form", "off day", "PERFECT", "DISASTER", "confident", "error prone"... | In tournaments each computer driver has a personality and a form for the race that multiplies its target speed on top of AI Speed (sections 5, 9) | No |
| Tournament fields | `FORMAT=`, `SCORING=`, `SONIC=`, `AISPEED=`, `FIELD=`, `ROUNDS=` | Tournament saves carry their own format, scoring table, sonic trucks and AI Speed | AI Speed only |
| Mirrors | `cockpitMirror*`, `chaseMirror*`, `mirrorShrink`, `keyMirror` | A rear-view mirror in the cockpit, placed and sized by the INI, and one in the chase views (section 7) | Cockpit: the game's own; chase: yes, off by default |
| Racing line | `raceLine`, `keyRaceLine` | Draws the course line, default off (section 7) | Yes, off by default |
| Look camera and sticky views | `keyLookCamera`, `stickyView`, `stickyViewP`, `stickyViewH` | A free-look key and a view that keeps its pitch and heading | No |
| Info overlay | `showInfoOverlay` | An on-screen information panel. Not traced | No |
| Drag split screen | `dragSplitScreen`, `keySplitScreen` | Shows both drag lanes at once, default off (section 7) | Yes, off by default |
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

## 6. Shiny faces, the shine mask and glass

CP3 draws models through a separate renderer DLL (`trid3d9.dll`, `trid3d11.dll`, `trivk.dll`), whose shader source is
in the DLL as text. What it says about faces, read from `trid3d11.dll` (31 August build) and `trid3d9.dll`:

- **Shiny faces are the Gouraud ones.** A face is "shiny" (the shaders' `specEnable`, "isGouraud/shiny") when it is a
  Gouraud facet: face type **0x29** (MRGL_ZGFACETTMAP). The exe's batcher (`FUN_140162490`) keys each batch by texture
  and by three flags: cut out (0x11), lit by the face type (0x18, 0x22, 0x29), and 0x29 in a model that has an ILIST.
  Flat textured faces (0x18 ZFACETTMAP and the others) are never shiny: no highlight and no reflection, "so a flat
  face does not flicker as one mirror".
- **A shiny face's light:** plain Lambert with the ambient floor, no 1.5x gain (the flat faces get one, which pins a
  45 degree face to full light), plus a highlight `s^32`, `s` the cosine between the view and the sun's mirror
  direction, times `ks`. `ks` is `[Graphics] sunSpecular` as a percent, **default 60**; `normalSpecular` (default 10)
  and `normalSpecPower` (default 8) are the normal map's own highlight. No highlight in Pitch Black.
- **Truck Reflections** (the probe cube) are drawn on shiny faces only.
- **The shine mask:** with a normal map (`<stem>_N`), its **alpha channel masks the shine** of a shiny face: alpha 1
  takes the highlight away and leaves no reflection (flat), alpha 0 keeps both (shiny). So a texture can carry chrome
  and flat paint side by side ("clear is shiny, opaque is flat"). A face that is not shiny is never made shiny by it.
- **Glass (MRGL_MATERIAL with BLEND):** the material blends at its `baseAlpha`, opened toward opaque at a glancing
  angle by its Fresnel term, `fres = (fresnelBias + (1 - fresnelBias) (1 - n.v)^5) x fresnelStrength`; the
  reflection is weighted by the same `fres`. A material that also has ALPHATEST first drops the transparent texels at
  its alpha reference, then blends the rest: the two flags are not exclusive (the port once let the cutout win, which
  drew such glass opaque). `specPower` replaces the 32 of the highlight; TINT multiplies the texture before lighting.

## 7. Smaller options (`FUN_14018bbb0` reads them)

| Option | Default | What the code does |
|---|---|---|
| `[Sound] centreCommentary` | 1 | The announcer on the centre channel of a surround output. OpenMTM2: a 5.1 or wider output gets the voice folded to mono and sent to the centre speaker; stereo is unchanged (the voice was never panned). |
| `[Game] aiHorn`, `aiYeeHaw`, `aiSfxReduce` | 1, 1, 0 | `FUN_140214740`, per truck per frame, the retail rule (`0x41e030`) with switches: all four wheels off the ground and the truck not being reset, `h = 0.25 x` (the four wheels' heights over the ground) less the truck's `+0x1cc`; over 10 ft, a computer truck (not one a player or the network drives) sounds off when `rand() % N < 1.5 h`, `N` 5000, or with Reduce `((slot x 7 + 3) % 5) x 5000 + 30000`. Both on: horn or yee-haw at random; one off: always the other; both off: nothing. |
| `[Game] chaseMirror`, `chaseMirrorPct`, `chaseMirrorAspect`, `chaseMirrorDragPct`, `mirrorShrink` | 1, 25 (5 to 60), 30 (0 to 100), 16 (0 to 60), 0 | `FUN_140107820`: in an external view, with the mirror on (`mirrorOn`, which `keyMirror` flips), a window `pct` of the screen's width (`dragPct` in a drag race with one player, when above 0), `aspect` of that high (below 1: a quarter of the width, or the mirror art's own shape), centred, its top a 32nd of the screen down. OpenMTM2: Options, Cameras, "Chase mirror", off by default; the look back from the cab with the cockpit mirror's lens. |
| `[Game] raceLine` | 0 | `FUN_1401463b0`: in a Circuit or a Rally, the course's straights (every other course entry, those of type 1), each cut into `1 + length / 24` pieces (at most 64), drawn as lines 0.35 ft over the ground, for straights whose start, middle or end is within 900 ft (on the larger of x and z) of the player's truck. The colour is not traced. |
| `[Game] dragSplitScreen` | 0 | `FUN_14013d880`: on, in a drag race with more than one truck and both lanes filled. The frame (`FUN_14015b3c0` twice) draws the first lane's truck in the left half and the second's in the right, the second camera taking the first's mode, pitch and heading; `keySplitScreen` flips the option. |

## 8. AI mode (not ported)

`FUN_1401a54d0` chooses CP3's second driving routine (`FUN_1401a5510`) for a computer truck when `aiMode` is not 0,
the truck is on its autopilot (`+0x894`), the race is not a drag race and two more flags (network and replay,
**hypothesis**) are clear. Its target speed comes from a look-ahead (`FUN_1401a4d80`): seven ground samples along the
course at fixed distances ahead (`FUN_1401a5260`), from which the routine takes the largest second difference (the
sharpest crest or dip) and the climbs and drops between samples. `aiTerrainCaution` (percent) scales the speed this
allows, `aiCornerMargin` (percent) the room it leaves in a corner. `aiMode` above 1 has a further branch. The constants
and the use of each sum are still to be read; the port's own fixes for computer trucks on rough ground
(`MTM2_PHYSICS.md` 14.22 and the changelog's "smarter computer trucks") were made without this routine and are to be
compared with it once it is.

## 9. Tournaments (not ported)

A tournament save carries `NAME=`, `DESCR=`, `FORMAT=`, `SCORING=`, `SONIC=`, `AISPEED=`, `FIELD=` and `ROUNDS=`
(`FUN_1401425a0`). Each computer driver has a personality (`FUN_140141070`: 0 normal, 1 confident, 2 overconfident,
3 calm, 4 reserved, 5 hesitant, 6 error prone, 7 choker) and, each race, a form from -2 to 2 (`FUN_14013ffa0`:
DISASTER, off day, normal, on form, PERFECT); a tournament setting `FUN_14013ee00` scales how strong the form is
(normal, strong, exaggerated, disastrous). Rounds are named "Final", "Semi-final", "Quarter-final" and "Round of N"
(`FUN_14013d930`). The form's multipliers, how a personality moves the form, and the formats and scoring tables are
still to be read.

## 10. Track pictures

The Races screen's picture of a track, and the info photo beside it. Both are BMP only in this build.

**The picture.** The classic menu (`FUN_140079d10`) and the new menus (`FUN_1401109d0`) look it up the same way. They
take the name the SIT gives after "Track Logo .BMP file" (kept at offset 0x3a0d0 of the track's 400-byte record),
exactly as written: no extension is changed or added. The opener (`FUN_1400259f0`, mode `"rb"`) tries the mounted
PODs and then loose files, first under that name and then under `UI\<name>`. When neither opens, it shows
`NoTrkPct.bmp`. The new menus' reader (`FUN_14010d5b0`) needs the `BM` signature and an 8, 24 or 32-bit image up
to 8192 px a side; anything else fails, and the menu draws "(no track picture)". A PNG named in the SIT is opened
and then rejected.

**The info photo.** `FUN_1401399b0` takes the picture's name, drops its extension, and needs its last letter to be
S or T (either case). It drops that letter and `FUN_140139450` adds `M.bmp`: `VALPO4S.BMP` gives `VALPO4M.bmp`. The
photo is read the same way (`FUN_140110810`, then `FUN_14010d5b0`), so it is BMP only too. It is drawn in the
`trkinfo.*` box with the track's text (`FUN_140139a80`: the description `.TXT` the SIT names, or `<track>.TXT`, in
`WORLD\` or the root). OpenMTM2 has no info photo yet.

**HD pictures.** Traxx packs a PNG or TGA with the same stem beside each BMP (`UI\VALPO4S.PNG`, `UI\VALPO4M.PNG`).
Its notes say a later CP3 engine takes those first and falls back to the BMP (Traxx `TrackPOD.h`, "HD TRACK ART",
2026-09-28, citing cursh2 `MenuDraw.cpp` `hdSiblingName`). This build has no such step. OpenMTM2 follows the later
rule for the picture as an addition: the PNG, then the TGA, then the BMP (`worker/track-picture.js`).

## 11. Steering model

The analog stick routine (`FUN_140186d30`, which writes the front steer at `+0x298` once a
sub-step) keeps the retail joystick routine (`MONSTER_EXE_ANALYSIS.md` 7) and adds a second curve.
With `x` the stick's position with the dead zone taken out (the retail formula, the dead zone
`nullZone / 65536`), times 0.75 on Rookie outside a drag race:

    m  = min(1, |x| * k)          k = 100 / steerRange for steerRange 5 to 100, else 1.11
    Original (1998), steerCurveMode 0:
       s = m ^ e,  e = (1 + 2 r) * clamp(|bvel.z| * 0.025, 1.0, 1.1)   (the retail curve)
    Expo, steerCurveMode 1:
       s = (1 - min(1, |bvel.z| / 88) * min(1, steerSpeedSens / 100) * 0.6)
           * (m^3 * expo + (1 - expo) * m),   expo = clamp(steerExpo / 100, 0, 1)
    front steer = sign(x) * 0.45 * s

| Figure | Range | Default | Notes |
|---|---|---|---|
| `steerCurveMode` | 0 or 1 | 1 (Expo) | 0 is "Original (1998)" |
| `steerRange` | 5 to 100 | 90 | so the retail 1.11 gain is the default either way |
| `steerExpo` | 0 to 100 | 100 for a gamepad, 0 for any other device | the default is picked by the device's type when the INI has none |
| `steerSpeedSens` | 0 to 100 | 35 | "How much steering eases off as you gain speed. 0% = full lock at any speed" |
| `steeringResponse` | INI value / 10 gives `r` | `r` = 1 | the options screen's "Steering Sensitivity" slider runs 0 to 20 and sets `r = (20 - v) / 10`, so `r` reaches 2 (exponent 5 at low speed) and a higher sensitivity is a lower `r` |
| dead zone | 0 to 100 % | | the slider's percentage times 16384 / 100 raw units, so up to a quarter of the throw |

The keyboard routine uses the same `r` (`e = 1 + r / 4`), so it too goes to 1.5.

OpenMTM2: Options, Keys, Gamepad. "Steering model" (Original (1998), the default, or Expo),
"Steering response" 0 to 20 (`r` a tenth of it; higher is softer near the centre, the opposite way
round from CP3's Sensitivity slider), "Steering range", "Steering expo", "Steering speed ease-off"
and "Gamepad dead zone" (0 to 25 %, the port's 12 % by default). "Gamepad steering: Digital (1998
gamepad)" is the retail game's gamepad mode (`MONSTER_EXE_ANALYSIS.md` 7, `0x585da0`), where the
stick presses the keys and the keyboard ramps steer.
