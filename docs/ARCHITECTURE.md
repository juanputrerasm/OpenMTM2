# OpenMTM2 architecture

How the code is organised and why. The milestones are in `PLAN.md`; the game itself is described
in `MONSTER_EXE_ANALYSIS.md` and its simulation in `MTM2_PHYSICS.md`. What the port draws that
the game did not (smoothed ground, its own water and weather) is specified in `VISUALS.md`.

## Pieces

| Piece | Where | Runs on |
|---|---|---|
| File formats | OpenPhotex, vendored into `src/vendor/openphotex/` | anywhere |
| Simulation (trucks, collisions, AI, race rules) | OpenPhotex `src/sim/mtm2/`, vendored | the sim worker, and Node in tests |
| Install, virtual file system, content catalogue, render preparation | `src/worker/` | the asset worker |
| Race session | `src/game/` | the main thread, driving the sim worker |
| Rendering | `src/render/` (the only code importing three.js) | the main thread |
| Headset mode | rules in `src/game/vr/`, drawing in `src/render/xr/`, the app's side in `src/app/xr.js` | the main thread; the rules also Node in tests |
| The port's own scenery (`VISUALS.md`) | rules in `src/game/` (`terrain-relief.js`, `drawn-ground.js`, `ground-maps.js`, `snow-cover.js`, `atmosphere.js`, `fog-floor.js`, `water.js`, `ice.js`, `lighting.js`, `ground-detail.js`, `particles.js`, `truck-lights.js`, `replay-effects.js`, `visuals.js`), the mesh in `src/worker/relief-mesh.js`, drawing in `src/render/` (`scenery.js` and what it makes) | the asset worker and the main thread; the rules also Node in tests |
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

The game's data lives in the Origin Private File System (the app's own files are kept apart,
in Cache storage: "Without a server" below):

- the install: `POD.INI` and the PODs it lists, copied once from the folder the player picks;
- added archives (`addons`, `src/worker/addon-store.js`): another game's folder, read through its
  own `POD.INI`, or single PODs added in the POD manager (a ZIP picked there adds every POD it holds,
  `src/shared/zip.js`). Each is tagged with the game it comes
  from (the first track script it holds says so), and a file is looked up among the archives of
  the track's own game first, in mount order, then among the rest (`src/worker/vfs.js`), so two
  games' same-named files stay apart. MTM1 and MTM2 are one family, so an MTM1 truck named like an MTM2
  one is shadowed by it; with "Keep MTM1 trucks apart" it is listed again as `MTM1:<file>` and built
  through `preferGame("MTM1")`, a view with MTM1's archives first (`src/worker/truck-build.js`);
- Community Patch 3's loose `WeatherArt` folder, copied with the install to `install/WEATHERART`: its
  skies come before the archives' with "CP3 HD weather" (`src/worker/weather-art.js`; the port also
  carries the community's set in `assets/weatherArt`);
- POD directory indexes, so later visits do not re-read whole archives;
- driver profiles and the Hall of Fame (later milestones).

Small per-browser preferences (look, difficulty, laps) are in `localStorage`
(`src/app/settings.js`).

The Options menu has two separate storage actions. Change base install picks the MTM2 folder again
(or another one) and copies only the archives that are new or changed, and Reload POD.INI mounts
again everything the stored POD.INI lists; both preserve profiles, Hall of Fame entries and
preferences. Clear browser game
data removes both OpenMTM2 OPFS directories, `install` and `userdata`, plus its
`openmtm2.settings` local-storage entry, after an explicit confirmation.

## Without a server

The game's data is in the browser from the day it is installed. What still came from a server at
every start was the app itself. The app keeps a copy of itself in the browser too (Cache
storage), and a service worker answers from that copy when the server cannot be reached. So the
same address opens the game with no server and no network: a headset that was on a cable to a
PC once (`VR.md`, "Running it on a headset"), or any browser gone offline.

**The worker** (`sw.js`, at the site's root, so that its reach is the app's folder) does one
thing. Every request goes to the network first, so a server that answers always gives its own
files, exactly as if the worker were not there. Only when the network fails does the answer
come from the copy; for the page itself, a server answering 500 or above counts as failing. The
app is one page, so any address in its folder that is opened gets that page. It leaves alone:

- anything that is not a GET;
- the game folder a development server offers at `game/`, which is copied once into OPFS and
  not kept twice;
- the requests that make the copy (they carry the header `x-openmtm2-offline`), which must come
  from the server or fail;
- other sites' data that scripts fetch for themselves (other sites' scripts, such as three.js
  from its CDN, are answered like the app's own).

It never writes to the copy and keeps nothing in memory, and a new version of it takes over at
once. It is a classic script, since not every browser runs a service worker as a module.

