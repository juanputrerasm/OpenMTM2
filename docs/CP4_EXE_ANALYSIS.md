# Community Patch 4 beta 0.52: analysis of monster.exe 2.0.52.2

This is a reverse-engineering survey of the Community Patch 4 (CP4) beta 0.52 executable, by the
developer Fila. **Its author published no source code.** Everything here comes from our own
analysis of the binary (a Ghidra decompile kept in the git-ignored `re/cp4/`, made with
`tools/re/decompile.sh cp4`; working notes in `re/cp4/notes/`). Where useful it is compared with
the Traxx 1.7 track editor source (same developer; it carries `terrainspline.c` word for word),
with CP3 (`CP3_EXE_ANALYSIS.md`) and with retail 2.00.42 (`MONSTER_EXE_ANALYSIS.md`).

Each answer is marked **CONFIRMED** (seen in code), **INFERRED** or **UNKNOWN**. Function
addresses (`FUN_...` or bare hex) and globals are for this exact build. World coordinates are
1/256 ft and a classic tile is 32 ft (`coord>>13 & 0xff`), as in retail.

| Item | Value |
|---|---|
| File | `monster.exe`, 10,252,288 bytes, MD5 `3938c3fb3f2f8b47cc6ca9075e49ccbe` |
| Version | 2.0.52.2, PE32+ x86-64, image base 0x140000000 |
| Version in the MP join packet | 0x3402 (CP3: 0x3400, retail 0x0201) |

---

## 1. Terrain

| Address | Does |
|---|---|
| `1401c5670` | ground loader (`Ground.cpp`) |
| `1401d9b70` | reads `%s.TXV` |
| `1401f8ff0` | parses the TXV keys; `1401f8db0` reads the string key `terrainHeights` |
| `1401d9830`, `1401fa900` | load the `terrainHeights` PNG; gray PNG decoder |
| `1401d8fb0` | resolves the mode, builds the heights, writes `terrain.txt` |
| `1401fa820` | the size/mode table |
| `14010dc70`, `14010def0` | `terrainSplineExpand`, `terrainSplineSeg` |
| `1401c0600` -> `1401f9510` | ground height query (classic / fine) |
| `1401c0af0`, `1401f96d0` | ground normal (classic / fine) |

The mode is the global `1473f9f90`: 0 classic, 1 spline, 2 fine.

### 1.1 TXV keys (CONFIRMED)

- `%s.TXV` is named after the track (name up to 64 chars). The file must be 1..65536 bytes; larger
  or unallocatable gives "This track's .TXV record is unreadable; terrain loaded as classic."
- `key = value` lines, `#` comments, blank lines skipped, keys case-insensitive (`1406fdbe0`, stricmp).
- `formatVersion`: atoi, clamped to at least 1. Above 5 shows "This track needs a newer build." and
  loading continues.
- `terrainGrid` (up to 63 chars): missing or `classic` = 0, `spline` = 1, `fine` = 2, anything else -1.
- `terrainHeights`: PNG name, up to 64 chars.

### 1.2 Size to mode (CONFIRMED, `1401fa820`)

Size class: RAW 65536 or 131072 bytes = class 1 (256x256), 2097152 = class 2 (1024x1024), other = 0.
PNG width 256 = class 1, 1024 = class 2.

| terrainGrid | class 1 | class 2 | other |
|---|---|---|---|
| missing / classic | classic | fine, warning | classic |
| spline | spline | fine, warning | classic, warning |
| fine | classic, warning | fine | classic, warning |
| unknown (-1) | classic, "needs a newer build" | classic | classic |

**131072-byte RAW, no TXV (CONFIRMED):** classic 16-bit. `1401c5670` reads two `fgetc` per sample,
little-endian, and stores `(hi<<8|lo)>>1`. Every other classic size reads one byte per sample as
`byte<<7`, as retail. Retail (`4f78d0`) and CP3 (`140175700`) always read 65536 single bytes as
`byte<<7` and know no TXV terrain keys, so with a 131072-byte RAW they take the first 64 KiB byte by
byte: garbage terrain.

### 1.3 Units (CONFIRMED)

- Both grids store **1/64 ft** in signed 16 bit: the classic grid `1457caae0` (256x256 cells of
  6 bytes: s16 height, then the CLR word) and the fine grid `1473f9f98` (1024x1024 s16).
- Every 16-bit source (RAW16, PNG16, spline output) with v = ft*128 is stored as **u = v>>1**; the low
  bit is lost. 8-bit sources give 2 ft steps on every path: classic `byte<<7`; spline input `byte<<8`
  then `>>1` after the expand; an 8-bit PNG is widened with `psllw 8` (a 1024 8-bit PNG logs
  "8-bit fine height map: 2 ft steps").
