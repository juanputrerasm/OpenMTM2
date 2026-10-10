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
- added archives (`addons`, `src/worker/addon-store.js`): another game's folder, read through its
  own `POD.INI`, or single PODs added in the POD manager. Each is tagged with the game it comes
  from (the first track script it holds says so), and a file is looked up among the archives of
  the track's own game first, in mount order, then among the rest (`src/worker/vfs.js`), so two
  games' same-named files stay apart;
- POD directory indexes, so later visits do not re-read whole archives;
- driver profiles and the Hall of Fame (later milestones).

Small per-browser preferences (look, difficulty, laps) are in `localStorage`
(`src/app/settings.js`).

The Options menu has two separate storage actions. Use a different install removes only the
copied install and preserves profiles, Hall of Fame entries and preferences. Clear browser game
data removes both OpenMTM2 OPFS directories, `install` and `userdata`, plus its
`openmtm2.settings` local-storage entry, after an explicit confirmation.

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

## Tracks of other games

`src/worker/track-build.js` builds every track into one result, which the race screen and the
simulation worker take without knowing the game:

- **MTM2 and MTM1** (`track-build.js`): MTM1 is told apart by OpenPhotex's `detectSitOrigin`; it
  draws its own flat sky and its ground tiles without MTM2's overlap, and its stadium block names
  only a model (the place, scale and walled area are measured from the stock drags, see
  `MTM1_STADIUM`).
- **CART Precision Racing** (`cpr-road.js`): the road layer from the `.TRK` and `.TTX`, laid out
  by OpenPhotex's `buildCprRoad`, drawn over the terrain (a mask keeps the ground from showing
  through it) and driven on as a ground layer; walls are immovable boxes.
- **4x4 Evolution 1 and 2** (`evo-track-build.js`, `evo-models.js`): the 16-bit terrain, SMF
  models, RAW/ACT/OPA and TIFF art, Evo 2's trees. Objects collide as the SIT says: rocks by
  their own surface, authored boxes as decks or obstacles, the rest as boxes around their models.

The simulation's ground is an interface (OpenPhotex `Mtm2Ground`): terrain from heights in feet
(`createTerrainFt`), with a road or mesh layer over it (`createRoadGround`). A mesh layer is
asked per truck with its height (`below`), so what stands over a truck is not its ground. MTM2's
own physics are unchanged. `docs/PLAN.md` (Next features) has what is decided and what is open.
