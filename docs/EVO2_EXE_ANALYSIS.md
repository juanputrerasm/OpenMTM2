# 4x4 Evolution 2: analysis of 4x42.exe

A reverse-engineering survey of the retail 4x4 Evolution 2 executable, written for OpenMTM2. It
answers four questions:

1. How does the game place and draw vegetation (the `.VEG` trees, the grass, the `.RTD` and
   `.SDW` overlays), and does any of it collide?
2. What surfaces does an Evo track have, and what do they do to grip and effects?
3. How do the tire particles (dirt, mud, sand, snow, leaves) work?
4. How does Evo 2's vehicle physics differ from MTM2's, so that it can be offered as a
   **Physics** option?

Part 2 (section 8) turns the findings into an implementation plan for OpenMTM2 and OpenPhotex.

It is a companion to `MONSTER_EXE_ANALYSIS.md`, `MTM2_PHYSICS.md` and OpenPhotex
`docs/EVO.md`. Every fact carries an address in the analysed build. Anything not confirmed in
code is marked **hypothesis** or **not traced**. No decompiled code is reproduced here: the
workspace stays in the git-ignored `re/evo2/`.

The short answers:

- **Vegetation is fully data-driven and mostly decoded.** Trees live in a 16 x 16 grid of
  512 ft sectors, up to 100 per sector. The per-tree `value` byte the readers call "unknown" is
  the tree's **yaw in 1/256 turns**, and the model slot is the tree's index in its sector `& 3`.
  Trees **are knocked over** when a truck hits them (section 2.5). Grass is procedural: the
  `.TEX` file's second number per texture is a **vegetation density class** (None, Sparse,
  Medium, Dense) that sets both the grass density and the tree spacing. A track without a
  `.VEG` (every Evo 1 track) gets procedurally generated trees from that class.
- **`.RTD` is a 1-bit shade map** (1024 x 1024, 8 ft cells), and **`.SDW` is a per-cell
  shadow texture overlay** (section 3).
- **Surfaces use MTM2's encoding**, `type * 100 + depth`, and the `.TEX` file's first number
  per texture is that value. OpenMTM2 currently treats every Evo tile as Dirt (section 4).
  Evo's grip table differs from MTM2's on five types.
- **Tire particles** are chosen by surface, scale with wheelspin, take their colour from the
  ground under them, and AUTUMN throws leaves (section 5).
- **The vehicle model is new.** The rigid body and contact framework descend from MTM2's, but
  the tires (slip angle and a lateral table), the drivetrain (torque curve, gearbox, transfer
  case, torque split, three differential types) and the aero model (reference areas, CL/CD/CY,
  damping derivatives) are Evo's own and are driven by each vehicle's `.TRK` figures. The full
  step is in `EVO2_PHYSICS.md`; multiplayer is in `EVO_MULTIPLAYER.md`.

---

## 0. Method and build

| Item | Value |
|---|---|
| Install | `~/games/evo2` (`4x42.exe`, 50 POD archives) |
| File | `4x42.exe`, 2,776,064 bytes, MD5 `d476380ab257486896ba1a6593c70e87` |
| PE timestamp | 1001433395 = 25 September 2001, 15:56 UTC |
| Machine | i386 PE32, image base 0x400000, relocations present |
| Toolchain | **Watcom C/C++** (sections `AUTO` for code, `DGROUP` for data, `.bss`), cdecl calls, no incremental-link thunks |
| Source paths | Assertion strings name the modules: `..\core\ground.cpp`, `..\core\sim.cpp`, `..\core\particle.cpp`, `..\core\vehicle.cpp`, `..\core\texlist.cpp`, `..\core\truck.c`, `..\core\skid.cpp`, `..\core\smoke.c`... |

The workspace was built with `EVO2_DIR=~/games/evo2 tools/re/decompile.sh evo2` (Ghidra 12.1
headless; 5,067 functions, one decompile failure). The helpers take `RE_TARGET=evo2`.

Conventions in this document: world units are feet, Y is up, the terrain is 256 x 256 cells of
32 ft (OpenPhotex `docs/EVO.md`). `rand()` is the C runtime's (0 to 32767, `0x60fa5c`).
"Uniform [a, b]" means `a + (b - a) * rand() / 32767`.

---

## 1. File roles, as the executable reads them

| File | Read by | What it is |
|---|---|---|
| `DATA\<lvl>.TEX` | `CTextureList::load` `0x5cb530` | `count,shadowCount` then per texture `surfaceValue,vegClass,name` (section 4.1) |
| `DATA\<lvl>.CLR` | `CGround::load` `0x46b150` | per cell, bits 0-11 the texture; an index past the list is replaced and counted ("%d invalid ground indices") |
| `DATA\<lvl>.SDW` | `0x46b150` | per cell shadow texture word (section 3.2) |
| `DATA\<lvl>.RTD` | `0x46b150` | 131,072 bytes: the 1024 x 1024 shade bitmask (section 3.1) |
| `DATA\<lvl>.VEG` | `0x469ec0`, reader `0x466af0` | trees and grass parameters (section 2) |
| `LEVELS\<lvl>.LVL` | | `vegTexture` (e.g. `MGRASS1.RAW`) and `detailTexture` (e.g. `DET7.RAW`): **not traced** beyond their names |

The cell record of the ground grid is 0x26 bytes; +0x20 is the `.CLR` word and +0x22 the `.SDW`
word.

---

## 2. Vegetation

### 2.1 The `.VEG` reader (`0x466af0`) and its defaults

The reader is versioned; fields absent from older versions get defaults:

| Field | Global | Default when absent |
|---|---|---|
| `maxTrees` | `0x673538` | |
| `treeModel` x 4 | `0x673540`, `0x673640`, `0x673740`, `0x673840` | version < 4: one model copied to all four slots; no file: `deftree.smf` |
| `treeTex` | `0x928528` | `deftree4.raw` |
| `treeLine` | `0x673940` | |
| `treeMinDist2 Dense / Medium / Sparse` | `0x67394c`, `0x673948`, `0x673944` | version < 2: Medium and Sparse are 0 |
| `treeSizeX,treeSizeY,treeBiasY` x 4 | `0x673950`, `0x673960`, `0x673970` (arrays of 4) | version < 4: slot 0 copied to all |
| `whackTrees` | `0x92858c` | read and never used again (no other reference in the executable) |
| `grassTexture` | `0x8eb2c0` | version < 5: `defscrub.raw` |
| `vegMinSize,vegMaxSize,vegBias` x 4 | `0x673068`, `0x673078`, `0x912b00` | version < 5: 2, 4, 0 for every slot |
| `vegiColorMin,vegiColorMax,scrubColor` | `0x673980`, `0x673984`, `0x673988` | version < 6: 0.35, 0.5, 0.25 |
| `treeGrid` blocks | `0x928590` | version < 3: the trees are generated (2.3) |

