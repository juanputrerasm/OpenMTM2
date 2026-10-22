# MTM2 asset dependencies for a standalone OpenMTM2

This document inventories original Monster Truck Madness 2 assets that OpenMTM2 reads or recognizes.
Its purpose is to define what must be replaced, removed, or supplied under a distributable license
before OpenMTM2 can run as a complete standalone game without a user's MTM2 installation.

The inventory was made from the OpenMTM2 source and checked against a retail MTM2 installation with
OpenPhotex. It does not grant permission to redistribute any original asset.

## Scope

There are three kinds of dependency:

1. **Fixed dependencies** have names written directly in OpenMTM2. These are the primary replacement
   checklist in this document.
2. **Identity-sensitive dependencies** are names that enable special behavior, such as Hockey on
   `ROCKQRY.SIT` or red and green start-light textures.
3. **Manifest-driven dependencies** are named by a selected track, truck, model, tournament, ambient
   sound table, or replay. Their exact files depend on the original content a standalone release
   chooses to replace.

An asset being optional at runtime does not make it safe to distribute. If an original optional asset
is included in a standalone package, it still needs a replacement or suitable license.

## Standalone replacement summary

| Area | Current source | Standalone action |
|---|---|---|
| Installation bootstrap | `POD.INI`, six required POD names, optional `MONSTER.EXE` version | Replace the install gate with an app-owned content manifest or built-in mount |
| Shared MTM2 palette | A verbatim copy of `METALCR2.ACT` is embedded in vendored OpenPhotex | Replace or remove the embedded palette and author replacement indexed art against a new palette |
| Classic menus | Fixed `UI/*.BMP` files and track-specific preview BMPs | Replace the fixed screens and every preview shipped with standalone tracks, or retire the classic skin |
| Race HUD | Three original bitmap font sheets and `NEEDLE.BIN` | Replace with original artwork or refactor the HUD to project-owned fonts and vector needles |
| Loading screens | `DATA` and `KOTH` indexed screen art | Replace each supported screen size or use a new scalable loading screen |
| Cockpit | `POWERBIG` layouts, panels, wheel, shifter, mirror, finder and shift-light art | Replace the 480-line cockpit set and dashboard metadata, or provide a new cockpit renderer and layout |
| Shared vehicles | Garage, winner podium, blimp, helicopter and pterodactyl models plus textures | Replace each enabled shared model and its full texture graph |
| Effects | Original rain, snow, dust, water, splash and tread sheets | Replace each enabled sheet or make the project-generated fallbacks the only path |
| Sky and light | Original fallback skies, environment map, sun layout, flare textures and moon | Replace them; the repository already has community weather-sky alternatives for four sky names |
| Audio | Fixed UI, engine, skid, impact, weather, vehicle and event samples | Replace every enabled fixed sample and define new loop metadata |
| Tracks and trucks | Discovered from `.SIT`/`.SI2` and `.TRK`, then followed transitively | Ship wholly original track and truck content graphs |
| Tournaments and wording | `.TRN`, description text and optional `.LOC` tables | Create original tournaments, descriptions and localization data |

## The trial

OpenMTM2 ships one original game package: Microsoft's free Monster Truck Madness 2 trial, unmodified, in
`assets/trial/`. Setup installs it with one click (`src/install/trial.js`, `src/ui/screens/install.js`).

**License.** The trial's own EULA (`assets/trial/EULA.txt`, the `eula.txt` inside the installer) grants, in section 1:

> Reproduction and Distribution. You may reproduce and distribute copies of the SOFTWARE PRODUCT; provided that a)
> each copy shall be a true and complete copy, including all copyright and trademark notices; b) each copy shall be
> accompanied by a copy of this EULA; and c) such distribution shall not be for commercial purposes.

So the app carries the zip exactly as published, with the EULA beside it, and is not distributed commercially.
Setup shows the EULA and installs only after the player accepts it. Files taken out of the trial are never committed
or served separately: that would not be a true and complete copy.

**The package.**
- **Source:** the Internet Archive item `MonsterTruckMadness2_1020`.
- **The zip:** `MtM2trial.zip`, 18,433,184 bytes, SHA-1 `d12c783aab1f9b88834c43879560c5d08eee8966`.
- **The installer:** the zip holds one file, `MtM2trial.EXE` (18,491,952 bytes), a Windows program carrying one
  cabinet at offset 68,352. The cabinet has one folder in MSZIP, 1,281 blocks and 41,967,338 bytes unpacked. The stub
  also contains a stray `MSCF` at 0x2024 that is not a cabinet header.