**The copy** is made by the page (`src/app/offline.js`), at each start, once the page is idle.
The app has no build step and so no list of its files; it finds them as a browser does
(`src/shared/app-files.js`): from the page through every stylesheet, script, static and
dynamic import and worker the files name, with the page's import map for bare names. That
reaches every file under `src/` and `styles/` and the files of three.js the app uses. Only
names written as plain strings can be followed, and the tests keep the app to those.

Each file is fetched afresh from the server, past the worker and past the browser's HTTP cache,
and stored in a new cache. Only when all are in is the pointer to the complete copy moved to
that cache and the copy before it dropped. So the copy is always one complete set of files as
one server gave them; a start that cannot finish (the server stopped, the page was closed, the
browser is offline) leaves the last copy in place. Files from another site carry their version
in their address; when that site cannot be reached but the app's server can, the ones already
kept are carried over.

Every tab makes a copy at its start. Where the browser has Web Locks, making a copy and
removing one take turns on the lock `openmtm2-offline|<root>|lock`: one at a time, the last
copy made is the one kept, and a cache left half made by a closed page is dropped. Where the
browser has none, a queue in the page does the same for that page only, so two tabs can write
at once. Each drops a cache only when its building mark is gone and the pointer does not name
it, so neither drops a cache the other is still filling, and the pointer is left naming a
copy that is there.

| Cache | Holds |
|---|---|
| `openmtm2-app\|<root>\|<id>` | one copy: every file under its address, the page under `<root>` |
| `openmtm2-offline\|<root>` | the pointer, at `<root>__offline__`: `{ cache, files, savedAt }` |
| `openmtm2-building\|<root>\|<id>` | the mark that this copy is still being filled; gone once the pointer names it |

`<root>` is the address of the folder holding `index.html`, so two copies of the app on one
site keep apart.

It needs a secure context: `localhost`, or HTTPS with a certificate the browser trusts (a
browser refuses a service worker behind a certificate it was only told to accept). Where it
cannot work the game runs as before. The setting `offline` (Options, "Start without the
server") switches it off: the copy is deleted and the worker unregistered. Like every option it
takes effect when Apply, Save or Close puts it to use, and is undone with the change when Close
discards it. "Clear browser game
data" removes it with the rest.

For someone working on the app: with a server running, the server's files are always the ones
used. With it stopped, the address still opens the last copy, which is the point, but can
surprise; the Options switch is there for that.

## Coordinates

Game code works in the game's own units and axes: feet, seconds, radians; world y up; body
x right, y up, z forward; orientation as `theta` (pitch), `phi` (roll), `psi` (yaw). The SIT
editor space (2 units per foot horizontally, 2 ft height steps) is converted once, when the sim
world is built. `src/render/world-frame.js` is the only place that converts game feet into scene
units.

## The port's own scenery

`VISUALS.md` specifies it; this is how it sits in the code.

- **The simulation is not touched.** The smoothed ground is a second surface that is only
  drawn. It is one pure function of position (`src/game/terrain-relief.js`) that the asset
  worker cuts into a mesh and the main thread asks where the ground is, so the two agree to the
  last bit. A drawn truck is moved onto it; the truck the simulation steps is not.
- **Each part has a switch** (`src/game/visuals.js`), and a part switched off is not built: the
  track comes from the asset worker as it always did (`trackVisuals` says what to build), and
  the screen draws it with the code it always had. The Display page's Enhanced graphics section sets the switches by a
  preset, Auto, Off, Low, High or Max, or one by one on Custom (`src/game/graphics.js`). Auto
  picks among Low, High and Max from the graphics card (`src/app/graphics-hardware.js`).
- **One assembly.** `src/render/scenery.js` makes the parts that are on for whichever screen
  draws a track. The weather scene (`src/render/weather-scene.js`) still decides the weather's
  fog colour, light and lightning, and hands the drawing of them to the parts it is given.
- **Fog is in every material.** three.js's fog shader chunks are replaced once, before the
  first material is compiled (`src/render/atmosphere.js`), so nothing in the scene needs to
  know about it and nothing is drawn twice.
- **Nothing reads the picture back.** The water takes its depth, and the rain and snow their
  floor, from a map of the ground made when the track loads (with what stands over the ground,
  so nothing falls under a bridge), and the fog its floor from another, not from the depth of
  the frame being drawn. No part needs a second pass over the scene, which is what lets a headset run it.
  The lens (`src/render/lens.js`) glows what is bright in the finished picture, and anti-aliasing,
  when an optional method is chosen (`src/render/aa.js`), reads that picture too. TAA also reads
  the scene's depth, to drop a point that moved. Both are the flat screen's only, and `scenery.draw`
  decides, each frame, whether a frame goes through them. The puffs of dust and smoke are drawn
  after the scene, over it (`src/render/over-scene.js`): through the lens reading its depth,
  without the lens straight over it, reading nothing. Where they fill the picture many times
  over they are drawn into a smaller picture by the scene's depth. On the plain screen that
  depth is the screen's own, copied into a texture by the browser (the one call in the port
  made on the WebGL context past three.js, which has no such copy). Where a browser will not
  copy it the scene is drawn into a picture of its own first, one the materials colour as they
  colour the screen. three.js keeps that for the screen and a headset's pictures, so
  `over-scene.js` marks its pictures as the second (r169's `isXRRenderTarget`): it is the one
  place that leans on how three.js is made inside.
- **Two parts run on the graphics card between frames.** The ripples and wakes of the water and
  the puddles (`src/render/water-ripples.js`) are one field of waves about the eye, stepped in a
  picture of their own by `scenery.draw` before the scene is drawn, and read by the water's
  shader and the ground's. The land the water mirrors (`src/render/water-reflection.js`) is a map
  of directions from the eye mirrored under the water, worked out by a pass over the map of the
  ground, also before the scene is drawn (`water.prepare`), and read by the water's shader; it
  is the same size on any screen and serves both eyes of a headset. Neither draws anything of
  the scene or reads anything back, and both are drawn with the headset's own drawing set
  aside, so a headset runs them as the flat screen does.
- **Some textures are worked out once.** The noise the scenery reads (`src/render/noise-textures.js`)
  and the water's waves, whose numbers are `src/game/water-waves.js`'s, are made the first time
  a race needs them and kept.
- **Several parts dress one material.** The ground's material takes lines of shader from the
  weather, from the ground's detail and from the shadow cascades; a truck's from the paint and
  the cascades. three.js gives a material one hook, so `src/render/shader-hooks.js` keeps a
  list behind it, run in a set order, with a key a hook that tells two materials' shaders
  apart. What the level's water and the puddles draw alike (the sky they mirror, the rain's
  rings on them) is one piece of shader in `src/render/water-common.js` that both take.