The stock files are version 6.

### 2.2 The tree grid

- The 256 `treeGrid` blocks are **a 16 x 16 grid of sectors** of 512 ft (16 terrain cells), not
  terrain rows. Block `b` is the sector at x `b % 16`, z `b / 16` (checked on ALASKA1: block 1
  holds x sector 1, block 16 z sector 1).
- Each sector holds a count and **at most 100** trees: positions (x, y, z) as floats, then one
  byte per tree at sector +0x4B4, then one state byte per tree at sector +0x518.
- **The per-tree byte (`value` in OpenPhotex) is `rand() & 0xFF` at placement**, and it is the
  tree's **yaw**: the renderer turns the model by `value * pi / 128` about the vertical axis
  (`0x468910`, constants 1/128 and pi at `0x63515c`, `0x635160`). A falling tree starts from the
  same angle (`0x545db0`, pi/128 at `0x64a64a`).
- **The model slot is the tree's index in its sector `& 3`** (`0x4660b0`), not derived from
  `value`.
- The state byte is set to 0xFF for every tree after loading (standing). When a truck hits the
  tree it holds the index of the falling-tree object (2.5).
- Each tree model is moved so its lowest point is at its origin and scaled to exactly
  `treeSizeX` by `treeSizeY` by `treeSizeX` of its slot (`0x467f80`).
- **Drawn height:** the stored y plus `treeBiasY` of the slot (`0x4660b0`). The stored y
  already includes a sink: the generator writes `ground + treeBiasY * (1 - r)`, r uniform [0, 1],
  and on ALASKA1 the stored heights sit 0 to 18 ft under the terrain (median 5.9 ft). The bias
  is therefore applied twice in effect: a slot with bias -15 draws its base 15 to 30 ft below
  the ground.
- **Distances:** a tree within 512 ft draws as its model, faded out between 480 and 512 ft; from
  448 ft it draws as a far billboard from `treeTex` (`0x4660b0`). At most 1,000 near trees a
  frame.
- A bounding box per sector (8 corners, `0x980190`) is built from its trees, widened by half
  `treeSizeX` and by `treeSizeY + treeBiasY` upward, for culling.

### 2.3 Procedural trees (`0x467be0`)

When the level has no `.VEG`, or one older than version 3, trees are generated. The only
exception is a level named `matt` (a developer test level). **Every Evo 1 track loaded in Evo 2
gets trees this way.**

For each of `maxTrees` attempts:

1. A point uniform over the world (0 to 8191 ft on x and z) at the terrain height there.
2. Rejected at or above `treeLine`, or below the water level + 1 ft.
3. Rejected inside the bounding box (plus 20 ft) of any level object.
4. The cell's texture gives its **vegetation class** (`.TEX` second number, 4.1). Class 0
   rejects; classes 1, 2, 3 use `treeMinDist2` Sparse, Medium, Dense as the least squared
   distance to every tree already in the sector.
5. The tree is added to its sector (rejected if the sector has 100), at
   `ground + treeBiasY[slot] * (1 - r)`, with `value = rand() & 0xFF`.

### 2.4 Grass (`0x469b20`, `0x470f40`)

Grass is not stored anywhere; it is drawn per terrain cell from a fixed random pattern.

- **The pattern:** at ground initialisation the generator is seeded with 873 (`0x369`), and a
  table of 2,048 tufts is filled (32 x 8 x 8): for each, an x and z offset uniform [0, 32] ft in
  the cell, a slot `rand() & 3`, and a size (initially uniform [2, 4]). After the `.VEG` is read,
  each size is redrawn uniform [`vegMinSize`, `vegMaxSize`] of its slot (`0x467f80`, unseeded).
  The pattern repeats every 8 x 8 cells.
- **The density:** a cell whose texture has vegetation class c > 0 draws `1 << c` tufts (2, 4
  or 8). At high detail (`0x892528`) four times as many, at most 32.
- **Trucks press grass down:** for every vehicle, the tufts of the cell it is in that lie inside
  the vehicle (`0x41de30`) get their top set to `ground + vegBias[slot] * size * 0.25`. With
  the default negative bias this sinks them into the ground.
- **Not traced:** how the slot maps to a region of `grassTexture`, how `vegiColorMin`,
  `vegiColorMax` and `scrubColor` tint grass and trees (the tree pass uses
  `0.5 * (vegiColorMin + vegiColorMax)` for its light level, `0x468910`), and what `LVL
  vegTexture` adds.

### 2.5 Trees fall when hit (`0x545db0`, `0x5460d0`)

Trees are collision objects found by the truck-object broadphase (the type test `0x41c3b0`,
called from the truck-against-object code `0x535ce0`). When a truck overlaps one:

- If the tree is standing (state 0xFF), a **falling-tree object** is made (at most 128 at once,
  "Too many tree objects"): the tree's position, its model slot, its yaw (`value * pi / 128`),
  and the **truck's velocity**. The tree's state byte stores the object's index, so the
  standing copy stops drawing.
- If it is already falling, the hit sets its velocity to the truck's again.
- `0x5460d0` (from the update `0x546180`) frees an object and compacts the list.
- **Not traced:** the fall's motion in `0x546180`, whether the tree slows the truck, and whether
  a fallen tree ever stands up again.

---

## 3. Shade and shadows

### 3.1 `.RTD`: the shade map

131,072 bytes, read whole into `0x8ca208`: a 1024 x 1024 bitmask, one bit per 8 ft square.
Bit `x8 + z8 * 1024` (x8 = x / 8, z8 = z / 8, both & 1023; order checked against the trees below), byte `bit >> 3`, mask
`1 << (bit & 7)` (table `0x673048`). A missing file is all zeros.

- **Set means in shade.** While the weather has a sun, the terrain vertex light is scaled to
  **0.35** in shade (`0x46c030`, constant `0x664684`).
- A truck in shade casts no sun shadow (`0x5f7820` through `0x477c30`).
- The tree pass ORs shade bits around every tree: up to 30 random points each within a quarter
  of `treeSizeX` (`0x467f80`). The stock files already hold that shade: on ALASKA1 every one of
  the 13,660 trees stands on a set bit, against 12% of the map overall. So `.RTD` is the baked
  shade of terrain, objects and trees, and the game adds tree shade again at load.
- Vertex light under water fades linearly to zero over 50 ft of depth (`0x46c030`).

### 3.2 `.SDW`: shadow textures

