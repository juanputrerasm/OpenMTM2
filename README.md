# OpenMTM2

An open reimplementation of **Monster Truck Madness 2** that runs in the browser.

OpenMTM2 contains no game data. It reads the tracks, trucks, art and sounds from your own retail
Monster Truck Madness 2 install (version 2.00.42), which you pick once and which then stays in
your browser's private storage.

**Status:** early development. See [docs/PLAN.md](docs/PLAN.md) for the milestones.

## Running it locally

Serve the repository root with any static HTTP server, for example:

```sh
python3 -m http.server 8080
```

and open <http://localhost:8080/>. Opening `index.html` as a file does not work: workers and the
Origin Private File System need `http://localhost` or HTTPS.

There is no build step and nothing to install. Three.js is loaded from a CDN.

## Tests

```sh
node --test tests/
```

Node 22.18 or newer. Tests that need game files read them from `~/games/mtm2` (or
`$OPENMTM2_GAMES/mtm2`) and skip when the install is absent.

## Documentation

| Document | Contents |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | milestones from an empty repository to the first playable race |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the code is organised |
| [docs/MONSTER_EXE_ANALYSIS.md](docs/MONSTER_EXE_ANALYSIS.md) | how the original game works: files, rules, network, cheats |
| [docs/MTM2_PHYSICS.md](docs/MTM2_PHYSICS.md) | the original simulation, specified for reimplementation |
| [tools/re/README.md](tools/re/README.md) | the reverse-engineering helpers |

## Related projects

- [OpenPhotex](https://github.com/juanputrerasm/OpenPhotex): the Terminal Reality file format
  library (and, soon, the MTM2 simulation) that OpenMTM2 is built on.
- [JSTrackViewer](https://github.com/juanputrerasm/JSTrackViewer): the track viewer much of the
  rendering comes from.

## Credits and license

By Juan Pablo Utreras. Licensed under the Apache License 2.0 (see [LICENSE](LICENSE)).

Monster Truck Madness 2 is a trademark of Microsoft Corporation and was developed by Terminal
Reality Inc. OpenMTM2 is an independent project, not affiliated with or endorsed by either. It
includes none of their code or data: you need your own copy of the game.