- **What the ground's shader keeps across its lighting is kept small.** On a small chip a
  shader that needs more registers than the card has to spare is shaded eight pixels at a time
  instead of sixteen, every pixel of it. The ground's weather works out what wet ground and
  puddles mirror before the ground is lit and hands the lighting only that light, as light the
  ground gives off; a ground three.js does not light lays it over what it draws instead.
- **The fog stays in the world.** Its floor and its banks are places in the world and its
  clock is the wind's: nothing in it is tied to where the eye is but what is seen from there, so
  a camera that moves fast does not move the fog.
- **The replay draws what the race drew.** `src/ui/screens/replay.js` makes the same scenery
  and the same lamps, and since the game's replay records no wheel contacts or hull strikes,
  reads them off the drawn trucks against the drawn ground (`src/game/replay-effects.js`) for
  the tire effects to throw from.
- **The light is the weather scene's to time and the rig's to make.** `weather-scene.js` still
  says when the light changes (a weather beginning, a flash); with "Natural light" it asks
  `src/render/light-rig.js` for the lights, which takes its numbers from `src/game/lighting.js`
  and its colours from the level's own sky and ground art.

## The headset

`VR.md` specifies the headset mode; this is how it sits in the code.

- **One renderer for every race.** `src/render/xr/xr-host.js` owns the WebGL renderer, its canvas
  and the frame loop. An immersive session is bound to a WebGL context, so a renderer per race
  would end the session with each race. The race screen borrows the canvas, hands the host its
  scene and frame function, and gives them back when it unmounts. The host is made on first use
  (`src/app/xr.js`), since it brings three.js with it.
- **The rules are pure.** Where the tracking space goes (`pose.js`), where the driver sits
  (`seat.js`), what the controllers mean (`controls.js`), the camera the cockpit pictures were
  drawn through and how the cab's dials read (`cab.js`), the roll cage as read off those
  pictures (`cab-cage.js`), what a menu holds and does (`menu.js`, `lobby.js`) and the
  preferences (`settings.js`) are plain functions on plain data in `src/game/vr/`, tested
  under Node.
  `src/render/xr/` draws what they say: the cab, the HUD boards, the menu board, the stage
  between races.
- **The scene stays in feet.** The tracking space is scaled where it is placed, and the eye
  cameras are kept in feet too, so nothing else in the renderer knows about metres
  (`VR.md`, "The rig"). `FEET_PER_METRE` lives beside the feet-to-scene conversion in
  `src/shared/scene-frame.js`.
- **The flat camera stands in for the head.** In a headset the race's own camera is put where
  the head is, so the sky, the weather, the shadows and the sound follow the head with the code
  they already had.
- **Menus in the headset are data.** A screen puts a menu on the host's board
  (`context.xr.setBoard`); with none set, the lobby shows. The same board is worked by
  controllers, sticks and keys.

`tools/serve.mjs` is a development server with what a headset needs: the player's game folder
served beside the app (the Install screen then installs from it, `src/install/url-source.js`),
and HTTPS on the network. After one visit the headset needs it no more ("Without a server"
above).

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
