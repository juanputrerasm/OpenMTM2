# OpenMTM2

An open reimplementation of **Monster Truck Madness 2** that runs in your browser.

**[Play the live demo](https://juanputrerasm.github.io/OpenMTM2/)**, hosted on GitHub Pages.
Nothing is uploaded: the game reads your own copy of Monster Truck Madness 2 and keeps it in your
browser's private storage.

![license](https://img.shields.io/badge/license-Apache--2.0-blue)
![status](https://img.shields.io/badge/status-early%20development-orange)

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Controls](#controls)
- [Development](#development)
- [Documentation](#documentation)
- [Related projects](#related-projects)
- [Credits and license](#credits-and-license)

## Features

OpenMTM2 contains **no game data**. It needs your own retail Monster Truck Madness 2 install
(version 2.0.41 or 2.00.42), or one with Community Patch 3. `POD.INI` and the archives it lists
are read, and `MONSTER.EXE` only for its version number (a community patch starts with the modern
menus).

- **Races:** Circuit, Rally and Summit Rumble against CPU trucks, with laps, checkpoints,
  results, driver profiles and a Hall of Fame. Professional puts every truck on the track's second
  course when it has one.
- **Additions:** drag races on the MTM1 strips (auto-staging, the Christmas tree, red lights and
  lane disqualification), CPU trucks that play a Rumble for the zone, tire tracks, dust, sparks and
  splashes, and the helicopter and pterodactyl models.
- **Tracks of other Terminal Reality games:** CART Precision Racing (the road layer, its walls and
  catch fences), 4x4 Evolution 1 and 2 (their terrain, models, trees and every checkpoint) and
  Monster Truck Madness 1 (its own sky and its stadium drags), raced with MTM2's trucks and
  physics, eight trucks at most. Add a game's folder, or single POD files, in Options, Data: the
  POD manager lists every mounted archive and the game it was read as.
- **Free roam:** any track with no race on it, the player alone; 4x4 Evolution's mission tracks,
  which have no checkpoints, are driven this way.
- **Community Patch 3:** its MTM1 tracks, `.SI2` tracks, HD art for models, trucks, sky and ground
  (PNG or TGA, with `_N` normal and `_AO` occlusion maps), materials, glass, track lights and
  moving objects.
- **Simulation:** the original truck physics, collisions and AI, reimplemented from the game's
  documented behaviour and run at a fixed 60 Hz in a worker.
- **Ten camera views:** the chase cameras, a cockpit with dashboard, wheel, shifter and mirror,
  and two track cameras, with the finder ring and the course map overlay.
- **HUD in the game's style:** timing board with Lead and Back gaps, speedometer and tachometer
  (MPH or KPH), gear strip and the message bar.
- **Weather and water:** Clear, Cloudy, Fog, Rain, Snow, Dusk, Night and Pitch Black, animated
  water, underwater fog, wheel spray and ripples.
- **Instant replay:** watch the race again from any truck and any of the ten cameras, with VCR
  controls, and save or open `.rpl` replay files.
- **Sound and music:** engines, skids, impacts, ambience, objects' own sounds, MOD music.
- **Garage and options:** tuning, rebindable keys, GOLD mode cheats, an enhanced look with sun
  shadows, smooth shading and lens flare or the classic 1998 look, V-sync and a frame rate limit.
- **Z-mode cameras and the console:** Z mode's zoom and orbit while driving, an Inertia view that
  backs off with speed, and a drop-down console (the key left of 1) with commands for opponents,
  laps, the track, the weather, the skill and the truck.

The milestones and what is still to do are in [docs/PLAN.md](docs/PLAN.md).

## Getting started

1. Open the [live demo](https://juanputrerasm.github.io/OpenMTM2/) in a recent Chrome, Edge,
   Firefox or Safari.
2. Choose **Choose game folder** and pick the folder of your Monster Truck Madness 2 install (the
   one holding `POD.INI`). The archives are copied once into the browser's private storage.
3. Check in, pick a track and truck, and race.

The install stays in the browser until you use **Use a different install** or **Clear browser game
data** in the Options.

## Controls

The defaults; every key can be rebound in Options.

| Action | Keys |
|---|---|
| Accelerate, brake, steer | Arrow keys or W, S, A, D |
| Shift up, down | Q, Z (or Page Up, Page Down) |
| Camera view (Shift goes back) | V |
| Course map, names on the map | Tab or M, N |
| Dashboard gauges, finder ring | G, F |
| Horn, YeeHaw, helicopter | Space, Y, H |
| Timing display | O |
| Console | the key left of 1 |
| Pause | Esc or P |

## Development

There is no build step and nothing to install: plain ES modules, with Three.js loaded from a CDN.
Serve the repository root with any static server and open it:

```sh
python3 -m http.server 8080
# then open http://localhost:8080/
```

Opening `index.html` as a file does not work: workers and the Origin Private File System need
`http://localhost` or HTTPS.

### Tests

```sh
node --test tests/
```

Node 22.18 or newer. Tests that need game files read them from `~/games/mtm2` (or
`$OPENMTM2_GAMES/mtm2`) and skip when the install is absent.

### Rules for contributors

[AGENTS.md](AGENTS.md) has them. The important ones: no game data or decompiled code in the
repository, file formats and the simulation live in [OpenPhotex](https://github.com/juanputrerasm/OpenPhotex)
(vendored in `src/vendor/openphotex/`, never edited here), and every behaviour taken from the
original game gets a test.

## Documentation

| Document | Contents |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | milestones from an empty repository to a complete game |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the code is organised |
| [docs/MONSTER_EXE_ANALYSIS.md](docs/MONSTER_EXE_ANALYSIS.md) | how the original game works: files, rules, HUD, cameras, weather, network, cheats |
| [docs/MTM2_PHYSICS.md](docs/MTM2_PHYSICS.md) | the original simulation, specified for reimplementation |
| [tools/re/README.md](tools/re/README.md) | the reverse-engineering helpers |

## Related projects

- [OpenPhotex](https://github.com/juanputrerasm/OpenPhotex): the Terminal Reality file format
  library and the MTM2 simulation that OpenMTM2 is built on.
- [JSTrackViewer](https://github.com/juanputrerasm/JSTrackViewer): the track viewer much of the
  rendering comes from.

## Credits and license

By Juan Pablo Utreras. Licensed under the Apache License 2.0 (see [LICENSE](LICENSE)).

Monster Truck Madness 2 is a trademark of Microsoft Corporation and was developed by Terminal
Reality Inc. OpenMTM2 is an independent project, not affiliated with or endorsed by either. It
includes none of their code or data: you need your own copy of the game.
