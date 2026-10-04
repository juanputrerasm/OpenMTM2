# OpenMTM2: rules for contributors and agents

OpenMTM2 is an open reimplementation of Monster Truck Madness 2 (retail 2.00.42) that runs in the
browser and reads the player's own install. `docs/PLAN.md` holds the milestones;
`docs/ARCHITECTURE.md` explains how the code is laid out.

## Clean room

- `re/` holds the decompiled executable, the Ghidra project and working notes. It is
  git-ignored and **must never be published, copied into `src/`, or quoted in commits**.
- Code is written from `docs/MONSTER_EXE_ANALYSIS.md` and `docs/MTM2_PHYSICS.md`. When the
  docs lack a fact, read it from `re/` with `tools/re/` and **write the fact into the docs
  first**, then implement it from the docs.
- No game data in the repository: no PODs, textures, sounds or palettes. Tests that need the
  game read it from a local install and skip when it is absent.

## Code

- Plain ES modules, no bundler, no build step. Three.js r169 comes from the import map in
  `index.html`; workers cannot use import maps, so the vendored OpenPhotex is imported by
  relative path everywhere.
- `src/vendor/openphotex/` is generated. Never edit it: change OpenPhotex
  (`~/dev/OpenPhotex`), then `npm run build && npm run vendor -- <this repo>/src/vendor/openphotex`.
- File formats belong in OpenPhotex, never here. So does the simulation
  (`OpenPhotex/src/sim/mtm2/`).
- Only `src/render/**` imports three.js. `src/worker/**` and `src/game/**` (except
  `game/input/`) must not touch the DOM or three.js, so they run under Node in tests.
- Units in game code are the game's: feet, seconds, radians, slugs, pounds-force, body axes
  x right, y up, z forward. `src/render/world-frame.js` is the only place that converts to
  scene units.

## Tests

- `node --test tests/` (Node 22.18 or newer). Use `tests/helpers/stock.mjs` for anything that
  needs the game files; it reads `$OPENMTM2_GAMES/mtm2` or `~/games/mtm2` and skips without it.
- Every behaviour taken from the docs gets a test stating it.

## Writing

- No em dashes in docs, comments or READMEs.
- Commit only when asked. No co-author or attribution trailers.