One 16-bit word per cell, stored at cell +0x22: a texture index into the full `.TEX` list (so
`ordinaryCount` and up, the shadow group). **0x8000 means no shadow** and 0x4000 is kept as a
special value (**not traced**). Other out-of-range words become 0x8000 and are counted ("%d
invalid ground shadow indices").

`.SDW` is read only when the **ground shadow** option is on (`groundShadowFlag`, `0x672eb0`;
the same flag makes `CTextureList` load the shadow group at all) and neither weather slot is
type 2 or 3. Weather 3 is Rain (`EVO2_PHYSICS.md` 1); 2 is not identified (**hypothesis**:
fog). Otherwise every cell is 0x8000.

OpenMTM2 draws both under a sun as the game does, except where it draws the sun's shadows itself
(the enhanced look, `sunShadows` in `worker/evo-track-build.js`): there the baked shade and the
shadow tiles would darken the same ground a second time under the real shadows, so both are left
off, as MTM2's `.LTE` is in that look.

---

## 4. Surfaces

### 4.1 The `.TEX` numbers (`0x5cb530`)

Each record is `surfaceValue,vegClass,name`:

- `surfaceValue` goes to an int per texture (texture list +0x6004): MTM2's
  `type * 100 + depth`. OpenPhotex calls it `param0`.
- `vegClass` goes to a byte per texture (texture list +0x8004): 0 None, 1 Sparse, 2 Medium,
  3 Dense (names at `0x673038`). OpenPhotex calls it `param1`.

Examples: Evo 1 ASPEN has Rock 1204, Dirt 204 and Grass 604/605 with classes 0 to 3; Evo 2
ALASKA1 has Dirt 202/203, Mud 402, Grass 603 (mostly class 3) and Snow 904.

### 4.2 The surface at a point (`0x4751c0`) and the types

Above the water level, the value of the cell's texture. **At or below it, 1300 (deep water), or
800 (ice) in Snow (weather 4).** This is MTM2's rule (`MTM2_PHYSICS.md` 2.3). The type names
are at `0x672ffc`, indexed by `value / 100`:

| Type | Name | Evo 2 mu | MTM2 mu | Drag density |
|---|---|---|---|---|
| 0 | Default | 1.0 | 1.0 | 0.002377 |
| 1 | Cement | 1.0 | 1.0 | 0.002377 |
| 2 | Dirt | 0.9 | 0.9 | 0.002377 |
| 3 | Water | **0.5** | 0.4 | 0.15 |
| 4 | Mud | **0.5** | 0.4 | 0.002377 |
| 5 | Sand | 0.7 | 0.7 | 0.002377 |
| 6 | Grass | 0.7 | 0.7 | 0.002377 |
| 7 | Gravel | 0.6 | 0.6 | 0.002377 |
| 8 | Ice | **0.3** | 0.2 | 0.002377 |
| 9 | Snow | **0.5** | 0.3 | 0.002377 |
| 10 | Metal | 0.8 | 0.8 | 0.002377 |
| 11 | Wood | 0.8 | 0.8 | 0.002377 |
| 12 | Rock | 0.6 | 0.6 | 0.002377 |
| 13 | Deep water | **0.5** | 0.4 | 0.15 |
| 14 | Train track | 1.0 (default) | (none) | 0.002377 |

The Evo column is `0x545ac0`, which sets the current fluid density (`0xcad9f4`) and mu
(`0xcad9f8`). Weather grip (Rain 0.8, Snow 0.6) and the tire tread table are in `EVO2_PHYSICS.md` 1 and 5.1.

`0x475350` packs the surface into an effect word: a class (Cement 10; Dirt and Sand 13; Water 1;
Mud, Grass, Gravel and Snow 5; others 0), a flag for Snow, `depth / 2`, and the type
value. **Hypothesis:** the class picks the ground sound or tire noise.

---

## 5. Particles

### 5.1 The manager (`0x4fc0a0`)

`CParticleManager` holds **300 particles** of 100 bytes in a ring (the oldest is reused), 8
smoke-puff slots of 0x48 bytes, and a second pool at +0x7798 for leaves. Particles are 3D
chunks: each is drawn with `ptcle1.smf` or `ptcle2.smf`, chosen at random.

### 5.2 When tires emit (`0x4fd850`)

Emission is evaluated at a fixed **15 Hz** (period `0x678b20` = 1/15 s), only while the
**Particle/Dirt Effects** option (`0x892484`) and `smokeEffectFlag` (`0x672f00`) are on. Each
tire is considered when it is within 0.5 ft of the ground. Two gates per tire, each with its own
timer re-armed to uniform [0, 0.2] s after it fires:

- **Wheelspin** (`0x4fc3b0`): the tire spins faster than 3 rad/s either way and its slip
  accumulator (6.3) is non-zero. Calls the debris emitter `0x4fc500`.
- **Sliding** (`0x4fc470`): the tire has any sideways velocity. Calls `0x4fcc50`, the same
  emitter for a sliding tire.

### 5.3 What a tire throws (`0x4fc500`, `0x4fcc50`, `0x4fbce0`)

The kind comes from the tire's surface type:

| Surface | Kind | Count factor | Shade value (+0x54) | Size (+0x44) |
|---|---|---|---|---|
| Cement | none | | | |
| Gravel | 1 | 1 | uniform [0.9, 1.9] **hypothesis** | uniform [0.3, 0.9] |
| Grass | 2 one time in 7, else 0 | 1 | uniform [0.6, 1.6] | uniform [0.3, 0.9] |
| Sand | 3 | 1.5 | uniform [0.5, 1.5] | uniform [0.25, 0.8] |
| Mud | 4 | 1.5 | uniform [0.7, 1.7] | uniform [0.15, 0.5] |
| Snow | 5 | 1.5 | uniform [0.35, 1.35] | uniform [0.2, 0.4] |
| anything else (Dirt, Water...) | 0 | 1 | uniform [0.6, 1.6] | uniform [0.3, 0.9] |

- **Strength:** `min(1, slip * 3 / 100)`, where slip is the tire's accumulator (6.3). Vertical
  speed is uniform up to the emitter's vertical figure times strength (thrown downward when the
  tire's vertical velocity is negative), horizontal speed uniform up to its horizontal figure
  times strength, heading backward from the tire within +/-10 degrees around a 20-degree spread.
  The velocity is turned into world axes by the body matrix. Spawn points are spread along the
  tire's motion this step with a jitter of [-0.25, 0.25] ft.
- **Colour:** sampled from the ground texture under the spawn point (`0x4783b0`), with a
  fallback of RGB (80, 55, 0) and a random brightness of 0xC0 or 0x100 of 256. **Snow is white.**
  Kind 5 also picks a random atlas cell (u 0 or 0.15625, v 0, 0.25, 0.5 or 0.75).
- **Spin:** each particle gets a random angular rate on three axes.
- **Skid marks:** the first spawn of a burst also lays a skid mark (`0x5b3a50`), except on Mud
  and Snow, or in Rain or Snow weather (3, 4).

### 5.4 Leaves on AUTUMN

On a level named AUTUMN, every 15 Hz tick, a truck faster than 15 ft/s throws **4 leaves** (kind 7)
from every tire on the ground whose bottom is over the water level (`0x89266c`), half a foot to the
side, into the second pool (`0x4fe530`). That pool holds **100** and takes no more while it is full;
it does not reuse the oldest. A leaf (`0x4fe530`, moved by `0x4fe830`, drawn by `0x4fe990`):

- is a square of half-size uniform [0.04, 0.4] ft (corners (+-1, +-1, 0) times the size), from one
  of four cells of its texture (u 0 or 0.3125, v 0 or 0.5), turning at uniform [-60, 60] degrees a
  second on each axis;
- rises at uniform [3, 8] ft/s to uniform [0.03, 0.2] times the truck's speed above where it
  started (10 ft at most; the speed comes from the fast square root `(bits >> 1) + 0x82e7cc`), then
  falls at the same speed (`0x6451d9` = -1), drifting at uniform [-0.5, 0.5] ft/s across;
- is gone once it is under the ground.

The port throws fewer, smaller leaves than this (40 at most, 1 a tick from each tire, each a
leaf's shape 0.2 to 0.5 ft long; `game/evo-particles.js`), none from a tire on Cement, and draws
none within 2.5 ft of the eye: as the game's numbers stand, a cloud of large squares surrounds the
truck, which the game's videos do not show.

The debris chunks of 5.1 are 4x4 Evolution's `MODELS\PTCLE1.SMF` and `PTCLE2.SMF` (`STARTUP.POD`,
with `ART\PTCLE.RAW`; Evo 2 ships neither): five vertices, about 0.4 and 0.6 ft across. The size
of 5.3 scales them, so a chunk is 0.06 to 0.55 ft across. The port draws a turning square of a
chunk's footprint (`CHUNK_FT` in `game/evo-particles.js`).

### 5.5 Located, not traced

Water wake and ripples (`waterWakeFlag`, `WAKE.TIF`, `RIPPLE.RAW`, classes `SWaterSpray` and
`SWaterBlob`), smoke puffs (`SSmokePuff`, `..\core\smoke.c` `0x5b4520`), and skid marks
(`CSkid`, `0x5aad30`). They are reached through vtables that the export does not resolve.

---

## 5a. Ground: the smoothed terrain (`..\core\ground.cpp`)

The 256 x 256 `.RAW` corners (1/32 ft, rows along z) are not drawn or driven as MTM2's flat 32 ft
triangles. `CGround::init` (`0x469b20`) keeps a 0x26-byte record per cell: at +0x00 a 4 x 4 grid of
16-bit heights 8 ft apart (index `z * 4 + x`), two shorts at +0x20 and +0x22 (not traced), the cell's
level of detail at +0x24 and the previous one at +0x25.

- **Filling** (`CGround::load` `0x46b150`, then `0x46ac90`): below detail 3 the sub-heights are
  planar in the cell's two triangles (`0x46ac50`, `0x46a820`, `0x46a920` / `0x46aad0` by parity), the
  same surface as MTM2's. At detail 3 or more `0x46a160` fills them with a cardinal spline of tension 0
  (Catmull-Rom; `0x5c7780` with s = 0.5, weights for t = 0.25, 0.5, 0.75 kept at `0x892600`,
  `0x892620`, `0x892640`; `0x5c7950` takes the weighted sum and rounds): the first row along x through
  corners col - 1 .. col + 2, the first column along z through rows row - 1 .. row + 2, then rows 1 to
  3 along x through the first-column values of the cells col - 1 .. col + 2. Every value is held in
  0 .. 0xFFE0. The world wraps (masks at `+0x18`, `+0x1C`).
- **Height** (`CGround::groundHeight`, `0x471cb0`, 27 callers, the vehicle's among them): the 8 ft
  sub-cell under the point (`x / 8`, `z / 8`), its four corners from this cell's grid or the next
  cell's first row or column, split into two triangles by parity (`(sx & 1) == (sz & 1)`: the main
  diagonal, as MTM2's cells are), linear inside; times the height scale at `+0x14` (1/32). So the
  trucks drive on the smoothed surface whenever it is drawn.
- **Drawing** (`0x4705f0` from `0x471a40`): each visible cell takes a level of detail by its squared
  distance from the camera (`+0x6C`, `+0x68` of the view, `0x8eb2a0`, `0x8eb2a4`): 2 draws its 5 x 5
  points (`0x46c1f0`), 1 a 3 x 3 (`0x46d900`, with the edges next to a coarser cell averaged, so no
  crack shows), 0 its corners (`0x46f280`); below detail 3 always 0. Normals by central differences
  over the sub-grid (`(dh / 512, 1, dh / 512)`, `0x66468c`); texture coordinates from 1/32 to 31/32
  in quarters (the two-pixel crop of MTM2's tiles).

The port (`OpenPhotex evoSim.evoSmoothHeights`, the terrain's fine grid; OpenMTM2
`worker/evo-track-build.js`) builds Evo 2's ground this way with "Smooth terrain" on, for the drawn
ground and the simulation alike, and at the finest level of detail everywhere.

## 5b. 4x4 Evolution 1: Lite tracks (`.LTE`)

Read from `4x4LE.exe` (Evo 1, `re/evo1`). In Evo 1 a `.LTE` is not a light file (MTM2's `.LTE` and
the FOG tables only share the extension): it is a **Lite track**, a custom track in one compressed
file that borrows the level, the tile table, the art and the models of a stock world. The menu offers
"Lite tracks (.LTE)" beside "Full custom tracks (.POD)"; the files live in `customtracks\` ("Lite
level files must be customtracks\*.lte").

- **Listing** (`0x4f7960`, `0x4f77c0`): a file of 0 bytes or more than 0x18800 (100,352) bytes is
  refused. The decoded text must start `LTE <n>` with 1 <= n <= the build's version (1); the next line,
  the base world, is kept (game + `0xb35ec`), then the SIT header is read (`0x4f7330`).
- **Loading** (`CRace::loadCurrentLiteLevelIntoMemory` `0x4f7e40`, then `simobj.c` `0x51fba0`): the
  whole file is read into memory and decoded; version 1 only; the base-world line; then the ordinary
  SIT reader (`0x51fec0`) on the text that follows, and `CGround::load` (`0x45ecb0`) on the bytes after it.
- **Compression** (`..\support\codec.cpp`, `CLZWDictionary`; reader `0x4203c0`, bits `0x41f160`):
  an LZW stream with no header. Bits are taken least significant first within each byte. The
  dictionary starts with the 256 single bytes and a code width of 8; adding an entry when the count is
  a power of two widens the code by one bit. A code is read against the dictionary's count `n` (it
  is below `n`): from the top bit of the width down, a bit where `n - 1` has a 0 is not stored (it is
  0) until a stored 0 is read where `n - 1` has a 1; every lower bit is then stored (`0x41fec0`). As in
  any LZW, the entry for the previous code plus the first byte of the current one is added after each
  code (the code equal to the count is the previous string plus its own first byte). The dictionary
  holds 0x8000 entries: the add that finds it full empties it back to the 256 bytes (`0x41fe20`) and
  the next code starts afresh, with no previous string. The same coder packs the lobby data in
  multiplayer (`EVO_MULTIPLAYER.md`).
- **Decoded layout:**

  | Part | Contents |
  |---|---|
  | `LTE 1\n` | the version |
  | `<BASE>\n` | the stock world it borrows from (`ZONA`, `CON2`...): its `.TEX` is `<base>.tex` |
  | Evo 1 SIT text | `version 6`, `<base>.lvl`, ... through `backdropModelName` and its `.smf` line |
  | int32 LE, int32 LE | `hMin`, `hMax`, in `.RAW` units (1/32 ft) |
  | 256 x 256 bytes | heights, rows along z: `hMin + floor(b * (hMax - hMin) / 255)`; when `hMin == hMax`, `hMin - 1 + floor(b / 255)` |
  | 256 x 256 bytes | tile numbers, low bytes |
  | 256 x 256 bytes | tile numbers, high bytes: tile `= (low + high * 256) & 0xFFF`, an index into `<base>.tex`; one past the table's end takes a default tile and is counted as an invalid ground index |

  The terrain block is 8 + 3 x 65,536 = 196,616 bytes, so the SIT text is everything between the base
  world's line and the last 196,616 bytes. The cell's tile goes where a stock track's `.CLR` puts it
  (the cell record's `+0x20`); `+0x22` is set to 0x8000 in every cell.
- **Samples:** `Caverav.lte` (31,009 bytes, base ZONA, decodes to 249,176) and `WORKAHEAD.LTE` (84,021
  bytes, base CON2, 349,288; one dictionary reset). Both need their base world's POD to be played.

## 6. The vehicle

### 6.1 Lineage

The simulation keeps MTM2's style: per-object scratch globals (the current body at `0xcad9xx`,
the current vehicle through `0x67976c`, dt at `0x67976c + 0x3458`), point contacts with
friction limited by the normal load (`0x547f90`, the hull and scrape-point contact, like MTM2's
`0x475960`), and the same surface encoding. **Everything that makes a truck drive is new.** Of
the `.TRK` and telemetry fields Evo 2 uses, none of the following exists in MTM2's executable:
`slipRatio`, `slip_angle`, `corneringCF`, `latFfricLit`, `critlFx`, `slipDiffType`,
`axleBias`, `torqueTable`, `spring_rate`, `damping_cf`, `refArea`, `clp,cmq,cnr`,
`xfrLowRatio`, `gearInertia`.

An Evo 2 Physics option is therefore **a new vehicle model on MTM2's world**, not a set of
switches on MTM2's model like the MTM1 option.

### 6.2 What the `.TRK` feeds (`0x5ed4b0`)

The reader stores every physics field Evo's `.TRK` carries. Layout of the vehicle object:

| Offset | Field |
|---|---|
| +0x60, +0x18C | front right and left tire (tire stride 0x12C; spin rate +0x11C relative) |
| +0x318, +0x444 | rear right and left tire |
| +0xE8 ... | tire `CF` (per tire, at tire +0x88) |
| +0x10C ... | tire `spring_arm` |
| +0x2C4 / +0x57C | front / rear axle `maxangle` (axle stride 0x2B8) |
| +0x2C8 / +0x580 | `maxcompr` |
| +0x2E0 / +0x598 | `spring_rate` |
| +0x2FC / +0x5B4 | `torque_pct` |
| +0x308 / +0x5C0 | `axleBias` |
| +0x314 / +0x5CC | `slipDiffType` |
| +0x5D0, +0x5D4 | engine RPM, engine torque (live) |
| +0x5F0, +0x5F4, +0x5F8, +0x5FC | `redline`, `redlineTimer`, `upshift_rpm`, `dnshift_rpm` |
| +0x600 | throttle |
| +0x60C ... +0x618 | `maxHP`, `maxHPRPM`, `maxTorque`, `maxTorqueRPM` |
| +0x61C, +0x620 | `torqueTableCount`, `torqueTable[]` (up to 23 entries) |
| +0x690, +0x6D0 | `gear_ratio[]`, current gear |
| +0x6B8, +0x6C0, +0x6C4, +0x6C8 | `final_drive`, `axle_ratio`, `xfrLowRatio`, the effective final ratio |
| +0x6D4, +0x6DC | `maxGear`, `gearInertia[]` |
| +0x704 | `xm.type` |
| +0x1238, +0x123C, +0x1240 | `max_brake_force_pct`, `drive_type`, transfer case (0 2WD, 1 4H, 2 4L) |
| +0x12B8 | the parts' torque modifier |

The stock CBLS24 (Chevrolet Blazer) gives an idea of the range: 2,869 lb dry, inertias 2500,
2500, 3750, springs 1450 / 761 lb/ft front and rear, a 13-point torque table peaking at 250 lb-ft,
7 gear slots, final drive 3.73, transfer low 2.72, torque split 40/60, CD 0.4.

### 6.3 The rest

The second pass traced the whole step: tires, driveline, gearbox, brakes, aerodynamics, hull
contacts and integration. It is written up in `EVO2_PHYSICS.md`, with the comparison against
Evo 1 (section 10) and the plan for the code (section 11). That document supersedes the first
pass's notes on the engine and differentials, which read +0x1238 as a rolling-resistance factor
(it is `max_brake_force_pct`: the term is brakes plus rolling resistance) and +0x123C as a drive
mode (it is `drive_type`).

---

### 6.4 Axles, bars and shocks on the truck

- **Axle models** (`0x5d3ad0`): the body model's `AXLEF` and `AXLER` groups (or `AXLEFL`, `AXLERL`)
  are each recentred on their own box (`0x5b03e0`) and scaled alike on every axis (`0x5b0630`) to
  the axle's track, the right tire's x less the left's, times **0.93** (`0x65b1b0`) when the truck
  has an axle-bar texture. Each frame (`0x5f6ec0`, `0x5f7820`) each is drawn at its axle's centre
  (axle +0x18, +0x1C, and the axle's z), rolled with the axle; the tires sit on the same rolled line.
- **Bars and shocks** (`0x5ff4d0`, drawn by `0x600eb0` through `0x5ffc00`, only for a vehicle of
  version 2 or more with an axle-bar texture, or `bigfoot.trk`): `0x5ed4b0` gives `AMT.TRK`, the
  only stock truck drawn this way, `shock2.tif`, `axlebar2.tif`, an `axlebarOffset` of
  (1.3, 0.1, 0.55) and a `driveshaftPos` of (0, 0.6, 0.55), whatever its manifest says. With
  `inner` the right front tire's x less half its width less 0.5:
  - two bars per axle from the axle at (+-inner, -0.1) in its rolled frame, 0.31 ft toward the
    truck's middle, to the body at (+-(offset x pulled 0.1 toward the middle), offset y + 0.05,
    offset z): flat strips of half-width 0.15 (`0x668174`) across in the x-y plane;
  - two shocks per tire, 0.2 ft either side of the axle, from (+-(inner + 0.22), 0.2) in the
    axle's rolled frame straight up to x +-(inner - 0.03) at y 1.2 (front) or 1.7 (rear), plus 1.16
    or 0.66 when the low-detail body is taller than 7.5 ft (`0x65f3fd`): strips of half-width 0.13
    (`0x668178`) in the x-z plane;
  - a driveshaft model stretched from `driveshaftPos` to each axle (`0x601510`), not drawn by the
    port.

OpenMTM2 (`game/evo-suspension.js`, `worker/foreign-truck-build.js`) draws all of these but the
driveshaft. JSTruckViewer drew the axle groups where the model file puts them.

### 6.5 What moves, and what collides

Over the 50 stock archives the `.SIT` classes are CCollide 27,955, CCollisionBox 5,645, CNonCollide
2,446, CCheckpoint 345, CTriggerBox 215, CTrain 42, CFlyingObject 39 and CTreasure 30.

- **CTrain** is MTM's type 10 (the reader `0x41d560` makes a CTrain of a type 10 box, with its
  `trainVelocity`, `0x41d450`). Up to 32 are listed (`0x551620`, "Too many trains"); each tick
  (`0x5519xx`) moves one by its velocity's x and z, in world axes, sets its height from the ground
  under it, and wraps it round the world (`0x5502e0`): MTM2's moving object. FM109's train (18,
  at -60 ft/s), OILFLD's (15) and THEHILL's semis (7) move.
- **CFlyingObject** has no motion of its own. Its class (`0x41b610`, vtable `0x662f94`) differs from
  the others only in its frame step (`0x41df50`, a bare return) and in never being culled by distance
  (`0x439850`, `0x4394b0`). What makes the helicopters and planes fly is an object path (6.7).
- **Frame animation** (`0x41dfb0` and `0x41def0`): an object's frame advances by `dt / timePerFrame`
  and wraps at the model's frame count. The stock animated models are rotors (AK4407R1, R2), the
  shark (ISSHK), fish, a diver, birds, vultures, an eagle, the lion, a helicopter, a windsock,
  flags, a sign and pump jacks (FS3PUMP, 0.1 and 0.083 s a frame); 30 or so frames each.
- **CCollisionBox** is a model-less box, the collision of what a CNonCollide draws. 1,477 of them are
  tilted or rolled: SHTARTC's ramp (AA3RMP, a CNonCollide) is the slab (4.5, 121, 36.5) rolled 103
  degrees, so its 121 is its length and its 4.5 its thickness.
- **Placed birds** (VULTURE's and TRIBAJA's vultures, the eagle) are CNonCollide whose frames flap
  their wings; most fly an object path (6.7).
- **AI life** (`CAILife`, `..\core\ailife.cpp`, `0x407770` to `0x40a270`) is the birds that fly, on
  every level while the `ailife` setting (`4x42.ini`, read at `0x47e770`, default on) is set. Set up
  at level load (`0x551620` calls `0x409710`): one model, `LIFE.POD`'s `MODELS\BIRD.SMF` (osprey
  art, `OSPREY.RAW` and `.OPA`), and **4 flocks of 8 birds** (flock stride 0x5DC bytes, bird 0x78).
  - A flock's target (`0x408b80`, flock +0x80) is a random point of the computer drivers' lines
    (the AI system's path list, `0x6706ec` + 4, `0x40ad60`), or with none a random checkpoint, 20 ft
    up (`0x62e3c5`).
  - Each bird (`0x4080f0`) steers as a boid: toward the target at 0.3 (`0x670670`), toward the
    flock's mean velocity at 0.1 (`0x670674`), and apart from its flock mates closer than its
    separation distance and from vehicles within twice their size (at least 5 ft) at 0.3
    (`0x409420`, `0x670678`); each velocity component is held within +-24 ft/s (`0x670690`).
  - A bird can sit (bird +0x68): it takes off (`0x407d30`) when its timer runs out or a vehicle
    comes within twice its size (`0x62e3b1`).
  - A flock (`0x408d80`, only with 3 checkpoints or more) picks one of 5 modes every uniform
    [60, 120] s (`0x409390`): 0 and 1 move its target along the line forward or back a point at a
    time, each point lasting its length over a random 20 to 39 ft/s; 2 and 3 hold it; 4 brings it
    down to the ground under it (the birds land).
  - A bird keeps 10 to 48 ft over the ground (20 ft/s^2 up or down, `0x670680`, `0x670684`,
    `0x670688`) and within 64 ft of the target on x and z; under the ground it sits for uniform
    [0, 12] s (`0x407d30`) and takes off at 2 ft/s. Its wing frames (BIRD.SMF has 31) run back and
    forth at `(k * 10 + 2) * frames` a second, k its climb plus, under 7 ft, `1 - height / 7`; over
    7 ft and not climbing it glides.
  OpenMTM2: `game/evo-life.js` and `render/evo-life.js`, the "Evo AI life" switch (on, as the game's
  setting). The flocks follow the first recorded AI line of the track; a vehicle's size for the birds
  is a truck's 8 ft (the game's per-vehicle figure is not traced).
- **Objects that move when hit** (`0x552fe0`, `0x553110`): every object with a mass over 0 and no
  parent is a moving one, the rest static. Stock Evo 2 has 6,417 CCollide with a mass of 1 or more
  (signposts, fences, crates, barrels, mailboxes, buses), in slugs as MTM2's (a mailbox 6.2, 200 lb).
  OpenMTM2 makes each MTM2's level box, as heavy as the SIT says (at least 1).

OpenMTM2 (`worker/evo-track-build.js`, `worker/evo-models.js`): CTrain runs as MTM2's moving
object; every frame of an animated model is a morph target, played at the placement's
`timePerFrame`; a collision box's height is along whichever of its axes stands nearest upright, a
collision box is a solid box turned every way (the simulation's immovable box, whose top the tires
ride as on MTM2's boxes); a rock's (collisionType 1) faces that look up enough are ground and the
ones steeper than 50 degrees walls, each the triangle itself, solid 2 ft behind it (`steepFace`;
OpenPhotex `collideTruckFace`), faced the way the model's normals point. Driven on as a surface only,
a rock's side and a deck's edge were met by nothing, and a slope rising ahead of the front wheels
faster than the 1 ft allowance under the body was not yet ground: the truck went under it and
inside. A box laid on each face (a slab a foot thick, the face's rectangle) was tried first: a
triangle's rectangle is twice its area, and what of it stood past the rock's outline was a wall in
the air beside the cliffs (Vulture Canyon has 11,067 such faces, up to 342 boxes in a 64 ft cell).

### 6.7 Object paths and track scripts

What moves PEAK's F-15s (one low over the course, three high in formation), ALASKA's helicopters,
VULTURE's vultures and the boats, animals and vehicles of about 40 stock tracks is neither their
class nor AI life: it is the `.SIT`'s last section, `#*** Paths ***` (read at `0x4f2840` after the
courses, "Loading paths", OpenPhotex `EvoSit.paths`), stepped every frame by `0x4f3680`
(`CObjectPath`). A path moves one box (`object`, counted from 1 in the box list).

- **The parameter `t`:** its whole part is the segment (`0x4f3cf0`: modulo the points; with
  `direction` 1 forward and back; any other value the first segment), its fraction the place along
  it by length.
- **Lengths** (`0x4f2840`): a path going round (`direction` 0) measures every segment, the last back
  to the first; one going back and forth all but the last, which stays 0. A curve is measured over 64 chords (`0x4f4950`, which
  keeps the table for `0x4f3d60`), a straight segment (`segmentFlag` 1) as one (`0x4f44e0`).
- **Position** (`0x4f3e30`): a cardinal spline through the points before, at, after and two after
  (`0x5c7780`, `s = (1 - tension) / 2`, Catmull-Rom at tension 0; `0x5c79b0`), at the parameter whose
  length is the fraction's (`0x4f3d60`); a straight segment by the fraction (`0x4f4260`). With the
  point's `followTerrainFlag` the height is the ground's plus the model's bottom.
- **Orientation** (`0x4f3ee0`): with the point's `orientFlag` a slerp from its `wOrient` to the
  next's (`0x60efa0`, `0x60ea10`, `0x60ecd0`); otherwise along the curve's tangent (`0x5c7bf0`) or the
  segment, as pitch `-atan2(dy, horizontal)` and heading `atan2(dx, dz)` (`0x5e98a0`); with
  `followTerrainFlag` to the ground's normal (`0x472640`), smoothed as `now * dt + before * (1 - dt)`
  and made unit (`0x4f4e20`, about a second to follow): up along it, forward the way laid on it
  (`(normal x way) x normal`). The game keeps one smoothed normal for all such paths (`0xb2cabc`);
  OpenMTM2 keeps one a path.
- **Advance** (`0x4f39a0`): with a path `time` over the sum of the pauses, `t += (length / (time -
  pauses)) * dt / segment length`; else with the point's `time` over 0, `t += dt / time`; else at the
  point's `vel` (mph, `0x6449e5` = 1.46667 ft/s each), blended to the next point's by the fraction
  unless `velFlag`, over the segment's length. A segment of no length does not move.
- **Pauses:** at a point with a `pauseTime`, its fraction 0, the object waits that long (`pauseTimeElapsed`)
  and goes on with the rest. Reaching the next point (`t` past its whole), `t` is set to it and the
  step's rest goes on from there, or starts the wait.
- **End:** a type 0 path stops once `t` reaches `cycles` times the points (twice less 2 with
  `direction` 1, `0x4f3c90`); type 1 never does. Every stock path is type 1, direction 0: it goes round
  for ever. PEAK's low F-15 laps its 29 points at 80 mph in about 30 s, over the course each time.
- **Fields not acted on:** `collisionType` is read and cleared (`0x4f26c0`) and never used: the
  object collides as its class does. `animationFlag`, `lightFlag` and `AIFlag` are read and never
  used either: no code but the path code reads the point records, and it reads none of the three
  (editor data). The object's own frames (a vulture's wings, a rotor) run as its class has them. The
  cameras use the path objects (`0x4117a0` finds the nearest to the camera's subject, `0x436c90` lists
  them among its subjects).
- **Stopped paths** (`stopFlag` 1) wait for the track script: `startPathObject(n)`,
  `stopPathObject(n)` and `togglePathObject(n)` clear, set and flip it (`0x450170`).

The scripts are `SCRIPTS\<track>.SC` (OpenPhotex `parseEvoScript`): rules of conditions
(`objectsIntersect(trigger, vehicleN)`, a CTriggerBox by its `name`, or flags raised by `raise`) and
actions. VULTURE starts two vultures when the player enters the trigger box `boxc`; DESERT and MEDI
start and stop their convoys the same way.

**Timing** (`0x455140`, run every frame by `0x45fe60`): every rule is tried every frame. A rule with
no condition acts every frame; one with conditions acts every frame they hold (it is level, not edge,
triggered: a `togglePathObject` under a held condition flips every frame). A rule may instead `goto` a
label (`label:` lines, `0x4551f0`; none in the stock scripts). `raise(flag, d)` (`0x450170`) takes `d`
as seconds (`%f`), `once` (one frame), `forever` or `clear` (taken away); raised flags are queued and
taken in after the rules (`0x44ff50`), so a rule sees them from the next frame, and timed ones run
down by the frame's time. Every stock `raise` is `forever`.

OpenMTM2: `game/evo-paths.js` (the rules), `worker/sim-worker.js` (each path's boxes, and what hangs
from them by `parent`, moved every step; the script acted on for objectsIntersect, flags, the path
commands and Message, shown in the caption; money, objectives, secrets and tides are the career's and
are not acted on; a message a rule keeps saying is shown once).

## 7. What OpenMTM2 did, and does now

**Built, to be tested** (`src/worker/evo-track-build.js`, `render/evo-grass.js`, `render/evo-particles.js`,
`game/evo-particles.js`, `game/falling-trees.js`; OpenPhotex `src/evo/vegetation.ts`):

| Before | Now, as the game |
|---|---|
| Every tile is Dirt (`textureValues: [200]`) | Each texture's `surfaceValue` from `.TEX` (4.1) |
| Tree model slot `(value & 3)` | Index in sector `& 3` (2.2) |
| Tree yaw `((value >> 4) & 15) * pi / 8` | `value * pi / 128` (2.2) |
| Tree base on the terrain | Stored y plus `treeBiasY` (2.2) |
| Trees are trunk boxes that stop trucks | A truck knocks a tree over and goes on (2.5; the truck's side and the fall are the port's) |
| No trees on Evo 1 tracks | A generated forest from `vegClass` (2.3), with the level's own tree models ("Evo forest") |
| Every tree drawn as its model at any distance | Models near the camera, the `.VEG`'s `treeTexture` cards farther (2.2; by 1024 ft chunks, models within 512 ft of a chunk's edge) |
| No grass, `.RTD` or `.SDW` | Grass around the camera, pressed under trucks ("Evo grass"); shade at 0.35; shadow tiles swapped in, under a sun (2.4, 3.1, 3.2) |
| MTM2's grip table | Evo's under the Evo physics models (4.2); MTM2's under MTM2's |
| No Evo particles | Debris by surface from spinning and sliding tires, leaves on AUTUMN ("Evo particles", 5) |