- **Files:** the cabinet's 25 files are:
  - the archives `Startup.pod`, `Musicx.pod`, `Soundx.pod`, `Cockpit.pod`, `Truck2x.pod`, `Uix.pod` and `Tpark.pod`;
  - `Monsterx.exe` (version 2.00.41, a retail build) and `Monsterx.ini`;
  - the renderer DLLs;
  - the help files, `readme.txt`, `faq.txt` and `eula.txt`;
  - Microsoft's setup and DirectX setup files, and a font.
- **No POD.INI:** the trial's setup writes it, so OpenMTM2 writes one from the archives it finds, in the full game's
  mount order (`src/install/inspect-source.js` `listedArchives`).
- **Archive names:** `MUSICX`, `SOUNDX`, `TRUCK2X` and `UIX` stand for MUSIC, SOUND, TRUCK2 and UI in the
  required-archive check (`src/install/required-pods.js` `TRIAL_POD_NAMES`).
- **Content:** Farm Road 29 (`WORLD/TPARK.SIT`) and four trucks (`EXECUTE`, `FIRESTN`, `SNAKEBIT`, `STINGER`).
- **Fixed files:** every fixed file this document lists for the menus, HUD, cockpit, effects, sky and shared models
  is present.

**Download.** Setup fetches the app's own copy first. If that fails, it fetches the Internet Archive's copy through
`https://cors.archive.org/cors/MonsterTruckMadness2_1020/MtM2trial.zip`. The Archive's plain download address sends
no CORS header, so another site cannot read it; the CORS address is the one the Archive's own in-browser players use.
A download that is not exactly the published zip (size and SHA-1) is refused. Measured on 2026-10-21, the Archive
gave between 25 KB/s and 1.5 MB/s, so the app's own copy is the one to rely on.

## Bootstrap dependencies

The current installer requires `POD.INI` and refuses an install that does not contain all six of
these archive names:

- `STARTUP.POD`
- `MUSIC.POD`
- `SOUND.POD`
- `COCKPIT.POD`
- `TRUCK2.POD`
- `UI.POD`

`MONSTER.EXE` is optional and is read only for its version string. OpenMTM2 does not execute it.

A standalone build should not create replacement archives merely to satisfy these names. The better
boundary is an app-owned content manifest or a built-in VFS mount, followed by removal of the current
required-POD check. POD can remain a supported add-on format without being the bootstrap format.

Source: `src/install/required-pods.js`, `src/install/inspect-source.js`, `src/worker/install-store.js`.

## Embedded original data

`src/vendor/openphotex/texture/bundled-palettes.js` contains `metalcr2Mtm1`, documented there as a
verbatim base64-encoded copy of MTM1's `ART/METALCR2.ACT`, which MTM2 also uses. OpenMTM2 can use this
embedded data whenever a model texture has no reachable palette.

This dependency is easy to overlook because it is source code rather than a file copied from the
user's installation. A standalone release needs to replace or remove it in upstream OpenPhotex and
refresh the vendored copy. The replacement textures should be authored against the replacement
palette so that automatic palette resolution remains deterministic.

The other bundled OpenPhotex palettes belong to CPR, Terminal Velocity/Fury3 and Hellbender. They are
not MTM2 assets, but they also need review if a standalone distribution includes those compatibility
paths.

Source: `src/worker/palette-resolver.js`, vendored OpenPhotex `texture/bundled-palettes.js`.

## Fixed visual assets

### Classic menu BMPs

OpenMTM2 loads these names from `UI.POD` when the classic skin is active:

- Screen backgrounds: `UI/START.BMP`, `UI/DRIVER.BMP`, `UI/RACES.BMP`, `UI/GARAGE.BMP`,
  `UI/RESULTS.BMP`, `UI/HALLFAME.BMP`, `UI/BLANK.BMP`
- Winner overlays: `UI/RESWIN1.BMP`, `UI/RESWIN2.BMP`
- Finishing-place icons: `UI/RESULT1.BMP` through `UI/RESULT8.BMP`

Each standalone track may add two manifest-driven menu images from its SIT header:

- `UI/<track-logo>.BMP`
- `UI/<track-map>.BMP`

The modern menu skin does not use these files, so retiring the classic skin would eliminate the fixed
BMP dependency. A complete classic replacement needs new artwork that preserves the hotspot and panel
regions declared in `src/ui/frame.js` and the screen modules.

