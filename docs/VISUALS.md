# OpenMTM2 scenery: the port's own

The game drew its world with what a 1998 software renderer could afford: ground in 32 ft
facets with textures of half a foot a texel, water as a flat animated texture, weather as a fog
table and a field of sprites, one white light.
`MONSTER_EXE_ANALYSIS.md` section 13 says exactly what it drew. This document specifies what the
port draws instead when the player turns the switches below on. None of it is the game's, and
none of it changes how a truck drives: the simulation is untouched.

## The switches

Each part is a setting of its own (`src/app/settings.js`), listed by `src/game/visuals.js`.
The Options screen's Display page sets them, under Enhanced graphics, with one preset (`src/game/graphics.js`): Auto,
Off, Low, High, Max or Custom. Off is the default and is the game's own picture: every part is
the player's to turn on. Auto picks Low, High or Max for this machine, again when the game
starts and when a race or a replay starts. Low keeps the water, puddles, snow, paint, lamps and rich dust, and turns off the
smoothed ground, volumetric weather, ground detail, natural light and the lens. High is every
part but the lens. Max is every part. Custom shows each switch; the other presets hide them.
A stored Off, Low, High, Max or Custom is kept, and a save that turned a part off before
presets existed is kept as Custom. Each setting stays off unless a preset or a switch turns it
on, and each off draws that part of the picture exactly as it was drawn before. A change
takes effect from the next race.

| Setting | Options name | Off draws |
|---|---|---|
| `terrainSmoothing` | Smooth terrain | the game's two triangles a cell |
| `enhancedWater` | Reflective water | the game's `RIPPL` frames on a flat plane, and its ice overlay in Snow (section 13) |
| `volumetricWeather` | Volumetric weather | linear distance fog and the game's precipitation sprites |
| `rainPuddles` | Rain puddles | dry-looking ground in Rain |
| `snowCover` | Snow cover | bare ground in Snow |
| `groundDetail` | Ground detail | the ground's textures from one atlas, unfiltered for the distance, with nothing finer than their texels |
| `naturalLight` | Natural light | a white sun and a white ambient light, shadows from models only, colours cut off at white |
| `glossyPaint` | Glossy paint | trucks lit as chalk is |
| `lensEffects` | Lens effects | the picture drawn straight to the screen |
| `truckLamps` | Truck lamps | each lamp's own bitmap as its lens and the game's fuzzy cone as its beam, tail lamps lit as the game lit them, and headlights that light the ground only in the weathers that light the lamps at the start; the start gantry's lamp bars filled with one flat colour |
| `richParticles` | Rich particles | the game's puff sprites for dust and smoke, points for drops and sparks, and a tread printed flat on the ground that fades after 70 s; tracks and dust follow the ground, not a bridge's deck |
| `replayEffects` | Replay effects | a replay with no dust, tracks or sparks, and no sun shadows |

Volumetric weather is a slider rather than a switch: None (off), Few, Default or Max. The
setting `weatherAmount` (1 to 3) holds the level while `volumetricWeather` is on, and the
level scales the fog's thickness and the share of it overhead by `FOG_AMOUNTS` in
`src/game/atmosphere.js` (0.3, 0.55 and 1). Max is the fog as the Weather section describes
it; the lower levels thin it, and the picture still fades out at the same distance. A preset
that turns the part on sets Default.