OpenPhotex now reads the 256 `.VEG` blocks as sectors with the yaw byte, names the `.TEX`
numbers `surfaceValue` and `vegClass`, and reads `.RTD` and `.SDW` (`docs/EVO.md`).

---

## 8. Implementation plan

The work splits into what is fully known (sections 2 to 5), which can be built now, and the
Evo 2 vehicle model, which needs a second RE pass first, as MTM2's physics did.

### 8.1 OpenPhotex (formats first): built

1. **`.TEX`:** name the record fields `surfaceValue` and `vegClass` (keep `param0`/`param1` as
   aliases for one release). Export `EVO_VEG_CLASS` names.
2. **`.VEG`:** document the 16 x 16 sector order; expose `sector` and `indexInSector` per tree,
   rename `value` to `yawByte` (alias kept). Add `evoTreeYaw(byte)` and `evoTreeSlot(index)`.
3. **New readers:** `parseEvoRtd` (1024 x 1024 bitmask, with `evoShadeAt(x, z)`) and
   `parseEvoSdw` (256 x 256 words, 0x8000 none). Both are fixed-size grids. `.RTD` bit
   `x8 + z8 * 1024`, least significant bit first (checked against the VEG trees, 3.1).
4. **`evoProceduralTrees(heights, clr, tex, veg, objects, waterLevel)`**, implementing 2.3
   deterministically: the game used unseeded `rand()`, so the port picks a seed (from the track
   name) and says so.