- Height queries return `h*4`, i.e. 1/256 ft, as retail `501820`.

**512 ft ceiling (INFERRED):** from the u16 source (65535/128 = 511.99 ft) and the s16 grid at
1/64 ft (32767 max; `v>>1` cannot set the sign bit). No other clamp in the loaders or height
queries; the spline clamps only to 0..65535 in v units. Renderer and AI not searched.

### 1.4 PNG heights (CONFIRMED)

Gray only (colour type 0 or 4, alpha ignored), 8 or 16 bit, 256x256 or 1024x1024, file up to 16 MB.
Anything else logs "PNG not used" and falls back to the RAW. A 256 PNG feeds the spline directly.

### 1.5 Spline (CONFIRMED, identical to Traxx `terrainspline.c`)

| Address | Table | Values |
|---|---|---|
| `14079da40` | BA | {0, 54, 32, 10} |
| `14079da50` | BB | {0, 9, 8, 3} |
| `14079da60` | BC | {0, 10, 32, 54} |
| `14079da70` | BD | {0, -3, -8, -9} |

`terrainSplineSeg` (`14010def0`): for k outside 1..3 it returns p1 clamped to 0..65535. Tangent
n = 2*dl*dr / (dl+dr), 0 when dl*dr <= 0 (the sign of a negative denominator moves to the
numerator). Result r = floor((2N + 64*q1*q2) / (128*q1*q2)) clamped to 0..65535, with
N = (A*p1 + C*p2)*q1*q2 + B*n1*q2 + D*n2*q1. `terrainSplineExpand` (`14010dc70`) runs pass 1 along X
on the coarse rows and pass 2 along Z on every fine column, both wrapping at 256; it matches Traxx
line for line and works in v units, the `>>1` comes after. Inputs: a 131072-byte RAW is `fread` as
65536 u16; 65536 bytes as `byte<<8`. Spline is load-time only; at run time it is the fine grid.

Spline/fine also build: classic height (r,c) = fine[4r][4c]; `14598ec10` the minimum of the 5x5 fine
samples per coarse cell (`1401f9fd0`); two 1 MiB shading maps `1473f9fa0`/`1473f9fa8`
(`1401d8a50`). Any allocation failure loads classic with a message.

### 1.6 Ground query in fine/spline mode (CONFIRMED, `1401c0600` -> `1401f9510`)

- Called with (row, col) in 1/256 ft. Classic mode is retail's code (32 ft cells).
- Fine: cell = `pos>>11 & 0x3ff` (2048 units = **8 ft**, wraps at 8192 ft); fraction
  `(pos & 0x7ff) * 32` as 16.16.
- Triangle diagonal by the checkerboard `(row ^ col) & 1` over fine cells, as retail; linear
  interpolation in the triangle with retail's four cases; result `h*4` (1/256 ft).
- Normal (`1401f96d0`) is (dh*4, 0x800, dh*4) where retail uses 0x2000.

### 1.7 Missing files (CONFIRMED, `1401c5670`)

- No `terrainHeights` and no RAW: fatal "Cannot open ground alt file!".
- `terrainHeights` set, PNG fails, no RAW: flat world (all 0), logged "mode classic NO height file".
- **`.RA0` missing:** RA0, RA1 and CL0 are zeroed ("NO GROUNDBOXES") and loading continues. CP4's
  own log says "CP3 and older stop loading the track here" (INFERRED, not checked in CP3 code).
  RA0 present but RA1 or CL0 missing is still fatal. RA0/RA1 are read as `byte<<7`, as retail.

## 2. Lakes (.WTR) (CONFIRMED unless marked)

Loader `FUN_140204040`, parser `FUN_1402034b0`. File `WORLD\<lvl>.WTR`, same POD as the level. Log
`waterbodies.txt` only when `waterBodyLog=1`.

- Header: 'MWTR', u16 major (must be 1), u16 minor, u32 directory offset (>= 0x20), u32 chunk count,
  u16 256, u16 256. Directory entries 16 bytes: {tag, version 1, offset, size}.
- `TMAP`: exactly 0x10000 bytes, one body id per tile, index z*256+x.
- `BODY`: u32 count, u16 stride (>= 0x40), records from +8:

| Offset | Field |
|---|---|
| +0 | u8 id, 1..255, unique |
| +1 | u8 seed count, 1..8 |
| +2 | u16 flags |
| +4 | u32 height |
| +8 | 8 x (u16 x, u16 z) seeds |
| +0x28 | u8 box x0, z0, x1, z1 |
| +0x2c | u32 tile count, must equal the TMAP count |