Volumetric weather also decides whether the light the port drew from the start (lamp lenses and
cones, sparks, the game's sprites added to the picture) is dimmed by the fog. Off, it shows
through the fog as it always did (`src/render/atmosphere.js` `setLightsInFog`).

They work in both looks, classic and enhanced, but for Natural light, which is the enhanced
look's: the classic look's ground is the game's baked brightness, which no light changes.
`src/render/scenery.js` makes the parts whose switch is on, for whichever screen draws a track
(the race and the replay).

What is the game's and what is the port's, in one place:

| | From the game (section 13) | The port's |
|---|---|---|
| Ground | the heights, the two triangles a cell | the smooth surface, the relief, the mesh |
| Water | its level, its bob, that Snow freezes it (its translucency by weather is not used: the water's depth decides) | wind waves, the sky and the land mirrored in it, the sun's glint, light through its depth, the bed, the view from under it, foam |
| Fog | each weather's colour and the distance its fog ends or its view is cut | the layer, where it lies, its banks, the sky's veil |
| Rain and snow | that they fall, and lightning in Rain | the fields, their speeds and sizes, splashes, the shelter of bridges |
| Ice | 0.94 opaque; snow spreads over 100 s, to half of it | how it looks, and that the snow ends over a seventh of it |
| Wet ground, puddles | nothing | all of it |
| Snow on the ground | nothing | all of it, on the game's 100 s clock |
| Ground textures | the tiles, which cell has which, and what ground each is (its `.TTY` type) | their filtering for the distance, the grain over them, the patches |
| Light | the level's sun direction, each weather's sky art, the moon drawn where the sun stands | the sun's colour and strength, the sky's and the ground's light, the ground's shadows, the curve |
| Horizon | the SIT's backdrop models, drawn behind the world | the haze they are seen through |
| Paint, glow | nothing | all of it |
| Lamps | which lamps a truck has and where, and when each is lit (switch, brakes, gear); when the start gantry's red and green bars are lit | how a lit lamp looks, the beam as light in the air, the tail lamps' running light, headlights on the ground in any weather, lamps that move with a dent, the gantry's lamps |
| Dust | the twelve frames of a puff, and when a tire raises one | the cloud it is drawn as, how it lies along the way, how dusty the ground is by its colour and the weather, its light, its colour |
| Spray, powder, chips, clods, sparks, bubbles | nothing drawn (it reads a tire track switch and never uses it; it throws spray blobs from wheels in water and in Rain) | all of it |
| Tracks | nothing | all of it |

## Terrain

### Two surfaces

The game's ground is a 256 x 256 grid of 32 ft cells with heights in 2 ft steps, each cell two
flat triangles (`MTM2_PHYSICS.md` 2.1). The simulation stands on exactly that, always. With
Smooth terrain the renderer draws a second surface, built from the first when the track loads
(`src/game/terrain-relief.js`):

    drawn = game + w * (round(smooth) - game) + w * detail

**`smooth`** curves each of the game's triangles. It keeps the game's own cut of each cell in
two, because that cut is often real: where a level floor meets a wall along a cell's diagonal,
the floor's triangle has to stay the floor. Each triangle becomes a cubic patch through its
three corners. At each corner the patch leaves along the ground's slope there, which is taken
along x and along z separately as the harmonic mean of the slopes on either side, and zero
where the two disagree in sign. No edge of a patch leaves the range of its two ends, and no
patch the range of its three corners. So:

- a flat triangle stays flat, to the last bit;
- an even incline stays its plane;
- nothing overshoots: a flat road beside a cliff does not dip or bulge;
- a step of one cell becomes an S.

**`round`** takes the edge off what that leaves. The patches meet along the cells' edges and
diagonals, and wherever the ground turns there (a ridge, the foot of a bank, the brow of a
hill) they meet at an angle, so every hill still had the outline of a thing cut from 32 ft
facets. The smooth surface is therefore averaged about each point: by a bell of weights (1, 6,
15, 20, 15, 6, 1 over 64) at points 4 ft apart along x and then along z, reaching 12 ft either
way (`ROUND`). Each such angle becomes a curve some 20 ft long, and flat or evenly sloping
ground is left exactly as it was, since the mean of a plane about a point is the plane there.
The mesh is cut on the same 4 ft spacing and rounds its own samples. A cell the rounding
cannot change (held to the game's, or one plane with every cell about it) is not worked out
at all.

**`detail`** is relief for ground too steep to drive on. No tire grips better than 1.0
(`MTM2_PHYSICS.md` 2.3), which holds a slope of 1 in 1 at the most, so detail begins at a slope
of 0.9 and reaches its first measure at 1.5; from 1.4 the ground counts as a cliff and takes
more, full at 2.4. The slope is that of the game's own triangles: a triangle a truck can drive
on gets none however steep its neighbours, and detail fades to nothing along the edge a steep
triangle shares with one that is not. The measure is 2.2 ft across the surface on a steep slope
and 4.8 ft on a cliff, at most 12 ft vertically.

Its shape is fractal noise read in space (at the point and its height, so a wall has the same
grain as a slope) folded into ridges, the widest some 160 ft across and the narrowest 20, plus
bands by height that show as ledges along the contours. Nothing in it is finer than about 20 ft,
because the mesh is cut every 4 ft at its finest and could not carry it. The noise repeats with
the world, so the ground joins itself across the wrap at 8192 ft.

The ground type of the cell's texture (`MTM2_PHYSICS.md` 2.3) scales it:

| Ground | Share of full detail |
|---|---|
| Rocks | 1 |
| Default, Dirt, Gravel | 0.8 |
| Grass | 0.6 |
| Mud | 0.55 |
| Sand | 0.35 |
| Ice, Snow | 0.3 |
| Cement, Metal, Wood, Water | none |

**`w`** holds the drawn ground to the game's where something stands on it:

- at the four corners of every cell that has a ground box (`.RA0` differs from `.RA1`);
- within a circle around every drawn object, as wide as its model reaches plus 6 ft, blending
  back to free ground over the next 26 ft (a model whose lowest point is 15 ft or more above
  the ground at its place stands on nothing and is left out; no circle is wider than 400 ft);
- around every ramp (box type 99), by its length and width;
- in a stadium, on and outside the footprint.

Along every course of the SIT (the primary one and Professional's) there is no detail, whatever
the course crosses: a point every 16 ft, clear within half the track's width (at least 24 ft)
plus 12 ft, blending back over 36 ft. The course is still smoothed.

### How far apart the two are

Measured on the fifteen stock tracks, on ground the game's triangles slope at 0.8 or less:

| | Along the course | Whole world |
|---|---|---|
| Median | 0 to 0.1 ft | 0 to 0.2 ft |
| 95th percentile | 0.2 to 0.6 ft | 0 to 1.7 ft |
| 99th percentile | 0.4 to 1.3 ft | 0 to 3.1 ft |

Hypercube Rumble and Torture Pit, which are built of steps, are the exceptions along their
courses: 1.4 and 0.85 ft at the 95th percentile, 2.1 and 2.2 ft at the 99th. What remains is
the S a one-cell step is drawn as, and the rounding of a crease, which at the crease lies off
the faces that meet in it by 1.9 ft for every unit their slopes differ by (a crease from level
to a slope of 1 in 4 is rounded off by under half a foot).

### Trucks on the drawn ground

A truck drawn at the simulation's pose would float over the drawn ground or sink into it by
that difference. `conformPose` moves the drawn truck instead. For each wheel it takes the
difference between the two surfaces under the hub; the body is lifted by the mean of the four
and each axle's travel and articulation take up its own wheels' remainder, so the drawn
suspension absorbs it and every tire stands on the ground the player sees. Rules:

- a wheel counts as on the ground when its tread is within 1 ft of the game's ground, fading to
  not at all at 5 ft, so a truck in the air or on a bridge, a ramp or a ground box is left alone;
- a wheel on ground steeper than 0.75 is moved less, and beyond 1.05 not at all: a truck there
  is sliding, not standing;
- no wheel is moved more than 2.5 ft;
- in Snow a wheel over ground below the water level is on the ice (`MTM2_PHYSICS.md` 2.1),
  which is level, and is left alone.

Everything that follows a truck (the cameras, the headset's seat, the sound) follows the moved
pose, and everything that follows the ground (the chase camera's clearance, dust, spray, the
track lights' pools) follows the drawn ground. What is laid flat on the ground follows its mesh
("Read back off the mesh" below).

### The mesh

`src/worker/relief-mesh.js` cuts each cell as finely as its ground needs. The drawn surface is
sampled every 4 ft across the cell, and the cell's side is cut in 1, 2, 4 or 8 parts: the
coarsest cut that stays within a tolerance of the samples. A cell where the drawn surface is
the game's stays the game's two triangles.

How far a cut may stand off the surface goes by how far off it is seen, since what the eye
sees of it is an angle. The cameras are on the course, so a cell is taken to be seen from as
far as it lies from the nearest point of any course of the SIT (the primary one and
Professional's), and from no nearer than 60 ft (`viewDistances`): a cell beside the course may
stand off by the tolerance, one 600 ft off by ten times it, which is the same on the screen.
The tolerance is the tightest of 0.1 to 2.5 ft whose mesh fits a budget of 900 000 vertices,
counted exactly; a level too rough even for the loosest is cut no finer than it can afford.

With one tolerance for the whole world, a rough level spent its budget on hillsides no camera
comes near. Voodoo Island was cut to 2.5 ft everywhere, no part finer than 8 ft, and wherever
its ground had been rounded by less than 2.5 ft it was drawn as the game's own two triangles:
the rounding was lost and the hills kept their facets. Now every stock track is cut to 0.1 ft
along its course but Voodoo Island, at 0.33 ft. The stock tracks come to between 0.3 and 0.8
million vertices (the two arenas far fewer), and building the drawn ground and its maps adds
0.5 to 1.9 s to a track's load.

Two cells share an edge, and the edge is cut as finely as the finer of them wants. Each cell
has a lattice of its own inside, joined to the points along each edge by a strip of triangles,
so a coarse cell beside a fine one meets it point for point. A point's height and normal depend
only on where it is, so the two cells agree to the last bit and there are no cracks.

The mesh comes at two levels of detail in chunks of 64 x 64 cells. The fine level is the above.
The coarse level has every cell's inside as two triangles, with the edges that lie on a chunk's
border cut as the fine level cuts them, so a fine chunk and a coarse one meet without a crack.
The renderer draws a chunk fine when its nearest edge is within 2400 ft of the camera (800 ft in
a headset), with 160 ft of play so a chunk at that range does not switch back and forth. At
2400 ft the relief's 5 ft is two pixels of a 1080 line picture and the haze has taken a third
of it ("How far the eye sees" below).

**Read back off the mesh.** The mesh is the drawn surface cut into triangles within a
tolerance, so it is not the surface: along Voodoo Island's course the mesh may lie a third of
a foot over the surface, and as far under it elsewhere, and further from the course more. A
truck's wheel can be seated on the surface and be that far off the mesh unnoticed. A tire's track cannot: laid a few inches under the mesh it is
not seen at all, and a few inches over it floats. `src/game/drawn-ground.js` therefore reads
the fine level's own triangles: the height of the triangle drawn at a place, and the depth of
settled snow the mesh has there, which is what the renderer lifts the ground by. A cell's
triangles are a run of the mesh's list, so a place is found by its cell and at most a hundred
or so triangles. What lies on the ground this way is drawn only as far as the fine level is.

Textures are the plain mesh's: a cell's tile is spread over the cell however it is cut. The
baked brightness of the classic look (the `.LTE`) is interpolated from the cell's corners, and
within a rough cell it is scaled by how the relief faces the level's sun against how the
corners do, so the classic look shows the relief too.

## Ground

`src/game/ground-detail.js` has the rules, `src/render/ground-detail.js` the shader, with
"Ground detail". The game's ground textures are 64 texels across a 32 ft cell: half a foot a
texel. A camera a few yards off shows that as a blur, and the game drew them unfiltered for
the distance, where they shimmer and show their repeats.

**A stack of tiles.** The asset worker packs the tiles into one atlas. In an atlas a tile's
neighbours are other tiles, so it cannot be shrunk for the distance without their colours
running in. The renderer cuts the atlas into a stack of textures, one layer a tile, which has
no neighbours: each tile is filtered down for the distance (its own chain of smaller copies)
and across a slant (16 samples, or what the card has) by itself. A cell's place in the stack
and in its tile is worked out from the same texture coordinates the mesh always had. A card
that cannot hold a layer a tile keeps the atlas and still takes what follows.

**Mipmapped without it.** The stack is not only "Ground detail"'s: with that switch off, in
either picture (the game's own look and the enhanced one), the ground still reads its tiles
from the stack (`createGroundTiles`), with nothing over them, so far ground is filtered down
and stops shimmering. Close up the game's look keeps its square texels. A level with no atlas
layout (another game's) keeps its atlas. The game's own water sheet, repeated 256 times over
the level, is mipmapped too (`src/render/water-effects.js`).

**Grain.** A field of clods and grit of the port's own (`detailNoise`,
`src/render/noise-textures.js`) is laid over the tiles at two scales. Each makes the ground
lighter and darker by its height, and by how its slopes face the sun, as much as the weather's
sun allows:

| | One repeat | Fades out |
|---|---|---|
| Fine | 7 ft, features of inches | from 40 ft to 170 ft |
| Coarse | 43 ft, lumps of a few feet | from 300 ft to 1100 ft |

Both repeat a whole number of times across the world, so the grain joins at the wrap. The
grain never takes the ground below 0.42 of its colour nor above 1.75.

How much grain a piece of ground takes follows what it is, which the game says: the `.TTY`
type of the cell's texture (`MTM2_PHYSICS.md` 2.3):

| Ground | Share of the grain |
|---|---|
| Rocks | 1 |
| Default, Dirt, Gravel | 0.85 |
| Grass | 0.7 |
| Mud | 0.6 |
| Sand | 0.5 |
| Snow, Ice, Cement | 0.3 |
| Wood | 0.25 |
| Metal | 0.2 |
| Water | none |

**Cliffs.** The mesh spreads a cell's tile over the cell as seen from above, so on a cliff the
tile is seen edge on and its texels smear down the face. Where the ground's normal is under
0.82 high the tile begins to give its colour only (the tile read three levels further down its
chain, which is the tile run together), fully so under 0.5, and the grain is read from the
side instead of from above and gives the face its structure, half as strong again. Beds of
rock along the contours are the same grain drawn out level.

**Patches.** A tile repeated to the horizon shows its repeats. Three fields of broad noise
(2048, 630 and 174 ft across, repeating with the world) move the ground's brightness by about
0.15 either way, and between 500 and 2600 ft from the eye a tile gives up three quarters of
its own picture for its colour, since far off that picture is what shows it repeating; the
patches grow to twice as strong there.

**In a headset** the grain is read from above only, and the beds are left out.

The ground in the weather (wet, puddled, under snow) is added to the same material and sees
the ground's colour after all this. `src/render/shader-hooks.js` keeps the list of what each
part adds to a material's shader, in a set order, since three.js gives a material one hook.

## Water

`src/render/water-surface.js`. The game's water is a flat plane at the level's water height
that bobs a quarter foot every eight seconds and is solid in Snow (`MTM2_PHYSICS.md` 2.4). The
port keeps the plane, its level and its bob, and draws it with a shader of its own:

- **Waves.** Wind waves, worked out as waves on water run ("Waves" below) and laid over the
  water at four sizes, in gusts that run with the wind. They lie down in the shallows. Before,
  the surface was three fields of noise sliding across each other at one speed, as steep as a
  rough sea, and flattened with distance where they would only shimmer.
- **Rough water far off.** Where the water is too far off for its waves to be drawn, their slope
  becomes roughness: the field's pictures are filtered as they shrink, and what a point loses of
  its slope (the mean of the slopes' squares less the square of their mean) is how rough the
  water is there. Below the smallest waves the water has a roughness of its own, a mean square
  slope of 0.004 over both axes, more in a gust and less between gusts. Roughness blurs what the
  water mirrors and spreads the sun's glint, as unseen ripples do.
- **The sky in it.** How much the water mirrors grows as the eye looks along it (Fresnel, 2 % from
  straight above). What it mirrors is the level's own sky art, read where a ray off the surface
  would meet the sky dome, so Dusk's water is orange and Rain's is the storm, but never the
  art's last rows, which are the horizon's own line of haze (a pale strip in the Dusk art): a
  hand's breadth above it. It is blurred as much as the water is rough: a reflection spreads by
  twice the slopes' spread along an axis. Fog veils the mirrored sky as it veils the sky
  itself, and in the dark weathers their darkness veils its horizon as it veils the backdrop.
  The fog's veil over the sky depends on the eye alone, and is worked out once a frame.
- **The land in it.** The hills stand upside down in the water, as a level mirror shows them,
  broken up and drawn out by the waves ("The land in it" below). Before, the water mirrored the
  sky alone, and stood bright under a dark cliff.
- **The sun's glint** (Cox and Munk). The share of the water's facets, too small to draw, that are
  tipped to send the sun to the eye, by how the slopes about the point's own spread (the
  roughness), times what water sends back of the sun at that angle, over the eye's slant to the
  water and the facet's tilt (`WATER_GLINT`). Near, where the waves are drawn and the roughness
  is small, the glints are sparks on the faces of the waves; far off they run together into a
  path toward the sun, long and low at Dusk. The eye's slant is taken as no flatter than a sine
  of 0.15, and the glint as no brighter than 1.2 times the sun's own light on a face square to
  it: the sun mirrored is far brighter, and past that the lens would only spread it into a
  blaze. Before, the glint was two fixed lobes about the mirrored line, as sharp far off as near.
- **Shadows.** With the enhanced look's sun shadows the water reads the same cascades as the
  ground (`sunReaches`, the finest one that covers the point), at four points of its map weighed
  between them: where the hills or anything standing shade it, it loses the sun's share of the
  daylight it sends back and the sun's glint, and keeps what it mirrors of the sky, as water in
  a shadow does. Before, it read three.js's soft shadows, sixteen points in each of the four
  maps, which cost the water more than all the rest of it.
- **A body of water.** How deep the water is at a point is its level less the ground under it,
  read from the ground map (below), and what the eye sees there is light that has come through
  that depth (`src/game/water.js`). The line of sight bends toward the upright at the surface,
  so it runs through the depth over the sine of its own angle in the water: straight down the
  depth itself, glancing about one and a half times it. Along it the water takes the bed's
  light, red first: a foot takes 34 % of red, 11 % of green and 8 % of blue (pond water, far
  murkier than the sea), so a foot of water hides a sixth of the bed, a truck's depth more than
  half and 30 ft nearly all of it. And the water gives light of its own, the daylight that fell into
  it and is scattered back, in the water's blue green, 0.004 of red, 0.035 of green and 0.041 of
  blue, as lake and coastal water send back: as bright as the scene's own sun, sky and ground
  light make it, so it is bright at noon, dull under cloud, dim orange at Dusk and nothing in
  Pitch Black, where deep water is black and not clear. Deep water is dark, and the sky and the
  land it mirrors show in it. Before, it sent back three times as much, and deep water was an
  opaque pale teal that hid what it mirrored. What the eye sees is what the surface mirrors, as
  much as it mirrors, and of the rest the water's own light, as much as its depth hides of the
  bed, over the bed itself. In Rain the water is stirred and silted, 0.45 of the way to a dull
  grey green. The game's translucency for the weather (0.75 in the clear to 0.0625 in Pitch
  Black), which let the bed show through deep water in the dark, is not used: the depth decides
  how much is seen.
- **The bed.** The ground under the water is drawn as seen through it: its light has come down
  through the water over it, so it darkens and blues with depth. What comes back up from it to
  an eye over the water passes through the water too, along the eye's line bent at the surface:
  the water's opacity takes how much of it, and the bed takes the colour that leaves, its red the
  first to go, so that a sandy shallow is green under a little water and blue under more. In the
  shallows, down to 9 ft, light dances on it, up to 0.6 brighter and 0.4 darker, drawn together
  and apart by the waves; under ice it is still. Ground within 0.7 ft over the waterline is wet
  from it, 0.28 darker.
- **The shore.** Where the water is under about half a foot deep it carries foam that laps in
  and out, as a lace, broken and thin, and its edge fades out onto the ground instead of ending
  in a line. Before, the foam was a white line round every shore.
- **Rain** rings the surface.
- **Wakes and rings.** The trucks stir the water ("Ripples and wakes" below): a truck that runs
  through it drags a V of waves and a trail of foam behind it, one that stops sends out a
  ring, and a wheel that comes down into it throws a ring out from where it struck.
- **Ice.** In Snow the surface is level and hard, at the game's 0.94 opacity, with a blurred
  sky in it ("Ice" below).
- **From below** it is a window and a mirror: within 48.6 degrees of straight up the sky is
  seen through it, bent and ruffled (Snell's window), and outside that the surface mirrors the
  water under it ("Under water" below).

It needs no second view of the scene and no picture of what lies behind it: one pass over the
water, and for the land in it a small pass a frame over the map of the ground, the same size on
any screen, which a headset can afford. The open water and the ice are two programs, the planes
wearing one or the other; in one, the ice's many lines made the open water cost nearly twice as
much, though it never ran them.

### Waves

`src/game/water-waves.js`. A field of wind waves, worked out once, as waves on water are, and
kept as 32 pictures of a square of 128 points that repeats every way, in a loop (a 3D texture,
filtered between pictures and mipmapped). It is the sum of every wave that fits a whole number
of times across the square, from 4.2 to 34 times, each of a random height and phase:

- as high as the wind's waves are, each octave holding as much slope as the next (a height
  falling as the fourth power of the number across), shaded in and out over the band's ends so
  that sizes of the square 2.8 apart add up to one even spread of waves;
- mostly running with the wind, less across it and none into it (the cosine of half the angle
  off the wind, to the sixth power): 96 % of it runs downwind, and its slope is the steeper
  along the wind, so the crests run across it;
- each at deep water's pace, its frequency the square root of g times its wavenumber, so a
  longer wave runs faster: the field changes as it moves and nothing slides. In a loop each wave
  comes round a whole number of times, the longest twice and a shorter one up to six times, as
  its frequency has it to the nearest whole turn.

Each picture holds every point's slope along both axes, its height and the square of its slope.
Its slope's root mean square is 0.1 along an axis. Working it out takes about a seventh of a
second, once.

It is laid over the water at four sizes, 120, 42, 15 and 5.3 ft, so that their waves meet end to
end, from two inches to 28 ft long, each turned a little off the wind and laid at 0.66, 0.6,
0.54 and 0.45 of the field's slope. Each comes round its loop as deep water's waves would at its
size: in 4.7, 2.8, 1.7 and 1.0 s. The smallest is drawn only within 180 ft of the eye, fading out
over the last third of that; past it, its slope is roughness.

The wind blows the way the fog drifts, and gusts: patches one or two hundred feet across run
with it at 6 ft/s. In a gust the shorter waves rise at once, to 1.45 of their strength, and between
gusts they lie down to 0.25; the longest follow as the square root of that, and the roughness
below the field as its square, so between gusts the water is glassy and mirrors cleanly. Each
weather has its wind against a clear day's: 1.1 Cloudy, 0.45 Foggy and 0.35 Dense Fog (fog lies
on still air), 1.35 Rain, 0.8 Dusk, 0.75 Night and Pitch Black. In Snow the water is ice.

### The land in it

`src/render/water-reflection.js`; the rules are `src/game/water.js` `WATER_REFLECTION`,
`highestGround` and `landTones`. A level mirror shows the eye what an eye as far under the water
as it is over it would see of the land above the water. Before each frame is drawn, a pass works
that picture out as a map of directions from that eye under the water: 512 columns round the
horizon and 128 rows from it to straight up, the rows by the square root of the sine of the
elevation, so that the few degrees over the horizon where the land in the water lies have most
of them (five degrees, a quarter of the rows).

For each, the line is followed from where it comes up through the water to the first ground it
meets, over the ground map ("The ground map" below), a cell at a time over the highest ground in
the cells it crosses, from 32 ft (the terrain's own) to 512 ft: where it enters a cell over all
the ground in it, it runs on to where it leaves the cell (it only climbs) and tries the next size
up; where it does not, the next size down; in a 32 ft cell it does not clear, against the ground
itself, in steps of 8 ft or 1.2 % of how far it has run, whichever is longer. A cell holds the
highest of its samples and of a row round them, since the ground between samples is drawn from
the four about it. On Voodoo Island a line reads 18 times on average, a line over open water
fewer and one that meets a hill more; it reads 64 times at the most.

The ground it meets is lit as the scene lights it: the mean colour of the texture its cell wears
(by the cell's `.CLR` word), the sky's light, and the sun's as its slope faces the sun. It is
hazed by how far the light has come from it to the eye, which is as far as from the eye under
the water: by the haze's even thickness and the far fade.

The water reads the map along each point's own line off its waves, blurred as much as the water
is rough: so the hills stand upside down in it, whole where the water is calm, broken up where
it is rough and drawn out toward the eye where it is rough far off.

The map depends on where the eye is and not where it looks. An eye that has not moved, under the
same light, keeps it as it was (a paused race, a still camera); one that moves works out half
its columns each frame, in blocks of sixteen, so that each is a frame old at most; a jump of
more than 30 ft, or a change of the light, works it all out. It draws nothing of the scene and
reads nothing back, it is the same size on any screen, and one serves both eyes of a headset.
What stands on the ground (trees, buildings, the trucks) is not in it, and there is none with
the eye under the water or the water frozen.

Every copy of the wrapped world has its own water plane. The game's surface used to be given
only to the first, and only the first bobbed; both surfaces now cover all nine.

### Ripples and wakes

`src/game/water.js` `WATER_RIPPLES` has the rules, `src/render/water-ripples.js` the field. The
water's own waves are noise that knows nothing of the trucks; these are the trucks' doing. The
puddles of Rain share the field ("Rain on the ground", "Driving through a puddle").

The water about the eye is a field of waves, 512 points square, one every 0.6 ft (307 ft across),
kept round the eye and shifted by whole points as it moves, so what comes into it is calm and
what leaves it is gone. It runs on the graphics card in steps of a sixtieth of a second, at most
four a frame, by the wave equation. A wave runs as on shallow water, `sqrt(g d)` over water `d`
deep (`waveSpeed`), but no faster than 12 ft/s: so it slows in the shallows, which bends it
toward the shore, and the shore throws it back. A truck at speed outruns its own waves, and its
wake is a V. The waves die away by 1/e in 1.8 s, and toward the field's edges, so nothing is
thrown back from them. Shallow water cannot hold a crest much higher than it is deep (a
puddle's, or the level's water at its shore): a crest over 0.35 of the depth starts to break,
and from 0.7 of it spends itself by 1/e in 0.12 s (`waveAfter`); nor can the water fall further
than 1.2 times its depth below its rest, so a trough bares the bed and goes no lower, and the
water running back in fills it as any wave moves.

The field is moved with the eye as it steps. In a frame too short for a step, and while a race
is paused, it stays where it was, and so does the corner the shaders that read it are given.
Before, that corner followed the eye every frame while the field moved only when it stepped:
every frame without a step left the water out of place by as far as the eye had moved, for good.
Wakes, foam and churned silt were drawn tens of feet from the wheels that made them, most of it
on dry ground where none of it showed, and on a screen faster than 60 frames a second hardly
anywhere near them. A wheel stirs the water all along its way since the field last stepped, not
only where it is, so its wake is whole however far apart frames come; a wheel that has only now
come to the water, or went further than 30 ft (it was moved), stirs where it is. Before, a fast
truck's wake broke into a row of dots wherever a frame took longer than a sixtieth of a second.

- **A wheel at the surface** (`wheelStir`) holds the water down over 1.8 ft about it, by 0.12 ft
  standing and 0.025 ft more for every foot a second it moves, 0.9 ft at the most. It churns as
  it goes, its hold rising and falling two and a half times a second, so it sends out a train of
  waves and not one. A wheel clear of the water does nothing, nor does one more than a foot and
  a half under it past where it counts as under the water (`SUBMERGED_FT`, "Particles"), and
  between the two it stirs the surface less the deeper it is.
- **A wheel that comes down into the water** (`landingStir`) at 5 ft/s or more pushes it down at
  once over 3 ft, by 0.06 ft for every foot a second it fell, 2.5 ft at the most, and a ring
  runs out from where it struck.
- **Foam.** A turning tire beats the water white (`wheelStir`, `WHEEL_CHURN`): from 3 ft/s of
  its tread, all it can from 25 ft/s (17 mph), over 1.2 times the tire's radius about it, its width
  and the white water off it; and so does a wheel striking the water, over 4 ft. The tread runs
  as fast as the simulation turns the wheel and never slower than the wheel goes, so a wheel the
  engine spins in the air churns as it comes down. Fresh foam thicker than 0.45 of all the field
  holds collapses, halving every 1.2 s; foam thinner than 0.12 lingers, halving every 8 s; between
  the two, between the two. So a wake is whitewater for a second or two, broken patches for a
  few seconds more, and a lace for many after. Foam spreads a little, which widens a wake as it
  ages. Before, a wheel churned only from 6 ft/s of its hub, fully from 36, over 1.8 ft, and its
  foam halved every 2.2 s whatever its thickness: a grey lace that was soon gone.
- **Silt.** A wheel in the water at all, deep under it or not, stirs the bed's silt up into it:
  from 1 ft/s of its tread, all it can from 15 ft/s; a wheel striking the water, as hard as it
  struck. Silt spreads further than foam and halves every 14 s.

The water's shader reads the field's slope into the surface's, 1.4 times as steep, and its
foam; churned water is rough as well, with a mean square slope of 0.05 for full foam, so what it
mirrors is blurred and its glints spread, as whitewater's are. Before, the field's slope was
taken 2.4 times as steep and churned water was a clean mirror, which against the calmer waves
read as broken glass. The foam is drawn as it ages: as much of the water is covered as there is
foam, in clots a few feet across and bubbles a few inches across that churn as they go, heaped on
the crests of the wake's own waves, so fresh foam is whitewater all over and older foam breaks
into ragged patches; thin, it is a lace. It is as white as the day lights it, greyer in its
hollows. Under it the water beaten full of air is milky and pale, a white green that hides some
of the bed. Silt clouds the water in the ground's colour made paler (fine silt held in the water
scatters more light than the wet bed it came off), and hides the bed, all of it from not half of
all the field holds, where the water is under 4 ft deep, and less to none by 14 ft, where the
cloud stays down by the bed. The ground's reads the field in its puddles, its foam as their silt
and froth. The field runs only while there is water to run on (the level's, not frozen,
or puddles with water in them), and is stepped just before each frame is drawn by as much time
as the frame's wheels were stirred for, so it stands still while a race is paused. A replay
stirs the water as the race did. In Snow the water is ice, and with no puddles the field is
calm.

### Ice

`src/game/ice.js` has the measures. The ice is dark where water lies under it and pale where it
is frozen to the bed, by the same depth the water reads, a shade lighter or darker in broad
patches, and it is not one sheet (`ICE`):

- **Cracks.** Three fields of them, one over another, none of them even:
  - long cracks, the edges of floes some 70 ft across, seven in ten of them showing, so a crack
    runs on past where two floes meet, or ends there;
  - plates some 13 ft across, of whose cracks three in ten show where the ice is whole and nine
    in ten where it is broken up, the two in patches some 240 ft across;
  - hairlines some 4 ft apart, about half of them, in patches of their own.

  The cells of each field are pushed about by up to 0.45 of their width, so no two plates are of
  a size or a shape, and two plates whose crack is not shown are one. Each crack is its own: as
  wide, as deep and as bright as up to half again or half less than its field's measure. Far
  off the cracks thin out, where they would only shimmer. Before, every plate was about the same
  size, every crack between two plates showed, and all of them were alike: a honeycomb.
- **A crack** (`crackPlane`) is a bright line where it meets the surface, and under it the
  crack's own face, a plane running straight down: 0.9 ft for a plate's, a quarter foot for a
  hairline, 1.6 ft for a floe's. The face is seen through the ice where the eye's line meets it,
  and the ice bends that line nearer the upright (0.75 ft aside for a foot down, when the line of
  sight runs a foot along for a foot down; the line is taken as running down no less than 0.3 of
  its length). So a crack looked at straight down, or along its length, is a line, and one
  looked at across is a silvery band on the near side of its line, as wide as the eye's line
  moves over the crack's depth, brightest near the top and gone at its foot. Before, a crack was
  the same line drawn three times at three depths.
- **In it.** Milky patches a hundred feet across, and swarms of bubbles a little way down.
- **On it.** Snow gathers in drifts that the wind has drawn out, first along the shore, on the
  clock below, and ends covering a seventh of it: the tops of the drifts and a fringe along the
  shore. The game's ice overlay ends half opaque over all of it, but snow over half the ice hid
  the ice, which is worth seeing; a few drifts show it off.

**Stars.** Where a truck comes down hard on the ice it stars: seven to eleven cracks run out
from the blow, each as far as it got, and the middle is crushed white and swept clear of snow.
They are cracks as the ice's own are, a line and a face under it, and they break the ice as ice
breaks, no two stars alike (`ICE_STARS`):

- each crack leaves the blow up to 0.42 of the gap between two cracks either side of where an
  even star would have it, reaches from 0.3 of the star's reach to all of it, and the star is
  lopsided: on one side of it its cracks reach up to 0.4 less far than on the other;
- each crack runs out in three straight pieces of uneven lengths, turning by up to a quarter of
  a radian where one meets the next, ragged by up to 0.07 ft either side along its length (and
  not at its ends, where it meets the next), and six in ten of them fork once, the fork turning
  0.3 to 0.75 radians off and running 0.3 to 0.75 of the way the crack has left to go;
- on two rings, at about 0.3 and 0.6 of the reach, a gap between two cracks is joined across by
  a straight crack from one to the other, a little over half the time, each join at its own
  distance (up to 0.45 of that nearer or further) and slanting; a join ends on the cracks it
  joins, and never crosses them;
- a fresh crack runs 1.2 ft down, deeper than the plates' old ones, and its face throws back
  more in some places than others;
- the pieces the cracks cut are each tipped their own way, by up to 0.045 radians, so each
  throws the sky back a little differently;
- the crushed middle is ragged, not round, and is shards a few inches across, each tipped its
  own way, with fine cracks between them; round it water wells up, darker and wetter, out to
  2.4 times the crushed width.

Before, the cracks of a star were evenly spaced and straight between their turns, and the
joins lay on two even rings.

| | |
|---|---|
| A wheel or hull point landing slower than 7 ft/s | leaves no star |
| At 7 ft/s | cracks reach 3.5 ft |
| From 45 ft/s | cracks reach 20 ft |
| The cracks run out | all but a third of the way in 0.22 s |
| A blow within 2.5 ft of a star | widens that star, if it is the harder |

A star is a wheel that has been off the ice for 0.18 s or more coming down on it, or a point of
a truck's hull coming down on it (`ICE_HULL`: within 0.4 ft of it after being further), as hard
as it came down (with "Rich particles", which is what watches the wheels and the hull). The ice
is as solid after as before: stars change nothing a truck drives on. A thaw heals them.

**Dragged.** A truck's body that stays down on the ice while it moves (on its roof, on its side)
does not star it again and again: it scores it (`ICE_SCRAPES`). The band is as wide as what of
the body is down, across the way it goes (0.3 ft more either side of the outermost point down,
and from 0.6 to 5 ft either side of its middle), white with fine scratches along the way the body
went, each running for a stretch of its own, scored harder where the body bore down harder and
hardest along its two edges, which dig in, to a ragged edge; scored ice throws back less of the
sky, and that blurred, and the band sweeps the snow on the ice away. Off its edges, at a place
every 3.5 ft along it, 45 in a hundred of the places have a short crack that runs out and back
from the band, 0.7 to 1.25 radians off the way the body came, 0.7 to 2.6 ft long, turning once,
0.8 ft deep. The band is laid a piece at a time as the body goes, one when the middle of what is
down has gone 1.5 ft, and drawn on instead while the body goes straight (each place it has
passed within 0.4 ft of the line), up to 16 ft; a jump of more than 10 ft begins it again.
Before, a hull that stayed down on the ice counted as a blow of its contact's force over 60 ft/s
every frame, and the contact's force is the weight it bears: a truck that slid on its roof laid
a star of the greatest reach every 2.5 ft. A hull scraping the ice throws chips and powder off
it, as off ice ground; before, the ice was not ground to it, and it threw sparks and smoke as
off a wall.

**How many.** The ice keeps 1024 marks, stars and the pieces of scored bands alike, for good:
when it holds all it can, the oldest makes way (`ICE_MARKS`). Each is drawn wherever it is. For
the graphics card the ice is cut into cells 32 ft across, 64 by 64 of them laid over the world
again and again (two places 2048 ft apart share a cell), and each cell lists the marks that
reach into it, oldest first, at most 16: one more there makes the oldest there make way, from
every cell it is in. A point of the ice reads its own cell's list and looks only at those marks,
so drawing the ice costs the same however many marks it holds, and no more than 16 where they
lie thickest. The marks and the lists are two small pictures of numbers, 32 KB and 256 KB, sent
to the graphics card when they change: each frame while a star's cracks run, and when a mark is
made, widened, drawn on past its cells, or makes way. Before, the ice kept 256 stars and drew
the 32 nearest the eye, every point of it looking at all 32, and a star that went out of the 32
faded out.

### Under water

With the eye under the water (`src/game/water.js` `UNDERWATER`), the scene's fog is the
water's: the eye sees 170 ft at the most, through water of the colour its depth sends back as
the day lights it, so it is blue green by day and black at night. The game's own underwater fog
is 320 ft in the weather's fog colour, which is what is drawn with the switch off. On the flat
screen the lens takes the red out of the picture (to half, against 0.86 of green and 0.95 of
blue) and darkens its corners further. It does not make the picture sway: a wobble over the
whole view was more tiring than it was like water. The surface overhead is Snell's window: the sky in a cone of 48.6 degrees
about straight up, and outside it a mirror of the water.

The water darkens with the eye's depth, and its red goes first: the light that lights the water
about the eye has come down through it (`lightAtDepth`, through 0.6 of the water over the eye, as
water takes light). Three feet down its red is at half and its green at four fifths; ten feet
down its red is all but gone and its green and blue at a half to two thirds. Before, the water was
one colour at any depth.

What fills the water about the eye (`src/render/underwater.js`, `UNDERWATER_LOOK`), only while it
is under the level's water:

- *Motes.* 4000 specks of silt, 0.035 to 0.1 ft across, in a box 56 ft across that goes with the
  eye, a mote coming round on its far side as it leaves the near one. They drift with the water
  at 0.3 ft/s and sway a little, and fade out from 13 ft away to nothing at 26, so the box's edge
  is never seen. They are lit as the water about them is, 1.8 times as bright and a little paler.
  They show the eye how it moves through the water.
- *Shafts.* By day the sun comes down through the waves in 90 shafts, 0.6 to 3.5 ft wide and 48 ft
  long, standing in a square 110 ft across that goes with the eye as the motes' box does. Each
  slants the way the surface bends the sunlight (`sunUnderWater`: straight down with the sun
  overhead, never more than 48.6 degrees from it), carries a twenty-fifth of the sun's light coming
  into the water, fades in under the surface and out by 1/e every 14 ft down, and brightens and
  dims as the waves over it gather the light and spread it. They are added to what is behind
  them, and what stands in front hides them. Only where the weather shows the sun clearly (Clear
  fully, none in Rain, Fog, Snow or at night), and none through ice.

Both are worked out on the graphics card about the eye that draws them, so each eye of a headset
has its own, and they cost nothing measurable on the Intel HD Graphics 630 ("Cost").

### The ground map

`src/game/ground-maps.js` `buildGroundMap`: the drawn ground's height at 1024 x 1024 samples
over the world, one every 8 ft, built by the asset worker when the water or the weather wants
it. The renderer keeps it as a texture of half floats against the water level, so it is finest
at the shore (`src/render/ground-textures.js`). The water reads its depth from it; rain and snow
read where to stop.

## Weather

### Fog

`src/game/atmosphere.js` has the numbers, `src/game/fog-floor.js` where the fog lies and
`src/render/atmosphere.js` the shader.

The game's fog is a ramp over distance, the same at every height and wherever the eye is. The
port's is a layer on the land. It lies on a floor (below), is at its full thickness up to a deck
over that floor, and thins above the deck by a scale height *H*; Foggy has a top as a cloud has
("The top" below). A fragment is fogged by how much of the layer lies along the line from the
eye to it, summed in closed form (`fogColumn`): a line under the layer's top passes all of it,
one over the top passes it thinned as the layer thins there, and a line that climbs or falls
through the top passes the sum of the two.

    hidden = 1 - exp(-density * (feet of fog along the line))

So a hill top stands out of the fog, a valley seen from above is a sea of it, and the sky
clears overhead as the eye climbs. Nothing in the fog depends on where the eye is but what is
seen from there: the floor and the banks are places in the world, and the banks move only with
the wind. (The layer used to lie on the ground under the eye, 3 s behind it, with its grain tied
to the eye as well: a truck climbing a hill took the fog up with it, and at speed the fog flew
past.)

**Where the fog lies.** The floor is a map of heights over the world, 64 x 64 samples 128 ft
apart, far smoother than the ground, built with the track (`buildFogFloor`):

- Along the course it is the course's own height averaged along the course, over 1400 ft of it
  (round the join, on a circuit). A crest the trucks are over in a few seconds stands above
  that average, and they come out of the fog on it. A stretch that stays high for longer
  carries the average up with it: a road along a ridge is in the fog, though the valleys either
  side lie far below.
- Fog lies level, as water does, and fills what lies below it. Away from the course the floor
  is the course's level run on out over the land, every point of the course counting by how
  near it is, so the floor has no seams: a valley or a bay beside the course is full of fog up
  to the course's own level, a sea of cloud seen from a crest, and land higher than that stands
  up out of it, clear. Before, the land far off kept a film of fog of its own lie, a thin one
  in the valleys, which from over the fog looked like a grey filter over the ground, and over
  the hills, which looked like flat grey copies of the hills against a clear sky.
- A track without a course has the land's lie alone: each place's ground averaged over 640 ft
  either way, and taken 0.35 of the way from that mean toward the lowest ground there, since fog
  gathers low. A peak some 1400 ft across stands out of it; a massif twice that lifts the fog
  with it.

The renderer keeps the floor as a texture of half floats that repeats with the world.

**How thick.** The density is set from the game's own distances, so a race is as hard to see
through as the game makes it:

| Weather | The game | The port's layer |
|---|---|---|
| Foggy, Dense Fog, Snow | a ramp from the eye to 320, 128 and 512 ft | hides half at half that distance; its banks are told apart out to 2.5 times it, by when the fog by itself hides 97 % |
| Rain | no fog; the view is cut at 1024 ft | a haze that hides half at 662 ft and ends at the cut |
| Clear, Cloudy | no fog; the port fades the distance out | a haze that hides half at six tenths of the way to where the picture ends, and fades the ground out from half way |
| Dusk, Night, Pitch Black | no fog; the view is cut | unchanged: their darkness is not fog |

Dense Fog and Snow are faded out wholly from 1.9 to 2.5 times the game's distance, where the
fog by itself has already hidden more than nine parts in ten, so nothing comes out of the
fade's edge. (The fade used to run from the game's distance to 1.5 times it, where the fog by
itself hid only seven parts in eight: a tree or a truck was seen to come out of the fade as it
crossed it, and things seemed to pop into the picture.) Foggy has a top: from over it the land
is seen as far as on a clear day, and only the fog along each line of sight hides it, so
Foggy has no edge of its own; the picture fades out as a clear day's does. (It faded out at
800 ft instead, wholly, at a wall: the weather passed the game's own 320 ft fog for the clear
day's distance. Everything past 800 ft was the fog's flat grey, cut to its own outline.)

The picture ends at 7000 ft (or nine tenths of the Draw distance, if that is less): the world
repeats every 8192 ft, and the haze is what makes that end a distance and not an edge. On a
clear day a hill 1000 ft off is 15 % in the haze and the trucks about the player are clear of
it. Under a stadium's roof there is no day's haze: a tenth of it.

Under water the fog is the water's ("Under water" above).

| Weather | Deck | Scale height | Drift | Wind | Sky's depth overhead | Glow toward the sun |
|---|---|---|---|---|---|---|
| Clear | none | 1400 ft | 0.18 | 4 ft/s | 0.1 | 0.3 |
| Cloudy | none | 1200 ft | 0.22 | 5 ft/s | 0.16 | 0.12 |
| Foggy | 45 ft | 40 ft | 0.55 | 4 ft/s | 0.9 | 0.4 |
| Dense Fog | 60 ft | 450 ft | 0.4 | 3 ft/s | 2.4 | 0.22 |
| Rain | none | 600 ft | 0.4 | 9 ft/s | 0.5 | 0.04 |
| Snow | none | 400 ft | 0.34 | 5 ft/s | 1.2 | 0.2 |

In Foggy a truck 100 ft over the fog's floor is coming out of it (the fog there an eighth as
thick as in the deck) and at 200 ft is in the clear. Dense Fog has no top to come out of: 300 ft up it is still
more than half as thick. The haze of a clear day, of rain and of snow is as deep as the weather.

**The top** (`FOG_TOP`). Fog that lies in the valleys has a top, as a cloud has, and from over
it the fog is a sea of cloud. Before, the layer only thinned above its deck, and from over it
looked like a grey filter over the land: nothing was there to be seen but the land, greyed.

- *Shape* (`fogProfile`). The fog is thickest just under its top, where it is wettest: 3.5
  times its deck's thickness at the top, thinning to the deck's by 1/e every 13 ft down, so on
  the floor 45 ft down it is within a tenth of the game's fog. Over the top it ends by 1/e every
  7 ft, all but 0.15 of it; that share lingers as wisps, which thin by the scale height and lie
  in patches.
- *Billows.* The top is heaped in billows 34 ft from hollow to crown, rounded crowns with
  creases between, the broadest some 260 ft across and others a half and a fifth of that: two
  layers of them at different sizes, drifting on the wind at their own speeds, so they change as
  they go.
- *Light.* The day lights the top: it is up to 1.85 times as bright as the fog inside it in a
  full sun (`fogTopLit`: 0.85 of the fog's colour more, 0.4 of that from the sky alone and the
  rest by how much sun the weather lets through and how high it stands; Foggy's comes to 1.65),
  and the light reaches in by 1/e every 40 ft (`fogLight`), so deep in the deck the fog is the
  game's own colour. A billow's face toward the sun takes more of the light and one turned away
  less, by how the top climbs toward the sun against how steeply the light comes down, and a
  hollow between crowns sees less of the sky than a crown.

Where a line of sight passes through the billows (a band from 0.6 of their height and a cap's
depth under the top's mean to 0.6 of their height and three times the top's crispness over it),
it is followed in eight steps (four in a headset), each as thick as the billows make the fog
there and as lit as the day reaches it; each point of the picture places its steps a little
differently, so they leave a fine grain and not bands. Elsewhere the fog is summed in closed
form, as before. A line that never meets the band costs nothing more.

**Banks.** The layer's thickness varies from place to place, and the variation stands in the
world. Two fields of noise say how thick the fog is at a place against an even fog's: broad
banks, one repeat of the noise 2600 ft across, and a second 1100 ft across read blurred, so
that nothing in either is finer than a couple of hundred feet. (Finer than that, a truck at
speed runs through the fog's grain several times a second, and the whole fog flickers past.)
They drift on the wind and a little across it. Where they read low the fog thins to
`1 - drift` of itself, and where they read high it thickens to `1 + drift`, with soft edges
between; on the whole it is as thick as the table says. Over a bank the layer's top stands
higher, by up to 0.4 of its deck, and lower over a clearing.

The line from the eye to a fragment is cut in five slices that end at 1/25, 4/25, 9/25, 16/25
and all of the banks' reach (2.5 times the game's distance; for a haze, its far end), so the
nearest is the shortest. Each is as thick as the layer is along its own length, with the
layer's top and the banks as they are at its middle, and each hides what is behind it. So in
Foggy a bank can stand between a truck 25 ft off and one 100 ft off, a clearing shows the hill
beyond it, and as the eye moves the near banks slide across the far ones. Beyond the reach the
fog is even, in two pieces (the first a third of the way), each lying as the floor lies at its
middle, so from over Foggy's top the far land lies under its own fog however clear the air
about the eye. Fog is also lighter where it is thick: fog twice as thick as even is seen an
eighth brighter, so the fog's far wall is mottled and not one flat colour.

What the far fade takes, beyond what the fog along the line hides, is seen as the fog is from
where the eye stands, and so is the foot of the backdrop and the sky at the horizon: from over
Foggy's top that is its lit top, and the far land, the backdrop and the sky meet in one colour.

Every fragment of every material pays for this with ten reads of one noise texture and eight
of the floor, and a line through Foggy's billows with five reads more for each of its steps. A
headset cuts the line in two slices.

**The sky.** three.js's fog leaves the sky dome alone, so the game's sky stood clear over the
thickest fog. The dome is now veiled by the same layer: by its depth overhead divided by the
sine of the elevation, so the horizon is all fog and the zenith shows through as far as the
weather allows, less so as the eye climbs out of the layer. The banks veil it too: the depth
is scaled by how thick they are 400 ft along that line, so the sky shows through the
clearings. At the horizon it is the colour the far ground fades into; overhead, the colour of
the fog's lit top.

**The backdrop.** A SIT lists models that the game draws behind the world, round the camera:
canyon walls, a range of hills. Options, Track backdrops draws them, off by default, and
with the volume on they stand 9000 ft off, beyond the next copy of the world. At the horizon
itself a backdrop is wholly in the haze the ground fades into, clearing over the first 1.7
degrees, so the ground's far edge is never seen against it. Above that, only a weather with fog
of its own (Foggy, Dense Fog, Rain, Snow; `BACKDROP_HAZED`) is seen between the eye and it, thinning as
the line of sight climbs out of it, and in fog proper, Rain and Snow it is hidden. On a clear or
cloudy day it stands clear: the day's haze is the ground's distance, and an HD backdrop, the
picture of a far range in its own air already, was washed out by it. An HD backdrop (a PNG with
its own alpha) is drawn first of the see-through things, before the trees' cut-out leaves,
which write no depth and would otherwise be painted over. The dark weathers have no
fog to do it, and their darkness takes it by a share: 0.62 at Dusk, 0.84 at Night, all of it in
Pitch Black. Before, drawing the backdrops switched the scene's fog off in every weather but
the two fogs; with the volume off that is still so. The darkness is the colour of the scene's
fog, and it follows the fog whenever that changes: at a race's start the camera can be under
the water's level for a moment before it is placed, and the backdrop had kept the water's blue
green from then, a cyan band behind the hills all night.

**Glow.** The fog is brighter toward the sun, by the weather's share of sunlight. Lightning
lights the fog itself.

**How it reaches every material.** three.js builds each material's shader from named chunks.
The four fog chunks are replaced once, before any material is compiled
(`installAtmosphere`, called by `src/render/xr/xr-host.js` and `src/render/track-scene.js`),
with ones that do the above when the volume is on and exactly what three.js does when it is
off. The volume's state is one array of numbers that every material's uniforms point at, so
setting it once a frame sets it for the terrain, the models, the trucks and anything added
later. Nothing is drawn twice and there is no pass over the finished picture, which a headset
could not afford.

**What the fog cannot veil.** Two things escaped it, and both stood out of the fog at any
distance:

- What adds its light to the picture: a lamp's lens and its beam, a track light's glow, a
  spark, the game's spray and ripple sprites. Veiling such a thing in the fog's colour would
  add the fog's colour to the picture, so they were drawn without fog. They are dimmed by the
  fog between them and the eye instead (`fogDims`, and `VEIL_GLSL` for the port's own
  shaders), with the volume on or off.
- What has no light to be lit by. A truck's axle bars and shocks are ribbons that face the
  viewer, and they had no normals: the light summed over them was not a number, which no fog
  can blend with anything, and they drew black under every truck however far off it was. They
  are lit now as the rods they stand for, facing the viewer square to their own length
  (`src/game/suspension.js` `ribbonNormal`). The recovery helicopter's rotor was drawn without
  fog too, and is no longer.

### Rain and snow

`src/render/precipitation.js`. Every drop and flake is a place in a box of air that follows the
eye. The graphics card works out where each is: where it began (a random place in the box) plus
how far it has fallen and blown by now, wrapped back into the box. Nothing is moved by hand
each frame.

| | Near field | Far field |
|---|---|---|
| Rain | 12 000 drops in 110 x 70 x 110 ft, 2.2 ft streaks | 6 000 in 340 x 150 x 340 ft, wider and fainter |
| Snow | 9 000 flakes in 130 x 80 x 130 ft | 6 000 in 420 x 170 x 420 ft, larger and fainter |

Rain falls at 70 ft/s on a 12 ft/s wind and snow at 9 ft/s, wandering, as before. What makes
them read as depth:

- the two fields, each fading out at its own edge, so the far one fills the distance behind the
  near one;
- a streak is as long as its drop travels while the eye would blur it, measured against the
  eye's own motion (up to 2.4 times its length at rest), so rain leans toward a truck at speed
  and streams from ahead;
- no two drops catch the light alike: each is between a third and all of its field's
  brightness, and the fields are faint (0.3 and 0.14 at their brightest), so rain is seen
  against what is dark and does not hide the race;
- nothing falls below the ground (the ground map), the water or what stands over the ground
  ("Under cover"), and where rain meets one of them it leaves a splash (520 of them within
  45 ft): a fleck that leaps and thins. It once spread a ring on the ground as well, a white
  ellipse that stood out on dry ground and ice alike; the rings rain leaves on standing water
  are the water's own;
- each particle is dimmed by the fog between it and the eye, and is drawn no thinner than a
  pixel, fainter instead.

### Rain on the ground

`src/render/ground-surface.js` adds a few lines to the terrain's own material, so the ground
keeps its textures, light and shadows.

In Rain the ground darkens within 8 seconds: to 0.74 of its brightness, and its colours deeper,
their distance from grey grown by 0.3, so what the ground is made of is as plain to see as when
it was dry. It has a film of water on it, which mirrors the sky a very little from above
(1.5 %) and somewhat at a low angle (17 %), never more than 24 %, unevenly, as the ground under
it is uneven (`WET`). The sheen is kept slight on purpose: the ground used to darken to 0.6
and mirror up to 65 % at a low angle, and a wet road seen along its length from the chase
camera was one grey mirror, under which a driver could not read the course by what it is made
of. Standing water is the mirror; the ground is not. A race that begins in Rain begins wet
with its puddles full; rain that GOLD mode brings on wets the ground and fills them from a
third over 40 seconds, and when it stops the ground dries over 45.

**A puddle** stands where the puddle map says the ground lies under water. It is muddy water over
soaked ground, and it mirrors the sky:

- *What it mirrors.* The sky the level's water mirrors (`src/render/water-common.js`): the dome's
  own picture, veiled toward the horizon by the fog as the sky itself is, as much as water
  mirrors at the angle it is seen, 2 % from straight above and all of it along the ground
  (Schlick's). A ray that a ripple tips under the horizon meets what stands there, as the
  horizon has it. Rain ruffles the face, and close to the eye each drop's ring shows: the lake's
  rings at half their size, since a puddle is seen nearer, left out where a pixel spans more than
  about a twelfth of a foot of ground and they would only shimmer.
- *Under it.* The ground, darker under water, and the deeper the water the more its own colour
  hides it: rain standing on dirt is the ground's colour taken broadly (the mean of its textures)
  at 0.6 of its brightness, and hides 1 - e^(-depth / 0.06 ft) of the bed, never more than 0.85
  (`POOL_LOOK`, `poolMurk`), so under an inch of water little of the ground shows.
- *Its bank.* Up its bank, until the ground stands a fortieth of a foot over the water, the
  ground is soaked 0.3 darker than wet ground and keeps a film of the muddy water (0.4 of the
  silt's colour).

On a lit ground (the enhanced look's) what a puddle and the wet film mirror is light of the
ground's own: the ground's light gives way to it and it is added once the ground is lit, as
light it gave off would be. So a puddle in a shadow still mirrors the sky, and the work is done
before the ground is lit, which keeps the ground's shader as fast as it was ("Cost"). The
classic look's unlit ground lays it over what it draws. Before, a puddle was the wet ground
darkened, and mirrored at least a tenth of a sky of two colours dimmed by the weather's light,
so that in Rain it was hardly lighter than the wet ground about it.

**The puddle map** (`src/game/ground-maps.js` `buildPuddleMap`) is worked out the way water
would do it, on the ground map's samples:

1. Every sample drains to its lowest neighbour of eight. That sorts the ground into basins,
   each around one low point.
2. A basin holds a depth above its low point: a little anywhere, and 0.07 ft more for every
   doubling of the ground that drains into it beyond 60 000 square feet, up to 0.8 ft.
3. The saddles between basins are taken lowest first, in whole steps of a sixty-fourth of a
   foot of height, so that what is done to the ground in one place leaves the order far off as
   it was. Where two pools both reach a saddle they become one pool, which goes on filling as
   far as the better fed of the two would. Where only one reaches it, that pool runs over and
   rises no further.

So the foot of a slope gathers a pond, a dimple on a flat gathers a puddle, and ground that
slopes holds nothing. The game's ground is flat to the last bit where it is flat, which has no
low points, so an unevenness of a few inches that is never drawn is added first (dimples some
50 ft apart), and how well the ground holds water varies over a few hundred feet, so puddles
come in patches. Ground under the level's water holds none and takes what runs into it.

The courses (`COURSE_PUDDLES`, `drivenMap`, `potholeFt`). Trucks churn the ground they race over
into ruts and potholes and pack it so that it keeps its water: on a dirt track after rain the
deepest puddles lie in the driven line. So every course a truck may be put on (the primary one
and Professional's) has a driven line, its width and 4 ft more to either side, fading out over
12 ft beyond. There the ground is given potholes besides its dimples, up to 0.3 ft deep and some
twenty to forty feet across, over about half of it; the ground holds its water as well as any
ground does; and a hollow fills 0.2 ft higher than one in the open, with what runs into it off
the packed course. A pool there that fills past a low saddle runs over into the ground beside
it, and nothing further than some 140 ft from a course changes. A course that slopes holds
nothing, as any slope does.

On the stock tracks 0.1 % to 6 % of the ground is under water; half the puddles are a single
sample (8 ft), nine in ten are under 21 ft across and the largest are 50 to 80 ft. Along the
courses, 4 % (Farm Road 29, whose course mostly climbs and falls) to 23 % (Crazy '98) of the
wheel lines (the course's line and 6 ft either side) run through water at least 0.03 ft deep,
where a wheel counts as standing in a puddle ("Particles"); 15 % to 39 % where the course is
level. Its puddles are some 17 to 31 ft long, half of them over 0.06 to 0.11 ft deep, the
deepest a quarter of a foot. Before, 0 % to 1.6 % of a course stood that deep, and half the
puddles a truck met were under a fortieth of a foot: next to nothing to drive through.

The map keeps, for each sample, how far the ground lies under its pool's surface or above it
(a byte, the waterline at 128, a quarter foot either way), and the shader reads it through a
cubic kernel, so a puddle's edge falls where it should between samples and is round.

The map is built only where it may rain: the race is in Rain, or the track allows Rain.

**Driving through a puddle.** The puddles share the level's water's field of waves ("Ripples
and wakes"): where a puddle is deeper than the level's water there, the field takes its depth
from the puddle map, less the tenth of a foot a puddle stands under its full level while it
fills, so a puddle's waves run at a puddle's pace (under two feet a second in a tenth of a foot
of water) and its edge throws them back. A wheel on the ground in a puddle (its tire's foot
within half a foot of the ground) stands on its bed (`puddleStir`, `PUDDLE_PARTING`): it holds
the water down over 2 ft about it, toward 2.2 times the puddle's depth below its rest, so that
even a wheel that crosses a point in one step of the field bares the bed under its tread; and
the faster it goes the harder it pushes the water aside, by 0.04 ft standing and 0.008 ft more
for every foot a second, 0.3 ft at the most. It does so in a puddle a tenth of a foot deep or
more, less in a shallower one and not at all in one under a hundredth. It holds the water
down steadily, without the churning beat of a wheel afloat, and all along its way since the
field last stepped. The water runs back in behind it: a wheel leaves a bare track through a
puddle that fills again within a fraction of a second, and its waves run out across the
puddle, where in water so shallow they break before they could bare the bed again. The ground's
shader moves a puddle's edge and depth with the waves, and ground a trough has just bared is
as soaked as ever, under a film of the muddy water. From 4 ft/s a wheel churns the water, fully
from 29 ft/s: the silt it stirs up clouds the water whole and paler, in swirls that settle, and
where it was churned hardest a scum of muddy froth rides on the water, lit as the ground is and
mirroring nothing. The puddle's mirror is turned by the waves' slope. And a wheel in a puddle
throws a sheet of spray ("Particles", `puddle`). With "Reflective water" off the field still
runs for the puddles; with "Rain puddles" off there are none to stir. Before, a wheel held a
puddle down by little more than an inch and nothing ever bared its bed, and the churned water
was drawn over the puddle's mirror as flat white blotches.

### Snow on the ground

The game leaves the ground bare in Snow. The port's snow has a depth
(`src/game/snow-cover.js`), which is what the settled snow measures at each place:

- **0.85 ft** on level, open ground where it drifts deepest;
- times what the **slope** holds: all of it up to a slope of 0.12, none from 0.8, so it thins
  out up a hillside and a steep face is bare;
- times the **drift**, 0.44 to 1 over a hundred feet or so;
- **thin along the course**: 0.04 of the depth beside it, across the track's half width (at
  least 24 ft) and 12 ft more, so the road is clear and a truck on it stands on the ground it
  drives on. From there it rises over 16 ft to a low bank 1.1 times the open ground's depth,
  and settles to that depth over the next 16;
- **none** at the corners of a cell with a ground box, and none under cover ("Under cover"
  below).

The snow used to be half as deep again and an eighth of it lay along the course, which made the
course hard to find in a field of white.

**It has thickness.** For a race that begins in Snow the terrain's mesh carries this depth on
every vertex, and the mesh is cut for the snow's surface as well as the ground's, so the bank
along the course has its shape. The vertex shader lifts the ground by the depth times how much
of the snow is down. Tires sink into it off the course, objects stand in it, and the road runs
between its banks. This costs one multiplication a vertex. Dust, tire tracks, spray and the
cameras follow the snow's surface. Trucks are still seated on the ground under it.

**Where it ends.** The same depth decides where snow shows, but not by a line where the depth
reaches nothing. The depth is known at the mesh's points and runs straight between them, so
such a line would follow the mesh's cells, straight for 32 ft and then turning a corner.
Instead snow shows where it will settle deeper than a depth that wanders from place to place:
between 0.05 and 0.36 ft, by noise some 50 ft across that knows nothing of the mesh
(`SNOW_LINE`). The line crosses the band where the snow thins, leaves islands ahead of itself
and bare patches behind, and its edge is frayed over inches by another 0.14 ft of depth. Snow
that settles deeper than 0.36 ft always shows, which on level open ground is all of it,
however it drifts; the course's is shallower than the least that shows.

Nor is it all or nothing at the line. For 0.2 ft of depth short of it the snow lies thin:
first as specks caught in the ground's hollows, then as a broken sheet the ground shows
through, then whole. So the course takes a few specks where the line comes lowest, a hillside
goes from white to speckled to bare over tens of feet, and thin snow is greyer than deep. The
depths are the settled ones, so the line stays where it is while the snow deepens; only the
first tenth of a fall creeps out from where it will lie deepest. Ground within 0.3 ft of
showing snow is damp from it, 0.18 darker.

**Its surface.** Snow has hollows and wind-packed ridges (two scales of the ground's own grain,
37 and 6 ft a repeat): a shade bluer in the hollows, and where there is a sun, lit on the side
that faces it. Close to the eye its crystals glint: a fine field of points, each catching the
light from one way only, so they come and go as the eye moves; far off the field runs
together and there are none. Thin snow is greyer than deep.

**When.** A race that begins in Snow has three tenths of it down already, and the rest settles
over the game's own 100 seconds (the time its ice takes to spread). Snow that GOLD mode brings
on during a race starts from nothing, and goes in 12 seconds when the weather changes again.
Such snow has no depth in the mesh, since only a race that begins in Snow is built with it: it
lies flat, by the ground's slope and the drift. So does the snow on the tops of ground boxes,
but a box's top is kept as thin along the course as the ground is (`courseShareAt`): some
tracks carry the course over a gully on ground boxes (Sidewinder Canyon's bridges are boxes
with no textures of their own), and a deck on the course is as clear as the road it carries.
Before, such a deck lay under the open ground's snow, a white bridge on a clear road. Each
point of the boxes is given its share of the snow as the scene is made.

### Under cover

Some tracks build bridges and tunnels of models, and rain and snow fall out of the sky. Built
where it may rain or snow (`src/game/ground-maps.js`):

- **The cover map**: the height of the highest thing standing over each sample of the ground
  map, from the triangles of the placed models. A sample is under a triangle that any part of
  its square lies under, so cover is never missed between samples. A thing narrower than 14 ft
  across its footprint shelters nothing: a pole, a sign, a gantry's bar.
- **The shelter map**: where the ground lies under cover, which is where the cover stands 5 ft
  or more over it (lower, it stands on the ground and is no roof), as a byte a sample with the
  edge spread over a sample either way, since rain and snow blow in a little under an edge.

Under cover no rain or snow falls: the drops and flakes stop at whichever is highest of the
ground, the cover over it and the water. The ground there stays dry, holds no puddle and takes
no snow, settled or lying. A ground box's top is itself what stands over the ground, and is
out in the weather (along the course, with the course's thin snow: "Snow on the ground").

## Light

`src/game/lighting.js` has the rules, `src/render/light-rig.js` the lights, with "Natural
light". The game lit its models with one white sun and a white ambient term, and its ground not
at all. The enhanced look lit the ground too, with the same two lights: the ambient one so
strong against the sun that a shadow was three fifths as bright as the ground beside it.

**Three lights.** The sun, in the colour of its hour. The sky, from above, in the colour of
the level's own sky art overhead (the mean of the art's top quarter, which the dome shows at
67.5 degrees), mixed with white by the weather. The ground, from below: what falls on level
ground comes back up off it in the ground's own colour (the mean of the ground's textures),
which is what lights the underside of a truck and a canyon's shaded wall. The last two are one
hemisphere light. On a clear day level ground is lit about as its art is painted, and ground in
shadow keeps a quarter of that, blue.

| Weather | Sun | Strength | Sky's strength | Shadows |
|---|---|---|---|---|
| Clear | warm white | 3.7 | 0.95 | 1 |
| Cloudy | white | 1.7 | 1.45 | 0.62 |
| Foggy | white | 1.15 | 1.6 | 0.4 |
| Dense Fog | white | 0.6 | 1.7 | 0.22 |
| Rain | cold white | 0.5 | 1.05 | 0.3 |
| Snow | white | 0.95 | 1.7 | 0.4 |
| Dusk | orange, 11 degrees up | 2.9 | 0.62 | 1 |
| Night | the moon, blue | 0.85 | 0.2 | 0.9 |
| Pitch Black | none | 0 | 0.055 | none |

Strengths are as three.js counts them: a face square to a light of strength *s* shows *s* / pi
of its colour. "Shadows" is how dark the sun's shadow is: under an overcast sky the sun's light
is spread over the whole sky. Lightning lifts every light for its instant, by as much as it
lifted the old ones, and fades the shadows.

**Where the sun is.** The level's own direction (the LVL's sun vector), but at Dusk, where the
game says nothing and draws no disc: there the port has it 11 degrees up on the level's
bearing, so shadows are long and only what stands up catches the orange. At Night the light is
the moon's, from where the game draws the moon, which is where the sun stands.

**A stadium** has a roof and no sky. It is lit by its floodlights whatever the weather: white
light from all round (1.75), a white lamp along the level's sun direction (1.9) so that things
still stand on a shadow, and that shadow soft (0.55).

**Shadows** (`src/render/sun-shadows.js`). The enhanced look's shadow cascades are drawn in
closer: they end at 150, 560, 1900 and 6400 ft instead of 500, 1700, 4200 and 10240, so the
first has a texel of a quarter foot and a truck's shadow shows its tires. The ground casts as
well as receives, in every copy of the wrapped world: a cliff shades the canyon under it, and
at Dusk the hills lay their shadows across the track. The ground is one sheet with nothing
under it and is drawn into the shadow maps from behind, so a slope in the sun never shades
itself.

**Under a truck** (`src/render/contact-shade.js`). The sky lights the ground from every side,
and a truck keeps a good part of it off the ground beneath: one soft dark patch a truck, laid
on the ground's mesh as drawn ("Read back off the mesh") and turned with it, at most half
dark, gone when the wheels are 9 ft up.
It is strongest where the sun's own shadow is faintest, and is what stands a truck on the
ground in fog, rain and snow. Over the level's water in Snow it lies on the ice, which is what
the truck stands on; before, it lay on the bed under the ice, and a truck on deep ice had none.

**Dust** and a collision's smoke, as the game's sprites, are drawn unlit, and stood out at
Night as bright as by day. They are as dim as the weather's own light now
(`src/game/weather.js` `light`), as the game's puffs were fainter with the ground's light.
With "Rich particles" they take the scene's lights themselves ("Particles" below).

**Scenery that faces the camera.** A tree is a flat card turned to the camera, and lit as a
card it brightened and darkened as the camera went round it. It is lit as the round thing it
pictures: its face leans up, toward the camera and outward from its middle, so it has a sunny
side and a crown lit from above. A cut-out picture's see-through texels are given the colour
of the picture beside them (three texels out, `src/game/cutouts.js`), which rids every leaf of the dark line the
background's colour drew round it, and a cut-out's edge is spread over the samples of an
antialiased picture.

**The curve.** With a sun this strong, what faces it is brighter than a screen's white. Up to
0.7 a colour is shown as it is, so the game's art keeps its colours; above, the brightest
channel is eased toward 1, which it reaches only at infinity, and the colour pales as it nears
it, as a bright light does on film. What was white comes out at 0.85. It is three.js's custom
tone mapping with its one function replaced, so every material takes it. The sky art and the
fog are not passed through it.

## Paint

`src/render/gloss.js`, with "Glossy paint". A truck's materials mirror what is around them:
4 % of it seen square on and 26 % at a glancing angle. What they mirror is the sky as two
colours read off the level's sky art, overhead and at the horizon, and the ground's colour
below the horizon. The sun adds a glint, a sharp one and a broad one, where it reaches the
surface: the glint is scaled by the direct light the surface got against what the sun gives it
in the open, so a truck in a cliff's shadow has none. In Rain everything shines 1.5 times as
much.

**Nothing in a shadow shines.** What a surface mirrors is scaled the same way as the glint: a
surface turned to the sun mirrors as far as the sun reaches it, so the underside, the inside of
a wheel arch and a truck in a cliff's shadow mirror nothing. A surface turned from the sun
mirrors the open sky it faces, at most half as much and less the further it faces down, and the
running gear, which sits under the body, mirrors only where the sun is on it.

**Panels are not flat.** The trucks are a few flat faces each, and a flat face mirrors one
thing all over: seen from the chase camera a whole side panel took on the ground's colour, or
the sky's, at once, and the sun's glint lit a whole face. So the direction a face mirrors along
is taken half way from the face's own to the bulge of a body the truck's size (an ellipsoid of
3.4, 3 and 9.2 ft half width, height and length, `PAINT.round` and `PAINT.bulge`). What it
mirrors then changes across a face, as across a real panel, and the glint is a highlight on it.

**What shines.** The body in full and the running gear 0.3 of that, a part's glint going by the
square of its share. Tires do not shine at all: rubber is matt. (They used to take 0.14, which
on a face as large as a monster truck's tire read as a wet shine.)

## Lamps

`src/game/truck-lights.js` has the rules, `src/render/truck-object.js` and
`src/render/light-beam.js` the drawing, with "Truck lamps". Which lamps a truck has, where they
sit and when each is lit (the lamp switch, the brakes, the gear) are the TRK's and the game's
(`MONSTER_EXE_ANALYSIS.md` 11b). How a lit lamp is drawn is the port's.

**A lens** is the lamp's own bitmap (the TRK's source bitmap), in its own shape and colours and
at the TRK's size, as the game draws it; a lamp without one is a small hot middle in a wide soft
glow, in the lamp's colour (a headlight's warm white, a tail lamp's red, a reversing lamp's
white). It glows several times
brighter than the screen's white, so the lens makes it flare: a headlight 7 times, a tail lamp
4.5, others 3, and by day 0.45 of that, since there is a bright picture round it. It fades in
as the lamp turns to face the eye and is dimmed by the fog in front of it.

**Tail lamps** work as a car's do now: with the lamps on they run dim and steady, at 0.22 of
their brake light, and under the brakes they burn full at once, lamps on or off. The cab's
third lamp, on the centre line, is a brake lamp only. (The game lit a tail lamp 0.4 with the
lamps on, 0.6 braking and full with both.)

**A beam** is light in the air, not a cone. The game draws an open cone with a fuzzy texture on
it: seen from the side it has edges and seen along it two overlapping sheets, and it took the
sun's shadows like a solid thing. The port draws the same frustum as what fills it: for each
point of the picture the line of sight is followed through the beam and what the light does to
the air along it is summed, in ten steps, brightest on the axis and fading to the sides,
strongest by the lamp, gone by the beam's end. So a beam has no edge and no surface, is
brighter looked along than across, glows round the eye when the eye is in it, and casts no
shadow. How much of it is seen goes by what is in the air to show it (`BEAM_AIR`):

| Weather | Air |
|---|---|
| Clear | 0.04 |
| Cloudy | 0.08 |
| Foggy | 1.3 |
| Dense Fog | 1.7 |
| Rain | 0.6 |
| Snow | 0.7 |
| Dusk | 0.4 |
| Night | 0.5 |
| Pitch Black | 0.55 |

**On the ground.** The game lights the ground before the trucks only in the weathers that light
the lamps at the start, and the Headlights key, L, switched the lenses and the beams and left
the light on the ground as it was. Now a headlight lights the ground whenever it is lit, in any
weather, by each truck's own switch, as strongly as the day leaves it to be seen: fully in the
dark, under a tenth of that in the sun (`headlightReach`).

The light on the ground is the truck's own lamps' (`headlightPool`): from the middle of its
headlights (its roof lamps when it has none), along their mean aim, pitch and all, in a cone
that holds each lamp's own cone widened by how far apart the lamps stand, and reaching twice
the cones' length. A truck whose lamps throw no beam lights no ground. (It was once the same
round pool for every truck, 6 ft ahead of it.)

The light on the ground is four spot lights, given to the lit trucks nearest the eye
(`placeHeadlightPools`). They are in the scene only while a truck's lamps are lit: all four
shown then, the spare ones put out, and all four hidden while none is lit. A lit material's
shader is built for the number of lights shown and sums every one of them at every point it
draws, lit or put out, so four lights that are only put out cost a clear day what they cost a
night (2.3 ms of a 22.5 ms frame, "Cost"). Shown and hidden together they make two shaders of
each material, and the race builds both as it starts (`warmPools`), with the shaders of
everything else in the scene that is not yet drawn (the helicopter that lifts a truck out,
which stopped the picture for 50 ms the first time one came), so the Headlights key does not
stop the picture to build them. Hidden one by one, as they once were, they made a shader for
each count.

**Dents.** When a crash dents the body, each lamp within 2 ft of the body moves as the body
moved at its nearest point, and its lens and beam with it; a repair puts it back.

**The start gantry** (`START_LAMPS`, drawn by `src/render/start-lamps.js`). The game fills each
lamp bar's texture with one palette colour (`MONSTER_EXE_ANALYSIS.md` 6.1): the red bar dark red
through the countdown and black after, the green bar black and then green. So the gantry showed
two flat painted strips, as dull at night as by day. The port keeps when each bar is lit and
draws the bar's face as a row of round lamps, as many as fit 2.2 ft apart (six on the stock
bar), each 1.44 ft across behind glass with a pale rim, in a dark housing. A lit lamp is three
times the screen's white at its middle, so the lens flares it, and has a glow about it seen from
in front of the gantry, five times white and by day 0.45 of that; unlit, its glass is a dark
tint of its colour. In the weathers that light the trucks' lamps, the lit bar throws a light of
its colour forward and down over the grid, out to 70 ft. A replay shows the green lit.

## Particles

`src/game/particles.js` has the rules, `src/render/particles.js` the drawing and
`src/render/tire-effects.js` what throws them, with "Rich particles". The game draws dust as
twelve frames of a sprite and nothing else. Off, the port draws that, with its own plain points
for drops and sparks. On, what a wheel throws follows what it stands on, and everything thrown
is lit by the scene's lights and veiled by its fog. Which of them are thrown at all is still
under Options, Effects: Dust (dust, powder, chips, clods, smoke and a sliding tire's smoke),
Water splashes (mist and drops), Sparks (and the bubbles struck under water) and Tire tracks.

**What a wheel stands on** (`footing`), looked at fifteen times a second and when it lands:

| Stands on | When |
|---|---|
| water | the ground under the wheel is below the water's level; in Snow that is **ice** |
| under | the same, with the whole tire 0.3 ft or more under the surface (`SUBMERGED_FT`) |
| puddle | in Rain, a puddle 0.03 ft deep or more (`PUDDLE_FOOTING_FT`), whatever is under it |
| snow | snow that settles 0.2 ft deep or more lies there now, or the ground is snow in any weather (`.TTY` type 9) |
| ice | the ground is ice (type 8) |
| mud, wet | soft ground (dirt, mud, sand, grass, gravel, rocks) and hard ground, in Rain |
| dust, hard | the same when dry; in Snow, ground with less snow than that is frozen and counts as hard (along the course, where the snow is kept thin, the road is bare to the eye) |

**Two sorts.** A puff is a soft cloud that swells, drifts and thins. A streak is a small hard
thing in flight under gravity, drawn out along its way for as long as the eye would blur it.

| Puff | Made of | Radius at birth, growth | Height over width | Lasts | Hides at most |
|---|---|---|---|---|---|
| dust | the ground type's own colour, half the ground's own made paler ("Dust" below) | 1.8 to 2.6 ft, 6.5 ft | 0.75 | 1.7 to 3.1 s | 0.42 |
| smoke | dark grey | 1.5 to 2.2 ft, 5 ft | 1 | 1.3 to 2.4 s | 0.46 |
| powder | snow | 1.3 to 2 ft, 4.6 ft | 0.8 | 0.8 to 1.5 s | 0.5 |
| mist | water, a spray so fine it is about white ("Mist" below) | 0.7 to 1.2 ft, 3 ft | 0.5 | 0.7 to 1.3 s | 0.11 |
| rubber | pale grey: a sliding tire's smoke | 1.6 to 2.4 ft, 6 ft | 0.85 | 1.4 to 2.8 s | 0.2 |

What hangs by the ground spreads along it, so all but smoke are a little flattened.

| Streak | Made of | Width | Drawn out over | Off the ground |
|---|---|---|---|---|
| spark | its own light, fourteen times white, cooling to red: a glowing dot ("Sparks" below) | 0.08 to 0.14 ft | none | skids on, keeping a third of its fall and 0.7 of its speed along the ground |
| drop | water; off a puddle, muddy ("Spray" below) | 0.06 to 0.12 ft, and spray's own | 0.018 s | ends |
| chip | ice or packed snow | 0.1 ft | 0.014 s | skips a little |
| clod | earth | 0.13 ft | 0.012 s | skips a little |
| bubble | air under water: a bright rim about a clear middle, and a spark where its skin faces the light | 0.025 to 0.15 ft, most of them small | none | rises at its own pace, and is gone at the surface ("Bubbles" below) |

Sand's dust is pale, mud's dark, gravel's and rock's grey. Powder and mist are brighter than a
matt white face in the same light, as a cloud that throws light about inside itself is.

**What a wheel throws**, each tick, by its speed (`tireThrows`):

| Stands on | Puff | Streaks |
|---|---|---|
| dust | dust, laid along the way it rolls when the game's own rule says the tire raises it ("Dust" below) | a clod now and then above 22 mph |
| mud | none: mud raises neither dust nor spray | one or two clods above 8 mph |
| wet | mist laid along the way it rolls above 14 mph ("Mist" below) | a drop or two above 22 mph |
| snow | powder, more often the faster (from 5 mph) | chips, one for every 24 mph and at times one more |
| ice | powder now and then above 30 mph | a chip at times above 10 mph |
| water | mist laid along the way it rolls above 12 mph ("Mist" below) | spray ("Spray" below) |
| under | none | a little cloud of one to four bubbles now and then, from 3 mph, more often the faster ("Bubbles" below) |
| puddle | none | spray ("Spray" below) |

The game raises no dust in Rain or Snow, and neither does this: in Rain soft ground is mud,
and in Snow it is under snow or frozen. A headset throws half the puffs.

**Dust** (`DUST`, `groundDust`, `DUST_WEATHER`, `dustColour`). Whether a tire raises dust is
still the game's rule: over 10 mph on dusty ground, and a second puff with even odds over
20 mph. How much is the port's:

- *The trail.* A tire raising dust lays it along the way it rolled since the last tick, a puff
  every 6 ft for each of the game's puffs that tick, spread evenly along that way. Each puff is
  born wider than the gap to the next, so the cloud behind a truck has no gaps. Before, four in
  ten of the game's puffs were thrown, at random, where the tire was on the tick: at speed they
  fell 7 to 15 ft apart, and showed as a row of balls. A truck further than 400 ft from the eye
  lays half as many, each 1.3 times the size.
- *The ground.* How dusty ground is, 0 to 1, follows what it is and how it looks. Its `.TTY` type
  gives the most it can (`DUST_BY_TYPE`): dirt and sand 1, gravel 0.6, rocks 0.45, grass 0.35,
  mud 0.3, and anything else none. The mean colour of the terrain's texture under the wheel says
  how much of that it gives (each of the level's ground textures is read once, from the
  terrain's atlas):
  - dark ground is damp, or rich with what grows in it, and gives less: none at a luminance of
    0.01 (linear), all from 0.075. The game's ground is dark on the whole, and its dirt is
    mostly over that;
  - a hue from yellow-green (45 degrees, of the linear colour) to green (75) is plants, where it
    is a colour at all (from 15 % of its brightest channel, in full at 40 %), and plants give a
    tenth: what grows holds the ground down;
  - warm colours, ochre, tan and brown, are bare dry earth; grey is stone, and gives 0.55.

  On the stock tracks this makes the desert's sand and the dry tracks' dirt give all they can,
  the dark dirt of the arenas and the graveyard about half, rocks about 0.45, olive grass about
  a fifth, and green grass none. Ground that gives less than 0.1 raises no dust at all, and dust
  that is raised is as thick as the ground there gives it. Where the terrain's texture is not
  what the wheel stands on (a ground box over it), the type alone says.
- *The weather* (`DUST_WEATHER`): Rain soaks the ground and Snow freezes it, so neither raises
  any; fog damps it to half (Foggy) and a third (Dense Fog), and a night's dew to 0.8 (Night,
  Pitch Black).
- *Its colour* is the ground type's own, mixed half and half with the colour of the ground under
  the wheel made paler (1.3 times, and a little more), since dry fine dust is lighter than the
  earth it is raised from: red earth raises red dust. Clods take the same ground's colour.

**Mist** (`MIST`, `mistSpacingFt`). A tread running over a film of water, on wet hard ground or
wading in the level's water, flings it off as spray so fine that the air stops it at once: it
hangs low behind the wheel and thins away, a veil trailing behind a truck at speed. So it is
laid along the way the tire rolled since the last tick, as dust is: from 14 mph on wet ground
(12 wading) a puff every 6 ft, closing to every 1.8 ft from 50 mph, each somewhere along that
way, behind the tread and a little either side of it, 0.3 to 1.2 ft up, some larger and some
smaller. It leaves with three tenths of the truck's velocity and half a foot to two and a half a
second up, and the air takes what it was thrown with by 1/e in a sixth of a second. A puff is
flat (half as high as it is wide), 0.7 to 1.2 ft in radius at first and spreading by 3 ft as it
goes, thin (0.11 at most), and about white, as a cloud of drops that throws light about inside
itself is. A truck further than 400 ft from the eye lays half as many, each 1.3 times the size,
as it does dust. A tire that spins or slides on wet ground, and a wheel that lands on it or in
the level's water, still throw their mist up and out of the tire as before, in these smaller
puffs.
Before, a mist puff was a ball 1.3 to 2 ft in radius at birth that swelled by 5.2 ft, to some
fourteen feet across, nearly as round as it was wide, thrown every other tick from 14 mph and
carried along beside the truck with four tenths of its speed: a truck on wet asphalt rolled
along in grey billows, like a burnout's smoke.

**Spray** (`SPRAY`, `sprayDrops`, `sprayVelocity`, `muddyWater`). A tire running through
standing water, a puddle or the shallows of the level's water, pushes it aside: it leaves in a
sheet either side of the tire, and the tread lifts a little of it and throws it up behind.
Before, a puddle threw mist, which the port draws as a soft cloud and which read as white dust,
and a few drops at random every way.

- *How many.* Each tick, from 4 mph, 3 drops a side and 1 off the tread, up to 18 a side and 4
  at 45 mph, in water 0.15 ft deep; shallower water throws fewer, down to 0.35 of them, deeper
  more, up to 1.4 times.
- *A sheet is a fan.* A drop leaves from somewhere across it, from its root by the tire to its
  outer edge: the further out, the slower along the truck's way (0.75 of the truck's velocity at
  the root to 0.5 at the edge), the faster out from the tire (0.1 to 0.3 of its speed) and the
  higher (0.1 to 0.3 of its speed, give or take a fifth). So drops thrown together lie on one
  curtain, and the two sheets trail back from the wheel in a V. A drop off the tread leaves with
  0.2 to 0.5 of the truck's velocity and 0.2 to 0.4 of its speed upward, from behind the tire
  and half way up it. Each is scattered by up to 0.7 ft/s every way, and each is given a moment
  of its own within the tick, as if it had left then, so the sheets leave as sheets and not in
  bursts fifteen times a second.
- *A veil.* Six in ten of a sheet's drops are drawn large and faint (0.2 to 0.36 ft across,
  hiding 0.12), and together make the sheet a veil of water; the rest are small and plain (0.04
  to 0.08 ft, hiding 0.45) and catch the eye one by one.
- *The air* brakes every drop, as it does a spark, toward a terminal speed of 18 to 30 ft/s.
- *Muddy water.* A puddle's drops are water with 0.35 of the colour of the ground under it, made
  paler (1.6 times, and a little more); the level's water is clear.

**Rooster tails** (`ROOSTER`, `roosterWading`, `roosterDrops`, `roosterVelocity`). A tire wading in
the level's water, its tread part way under, paddles the water up with its lugs and flings it off
behind as the tread comes up out of the water: a tall fan of spray behind each wheel, besides its
sheets. Before, the tread threw a few drops, as off a puddle.

- *How much a tire wades.* Most with its foot about its radius under the water (its hub at the
  surface); from nothing at 0.15 of its radius to all of it at 0.7, and none again from 1.5 to 2.1
  of it, where the tire is wholly under and throws nothing out of the water. A puddle is too
  shallow to wade in.
- *How many.* Each tick, from 6 ft/s of tread, 2 drops, up to 10 at 45 ft/s, times how much it
  wades. The tread runs as fast as the simulation turns the wheel (on the ground with the ground,
  in the air with the engine), and never slower than the truck goes; in a replay, which records
  no tires, as fast as the truck goes.
- *Up and back.* A drop leaves from the back of the tread, anywhere across its width and up from
  the water toward the hub, upward at 0.3 to 0.8 of the tread's speed and along the truck's way
  at 0.5 of its velocity for the lowest down to 0.1 for the highest, so the tail leans back from
  the wheel; each scattered by up to 2.5 ft/s every way.
- *A plume.* Six in ten are drawn large and faint (0.25 to 0.5 ft across, hiding 0.13), the rest
  as a sheet's plain drops.

The rings a drop leaves where it falls back into water are the water's own: the field of waves
the trucks stir ("Ripples and wakes"). The game's `SPLATRIP` rings, flat sprites of a few rings
each, which the game's spray blobs left where they fell, are drawn only with "Rich particles"
and the port's water both off; and in Snow, when the water is ice, nothing throws them, as in
the game, which does not count ice as water (MTM2_PHYSICS.md 2.3). Before, the blobs flew on
unseen with "Rich particles" only to leave their rings, and on the ice as well.

**Landing.** A wheel that has been off the ground 0.18 s or more and comes down at 6 ft/s or
faster throws a ring of puffs and a burst of streaks, more the harder it lands, up to what a
fall of 40 ft/s throws (`landingThrows`): on dust 3 to 9 puffs and 5 to 18 clods, on snow 4 to
10 of powder and 6 to 20 chips, on water 4 to 9 of mist and 12 to 34 drops, on ice a little
powder and 8 to 24 chips, and a star in the ice, and under water 4 to 14 bubbles and nothing
else, and in a puddle 12 to 32 drops, muddy, and no mist; on mud only 7 to 22 clods. The dust of a
landing is as thick as the ground there gives it, and there is none off ground that gives none. A wheel that runs into water at speed
throws the same burst as it always threw; one that comes up out of deeper water throws none;
one that runs into a puddle at over 15 ft/s throws a smaller one.

**Sliding and spinning.** The simulation says of each tire how much grip it has, what force
it puts through the ground and how fast it turns (`slideAmount`). A tire slides when it asks
for more than the ground gives sideways: from a quarter of the game's own measure of a skid
(the one its skid sound goes by, past 85 % of the grip in use) taken of the sideways force
alone, in full at the measure's full. Under full throttle a driven tire's push forward runs
past that measure while the wheel still turns with the ground, which is no slide anyone sees,
so the push forward is left out. A tire spins when its tread runs 7 ft/s or more faster than
the ground goes by under it, in full at 28 ft/s more. A replay records no tires, and there a
tire slides by how fast the truck slips sideways, from 7 ft/s, in full at 27. What a sliding or
spinning tire throws besides what it would rolling (`slideThrows`), flung back along the force
it puts through the ground:

| Stands on | Thrown |
|---|---|
| hard | rubber smoke, which hangs where the tire made it |
| wet | mist and drops |
| dust | dust and one to three clods |
| mud | two to five clods |
| snow | powder and one to three chips |
| ice | a little powder and a chip or two |
| water | mist and two to five drops |
| under | one to four bubbles |
| puddle | two to four drops |

**Hull contacts** (`src/game/tire-effects.js` has the game's rules). A hull point is a corner of
the box the simulation keeps round the truck, and sparks thrown from there flew from the air
beside the body. They fly from the body's own nearest point to the corner instead, as the body
is now, dents and all. Where two trucks meet, the simulation gives the place half way between
their middles; the sparks fly from where the two bodies are nearest each other, and it is how
fast the two move against each other that throws them, not how fast either goes.

Steel strikes sparks from stone only at a fair speed. A truck that leans on a wall with its
throttle open, or creeps on after a crash, presses as hard as one that hits it, and threw a
shower of sparks. A scrape now throws sparks only above 12 ft/s (about 8 mph; the game says
only "while the truck is moving", and the port had taken 5 ft/s) and a hit only above 9 ft/s,
with fewer the slower it is, all of them from 30 ft/s. The same holds for the smoke of a
contact. What is struck says what flies (`scrapeThrows`): sparks from a thing (a wall, a fence,
another truck) and from hard ground, stone and gravel; clods from earth and mud; chips from
snow and ice. A spark is its own light, and glows in the dark. The game's contact smoke, a dark
grey puff, is kept against a thing; a hull scraping along the ground raises what the ground
gives instead (`scrapePuff`): dust off dusty ground (as thick as it gives it), powder off snow
and ice, smoke off hard ground, and nothing off mud, wet ground or water. The level's water in
Snow is ice, and ground to a hull as to a wheel: one scraping it throws chips and powder.

**Sparks** (`SPARKS`). A spark is a glowing dot: a fleck torn off where two things are dragged
against each other, burning as it flies (`sparkVelocity`, `sparkFlight`, `sparkGlow`):

- *Where it goes.* Torn off between the two, it leaves at the average of their velocities: half
  the truck's against the ground or a wall, which stand still, and the mean of the two between
  two trucks. It is scattered from there every way off the surface it was struck from (up off
  the ground; off a wall, out from it toward the truck), by 4 ft/s and up to a fifth of how fast
  the two meet, twice that for a blow, and kicked off the surface by up to 4 ft/s more.
- *How many.* With the Sparks slider on Many, each of the game's sparks is 2 dots at a standstill
  to 5 at 60 ft/s (`sparkShower`), and each spark of a blow 1 or 2; below Many each is one dot.

**The Dust slider** (Options, Display; `dustLevel`, `CLASSIC_DUST` and `RICH_DUST` in
`src/game/tire-effects.js`) does the same for dust and a collision's smoke: 0 None, 1 Few (the
game's own puffs: its size, a foot of growth, 1.5 to 3.5 s, at most 96 at once), 2 Normal (the
port's 2.8 times the size, swelling 14 ft, 2.2 times as long), 3 Many (3.8 times, 22 ft, 3.4 times
as long); with "Rich particles" Few is fewer, smaller and shorter, Many more, larger and longer.
"MTM2 classic dust" (Options, Advanced) draws a wheel's dust and a collision's smoke alike in the
puff art's own grey, as the game does.

**The Sparks slider** (Options, Display; `sparkLevel` and `sparkRules` in
`src/game/tire-effects.js`) sets how many for both pictures: 0 None, 1 Few (half the chances of
Normal), 2 Normal (the rates above, one streak a spark with "Rich particles"), 3 Many (the rates
before 0.5.0, two sparks every eighth of a second of scrape and bursts of `6 + force / 250`, 28
at most, from 600 lbf, and with "Rich particles" each spark a shower). The older Sparks switch
off reads as None.
- *The air* brakes it a little, toward a terminal speed of 30 to 50 ft/s (the smaller, the lower).
- *Its heat.* It leaves white hot (fourteen times white, and yellow), cools as it flies through
  orange (seven times) to a dull red, by 1/e every half of its time, which is 0.3 to 1 s, and goes
  out. The ground cools it as it skids: each touch takes 0.3 of its heat.
- *The ground.* It skids on off hard ground, keeping 0.7 of its speed along it and a third of
  its fall, three times at most; it is gone in water and soft ground.
- *In the dark* the sparks light what is about them: one light at the shower nearest the eye
  (within 250 ft), of a spark's orange, flashing up by how many have just flown and dying by
  1/e in 0.07 s, flickering, out to 35 ft (`SPARK_LIGHT`). It is made only in the dark weathers.

A spark is drawn as a round dot 0.08 to 0.14 ft across, far brighter than white, so the lens
glows it. Before, sparks were thrown out in a ring at about 14 ft/s with a third of the truck's
speed added, whatever they were struck between. Every other streak, a drop, a chip or a clod, is
drawn out by how it moves against the eye, not over the ground, as a camera's shutter would blur
it.

**Under water** nothing burns: a spark is quenched as it is struck, steel on stone under water
throws no light, and what is seen is the air shaken out of the gap, as bubbles that rise and
are gone at the surface. There is no smoke under water. A wheel wholly under the water throws
nothing out of it either: a truck sunk in a lake stirred mist and drops up on the surface over
it, as if it were churning the top of the water. Its tires stir up bubbles instead, and the
surface over it is left alone. The water splashes with "Rich particles" off keep to the same
rule.

**Bubbles** (`BUBBLES`, `bubbleWidth`, `bubbleRiseFtS`, `bubbleSpiral`, `bubbleVelocity`). A
bubble has next to no weight of its own to carry it on: whatever it was thrown with, the water
takes from it by 1/e in 0.15 s, and it rises as fast as its size lets it, 0.75 ft/s for the
smallest (0.025 ft) to 1.5 ft/s for the largest (0.15 ft), as real bubbles of those sizes do.
Most are small. Middling ones climb in a spiral, four turns a second about a circle of their own
width, and the largest wobble wider and slower, a turn and a half a second; the smallest go
straight up. They rise to the surface, however long that takes (14 to 20 s at the most, for one
lost in very deep water), and are gone there. A tire under the water lets them go in little
clouds of one to four from behind its tread, between the bed and its middle, carried with a fifth
of the truck's speed: from 3 mph a cloud on 15 % of its ticks, on 55 % from 30 mph. Before, a
bubble was thrown off the tread like a clod, at a third to three quarters of the truck's speed and
up to 14 ft/s up, slowed by the water evenly every way, and lasted 0.5 to 1.4 s: it shot out of the
tire, drifted up a foot or two and was gone in the middle of the water, all of them alike, flat
white flecks.

**How a puff is drawn.** A puff is a soft ball, flattened as its kind says, its thickness
falling from its middle to nothing at its rim as 1 minus the square of the way out. It is
drawn on a square standing across the way to the eye at its near side, as wide as it looks from
there, or over the whole picture when the eye is in it. At each point of the square the shader
works out exactly how much of the puff the way from the eye through that point passes:

- cut off where the way goes under the ground, taken as the plane of the ground under the puff
  (looked at again each foot it drifts; the water's level over water);
- and, where the puffs are drawn into a picture of their own that reads the scene's depth
  (below), where it meets whatever the scene has there.

So a puff sits on the ground, and wraps a tire or a wall that stands in it, without being cut
by either. Before, each was a flat square the ground and the trucks cut in hard lines, shaded as
a ball of its own.

**Where the puffs are drawn** (`src/render/over-scene.js`). After the scene, and apart from it.
Every point of every puff's square is worked out and laid over the picture, however little it
adds, and behind other trucks on dry ground the squares add up: 410 puffs covered 65 pictures'
worth between them, nine of them the whole picture each because the eye was in them, and
filling those was 34 ms of a 56 ms frame (Intel HD 630, 1920 x 1080, "Cost"). So the puffs
are drawn one of two ways, by how much of the picture their squares cover between them
(`puffCover`, counted each frame):

- **Light**, at the picture's own size. Through the lens, into a picture of their own laid
  over the scene's, reading the scene's depth (`Lens`). Without the lens (the switch off, a
  headset, the rear-view mirror) straight over the scene, hidden by what stands in front of
  each square, at its near side.
- **Heavy**, from 6 pictures' worth, and until they are back under 4 (`OVER`): into a picture
  a quarter the size each way, and laid over the scene from that. Thick dust has no edge for
  the smaller picture to lose, and it is a sixteenth of the points. Through the lens a puff
  reads the scene's depth and stops where the scene stands in it, as when light. Without the
  lens the small picture has a depth of its own, filled from the scene's, and a puff is
  hidden by what stands in front of its square, as when light: the same shader and the same
  test on fewer points, so the dust looks the same either side of the change. Measured in
  thick dust, the two pictures differ by one or two steps of 255, and by more only along the
  outlines of what stands in the dust, a point wide.

The heavy way needs the scene's depth as a texture. The lens's picture has one, and so has the
optional anti-aliasing's. The plain screen (no lens, MSAA) keeps its depth where no shader can
read it, but a browser will copy it into a texture of the same format, and which format that is
(24 bits with a stencil's 8, where it was tried) is found by trying the likely ones once as the
race starts. So on the plain screen the scene is drawn to the screen as ever, heavy dust or
light, its depth is copied off while the dust is heavy, and only the puffs are drawn another
way. Where a browser will not copy it, the scene is drawn while the puffs are heavy into a
picture of its own with as many samples as the screen takes, which the materials colour
exactly as they colour the screen (the two were compared point for point and did not differ),
and that and the puffs' picture go to the screen in one pass.

Neither is free, which is why the puffs are not always drawn so: the copy is 2.9 ms a frame
on the chip above and the heavy way 3.8 ms before a puff is drawn (the scene's own picture,
where it is needed, 4.5 ms), against about 1 ms for each picture's worth of squares drawn the
light way. The first frame of a race is drawn the heavy way whatever is in the air, so the
pictures are made, the copy tried and the shaders built while the race loads, not on the
frame the dust first thickens. A headset draws the light way always.

What is inside a puff is noise in space (a 64 texel cube of it, repeating every 26 ft), carried
with the puff as it drifts and boiling slowly upward, and read where the way through it is
thickest: lumps that thicken and thin it, and eat away at its thin rim as it ages. The noise is
the world's, not each puff's, so where puffs overlap their lumps agree. A puff is lit by how high
it is over the ground, from the ground's light at its foot to the sky's above, alike for every
puff, and by the sun: what of it gets through the puff itself to there, and how much of that
the dust throws toward the eye, the most looking toward the sun (dust throws light forward:
Henyey and Greenstein's, g = 0.35). So a cloud of many puffs is lit as one cloud. Puffs are
sorted, furthest first.

**Light and fog.** Puffs and streaks take the scene's own lights: the sun, the sky's and the
ground's light with "Natural light", the white sun and ambient light without. So dust is dim at
Night and orange at Dusk. A spark is its own light: far brighter than white, so the lens makes
it glow, and fog dims it. Fog is worked out at each particle's place, not at every point of
it, since a cloud of dust is many puffs deep.

**Cost.** One draw for all the puffs and one for all the streaks, 1536 and 2400 at most. The
sprites they replace were a draw each: in a dusty start on Voodoo Island the frame is quicker
with the switch on than off. At 2560 by 1440 on a desktop card, the dust of a race under way on
Voodoo Island, some 500 puffs, costs 0.1 to 0.2 ms through the lens and 0.3 ms without it.

## Tracks

`src/render/tire-tracks.js`, with "Rich particles" and Options, Effects, Tire tracks. A track
is a ribbon 2.7 ft wide laid behind a tire, a piece every 3 ft, each joined to the last along a
shared edge so that it bends without gaps. Every tire leaves its own: in a turn the front
tires run wide of the rear ones, and where they run in line the rear tires wear the front ones'
rut darker (in deep snow the two make one trench, below). A track is drawn to 1500 ft (760 in a
headset: it lies on the ground's fine level, and must be gone before the ground is drawn coarse).

**How long a track lasts** (`TRACK_POOL`, `trackShown`, `TRACK_LONGEST_FT`). No clock wipes a
track. The pieces are kept in a ring of 65 536, and a track stays until the ring comes round to
it; over the oldest eighth of the ring it fades (and in snow the snow fills it in), so it is
gone before its place is taken. Where a tire runs straight over even ground the piece it is
laying is drawn on to it instead of a new one begun, up to 15 ft, while every place the piece
has passed lies within 0.03 ft of the longer piece, across, in height and in the snow's depth,
and the tire presses within 0.05 of how it did when the piece began: on Voodoo Island that
saves a quarter of the pieces. Eight trucks there lay some 340 pieces a second, so the ring
holds over three minutes of a full field's tracks, and many times that of one truck's.

From the race's first frame the ring's first place is drawn, before anything is laid there:
every corner of it is at one point, so nothing shows. A graphics driver can leave the last of
a shader's building to the first draw that uses it, and a draw of no triangles is not one. The
first rut, a moment after the start, was that draw, and stopped the picture for a tenth of a
second (Mesa on an Intel HD 630).

Before, a track lasted 70 s and faded over the last 25, in a ring of 30 000 pieces each 3 ft
long. Eight trucks filled that ring in about 66 s, so in a full field the oldest tracks went
before their time was up, all at once and at full strength.

It is drawn as the rut it stands for, by what the tire did to the ground:

| On | The rut |
|---|---|
| dust | darkens the ground that is there: its floor to four fifths, the prints of the tread's lugs to three fifths, the foot of each wall a tenth more |
| mud | the same, darker: seven tenths and a half |
| snow that settles 0.34 ft or deeper | ploughed: a trench between two ridges of the snow the tire pushed aside ("Ploughed snow" below) |
| snow that settles under 0.12 ft | cut through: it darkens what is there, as on dust (between the two depths, a mix) |
| ice | scuffed pale, in streaks |
| hard ground, where a tire slides or spins | rubber: up to half the ground's light at a full slide, by how hard it slides |
| hard ground rolled on, wet hard ground, water | none |

A tire that slides or spins on soft ground digs: its rut is up to half again darker.

**On the ice.** Over the level's water in Snow a tire stands on the ice (`MTM2_PHYSICS.md` 2.1),
and its rut is laid on the ice, with none of the snow of the bed under it. The tracks are drawn
after the water and before the contact shade (`TRACK_ORDER`), so a rut on the ice is over it.
A piece any of which lies on the ice goes when the ice thaws (GOLD mode's weather), all of it.
Before, a rut on the ice was laid on the bed under it, seen through the ice where the ice was
thin and hidden where it was not.

**Under standing water** (`RUT.underWater`, `puddleRut`). A rut in Rain is seen through a
puddle's face, which the ground has drawn already: 0.6 of it is hidden at the waterline, rising
to 0.97 where the water is 0.08 ft deep or more (where the water stands is read in the rut's own
shader, as the ground reads it: render/ground-surface.js `pools`). Before, a rut was drawn over
the water and darkened its face, so a rut that ran into a puddle stood on top of it. A tire
coming to a puddle presses its rut less as the water under it deepens, and not at all from where
it stands in the puddle (0.03 ft): a rut runs out into the water and does not end in a square
cut, as it did a few feet in from the waterline.

A rut that darkens does so to whatever is under it, the ground's own texture, a patch of snow,
a shadow, at Night, so it needs no light of its own and is never the wrong colour for the
ground it is on. Where many trucks have taken one line it is worn darker than where one has.

Under fog a rut is as hidden as the ground it darkens. It is drawn over the ground already in
the picture, and that ground is already fogged; a rut that darkened it by its share darkened the
fog's own colour on it as well, and tracks stood out through fog like ink. A rut now takes its
share of the ground's light only, and gives back that share of the fog's
(`ground * (1 - dark) + dark * fog * hidden`, with the fog's colour and how much it hides
worked out at the rut), so far off in fog it is gone with the ground.
Ploughed snow is drawn by one of the scene's own lit materials with lines added, so it takes
the sun, the sky's light, the hills' shadows, the headlights and the fog as the snow beside it
does.

The ribbon lies on the ground's mesh as drawn ("Read back off the mesh"), and keeps for each
point the bare ground's height and the depth the snow will settle to, so the snow that is down
lifts it as it lifts the ground and a track stays on the snow's surface while the snow
deepens. How far round the ring a piece is, and so how much of it is shown, is worked out by
the graphics card from its place in the ring, and only what was laid or drawn on since the last
frame is sent to it.

**Ploughed snow** (`PLOUGH`, `snowTrench`). The snow lies up to 0.85 ft deep, and a tire goes
through it, not over it. Before, its rut was a flat ribbon on the snow's surface, shaded as if
it were sunk, with a pale rim painted along each side. Now:

- The tire packs what was under it to 0.06 ft and 0.12 of the snow's depth more, and pushes
  0.7 of what it moved up into a ridge either side, 0.9 ft wide; in the deepest snow the floor
  is a tenth of a foot down from the bare ground, the ridges stand half a foot over the snow,
  and the trench is a foot deep from their tops. Thin snow is pressed flat, with no ridges.
- The ridges are the track's own shape (`PLOUGH.lipFt`): either side of the rut two strips, an
  outer slope from the ridge's foot on the snow up to its crest, which stands at the trench's
  rim 0.1 ft in from the rut's edge, and an inner face from the crest down to the snow 0.2 ft
  further in. They are lit as they lean (the inner face, which is all but upright, as no steeper
  than one in one), and a face seen from behind, which the ridge itself would hide, is left out.
  Fresh snow, in clumps, running into the snow about them.
- The trench is seen through a lid that lies on the snow's surface between the two inner faces,
  where the trench opens: for each point of it the eye's line is followed down into the snow,
  and meets the packed floor, in its own shade with the tread pressed softly into it, or a wall,
  which leans out a third of a foot for each foot it rises (and is never narrower than the
  tire's rounded shoulder, 0.4 ft), and each takes the light as it faces. The further down, the
  less of the sky is seen. Its rims are ragged, each standing in by its own amount along the
  way. Nothing is cut out of the ground: the trench is drawn in the strip, with the parallax of
  a real one.
- **Nothing of a rut stands over the snow but its ridges.** Before, the lid and the ridges'
  tops stood 1.4 times the ridges' height over the snow, up to 0.73 ft, so that the ridges
  could be seen through it too, and three things followed. What the eye's line found was
  drawn where the lid was, not where the snow was, so wherever the line was not followed all
  the way down (where a rut began or ended, where the snow thinned, at a low angle) the rut
  hung over the ground. From some 60 ft out the line's steps, 0.7 ft each, went over the
  ridges without meeting them, and a rut broke into dashes and went pale. And past the map's
  edge the rut drawn by itself was a different trench, cut in a bank as high as the lid, with
  walls all but black: a rut was dark close by, pale and broken in the middle distance, and a
  dark line beyond 225 ft. Now a ridge is drawn where it stands, at every distance, and the
  eye's line starts at the snow's surface, under which it cannot miss the trench.
- As a track fades, at the end of its time in the ring, the snow fills it in: the ridges settle
  and the floor rises to the snow's surface.
- **Ruts that meet make one snow** (`PLOUGH_MAP`). Before, each rut was a trench of its own,
  seen through its own opening: where two crossed, each showed its own walls over the other's
  floor, and a tire that came within 1.3 ft of another's rut ploughed none of its own, so a rut
  that crossed another broke off in a gap with square ends at an angle, and one that ran beside
  another, partly over it, showed both trenches' walls in each other. Now the ploughed snow
  about the eye, 512 ft square, is drawn first into one map, a point every quarter foot: each
  piece of rut writes its trench and its ridges into it, and the map keeps the highest ridge and
  the deepest trench at each point, the trench cutting the ridge. A rut's lid is then only a
  window on the snow: the eye's line through it is followed down through the map (14 steps, then
  5 halvings of the last) to where it meets the snow, whichever rut ploughed it, and is lit as
  the map's slope there faces. A ridge is not drawn where the map has the snow more than 0.14
  to 0.3 ft under its surface, which is another rut's trench or a hollow and never the ridge's
  own wall. So two ruts that cross are both open where they cross, a tire that runs through
  another's ridge cuts it, and two that run side by side, partly over each other, make one wide
  trench with what is left of the snow between them. Every tire lays its own. The map is drawn only while some rut in the ring ploughs the snow, which a tire does only
  where it settles deeper than 0.07 ft (the course's own snow is thinner), and it is drawn again
  when such a piece of rut is laid on it, when the eye has gone 16 ft, and every quarter second
  besides, as the snow deepens and the oldest ruts fill in; in a headset no more than every
  other frame. Before, it was drawn again whenever any truck laid any piece, which in a full
  field was every frame.
  Beyond it (from 225 ft out) each rut's trench is drawn by itself, the two blended over the
  last 6 % of the map's half width; and without the map a tire still rides in another's rut.
  A rut by itself is the same trench in the same colours (`trackSnowTone`): its rims stand in
  from the lid's edge as the map's do, and its walls are lit as leaning 0.7 up for each foot
  across (`PLOUGH_MAP.wallLit`), which is what the map's slope makes of a wall, taken as it is
  across more than the wall's width. So nothing changes at the map's edge.
- **Only where the snow shows** (`snowLine`). The ground is lifted by the snow's depth
  everywhere, but draws it as snow only where it lies deeper than a depth that wanders from
  place to place ("Snow on the ground"), and a wheel stands on snow from 0.2 ft, which may be
  short of that. Ploughed snow is drawn only as far as the ground under it is drawn as snow,
  by the ground's own reckoning (render/ground-surface.js `gfxSnowShown`). Before, a rut that
  ran off the snow's edge laid white ridges on bare ground.

**On a bridge** (`src/game/ground-boxes.js`, `TRACK_LEDGE_FT`). A track lies on what the tire
stands on: a ground box's top, a bridge's deck, where the tire is over a box whose underside is
below it, by the game's own rule (`groundBoxHeight`, `MTM2_PHYSICS.md` 14.18), and the ground
everywhere else, so a truck in the gully under a bridge leaves its track there and one on the
bridge on the deck. Before, every track lay on the ground, and a truck that crossed a bridge
left its track in the gully under it, where nobody saw it. A piece is laid only where every
point of it lies within 2 ft of what is under the tire, so a track never hangs off a deck's
edge or bridges a ledge: its strip ends there and begins again. What a tire on a deck stands on
is the deck's own ground type and its snow (thin on the course: a deck is hard ground there, as
the road is in Snow, and takes rubber where a tire slides); the dust, spray, sparks and clods a
truck throws there, and where a hull point counts as down, are the deck's too, and what is
thrown lands on the deck until it falls off its edge.

### Crashes in the snow

`src/game/snow-scour.js` (`SCOUR`), with "Rich particles" and Options, Effects, Tire tracks. The
simulation seats a truck on the ground under the snow and knows nothing of the snow, so a truck
that rolls over in it, lies on its roof or its side, or comes down on its nose, has its body
through the snow's surface. Where it is, the snow is pushed out of its way:

- **What went in.** The body is the simulation's own twelve hull points, the outline of the
  truck seen from the side, cab and all. What of it is under the snow is the part of their hull
  below the surface (`bodyInSnow`): the points 0.1 ft or more under it, where the snow lies
  0.2 ft thick or more (so the course's thin snow takes none), and where the lines from those to
  the points over the surface cross it. Seen from above, that part is drawn as a hollow round it
  (`scourShape`): the rectangle of least area round it, half a foot larger all round, its corners
  rounded by up to 1.5 ft. So a truck on its roof leaves a hollow the size of its roof, a nose
  that digs in a small one, and one that sinks further a larger. It is as deep as the deepest
  point went, packing the snow under it down to 0.04 ft over the ground at the most.
- **A drag is one hollow.** While the body goes on through the snow another is laid each 0.75 ft
  it goes, each 0.12 radians it turns or 0.08 ft it bores down, turning and deepening between
  the two it was laid from (`scourSteps`), at most 40 in a frame; a jump of more than 30 ft is a
  truck put back on the course, not a drag. They are drawn into the ploughed snow's map with the
  ruts, which keeps the deepest of each, so a truck that slides on its roof scours one long
  hollow as wide as its roof, wider and narrower as it rocks, deeper where it bore down.
- **Its shape.** Its edge is ragged, in and out over inches and over many feet (less for a small
  hollow, which would be lost in it), by a noise of the world, so the edges of hollows laid over
  one another agree. Its floor is lumpy, with clumps of broken crust standing in it, and its
  wall as steep as the snow will stand. Round it a rim, 1.8 ft wide, of the snow it pushed out,
  in clumps, 0.45 of the hollow's depth high on the whole; 1.4 times higher again ahead of a body
  that slides, which pushes the snow before it. Each hollow laid cuts the pile before it, so the
  pile is left where the body stopped.
- **Inside.** Pressed smooth, a shade greyer and bluer than fresh snow, unevenly, and scored
  faintly the way the body went; where it went down to the ground, the ground shows through here
  and there, smeared with snow and drawn out along the scoring.
- **Seen through a lid,** as a rut's trench is: within the map the eye's line is followed down
  through it, and the hollow is seen with every rut and every other hollow in it; beyond the map
  each hollow is drawn by itself as seen from straight over it, lit as it lies. Over a drag only
  some hollows have a lid (`scourLid`), one each 0.8 of a hollow's half length along the way and
  never closer than 2 ft, each reaching ahead to cover those between it and the next: lids over
  every one, laid so close, were each seen through at every point a dozen times over, and cost
  3.7 ms in a frame full of them where they now cost 0.4 to 0.6 ms. A lid shows nothing, and
  follows the eye's line no further, where the map holds nothing along it.

The hollows are kept in a ring of 8192 (`SCOUR_POOL`), as the tracks are, and fill in with snow
over the oldest eighth. A replay's trucks leave them as the race's did. Before, each of the hull
points dug a tire's trench of its own where the simulation reported it touching, and a blow
left a cross of them: the marks were the width of a tire, with a tread in them, and came and went
as the contacts did, so a crash left scattered spots and lines.

## In a replay

The game's replay keeps where each truck was, how it lay and how its wheels were turned; it
keeps nothing of which wheels were on the ground or what the hull struck (`src/game/replay.js`).
With the port's scenery the replay draws what the race drew (the scenery, the lamps, the
water, the view from under it), and what the trucks throw up and leave behind is read off the
picture (`src/game/replay-effects.js`):

- a wheel is on the ground when its tread is within 0.35 ft of the drawn ground, of the deck
  of a bridge it is on, or in Snow of the ice over the level's water, and stands on the ground
  type there (before, a wheel on the ice was never on the ground, and left nothing);
- a hull point is down on the ground (or a deck, or the ice) within 0.25 ft of it, and struck it
  when it came down 8 ft/s or faster since the last frame, with the force of how fast; what the
  hull does to the ice is read off the picture in the race too ("Dragged", under "Ice"), so it
  is the same;
- a tire slides by how fast the truck slips sideways ("Sliding and spinning").

So dust, ruts, spray, sparks, stars in the ice and the hollows a body leaves in the snow are
laid in the replay as in the race. They
move with the film, and only forward: played backward, or jumped about in, nothing new is
thrown. The game records neither the brakes nor the lamp switch: in a replay the lamps are what
the weather gave them, and no tail lamp brakes.

## MTM2's reflections

The game's two (MONSTER_EXE_ANALYSIS.md "Reflections"), each a switch on the Display page, for
the game's own picture and the enhanced one alike:

- **Water reflections** (`src/render/water-mirror.js`): with the eye above the water the world is
  drawn mirrored in the water's plane into a picture of its own, half the screen's size, cut at
  the plane, without the water and the trucks' reflections; the game's water is laid over it at
  its own opacity. The game draws the mirrored world first and its frame over it; this is the same
  picture. Only on the game's water: "Reflective water" mirrors in its own way. None in Snow,
  where the water is ice.
- **Truck reflections** (`src/render/truck-reflection.js`): each body face that faces the eye drawn
  again in CLOUDENV at half opacity, its texel from the view, as the game works it out; the sky's
  sixteen colours in Rain, Dusk and Night (`src/worker/env-map.js`), none in Foggy, Dense Fog and
  Pitch Black. The game draws them only with the water's switch on as well; here they are apart.

## Lens

`src/render/lens.js`, with "Lens effects": bright lights glow. The scene is drawn into a
picture that can hold light brighter than white (half floats). With MSAA, the default, four
samples a point, two above five million points. The other anti-aliasing choices draw it once
a point (Anti-aliasing). What is brighter than 0.95 of the screen's white, in full from 1.5, is
spread into a glow around it (three.js's bloom: blurred at five sizes and added back), and the
whole goes to the screen through the curve above, its corners 0.16 darker. So the sun's disc,
its glint on water and on paint, a headlight's lens and a flash of lightning glow, and the
ground does not.

A float picture can hold what is not a number, from a shader's arithmetic gone wrong at one
point, and a blur spreads that over everything near it. The bright pass and the final pass clean
the picture as they read it: such points are made black and nothing is kept brighter than 24.
With TAA the picture is still cleaned into its own target first, because TAA keeps the picture
from before the glow is added.

What is drawn over the scene (the puffs of dust and smoke, "Particles") is drawn after it, into
a half float picture of its own that starts clear, and laid over the scene's as the picture is
cleaned. The scene's depth is kept as a texture for it to read, so a puff stops where the scene
stands in it. That picture is a quarter the size each way while the puffs are heavy ("Where
the puffs are drawn"). Without the lens the same things are drawn after the scene straight over it,
and in the rear-view mirror too.

The glow is a pass over the finished picture, and so is anti-aliasing when an optional method
is chosen. Both are the flat screen's only. A headset draws each eye straight to its own
display, and the race draws there without them. While the lens draws, colours leave the
materials as light, not yet encoded for the screen, and the fog's colours are given the same
way (`src/render/atmosphere.js` `output`).

## Anti-aliasing

`src/game/aa.js`, `src/render/aa.js`. MSAA is the default, and what the picture had before
this choice: the hardware takes four samples a point, two above five million points. The
others are optional, and a race draws none of them until the player picks one. The choice is
on the Options Display page and takes effect from the next race. A headset ignores it and
keeps its own sampling.

Off draws each point once, which is the least work. With the lens on, that is the scene's
picture taken with one sample. With the lens off, the scene is drawn into a picture of its
own and put on the screen, so the canvas's own smoothing does not sample it. MSAA with the
lens off is still a direct draw to the canvas, which is the browser's smoothing and not a
fixed number of samples.

FXAA is one sample and one pass over the encoded picture (three.js's FXAA 3.11). It is the
cheapest of the passes, and softer on edges than SMAA. SMAA is one sample and three passes
(three.js's SMAA 1x), and keeps edges sharper. Both run after the curve.

TAA draws one sample a frame, shifted by less than half a pixel, and keeps nine tenths of
the frame before where the new frame agrees with it. It runs on the light values, before the
glow and the curve when the lens is on. The camera is put back before the mirror and the
flare, which are not shifted. A cut drops the kept frame: the camera moved more than 40 ft
or turned more than 0.2 rad. A point whose distance disagrees by more than 0.5 ft, or 2% of
its distance, is drawn from the new frame alone. TAA follows the camera only. A truck can
leave a short trail, held to the colours around it.

Without the lens the same methods apply. The curve is applied as the materials would have on
the way to the screen, and the fog is mixed in the light values the way the lens mixes it,
then the picture is encoded. That fog order differs from a direct draw to the canvas, which
mixes the fog after the encoding. The default, MSAA, is unchanged, so that difference is
only there when another choice is on and the lens is off.

## How far the eye sees

What limits it, nearest first:

| | Where | Why |
|---|---|---|
| The ground's fine level | 2400 ft (800 in a headset) | beyond it the relief is under two pixels |
| The grain | 170 ft and 1100 ft | each scale goes before a pixel is wider than it |
| Tire tracks | 1500 ft (760 in a headset) | they lie on the ground's fine level |
| The fog's banks | 2.5 times the game's fog distance | beyond, the fog is even |
| The sun's shadows | 6400 ft with Natural light, 10240 without | drawn in to be sharp near the eye |
| The haze's end | 7000 ft, or 0.9 of the Draw distance | the world repeats every 8192 ft |
| The drawn world | 8192 ft at the least, in nine copies | the next copy must not be seen |
| The camera's far plane | the Draw distance, 20000 ft | |
| The backdrop | no distance: round the camera | the game's own horizon |

The game itself cut the view at 1024 ft in every weather without fog
(`MONSTER_EXE_ANALYSIS.md` 13). The port draws seven times as far, and cannot usefully draw
further: at 8192 ft the eye would meet the same track again. So the far view is made of two
things. The haze, which now builds from the eye outward instead of closing in the last
quarter, gives the middle distance its depth. And the game's own backdrops, which it drew
beyond everything. The port leaves them off by default. With the volume on, drawing them no
longer switches every weather's fog off: they are seen through the haze.

Not changed: what Rain, Snow, the fogs and the dark weathers hide. Those distances are the
game's.

## Cost

Measured on a desktop card (Radeon RX 9070 XT), Voodoo Island, at 2560 x 1440, from the chase
view fifteen seconds into a race with four trucks: 1.9 ms a frame with every switch off (in
the dust of the start, where each of the game's puffs is a draw of its own), 1.8 ms with all on
but the lens, 2.5 ms with the lens, 2.3 ms in Rain, 3.2 ms in Foggy, 2.5 ms in Dense Fog,
2.2 ms in Snow and 2.1 ms at Night with the lamps lit. Measured again with Foggy's top, the
wakes and the ploughed snow: 3.4 ms in Foggy, 3.1 ms in Dense Fog, 3.0 ms on a clear day and
3.2 ms in Rain, from where the race had got to in each. One frame differs from the next by a
few tenths of a millisecond, and the chase view from one race to the next by more. A card a tenth as fast is over the edge of 60 frames a second
with everything on at that size; the lens is the first switch to try there, then Ground
detail. Nothing here was measured on such a card or in a headset. The times are with MSAA,
the default. Off, FXAA, SMAA and TAA take its place when chosen and were not measured.

- **Light.** One hemisphere light more and one curve in every material. The ground in the
  shadow maps: about 650 more draw calls on Breakneck Ridge from the start line, most of them
  far ground of few triangles. With Natural light those calls fill a copy kept for each cascade
  (32 MB each, 128 MB for the four) and run again when that copy is redrawn, not on every frame.
  A frame draws the trucks and the keyframed models over the copy. The camera-facing models
  (types 8 and 9) are in the copy: their shadows are cast square to the sun, as the classic
  look's are, and never turn toward the camera. A
  cascade a truck's shadow cannot reach skips that truck. Without Natural light the maps are
  drawn in full, as before.
- **Ground detail.** The stack is the atlas again in memory, with its smaller copies a third
  more. Up to fourteen texture reads a point of ground, eight in a headset.
- **Paint.** A few lines in a truck's materials.
- **Lens.** The scene's picture in half floats, and the glow's ten smaller pictures. The bright
  pass and the final pass read that picture. A second full-size picture is drawn only with TAA,
  which keeps the cleaned picture from before the glow.
- **Anti-aliasing.** Off, FXAA, SMAA and TAA take MSAA's place when chosen: one sample a
  point, and a pass over the picture for the last three. Not measured. A headset draws none
  of them.
- **On a small chip.** Measured on an Intel HD Graphics 630 (Mesa, in Chromium) at
  1920 x 1080 with MSAA, on a clear day, the truck on autopilot. The headlights' four pools
  were then kept in every shader and only put out, which cost 2.3 ms of every frame on any
  preset, Off included; the figures after "now" are with them hidden while unlit ("Lamps").
  Low then still had the smoothed ground. Alone on the track: 18.5 ms a frame with every
  switch off and 22.3 ms on Low, now 20 ms. Of what Low added, the smoothed ground was 2.6 ms
  (425 000 triangles in view against 168 000, nearly all of them in the 2048 ft chunk the eye
  is in, so drawing the fine ground less far saves nothing), and each of the water, the paint,
  the lamps and the rich dust was within what one run differs from the next. So Low gives the
  smoothed ground up: 18.4 ms alone, and with three computer trucks a mean of 22.6 ms, 20 ms
  out of thick dust. Four samples a point cost about 1 ms against one. With three computer trucks: 18.6 ms with every switch off the whole race through, now
  17.5; 24 ms on Low with the game's own dust; and on Low with the rich dust a mean of 32 ms,
  with stretches of 45 to 110 ms behind the other trucks, one frame in a hundred over 85 ms.
  Now, with thick dust drawn the heavy way ("Where the puffs are drawn") and Low as it is:
  two minutes of that race from its first frame, a mean of 21 ms, 24 ms through thick dust
  (one frame in ten there over 27 ms, one in a hundred over 32) and 19 ms out of it, the worst
  37 ms; 9 frames of 5621 over 33.3 ms, which a 60 Hz screen shows for 50, where 88 of 2659
  were before the puffs' picture had its own depth and was a quarter the size. A paused frame
  in thick dust (39 pictures' worth): 71 ms drawn the light way, 26 ms the heavy way, 19 ms
  with no dust; through the lens, on Max, 99 ms, 55 ms and 48 ms. From the cockpit the
  rear-view mirror is the scene drawn again, every other frame, and read back for the
  dashboard: asked for and not waited for, since waiting held every other frame 15 to 50 ms
  (a median of 24 ms a frame, 17 ms now); in thick dust the mirror's frames are still the
  slow ones.
- **The water.** Measured on the same Intel HD Graphics 630 at 1280 x 720 on Voodoo Island, on
  Max, the water's own draws and the pass for the land in it, by the graphics card's own clock,
  the race paused, before the water of "Waves" and "The land in it" and after, with the eye still
  and with it moving at 60 ft/s (the land in the water then worked out half a map a frame):
  looking along the water from 3 ft over it 3.8 ms a frame, and 2.2 still and 2.6 moving; looking
  down at it from 30 ft 5.5, and 3.1 and 3.6; over it from 120 ft 2.2, and 1.3 and 1.7; from
  under it 4.6, and 2.5. The pass for the land in it is 0.45 to 0.5 ms a frame while the eye
  moves, 0.65 worked out whole, and next to nothing while it is still; twice as many columns
  looked the same through the waves and cost a third more. On Low, the eye still, looking down
  4.2 and 2.6, from 120 ft 2.1 and 1.3. The ice in Snow 6.0 and 5.0, and looking down at it 8.0
  and 6.8. Most of what was saved was the ice's lines in the open water's program, and
  three.js's soft shadows.
- **Puddles.** Measured on the same Intel HD Graphics 630 at 1280 x 720 on Crazy '98 in Rain,
  the race paused and nothing drawn but the ground, by the graphics card's own clock: with no
  water standing the ground costs what it did before, and over a view a course's puddle fills,
  0.1 to 0.35 ms a frame more than the same view did when it held next to no puddle. That took
  care. The card shades the ground sixteen pixels at a time only while its shader fits the
  card's registers, and eight at a time otherwise, which costs every pixel of ground, puddle or
  not; what the puddles mirror first took the ground's shader over that line (0.5 ms a frame
  more on dry ground). A lit ground now works out what it mirrors before it is lit and keeps
  only that light across the lighting, where everything kept holds a register through all of
  it. The field of waves, racing with three computer trucks: 0.43 ms a step, against 0.42 when
  the stock courses held so little water that a wheel almost never stirred it; a step reads each
  point about a point once (it read them twice), and a wheel skips the field beyond its reach.
- **Under water.** The motes and the sun's shafts ("Under water"), measured the same way with the
  eye ten feet under the water on The Heights on a clear day: 16.1 to 17.2 ms a frame with them
  and without, within what one run differs from the next.
- **Presets.** Auto (`src/game/graphics.js`, the chip's name from
  `src/app/graphics-hardware.js`) picks from the card and from how many points the picture
  has. A software renderer, a phone chip, Intel HD or UHD, or under 4 GB of memory when no
  stronger chip is named, is Low. A strong desktop chip on a picture of up to five million
  points (2560 x 1440, the size measured above, is under that; 3840 x 2160 is over it) is
  Max. The same chip past that, or a lesser desktop chip, is High. A renderer with no name
  is High, or Low past five million points. High gives up the lens. Low also gives up ground
  detail, natural light, volumetric weather and the smoothed ground, which is the one part
  of the rest that a small chip pays for on every frame ("On a small chip"), and keeps rich
  dust. A choice the player stored is left as they stored it. Nothing here was timed on
  those other cards.
- **Building.** The drawn ground, the ground map and the puddle map add 0.5 to 1.9 s to a
  track's load in the asset worker (the rounding is most of it); the snow's depth adds up to
  another 1.3 s in a Snow race, and the cover maps a few hundredths. The fog's floor is built
  on the main thread from the drawn mesh in 20 to 60 ms.
- **Memory.** The fine terrain is up to 900 000 vertices at 26 bytes each and their indices;
  the ground map is 2 MB, 4 MB with what stands over the ground, the puddle map and the shelter
  map 1 MB each, the fog's floor 8 KB. With "Rich particles" on the plain screen (no lens, MSAA)
  the copy of the screen's depth for thick dust is the screen's size, with a picture three.js
  hangs it on: 16 MB at 1920 x 1080, made as the race starts. Where the depth cannot be copied,
  the picture the scene is drawn into instead has the screen's samples and a depth: 82 MB.
- **Each frame.** Fog is five slices in every fragment, ten reads of its noise and eight of
  its floor, and in Foggy, where a line of sight passes through the top's billows, eight steps
  of five reads more (four steps in a headset). Rain and snow are one draw each field. The
  water is one pass over itself, and the bed a few lines in the terrain's shader: a point of
  open water reads the waves three times and a fourth near the eye, the gusts, the depth, the
  sky and the land in it once each, and the sun's shadows at four points of one map. The land in
  the water is one pass a frame over a map of 512 x 128 points (half floats, half a megabyte, a
  third more with its smaller copies), half of it each frame while the eye moves and none while it is still,
  reading the highest ground (a quarter of a megabyte of floats) and the ground map; the waves'
  pictures are 2 MB, an eighth more with their smaller copies. Ice is some
  thirty plate lookups a point of it (twenty more in the hairlines' patches), one read of its
  cell's list, and two reads and a star's cracks for each mark the list holds, each crack a
  few sums where the point is near enough to see it and fewer where it is not. The
  wakes are a field of 512 x 512 half floats twice over (4 MB), stepped once or twice a frame
  by one pass of a quad, and five more reads for each point of water near the eye, and one more
  where the water is churned. Drawing churned water as foam and silt cost 0.2 to 0.3 ms a frame
  more on the HD 630 below, with a truck fording in the middle of the picture, and nothing where
  the water is not churned. A rooster tail is up to ten drops a tick from each wading tire,
  from the same pool of streaks as the rest. The ground's
  weather skips its wet and snow work on dry ground, and the ground-detail grain is read only
  within the distance it shows. Nothing renders the scene twice. The lens's bright pass and its
  final pass read the finished picture; with TAA the picture is cleaned into its own target first.
- **Lamps.** A sprite a lens and a box a beam, each beam's points summed in ten steps where it
  covers the picture; a beam is drawn only where there is air to show it. The four lights of
  the pools on the ground are in every lit material's shader while any truck's lamps are lit,
  and in none while none is ("Lamps").
- **Particles and tracks.** Two draws for the particles, one or two for the tracks. In the dark, one
  light more for the sparks (and one for a start gantry's lamps), always there and put out when
  unlit, in every lit material's shader. With the switch
  off the same dusty frame is slower on the desktop card, since each of the game's puffs is a
  draw of its own; on a small chip it is the other way about ("On a small chip" below).
  The ploughed snow's map is 2048 x 2048 half floats, four to a point (32 MB), made the first
  time it is drawn, so a race that ploughs no snow has none (before, two to a point, 16 MB, made
  in every race); drawn from the tracks' own pieces and the hollows a body leaves when it must be
  ("Tracks"): 1 ms each time on the desktop card with the ring full, some seventeen times a
  second with eight trucks in Snow, and a rut in deep snow on the screen up to some thirty reads
  of it a point.
- **Tracks.** One draw for the ruts, and one for the ridges while any piece in the ring has
  them; off deep snow a piece is two triangles. Drawn in one pass: three.js draws what is
  see-through on both sides twice, back faces and then front, and a ribbon on the ground faces
  one way all along, so one of the two drew nothing. Measured at 2560 x 1440 on Voodoo Island
  with the race paused and the ring full, against the ring of 30 000 before (full too): 0.5 ms
  through the lens and 0.15 ms without (before, 0.9 and 0.7) on a clear day; in Snow, with the
  ridges drawn, 0.8 to 1.1 ms (before, 0.9).
- **Ice.** Measured at 2560 x 1440 on Voodoo Island in Snow, the race paused and the eye 18 ft
  over the pond with the ice over most of the picture, what the water costs, against the
  version that drew 16 stars at the most: 0.24 ms with no marks (before, 0.26), 0.59 ms with 16
  stars of 25 to 45 ft/s (before, 0.64), 0.6 ms with 32 (before, the 16 newest), and 1.04 ms
  with 100 or 300, where every cell of the pond lists its most and every point of it lies in
  several stars: the most it can cost. The cost does not grow with the marks kept, only with
  how thick they lie where the eye looks. On the desktop card; a headset's will differ.
- **Textures in one shader.** A graphics card may give one shader as few as sixteen textures
  (a headset's does), and a shader that asks for more is not made at all. The wakes and the
  fog's billows had brought the terrain's shader to seventeen (thirteen of its own and the sun's
  four shadow maps), over what a headset gives. The noises that several parts read are
  now one sampler each for all of them (render/noise-textures.js `SHARED_NOISE_GLSL`: the
  ground's detail, its weather and the fog each had their own of the same cloud noise, and two
  of the same detail noise), which brings it to fourteen in every weather. A part that gives
  the ground's shader another texture must keep it within sixteen.
- **Memory.** The tracks' ring is 65 536 pieces of twelve points at 36 bytes each (where it
  is, its place on the texture, the ground's lie, the way across and its mark, in bytes and
  short numbers where they will do), 28 MB, with 4.7 MB of indices, and as much again in main
  memory. Before, 30 000 pieces of twelve points at 60 bytes, 22 MB. The hollows a body leaves in
  the snow are 8192 patches of sixteen points at 56 bytes, 7.3 MB, with 1.8 MB of indices.
- **In a headset** the fine terrain is drawn to 800 ft instead of 2400, the grain is read from
  above only, the fog is cut in two slices, half the puffs are thrown, tracks end at 760 ft,
  and there is no lens and no anti-aliasing pass. The ground's shadows are part of the
  enhanced look's cost there, as its other shadows are.
