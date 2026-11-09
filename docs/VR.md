# OpenMTM2 in a headset

The same game, drawn around the player: six degrees of freedom, life size, from the driver's seat
of a monster truck or from a seat trailing it. It runs in any browser with WebXR's
`immersive-vr` sessions, which means the browser of a standalone headset (a Meta Quest's) and a
desktop browser with a PC headset behind it (Chrome or Edge through SteamVR or the Oculus
runtime).

Nothing here comes from the original game: it never had a headset mode. This document is the
specification the code under `src/game/vr/` and `src/render/xr/` is written from, as
`MONSTER_EXE_ANALYSIS.md` is for the rest. Where the headset mode reuses something of the
game's (the dashboard art, the dials' angles, the joystick's response) the game's document is
named.

**How it was tested.** In Chromium with Meta's Immersive Web Emulator runtime (IWER) standing
in for a Quest 3, both eyes drawn, controllers and head moved by script, and with the unit tests
under `tests/vr-*.test.mjs`. Starting without the server was tested the same way: installed
from the development server, then the server stopped and the browser started again with no
network at all, a race driven and the headset mode entered. None of it has yet been run on a
physical headset by the author of this mode. What an emulator cannot show is listed under "Not
done, not known".

## Running it on a headset

A headset's browser needs two things a desktop does not: the page over `http://localhost` or
HTTPS (browsers allow WebXR and private storage nowhere else), and the game's files without a
folder picker that can reach the PC they are on. `tools/serve.mjs` gives both. It serves the
app, and with `--game` your own Monster Truck Madness 2 folder beside it; the Install screen
then offers **Install from this server** and copies the archives into the headset browser's
private storage, once.

On a USB cable (the surest way; the headset needs developer mode and the PC `adb`):

```sh
node tools/serve.mjs --game "/path/to/Monster Truck Madness 2"
adb reverse tcp:8080 tcp:8080
```

and open `http://localhost:8080/` in the headset's browser. `adb reverse` makes the headset's
`localhost:8080` the PC's.

Over Wi-Fi:

```sh
node tools/serve.mjs --lan --game "/path/to/Monster Truck Madness 2"
```

It prints an `https://` address for each of the PC's network addresses. Open one in the
headset's browser and accept its warning about the certificate (the server makes its own, with
`openssl`, kept in `~/.cache/openmtm2`; `--cert` and `--key` take yours instead). Should a
browser refuse the certificate altogether, `--lan --http` serves plain HTTP for a browser told
to trust the address (in a Chromium browser, `chrome://flags`, "Insecure origins treated as
secure"). The game folder is sent to whoever asks for it: use `--lan` on a network you trust.

Then, on any menu screen or in a race, **Enter VR**.

**Once is enough.** The browser keeps the app as well as the game
(`ARCHITECTURE.md`, "Without a server"). Shortly after the install a note at the foot of the
page says "Saved in this browser": from then on the same address, `http://localhost:8080/`,
opens the game in the headset with no cable, no PC and no network. Bookmark it. To bring a newer version of the app
across, connect again with the server running and open the address: the server's files are
used at once and the kept copy is renewed.

This works over the cable, where the address is `localhost`. Over Wi-Fi with the server's own
certificate it does not: a browser refuses a service worker behind a certificate it was merely
told to accept, and Options then says "Not possible here" under "Start without the server".
(With `--lan --http` and the address marked as trusted in the browser's flags it works again.)
The copy lives in the browser's storage for that address: clearing the browser's site data, or
"Clear browser game data" in Options, removes it, and so does a different port.

On a PC with a headset nothing special is needed: open the game as usual, install from the
folder, and press Enter VR.

The Install screen asks for a served game folder only when the page comes from the player's own
machine or network (`src/install/url-source.js` `mayServeGame`), so a public copy of the site
makes no failing requests.

## Playing

### Controllers

The controllers are the game's analog joystick (`MONSTER_EXE_ANALYSIS.md` section 7), read in
WebXR's `xr-standard` layout (`src/game/vr/controls.js`).

| | Left hand | Right hand |
|---|---|---|
| Thumbstick | steer | pedals when no trigger is pulled: forward is the throttle, back the brake and reverse |
| Trigger | brake and reverse | throttle |
| Squeeze | shift down | shift up |
| Lower button (X, A) | next view | horn |
| Upper button (Y, B) | pause | helicopter |
| Thumbstick press | YeeHaw | recentre |

With one controller its stick both steers and works the pedals. A controller with a touchpad
and no stick uses the pad. A gamepad or the keyboard still drive: the keyboard takes over while a
driving key is held, a gamepad while it is off its rest.

**Steering.** The simulation puts the joystick's steering axis through the game's own curve:
past the dead zone it reaches full lock at 90% of the throw, raised to about the third power.
That suits a thumbstick, where small pushes should steer finely. The other way to steer, chosen
in the options, is **hands as on a wheel**: the steer is the tilt of the line from the left hand
to the right, full lock at 70 degrees, the right hand lower turning right; hands closer together
than 12 cm are not on a wheel and the stick steers. There the road wheels should follow the
hands in proportion, so the hands' steer (less 3% of play about the middle) is sent as the stick
position the game's curve turns into it (`stickForSteer`).

### Views

The view key (V, or the left hand's lower button) goes round three views (`VR_VIEWS`):

| View | Where the player is |
|---|---|
| Cab | in the truck, at the seat its body gives |
| Chase Near | on a level seat 28 ft behind the truck and 8 ft above it |
| Chase Far | 50 ft behind and 14 ft above |

A chase seat closes on its place behind the truck at 4 per second and turns to face the truck at
8 per second. It is always level.

The seat is in or behind the player's own truck for the whole race. Once the player has
finished, the flat screen's RaceCam goes on to a truck still racing (`src/game/race-end.js`);
the headset stays where it is, since the cab and the seat's settings are the player's truck's,
and a headset is never moved somewhere else without warning.

### Menus

Pause (Escape, or the left hand's upper button) puts a board in front of the player: Resume,
Recentre view, View, VR options, End race, Leave VR. Every board is worked three ways at once
(`src/render/xr/vr-panel.js`):

- a controller's beam on an item, and its trigger. On an item with a value, the trigger left of
  the value steps it back, on or right of it steps it on;
- either thumbstick: up and down move (held, it repeats after 0.4 s and then every 0.15 s), left
  and right step a value, the lower button chooses, the upper one goes back;
- the keyboard: arrows, Enter, Escape.

A trigger with no beam on the board chooses the highlighted item. The press that opens a board
is never taken as a press on it (the pause button is also "back"), and a button held while a
board opens or closes does nothing until it is let go and pressed again.

### Between races

A headset shows only what is drawn for it, and outside a race the game is HTML. So the headset
gets boards of its own there, on a dark floor grid (`src/render/xr/idle-stage.js`):

- **the lobby** (`src/game/vr/lobby.js`), whenever no screen has put up a board of its own: the
  Races screen's choices as one list. Track (only the race types the port runs), Laps (Minutes
  for a Rumble), Truck, Opponents (0 to 7, never more than there are other trucks), Weather
  (what the track allows, and Random when it allows several), Start race, Leave VR. A track
  brings its own length and weather, as on the Races screen. The choices are read from and
  stored in the same settings and driver profile as the flat screens use, so each picks up where
  the other left off;
- **Loading**, while a race loads;
- **the Winner's Circle** after a race: place, driver, truck, time (a Rumble's score) and best
  lap, the player's row marked, then Race again, New race (back to the lobby) and Leave VR.

So a session can go lobby, race, results, race again without the headset coming off. End race
in the pause menu goes back to the lobby.

### Options

In a race, under VR options: Horizon lock, the seat (forward, height, sideways, in steps of a
quarter foot, and Reset seat), Cab, HUD, Steering, View distance. On the flat Options panel,
where the browser has a headset: View, Steering, the three switches, Sharpness, Edge detail and
View distance.

They are stored under `vr` in the settings (`src/game/vr/settings.js`):

| Key | Default | Meaning |
|---|---|---|
| `view` | `cab` | the view a race opens in |
| `horizonLock` | on | cab view: the horizon stays level |
| `hud` | on | the timing rows, messages and gauges |
| `cab` | on | something around the driver in the cab view: which, `cabStyle` says |
| `cabStyle` | `model` | the cab view's surroundings: `model`, the roll cage and dashboard built in the round, or `panels`, the stock cockpit's flat art on a box around the driver |
| `steering` | `stick` | or `wheel`, the hands as on a wheel |
| `renderScale` | 1 | the eye buffers' size against the headset's own, 0.5 to 1.5; read when VR is entered |
| `foveation` | 1 | how far the edges of the view drop in resolution, 0 none to 1 most; read when VR is entered |
| `viewDistance` | `full` | how far the headset draws: `full` (as far as the weather lets the eye see), `medium` (4000 ft) or `short` (2500 ft) |
| `seats` | none | per truck file, feet [right, up, forward] added to the seat |

## How it works

### The host

`src/render/xr/xr-host.js`. One WebGL renderer and canvas serve every race, because an immersive
session is bound to a WebGL context: a renderer made per race would end the session at the end
of each. A screen that draws borrows the canvas, hands the host its scene and its frame function
(`start`), and gives them back (`release`). The host runs one frame loop, the window's or the
headset's; while a session runs with no screen drawing, the idle stage is drawn.

The app's side is `src/app/xr.js`: whether there is a headset, entering and leaving, the board
for between races. The host imports three.js, so it is loaded on first use; where the browser
has a headset it is loaded ahead, because a browser opens a session only shortly after a click.

Entering asks for a session with the optional feature `layers` (three.js then draws into the
headset's own textures, with multisampling); if such a session cannot be set up it is ended and
one without is asked for. The reference space is `local`: recentring is the rig's work.

### The rig

The scene is in feet (`src/shared/scene-frame.js`) and a headset reports metres. The tracking
space is a group, the rig, placed in the scene and scaled by `FEET_PER_METRE` (1 / 0.3048), so
that what hangs from it (the head, the controllers, the seat and its boards) is in metres and
the world is life size.

When the player recentres, the head's position and heading are kept as the **calibration**: the
driving position. Only the heading is kept of the head's attitude, taken from its right-hand
axis, which stays level while the player looks up or down. Each frame the rig is placed so that
the calibrated head pose sits on a seat in the scene (`src/game/vr/pose.js` `rigMatrix`):

    rig = seat * S(scale) * Ry(-yaw0) * T(-head0)

A recentre is taken when a session starts, when the headset reports that it moved its own origin
(the reference space's `reset`), and when the player asks (the right stick's press, the pause
menu, the C key).

**View space stays in feet.** three.js would carry the rig's scale into the eye cameras' view
matrices, which makes view space metres: fog distances, light ranges, sprite sizes and the
shadow cascades, all written in feet, would be wrong by 3.28. Instead the host strips the scale
from each eye's world matrix and folds it into the projection, where a uniform scale of view
space is only a change of the near and far distances: the one element of the projection that
holds them is multiplied by `FEET_PER_METRE`. The picture and the depth buffer are the same as
the scaled ones. The session is told the planes in metres (10 cm and the flat camera's 20000 ft).
three.js writes the projections afresh only on a frame that has a head pose, so the host
remembers what it left in each and never converts one twice.

**The flat camera as the head.** The race's ordinary camera is put where the head is in the
scene (midway between the eyes, with the eyes' field of view) each frame. Everything that
follows the camera on the flat screen, the sky dome, camera-facing scenery, rain and snow, the
shadow cascades, the sun's flare, the sound's listener, then follows the head with no code of
its own.

### The seat

`src/game/vr/seat.js`. A truck's files do not say where its driver sits: the game's cockpit is a
picture laid over the view. The seat is read off the body model. Stock bodies share their
proportions: the cab roof is over the stretch from half a foot behind the body's origin to 2.5
ft ahead of it, within 1.25 ft of the centre line (a light bar or a wing further back is higher
and does not count). The eyes go on the centre line, where the game's centred steering wheel has
them, 1 ft under the highest point of that stretch and 1 ft ahead of the origin. A body with
nothing over the stretch gets the stock roof height, 4.9 ft. The player may move the seat up to
3 ft sideways, 4 ft up or down and 6 ft forward or back; the offset is kept per truck.

### Horizon lock

With the lock on (the default), the cab seat keeps level and only follows the truck's heading:
the truck pitches and rolls around the driver, who is spared it. With it off the seat is bolted
to the truck.

The heading a level seat follows cannot simply be the nose's: that turns half a circle the
moment the truck goes end over end through the vertical, and means nothing while the nose points
at the sky. So (`createHorizonTracker`) the heading is integrated from the truck's own turning
about the vertical (the twist about the vertical of each frame's rotation), and pulled toward
the nose's heading at 12 per second, weighted by how far the nose is from the vertical:
`smoothstep(0.25, 0.6, h)` of the nose's horizontal length `h`. On its roof the truck's heading
is pulled toward whichever of nose and tail is nearer. A truck that moves more than 20 ft in a
frame was put somewhere else (a reset, the helicopter) and the tracker starts afresh.

### The cab

`src/render/xr/vr-cab.js`, `src/render/xr/cab-kit.js`, `src/game/vr/cab.js`,
`src/game/vr/cab-cage.js`, `src/render/xr/vr-panels.js`, `src/game/vr/panels.js`. A body model
is a shell seen from outside; from the seat its insides are not drawn and the driver would hang
in the air above the axles. The game's cockpit (`MONSTER_EXE_ANALYSIS.md` section 11) is four
pictures of a roll cage seen from the driver's eyes: ahead, left, right and back. The headset
has it two ways (`cabStyle`): the cage built in the round, or the stock pictures themselves on a
box around the driver. An install without the cockpit always gets the cage, bare, with plain
dials.

The modelled cab belongs to the truck, so it pitches and rolls with it also when the horizon is
locked; a frame that stays still against the truck is also what makes a moving view
comfortable. It is built from the four pictures, as follows.

Community Patch 4's 3D cockpit (VISUALS.md, "The 3D cockpit") is not used in the headset yet:
its cab is modelled around the layout's EYE, while the headset's seat comes from the body
(`game/vr/seat.js`), and the two would have to be brought together first (the seat moved to
EYE, or the cab placed against the seat). Until then the headset keeps the cab above.

#### Reading the pictures

**The camera.** The four panels (`pbig480.raw`, `pbigl480.raw`, `pbigr480.raw`, `pbigb480.raw`,
each 640 x 480) are one cab seen from one point in four directions a quarter turn apart. Their
focal length is 240 pixels: 90 degrees from top to bottom and 106 from side to side, so
neighbouring pictures share 8 degrees at each edge. That is read off the things two pictures
both show. The three upper gauges of the bank at the right of the dash have their centres at
(526, 345), (581, 347) and (635, 350) on the front panel and at (42, 372), (89, 365) and
(129, 360) on the right one; the left pillar's strap clamps are at (75, 113) and (103, 243) on
the front panel and at (543, 118) and (603, 250) on the left one. With a focal length of 240
each lands within 40 pixels of where the other picture has it; with 320 (a right angle from
side to side, which is how the box of stock panels was first hung) the gauges would fall more
than 100 pixels away, the first of them off the picture. A pixel therefore gives a direction
from the eyes (`panelRay`), and a point in the cab shows at a known pixel of each panel
(`panelPixel`). Points are in the art frame: feet around the eyes, x right, y up, z ahead.

**Where pictures disagree.** They do, by up to 30 pixels in the overlaps and outright in a few
places (the back panel has two heavy tubes from its upper corners that the side panels do not
show, and no seat; the left and back panels put the extinguisher in different places). Each
picture is believed over the quarter turn it faces, its columns 80 to 560 (`panelFacing`), and
a thing two pictures place differently stands between them.

**Depth.** One point of view gives directions, not distances. Distances come from what is
known to be the same size: the padding is the same foam on every bar, so its width on a
picture gives the bar's distance (59 pixels on the padded upright beside the head, square to
the side view; 67 on the header, overhead and ahead). That makes the cage a box: its sides
0.93 ft either side of the eyes, the header 0.95 ft ahead and 0.67 ft up, the roof rails
0.5 ft up, the rear hoop 0.96 ft behind (its posts stand at 45 degrees on the back panel and
on the side ones). The dials are flat circles on the front panel, so they stand square to the
view ahead, 1.1 ft off; the dash bars that carry them are at 1.15 ft.

**Scale.** The pictures give proportions, not a size. With the dash 1.1 ft from the eyes the
instruments are life size: the tachometer's bezel 5.3 inches across (the 5 inch dial with a
shift lamp on its rim that such trucks carry), the gauges of the bank about 2.5, the steering
wheel 14. At that scale the padding is 2.7 inches thick, the painted main tubes 1.15 and the
bright secondary ones 0.6, where a real cage's main tubes are an inch and a half or more: by
the tubes the cab would be half as large again. The art frame is the instruments' scale, and
the cab is built `CAB_SCALE` = 1.25 times that: between the two readings, with the dials half
a metre from the eyes, which is as near as a headset is comfortable to look at, and with the
top of the padding 0.98 ft over the eyes, just under the body's roof (the seat is a foot
under it). From the driving position the cab looks the same at any scale; the scale only
changes how it moves as the head moves. It is the one number to change if the cab feels too
tight or too toy-like in a headset.

#### The cage

`cab-cage.js` lists every tube as it was read: a pixel on a panel, on the plane the tube stands
in. All of it is the same both sides. The diameters are the pictures' (art feet): 0.096 for the
painted main tubes, 0.05 for the bright ones unless given, 0.225 for the padding.

- **The header** over the windscreen, padded: front panel row 71 from column 117 to 528. Its
  ends drop to the roof rails, which are padded as far back as the driver's head can reach
  (0.78 ft behind the eyes) and bare from there to the rear hoop. A rail runs level to 0.5 ft
  ahead of the eyes and climbs from there to the pillar's head at 0.62 ft up.
- **The A-pillars**, painted black, from inside that padding (they leave it at front panel
  row 100) down and forward to their feet 0.5 ft under the eyes and 1.23 ft ahead. The left
  one runs through (72, 110) and (100, 250) on the front panel and (563, 130) and (614, 250)
  on the left one; the two pictures disagree about its foot and it stands between them. A red
  cable runs down the left pillar and a white one down the right, under strap clamps: three
  on the left (front panel rows 113, 243 and 255) and two on the right (rows 142 and 252).
- **The padded upright** beside the driver's head on each side, left panel (325, 130) to
  (350, 330), with a bare foot on to (380, 430).
- **The door bars** under each side window, left panel rows 333 and 377; a long diagonal from
  the rear post's head at (66, 162) down to the sill at (300, 445); a short brace at each end
  of the window, (72, 258) to (135, 330) and (500, 255) to (440, 330); and a painted diagonal
  across the window's front, from a mount of two short dark tubes under the roof rail at
  (435, 185) down to the pillar, which it meets at (618, 315).
- **The dash bars**, bright, on front panel rows 350 and 398, the full width of the picture:
  the dash is wider than the cage. A short bar under them on row 443.
- **The rear hoop**: bright posts, a top bar on back panel row 90 and a crossbar on row 347
  that runs on past the posts. Behind the seat a padded inverted V, each leg from beside the
  top bar's middle at (333, 90) to the hoop's lower corner at (552, 347), its ends bare.
- **The roof**: a padded bar across behind the head, 0.43 ft behind the eyes (the back panel's
  top edge and the fat padding in the side panels' upper rear corners); a painted diagonal
  each side from the hoop's top bar out to the rail; two thin bright tubes from each rail's
  rear node in and down toward the seat's head. Over the bars a headliner 0.79 ft up: grey
  carpet ahead of the padded bar, dark tread plate behind it, a dark spine across over the
  driver.
- **The rear window** is a frame of bolted flat bar just behind the hoop (the posts cross in
  front of it on the picture): uprights at back panel columns 121 and 521 from row 118 to
  301, a top bar on rows 112 to 125 and a bottom one on 297 to 305, thirteen bolt heads, and
  gusset plates in the hoop's lower corners. A strip of tread plate catches the light over the
  top bar. A plate at each rear post's head holds the long diagonal.
- **The right side's cables**: two white ones run on from the pillar under the roof rail's
  padding and up into the roof, right panel (105, 108) to (460, 79), and two dark ones down
  behind the padded upright.

Through the camera, 98% of the points along the tubes' middle lines fall on drawn (not
see-through) pixels of the picture that faces them; the test `stock pictures: the cage and the
fittings stand on what the pictures draw` holds that above 95%.

#### The room

Below the windows the pictures are closed in, and crowded: tread plate behind wire mesh on
each side, a six-switch rocker panel on each wall, small gauges, a box behind the seat with
two line gauges and braided hoses, an electrical box in the right rear corner. None of that
is modelled piece by piece. The pictures themselves are hung on the room's walls where those
things are, cut to the quarter turn each faces (`ART_WALLS`): the left and right panels' rows
338 to 480 on walls 0.965 ft either side, the strip of lit tread plate beside each rear post
(rows 195 to 338), and the back panel's rows 305 to 480 on the rear wall 1.0 ft behind. A
point's texture coordinate is the pixel it shows at through the pictures' camera, so from the
driving position each wall looks exactly as the game drew it, with the cage's own bars
standing in front of their painted likenesses.

What stands proud of a wall is cut out again in front of it (`ART_FITTINGS`): the two switch
panels, the box behind the seat, the electrical box, and on the dash the hinged switch plates,
the plate between the dials, the lamp bracket beside the tachometer and the dials' two
brackets. Each is its rectangle of its picture on a plane square to that view, with a dark
body that runs straight away from the eyes, so that from the driving position only its face
shows.

The dash is wider than the cage, so the room is a narrow cab (the side walls) with a bay
1.7 ft either way across its front from 0.72 ft ahead, a firewall 1.45 ft ahead whose top is
front panel row 322, and a toe board sloping away under it. The side walls' pictures stop
where the bay begins, so the gauge bank is not behind them.

#### The dash

- **The dials** stand where the layout has their centres, square to the view ahead: a dark
  housing, a bezel, and the picture's own face (below). The speedometer's and tachometer's
  bezels are 55 and 48 pixels in radius on the art.
- **The shift lamp** on the tachometer's rim, front panel (384, 270), amber; near the top of
  the revs the game's lit art (`pl480.raw`) shows over it, as on the flat screen.
- **The gauge bank** at the right: six gauges at front panel (526, 345), (581, 347),
  (635, 350), (548, 415), (608, 427) and (566, 480), 21 to 24 pixels in radius, 1.16 ft off on
  two rails. Their faces, needles and all, are the picture's. Two are cut off by the picture's
  edge and take a whole neighbour's face.
- **Two push buttons** on posts beside the bank: the blue fuel one at front panel (608, 285)
  and the red fire one the right panel shows beside it at (150, 285).
- **The red bottle** by the right side's painted diagonal, its top end toward the driver: the
  front panel shows its cap nearly end on at (542, 277) and its far end at (575, 315).
- **The steering wheel** from the layout's rectangle (145, 330, 350, 150): the wheel frames
  show the top of a rim that runs through the rectangle's top middle and its bottom corners,
  so the rim is a circle of radius (w^2 / 4 + h^2) / 2h = 177 pixels about a point under the
  picture's lower edge, square to the view ahead, 0.79 ft off. Foam rim, three drilled silver
  spokes, a domed hub, as the frames show. It turns 110 degrees at full lock.
- **The gear readout**, P R N 1 2 3 with the gear in red, where the game's cockpit prints it
  under the dash (292, 418 to 346, 427; `MONSTER_EXE_ANALYSIS.md` section 11).
- **The shifter plate** is the game's frame art, swapped per gear, on a dark body and a post;
  the frames' left 36 columns are the dash behind the plate and are left off. The layout
  draws it at (496, 272, 128, 192), over the gauge bank, which the right-hand picture shows
  uncovered: on a flat screen the two are never seen together, in a cab they are. So the
  plate stands where a truck's shifter does, by the driver's right hand (0.72 ft right,
  0.98 ft down, 0.3 ft ahead, art feet), turned to the eyes, as large as the layout's
  rectangle would be 0.6 ft off. That is below every picture, so it hides nothing they show.
- **The mirror frame** is the game's frame art at the layout's rectangle, 0.9 ft off, which is
  at the right pillar's head; dark glass behind it, no live view.

At the left rear an extinguisher stands in the corner (red, with a bright band), and a dome
light hangs under the roof at the right rear, back panel (127, 100), 32 pixels in radius, a
bright rim around the picture's own lens.

#### The port's own

No picture shows what is under the driver or more than 45 degrees down. There the cab adds a
plain dark bucket seat (every one of these trucks has one), its back low enough (1.05 ft under
the eyes) to leave the back picture clear; tread plate walls and floor 3.4 ft under the eyes;
and a cowl deck from the firewall's top out to the hood, so the view over the dash does not
fall through the body's empty shell. The deck is the one part fitted to the body (`cabFit`):
its far edge is 5 ft ahead of the eyes at the height of the body's top there, which on the
stock bodies is on the hood (kept between 0.4 and 1.6 ft under the eyes, 0.75 ft when the
body has nothing there), and as wide as the body less 0.3 ft (kept between 2.6 and 3.6 ft).
The stock bodies' windscreens reach their hoods about 3.8 ft ahead of the eyes, so the whole
cab stands inside the body's own cabin.

The plain surfaces are drawn, not cut from the pictures, in the pictures' colours: black foam
with a grey speckle (`#0f0f0e` to `#5d5d5c`), dark tread plate with pale diamond scratches
(`#0c0d0e`, lines to `#3d4144`), the same plate lit (`#5b555a` to `#c9bcc6`), grey carpet with
its weave across (`#424246` to `#7e7e87`). The tubes carry their light baked in, as the
pictures do: a bright tube is dark at its edges with a hard highlight off its middle and a
dark band under it, a painted one black with a soft sheen, each wrapped so that the highlight
faces the eyes.

Nothing in the cab is lit by the scene. The pictures carry their own light and the modelled
parts are shaded to match; the cab dims with the weather, by the same light level the classic
look dims the world by, all but its lit instruments: the needles, the gear readout and the
shift lamp. Without the install's cockpit the gauge bank, which has no faces of its own, is
left out, and the fittings are plain grey.

#### The needles

The dials are the game's own. Their faces are the 640 x 480 dashboard panel's
(`ART\PBIG480.RAW`, read by `src/worker/cockpit-art.js` without its black cut out, since a
dial's face is black), with the bezel's radius measured off the art (55 and 48 pixels; the
layout's radius is the needle's). The needles follow the layout `DATA\POWERBIG.480`: a zero angle and degrees per unit, **read
clockwise from twelve o'clock**. That reading is checked against the faces: the speedometer's
304.5 + 2.65 per mph puts 20 mph straight up and 90 mph straight down, and the tachometer's
153 + 0.0261 per rpm puts 1000 rpm straight down and 8000 straight up, where the faces print
them. The needles stop at the faces' last marks, 110 mph and 9000 rpm. An install without the
cockpit gets plain faces drawn with the same marks.

#### The stock panels

The stock panels are the game's own four pictures (`pbig480.raw` ahead, `pbigl480.raw`,
`pbigr480.raw` and `pbigb480.raw` around, each 640 x 480 with pure black see-through) hung as a
box around the eyes, each where the pictures' camera puts it (`src/game/vr/panels.js`), so
every pixel is seen in the direction it was drawn in. The pictures are 106 degrees wide and
overlap their neighbours, so not all of each is shown. The front one hangs whole 5 ft ahead,
13.3 ft wide and 10 tall, since the layout's pieces lie on all of it; the side ones hang at its
edges, 6.7 ft either side, from its plane back to their own far edges 8.9 ft behind the eyes
(the right one's columns 140 to 640, the left one's 0 to 500); the back one closes the box
there with its columns 140 to 500. Where neighbours meet, the pictures' own disagreements show
as seams. Like the game the panels are screen-fixed: the box sits on the level seat, so with
the horizon lock it stays level while the truck pitches and rolls around it, and without the
lock it is bolted to the truck. The flat pieces all come along, laid on the front panel where
the layout puts them: the two needles drawn at the layout's centres with the game's needle
art, the steering wheel frame for the steering angle, the shifter frame for the gear, and the
shift light near the top of the rev range. The mirror and the finder stay out: the mirror
wants a live view and the finder already hangs from the seat as part of the HUD.

### The HUD

`src/render/xr/vr-hud.js`. The flat HUD is 2D canvases over the picture. The headset has
canvases of the same kind, drawn larger and on a faint dark plate (bare text is hard to read
against a bright sky), as textures on boards that hang from the seat:

- the timing rows, up and to the left (24 degrees left, 9 up, two metres off), clear of the
  cab's bars and dials;
- messages, straight ahead, 14 degrees above the horizon;
- the chase views' flat gauges, low on either side, shown only where there is no dashboard (a
  cab showing its own dials takes their place).

The boards are drawn over the scene and are hidden while a menu is up.

### The sky overhead

The sky art is a view toward the horizon. The dome wraps it around four times and runs it twice
up the height, so above 45 degrees the art starts again and its rows run together at the top.
The flat cameras never look that high; a headset does. From 30 degrees up the dome fades into
the colour of the art's top rows, and overhead the sky is plain. This is the port's own: how the
game draws its sky overhead is not traced.

The sun's lens flare is a 2D overlay on the flat screen. A headset has no finished frame to draw
over (each eye is its own picture), so there the flare's layers stand in the scene, along the
same line from the sun through the centre of the view (`src/render/sun-flare.js` `setStereo`).

## What it costs

A headset draws everything twice, at a higher rate, on a phone's graphics chip. Two things in
the flat renderer were far too dear for that, and were changed for both. The flat picture was
compared before and after on seven tracks in both looks: it is the same pixel for pixel on most
and differs elsewhere only in what moves between two runs (snowflakes, an animated model's
frame) and in a handful of single pixels.

- **The world is drawn once, as a window around the view.** Terrain, ground boxes, roads,
  scenery and water are split into 512 ft blocks. Each block is moved by whole worlds to the
  copy nearest the camera, matching the game's wrapped renderer without drawing eight duplicate
  worlds (`src/shared/object-chunks.js`, `src/render/track-scene.js`).
- **Repeated static scenery is instanced per block.** A forest therefore costs only the blocks
  in view, in both the picture and the shadow map. Terrain blocks share their vertex buffers,
  so the camera frustum skips the rest without duplicating the terrain.

**What a headset leaves out.** The fog's end is as far as the eye sees. In a headset, a world
block wholly beyond it is not submitted. The flat screen keeps the weather's normal range and
relies on the same block bounds and camera frustum.

**View distance.** Should a headset not keep its frame rate, the option draws the view in: the
fog closes at 4000 ft (Medium) or 2500 ft (Short) instead of the weather's own range, keeping
its proportions, and everything beyond goes the way of the paragraph above. It never lets the
eye see further than the weather does, and the flat screen is not touched.

The enhanced look's shadows are four cascades drawn besides, and with Natural light
(`VISUALS.md`, "Light") the ground is drawn into them too; on a standalone headset the classic
look (the default) is the one to use. Of the port's newer scenery a headset takes the ground's
grain from above only and has no lens and no anti-aliasing pass (`VISUALS.md`, "Cost"). Sharpness and Edge detail trade picture for speed too.

## Not done, not known

- Not run on a physical headset by the author: frame rate, comfort, the size and place of the
  boards and the cab, and how the controllers feel are judged from an emulator's pictures.
  Likewise whether a headset's browser keeps the copy of the app and the installed game for as
  long as one would wish: both are in storage a browser may clear when it runs short of room
  (the install asks it not to).
- The emulator cannot make WebXR layers, so only the plain framebuffer path was exercised. The
  layers path is three.js's own and is what its applications use on a Quest.
- No hand tracking. No live mirror (the cab's mirror is its frame over dark glass), finder, map
  or pitboard.
- The cab's scale (`CAB_SCALE`), the comfort of bars this near the head, and how the pictures
  hung on its lower walls hold up as the head moves are judged from flat renders through the
  pictures' own camera, not in a headset. The shifter's lever is the frame art's, flat.
- The menus proper (Driver Check-in, Garage, Hall of Fame, Options) stay on the flat screen; the
  lobby covers what a race needs.
- A spectator's picture on the flat screen while a headset is worn.
