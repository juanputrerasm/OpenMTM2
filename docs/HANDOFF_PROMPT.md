# Handoff prompt for the next agent

Paste everything below the line into a new session started in `/Users/juanpabloutreras/dev/OpenMTM2`.

---

You are continuing work on **OpenMTM2**, an open reimplementation of Monster Truck Madness 2 (retail 2.00.42) that runs in the browser on the player's own install. Read `AGENTS.md`, `docs/PLAN.md` (milestones and the pending lists), `docs/ARCHITECTURE.md`, `docs/MONSTER_EXE_ANALYSIS.md` and `docs/MTM2_PHYSICS.md` before changing anything. The user is Juan Pablo Utreras; use they/them for people whose pronouns are not stated.

## Rules that matter
- Clean room: `re/` (decompiled exe, Ghidra) is git-ignored and must never be published or quoted. Facts go into the docs first, then the code is written from the docs. Helpers: `tools/re/*.py` run with `re/venv/bin/python` (see `tools/re/README.md`).
- No game data in the repository. Tests that need the game read `~/games/mtm2` through `tests/helpers/stock.mjs` and skip without it.
- File formats and the simulation belong in **OpenPhotex** (`/Users/juanpabloutreras/dev/OpenPhotex`, branch `claude/claude-code-cloud-gucezd`). Never edit `src/vendor/openphotex/`; change OpenPhotex, then `npm test` there, `npm run build`, and `npm run vendor -- /Users/juanpabloutreras/dev/OpenMTM2/src/vendor/openphotex`. Never write an ad-hoc parser for Terminal Reality files: use the openphotex skill.
- Plain ES modules, no bundler. Only `src/render/**` and `src/ui/**` touch three.js or the DOM; `src/worker/**` and `src/game/**` run under Node in tests. Units in game code are feet and seconds; `src/shared/scene-frame.js` is the only feet-to-scene conversion (scene z is mirrored).
- Tests: `node --test tests/` (Node 22.18+). Every behaviour taken from the docs gets a test.
- Writing: no em dashes in docs, comments or READMEs. **Commit only when the user asks, with no co-author or attribution trailers.** (Nothing below has been committed.)
- Do not chase why CPU trucks sometimes fail to finish races; the user said it is not a priority.

## State
All of M1 to M11 is implemented, in the working tree and uncommitted (about 80 changed files in OpenMTM2, plus uncommitted changes in OpenPhotex: reversed course, SIT box sounds, the MOD player, the countdown reset fix is committed there). Run `git status` in both repos first. `node --test tests/` passes (89 tests); OpenPhotex `npm test` passes (322).

Done, by milestone (details in `docs/PLAN.md`): sim and race rules (M1 to M7); Rally and Summit Rumble (M8); driver profiles, Hall of Fame, options with rebindable keys, Garage tuning, the classic menu skin from `UI.POD` art (`src/ui/frame.js`), the game's bitmap fonts for the HUD (`src/worker/bitmap-font.js`, `src/render/bitmap-text.js`), message tables (`.LOC`) as a Wording option, GOLD mode (`src/ui/gold-mode.js`; type GOLD in a race, R reverses the course, Alt or Ctrl plus T, B, Y, W, Z, 0) (M9); weather and the enhanced look: shadows, sun, moon and lens flare (M10); sound and music: engines, skids, impacts, ambience, objects' own sounds, horn (N) and YeeHaw (Y), the announcer, MOD menu music (M11).

Recent decisions: the announcer's voice and text are **off by default** (Options turns them on). The install now keeps `MONSTER.EXE` in OPFS so the announcer's English lines can be read from it; older installs need a reinstall for the text.

## What to do next
1. **Ask the user first.** They want to refine the GUI placement and the HUD **interactively** (they run the game and report what looks wrong; work in small steps). Classic-skin region rectangles are in each screen's `frame(...)` call; the HUD is `src/ui/screens/race.js` with `src/render/bitmap-text.js`.
2. **M12 to M16** in `docs/PLAN.md`: M12 cockpit, finder, map and all 10 cameras; M13 damage deformation; M14 instant replay; M15 multiplayer (WebRTC); M16 Community Patch 3 support. Each needs a short plan first (docs, then code), as earlier milestones had.
3. **Pending items** (all low priority unless the user says otherwise): decode `player.pro` and `highscor.mtr`; the GOODY.BIN blimp; the game's snow and rain textures and the fog tables for the dark weathers (the port approximates them); sky dome is a half dome (a hole shows at extreme fields of view); shadows from terrain hills and from the wrapped world copies; objects hiding the sun from the flare; the announcer's own triggers (the port's are in `src/game/commentary-events.js`); underwater, cockpit (`RAINRF8`) and blimp sounds; GOLD mode's Ctrl+L (load a SIT), BlimpCam and RaceCam; voice chat, Redbook, force feedback; GOLD key X (CPU flag, untraced); Hall of Fame shows raw truck file names.
4. Commit/push only if asked.

## How to check your work
- Unit tests for anything pure; for the browser, run `python3 -m http.server 8099` from the repo root and drive headless Chrome with puppeteer-core (install it in a scratch directory; Chrome is at `/Applications/Google Chrome.app`). Useful flags: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --autoplay-policy=no-user-gesture-required`; call `page.setCacheEnabled(false)` or stale modules will bite. The game install is picked with an `<input webkitdirectory>` (delete `window.showDirectoryPicker` first) and `chooser.accept([~/games/mtm2])`; the profile persists in `userDataDir`. A race exposes `window.__openmtm2Race` (scene, camera, audio, latest state) for inspection. Look at screenshots, not only logs.
- After changing OpenPhotex always re-vendor and re-run both test suites.