5. **`evoGrassPattern()`**: the 2,048-tuft table of 2.4 with the MSVC-compatible `rand()`
   seeded at 873. Watcom's `rand()` must be checked against MSVC's before claiming the same
   pattern (**to confirm**).
6. Tests over the stock archives: every `.TEX` value is a known type, the `.RTD`/`.SDW` sizes,
   the sector bounds.
7. **Evo surfaces in the sim:** `SURFACE_MU_EVO2` (4.2) and type 14, selected by the rules.

### 8.2 OpenMTM2: track features (no physics change): built but for 7

In order of value for effort:

1. **Surfaces** (`evo-track-build.js`): `sim.textureValues` from `.TEX` `surfaceValue`. The
   MTM2 truck then feels mud, snow, ice and rock on Evo tracks, and `tire-effects.js` and the
   sounds see the right surface. Small change, large effect.
2. **Trees done right:** slot, yaw and height from 2.2; procedural trees for Evo 1 tracks (8.1
   item 4); near model within 512 ft and billboards beyond 448 ft (`src/render/billboards.js`
   already draws cutouts).
3. **Grass** (`src/render/scenery.js` or a new `src/render/evo-grass.js`): instanced quads per
   cell from the pattern and `vegClass`, drawn within a radius of the camera, textured from
   `grassTexture`, pressed down under trucks (2.4). Behind the existing scenery and graphics
   switches.