Source: `src/ui/frame.js`, `src/ui/screens/start.js`, `drivers.js`, `race-select.js`, `garage.js`,
`results.js`, `hall.js`, `options.js`.

### Race bitmap fonts and gauge needle

The in-race HUD, replay, fly-by captions, watermark and VR boards read these original font masks:

- `ART/FNT1_480.RAW`
- `ART/FNT2_480.RAW`
- `ART/FNTO_480.RAW`

The code treats each sheet as a mask and does not read its `.ACT` file. Replacements must keep the
expected sheet dimensions and marker-row encoding unless `src/worker/bitmap-font.js` is changed.

The speedometer and tachometer also read `MODELS/NEEDLE.BIN`. The model is converted into flat shapes;
it has no texture dependency.

Retail source: the font sheets are in `STARTUP.POD`; the needle is in `UI.POD`.

Source: `src/worker/bitmap-font.js`, `src/worker/asset-worker.js`, `src/render/bitmap-text.js`,
`src/render/race-gauges.js`.

### Loading screens

Circuit, Rally and Drag races use `DATA`; Summit Rumble uses `KOTH`. OpenMTM2 first requests the
480-line pair and falls back to 400 and 200:

- `ART/DATA480.RAW` and `ART/DATA480.ACT`
- `ART/DATA400.RAW` and `ART/DATA400.ACT`
- `ART/DATA200.RAW` and `ART/DATA200.ACT`
- `ART/KOTH480.RAW` and `ART/KOTH480.ACT`
- `ART/KOTH400.RAW` and `ART/KOTH400.ACT`
- `ART/KOTH200.RAW` and `ART/KOTH200.ACT`

All are in retail `STARTUP.POD`. A standalone UI can replace only the 480-line pair for each type if
the fallback resolutions are deliberately removed.

Source: `src/worker/screen-art.js`.

### Cockpit and finder

The current flat-screen cockpit requires `DATA/POWERBIG.480`, which names the panel art and supplies
the gauge, wheel, shifter and mirror layout. The exact 480-line set read by OpenMTM2 is:

- Layout: `DATA/POWERBIG.480`
- Panels: `ART/PBIG480`, `PBIGL480`, `PBIGR480`, `PBIGB480`, each as `.RAW` and `.ACT`
- Wheel: `ART/PW480C00` and `ART/PW480L05` through `L35` and `PW480R05` through `R35`, in five-degree
  steps, each as `.RAW` and `.ACT`
- Shifter: `ART/PS480P.RAW`, `PS480R.RAW`, `PS480N.RAW`, `PS4801.RAW`, `PS4802.RAW`, `PS4803.RAW`
- Shift light: `ART/PL480.RAW` and `ART/PL480.ACT`
- Mirror frame: `ART/FORDM480.RAW`
- Finder: `ART/FI480`, `FI480GA`, `FI480RA`, `FI480GD`, `FI480RD`, each as `.RAW` and `.ACT`
- Shared palette fallback for the shifter and mirror: `ART/METALCR2.ACT`

The headset dashboard panel also probes `DATA/POWERBIG.400` and `DATA/POWERBIG.200`, with the front
panel each layout names, if the 480-line layout or panel is unavailable. These are fallback paths,
not additional requirements when a complete 480-line replacement exists.

All cockpit files are in retail `COCKPIT.POD`, except `METALCR2.ACT` in `STARTUP.POD` and
`NEEDLE.BIN` in `UI.POD`.

Source: `src/worker/cockpit-art.js`, `src/render/cockpit.js`, `src/render/xr/vr-cab.js`.

### Weather, water and tire-effect sheets

Every stem below is read as both `ART/<stem>.RAW` and `ART/<stem>.ACT` from retail `STARTUP.POD`:

- Snowflakes: `SNOFLAKS`
- Raindrops: `NDROP1`, `NDROP2`, `NDROP3`
- Snow and classic ice: `SNOW0`, `SNOW1`, `SNOW2`, `SNOW3`
- Wheel spray and water impacts: `WAKEBLOB`, `SPLATRIP`, `SPLAT1`, `SPLAT2`
- Dust animation: `PUFF2_01` through `PUFF2_12`, `PUFF3_01` through `PUFF3_12`
- Tire tread: `TREAD`
- Classic water animation: `RIPPL100`, `RIPPL200`, `RIPPL300`, `RIPPL400`, `RIPPL500`,
  `RIPPL600`, `RIPPL700`, `RIPPL800`