- **Surface Y = height * 128** in 1/256 ft, so height is in **half-feet**.
- Validation in order: HEIGHT_RANGE (height not 1..4096); NO_TILES; BELOW_BODY0 (surface at or
  below the track's own water); TOUCHES_BODY0 (a tile's bed at or below that water; the bed is the
  lowest of the tile's 4 classic corners or its 5x5 fine samples).
- **Physics:** `FUN_140203ed0` runs per tire: on a lake tile (TMAP lookup) with the contact point
  below the surface, the surface code becomes `0x05140000 | low16`, i.e. 1300 (deep water).
  `FUN_140205570` returns the water level at (x, z), lake or track water (24 callers).
- **Reflections:** lakes are grouped by distinct height, lowest first. The base plane is the track
  water, or the lowest lake if none. A group gets its own pass when more than `waterLakeOwnPass`
  above the base. Extra planes per frame = min(renderer slots - 1, `waterMirrorExtra`), so the cap
  of 3 is base + 2 (slot count from the renderer: INFERRED).

| INI key | Default | Range |
|---|---|---|
| waterLakeReflect | 1 | |
| waterLakeSteps | 16 | 4..32 |
| waterLakeThickness | 4 ft | 1..64 |
| waterLakeDebug | 0 | |
| waterLakeOwnPass | 10 ft | 0..2048 |
| waterMirrorExtra | 2 | 0..8 |

## 3. Vegetation (.VEG) (CONFIRMED unless marked)

Loader `FUN_140202390`, parser `FUN_1402010f0`. Same container as WTR with magic 'MVEG'. Chunks, all
version 1: `SPEC`, `TREE`, `GRAS`, `RULE` (presence flag only), `INFO` (text up to 511 chars). Caps:
64 species, 32768 trees, 131072 grass clumps. Log `vegetation.txt`.

SPEC record (stride >= 0xC0):

| Offset | Field |
|---|---|
| +0 | char[64] model |
| +0x40 | char[64] far card |
| +0x80 | kind: 0 tree, 1 grass |
| +0x81 | collide 0..2 |
| +0x82 | flags: 0x04 crossfade band, 0x08 no far card |
| +0x84 | trunk width, 1/64 ft |
| +0x86 | trunk height, 1/16 ft |
| +0x88 / +0x8a | model fade, default 900 / 1000 ft |
| +0x8c / +0x8e | far card band, default 900 / 1000 ft |
| +0x90 | grass draw distance |
| +0x94 | char[32] name |

TREE record (stride >= 0x14): i32 x, i32 y, i32 z, all 1/256 ft (x and z < 0x200000, 8192 ft; corrected: an earlier reading had z second, but Traxx 1.7's writer puts y second and Fila's sandbox `fog_test.pod` agrees, its second field spanning 203..350 ft, ground heights, the first and third 1238..6655 ft); u16 species;
u16 heading (1/65536 turn); u16 scale (1/4096, >= 0x100); u8 +0x12 not traced (UNKNOWN); u8 +0x13
detail tier: drawn and collidable only when tier <= the scenery detail setting.

GRAS: u32 clump count, u16 stride (>= 0xC), u32 tile count; tiles 12 bytes {u16 tx, u16 tz, u32
first, u32 count <= 1024}, strictly increasing. Clump: u16 species, u8 fx, u8 fz
(x = ((tx<<8)|fx)<<5), i32 y, u8 heading (1/256 turn), u8 scale (b/64 + 0.25), u8 not traced.

**Distances** (all times `vegLodScale`/100, default 100, range 10..1000): without flag 0x04 a single
swap at floor((900+1000)/2) = **950 ft**; with 0x04 the model fades out and the card fades in over
900..1000 ft. Grass: species distance or `vegGrassDist` (default **1000 ft**), fading from 0.75 x
distance. `vegGrassDensity` default **100** % (1..100) keeps ceil(n*d/100) clumps per tile.
`vegGrass` default **1**.

**Collision:** collide 1 = trunk cylinder; width defaults to 30 % of the model radius (refined from
vertices near the base, clamped 1 ft..2x radius), height to 30 % of model height (6 ft..full height),
both times the tree scale. collide 2 = the model's own collision. Pool of 128 slots; each truck gets
its 24 nearest trees within scale*bounding radius + truck radius + 10 ft.

Details (CONFIRMED, `FUN_140208440`, `FUN_140207ef0`, `FUN_1402079f0`): only kind 0 species with a
model and collide != 0 collide. The model radius is `max(dx, dz) / 2` of its bounds, base Y and top
Y from the same bounds. Trunk width is SPEC +0x84 / 64 ft when set; else 30 % of the radius, replaced
by 65 % of the x/z spread of the model's vertices within 5 ft of the base when more than 2 are there,
then clamped to 1 ft .. 2 x radius. Trunk height is SPEC +0x86 / 16 ft when set; else 30 % of the
model height, at least 6 ft and at most the model height. Both times the tree scale; the cylinder's
centre is at base + h / 2. collide 2 builds a scenery object from the model, every dimension scaled.
A far card is loaded only for a tree species without flag 0x08. The tier filter applies to the pool
as to drawing. (The Traxx 1.7 writer, OpenPhotex `mtm/veg.ts`, calls flag 1 "cast shadow", 2 "far
shadow" and 8 "facing"; the engine code above reads 8 as "no far card" and was not seen reading 1
or 2. These agree: Traxx's own header defines facing as "always turn to the camera; needs no far
card" (TrackPODVegetation.h), so 8 is one flag seen from two sides. Where the engine turns a facing
species to the camera is not traced; until it is, a reader draws it without a far card.)

## 4. Fog volumes

**Parse (CONFIRMED):** after a SIT/SI2 box, a line starting with 'F' (the 'Ffog' comment) is followed
by a value line of 12 floats, 1 int and 5 floats; kept only when the box type is 14. At most 64.

| Field | Default |
|---|---|
| w, l, h | 0 (falls back to the box size) |
| base | 0 |
| vis | 300 |
| r, g, b | 0.75, 0.78, 0.82 |
| half | 8 |
| edge | 20 |
| top | 5 |
| maxOp | 1 |
| wmask | 0x1ff |
| round, wisp | 0 (clamped 0..1) |
| wsize | 40 (min 1) |
| wspd | 3 |
| bot | 0 |

**Per frame (CONFIRMED, `FUN_1401b7610`):** a volume is skipped unless `wmask & (1 << weather)`, when
any of w, l, h <= 0.5 ft, or when its horizontal distance (dx, dz wrapped at 8192 ft) minus its
radius is beyond the draw range plus one tile (32 ft). The centre is the box position with Y + base,
the heading axis the box rotation's. The nearest `fogVolumeMax`
(default 16, 1..16) are sent; `fogVolumes` default 1.

**Shader inputs (CONFIRMED in the exe):** base is the bottom face, half-extents w, l, h * 0.5;
**extinction = 3 / vis** (about 5 % transmission after vis ft); height falloff = 1 / half; soft edge
= min(edge, half the smaller of w and l); soft top = min(top, h); soft bottom = min(bot, h); wisp
frequency = 1 / (wsize * 8), phase scrolled at wspd. **UNKNOWN:** the density integral itself, the
roundness shape and the wisp noise live in the renderer DLLs (`trid3d11.dll` / `trivk.dll`), which
are not in the CP4 beta folder. INFERRED from the inputs: density ~ extinction x
exp(-height over the bottom x falloff), shaped by the soft edges.

**Weather ids = wmask bit order (CONFIRMED):** 0 Clear, 1 Cloudy, 2 Foggy, 3 Dense Fog, 4 Rain,
5 Snow, 6 Dusk, 7 Night, 8 Pitch Black.

Fog colour factor (`FUN_1403e6370`, floored at 0.05): Cloudy 0.7, Rain 0.3, Dusk 0.375, Night 0.25,
Pitch Black 0 (so 0.05), others 1.

Distance fog by weather (`FUN_1403ea690`, D = draw range): Clear, Cloudy, Dusk, Night: 0.75D..0.97D
when `farDistanceFog` is on, else none; Foggy 0..320 ft; Dense Fog 0..128 ft; Snow 0..0.85D; Rain and
Pitch Black off. `farDistanceFog` default off (INFERRED: its global starts at zero).

## 5. Surface meshes (.SRF) and triangle collision

**Sidecar (CONFIRMED, `FUN_140205670`, `FUN_1402062a0`):** for `X.BIN`, `MODELS\X.SRF`, same POD as
the model, 1..65535 bytes. Lines `material = type`; `*` is the default; `;` or `#` comments; at most
64 lines, later duplicates win. **The material is the model's texture name:** exact
case-insensitive, then the stem without extension, then a 15-char prefix, then `*`, else "not a
surface". Log `surfmesh.txt`.

Surface types (table `0x1407b8ca0`), stored as the box type code (id x 100): cement 100, dirt 200,
mud 400, sand 500, grass 600, gravel 700, ice 800, snow 900, metal 1000, wood 1100, rocks 1200,
default 0. `water`/`water2` are rejected ("a mesh never sinks you"). One type byte per triangle.

**Which boxes become surfaces (CONFIRMED, `FUN_140206d40`):** skipped are box type 14 (fog), boxes with
mass > 0, types 10 and 13 (moving), 6..9, 11, 12, models with no triangle grid, and all of them when
collisionMode is 0. Caps: **64** surface boxes, 1024 SRF models, **2048** collidable models in the
collision-shape cache (`.clsh`).

**Point query (`FUN_1402066c0`, CONFIRMED):** ray down from y + 4 ft, up to 4 hits, triangles with
normal Y >= 0.25; returns the type code (-2 for an untyped triangle) and the hit height; callers
compare it with the terrain height using a 1/4 ft margin. Its consumers (surface effects, skids)
INFERRED.

**INI (CONFIRMED, `FUN_1401826d0`):** `[Game] collisionMode` default **1** (triangles; 0 = classic boxes).

| [Collision] key | Default |
|---|---|
| supportSpokes | 9 |
| supportProfile | 1 |
| supportCylinder | 1 |
| supportCylHoldTicks | 3 (0..25) |
| cylinderTreadClip | 1 (0 = capsule) |
| supportPick | 1 (0 deepest, 1 nearest, 2 least) |
| wallCylinder | 1 |
| wallSkipDrivable | 1 |
| boxOnTri | 1 |
| climbBlend | 1 (35..100 %) |
| wallCorrectPct | 30 |
| bottomPropPct | 40 |
| phantomCornerTenthFt | 30 |
| suspVelMaxFtPerSec | 20 |
| supportComprMaxTenthFt | 20 |
| wallComprMaxTenthFt | 10 |
| tireScrapeCfHundredth | 50 |

**Tire support (CONFIRMED from the edgediag log legend):** nine spokes per tire: 0 bottom, 1/2 22 deg
forward/back, 3/4 45 deg forward/back, 5/6 sidewall bottom, 7/8 sidewall 45 deg; 9 the support
cylinder, 10 the cylinder hold. Support sources: 0 none, 1 terrain, 2 classic box, 3 triangle prop,
4 top-crush.

**Models without .SRF (INFERRED):** with collisionMode 1, support comes from the collision triangles
of every static collidable prop; the SRF only adds surface types, so such models should still be
drivable on top. Not traced through the support solver.

## 6. 3D cockpit (.CPT) (CONFIRMED unless marked)

Load `FUN_1401fe0a0`, read `FUN_1402003d0`, text parse `FUN_1401fbd40`, keys `FUN_1401fada0`, range
checks `FUN_140200570`/`FUN_140200630`. Default layout `_DEFAULT_CP.CPT` (shipped in `cockpit.pod`
as `DATA\_DEFAULT_CP.CPT`). Log `cockpit3d.txt` only when `[Diagnostics] cockpit3dLog=1` (default 0).

**Syntax:** 1..65536 bytes, optional BOM, `;` comments, `KEY = v1, v2, ...` (keys upper-cased, up to
16 values, strtod must consume the token). A bad line is skipped and logged. `VERSION=1` mandatory.
Model names 1..31 chars, end in `.BIN`, no path. Pivots p in ft (|v| <= 64), a = rotation axis,
other numbers |v| <= 1e6.

| Key | Values |
|---|---|
| CAB | model |
| EYE | x, y, z ft in the truck body frame, \|v\| <= 32; default (0, 4, 1) |
| FOV | degrees 30..150, truncated to int; default 106.26 |
| SPEEDO, TACH | model, px, py, pz, ax, ay, az, a0, k |
| WHEEL | model, p(3), a(3), ratio |
| SHIFTER | model, p(3), a(3), g0..g5 |
| GEARLAMP_P/R/N/1/2/3 | a model, or a quad x, y, z, w, h (0 < w, h <= 64) |
| SHIFTLIGHT | model or quad, optional rpm (default 6500) |
| MIRROR | cx, cy, cz, nx, ny, nz, w, h, optional 9th int (<= 0x40000) |

Angles (degrees, mod 360, about the part's axis; `FUN_1401fd050`, `FUN_1401fca10`):

| Part | Angle |
|---|---|
| Speedo | a0 + k * \|speed_ftps\| * 3600 / 5280 (k = deg per mph) |
| Tach | a0 + k * rpm (truck +0x52c) |
| Wheel | steer (+0x298, rad) * 57.2958 * ratio; drawn only when option flag `0x140947ab8` (settings id 0x1c) is on |
| Shifter | g[clamp(gear(+0x58c) - 1, 0, 5)], order P, R, N, 1, 2, 3 (gear 1 = P: INFERRED) |

Only the current gear's lamp is drawn; quad lamps are camera-facing billboards. The shift light is
lit above its rpm. Shipped default: speedo 304.5 + 2.65/mph, tach 153 + 0.0261/rpm, wheel ratio 7,
shifter -5.42, 5.38, 17.74, 30.26, 42.62, 53.42 about (1, 0, 0).

**EYE/FOV:** EYE in feet, the view is translated by -EYE*256. Projection value
int(tan(FOV/2) * 49152 + 0.5), so 106.26 deg = 65536 (camera +0xb8).

**MIRROR:** drawn only when (EYE - C)·n > 0 and an angle test against 60 deg (1.0472 rad) passes. The
corners C +- 0.5w*u +- 0.5h*v are projected to a screen rectangle used as the rear-view viewport
(`FUN_1401fe360`). The 9th value goes into camera +0xb8 for the mirror pass; 0 or absent = **65536**
(the 106.26 deg projection scale; acts as a zoom: INFERRED).

**View centre (CONFIRMED, `FUN_1401fd850`):** while the cockpit pass is on, the projection's centre row
(`DAT_140e4d2a4`, the y every projected point adds, 16.16; set to the window's middle for the other views) becomes `height * 208 / 480`, so the horizon sits 1/15 of the screen above the middle; the old row is restored
when the pass ends. The lens's scale (`DAT_140e4c48c`) is unchanged; the bottom clip test is widened by
`(height - row) / scale` (`DAT_140949d58`, read only by the clip tests) so
the lower screen is not clipped. Checked against a CP4 beta 0.52 screenshot: with the centre raised the wheel's rim and
the gauges land within about 1 % of the screen's height of CP4's.

**Mirror switch (CONFIRMED, `FUN_140137c50`, the monster.ini reader):** the 3D
cockpit's mirror uses the game's mirror flag (`0x14110d700`), toggled by the mirror key in either cockpit and saved to
`system\monster.ini` as **`mirrorOn`** (default 0, read at start, written back). `cockpitMirror` (default **1**)
switches the feature itself. The mirror's frame is part of the cab model (the CPT names only the glass rectangle), so
it is drawn whether the mirror is on or off.

**Which cockpit a truck gets:** the .TRK names it with its **last two non-blank lines**, `COCKPIT`
then `<name>.CPT` (5..31 chars, no `\`, `/`, `:`); only the last 256 bytes are scanned
(`FUN_1401fc220`), not a key=value line. Fallback order:
1. Named file found: a copy of the default, each key overriding; a missing instrument model takes the
   default's whole instrument, a missing CAB the default cab.
2. Named file missing: "named by %s, not found - default cockpit", default used.
3. No COCKPIT lines: the default 3D cockpit only for instrument clusters `powerbig` or `richford`;
   any other keeps the 2D cockpit.
4. `_DEFAULT_CP.CPT` or its CAB missing, or no renderer cockpit pass: 2D cockpit for everyone.
At most 10 vehicles are set up.

**cockpitLook (`FUN_1403e04c0`):** `[Control] cockpitLook` default 0 ("Smooth Cockpit Look"). In the
3D cockpit, look moves at 180 deg/s (dt capped at 0.25 s), yaw clamped +-150 deg (27306/65536),
pitch +-35 deg (6371); with no input the offsets ease back, *= exp(-dt / 0.045).
The look is proportional to the stick: yaw += x/32767 * 32768 * dt, pitch -= y/32767 * 32768 * dt (a stick axis
+-32767, y down positive; that pushing up looks up is INFERRED). Easing back, an offset under 64 units (0.35 deg) snaps to 0.
With cockpitLook 0 both offsets are held at 0.

**Details for a reimplementation (CONFIRMED unless marked):**
- Parts. A moving part's model is in its own frame around its pivot (the shipped needles, wheel and shifter
  have their origin at the hub, the needle along +y): it is drawn translated to the pivot and rotated about the
  axis. The cab and the model lamps are in the truck body frame and drawn where they are. Read against the shipped
  dial art (`ART\CPD_SPEEDO.PNG`: 20 mph straight up, `CPD_TACH.PNG`: 1000 rpm straight down), a positive angle
  about +z (forward) turns a part clockwise as the driver sees it, and a positive steer turns the wheel to the right.
  A positive angle about +x (the shifter) moves its top back toward the driver, so P (-5.42) is the lever forward.
- Shift light: lit when rpm is strictly above the threshold (`FUN_140200fb0`).
- Quad lamps (a lamp or shift light given as x, y, z, w, h): untextured, in the colour of the global
  `0x1409465d4` (red and blue swapped, alpha 0x80). Its value is UNKNOWN; OpenMTM2 does not draw quad lamps yet.
- Mirror basis (`FUN_1401fe360`): with n normalised, u = (nz, 0, -nx) / |(nx, nz)| (u = (1, 0, 0) when n is
  vertical) and v = n x u. The angle test is the view direction (the camera's yaw and pitch, the look offsets
  included) against the unit vector from EYE to C: drawn when their dot product is at least cos(60 deg). A corner
  behind the camera drops the mirror for that frame; the corners' screen bounding box, clipped to the screen, is
  the viewport.
- The mirror pass's own lens: 65536 is the main view's projection value, which is 90 deg across 640 pixels. The
  port reads the 9th value the same way against the mirror viewport's width: tan(half-angle across) = zoom / 65536
  (INFERRED). The mirror's picture is the view behind, flipped left to right as a mirror shows it, as retail's 2D
  mirror is.
- FOV. The FOV key is degrees across a 4:3 frame, and the 3D cockpit keeps that frame's height on any screen: the
  vertical angle is 2 atan(value / 65536), so the default 106.26 deg is 90 deg top to bottom (INFERRED from the
  picture: a CP4 beta 0.52 screenshot of the default cockpit at 16:9 shows its gauges at 0.74 of their size in a
  port drawing at 73.74 deg, retail's lens, where 90 deg predicts 0.75). An earlier reading took the projection
  value as retail's lens (73.74 deg vertical) and drew the cab cut off at the bottom.

## 7. Time Attack ghosts (.gst) (CONFIRMED unless marked)

Writer `FUN_1401a5520`, reader `FUN_1401a5b60`, recorder `FUN_1401a4990`, sample `FUN_1401a5020`.
Text file in `Ghosts\`:

```
MTM2GHOST 1
track <s63>
trackname <s95>
truck <s63>
truckname <s95>
driver <s63>
laptime %.9g
splits n v1 .. vn        (n <= 20)
samples N                (2 <= N <= 200000)
N lines of 29 floats
```

Values must be finite, |v| <= 1e7; sample time >= 0 and non-decreasing. No fixed rate: one sample
per race frame (INFERRED). The best lap and its splits are kept.

| Floats | Content |
|---|---|
| 1 | time since lap start |
| 3 | ipos |
| 3 | theta, phi, psi |
| 3 + 3 | front axle +0x28c..+0x294, rear axle +0x4fc..+0x504 |
| 2 | axle angles +0x274, +0x4e4 |
| 2 | steering +0x298, +0x508 |
| 4 | truck +0x1e8c..+0x1e98 (UNKNOWN) |
| 4 | tire +0x54 of each tire (wheel roll angle: INFERRED) |
| 4 | tire +0xb8 of each tire (spin rate) |

## 8. Music (CONFIRMED)

- `FUN_1401ddd90` (level type 0): an LVL music name whose extension is not .wav, .mp3 or .ogg
  (case-insensitive) becomes `rockx.wav`; that includes .mod.
- The player (`FUN_1400b08f0`) uses **the exact LVL name** and tries no other extension: X.MP3 plays
  X.MP3 whatever X.OGG or X.WAV exist. Files come from `sound` (POD first).
- MP3 (`FUN_1400ca640`) and OGG (`FUN_1400ca750`) are decoded whole to 16-bit PCM, 4000..96000 Hz,
  mono or stereo. WAV (`FUN_1400b9c30`): PCM, 1 or 2 channels (stereo fine), 1000..192000 Hz.
- `.KLP` is looked up for every format (same name, extension replaced). Type 0..6; types 1, 2 one
  loop `start end`; types 3..6 a count 1..20 then that many `end start` pairs. End < 1 means the
  sample length; a single loop must be >= 200 frames. Values are sample frames.

## 9. Network (CONFIRMED unless marked)

Offsets are wire offsets from the start of the game packet header, as in `MONSTER_EXE_ANALYSIS.md`
14.2 (decompiled offsets are these + 0xC). Factory `FUN_1401ef600`, dispatch `FUN_1401f0100`.

**Version:** u16 **0x3402** at +0x3A of packet 0x03 (retail 0x0201 there; CP3 0x3400), set in
`FUN_1401f2050`. The join check `FUN_140084900` warns "older version" (RC 40049) below 0x3402 and
"newer version" (RC 40050) above; the lobby `FUN_14007af60` shows " (Version hi.lo)" when not equal.
The rest of 0x03 (92 bytes) is retail.

| Type | Retail | CP3 | CP4 |
|---|---|---|---|
| 0x02 position | 61 | 65 | **116** |
| 0x14 start race | 36 | 36 | **40** |
| 0x25 checksum | 116 | 116 | 116 |
| 0x26 progress | none | 24 | 24 |
| 0x27 collision | none | 44 | 44 |
| 0x28 race loaded | none | none | 16 |
| 0x29 race release | none | none | 16 |

All other packets keep their retail sizes.

**PacketPosition 0x02 (116 bytes):** sender `FUN_140212d60`, receiver `FUN_140211d60`, redundancy
`FUN_14020bdf0`.

| Offset | Field |
|---|---|
| +0x00..+0x3C | retail order, but the angles at +0x24/+0x28/+0x2C (truck +0x101c) are **f32 radians**; throttle +0x34 and rear brake +0x35 u8 (x255); vehicle number +0x38 (truck +0x1ed4, receiver drops > 9); Summit score +0x39 (race type 4 only) |
| +0x3D | u32 sender tick (25 Hz, 0xa3d/65536 s; counter `DAT_14572fd9c`) |
| +0x41 | u8 redundant pose count 0..2 |
| +0x42 | u8[2] ages in ticks |
| +0x44 | 2 x {f32 x, y, z} |
| +0x5C, +0x64, +0x6C | 2 x theta, 2 x phi, 2 x psi (f32) |

Each tick `FUN_14020ed00` pushes every truck's pose into a 16-entry ring; the sender picks the newest
two older than now and under 256 ticks old. The receiver drops packets shorter than 116 bytes
(`short_dropped`) and fills lost packets from the redundant poses (`filled_by_redundancy`, in
`.\system\netdiag.txt`).

Steering at +0x30 is also the truck's own f32 (+0x298, radians), copied as is, not byte-coded as in
retail (CONFIRMED, sender `FUN_140212d60`). theta and phi are wrapped to +-pi on receipt, psi is taken
as it is.

**CP3's 0x02 (65 bytes)** (CONFIRMED, CP3 sender `0x1401a4200`, receiver `0x1401a3a50`): the first
61 bytes as CP4's above (angles and steering raw f32 from truck +0x101c..+0x1024 and +0x298; the
Summit score is written only in race type 4), then +0x3D u32 sender tick. No redundant poses. The
receiver drops a vehicle number above 9 and reads the tick only when it is not 0.

**PacketStartNetGame 0x14 (40 bytes):** retail fields plus u32 **raceId** at +0x24, made by
`FUN_1401f32b0` as `GetTickCount() ^ (localId << 20) | 1` (odd, never 0).

**PacketRaceLoaded 0x28 / PacketRaceRelease 0x29 (16 bytes, {u32 raceId}):** a post-load barrier in
`FUN_1401f3300`. Everyone broadcasts 0x28 reliably; the host waits for every human player's 0x28 with
that raceId (or 120 s) and broadcasts 0x29; clients wait for the matching 0x29 (give up after 300 s,
on host loss, or on becoming host). "Waiting for: %s" / "Waiting for the race to start" refresh every
250 ms. A late 0x28 for an already released race gets an immediate 0x29 back.

INFERRED: in the race loop (`FUN_14019d170`) the flag set when this barrier runs (a network game)
appears to skip the retail `sync` barrier ("Waiting for other players", 0x15) that follows; read
from the control flow only, not seen at run time.

**PacketVerifyChecksum 0x25 (116 bytes): identical to retail 0x25.** +0x0C char[20] SIT, +0x20
char[80] name, +0x70 u32 CRC; the CRC (`FUN_140025ea0`) is CRC-32/MPEG-2 over the whole POD that
holds `WORLD\<SIT>`, cached per POD.

**PacketCollision 0x27 (44 bytes):** receiver `FUN_140211220`. +0x0C target truck, +0x10 source
vehicle, +0x14 3 x f32 linear impulse, +0x20 3 x f32 angular impulse. Applied only to the local
player's truck, or on the host to a truck no human drives; 0.3 s cooldown per source. dv = J / mass,
mass = sum of the four weights (+0x1040, +0x5a0, +0x2ac, +0x51c) / 32.174; angular part / Ixx, Iyy,
Izz. Closest approach must be within 8 ft, scaled by (8 - d)/5 between 3 and 8 ft; dv capped at
clamp(1.25 x closing speed, 15, 60), then 22 ft/s; a 30 ft/s per-truck budget drains at 25 ft/s per
second.

**0x26 (24 bytes):** +0x0C u32 truck index, +0x10 u32 segments passed (written to truck +0x8fc),
+0x14 f32 total time (written to truck +0xfa4, only when > 0). Ignored for the local player's own
truck. INFERRED: the owner's race progress, so standings agree. Same in CP3.

**MTU3 transport:** unchanged from the CP3 description in `MONSTER_EXE_ANALYSIS.md` 14.5: same 20-byte
header and 1200-byte payload limit (`FUN_1400e5560`), same 11 message types (`FUN_1400e46b0`), same
send-mode rule (`FUN_1400e0dc0`). New: `[Network] UPnP` default 1 (`FUN_1400e6730`, status in
`FUN_1400e6900`) and the `.\system\netdiag.txt` log. `[Network] Port` default **2350** (0x92e).