4. **Shade and shadows:** `.RTD` darkens the terrain vertex light to 0.35 (fed to
   `src/worker/terrain-mesh.js` as a per-vertex factor) and suppresses a truck's sun shadow
   (`src/render/sun-shadows.js`); `.SDW` as a second terrain texture layer from the shadow group,
   off in overcast weathers, with the ground-shadow switch.
5. **Particles** (`src/game/particles.js` and `src/render/particles.js`, in the manner of
   `mtm1-particles.js`): an `evo` particle style with the kinds, gates, strength and colours of
   section 5, chunk models `PTCLE1.SMF`/`PTCLE2.SMF` from Evo's archives (falling back to the
   current sprites), AUTUMN leaves. Skid marks off on mud and snow (`tire-tracks.js`).
6. **Falling trees:** a tree hit by a truck becomes a moving object with the truck's velocity
   (`level-movers.js` has moving objects already) and stops being solid. Until 2.5 is traced
   further, the fall itself (pivot at the base, falling away from the truck) is the port's
   choice and must be documented as such.
7. **Later:** `.WAT` animated water (OpenPhotex reads it), the `detailTexture`, water wakes
   (5.5).

### 8.3 The Evo 2 Physics option

Superseded by `EVO2_PHYSICS.md` section 11, written after the second pass: Evo 1 and Evo 2
physics as two entries of `PHYSICS_MODELS`, a new `src/sim/evo/` module in OpenPhotex on MTM2's
world and collision code, Evo vehicles on their own `.TRK` figures, MTM and CPR vehicles on
MTM2's vehicle model.