Several enhanced effects already have procedural fallbacks, but the code still loads these original
sheets and uses them when available. A standalone release should either replace the sheets or remove
the original-art branches so the procedural path is unambiguous.

Source: `src/worker/effects-art.js`, `src/render/weather-scene.js`, `water-effects.js`,
`water-surface.js`, `tire-effects.js`, `tire-tracks.js`.

### Sky, reflection, sun and moon

Fixed sky-related reads are:

- Weather and old-level skies: `ART/CCLOUDS`, `CLOUDY2`, `DUSKSKY`, `NITESKY`, each as `.RAW` and
  `.ACT` when the HD replacement path is unavailable or disabled
- Truck reflection map: `ART/CLOUDENV.RAW` and `ART/CLOUDENV.ACT`
- Lens-flare definition: `DATA/SUN.TXT`
- Always-added flare discs: `ART/SUN02.{RAW,ACT}` and `ART/MOON.{RAW,ACT}`
- Textures named by retail `SUN.TXT`: `SUN06`, `SUN07`, `SUN09`, `SUNCRAM`, `SUN11`, `SUN12`,
  `SUN13`, each as `.RAW` and `.ACT`

The repository already contains project/community PNG alternatives for `CCLOUDS`, `CLOUDY2`,
`DUSKSKY` and `NITESKY` under `assets/weatherArt/`. Their provenance is documented in that folder.
They do not replace `CLOUDENV`, the sun layout, flare textures, or moon.

Track-specific clear skies remain manifest-driven through each LVL file.

Source: `src/game/weather.js`, `src/worker/weather-art.js`, `track-build.js`, `env-map.js`,
`asset-worker.js`, `src/render/sun-flare.js`.

## Fixed models and their textures

OpenMTM2 loads these models independently of a chosen track or truck. Textures were verified by
reading the retail BIN files with OpenPhotex.

| Use | Models | Texture dependencies |
|---|---|---|
| Driver Check-in garage | `MODELS/GARAGE.BIN` | `ART/GARAGE1` through `GARAGE4`, each `.RAW` and `.ACT` |
| Winner preview | `MODELS/WINNER.BIN` | `ART/WINNASS1` through `WINNASS5`, each `.RAW` and `.ACT` |
| Blimp | `MODELS/GOODY.BIN` | `ART/GOODY.RAW` and `ART/GOODY.ACT` |
| Recovery helicopter | `MODELS/HELI.BIN` | `ART/NEWHELO1` and `NEWHELO2`, each `.RAW` and `.ACT` |
| Recovery pterodactyl | `MODELS/TERYL.BIN`, with frames `TERYL1.BIN` through `TERYL4.BIN` | `ART/JPTER1`, `JPTER11`, `JPTER2`, `JPTER3`, `JPTER4`, `JPTER5`, `JPTER55`, `JPTER6`, `JPTER7` as `.RAW`; palette resolution falls back to the shared MTM2 palette |
| Every MTM2 truck | `MODELS/DRVSHAFT.BIN` | `ART/BARDRV.RAW` and `ART/BARDRV.ACT` |
| Gauge needle | `MODELS/NEEDLE.BIN` | None |

Retail provenance is `STARTUP.POD` for the garage, blimp, helicopter and pterodactyl;
`UI.POD` for the winner and needle; and `TRUCK2.POD` for the driveshaft.

Truck suspension art defaults to `ART/SHOCK.RAW` and `ART/AXLEBAR.RAW` when a TRK does not name
alternatives. The retail files rely on the shared MTM2 palette. Truck manifests may also name their
own shock, axle-bar, lamp-lens and lamp-cone textures.

Source: `src/worker/preview-build.js`, `vehicle-models.js`, `track-build.js`, `truck-build.js`.

## Fixed audio assets

Every sound stem is resolved as `SOUND/<stem>.WAV`. The loader also probes
`SOUND/<stem>.KLP` for optional loop points. A replacement can keep this convention or move loop
metadata into a new app-owned sound manifest.

### Menu and results

- Pointer and ordinary controls: `MOUSEON`, `CONOPTUP`
- Navigation and actions: `STARTOFF`, `GOOFF`, `TRACK`, `SLIDERUP`, `SLIDERDN`
- Menu music: `SPLASH`
- Winner's Circle crowd: `CROWD`

The first seven retail samples are in `UI.POD`; `SPLASH` is in `MUSIC.POD`; `CROWD` is in
`SOUND.POD`.

### Engines, drivetrain and contact

