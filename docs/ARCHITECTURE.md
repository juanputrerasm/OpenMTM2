# OpenMTM2 architecture

How the code is organised and why. The milestones are in `PLAN.md`; the game itself is described
in `MONSTER_EXE_ANALYSIS.md` and its simulation in `MTM2_PHYSICS.md`.

## Pieces

| Piece | Where | Runs on |
|---|---|---|
| File formats | OpenPhotex, vendored into `src/vendor/openphotex/` | anywhere |
| Simulation (trucks, collisions, AI, race rules) | OpenPhotex `src/sim/mtm2/`, vendored | the sim worker, and Node in tests |
| Install, virtual file system, content catalogue, render preparation | `src/worker/` | the asset worker |
| Race session | `src/game/` | the main thread, driving the sim worker |
| Rendering | `src/render/` (the only code importing three.js) | the main thread |
| Screens | `src/ui/` (HTML), `src/app/` (boot, router, settings) | the main thread |

## Threads

- **Main thread:** the HTML screens, three.js rendering, input sampling and audio.
- **Asset worker:** copies the install into OPFS, mounts the PODs in `POD.INI` order, lists
  tracks and trucks, and turns them into render data (meshes, textures) and simulation input.
- **Sim worker:** owns the race session and steps it at a fixed 1/60 s. Each animation frame
  the main thread posts the time and the player's input; the worker steps until it catches up
  and returns a snapshot of the previous and current state in transferable buffers, which the
  renderer interpolates.

The asset worker hands the simulation input straight to the sim worker through a
`MessageChannel`. GitHub Pages cannot send the COOP/COEP headers that `SharedArrayBuffer` needs,
so nothing relies on it.

## Data on disk

Everything lives in the Origin Private File System:

- the install: `POD.INI` and the PODs it lists, copied once from the folder the player picks;
- POD directory indexes, so later visits do not re-read whole archives;
- driver profiles and the Hall of Fame (later milestones).

Small per-browser preferences (look, difficulty, laps) are in `localStorage`
(`src/app/settings.js`).

## Coordinates

Game code works in the game's own units and axes: feet, seconds, radians; world y up; body
x right, y up, z forward; orientation as `theta` (pitch), `phi` (roll), `psi` (yaw). The SIT
editor space (2 units per foot horizontally, 2 ft height steps) is converted once, when the sim
world is built. `src/render/world-frame.js` is the only place that converts game feet into scene
units.

## Reused code

Infrastructure and render preparation come from JSTrackViewer, copied and adapted for MTM2 only:
`src/shared/worker-client.js`, `src/shared/opfs.js`, `src/shared/path-utils.js` and
`src/worker/pod-index.js` so far. Stable pieces move into OpenPhotex later.
