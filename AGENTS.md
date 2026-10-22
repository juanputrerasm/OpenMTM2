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
- The one exception is `assets/trial/`: Microsoft's MTM2 trial exactly as published
  (`MtM2trial.zip`, never unpacked or changed) with its license (`EULA.txt`), which allows
  passing on true and complete copies with the license, free of charge
  (docs/STANDALONE_ASSETS.md, "The trial"). Nothing taken out of it may be committed.

## Code

- Plain ES modules, no bundler, no build step. Three.js r169 comes from the import map in
  `index.html`; workers cannot use import maps, so the vendored OpenPhotex is imported by
  relative path everywhere.
- Import the vendored OpenPhotex module by module (`vendor/openphotex/pod/parse.js`), never through its
  `index.js`: the index loads the whole library, three times over (the page and both workers).
- `src/vendor/openphotex/` is generated. Never edit it: change OpenPhotex
  (`~/dev/OpenPhotex`), then `npm run build && npm run vendor -- <this repo>/src/vendor/openphotex`.
- `src/net/vendor/mtmnet/` is generated from the OpenMTM2 Server project's `protocol/`. Never edit
  it: change the server project, then run its `tools/vendor.mjs` into this repo.
- File formats belong in OpenPhotex, never here. So does the simulation
  (`OpenPhotex/src/sim/mtm2/`).
- Non-original game modes are OpenMTM2 extensions. They belong under
  `src/game/extensions/` and `src/render/extensions/`, never in OpenPhotex. Core modules depend
  on the extension loaders and must not import a specific extension.
- Only `src/render/**` imports three.js. `src/worker/**` and `src/game/**` (except
  `game/input/`) must not touch the DOM or three.js, so they run under Node in tests.
- Units in game code are the game's: feet, seconds, radians, slugs, pounds-force, body axes
  x right, y up, z forward. `src/render/world-frame.js` is the only place that converts to
  scene units.
- Text a player sees goes through the message table: `context.t("English text")` where it is
  shown, `msg("English text")` (`game/strings.js`) for text kept in a table and translated later.
  The English text is the tag, written out in full, with `<<1>>`, `<<2>>` for the figures.
  `node tools/lang-strings.mjs --missing es` lists what `assets/lang/es.json` still lacks. Console
  command names and their arguments, and GOLD mode's typed codes, stay English; their help text and
  messages are translated.

## Navigating the code (graphify)

- A local knowledge graph lives in `graphify-out/` (git-ignored). For codebase questions run
  `graphify query "<question>"` first; use `graphify path "<A>" "<B>"` for relationships and
  `graphify explain "<concept>"` for a focused concept. Read `graphify-out/GRAPH_REPORT.md`
  only for broad architecture review.
- After modifying code, run `graphify update .` to keep the graph current (AST only, no API
  cost).

## Tests

- `node --test tests/` (Node 22.18 or newer). Use `tests/helpers/stock.mjs` for anything that
  needs the game files; it reads `$OPENMTM2_GAMES/mtm2` or `~/games/mtm2` and skips without it.
- Every behaviour taken from the docs gets a test stating it.

## Writing

- No em dashes in docs, comments or READMEs.
- Commit only when asked. No co-author or attribution trailers.