- Engine loops: `STARTIDL`, `M1-2-M2`, `ACCEL3B`
- Gear changes: `2NDGEAR`, `3RDGEAR`
- Hull impacts: `SUSPEN1`, `SUSPEN3`, `SUSPEN5`, `SUSPEN6`
- Water and bridges: `SPLASH1`, `WTR-ABV1`, `BRIDGE1`

### MTM2 skid and tire sounds

- Cement: `SKID-C2`
- Dirt: `SKID-D1`, `SKID-D2`
- Gravel: `SKID-G1`, `SKID-G2`, `SKID-G3`
- Snow: `SNWSKID5`, `SNWSKID6`, `SNWSKID7`
- Ice spin: `SPINICE`
- Rock spin: `SPINROC1`, `SPINROC2`, `SPINROC3`
- Rock corner probe: `CORNROC1`

`CORNROC1` is requested by the code but is absent from retail `SOUND.POD`, so the current game is
silent for that case. There is no original file to replace unless standalone content deliberately
adds one.

### Horns, recovery and moving vehicles

- Horns: `HORN1`, `HORN-A`, `HORN-F`
- Player call: `YEEHAW`
- Recovery helicopter: `HUEY`
- Pterodactyl: `TERADCY1`, `TERADCY2`
- Blimp: `BLIMP2`
- Train horns: `TR-HORN`, `TR-HORN2`

### Weather and event cues

- Rain: `RAIN4`
- Thunder: `THUNDR3B`, `THUNDR5`, `THUNDR6B`, `THUNDR9B`
- Summit Rumble: `BUZZER3`, `BUZZ3`, `SHUTTER`

### Default object-collision sounds

When a SIT object has no explicit hit sound, its type can select one of these:

- `HITPOST1`
- `BARRICAD`
- `PYLON`
- `CRASH1`

An explicit hit-sound name beginning with `STRIKE` is normalized to `STRIKE1`.

Other object hit sounds, continuous object sounds, checkpoint sounds, lap sounds and ambient sounds
are manifest-driven.

### Optional MTM1-sound mode

The **MTM1 sounds** option directly constructs these additional names from MTM2's retail
`SOUND.POD`:

- Corner: `CORNCEM1`, `CORNDIR1`, `CORNICE1`
- Wheelspin: `SPINCEM1` through `SPINCEM3`, `SPINDIR1` through `SPINDIR3`, `SPINROC1` through
  `SPINROC3`
- Brake skid: `SKIDCEM0` through `SKIDCEM3`, `SKIDDIR0` through `SKIDDIR3`

The same name construction can probe `SPINICE1` through `SPINICE3`, but those files are absent from
retail MTM2 `SOUND.POD` and fail quietly.

Source: `src/audio/menu-sounds.js`, `menu-music.js`, `truck-audio.js`, `world-audio.js`,
`src/game/sound-model.js`, `summit-sounds.js`, `src/ui/screens/results.js`, `race.js`.

## Identity-sensitive and feature-specific names

These names do more than locate bytes. The code assigns special behavior when it sees them.

| Name | Behavior | Standalone choice |
|---|---|---|
| `TPARK.SIT` | Preferred track for the Monster Demo; otherwise the first Circuit is used | Rename in code or rely on the existing fallback |
| `ROCKQRY.SIT` | The only track accepted by the Hockey extension | Replace the identity check or create an original hockey track with an explicit capability flag |
| `HPUCK.BIN` | Hockey puck object on Breakneck Ridge | Replace the model and `HPUCK.{RAW,ACT}` or make the track declare its puck |
| `HPOST3.BIN` | Hockey goal-frame object | Replace the model and `HPOST3.{RAW,ACT}` or make the track declare its goal frames |
| `STRTRED.RAW`, `STRTGRN.RAW` | Recognized as red and green drag-tree lamp textures | Preserve the names for replacements or move lamp roles into metadata |
| `WAR.SIT`, `GRAVEY.SIT` | Hidden-track identities | Remove or replace with metadata in the standalone catalogue |
| `CHUCK.TRK` | Hidden-truck identity | Remove or replace with metadata in the standalone catalogue |

Hockey also depends on the rest of the `ROCKQRY` track graph, not only the three fixed names above.

Optional MTM1 compatibility directly recognizes `MODELS/REX.BIN` and its frame list for the TREX
cheat, plus `ART/ALIENSKY.RAW` and `ART/EARTHSKY.ACT` for the MTM1 sky option. These are not MTM2
assets and should not be part of an MTM2-only standalone pack.

