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
| Beta 0.53 build (sections 12 to 14) | `monster.exe`, 13,263,360 bytes, MD5 `2d80e10e5282f22a3e0e27e9d899d259`, still "Version 2.0.52.2"; renderer `trid3d11.dll` 1,728,000 bytes, MD5 `ec27cca6329136786f034a6bb30a8240` |

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
- **The track's own water is still retail's (CONFIRMED):** the surface lookup (`0x1403c51e0` ->
  `FUN_1401bfae0`) takes a .SRF face under the point first (`FUN_1401c1190` -> `FUN_1402066c0`, only while
  surface boxes exist, `[0x147428b90]`), then the ground box, then the terrain: 1300 (800 in Snow) when the
  terrain height (`FUN_1401c0600`, terrain only) is at or below the LVL water (`[0x1409494a4]`), whatever the
  queried point's height. Only a WTR lake tests the point. So a tire on a triangle prop with no .SRF, over
  terrain under the track water (a bridge), stands on deep water for grip, for the per-tire surface code
  (`FUN_140386330`, retail `0x46a2c0`: the water commentary) and for the sounds' "in water" (retail
  `0x41bbd0`: a tire on the ground on 300 or 1300), exactly as in retail. Its water depth is the point's
  height against the level, so there is no water drag, sinking or splash. OpenMTM2 departs from this on purpose (MTM2_PHYSICS.md 2.4).
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
| 4 | truck +0x1e8c..+0x1e98 (UNKNOWN; retail +0x1728..+0x1734 by the tail shift of 10.1, INFERRED) |
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

CONFIRMED by CP4's developers (reply_to_kmaster_online_rooms_2.md section 1, from their source): when
this barrier ran, the retail first-frame `sync` barrier ("Waiting for other players", 0x15) is skipped
(`Game.cpp`, `barrierRan`). The 120 s timeout counts from the host's own load. The retail
**end-of-race results** sync still runs (`SyncPlayers(30, eResults)` in `RACE.CPP`), so the host of a
mixed room must answer it.

**PacketVerifyChecksum 0x25 (116 bytes): identical to retail 0x25.** +0x0C char[20] SIT, +0x20
char[80] name, +0x70 u32 CRC; the CRC (`FUN_140025ea0`) is CRC-32/MPEG-2 over the whole POD that
holds `WORLD\<SIT>`, cached per POD.

**PacketCollision 0x27 (44 bytes):** receiver `FUN_140211220`. +0x0C target truck, +0x10 source
vehicle, +0x14 3 x f32 linear impulse, +0x20 3 x f32 angular impulse. The impulses are in the **hit
truck's body frame**, not world space, each summed over one physics tick (force x dt); corrected by
CP4's developers, who first read as world space. Applied only to the local player's truck, or on the
host to a truck no human drives. **Mirror suppression**, not a cooldown per source: if the hit truck's
own simulation saw contact with that attacker within the last 0.30 s, the packet is dropped entirely,
since both machines already reacted to the same contact. Otherwise: dv = J / mass,
mass = sum of the four weights (+0x1040, +0x5a0, +0x2ac, +0x51c) / 32.174; angular part / Ixx, Iyy,
Izz. Closest approach must be within 8 ft, scaled by (8 - d)/5 between 3 and 8 ft; dv capped at
clamp(1.25 x closing speed, 15, 60), then 22 ft/s; a 30 ft/s per-truck budget drains at 25 ft/s per
second.

**0x26 (24 bytes):** +0x0C u32 truck index, +0x10 u32 segments passed (written to truck +0x8fc),
+0x14 f32 total time (written to truck +0xfa4, only when > 0). Ignored for the local player's own
truck. CONFIRMED by CP4's developers: `{int number, int staged, float totalracetime}`,
**owner-authoritative**: each machine sends its own truck's staging, disqualification and finish
state, and receivers take it as truth. Same in CP3.

