# OpenMTM2

[![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)
[![Three.js](https://img.shields.io/badge/Three.js-r169-000?logo=threedotjs)](https://threejs.org/)
[![Platform](https://img.shields.io/badge/platform-web-blue)](https://developer.mozilla.org/docs/Web)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-222?logo=github)](https://juanputrerasm.github.io/OpenMTM2/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](LICENSE)

**A clean-room, open-source implementation of Monster Truck Madness 2 for the web.**

OpenMTM2 recreates the original game in a modern browser using your own Monster Truck Madness 2
installation, or Microsoft's free MTM2 trial without one. It supports game data from **Beta 10**,
retail **2.00.41**, the official patched **2.00.42**, and community patches through **Community
Patch 3**. Everything runs locally and nothing is uploaded. The only game files in this repository
are the unmodified trial and its license (`assets/trial/`), which the license allows to be passed on
free of charge.

**Live application:** [Play OpenMTM2 on GitHub Pages](https://juanputrerasm.github.io/OpenMTM2/)

![OpenMTM2 running an eight-truck race with the enhanced renderer](docs/screenshot.jpg)

---

## Features

- **Complete single-player racing:** Circuit, Rally, Summit Rumble, drag racing, tournaments, driver
  profiles, results and a Hall of Fame, with up to eight trucks.
- **Faithful simulation:** clean-room truck physics, collisions and CPU drivers running in a Web Worker.
- **Broad content support:** MTM2 Beta 10 through Community Patch 3, plus tracks from MTM1, CART
  Precision Racing and both 4x4 Evolution games.
- **Classic or enhanced presentation:** ten cameras, the original-style HUD, dynamic weather,
  water, shadows, lighting, particles and optional modern scenery effects.
- **Sound and replay:** engines, impacts, ambience, music and instant replays that can read and write
  the game's `.rpl` format.
- **Player choice:** truck tuning, rebindable controls, graphics presets, cheats, gamepad support,
  free roam and an in-game console.
- **WebXR:** menus and races work in supported standalone and PC-connected VR headsets.

Each area is described under [Feature details](#feature-details).

## Supported game data

OpenMTM2 contains no Microsoft or Terminal Reality game data. Supply your own installation from any
of these releases:

| Release | Support |
|---|---|
| Beta 10 | Supported, with the classic menus by default |
| Retail 2.00.41 | Supported, with the classic menus by default |
| Official patch 2.00.42 | Supported, with the classic menus by default |
| Community Patch 1, 2 and 3 | Supported, with the modern menus by default |

The installer reads `POD.INI` and the archives it lists. It inspects `MONSTER.EXE` only to identify
the version; the executable is never run. At minimum the installation must provide `STARTUP.POD`,
`MUSIC.POD`, `SOUND.POD`, `COCKPIT.POD`, `TRUCK2.POD` and `UI.POD`. Every other archive is optional.

Community Patch 3 content includes `.SI2` tracks, HD PNG and TGA art,
normal and occlusion maps, enhanced materials and glass, track lights and moving objects.

## Requirements

- A modern Chrome, Edge, Firefox or Safari with JavaScript modules, Web Workers, WebGL and Origin
  Private File System support
- Your own Monster Truck Madness 2 installation, as described above
- An HTTP or HTTPS origin; the application does not run directly from `file://`
- WebXR and a compatible browser only when using VR

## Getting started

### Use the hosted application

1. Open [OpenMTM2 on GitHub Pages](https://juanputrerasm.github.io/OpenMTM2/).
2. Pick a language and the graphics (Enhanced or Standard), then get the game's files:
   - **Choose MTM2 folder:** the folder containing `POD.INI`;
   - **Choose ISO or ZIP file:** a disc image or a zip made from your own copy;
   - **Play the free trial:** Microsoft's 1998 trial (Farm Road 29 and four trucks), installed with
     one click after you accept its license.
3. Check in, choose a track and truck, and race.

The archives are copied once to the browser's private storage and remain there until you use
**Change base install** or **Clear browser game data** in Options. They never leave your device.

### Run locally

Clone the repository and serve its root with any static HTTP server:

```bash
git clone https://github.com/juanputrerasm/OpenMTM2.git
cd OpenMTM2
python3 -m http.server 8080
```

Then open <http://localhost:8080/>. There is no build step and no package installation.

> [!NOTE]
> A service worker keeps a local copy of the application after the first visit, so an installed
> game can continue to work offline. A reachable server always takes precedence; Options also has
> a **Start without the server** switch.

## Controls

These are the defaults; every driving key can be rebound in Options.

| Action | Keys |
|---|---|
| Accelerate, brake and steer | Arrow keys or W, S, A, D |
| Shift up / down | Q / Z or Page Up / Page Down |
| Change camera; go back one camera | V; Shift+V |
| Tilt the chase camera | + / - |
| Course map; names on the map | Tab or M; N |
| Dashboard gauges; finder ring | G; F |
| Horn; YeeHaw; helicopter recovery | Space; Y; H |
| Timing display | O |
| Console | The key left of 1 |
| Pause | Esc or P |

Gamepads use the browser's standard mapping. VR controllers follow the WebXR `xr-standard` layout.

## Feature details

### Racing and game modes

- Race Circuit, Rally and Summit Rumble events against CPU trucks, with laps, checkpoints, timing,
  results, persistent driver profiles and a Hall of Fame. Professional difficulty uses a track's
  second course when it has one.
- Run MTM1 drag strips with auto-staging, a working Christmas tree, red lights, lane and reversing
  disqualifications, timing slips and drag weekends based on Community Patch 3's documented rules.
- Explore any non-race track in Free Roam. This is also how mission tracks without checkpoints from
  4x4 Evolution are driven.
- CPU trucks contest the zone in Rumble events, while tire tracks, dust, sparks, splashes and moving
  scenery bring the race to life.

### Simulation, cameras and HUD

- The truck simulation is a clean-room implementation of the original game's documented behaviour:
  suspension, tires, drivetrain, collisions and AI all advance at a fixed 60 Hz in a worker.
- Ten camera views include chase, cockpit and track cameras. The cockpit has its dashboard, steering
  wheel, shifter and mirror; Z mode adds zoom and orbit, while Inertia pulls back with speed.
- The HUD recreates the game's timing board, Lead and Back gaps, speedometer, tachometer, gear strip,
  finder ring, course map and message bar. Speed can be shown in MPH or KPH.

### Tracks and community content

- Add another game's `POD.INI` or individual POD files through **Options > Data**. The POD manager
  shows every mounted archive, its detected game, and the tracks and trucks it supplies.
- MTM1 tracks retain their skies and stadium drag strips. CART Precision Racing tracks include their
  road layer, walls and catch fences. 4x4 Evolution 1 and 2 tracks include terrain, models, AI life,
  object paths trees and checkpoints. All can be raced with MTM2 trucks and physics.
- Community Patch 3 support covers HD model, truck, sky and terrain art; normal and occlusion maps;
  enhanced materials and glass; track lights; moving objects; four-tire sets; and `.SI2` tracks.

### Graphics, weather and water

- Choose the classic 1998 presentation or the enhanced OpenMTM2 renderer. The enhanced path adds
  sun and terrain shadows, smooth shading, terrain detail, glossy sky-reflecting paint, lens flare,
  light beams and glowing lamps.
- Weather includes Clear, Cloudy, Fog, Rain, Snow, Dusk, Night and Pitch Black. Rain and snow are
  blocked by bridges; fog can settle into valleys; snow accumulates with depth and is cleared or
  ploughed by trucks.
- Water supports depth, reflections, shores and underwater views, with spray, wakes and ripples from
  trucks. Snow can freeze it into ice that cracks under hard landings.
- Optional scenery effects add rounded terrain facets, cliff relief, puddles, persistent tire ruts,
  lit particles, detailed ground and the game's original backdrops through atmospheric haze. Each
  feature has its own switch under **Options > Scenery**.

See [the visuals guide](docs/VISUALS.md) for the rendering choices and their controls.

### Audio, replay and customization

- Web Audio plays engine loops, skids, impacts, splashes, ambience, moving-object sounds, menu audio
  and MOD music from the player's installation.
- Instant Replay records the race, switches among any truck and camera, and provides VCR-style play,
  pause, rewind, fast-forward, slow-motion, frame-step and scrub controls. Replays can be saved to or
  opened from the game's `.rpl` format.
- The Garage provides truck tuning. Options include rebindable keys, graphics presets, V-sync, a
  frame-rate limit and GOLD mode cheats. The drop-down console controls opponents, laps, track,
  weather, skill and truck selection.

## In a headset

OpenMTM2 runs in VR wherever the browser provides WebXR. Menus and races show an **Enter VR** button;
you can drive from the cab or a seat behind the truck, use the controllers as a joystick, and set up
races on a board without removing the headset.

A standalone headset cannot select a folder on your computer, so serve the game data to it:

```bash
node tools/serve.mjs --game "/path/to/Monster Truck Madness 2"
adb reverse tcp:8080 tcp:8080
```

With a USB-connected headset, open <http://localhost:8080/> in its browser. For Wi-Fi, use
`node tools/serve.mjs --lan --game ...`; the helper serves HTTPS with a locally generated
certificate. See [the VR guide](docs/VR.md) for setup, controls and implementation details.

## Architecture

| Component | Role |
|---|---|
| ES modules | Application flow, menus, race rules, input, audio and rendering |
| Module Web Workers | Archive loading, asset conversion and the fixed-step vehicle simulation |
| OPFS | Private local storage for the player's game installation and user data |
| Three.js r169 | Terrain, vehicles, scenery, weather, effects and WebXR rendering |
| Web Audio | Engines, effects, ambience, interface sounds and music |
| [OpenPhotex](https://github.com/juanputrerasm/OpenPhotex) | Terminal Reality formats and the MTM2 simulation, vendored as plain ES modules |

The application has no build step. The vendored OpenPhotex copy in `src/vendor/openphotex/` is
generated from the upstream project and should not be edited directly. See
[the architecture guide](docs/ARCHITECTURE.md) for the full module layout and data flow.

## Development

Serve the repository as described under [Run locally](#run-locally), then run the test suite with:

```bash
node --test tests/
```

Tests require Node.js 22.18 or newer. Tests that use original game files look in `~/games/mtm2` or
`$OPENMTM2_GAMES/mtm2` and skip when the installation is absent.

Before contributing, read [AGENTS.md](AGENTS.md). In particular: do not add game data or decompiled
code; implement Terminal Reality formats and simulation changes in OpenPhotex; and cover behaviour
derived from the original game with tests.

The project is under active development. Completed milestones and remaining work are tracked in
[the project plan](docs/PLAN.md).

## Documentation

| Document | Contents |
|---|---|
| [Project plan](docs/PLAN.md) | Milestones, completed work and remaining tasks |
| [Architecture](docs/ARCHITECTURE.md) | Modules, workers, storage and application data flow |
| [VR](docs/VR.md) | Headset setup, controls and implementation |
| [Visuals](docs/VISUALS.md) | Enhanced terrain, water, weather, lighting and scenery |
| [Standalone asset inventory](docs/STANDALONE_ASSETS.md) | Original MTM2 asset dependencies that need replacement for a self-contained release |
| [MTM2 executable analysis](docs/MONSTER_EXE_ANALYSIS.md) | Original game behaviour, rules, HUD, cameras, weather and cheats |
| [MTM2 physics](docs/MTM2_PHYSICS.md) | The original simulation specified for reimplementation |
| [Reverse-engineering tools](tools/re/README.md) | Helpers used to document original behaviour |

## Related projects

- [OpenPhotex](https://github.com/juanputrerasm/OpenPhotex): Terminal Reality file formats and the
  MTM2 simulation used by OpenMTM2.
- [JSTrackViewer](https://github.com/juanputrerasm/JSTrackViewer): browser-based 3D viewer from which
  much of OpenMTM2's rendering work developed.

## Credits and license

Developed by **Juan Pablo Utreras** and released under the [Apache License 2.0](LICENSE).

Monster Truck Madness 2 is a trademark of Microsoft Corporation and was developed by Terminal
Reality Inc. OpenMTM2 is an independent clean-room project and is not affiliated with or endorsed by
Microsoft or Terminal Reality. It contains none of their code or data; you must provide your own
copy of the game.

Third-party assets retain their own licenses:

- `assets/start-background.webp` is adapted from
  ["Untitled"](https://www.flickr.com/photos/fortes/222692658/) by
  [Filipe Fortes](https://www.flickr.com/photos/fortes/), used and shared under
  [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/).
- `assets/fonts/league-spartan-*.woff2` is
  [League Spartan](https://github.com/theleagueof/league-spartan) by The League Spartan Project
  Authors, licensed under the [SIL Open Font License 1.1](assets/fonts/OFL.txt).