Other-game compatibility has additional fixed names such as Evo's `BIRD.SMF`, `PINE80.SMF`,
`PINE100.SMF`, and the `AMT.TRK` suspension special case. Those require a separate rights and
replacement audit if bundled content from those games is planned.

## Manifest-driven content graph

The catalogue does not have a fixed list of stock tracks and trucks. It discovers every mounted
`.SIT`, `.SI2` and MTM `.TRK`. Replacing the fixed assets above is therefore necessary but not
sufficient. Every track and truck included with a standalone release must form a fully original
content graph.

### One MTM2 track

A selected `WORLD/<track>.SIT` or `.SI2` can lead to:

- `LEVELS/<level>.LVL`
- `DATA/<height>.RAW`, `<colour-grid>.CLR`, `<texture-list>.TEX`, matching `.TTY`, baked `.LTE`
- Ground-box grids `<level>.RA0`, `.RA1`, `.CL0`
- The level palette and sky under `ART/`
- Every terrain tile named by the TEX list, including CP3 PNG/TGA art and `_N` or `_AO` maps
- Every object and backdrop BIN named by the SIT, plus each model's textures and animation frames
- Track logo, map and description named by the SIT
- `DATA/SOUNDnnn.TXT`, then every ambient, checkpoint and lap WAV it names
- Track music from the LVL, as WAV or MOD
- Object loop and collision sounds named by SIT records
- CP3 light sprites, cone textures, movers, materials and other authoring extensions

An original standalone track should be validated as a closed graph: no missing path may fall through
to a mounted retail archive.

### One MTM2 truck

A selected `TRUCK/<truck>.TRK` can lead to:

- Body, left/right or per-corner tire, axle and shared driveshaft BIN models
- Every model texture and animated texture frame
- CP3 `_N` normal and `_AO` occlusion maps
- Shock and axle-bar textures
- Lamp source sprites and cone textures
- Up to three driver-name WAV clips from the TRK's `Wave File` fields

The current shared `DRVSHAFT.BIN` dependency is fixed and listed earlier. A cleaner standalone schema
would let a truck name its driveshaft or omit it.

### Tournaments, localization and replays

- Every `TOURNEY/*.TRN` is catalogued, and each can name a description text and a sequence of tracks.
- Every mounted `.LOC` file is offered as an optional wording table. Without one, OpenMTM2 already
  uses its own English UI strings.
- A loaded `.rpl` names its track and truck manifests. A standalone release must either ship those
  identities, migrate replay references, or report that the content pack is unavailable.
- Voice commentary is currently disabled, but the loader and phrase system remain in the code. If
  re-enabled, every phrase clip and every truck-name clip also needs replacement.

## Project-owned assets already present

These tracked assets are not original MTM2 files and do not need replacement merely to remove the
retail install dependency, subject to their existing licenses and attribution:

- `assets/start-background.webp`, CC BY-SA 2.0 as documented in the README
- `assets/fonts/league-spartan-*.woff2`, SIL Open Font License 1.1
- `assets/weatherArt/CCLOUDS.PNG`, `CLOUDY2.PNG`, `DUSKSKY.PNG`, `NITESKY.PNG`, community-created art
  with provenance documented in `assets/weatherArt/README.md`
- Procedural terrain relief, water, snow, puddles, particles, shadows, lights and other visuals
  generated by OpenMTM2 code

The weather-art files still need a clear redistribution license statement, not only provenance,
before treating them as cleared for a standalone release.

## Recommended replacement order

1. **Remove the install gate.** Add an app-owned mount and content manifest, then stop requiring the
   six retail POD names.
2. **Remove embedded original bytes.** Replace the vendored MTM2 palette upstream in OpenPhotex and
   re-author replacement indexed art against the new palette.
3. **Make one closed playable slice.** Ship one original track, one or more original trucks, their
   complete transitive graphs, the fixed driving sounds, HUD font, loading art and required shared
   models.
4. **Replace presentation layers.** Add original menu, cockpit, effects, sky, sun, reflection and
   event art, or intentionally retire the corresponding classic branches.
5. **Fill out game modes.** Add original Circuit, Rally, Summit Rumble, Drag and Hockey-capable
   content, then original tournaments and descriptions.
6. **Audit by capture.** Run every menu, weather, camera, event, replay and VR path with no retail
   archives mounted. Record each VFS miss and audio miss. The final acceptance condition is zero
   fallback reads from a retail install.

For the first standalone content pack, retaining the existing virtual paths is the lowest-risk
implementation. Names can be generalized into metadata after every feature runs from replacement
content alone.