**Send rate (CONFIRMED by CP4's developers):** one 0x02 per new physics tick (25 a second), sent right
after the tick runs; a frame that runs no tick sends nothing. The host also sends every computer truck
no human drives. At 120 bytes a relay frame that is 3.0 KB/s a truck, about 24 KB/s for a host with
its own truck and 7 computer trucks.

**Version (CONFIRMED by CP4's developers):** 0x3402 is `(build << 8) | rev` from `version.h`
(2.0.52.2). It names a layout set, not a feature level: every machine in a session runs the same
build, and nothing negotiates. A client that does not know a version refuses it rather than guess.

**MTU3 transport:** unchanged from the CP3 description in `MONSTER_EXE_ANALYSIS.md` 14.5: same 20-byte
header and 1200-byte payload limit (`FUN_1400e5560`; reliable payloads at most 1024 bytes,
`OUTREL_MAXLEN`, per CP4's developers), same 11 message types (`FUN_1400e46b0`), same
send-mode rule (`FUN_1400e0dc0`). New: `[Network] UPnP` default 1 (`FUN_1400e6730`, status in
`FUN_1400e6900`) and the `.\system\netdiag.txt` log. `[Network] Port` default **2350** (0x92e).

## 10. Vehicle dynamics and timing

As with the rest of this document: Fila published no source code for CP4; these are facts read from our
own decompile of the binary. CP4 keeps a debug symbol table (0x1407ca900..0x1407d2000, 32-byte entries
{name, type, size, address}) that names most physics globals with TRI's original names; names below in
`code` come from it.

### 10.1 Truck struct (CONFIRMED)

Trucks are 0x1f18 bytes (retail 0x17ac). Offsets up to +0x1100 are retail's. The tail moved by +0x764:
human flag +0x1ed0 (retail +0x176c), last impact force +0x1ec4 (+0x1760), damage code +0x1ec8 (+0x1764).
By the same shift the ghost fields of section 7, +0x1e8c..+0x1e98, are retail +0x1728..+0x1734 (INFERRED).

### 10.2 Fixed tick and substeps (CONFIRMED, race loop `FUN_14019d170`, step `FUN_14039f3b0`)

- The race loop adds the frame time to an accumulator capped at 0x28f4/65536 s (about 160 ms). While it
  holds more than 0xa3c it runs one **tick** with `deltaT` = 0xa3d/65536 s (**40 ms**, 25 Hz), at most
  4 ticks per frame; time beyond that is dropped (the game slows down).
- Once per tick: remote poses, the game tick `FUN_1401db310` (keyboard steering `FUN_1401dc530`, then the
  step), the net pose ring, the ghost recorder and the tick counter `DAT_14572fd9c` (the 25 Hz tick of
  section 9).
- After the ticks every truck (position, angles wrapped, axles, tires) and every moving box is drawn
  between the previous and the current tick with alpha = remainder / 2621; the real state is restored
  after drawing.
- The step takes dt = deltaT x `sim_rate_scaler` (1.0). Retail's split (dt > 0.1: n = trunc(10 dt) + 1)
  is kept and never fires at 40 ms. The new split runs when `simSubstepMs` > 0, the retail split did not,
  the game is online (`netPlay`) or `simSubstepOffline` is set, and dt > 1.25 x substep: n =
  round(dt / substep) clamped 2..8, dt /= n.
- Per substep: joystick input `FUN_1401dbf40`, then the frame `FUN_14038e600` (race rules, object steps,
  drag staging, broadphase, pair tests, post-step per truck). The autopilot `FUN_140369c40` runs only on
  the first substep (`gAiRunNow`), with dt set to the whole tick (n x dt).
- Result (INFERRED from the arithmetic): offline by default one 40 ms physics step per tick; online, or
  offline with `simSubstepOffline=1`, 4 x 10 ms.

| `[Game]` key | Default | Range |
|---|---|---|
| simSubstepMs | 10 | 0..40, 0 = off |
| simSubstepOffline | 0 | boolean |
| hiResTimer | 1 | QueryPerformanceCounter frame clock |

`[Sound] soundUpdateHz` (default 50) paces sound only.

### 10.3 The truck step (CONFIRMED, `FUN_1403b0dd0`, retail `0x470810`)

Same order and same maths as retail (`MTM2_PHYSICS.md`): helicopter, autopilot, tire geometry, gearbox,
gravity, drag, normal load, longitudinal and lateral tire forces (the same 25-pair table, now at
0x14094af90), aero damping, hull contacts, sums, integration, contact probes. Unchanged: spring and
damper load, brake drag, the 10 mph static hold, the 0.8 grip clamp, the friction circle above Rookie,
drag coefficients and the 26.74125 damping floor, the surface mu and density table, the tire-cut table,
weather (Rain 0.8, Snow 0.6), engine, gears and truck defaults, the gearbox.

Changes from retail:

| Rule | CP4 | Retail | Where |
|---|---|---|---|
| Suspension rate | (old - new compression) / dt clamped to +-`suspVelMaxFtPerSec` (20 ft/s, 0 = off); it drives the damper | unclamped | axle solve `FUN_14036b980` |
| Terrain compression | the terrain wheel probe's penetration capped at `terrainComprMaxFt` (6 ft; < 0 = 0, between 0 and 1 = 1, > 500 = 500; 0 = off) | uncapped | `FUN_140374fe0` |
| Rest clamp | with `gRestClampGroundedOnly` = 1, velocities are zeroed at rest (\|v\| < 0.1, or < 0.5 with 3 or more contacts) only when the truck has at least 3 ground contacts (wheels on the ground plus +0x890) | any contact count | `FUN_1403955a0` |
| Surface lookup | at the tire bottom (hub y - radius); a WTR lake makes it 1300 (deep water) when that point is below the lake (`FUN_140203ed0`) | at the hub | grip lookups `FUN_1403899e0`, `FUN_140389bb0` |
| Axle lift cap | `repoAxleMaxTenthFt` (default 0 = off) | none | `FUN_14036b980` |
| Push-out budget | `repoMaxTenthFt` (default 0 = off) | none | `FUN_140397cc0` |

### 10.4 Computer trucks and Sonic Trucks (CONFIRMED)

- **`[Game] aiGrip`** default **130**, clamped 100..200: the tire factor (+0x8c) times aiGrip/100 for a
  computer truck (or the player in demo mode), outside drag races and only offline (`netPlay` 0).
- Drag races: `gDragGripMul` 1.5 multiplies a computer truck's grip limit (+0x90), and
  `gDragSteerGainMul` 1.5 its autopilot steering slew. 1.0 otherwise.
- `tire_cf` (the grip constant K) is 1.75, or **3.0** for a computer truck on Professional with the
  "Sonic Trucks" option (`sonicTruckFlag`, also a tournament `SONIC=` key). Retail used 2.0 and a
  per-track Sonic flag; CP3 already used 1.75 / 3.0.
- `straight_brake_scaler` is always 0.45 (retail 1.0 on Professional + Sonic).
- `curve_speed_scaler` 0.725, **1.25** with Sonic Trucks (retail 0.75). The 1.25 is read from a constant
  the substep test also uses; whether it is intended is UNKNOWN.
- Engine torque: x1.1 for a computer truck on Professional + Sonic, x0.9 for a human with `autoShift`,
  x aiSpeed/100 for computer trucks offline (as CP3, `CP3_EXE_ANALYSIS.md` 5).

### 10.5 Garage and steering (CONFIRMED)

The garage (`FUN_14015acb0`: Tire Cut, Suspension, Transfer Gear) writes the retail formulas: cut into
the four tires, suspension s = 1.0 / 0.75 / 0.5 for the spring rates and damper 3.5 sqrt(k), the retail
transfer table (x1.25 Rookie, x0.75 Professional). Joystick steering (`FUN_1401dbf40`) is the CP3 model
of `CP3_EXE_ANALYSIS.md` 11 (steerCurveMode 0 Classic = retail, 1 Modern by default; steerRange 90,
steerExpo 0, steerSpeedSens 35). The physics limits (+-0.45 rad front, rear -0.33 x front, x1.25 in drag
races) are retail.

### 10.6 Crash damage and boxes (CONFIRMED)

- Damage (`FUN_1403d10c0`) is retail: zones 1..12, level by impact force (10000 / 30000). No physics
  reads the damage code (INFERRED). `allowCrashDamage` is 0 in the INI reader but 1 on a fresh install.
- **`[Game] offCentreCollision`** default 1 (`FUN_1403bf220`): when a box model's vertical centre
  (minY + maxY) / 2 is further from the origin than its height, the collision box corners are shifted
  by it and the bounding radius grows by it. Retail centres every box on the model origin.

### 10.7 Not physics

`gExpWeatherGrip` feeds only the computer driver's prediction; the `[Control] ai*` keys tune the
computer driver (defaults in the symbol table; no direct readers in the decompile). The CSV writer
`FUN_140197130` is the retail demo save; the per-tick `HPHYS` log `FUN_1402e6940` (`[Control] humanLap`)
prints the truck and per-tire fields.

## 11. Collision solver ([Collision], collisionMode 1)

Fila published no source code for CP4; this section is our reading of the binary. With `collisionMode` 1
the truck-against-box pair test keeps retail's contact model (the deepest support wins at tire +0x94,
contacts 13..16, push-out, hull solver) and swaps retail's four box-face routines for queries against the
model's triangles. The tire block, truck and contact offsets are retail's (`MTM2_PHYSICS.md`). Boxes are
0x368 bytes in CP4 (type +0x274, ground-box flag +0x26c).

### 11.1 Keys (CONFIRMED, reader `FUN_1401826d0`, `.\system\monster.ini`)

| Key | Default | Parse | Use |
|---|---|---|---|
| [Game] collisionMode | 1 | int | 0 = classic boxes, no soups, no SRF |
| buildShapes | 1 | int | 0 = no shapes, no triangle path |
| shapeReport, showShapes, strideCheck, exportObj, sweepDiag, edgeDiag | 0 | int | diagnostics |
| climbBlend | 1 | int | wall climb blend (11.6) |
| climbBlendLoPct / HiPct | 35 / 100 | /100; lo >= 0, hi <= 1, hi <= lo gives hi = lo + 0.01 | blend ramp |
| supportSlackIn | 6 | /12 ft, 0..2 | extra reach of the cylinder queries |
| wallSkipDrivable | 1 | int | 11.6 |
| wallShortPropPct | 0 | /100, >= 0 | 11.6 (fraction of the tire radius) |
| climbLiftGuard | 0 | int | 11.6 |
| wallDampRefFtPerSec | 0 | float >= 0 | 11.6 |
| wallCorrectPct | 30 | /100; <= 0 or > 1 gives 1 | 11.6 |
| wallCylinder | 1 | int | 11.6, pushable props only |
| supportCylinder | 1 | int | 11.5 |
| supportCylHoldTicks | 3 | 0..25 | 11.5 |
| phantomCornerTenthFt | 30 | int >= 0, /10 | 11.8 |
| cylinderTreadClip | 1 | bool | 11.3 |
| bottomPropPct | 40 | /100, 0..1 | 11.7 |
| supportClampSmall | 1 | int | 11.5 |
| supportSpokes | 9 | 1..9 | 11.4 |
| supportProfile | 1 | int | 11.4 |
| boxOnTri | 1 | int | 11.8 |
| supportPick | 1 | 0 deepest, 1 nearest, 2 least; > 2 gives 1 | 11.4, only with supportProfile 0 |
| suspVelMaxFtPerSec | 20 | float >= 0 | 10.3 |
| supportComprMaxTenthFt | 20 | /10 ft | 11.5 |
| wallComprMaxTenthFt | 10 | /10 ft | 11.6 |
| tireScrapeCfHundredth | 50 | /100 | friction of contacts 13..16 |
| dropFromHit | 1 | int | 11.6 |
| impulseCap | 1 | int | 11.7 |
| smallPropImpulse | 0 | int | 11.7 |
| smallPropRatioPct | 200 | /100; <= 0 gives 1 | small prop = height under ratio x tire radius |
| smallPropMaxGPct | 100 | /100 | 11.7 |
| repoMaxTenthFt, repoAxleMaxTenthFt | 0 | /10 ft | 10.3 |
| bottomCancelSteep | 0 | 0, 1, 2 | 11.7 |
| bottomCancelLo / Hi / MinPct | 55 / 90 / 0 | /100 | 11.7 |
| terrainComprMaxFt | 6 | float | 10.3 |
| repoStepIn, supportRef, seamDropPct | 2 / 0 / 70 | | read but never used (dead) |

### 11.2 Shapes (CONFIRMED)

- **Which boxes:** at level load every box with a model except type 14 gets a shape (`FUN_1401833a0`).
  The per-query gate (`FUN_140183d00`) needs collisionMode != 0, not a ground box (RA0/RA1 boxes stay
  classic), a model, and a shape whose hull is not degenerate and whose grid exists. **Pushable (mass > 0)
  and moving props collide as triangles too**; only the SRF surfaces (section 5) exclude them. Vegetation
  objects scale their shape per tree.
- **Triangle soup** (`FUN_14017ce80`): the BIN's vertex list (opcode 2), facets of opcodes 5, 6, 7, 8,
  0xF, 0x15, 0x19, 0x1A, 0x1B, 0x21 (index lists) and 0xE, 0x11, 0x18, 0x1E, 0x22, 0x29, 0x33, 0x34, 0x38,
  0x40 (index plus UV), each facet fanned as (v0, vi, vi+1); fewer than 3 vertices or a bad index is
  skipped. Feet = vertex x 256 / magnify / 256, in the model frame, which is the box frame. No normals
  stored.
- **Hull** (`FUN_14017bc50`): a 26-direction k-DOP. Degenerate (3 or fewer hull vertices, or volume
  < 1e-4) **turns the triangle path off for that model**: flat plates stay classic boxes.
- **Grid** (`FUN_140179ef0`): cell = (product of the active padded extents / max(1, 2 nTri))^(1/k), each
  axis ceil(size / cell) clamped 1..96, the largest axis x3/4 while the total exceeds 32768; overflow
  falls back to a classic box. Speed only.
- **Ray query** (`FUN_140183a30`): grid walk, Moller-Trumbore **double-sided**, det eps 1e-8, t in
  0..maxLen, nearest hit (ties to the lower triangle index); returns t, the unit normal **turned to face
  the ray origin**, the point and the triangle.
- **Cache:** `CollCache\%016llx.clsh` (FNV-1a 64 over the soup), hull and grid only. Speed only.

### 11.3 Cylinder query (CONFIRMED, `FUN_140181750`)

Centre c, axis a, radius r, half width h, slack s: per triangle the distance from the segment c +- a h;
with `cylinderTreadClip` 1 the triangle is first clipped to the slab \|(v - c).a\| <= h (a cylinder cut
at the sidewalls), with 0 the shape is a capsule. A hit needs distance < r + s; penetration = r -
distance, with the closest triangle point and the unit triangle normal turned toward the axis. Deepest
wins.

### 11.4 Tire support: nine spokes (CONFIRMED, `FUN_1403813d0`, replaces retail `0x4a6390`)

- Origin: last step's hub (tire +0x24) moved w/2 x side along the articulated axle, i.e. the inner
  sidewall plane, as retail.
- Spoke k ends at E = (Ax + sx w/2, Ay - r cy, Az + r cz) from the static anchor A (tire +0x30), in body
  axes; the ray runs from the last hub toward E now, length \|E - hub\|.

| Spoke | cy | cz | sx | |
|---|---|---|---|---|
| 0 | 1 | 0 | 0 | down |
| 1, 2 | 0.9239 | +-0.3827 | 0 | 22.5 deg forward, back |
| 3, 4 | 0.7071 | +-0.7071 | 0 | 45 deg forward, back |
| 5, 6 | 1 | 0 | +-1 | bottom at each sidewall |
| 7, 8 | 0.7071 | 0 | +-1 | sidewall, 0.707 r below the hub |

- Per hit: n_in = minus the returned normal in truck axes; **rejected unless n_in.y < -0.5** (the face
  points up at least 60 deg). With (ny', nz') the normalised (y, z) of n_in, P = (Ax + side w/2,
  Ay + r ny', Az + r nz') and penetration = ((hit - P) . n_face) / (-n_in.y), as retail's box support.
- `supportProfile` 1 (`FUN_1403a4a50`): rejected unless \|hit.x - Ax\| <= w/2 + 0.5 ft and
  (hit.z - Az)^2 < r^2; penetration = min(penetration, (hit.y - Ay) + sqrt(r^2 - dz^2)), the wheel's
  circle at that z. The strictly deepest spoke wins. With profile 0, `supportPick` chooses.

### 11.5 Cylinder, hold and write-back (CONFIRMED)

- **Cylinder** (no spoke accepted, `supportCylinder` 1): 11.3 with centre at the ray origin, axis the
  truck's x, radius r, half width w/2, slack `supportSlackIn`; same 0.5 gate, P and profile. As coded it
  spans from w/2 inboard of the inner sidewall to the tire's centre plane (intent UNKNOWN).
- **Hold** (the cylinder missed, `supportCylHoldTicks` > 0): 64 slots, slot =
  ((box >> 4) x 0x9E3779B1 ^ (tire >> 4)) & 63, holding {tire, box, world normal, penetration, truck
  position, ticks}, written by every cylinder hit. Valid while the keys match and the truck moved at most
  r; returns the normal and penetration x ticks / holdTicks, then ticks - 1. Removing a box clears its
  slots.
- No hit at all: nothing written, no classic fallback.
- **Write-back:** with `supportComprMaxTenthFt` > 0 the penetration is capped at 2 ft; with
  `supportClampSmall` 1 only on props with 0 < height (box +0x6C) < smallPropRatio x r. Then retail's
  rule: if deeper than tire +0x94, store it; when > 0 also the ground normal (world), on-ground, the
  prop flag and height; the lever is sqrt(r^2 + (Ax + side w/2)^2). Source codes (`gTireComprSrc`):
  0 none, 1 terrain, 2 classic box or ramp, 3 triangle prop, 4 top-crush. The terrain probe runs later in
  the post-step and wins only when deeper.

### 11.6 Walls (CONFIRMED, `FUN_1403a6330`, after the support of the same wheel)

- Nine rays from last step's hub, against the box's last position, toward hub now + offset, the offset
  in the articulated axle frame: 0 down r; 1, 2 down 45 deg forward and back; 3, 4 straight forward and
  back; 5, 6 the bottom at +-w/2; 7, 8 +-w/2 at hub height. maxLen = the offset's length (INFERRED).
- Per hit, retail's tire contact point: n_in = minus the normal in truck axes, r_eff = r x
  max(\|sin pitch\|, \|sin roll\|) of n_in, side by the sign of n_in.x, P = hub now + (side w/2,
  r_eff ny', r_eff nz'), depth = (hit - P) . n_face.
- `wallSkipDrivable`: a hit is a spring, not a wall, when the face is drivable (n_in.y < -0.5, or
  `wallShortPropPct` > 0 and the box height < pct x r), the tire is already supported this tick
  (+0x94 > 0) and depth > 0. Of the rest the deepest is the wall.
- `wallCylinder`: no wall from the rays and a pushable prop (0 < mass < truck mass): the cylinder query
  can supply it.
- Pushable: retail impulse and push. Immovable, when deeper than the stored contact 13..16:
  1. R = the hit (`dropFromHit` 1) or P; f = clamp((hub.y - R.y) / r, 0, 1); u = unit(hub - R).
  2. `climbBlend`: unless `climbLiftGuard` refuses it (n.y >= u.y), when u . n > 0,
     b = smoothstep((f - lo) / (hi - lo)) and n = unit((1 - b) n + b u): a hub above the hit climbs.
  3. depth = min(depth, 1 ft); with `wallDampRefFtPerSec` > 0 and v . n > 0, depth x= max(0,
     1 - v . n / ref); depth x= `wallCorrectPct` (0.30).
  4. Stored as contact 13..16 (depth, world normal, P), with the box sizes for the small-prop rules.
- The classic six-face tire contact is skipped for gated boxes. The stored wall feeds retail's push-out
  and the hull solver; friction of contacts 13..16 is `tireScrapeCfHundredth` / 100 (0.5).

### 11.7 Hull, solvers, bottoming (CONFIRMED)

- Hull points 1..12 (`FUN_14036fc00`): a ray from last step's reference point to the point now, nearest
  triangle, depth = n . (hit - P). A miss is no contact; a zero-length ray uses the classic test.
- Contact solvers (`FUN_14039c0c0` and the 1..4 contact solvers; read in the 1-contact one, the others
  INFERRED): `impulseCap` caps retail's rotational recovery at the impulse that stops the closing speed,
  m max(0, -n . v) / dt; `smallPropImpulse` (off) scales it by h / (ratio x r) on small props;
  `smallPropMaxGPct` caps it at pct x truck weight.
- Bottoming (`FUN_1403a06d0`, retail `0x46ba80`): the cancelled share of the closing speed is x
  `bottomPropPct` (0.4) on a small prop. `bottomCancelSteep` (off): 1 ramps by \|n.y\| between lo and
  hi, 2 by the descent share (v.y n.y) / (v . n).

### 11.8 Boxes (CONFIRMED)

- `boxOnTri` (`FUN_140370dc0`): a moving box's 8 corners are raycast against another box's triangles
  from last step's reference to the corner now; depth = n . (hit - corner).
- `phantomCornerTenthFt` (`FUN_14017f340`, boxes with mass > 0 only): a corner more than 3 ft from every
  triangle is not tested against the tires (distances cached per shape; a layout change of more than
  0.01 ft retests).

### 11.9 SRF grip (CONFIRMED path, INFERRED meaning)

Both grip lookups call `FUN_1402066c0`: a ray from hub y + 4 ft down 10 ft into the surface boxes (section
5), up to 4 hits, faces with an up component of at least 0.25, untyped faces skipped, the hit nearest the
hub height wins. The terrain wins when the mesh hit is more than 1/4 ft below the terrain and the terrain
is nearer. The type code (id x 100) gives the grip.

### 11.10 Order and collisionMode 0 (CONFIRMED)

One frame (`FUN_14038e600`): object steps (the truck's includes the hull solver), broadphase, pair tests
(truck against box: hull points, then per wheel FR, FL, RR, RL support then walls, then box corners
against wheels), then per truck the post-step (push-out, terrain probe x4, axle solve, bottoming).
**collisionMode 0 is not retail:** `terrainComprMaxFt` 6, `suspVelMaxFtPerSec` 20, `impulseCap` 1 and
`bottomPropPct` 0.4 still apply. Exact retail needs those at 0, 0, 0 and 100.

### 11.11 Open questions

Demo playback calls the game tick with a variable deltaT (`FUN_140191220`); the Sonic curve_speed 1.25;
the support cylinder centred on the inner sidewall; the wall rays' maxLen; whether the 2..4 contact
solvers apply `impulseCap` as the 1-contact one does; the `DAT_155b424f8 == 1` clearance probe mode.

### 11.12 In OpenMTM2

Sections 10 and 11 are the "CommPatch4" physics model (Options, Game, Physics): OpenPhotex `sim/cp4` (rules, shapes,
the triangle pair tests, .SRF grip; OpenPhotex docs/SIM_MTM2.md "Community Patch 4's rules") and `worker/sim-worker.js`
(the tick, the shapes per model from the track build's `collisionSoups`, the off-centre boxes). Each model's triangles
come from OpenPhotex's `parseBin` faces; the eight facet opcodes CP4 also reads (7, 8, 21, 26, 27, 30, 33, 56) occur in
none of the stock or community models the BIN walk was checked on. Options: "CP4 collisions" (`collisionMode`) and "CP4
substeps offline" (`simSubstepOffline`); every other key is held at the default of 11.1. Not ported: the tree
collisions of section 3 (trunks stay boxes until CP4's trunk test is traced), the autopilot run once per tick when the
tick is split (it runs every substep with the tick as its frame time), and the diagnostics keys.

---

## 12. Beta 0.53: waterfalls (.WFL)

The beta 0.53 build (header table) adds waterfalls: `WORLD\<stem>.WFL`, written by Traxx 1.7.1 (format: OpenPhotex
`mtm/wfl`, docs/LEVELS.md). The engine builds each fall's sheet itself at load from the crest, the terrain and the
water; the file holds no geometry. The renderer half (the four looks, the vertex layout as the shader reads it, the
tuning keys) is in `trid3d11.dll`, whose waterfall shaders are embedded as source text. Cross-references inside this
section (1.4, 2.3, ...) are to its own subsections (12.1.4, 12.2.3, ...).

#### 12.0.1 Renderer DLL (CONFIRMED, `trid3d11.dll`)

- Pipeline (`18000e350`): one vertex shader and four pixel-shader looks: 0 Original (the fall's texture), 1 Enhanced
  and 2 Realistic (the lake's water material, CP4's own water modes), 3 Ice.
- Vertex, 16 floats: pos xyz (1/256 ft, relative to the fall's anchor); u (ft across the crest), tau (s since the crest),
  speed (ft/s), air (1 free fall, 0 draped); edge (0 outer column .. 1), end, kind (1 foam), fall index; drop (ft below
  the crest); normal xyz; path (ft from the crest).
- Vertex shader: draped water (kind 0) is lifted along its normal by (1 - air) * (wfLift / 100 + 0.0005 * eye distance)
  ft and pulled toward the eye by (1 - air) * wfDepthPull / 1000 of the eye distance, against z-fighting on the ground.
- Look 0: flow = (tau - time) * crest speed; the sheet samples the texture at (u / 16, flow / 16) and a second layer at
  (u / 21.92 + 0.31, (tau * speed - time * speed * 0.85) / 21.92 + 0.17), mixed 30%; alpha = opacity * mask. The foam
  strip (kind 1, only with SPLASH) samples at (anchor-relative xz ft / 16 + (0, time * 0.03)), colour
  saturate(c * 1.6 + 0.12), alpha opacity * saturate(end * 1.5).
- Look 3 (ice): no foam; c = the texture at (u / 16, flow / 16) with time 0; l = luma (0.30, 0.59, 0.11);
  g = saturate(0.5 + (l - 0.35) * 2.5); colour lerp((0.62, 0.72, 0.80), (0.84, 0.90, 0.95), g) * (0.82 + 0.36 *
  fbm(u / 1.5, flow / 16)); alpha = mask (no opacity).
- Mask (every look): ns = 0.65 V(u / 0.8, q / 4) + 0.35 V(u / 0.35 + 3.1, q / 1.7), nf = 0.6 V(u / 1.3 + 7.3, q / 3) + 0.4
  V(u / 0.5 + 1.7, q / 1.4) with q = flow; m = smoothstep(0, 0.25, sqrt(edge) * 1.1 + 0.08 - k (0.15 + 0.75 ns)) *
  smoothstep(0, 0.3, end + 0.15 - 0.65 nf), k = wfEdge / 100. V is value noise on an integer lattice with a smoothstep
  blend and the hash h = x * 0x8da6b343 ^ z * 0xd8163841; h ^= h >> 13; h *= 0x5bd1e995; h ^= h >> 15; value
  (h & 0xffffff) / 16777215. fbm = 0.5 + 0.55 (V(p) - 0.5) + 0.30 (V(2.03 p + (17.1, 3.7)) - 0.5) + 0.15
  (V(4.11 p + (5.3, 31.7)) - 0.5), each octave faded toward its mean as its cells shrink under a pixel.
- Then colour * the scene light, fogged by horizontal eye distance to the weather fog colour. With the clip flag on
  (mirror passes), pixels below the mirror plane are discarded.
- Tuning keys (`[Graphics]`, `1800181e0`; default): wfEdge 100, wfLift 40 (hundredths of a ft), wfDepthPull 4 (per
  mille), wfFoam 100; the rest (wfDepthScale, wfRippleStretch, wfWhite, wfLipBlend, wfRippleAmp, wfReflect,
  wfCalmSpeed, wfRoughSpeed, wfCalmStreak*, wfFlowCycle, wfBreakup) shape looks 1 and 2 only.

#### 12.0.2 Function map (CONFIRMED)

| Address | Does |
|---|---|
| `14024ef30` | loader: ini keys, finds `WORLD\<stem>.WFL`, parse, validate, build each fall, texture/anim lookup, log, then sound and mist |
| `1402486c0` | level name -> stem (chars before the first '.', at most 63) |
| `140248720` | WFL parser (header, directory, FALL chunk, record checks) |
| `140248ed0` | status code -> text |
| `140250260` | per-fall validation (REFUSED reasons), converts the record to feet |
| `140248f60` | crest: unwrap the points from point 0, segment lengths, point directions |
| `1402493a0` | columns of one spacing: count, arc position s, x, z, flow dir |
| `140249c20` | the column walk |
| `1402496b0` | walk callback, count pass (rows, end kind, per-row y, chord path, "flat contact" flag) |
| `14024a160` | walk callback, build pass (writes the sheet vertices and the sink vertex) |
| `14024a650` | the mesh build: spacing / budget / shortening, both passes, trim, normals, indices, foam, landing stats |
| `140249840` | per-vertex normals |
| `1402511a0` | ground callback -> `140202130` (terrain height, classic or fine grid) |
| `1402525d0` | water callback (WTR lake or LVL water, source lake excluded) |
| `14024cc30` | per-frame draw (culling, looks, per-fall constants, `gpuDrawWaterfalls`) |
| `14024db20` | landing rings / churn sent to the lake shader (sets the "lake draws this landing" bits) |
| `14024e3a0` | foam zones (`gpuWaterfallFoamZones`) |
| `140250080` -> `140250b00` -> `140251200` | per-frame anim clock, droplets, one droplet burst (`gpuSprayBurst`) |
| `140251f10` | sounds (load time) |
| `140251920` | mist fog volumes (load time) |
| `14024c520` + `140250960`, `14024c680` | waterfallDebug: re-walk and store column polylines; draw them as lines |
| `140250150` | clear all fall state (level unload) |

DLL wrappers: `14012eb00` gpuWaterfallsAvailable (also needs Mesh, Texture, Draw imported), `14012eac0` gpuWaterfallMesh,
`14012eae0` gpuWaterfallTexture, `14012daa0` gpuDrawWaterfalls, `14012eaa0` gpuWaterfallFoamZones, `14012e6a0`
gpuSprayBurst, `14012e680` gpuSprayAvailable. Pointers at `1413e7a68/70/78/80/88`.

Globals: falls built `DAT_1478305b0`, vertex buffer `DAT_1478305b8` (count `DAT_1478305b4`), index buffer
`DAT_1478305c0` (count `DAT_1478305c8`), parsed records `DAT_147832920` (64 x 0x8c), built fall table `DAT_14782cab0`
(64 x 0xec), per-fall GPU constants `DAT_147839220` (64 x 0x40).

### 12.1 Loader (`14024ef30`)

#### 12.1.1 Order, ini keys, file (CONFIRMED)

- Called from the level loader `14049e710` at `14049f93f`, after the stadium/backdrop and the VEG loader, and well
  after the WTR loader (`1402201a0` -> `140247090` at `14049eafd`), so the lake table exists when falls are validated.
- `[Graphics] waterfalls` (default 1): 0 = no falls at all (the function returns before anything).
- `[Graphics] waterBodyLog` (default 0): opens `waterfalls.txt` (the same switch as `waterbodies.txt`). **The log is
  NOT controlled by `waterfallDebug`.**
- `[Graphics] waterfallDebug` (default 0): sets `DAT_1478305cc`; see 1.6.
- `[Graphics] wfRingDecay` default 15, clamp 2..100 (ft); `wfRingStrength` default 100, clamp 0..400 (%); `wfChurn`
  default 100, clamp 0..400 (%). Used by the landing rings (6.2). Logged as "landing rings (lake surface, looks 1/2)".
- File: `WORLD\<stem>.WFL`, stem = the level file name up to the first '.', 1..63 chars (`1402486c0`), file name
  buffer 64 (`%s.WFL`), path buffer 80 (`WORLD\%s`).
- **No TXV key.** The only "waterfalls" string (`1408a3ea8`) is the ini key above; the TXV parser does not read it.
- Not found in any mounted pod: return silently (no log line, no message).
- **Same-pod rule:** the pod holding `WORLD\<stem>.WFL` must be the pod holding `LEVELS\<level>`; if the level is a
  loose file or the pods differ, the falls are ignored. Only the log says so ("IGNORED: %s is in %s but the level is in
  %s"); **no on-screen message** (the lake and vegetation loaders do show one).

#### 12.1.2 Format (CONFIRMED, parser `140248720`)

Header (all little-endian):

| Offset | Field | Rule |
|---|---|---|
| 0 | 'MWFL' | else status 2 |
| 4 | u16 major | must be 1, else status 4 |
| 6 | u16 minor | stored only |
| 8 | u32 directory offset | >= 0x20 |
| 0xc | u32 chunk count | dirOffset + count*16 <= size, else status 5 |
| 0x10, 0x12 | u16 256, u16 256 | else status 6 |

File size 0 = status 1; < 4 or < 0x20 = status 3. Directory entry 16 bytes {tag, version, offset, size}. Only the
**first** 'FALL' entry is considered: offset+size past the end = outOfBounds, version != 1 = badVersion; any later
FALL = duplicate; other tags = unknown. No usable FALL, FALL size < 8 or stride < 0x80 (badStride), or 0 records =
status 7. Records: u32 count, u16 stride (>= 0x80), u16 reserved, records from +8; count is clamped to
(size-8)/stride (truncated++).

Record (stride 0x80, or >= 0x84 for v1.1):

| Offset | Field | Check (counter) |
|---|---|---|
| 0 | u8 id | 1..255 (badId), unique (dupId) |
| 1 | u8 source | lake id, 0 = spring (checked later) |
| 2 | u8 points | 2..8 (badPoints) |
| 3 | u8 | not read |
| 4 | u16 flags | bit0 FREEZE, bit1 SPLASH, bit2 SOUND; `flags & 0xfff8` != 0 = badFlags |
| 6 | u16 speed | 16..1600, 1/16 ft/s (badSpeed) |
| 8 | u32 height | 1..4096, half-feet (badHeight) |
| 0xc | 8 x (u32 x, u32 z) | each < 0x20000, 1/16 ft (badCoord); only the first `points` are checked/copied |
| 0x4c | u8 opacity % | clamped to 100 |
| 0x4d | u8 mist % | clamped to 200 |
| 0x4e | u8 volume % | clamped to 200 |
| 0x4f | u8 | not read |
| 0x50 | char[16] sound stem | needs a NUL in the 16 bytes (badName) |
| 0x60 | char[16] texture stem | needs a NUL in the 16 bytes (badName) |
| 0x70..0x7f | reserved | not read |
| 0x80 | u8 mist depth % | only if stride >= 0x84; 0 -> 100; clamp 250; else 100 |
| 0x81 | u8 mist height % | same |

At most **64** accepted; beyond that `over`++. The check order per record is: id, dupId (the id is marked used before
the later checks), points, coords, speed, height, flags, names, over.

#### 12.1.3 Messages (CONFIRMED, `14049ff20` = on-screen message)

| Message | When |
|---|---|
| "This track's waterfalls file could not be read." | size <= 0, open, malloc or fread fails |
| "This track's waterfalls need a newer build." | status 4 |
| "This track's waterfalls file is damaged (%s) and was not loaded." | any other status != 0 (%s = status text: "empty file", "not a waterfall file (bad magic)", "file truncated (header)", "bad header size or chunk directory runs past the end", "authored for a different terrain size", "no usable waterfall list") |
| "This track's waterfalls need more memory than is available." | the 16 MiB vertex or 6 MiB index buffer cannot be allocated |
| "Some of this track's waterfalls were skipped." | any of over, badId, dupId, badPoints, badCoord, badSpeed, badHeight, badFlags, badName != 0, **or** any fall REFUSED by 1.4 |
| "Some of this track's waterfalls were too big and were left out." | any fall DROPPED by the budget (2.9) |

Chunk-level counters (unknown, duplicate, outOfBounds, badVersion, badStride, truncated) do not raise "skipped".

#### 12.1.4 Validation, REFUSED reasons (CONFIRMED, `140250260`, in this order)

Converted to feet: x, z = int * 0.0625; crest Y = height * 0.5; speed = int * 0.0625 ft/s.

1. `FALL_POINTS`: a segment shorter than 2.0 ft (wrapped difference: d = (b - a) + 4096, d -= floor(d/8192)*8192 (fmod,
   +8192 if negative), d -= 4096).
2. `FALL_TURN`: two consecutive segment directions with a negative dot product (turn > 90 deg).
3. `FALL_WIDTH`: crest length > 1024 ft.
4. Only when source != 0: `FALL_SOURCE`: source not 1..255, or no loaded WTR body with that id (body table
   `DAT_1478109d0 + id*0x70`, its +0 must equal id; a lake the WTR loader refused has no entry).
5. `FALL_HEIGHT`: stored height != that lake's WTR height (body +4). **Exact equality is required.**
6. `FALL_DIRECTION`: for every point k, try its adjacent segment(s) j in {k-1, k} (an end point only its own segment):
   base = P_k nudged min(0.5 * len_j, 0.5) ft along segment j (forward if j == k, backward if j == k-1); probe =
   base - dir_j (1 ft against the segment flow dir); tile = floor(probe / 32) & 255 per axis; pass if
   TMAP[tz*256 + tx] == source for either segment. Any point failing = refused.

Segment flow dir = normalize(dz, -dx) (fallback (1, 0) when length < 1e-12; unreachable after FALL_POINTS).
Springs (source 0) skip 4..6. A refused fall is logged "fall %d: REFUSED %s (source %d, %d points)" and counts for
"skipped".

#### 12.1.5 Budget, memory, build loop (CONFIRMED)

- Vertex buffer malloc 0x1000000 (16 MiB = **262,144** vertices x 64 B), index buffer malloc 0x600000 (6 MiB =
  **1,572,864** u32 indices). After the loop both are realloc'd down to the used sizes; with no fall built both are freed.
- Falls are built in file (accepted) order; the loop also stops at 64 built.
- Per fall: vertex budget = min(16384, 262144 - used); index room = 1,572,864 - used. Budget < 1, or the build fails
  (crest, no columns, or nothing fits even at 2 rows) = "fall %d: DROPPED, nothing fits in the vertex budget (%d
  left)" and counts for "too big".
- Indices are global (vertex base of the fall added), so the whole track is one vertex/index buffer.

#### 12.1.6 waterfallDebug (CONFIRMED, `14024c520`, `140250960`, `14024c680`)

For each built fall it re-walks every column at the spacing actually used and stores each row's x, y, z (x and z
relative to point 0, wrapped to +-4096 ft). In the scene, outside the mirror passes, the stored column polylines are
drawn as 3D line segments (anchor wrapped to the player's position), at most 1200 segments per frame: when there are
more, only every ceil(total / 1200)-th column is drawn.

#### 12.1.7 waterfalls.txt content (CONFIRMED, only with waterBodyLog=1)

"level %s"; the landing ring knobs; "file %s (pod %s)"; "status %s format %d.%d"; the chunk counters; the record
counters (only when status 0); per fall either "REFUSED", "DROPPED", or animation/texture warnings plus
"fall %d: source %d points %d columns %d spacing %g ft verts %d (sheet %d, foam %d) rows %d..%d[ SHORTENED]",
"ends water %d / rest %d / limit %d crest %.1f ft speed %.2f ft/s height %d (%.1f ft)" (crest = crest length),
"bounds ft (rel. crest 0) x..y..z", "landing x, y, z ft width %.1f ft drop %.1f ft texture "%s"[ (animated)] sound
"%s""; then the sound block (7), the mist block (4); then "track: %d fall(s) built of %d accepted, vertices %d of
262144, indices %d". Failures: "FAILED to read %s (%d bytes) from %s", "FAILED: out of memory", "IGNORED: ...".

### 12.2 The mesh build (`14024a650`)

#### 12.2.1 Crest (CONFIRMED, `140248f60`)

- P0 = stored point 0 (ft, in [0, 8192)); P_k+1 = P_k + wrapped difference (1.4 formula). Coordinates stay unwrapped
  from P0 for the whole build.
- cum[0] = 0, cum[k+1] = cum[k] + |seg k|; L = cum[n-1]; L < 1e-6 = build fails.
- Point direction: end points take their segment's dir; an inner point normalize(dirIn + dirOut), fallback dirOut when
  the length is < 1e-12. (Traxx: fallback threshold 1e-9; no practical difference.)

#### 12.2.2 Columns (CONFIRMED, `1402493a0`)

- Spacings tried in order {2, 3, 4, 6, 8} ft (table `1408a3bd0`).
- n = (int)ceil(L / sp - 1e-9); if n < 1: 2 columns (n = 1); else n + 1 columns, **0 if n + 1 > 1100**. (With L <= 1024,
  2 ft gives at most 513 columns, so the 1100 cap cannot trigger for a valid fall.)
- Column i: s = i * sp for i < n, s = L for the last. Segment = first k (k <= n-2) with s <= cum[k+1]; t = (s - cum[k]) /
  (cum[k+1] - cum[k]) (0 if that length <= 1e-12), clamped 0..1; position = lerp(P_k, P_k+1, t); flow dir =
  normalize(lerp(pd_k, pd_k+1, t)), fallback pd_k. Same as Traxx `CrestAt`.

#### 12.2.3 Ground and water used by the walk (CONFIRMED)

- Ground `1402511a0`: xi = floor(x * 256), zi = floor(z * 256) (unwrapped values; the grid lookup masks them, so it
  wraps), `140202130(zi, xi)`, result / 256 ft. `140202130` is **terrain only** (no ground boxes, props, SRF meshes):
  - classic mode: the classic grid (`145af8aa0`, s16 at 1/64 ft, 6-byte cells), corner*4, 32 ft cells, fraction
    `(pos & 0x1fff) * 8`, triangle split by `(xt & 1) == (zt & 1)` and the four retail cases. **Identical to Traxx
    `FallClassicHeightRaw`** (same diagonal rule, same fmul `(a*b) >> 16` on 64-bit products, same truncation).
  - spline / fine mode (`DAT_1477fdeb0` != 0): `14023c560` on the 1024x1024 fine grid (`DAT_1477fdeb8`, s16, 1/64 ft),
    8 ft cells `pos >> 11 & 0x3ff`, fraction `(pos & 0x7ff) * 32`, the same parity split over 8 ft cells, h*4. So the
    walk sees the same ground as trucks in fine mode. Traxx previews smooth terrain with "the fine heights Traxx draws",
    which is only right if they are this grid with this triangle rule.
- Normal for the drape: from the ground 0.5 ft either side: n = normalize(-(h(x+.5)-h(x-.5)), 1, -(h(z+.5)-h(z-.5))).
- Water `1402525d0` (ctx = &source): tile = TMAP[zt*256 + xt] (zt, xt from floor(*256) >> 13 & 0xff). If tile == 0
  or tile == source: the LVL water level `DAT_145cdccc8` (1/256 ft), and **no water if it is < 1**; else the lake's
  surface Y (body +8, = height*128). Returned in ft. This is the source-lake exclusion: the source lake's own tiles
  count as the track's water (body 0).

#### 12.2.4 Column walk (CONFIRMED, `140249c20`, disassembled)

Start: x, z = column position; y = crest Y (height * 0.5); v = (speed * dx, 0, speed * dz); row 0 emitted with
t = 0, speed = crest speed, air = 1, end = 0. Then for step = 1..4000:

1. p += v * dt (dt = 1/60, `1408a3bf8`), then vy += -32/60 (`1408a3c20` = -0.5333...).
2. g = ground(x, z). If y < g + 0.3: **draped**: y = g + 0.3, n = drape normal, vn = v.n, if vn < 0 remove v -= vn*n,
   then v *= 0.98 (all three components), air = 0, ny = n.y. Else: not draped, ny = 0, **air = 1 if y - (g + 0.3) >
   0.05 ft, else 0** (`14089e9a8` = 0.05).
3. Water: if water(x, z) returns a surface S with S > g and S >= y: y = S, end = 1 (water).
4. Else rest: draped and ny > 0.9961947 (cos 5 deg, `1408a3c08`) and |v| < 2.0 ft/s: end = 2 (ground).
5. Else end = 3 (limit) if step == 4000, else 0.
6. d = |p - p_prev| (p_prev after its own drape/snap). If end == 0: acc += d; emit when acc >= spacing. If end != 0:
   always emit. Emit: callback(col, row, x, y, z, t = step/60, speed = |v|, air, end); row++; acc = 0. Return on end.

Same rule as Traxx `WalkColumn` (dt, g, drape, drag, steps, rest speed and cosine, water test S > g and y <= S, row
emission). Differences are in what is done with the rows (2.5..2.8), not in the walk.

#### 12.2.5 Count pass and the trailing-flat trim (CONFIRMED, callback `1402496b0`; the trim block at `14024a859..14024a917`, which Ghidra dropped as "unreachable")

The callback stores per row: y; chord path P_i = P_i-1 + |row_i - row_i-1| (straight distance between emitted rows,
not the per-step arc); and a flag F_i = 1 when air == 0 **and** the ground normal under the row (0.5 ft differences)
has ny > 0.9848078 (cos 10 deg, `1408a3c00`). Up to 4002 rows.

**Trim (not in Traxx).** For a column whose end != water and with n >= 2 rows:
1. k = n; while k > 0 and F_k-1: k--. If k == n (the last row is not a flat contact): no trim.
2. s = max(k - 1, 0); while s < n and y_s - y_n-1 >= 1.0 ft: s++.
3. If s >= n - 1, or P_n-1 - P_s <= 8.0 ft (`14085e128`): no trim.
4. Else n = (smallest i > s with P_i - P_s > 8.0) + 1.

So water that comes to rest (or runs out of steps) on flat ground keeps only 8 ft of path past the point where it got
within 1 ft of its final height. Then rows = n + (end == water ? 1 : 0) (the sink row).

#### 12.2.6 Spacing choice, budget, shortening (CONFIRMED)

For each spacing in order with a non-zero column count: walk every column (count pass, rows/ends as 2.5); Totals(R):
- verts = sum min(rows_c, R) + 3 * (each run of >= 2 consecutive columns with end == water and rows_c <= R);
- tris = sum over adjacent pairs (min(r_a, R) + min(r_b, R) - 2) + 4 * (run - 1) per foam run.
Fits when verts <= min(16384, track room) **and** 3 * tris <= index room. The first fitting spacing is used, nothing
cut (R = 0x7fffffff). If none fits: at the last spacing with columns, require Totals(2) to fit (else DROPPED), then
bisection lo = 2, hi = max rows: mid = lo + (hi - lo + 1) / 2, fits -> lo = mid else hi = mid - 1; R = lo, flag
SHORTENED. Same as Traxx `FitFall`/`Budget` except the index test and the trimmed row counts.

#### 12.2.7 Build pass, sheet vertices (CONFIRMED, callback `14024a160`)

Each column is walked again at the chosen spacing and its rows written while row < R and row < cap_c, where cap_c =
the column's trimmed row count for non-water columns and unlimited for water columns. Columns are laid out
consecutively (column start = running total). Per vertex (16 floats, 64 bytes):

| Float | Field | Value |
|---|---|---|
| 0..2 | pos | (x - P0x, y - crestY, z - P0z) * 256, i.e. 1/256 ft relative to the anchor (2.10), unwrapped |
| 3 | u | s of the column along the crest (ft); the last column has u = L |
| 4 | tau | t = step/60 of that row (s since the crest) |
| 5 | speed | smoothed: row 0 = crest speed; then max(|v_row|, prev * exp(-d / 8)), d = chord to the previous row (`14085e108` = 0.125) |
| 6 | air | 0 or 1 (2.4 step 2); **binary**, the DLL treats it as a blend |
| 7 | edge | min(col, ncols - 1 - col) / 3, clamped to 1 |
| 8 | end | see below (holds the chord path until the column is finished) |
| 9 | kind | 0 (sheet) |
| 10 | fall | the fall's build slot index (0..63) |
| 11 | drop | crestY - y (ft) |
| 12..14 | normal | set by 2.8 (written (0, 1, 0) first) |
| 15 | path | chord path P (ft): **sum of straight row-to-row distances, not the exact arc** |

end: a water column that got its sink vertex: 1 on every row, 0 on the sink. Any other column: clamp((P_last - P_i) /
6, 0, 1) (`140888310` = 6), P_last = the path of the last written row.

**Sink vertex** (CONFIRMED): when the row ends in water (end == 1), row > 0 and row + 1 < R, one more vertex is
written after it, copying it, then: let D = (dx, dy, dz) = this row minus the previous row; if |D| > 1e-9 and -dy/|D|
>= 0.5: offset = (4/(-dy)) * (dx, dz) horizontally (continue along the last row step until 4 ft lower), else 0;
pos = (x + ox, y - 4, z + oz); tau = t + 4 / max(rawSpeed, 0.5); speed = exp(-|(ox, 4, oz)| / 8) * smoothed;
end = 0; kind = 0; drop = crestY - (y - 4); path = P + |(ox, 4, oz)|; normal = the water row's normal (copied after
2.8). Traxx counts this row but has no rule for its position.

#### 12.2.8 Normals (CONFIRMED, `140249840`)

For vertex r of column c (counts = written vertices per column, sink included): down D = v[c][min(r+1, last)] -
v[c][max(r-1, 0)]; if |D|^2 < 1e-6: D = (fx_c, 0, fz_c) (the column's crest flow dir). Across A = v[c+1][r] (if
c+1 exists and has row r, else v[c][r]) - v[c-1][r] (same rule); if |A|^2 < 1e-6: A = (-fz_c, 0, fx_c). n =
normalize(D x A), (0, 1, 0) if its length < 1e-12; flipped if n . (fx_c, 1, fz_c) < 0. Then every sink vertex takes
its previous vertex's normal.

#### 12.2.9 Indices (CONFIRMED)

Between column a (start A, m_a vertices) and b = a+1 (start B, m_b), m = min(m_a, m_b):
- i = 0..m-2: (A+i, B+i, B+i+1), (A+i, B+i+1, A+i+1);
- if m_a < m_b: i = m-1..m_b-2: (A+m-1, B+i, B+i+1);
- if m_b < m_a: i = m-1..m_a-2: (A+i, B+m-1, A+i+1).
Triangles = m_a + m_b - 2 per pair. All indices + the fall's vertex base in the track buffer.

#### 12.2.10 Foam strip (CONFIRMED)

Runs of consecutive columns with end == water and rows <= R, of length >= 2. For each column of a run, 3 vertices
(after all sheet vertices of the fall), from the column's last written (surface) row L and the row before it (Lp):
- flow f = normalize(Lx - Lpx, Lz - Lpz) when the column has >= 2 rows and that length >= 1e-6, else the column's
  crest flow dir;
- width w = clamp(1.5 * (crestY - Ly), 4, 40) ft (`140869278`, `14085e118`, `1408692b8`); across = (fz, -fx);
- positions (rel. anchor, *256): L + across * w/2, L, L - across * w/2; y = Ly + 0.1 ft (`1408882b0`);
- u = column s; tau = t at L; speed = raw |v| at L (not smoothed); air = 0; edge as 2.7; end = 0, 1 (centre), 0;
  kind = 1; fall index; drop = crestY - Ly; normal (0, 1, 0); path = 0.
Triangles for consecutive columns with a = 3i, b = a + 3 (foam base added): (a, b, b+1), (a, b+1, a+1),
(a+1, b+1, b+2), (a+1, b+2, a+2). Same count as Traxx `Totals` (3 per column of a run of >= 2).

#### 12.2.11 Landing statistics (CONFIRMED)

Counted per column: end 1 = water (whether kept or cut by R), 2 = rest, 3 = limit ("ends water/rest/limit").
Using only water columns with rows <= R ("kept"):
- landY = mean of L.y; drop = mean (crestY - L.y); landing dir (fx, fz) = normalize(sum of unit horizontal last steps
  L - Lp), fallback normalize(sum of the crest point dirs), then (0, 1);
- across a = Lz*fx - Lx*fz, along b = Lx*fx + Lz*fz; width = (max a - min a) + **the spacing used**; landing x =
  mean(b)*fx - mid(a)*fz, z = mean(b)*fz + mid(a)*fx (ft, unwrapped).
- No kept water column: landing = the last row of the column whose last row is lowest (first such), drop from it,
  width 0, direction as the fallback.
Traxx `MistVolume` uses the 2 ft columns and +2 ft; the engine uses the chosen spacing's kept columns and + that spacing.

#### 12.2.12 The built fall table (CONFIRMED, `DAT_14782cab0` + i*0xec)

+0x00..0x8b the parsed record (35 ints: id, source, points, flags, speed, height, x[8], z[8], opacity, mist, volume,
sound[16] at +0x64, texture[16] at +0x74, mist depth +0x84, mist height +0x88); +0x8c first index; +0x90 index count;
**anchor +0x94 X = x0 * 16, +0x98 Y = height * 128, +0x9c Z = z0 * 16** (ints, 1/256 ft; x0, z0 = stored point 0 in
1/16 ft); +0xa0..+0xb7 bounds min xyz, max xyz (floats, vertex units, foam included); +0xb8 landing x, y, z (ft);
+0xc4 width; +0xc8 drop; +0xcc crest length L; +0xd0 crest speed (ft/s); +0xd4 water-end count; +0xd8 animation
index (-1); +0xdc animation clock; +0xe0 fx, +0xe4 fz; +0xe8 RNG state = id * 0x3c6ef362 + 0x9e3779b1.

#### 12.2.13 Differences from Traxx `TrackPODFalls.cpp` (WalkColumn, BuildShape, Totals, Budget, MistVolume)

1. **Trailing-flat trim** (2.5) on non-water columns: Traxx keeps all rows, so it can over-count vertices and pick a
   coarser spacing or SHORTENED where the engine does not, and its preview tails are longer.
2. **Index budget**: the engine also requires 3*tris <= index room (1,572,864 per track). Traxx: not modelled.
3. **Fine/spline terrain**: the engine walks the 1024x1024 grid with the parity split (2.3); Traxx uses its drawn heights.
4. **Path** stored per vertex is the chord sum between rows; Traxx's `pathlen` is the per-step arc. Only the trim and
   the `end` fade (6 ft) use it; it does not change the shape.
5. **Sink row** position rule (2.7) has no Traxx counterpart (Traxx only counts it).
6. **Mist landing**: width + the chosen spacing (Traxx + 2 ft); only kept water columns; centre wrapped into
   [0, 8192). Traxx needs a water column at 2 ft; the engine needs water-end count > 0 at the build spacing.
7. Point-direction fallback threshold 1e-12 vs 1e-9; zero-length segment dir (1, 0) vs (0, 0): no practical effect.
8. Unchanged and identical: dt, gravity, drape 0.3, drag 0.98 (all components, after removing the into-ground part),
   4000 steps, rest (< 2 ft/s, > cos 5 deg, draped), water test, row emission, column positions, spacings, 1100 cap,
   16384 / 262144, foam counting, bisection, classic ground rule.

### 12.3 Crest height: lake-fed vs spring (CONFIRMED)

Always the record's stored height: crest Y = height * 0.5 ft, anchor Y = height * 128. For a lake-fed fall the
loader does not take the lake's height: it **refuses** the fall unless the stored height equals the WTR body's
height exactly (`FALL_HEIGHT`, 1.4). So both are equal by construction; a Traxx file whose lake height changed
without rewriting the WFL loses its falls. The source lake's tiles are then not water for the walk (2.3).

### 12.4 Mist (CONFIRMED, `140251920`, once at load after the sounds)

- `[Graphics] waterfallMist` default 100, min 0, no max.
- Per fall, needs mist % > 0 and water-end count > 0.
- density = (mist/100) * clamp(crestSpeed * L * drop / 7200, 0.25, 2.0) * (waterfallMist/100); <= 0: no mist.
- Box (feet): L = max(0.6 * drop, 20) * depth%/100; W = width + 0.6 * drop, at least 20 (**not** scaled by a %);
  H = min(0.7 * drop, 120) * height%/100, then at most 240.
- Centre x = landX + 0.3 * L * fx, z = landZ + 0.3 * L * fz, both fmod 8192 into [0, 8192); floor = landY - 2.
  Axes: W along (-fz, fx), L along (fx, fz); with no direction (length <= 1e-6) the axes are (1, 0) and (0, 1) and no
  0.3 L offset.
- Fog parameters (the SIT fog record defaults from `1404aaca0`, then overrides): vis = clamp(120 / density, 20, 1000)
  ft (extinction 3/vis as for SIT fog); half (height falloff) = H * 0.5; colour 0.75, 0.78, 0.82; soft edge 20; soft
  top 5; soft bottom 0; maxOp 1; round 1.0; wisp 0.6; wisp size 25 ft; wisp speed 2; weather mask 0x1ff, or **0x1df
  with FREEZE** (bit 5 Snow cleared: the log's "(not in snow)").
- Slot rule (`1404ab000`): SIT fog volumes + mist volumes < 64, i.e. 64 shared slots; full = "fall %d: NO mist (no fog
  slot free, %d volumes)" (%d = the SIT count). Mist volumes are appended after the SIT volumes in the per-frame list
  (`1404aa2c0`), so they go through the same weather mask, distance cull and nearest `fogVolumeMax` (16) selection
  (INFERRED for the selection code itself, which is the 0.52 one in CP4_EXE_ANALYSIS 4), and need `fogVolumes`=1
  (CONFIRMED: the gather is inside `if (fogVolumes)`).
- Same formulas as Traxx `MistVolume` for W, L, H, floor and offset (differences in 2.13 item 6).

### 12.5 Droplets (CONFIRMED, `140250b00`, `140251200`)

- Runs each frame from `140250080(ticks)` with dt = ticks / 65536 s.
- Gate: water look 1 or 2 (enhancedWater or waterRealism), a player view exists, two graphics option flags
  (`DAT_140adbcd0`, `DAT_140adab58`, option ids 0x20 and 0x19, names not traced), `enhancedWaterSpray` > 0 and
  `gpuSprayAvailable`. Otherwise the per-fall timers are cleared.
- `[Graphics] waterfallDroplets` default 100, clamp 0..400, read once per level; 0 = off. k = value / 100.
- Per fall: SPLASH flag, water-end count > 0, and not (Snow and FREEZE). Landing x/z wrapped to the player's position;
  only within 150 ft (d^2 <= 22500), else the timer resets.
- Global budget: B += dt * 500, at most 80 bursts banked; each burst costs 1; at most 6 bursts per fall per frame.
- Interval = (0.4 + 1.2 u) * 0.02 / k s (8..32 ms at 100 %); the timer accumulates dt; after the bursts, a timer
  still >= interval is set to 0.999 * interval (no backlog).
- vLand = sqrt(max(0, crestSpeed^2 + 64 * drop)); sizeK = clamp(drop / 60, 0.3, 1.0).
- One burst (`gpuSprayBurst`, the truck spray system): with (c, s) = landing dir (or a random angle in 0..2 pi):
  - position (ft, then * 256): x = X + c * a - s * j + 1.5 (2u - 1), z = Z + s * a + c * j + 1.5 (2u - 1), y = landY;
    a = 8 u ahead along the flow (or +-4 ft with no direction), j = (2u - 1) * min(width/2, 60) across;
  - velocity * 256: horizontal speed 0.2 u * vLand at angle (dir + theta), theta uniform in +-1.396 rad (+-80 deg);
    vy = (0.06 + 0.12 u) * vLand;
  - intensity = min(1, (0.6 + 0.6 u) * sizeK * 0.3 * k); waterY = landY * 256; halfW = min(12, width/2) * 256;
    size scale (pd.x) = (1.5 + 1.5 u) * clamp(k, 0.3, 4); dlt 0, carrier velocity 0, smear 0; a 32-bit seed.
  The particle look, lifetime and gravity are the DLL's spray shader (`gDropA/B`, `gT.w`): not exe data.
- RNG: state += 0x9e3779b1 per interval draw; per burst state += 0x2e2ac0ea (with a direction) or 0x6a99b44c; each
  u = h(state + const) >> 8 / 2^24 with h(x) = x ^= x >> 16; x *= 0x85ebca6b; x ^= x >> 13; x *= 0xc2b2ae35;
  x ^= x >> 16 (the exact per-draw constants are in `140251200`; only needed for bit-exact particles).

### 12.6 Foam zones and landing rings

#### 12.6.1 gpuWaterfallFoamZones (CONFIRMED, `14024e3a0`)

Called every frame from the water/lake draw `1401f9320` (at `1401f9cb8`), with no look test in the exe. Up to
**32 zones x 2 float4** (8 floats each), positions camera-relative 1/256 ft, wrapped to the nearest copy:
- Landing zones first (falls with water-end count > 0), nearest first: (cx, cz, fx, fz), (across half-width =
  (width/2 + 6) * 256, ahead = max(0.6 * drop, 12) * 256, behind = 1536 (6 ft), feather = 768 (3 ft)). No direction:
  the anchor-to-landing direction, else (1, 0).
- Then crest segments of **lake-fed** falls (up to 448 candidates), nearest first, filling the remaining slots:
  (segment midpoint, flow dir (dz, -dx)/len), (half-length = (len/2 + 2) * 256, ahead 1024, behind 1024 (4 ft each),
  feather 512 (2 ft)).
- Sent with the count (NULL when 0) only when the count is non-zero or was non-zero last time.
The DLL uses them as a mask on the lake's shore foam (`shader_180154890`: no shore foam inside the boxes). The shore
foam is an Enhanced/Realistic effect (INFERRED from the DLL).

#### 12.6.2 Landing rings (CONFIRMED, `14024db20`, from `1401f9320` at `1401fab82`)

Falls with SPLASH, water-end count > 0, not (Snow and FREEZE), nearest first, up to the caller's limit (16): pos,
(-fz, fx), half-width min(width/2, 256) * 256, ring = clamp(drop/40, 0.4, 1.5) * clamp(speed/20 + 0.6, 0.6, 1.2) *
wfRingStrength% * a, churn = clamp(speed/20 + 0.6, 0.6, 1.2) * 0.6 * wfChurn% * b (a, b = the lake pass's own
factors), radius clamp(0.1 * drop + 4, 4, 10) * 256; header (count, wfRingDecay * 256). Each fall sent sets its bit in
`DAT_1478328e0[64]`, which the fall draw turns into flags bit 2 (+4) on looks 1 and 2 (the DLL then skips its own
foam strip there).

### 12.7 Sound (CONFIRMED, `140251f10` at load; playback by the engine's continuous sounds)

- Per fall with the SOUND flag (0x4). Empty sound stem: "sound silent (no stem)": **silent, there is no default
  roar**. Snow + FREEZE: "sound silent (frozen)". No SOUND flag: nothing, no log line.
- Candidates sorted by squared horizontal distance (wrapped) from the player's truck at load ("file order (no truck)"
  when there is none).
- Room: the track's looping-sound table holds **30** (`1404b8df0` returns 30 - used), shared with the track's own SIT
  continuous sounds; none left = "sound silent (no room)" (and `1404b7e30` shows "Too many looping sounds on this
  track; '%s' is silent.").
- File: "<stem>.WAV" (buffer 40), opened through the pod file system as `sound\<stem>.WAV` with a loose-file fallback
  (`1400f3560` / `14005c490`). **No .KLP.** A missing file just fails to start (INFERRED: no message seen).
- Position = the landing point (x, z fmod 8192, y = landY), in ft. Not the crest.
- Volume = (volume% / 100) * clamp(crestSpeed * L / 240, 0.3, 1.0). Hearing = 1 + clamp((crestSpeed * L - 240) / 960,
  0, 1) (1..2).
- Playback (`1404c2e70`, the retail continuous-sound start): looped, started at a random point of the sample; volume
  in the voice; hearing written to the voice only when != 1. Falloff (`14010dcd0`): gain = volume * (1 - (d^2)^0.25 /
  (sqrt(R) * hearing)), with R the sound range (default 1000, `140ad7fb8`, the listener distance in the engine's units,
  ft INFERRED), and 0 beyond d >= R whatever the hearing. So hearing 2 keeps half the volume at the edge.

### 12.8 Texture and looks

#### 12.8.1 Default texture (CONFIRMED)

No custom texture: the draw binds the engine's water texture slot (`14021d3b0(NULL)` -> `DAT_140adc660 + frame*0x48`),
the retail ripple animation **RIPPL100.RAW .. RIPPL800.RAW .. RIPPL200.RAW** (14 frames ping-pong: 1..8 then 7..2),
advancing every 16384 ticks (0.25 s), not advancing in Snow or in the mirror passes. `gpuWaterfallTexture(i)`
captures the bound texture. The "slightly modified" part is in the DLL (look 0: a second layer at 1/21.92 scale,
offset (.31, .17), speed .85, blended 30 %).

#### 12.8.2 Custom texture (CONFIRMED)

- Stem with no '.' gets ".RAW" (buffer 20). Compared case-insensitively, as given and as "stem.RAW", with the names of
  the track's animation list (the tanim file read by `Animate.cpp`, `DAT_1410dd080`, at most 64 animations, at most 8
  frames each, "frames,delay").
- Animation found: needs frames >= 1 and delay >= 1 ("(no frames / no timing)" otherwise) and every frame loadable
  from `art\` (pod, then loose; with the HD texture option also via the PNG/TGA path `1400647b0`); else "animation ...
  frame %s cannot be loaded - not animated" and it falls back to the static name.
- Animated: frame = (clock / delay) % frames, clock += frame ticks (`140250080`), wrapping at frames * delay; same
  timing units as the track's own animated textures (INFERRED).
- Static: the name must load from `art\` the same way; else "texture ... cannot be loaded - the ripple is used" (8.1).
- Every frame, each visible non-ice fall binds its texture and calls gpuWaterfallTexture; a non-zero return sets
  flags bit 1 (+2).

#### 12.8.3 Look selection (CONFIRMED, `14024cc30`)

- Water mode `14021ceb0`: `waterRealism` -> 2 (Realistic), else `enhancedWater` -> 1 (Enhanced), else 0 (Original).
- Look 3 (ice) when weather == Snow (5) **and** the fall has FREEZE **and** `gpuWaterfallsAvailable` returned bit 2
  (value 4). Otherwise the water mode. No ice support in the DLL: frozen falls are drawn as running water, but their
  sound, mist, rings and droplets still stop.
- Look 3: no texture bind, no SPLASH bit, frame time 0.
- Drawing at all needs `gpuWaterfallsAvailable` bit 0.

### 12.9 Draw (CONFIRMED, `14024cc30`)

- Order in the scene function `1401f61b0`: water/lakes `1401f9320` (at `1401f6df2`) -> **waterfalls** (`1401f6e11`) ->
  fog volumes incl. mist (`1401f5760`, which gathers through `1404aa2c0`). Skipped when `DAT_145aaca58`,
  `DAT_145cbcb38` or `DAT_145a94b54` is set (other passes set by `140211af0` / `140211550`; meanings INFERRED: special
  render passes). The water reflection passes (`DAT_145cbcb18` set by `1401dfe50`, `DAT_145cbcb20` by `140173050`)
  **do** draw the falls, with the frame constants' clip plane on (`14021ced0`), and skip the reflection-plane lookup.
- Mesh upload `gpuWaterfallMesh(vertices, count, 16, indices, count)` when the device generation changed (first frame
  and after a reset).
- Per frame and fall, `DAT_147839220 + i*0x40`:
  - [0] anchor x, z camera-relative (the copy among x, x +- 2,097,152 nearest the camera), y absolute (crest Y),
    w = visible for this look pass;
  - [1] first index, index count, opacity% / 100 clamped 0..1, crest speed ft/s;
  - [2] x flags: +1 SPLASH (looks 0..2), +2 texture set, +4 the lake drew the landing this frame (looks 1, 2 only);
    y = 1 + the lake reflection slot whose height is within 512 (2 ft) of the crest Y (the source lake), else 1 + 0 when
    the LVL water is within 2 ft, else 0; not looked up in mirror passes; z, w = 0;
  - [3] 0.
- Visible: index count >= 1; horizontal distance from the camera to the bounds centre minus half the bounds diagonal <
  (draw range in tiles + 1) * 32 ft; bounding sphere inside the 5 frustum planes.
- One `gpuDrawWaterfalls(frame constants (0x30 floats), fall constants, falls, 16)` per look 0..3 that has a visible
  fall; the frame block's last two floats = time and look.
- Time = (ticks `DAT_1410e7184` * 1.5254237e-05 (float 0x377fec73)) mod 600 s (`14021d410`); 0 for look 3.

### 12.10 Simulation (CONFIRMED)

Falls do not touch the simulation. Every reader of the fall tables (`DAT_1478305b0`, `DAT_14782cab0` and fields) is in
the loader, draw, foam zones, rings, droplets, sound, mist and debug functions listed in 0. No physics, water-depth,
surface-code, AI or network code reads them; the walk's water test is load-time only and changes no water level.

### 12.11 Lakes (CONFIRMED)

- The engine knows nothing about spillway notches: no notch/lip/sill strings or data; only the WTR tile map and body
  table, the per-fall source exclusion (2.3) and FALL_DIRECTION (1.4). Notches (Traxx `BuildNotches`) can only exist as
  tiles the author carved out of the TMAP.
- WTR loader `140247090` and parser `140246500` are the 0.52 `140204040` / `1402034b0` unchanged: `FDIFF=cp4:cp4b2`
  shows only relocated addresses and constants, and the log/message strings are identical.

### 12.12 Network (CONFIRMED)

Join version still **0x3402** (written as 0x34020000 at +0x58, `1402350a0`, as 0.52's `348558` line; compared with
`!= 0x3402` in `1400b1740`, the player-list code that shows a differing version, INFERRED role). The 'info' message
handler `1400bb130` keeps the 0.52 branches (< 0x3402 sends string 0x9c71, >= 0x3403 sends 0x9c72, 0x3402 nothing).
No fall data is sent; falls are loaded locally from the pod.

### 12.13 UNKNOWN / not traced

- The names of the two graphics options gating droplets (ids 0x19, 0x20) and of the three pass flags that skip the
  fall draw.
- Units of the animation delay (same as the track's animated textures).
- Why the shader clock uses 1.5254237e-05 per tick while droplets use 2^-16 (both exact in the binary).
- Mesh upload argument order beyond (vertices, count, 16): from the DLL notes.

### 12.14 In OpenMTM2

Options, Advanced, CP4, "Waterfalls" (`cp4Waterfalls`, on by default, settings version 16) is `[Graphics] waterfalls`:
off, the file is not read. docs/VISUALS.md, "Waterfalls", describes the drawing.

Ported:
- **Loader (1.1 .. 1.5):** `worker/level-load.js` `readLevelFalls` reads `WORLD\<stem>.WFL` (the stem up to the first
  '.', the .LVL's name, then the .SIT's) only from the archive that holds the .LVL, by OpenPhotex `readFallFile`, the
  engine's parser (statuses 1..7, only the first FALL entry, the count clamped, bad records left to the record checks);
  `worker/cp4-falls.js` builds the falls with OpenPhotex `buildFallMeshes` (record checks, REFUSED reasons, budget,
  64 built) and shows the 1.3 messages as the race begins (`build.notices`), all but the out-of-memory one.
- **Mesh (2):** all of it, from OpenPhotex. The ground is the track's terrain as the engine holds it (`fallHeights`:
  v >> 1 at 1/64 ft, the 32 ft corners, or the 8 ft grid of a Spline or Full Map track, through `fallGround`); the water
  is the .LVL's and the lakes the WTR loader keeps (the same rule as the lake sheets), on the file's own tile map.
- **Draw (0.1, 8, 9):** `render/waterfalls.js`, looks 0 and 3 as 0.1 gives them (the vertex lift and pull, the flow, the
  second layer, the mask with its noise and hash, the foam strip with SPLASH, the ice's colours and fbm), the anchor at
  the copy nearest the camera, the draw-range test (bounds centre less half the diagonal, the range plus a tile) and
  the frustum test on each fall's bounding sphere, the time as ticks * 1.5254237e-05 mod 600 (0 for the ice), the order
  after the water and lakes and before the fog volumes. The water's mirror (render/water-mirror.js) draws the scene, so
  the falls are in it, cut by its clip plane. The tuning keys keep their defaults (wfEdge 100, wfLift 40, wfDepthPull
  4): OpenMTM2 has no ini.
- **Texture (8.1, 8.2):** the RIPPL ping-pong (held in Snow), or the stem: the track's .ANI animation (frames, delay in
  16.16 s, at most 8 frames of 64 animations, every frame loadable), else the still (".RAW" added, HD art as the track's
  other textures), else the ripple.
- **Mist (4):** OpenPhotex `fallMist`, appended after the SIT's fog volumes (game/fog-volumes.js `withFallMists`) while
  the 64 slots last, then drawn as they are (the weather mask without Snow on FREEZE, the nearest 16). OpenMTM2 always
  draws fog volumes (the engine's `fogVolumes` default 1); `waterfallMist` stays 100.
- **Sound (7):** OpenPhotex `fallSound`, the falls nearest the player's grid slot first (the build's first slot: the
  player's truck is not placed yet when the track is built), in the room the SIT's looping sounds leave of 30, the
  "Too many looping sounds" message for those left out; played by `audio/world-audio.js` from the landing at the copy
  nearest the listener, looped from a random point, with the hearing in the falloff (`audio/audio-engine.js`: 1 -
  sqrt(d) / (sqrt(R) * hearing), silent from R on, R the port's sound range, 1000 ft by default).
- **Simulation (10):** nothing.

Approximated:
- The light: "colour * the scene light" is taken as the port's lights on a matt face (ambient, the light rig's sky and
  ground by the sheet's normal, the sun by its angle to the normal); the fog is the port's own (render/atmosphere.js),
  not the DLL's horizontal-distance fog.
- The ice samples the fall's current texture (12.8.3: the engine binds none for it, so it reads whatever is bound).
- The fbm's octave fade under a pixel uses the screen derivatives of its coordinates.
- The DLL works on the texture's values as they are: the port does too, then turns the result to linear light.

Not ported:
- Looks 1 and 2: Community Patch 4's own Enhanced and Realistic lake water, which OpenMTM2 does not have. Its
  "Reflective water" is another water, so a fall keeps look 0 under it.
- Droplets (5): the burst's look, lifetime and gravity are the DLL's spray shader, not exe data, and the gate needs two
  graphics options whose names are not traced and an enhanced water mode OpenMTM2 does not have.
- Foam zones (6.1) and landing rings (6.2): both feed the lake shader of looks 1 and 2 only.
- `waterBodyLog` / waterfalls.txt (1.7) and `waterfallDebug` (1.6): the port logs refusals, drops and missing mist to the
  console instead.
- The out-of-memory message (the port's buffers are sized to what was built).

## 13. Beta 0.53: "outside light" for roofed arenas (shadow shells)

The 0.53 notes say stadiums now get outside light for the old MTM and Freestyle drags. It is not a
lighting change. **The `.SIT` stadium (`*** Stadium ***`, `!stadiumFlag,...`) is lit exactly as in 0.52
and retail** (CONFIRMED: the 16 functions that read the flag differ only in addresses): Clear weather is
forced, the stadium model is drawn in the sky's place, the level's light vector and ambient light the
scene, and the shadow-map light is fixed at (0.2, -0.95, 0.15).

What 0.53 adds is a **shadow shell** rule (CONFIRMED, `1404a5b20`, `1404a62c0`, `1404a66a0`, `1404a6710`,
run each frame from the terrain and shadow-map setup `140211af0`):

- A shell is a placed object (record word 0, not a ground box) with a model, at least `shadowShellMinFt`
  wide and long (`[Graphics]`, default 500), whose roof covers at least `shadowShellRoofPct` (default 70)
  percent of it. Roof cover is measured once per level: a 12 x 12 grid of vertical rays over the model,
  a ray counting when it hits a triangle in the top 40% of the model's height; cover = hits x 100 / 144,
  and a model under 30 ft tall scores 0.
- Each frame, the shells whose own box (its bottom extended 10 ft down) holds the **camera** are listed, at
  most 8.
- A listed shell is left out of the sun's shadow-map pass, as a single object (`1401f3b90`) and as every
  instanced copy of the same model (`1401f7580`). It is still drawn.

So under a big roofed building the trucks, the ground and the props are lit by the open sun, as if the
roof cast no shadow ("not accurate"). Nothing else changes: light colours, strengths, the sun's direction
and the weather tables are those of 0.52. It is not tied to a track, a race mode, the weather or the
stadium flag. `shadowShellDiag` writes `shelldiag.txt`.

INFERRED: the converted MTM1 and Freestyle drag tracks build their arena from a roofed object, not the
stadium flag. UNKNOWN: whether the baked prop light map (`1401e7d20`) still darkens the floor under a
shell; 0.52's renderer DLL was not available to compare.

### 13.1 In OpenMTM2

Options, Advanced, CP4, "Roofed arenas lit as outdoors" (`cp4ShadowShells`, on by default), with Smooth textures
(the sun's shadows). The rules are `game/shadow-shells.js`: the roof is measured once per level in the track build
(`worker/cp4-world.js` `buildShadowShells`, on each SIT object's model triangles from OpenPhotex's `parseBin`
faces, the size tested first), the rays through the middles of the 12 x 12 cells over the model's vertex bounds,
`shadowShellMinFt` and `shadowShellRoofPct` held at their defaults. A shell's box is its model's bounds turned
with the object, and the camera is tested at its copy nearest the shell (the world wraps at 8192 ft). Each frame
`render/sun-shadows.js` lists the shells holding the camera and leaves every caster of a listed shell's model out
of the cascades (its instances in the placed objects, a forest chunk, an animated placement, a knocked piece);
when the listed models change, each cascade they reach draws its kept copy of what never moves again, the nearest
first. Not ported: `shadowShellDiag`.

## 14. Beta 0.53: the course map across the world edge (CONFIRMED)

The course map works in 1/64 ft, so a world is 0x80000 and half a world 0x40000. 0.53 adds one fold,
inlined in three functions (0.52 and retail have none):

`W(d)`: r = d % 0x80000 (C remainder); r >= 0x40000 gives r - 0x80000, r < -0x40000 gives r + 0x80000,
so W(d) lies in [-4096, 4096) ft.

- **The loop** (`1401cd290`): the points are built as before (each type-1 straight's start and end, at
  most 512), then unwrapped in order: point 0 as stored, then `p[i] = p[i-1] + W(p[i] - p[i-1])` on x and
  on z. The edge offsets (the road's two sides, 48 ft out, the bisector rule unchanged) are computed on
  the unwrapped points, each neighbour folded again against the current point, which matters only at
  the closure.
- **The drawing** (`1401c7180`), for every edge i to j including the closing one: dx = W(p[j] - p[i]);
  the midpoint m = p[i] + dx / 2; the shift k = (P - m) + W(m - P), where P is the player's position;
  the segment runs from p[i] + k to p[i] + dx + k. Each segment is drawn whole, moved by whole worlds
  so that its midpoint is the copy nearest the player, never split.
- **The trucks** (`1401c7b40`): a marker is drawn at P + W(truck - P); the ghost the same way.
- Unchanged: the zoom, the view, the labels and colours. Checkpoints are not drawn on this map. The
  Summit Rumble square is still drawn unwrapped.