### 8.4 Other Evo features worth considering

- **Garage settings with the game's meaning:** springs, shocks, torque split, brake balance,
  handling and transfer gear have setters in `vehicle.cpp` (`0x5ecba0` and following) with the
  in-game help texts. They map onto the Evo 2 model once it exists.
- **Parts:** `PARTS\PARTS.TXT` holds Aero, Brake, CG, Tire CF, Torque and Weight modifiers per
  part (`0x5dbe20` prints them). Stock parts per vehicle are in the `.TRK`.
- **Missions** (`MISSIONS\*.MSN`, `SCRIPTS\*.SC`): the script language has conditions such as
  `objectsIntersect`, `vehicleIn4WDHigh` and `waterLevelInRange` (`0x4528a0`). That is enough to
  start on El Norte and Obs Park missions, which load as free roam today.
- **Truck lights:** every Evo `.TRK` lists light cones (`coneTexture`, `coneLength`), which
  `truck-lights.js` could draw at night.

---

## 9. Still open

- Grass slot to texture region, and the colour parameters (2.4).
- The falling tree's motion and its effect on the truck (2.5).
- The `.SDW` 0x4000 value, and the weather numbering (3.2, 4.2, 5.3).
- Weather grip and the tire-cut table under Evo (4.2).
- Water wake, spray, smoke puffs and skid marks in detail (5.5).
- Whether Evo 1's executable (`~/games/evo1/4x4LE.exe`) differs from Evo 2 on any of this. The
  data formats are the same (ASPEN has `.TEX` classes, `.RTD` and `.SDW`).
