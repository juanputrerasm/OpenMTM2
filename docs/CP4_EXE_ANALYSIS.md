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
| Beta 0.53 hotfix 3 build (sections 15 and 16) | `monster.exe`, 13,360,128 bytes, MD5 `824016242dec6b0ff3af464c71a7f976`, built Nov 15 2026, still "Version 2.0.52.2"; renderer `trid3d11.dll` 1,853,440 bytes, MD5 `8f355a861c661952f58b795029a7bdf3`; supersedes hotfix 2 (not analysed separately) |

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
(`1401d8a50`, read in 1.8). Any allocation failure loads classic with a message.

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

### 1.8 Fine shading (CONFIRMED, beta 0.52 `1401d8a50`, row worker `1401a7af0`; beta 0.53 hotfix 4 `14021dbb0`, `1401e64d0`, the same code)

A Spline or Full Map track gets a light for each of the 1024 x 1024 fine points, built once at load ("terrain: fine
shading %d x %d vertices on %d thread(s)" in `terrain.txt` with `terrainLog=1`; up to 16 threads, by rows):

- **The light function** (`1400570c0`, retail's): for a unit normal n (each part x 65535, truncated) and the sun s
  (16.16), d = -(s.x n.x >> 16 + s.y n.y >> 16 + s.z n.z >> 16) clamped 0..0xffff; v = ((0xffff - amb) d >> 16) + amb
  clamped 0..0xffff. The byte light is v >> 8.
- **The sun and ambient** are the level's (`14754a464..470`: the .LVL's sun vector on line 18 and the value after it,
  which OpenPhotex calls `shadowIntensity`), as the weather leaves them before the ground loads (`140223c70`): Dusk
  divides the sun by 2 with ambient 0x8000, Night by 4 with 0x4000, Pitch Black by 8 with 0.
- **Pass 1, the corners:** at each 32 ft corner the normal is (trunc(trunc((h[c+1] - h[c-1]) / 2) x -4 / 256), 32,
  the same along the rows), h the classic grid in 1/64 ft (`1401e7f80`), and the corner keeps
  `R = LTE light byte - its light byte` (s16). Without a .LTE the classic light byte is that same light, so R is 0.
- **Pass 2, the fine points** (`1401e64d0`): the fine normal ((f[c-1] - f[c+1]) x 4, 0x1000, (f[r-1] - f[r+1]) x 4),
  f the fine grid in 1/64 ft, wrapping at 1024 (`140246750`); its light byte plus R between the four corners around
  the point by weights (4 - fx, fx) x (4 - fz, fz), fx = c & 3, fz = r & 3, the sum of 16ths rounded half away from
  zero; clamped 0..255. That is map A (`147736eb0`).
- **Map B** (`147736eb8`): bit 0 set where a ray from the point toward the sun meets the ground (`140205c80`), the fine
  shadow flag.
- Each corner's classic light and shadow bytes are then A and B at (4r, 4c).
- **Drawing:** a fine vertex's intensity is (A x 16 - 256) / 4080 clamped 0..1, or the ambient-only light where B's
  bit 0 is set, as a classic corner takes the .LTE's light and shadow bytes.

**In OpenMTM2:** the fine ground takes map A, by these rules (`src/game/cp4-fine-shade.js`, `worker/terrain-mesh.js`),
read as the .LTE's light is on the classic grid. Map B is not drawn, as the .LTE's shadow byte is not on the classic grid:
the port casts its own sun shadows. Before this, each fine point took the .LTE between its cell's corners, so the light
showed nothing of the spline's curves between the 32 ft corners. A track format version 6 world, which CP4 does not load,
keeps that.

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

**Hotfix 4 (CONFIRMED, loader `14024e350`, bake `1401e9b50`):** the caps are 32768 trees and **2097152 grass clumps**
("This track places %d grass clumps; this build holds %d."). A clump's scale is b / 64 + 0.25 as before, and a grass
species' distance (SPEC +0x90, else `vegGrassDist`) is not times `vegLodScale`; it fades from 0.75 of it.

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
frequency = 1 / (wsize * 8), phase scrolled at wspd. The density integral, the roundness shape and the wisp noise are
the renderer DLL's: beta 0.53 hotfix 3 ships `trid3d11.dll`, read in 15.11.

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
- **Pair early out** (CONFIRMED, `FUN_1403767f0`, `FUN_1403af350`, `FUN_1401815f0`):
  - The truck-against-box pair is skipped when the centres are at least 2 x (truck radius + box radius) apart.
  - Then comes retail's per-axis slab test (MTM2_PHYSICS.md 14.14 step 1), but for a box on the triangle path each
    slab is widened to the union of the box's faces and the shape's bounds in the box frame.
  - So a model that stands above its origin (the box centred on it reaches only half the model's height up) is still
    tested where its triangles are.
  - OpenMTM2 had used the box's faces alone. A truck on a 16 ft deck built up from its origin was dropped from the
    test once it rose past 8 ft plus its radius over the origin, fell back, and hung there with its wheels sunk in the
    deck (fog_test's SMTEST ramp). OpenPhotex `truckBoxSeparated` now takes the rules.
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
- Looks 1 and 2 as such: they are built on Community Patch 4's own Enhanced and Realistic lake water, which OpenMTM2
  does not have. In its enhanced picture OpenMTM2 now draws falls with an enhanced look of its own instead (the
  engine's look 1 by its rule, 8.3), built on its water plus the engine's hotfix 3 whitewater rules (16.7, 16.10);
  look 0 in the classic picture, look 3 in Snow on a FREEZE fall either way.
- Droplets (5) were not ported for 0.53; they are since hotfix 3 (16.5, 16.10), behind OpenMTM2's own "Waterfall
  droplets" option instead of the engine's look 1/2 and spray gate.
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

## 15. Beta 0.53 hotfixes 2 and 3: Normal-Water, Normal-Terrain strength, shore field, shadow cuts, water range

Hotfix 3 (build string "Nov 15 2026") supersedes hotfix 2. The forum posts put water detail ("Normal-Water"), the
shore field and the shadow toggles in hotfix 2 and the two strength sliders in hotfix 3; only the hotfix 3 binaries
were analysed, so every rule below is hotfix 3's.

### 15.1 New ini keys and menu entries (CONFIRMED, reader `14022a1a0`, writer `14022ec10`, menu `14018ed70`, setter by id in the options handler)

All in `.\system\monster.ini`, section `[Graphics]`. The exe now writes a key only when its value changed: the writer
`140229280` caches each section with `GetPrivateProfileSectionA` and skips an identical `key=value`.

| Key | Default | Range | Menu label (id), hint |
|---|---|---|---|
| `accurateShadowSlopeCutoff` | 1 | 0/1 | "Accurate Shadows-Slope cutoff" (99), after "Terrain Shadow Map"; hint "No truck/object shadow on ground a hill hides from the sun - needs Terrain Shadow Map" |
| `terrNormalAlways` (0.53) | 0 | 0/1 | "Always On Normal-Terrain" (0x5c); hint "Next track load - a track's own mask always wins" |
| `terrNormalStrength` | 100 | 0..300 (clamped on read and set) | slider "Normal-Terrain Strength" (100), 0..300, suffix "%"; hint "Default mask only - a track's own mask is unchanged" |
| `waterNormalAlways` | 0 | 0/1 | "Always On Normal-Water" (0x62); hint "Enhanced / Realistic Water; next track load - a track's own mask always wins" |
| `waterNormalStrength` | 100 | 0..300 | slider "Normal-Water Strength" (0x65), 0..300, "%"; hint "Default mask only - a track's own mask is unchanged" |
| `realisticWaterFoamStyle` | 1 | 0 plain, non-zero bubbly | none (ini only) |

Menu order in the graphics list: Advanced Shadows, Terrain Shadow Map, Accurate Shadows-Slope cutoff, Facing-Object
Shadows, Far Distance Fog, Always On Normal-Terrain, Normal-Terrain Strength, Always On Normal-Water, Normal-Water
Strength, No Self-Truck Reflection (new hint "Costs GPU"), Enhanced Water, Realistic Water ("Turns Enhanced Water
off"), Contact Foam (new hint "Enhanced / Realistic Water; costs GPU"), Advanced Tire Trails, ...

DLL-only keys (read by `trid3d11.dll`, never written by the exe, no menu): `terrShadowFacing` (default 0, values 0..2,
anything above 2 reads as 0; `APIDLLgpuTerrainState` `180027fe0`), `waterDetailDbg` (default 0, `18000fc40`),
`foamDebug` (default 0, 1..5 debug paints, `APIDLLgpuDrawWaterContactFoam` `18001f7e0`).

New DLL exports: `APIDLLgpuWaterDetailNormalUpload` (`1800285c0`), `APIDLLgpuWaterDetailMaskUpload` (`1800284d0`),
`APIDLLgpuSetDetailStrength` (`180024270`), `APIDLLgpuShoreFieldUpload` (`1800259a0`), `APIDLLgpuSkidUpdate3`
(`180026240`). Exe wrappers: `14012ef00` normal upload, `14012eee0` mask upload, `14012e5c0` set strength,
`14012e9e0` shore field upload, `14012eaa0` skid update 3, `14012e170` lightmap upload, `14012eda0` terrain state.

### 15.2 Normal-Water: the water detail normal

#### 15.2.1 Loader (CONFIRMED, `140220440`, at level load; logs to `hdtex.txt` when `[Graphics] hdLog`)

- Stem = the level file name up to the first '.' (up to 127 chars). An empty stem clears both textures.
- Names: `<stem>_WDTL.raw` (the detail normal) and `<stem>_WMSK.raw` (the mask). The `.raw` only carries the stem:
  the HD lookup (`140063e70` -> `1400642e0`) tries `<stem>_WDTL.PNG`, then `.TGA`; for each extension the folder is
  `MaskArt\` when the file exists there, else `art\` (`140064060`: names ending `_MASK`, `_WMSK`, `_WDTL` or `_DTL`
  look in MaskArt first). "Exists" is a mounted pod entry first, then a loose file. A real legacy `.RAW` of that name
  is never used (the lookup returns "legacy only", which the loader treats as no file). The HD path is on by default
  (`DAT_140aede00` = 1).
- Each candidate is sniffed by magic: a JPEG, GIF, BMP, DDS or WebP renamed to .PNG is refused with "is actually a ...
  - re-save it as PNG"; a PNG needs a valid IHDR; otherwise the PNG/TGA decoder (`140167b80`) gives RGBA8.
- `_WDTL` size rule: either side above **2048** -> "too large (max 2048). Using the generated map." and the generated
  map is used. Not square, not a power of two, or under 32 -> a warning ("not a square power of two in 32..2048.
  Loading it anyway, but it will mip less cleanly than a 256x256 map.") and **it is loaded anyway**. None found ->
  "no supplied map - looked for MaskArt\%s (and the pod ART\). Using the generated one."
- `_WMSK`: any size, no colour check, no size limit. Found -> uploaded with invPeriod = 2^-21 (`1408b40bc`,
  4.76837e-07 = 1 / 2097152, one world of 8192 ft in 1/256 ft units): **the mask covers the whole world once**.
- No `_WMSK`: with `waterNormalAlways` = 1 a 4 x 4 default mask is uploaded whose every texel is R = G = B = 0,
  A = 255 (`1408b1d50`): uniform black, the base strength everywhere ("waterMask: none supplied - Always On
  Normal-Water: uniform default mask"), and the "default mask in use" flag `DAT_145d2a0ac` is set. With 0: no mask
  ("Water detail OFF for this track").
- The mask is the switch: no mask bound = no water detail, even with a supplied `_WDTL`.
- The exe keeps CPU copies of both and re-uploads them when the renderer is recreated (`1401f7600` compares the device
  generation), as it now does for the terrain's `_DTL` / `_MASK`.

#### 15.2.2 The generated detail normal (CONFIRMED, `18001b8b0`, built lazily by `18000faf0` the first time a mask is bound)

256 x 256, RGBA8, wrapping. Identical noise to the terrain's generated detail (same seed, `18000c5f0`), but without the
terrain's smoothing passes (INFERRED from the structure of `18000c5f0`, which adds a 7 x 7 sum and more).

1. Height field h[256][256] = 0 (row y, column x).
2. Five octaves with lattice size g = 4, 8, 16, 32, 64 and amplitude a = 1, 1/2, 1/4, 1/8, 1/16. Before each octave,
   g * g lattice values are drawn in order (index r * g + c) from one xorshift32 stream that carries on across the
   octaves: seed 0x92d68ca2; per draw s ^= s << 13; s ^= s >> 17 (logical); s ^= s << 5; value = (s & 0xffff) / 65535.
3. Cell size cs = 256 / g pixels. For pixel (x, y): c0 = x / cs, c1 = (c0 + 1) mod g, r0 = y / cs, r1 = (r0 + 1) mod g,
   fx = (x mod cs) / cs, fy = (y mod cs) / cs, wx = (3 - 2 fx) fx^2, wy = (3 - 2 fy) fy^2;
   h += a * lerp(lerp(L[r0][c0], L[r0][c1], wx), lerp(L[r1][c0], L[r1][c1], wx), wy).
4. Normal per pixel with wrap: dx = -(h[y][x+1] - h[y][x-1]) * 20, dy = -(h[y+1][x] - h[y-1][x]) * 20,
   len = sqrt(dx^2 + dy^2 + 1); R = int(((dx / len) * 0.5 + 0.5) * 255 + 0.5), G likewise from dy, B = A = 255.

Upload (`180018a90`) into an RGBA8 texture; sampler `18000fb60`: anisotropic x8 (falling back to trilinear), wrap.

#### 15.2.3 Which water (CONFIRMED, water pixel shader text at `180145a10`)

Only the Enhanced and Realistic looks (water style >= 1) and not the snow ice (style >= 1 with the ice flag skips the
motion entirely). The Original look (the ripple texture) never gets it; the author's note "does not work with the
original ripple texture". INFERRED: the WTR lakes draw with the same pixel shader (`APIDLLgpuDrawWaterSurfaceLake`), so
they get it too. Waterfalls have their own copy (`gWfDet`), not covered here.

#### 15.2.4 Constants per draw (CONFIRMED, `18000fc40`)

- x = `waterDetailDbg`.
- y (mask uv per uv tile) = invPeriod * U, where U = engine units per ground tile (8192 for a 32 ft tile), but 0 (detail
  off) unless a mask is bound, invPeriod > 0, U > 0.5 and a normal map exists (supplied or generated).
- z (feet per uv tile) = U / 256.
- w (strength) = the value from `APIDLLgpuSetDetailStrength`, clamped 0..3.

`1401f7600` (every frame) calls SetDetailStrength(terrain, water) with terrain = terrNormalStrength / 100 when the
terrain's default mask is in use (`DAT_145d2a080`), else 1.0; water = waterNormalStrength / 100 when the water's default
mask is in use (`DAT_145d2a0ac`), else 1.0. So the sliders only scale the Always-On default masks; a track's own mask
always draws at 1.0.

#### 15.2.5 Shader term (CONFIRMED, `180145a10`)

Coordinates: uv = the per-tile uv (tile index plus fraction; u = world x, v = world z). us = uv with the tile index made
signed (uv - 8192 where uv >= 4096) for the derivatives and the mask; un = uv wrapped to the 256-tile world period for the
pattern. t = the water clock (seconds; the drift speeds are whole repeats per 600 s, so the wrap never pops).

- Fades: watt = 1 - saturate(fog) (the per-vertex distance fog factor); footprint pxFt = max(|ddx us|, |ddy us|) * z;
  lod = 1 - smoothstep(1.5, 5.0, pxFt).
- Mask: mk = the mask's red channel at us * y (wrap sampler): one mask over the world.
- Layer A: nA = 2 * tex(un * 0.5 + t * (0.020, 0.010)).rg - 1: a repeat every 2 tiles (64 ft), drifting 0.020 and
  0.010 repeats per second (1.28 and 0.64 ft/s on 32 ft tiles).
- Layer B: nB = 2 * tex(un * 0.26953125 + t * (-0.010, 0.015)).rg - 1: 69 repeats per 256 tiles (118.7 ft), drifting
  -0.010 and 0.015 repeats per second.
- Detail slope d = -(nA + nB) * 0.02 * (1 + 4 mk) * lod * watt * w. Black mask = base strength, white = 5x (the
  terrain's own rule). Peak slope about 0.03 at base strength, like the ambient ripple.
- Use: d is added to the water's world slope before the Fresnel and the sun glint read it. The reflection offset is
  (slope + 1.5 d) * reflection-distortion: the detail wobbles the reflection 2.5x its slope share. The shade factor
  is clamp(1 + 0.5 (rings . k) + 0.8 (slope . k) + 2.4 (d . k), 0.7, 1.3) with k = (0.6, 0.8); since slope already holds
  d, the detail reads at 0.8 + 2.4 = 3.2, four times a ripple's brightness share.
- `waterDetailDbg` = 1 paints (saturate(0.5 + 16 d), 0.5, 1); magenta = no mask bound.

### 15.3 Normal-Terrain changes (CONFIRMED, `14021d470`; diff against 0.53 `14021a220`)

- `_DTL` cap 1024 -> **2048** (both messages now print the cap). The rest of the rule is unchanged: above the cap the
  generated map, otherwise loaded even when not a square power of two. MaskArt\ then art\, PNG then TGA, as 15.2.1.
- Mask meaning (unchanged): the shader multiplies the detail by 1 + 4 * mask.r (white = 5x). The loader's log text
  still says "WHITE = double it", which the shader does not do. A mask more than 25% coloured (sampled every 7th texel,
  at most 4096 samples, max-min of RGB >= 25) logs the `_MASK_ref` warning and loads anyway.
- Always-On default mask (unchanged since 0.53, `14021ca90`): 256 x 256, one texel per ground tile (row = tile z,
  column = tile x). Per tile, L = 0.299 R + 0.587 G + 0.114 B of the tile texture's average colour (`14021dc70`, from
  the decoded art; a missing or black average falls back to the palette colour of the tile's legacy index). Strength
  v = 2 when L <= 75; 2 - (L - 75) * 0.58 / 34 when 75 < L < 109; 1.42 * (109 / L)^2 when L >= 109; then v = max(v, 1).
  Mask byte = int((v - 1) * 0.25 * 255 + 0.5), so 1 + 4 * mask = v: dark ground 2x, ground brighter than about L 130 1x.
- New: `terrNormalStrength` scales the terrain detail only while that default mask is in use (15.2.4). In the DLL the
  terrain detail amount is terrDetail (default 10) * 0.01 * that strength (`180017420`): it scales the detail normal's
  tilt, its occlusion darkening (0.6 * amount * mask factor * (1 - ao)) and its sun term.
- New (shader `1801384f8`): the detail's sun term is -dot(dn.xy, sunXZ / |sunXZ|) * lerp(0.5, 1, |sunXZ|), clamped
  +-0.3, where sunXZ is the horizontal part of the unit sun direction; with the sun straight overhead it uses the
  diagonal (0.7071, 0.7071) at half weight. 0.53 used -dot((dn.x, 0, dn.y), sun), which vanished with a high sun.

### 15.4 Shore field and shore foam

#### 15.4.1 When it is built (CONFIRMED, `14021b710`, called every frame from `1401f7600`, rebuilt only when its key changes)

All of: Enhanced or Realistic water on; `realisticWaterContactFoamOn` (Contact Foam, default 1);
`realisticWaterShoreFoam` (default 1); `realisticWaterContactFoam` (strength %, default 100) >= 1; the renderer has the
contact foam (`APIDLLgpuWaterContactFoamAvailable`). Then it is built when the level has WTR lakes, or painted water
(`paintedWater` on and a painted table present; hotfix 4 removes painted water, 17.5), or level water (the level water height `wref` is non-zero and the
level kind `DAT_145aabc98` is not 4). Key = (level id, wref, lake count, painted): a change rebuilds, otherwise nothing
runs. wref = the level's water height (`DAT_140af3550`) or its override (`DAT_145cf3dc4`), engine units; it is the
stable mean water level the shader also gets (`gEnhFall.z`).

#### 15.4.2 Build (CONFIRMED, `14021b710`, rows `1401e6c20` on up to 8 threads, finish `14021ad00`)

- Grid 2048 x 2048 over the 8192 ft world: sample (i, j) at x = j * 4 + 2 ft, z = i * 4 + 2 ft (row = z).
- Water level at the sample's tile: the WTR lake covering that tile (`140250640`, the lake table), else the painted
  water table (when `paintedWater`), else wref when level water applies, else none.
- Depth (ft) = (level - ground height at the sample) / 256, ground from the terrain query `140203c00` (classic or fine
  grid). No water level: depth = -1 (dry). Wet = depth > 0. "~%d%% wet" counts every 16th sample.
- Shore segments: marching squares over every 2 x 2 cell of samples (wrapping at 2048): a side whose ends differ in
  wetness gets a crossing at the linear zero of depth. Two crossings make one segment; four (a saddle) make two,
  paired by whether the sign of the four depths' sum matches the first corner's wetness. "%d shore segments" counts
  them. **Only ground that crosses the water level makes a shoreline** (deep vertical walls make none; ground under
  water everywhere makes none).
- Distance: a buffer of squared distances (in samples) starts at 17; each segment writes min(current, squared distance
  from the sample to the segment) to the samples within its bounding box +-4 samples where that value is under 16.
  So distances are exact up to 4 samples = 16 ft and capped there.
- Encoding, R8G8 (`DXGI_FORMAT_R8G8_UNORM`, linear filter, wrap; `1800259a0`): sd = min(sqrt(dist2) * 4, 16) ft,
  negative on the dry side; R = round((sd / 32 + 0.5) * 255). G = round((clamp(depth, -16, 16) / 32 + 0.5) * 255).
  So R = 0.5 at the shoreline, +16 ft water side, -16 ft land side; G is signed depth over -16..16 ft.
- Log: "shoreField: %dx%d built in %d ms (%d shore segments, ~%d%% wet, wref %d, lakes %d, painted %d)". If the DLL
  refuses the upload: "renderer refused the upload - the screen-space shore taps stay" (the 0.53 screen-space search
  runs instead).

#### 15.4.3 Contact foam constants (CONFIRMED, exe `1401f7600` at `1401f8195`; DLL `18001f7e0`)

The exe passes six floats: [0] object foam width 384 units (1.5 ft) plus 0.5 when `realisticWaterFoamStyle` is non-zero
(the style flag rides in the fraction); [1] object strength = pct * 0.6 / 100; [2] enable bits, 1 objects + 2 shoreline
(3 when `realisticWaterShoreFoam`, else 1); [3] shoreline width SW = 1024 units (4 ft); [4] shoreline strength =
pct * 0.6 / 100; [5] shallow reach SR = 2048 units (8 ft). pct = `realisticWaterContactFoam` clamped 0..300. The DLL
adds bit 4 when the shore field texture is bound. All widths are constants, not ini keys.

#### 15.4.4 Shore term in the foam shader (CONFIRMED, `18015e7a0` / `180165cb0` / `18016cdd0`)

With the field bound (bit 4) the shoreline comes only from it; the screen-space taps are skipped.

- f = the field at uv / 256 (wrapped): sdFt = (R - 0.5) * 32, dpFt = (G - 0.5) * 32.
- Tide: shift = (pixel's calm plane height - mean level) / 256 ft when the mean level is non-zero; |shift| > 0.75 ft
  means a lake or painted surface built at its own level: shift = 0. When non-zero: grad = 2 * length of the G
  difference across +-2 texels (+-8 ft) on each axis (ft of depth per ft of ground); sdFt += shift * min(1 / max(grad,
  0.025), 40); dpFt += shift. The water plane bobs +-0.25 ft about the mean, so the band follows the waterline on a
  gentle beach.
- dFt = max(sdFt, 0) (the land side is at the shore), dpFt = max(dpFt, 0).
- Footprint fp = min(fwidth(sdFt), 32) ft (halved in the half-res pass); SWft = 4, SRft = max(8, SWft).
- Bank band: bestS = (1 - smoothstep(0, 1, dFt / min(SWft + fp, 12))) * SWft / (SWft + fp).
- Shallow band: bestU = (1 - smoothstep(0, 1, length(dFt, dpFt) / min(SRft + fp, 15))) * SRft / (SRft + fp).
- shore = max(bestS, bestU); objects' contact foam (best) is found as in 0.53.
- No foam where the terrain or something nearer is in front of the water pixel, inside a waterfall foam zone, or once
  watt = 1 - saturate(fog) <= 0.01.

Plain style (`realisticWaterFoamStyle` = 0, `18015e7a0`): n = 0.65 N(uv * 14 + 0.15 t) + 0.35 N(uv * 37 - 0.2 t)
(value noise with smoothstep blend on the integer hash h = x * 73856093 ^ z * 19349663; h ^= h >> 13; h *= 0x5bd1e995;
h ^= h >> 15; (h & 0xffffff) / 2^24); nm = lerp(0.7, 1, n) * watt; foam = saturate(max(best * nm * objStrength,
shore * nm * shoreStrength)). Colour = lerp((0.82, 0.87, 0.93) * bright, fog colour, fog), bright = clamp(1.7 *
mean(fog colour) + 0.12, 0.12, 1); alpha = 0.85 * foam * zone mask, blended source-alpha.

Bubbly style (non-zero, default; `180165cb0` + blur `1801748f0` / `180174fe0` + composite `18016cdd0`):
- Half-resolution closeness pass: per half-res pixel (prox = max(best, shore), strength of the stronger source *
  watt * zone, band width in half-res pixels, coverage 1); hidden water writes nothing.
- Separable 9-tap Gaussian per axis, sigma = clamp(0.35 * band width, 0.35, 2.0), normalised, the band width carried
  unblurred.
- Composite at full res: bilinear from the half-res buffer, divided by coverage. pr = saturate(prox + (N(fmod(uv, 64) * 6
  + t * (0.02, -0.015)) - 0.5) * 0.45 * saturate(3 prox)); foam = saturate(pr^2 (3 - 2 pr) * lerp(0.55, 1, pat) *
  strength); alpha = 0.85 * foam * zone mask.
- pat = saturate(0.35 c1 + 0.25 c2 + 0.15 c3 + 0.25 N(u * 6 + t * (0.02, -0.015))), u = fmod(uv, 64), with Worley F1
  cells (3 x 3 neighbourhood, point offsets from the hash at the cell and at the cell + (17.31, 5.87)):
  c1 = smoothstep(0.15, 0.55, F1(32 u + t (0.05, 0.03))) (about 1 ft), c2 = smoothstep(0.20, 0.60, F1(96 u - t (0.04,
  -0.06))) (about 4 in), c3 = smoothstep(0.20, 0.65, F1(288 u + t (0.03, 0.05))) (about 1 in). Each fades to its mean
  (0.62, 0.60, 0.60) as pix * scale goes 0.35 -> 0.9, pix = sqrt(fwidth(u).x * fwidth(u).y).
- When the half-res targets or the smoothed shaders fail, the full-res pass applies the same shaping per pixel.

### 15.5 terrShadowFacing (CONFIRMED, DLL `180027fe0`, terrain pixel shader `1801384f8`)

- `[Graphics] terrShadowFacing`, read once by the DLL, default 0; no menu entry (the menu's "Facing-Object Shadows" is
  an older, unrelated option).
- It acts in the terrain's **receive** of the sun shadow map (both the single map and the cascades), only while that
  receive is on. Not in the caster pass, not in the lightmap bake.
- Rule: n = normalize(cross(ddx(world pos), ddy(world pos))), flipped to point up (or, for a face within 0.02 of
  vertical, toward the camera horizontally). L = the shadow camera's forward axis (third column of the shadow VP:
  m02, m12, m22, normalised, flipped to point down; the world sun direction when degenerate).
  sunFace = smoothstep(-0.02, 0.06, -dot(n, L)); shadow = lerp(1, shadow, sunFace).
- So a face turned from the sun receives no cast shadow (its baked darkness stays). Mode 2 paints the gate
  (red = turned away, green = sun-facing).

### 15.6 accurateShadowSlopeCutoff: the hill-cut plane (CONFIRMED)

- Needs Terrain Shadow Map (`terrainShadowMap`, default 1): the baked lightmap path. Bake `1401f27b0` / rows
  `1401e5da0`; the hill-cut plane is a byte map the size of the lightmap (default 1024 x 1024 over the world, 8 ft a
  texel; clamped 64..4096, 2048 in one mode), built in the same pass.
- Per texel: ground height there (in Snow, weather 5, raised to the level water and the lake surface: the ice is
  solid); one ray toward the sun (`14021c1e0`). Hill-cut = 1 when the ray is blocked by the terrain heightfield; when the first hit is a ground
  box or tile slab, the ray is cast again with the boxes ignored and hill-cut = 1 only if the terrain still blocks it.
  So 1 = "the terrain alone hides this spot from the sun". Written as 255 or 0.
- Exception: hill-cut 0 when any of the 3 x 3 tiles around has a tile slab (its two heights differ) whose lower height
  is more than 2 ft above the texel's ground. INFERRED: a box underside overhead, so overhangs keep their shadows.
- Upload (`1800226b0`): the exe uploads the lightmap (positive size), then, when `accurateShadowSlopeCutoff` is on,
  calls again with the negative size; the DLL interleaves the two into one R8G8 texture (R intensity, G hill-cut),
  falling back to R8 alone on failure ("lightmap: hill-cut plane %s (%dx%d)"). Toggling re-uploads.
- Shader (`1801384f8`): hillCut = the lightmap's G (an R8 map reads 0); after the receive and the facing gate,
  shadow = lerp(shadow, 1, hillCut * saturate(selfShade)). selfShade is the weather self-shade
  (`APIDLLgpuSetTerrainShade`, 1 full .. 0 flat). Trucks' and objects' shadows vanish on ground a hill already hides,
  which the baked intensity already darkens. Only the day cached path reads the lightmap.

### 15.7 Water draw range (CONFIRMED, Enhanced/Realistic water tile gather in `1401fa8f0`, 0.53 `1401f9320`)

R = the terrain view radius in tiles (Max Terrain Visibility, `DAT_140af34d8`; the GPU terrain cache's radius, at most
120, `DAT_140af3548`, when that path is in use). Tiles are taken around the camera tile and clamped to the level's tile
bounds (+-2 tiles).

- 0.53: dx, dz in [-R, R] and dx^2 + dz^2 <= (R + 1)^2: a disc, short of the square terrain.
- Hotfix: dx, dz in [-R, R - 1], no radius test: the same 2R x 2R square as the terrain.
- Unchanged: the Original look's per-tile water in the GPU terrain path still keeps the disc (`1401f8700`:
  dx^2 + dz^2 <= (R + 1)^2); the CPU ring path draws water with the terrain in square rings.

### 15.8 Sun below the horizon

- CONFIRMED unchanged: the sun disc and moon (`1404bd9c0`, `1404bdd50`), the sky-sun direction (`1404e2150`: the LVL
  sun vector with y halved, normalised) and the flare draw (`1404e1920`) are 0.53's.
- CONFIRMED new: the shadow-facing gate (15.5) flips the shadow camera axis to point down; the Normal-Terrain sun term
  (15.3) no longer depends on the sun's height.
- INFERRED from the formulas: the baked ray march (`14021c1e0`) steps toward the sun; with the sun below the horizon
  the ray descends and meets the ground, so every texel bakes as shadowed and hill-cut 1. The Realistic glint is
  Blinn on H = normalize(V + toSun), so a sun under the horizon gives almost none. UNKNOWN: where the exe changed for
  "the engine places the sun anywhere"; no clamp on the LVL sun vector was found in 0.53 or the hotfix.

### 15.9 Other hotfix changes

- Realistic sun glint by weather (CONFIRMED, `1401fa8f0`): 0.53 left it off in Foggy, Dense Fog, Night and Pitch Black;
  the hotfix also turns it off in Cloudy and Rain (on in Clear, Snow, Dusk).
- HD art size (CONFIRMED, `140064800`, 0.53 `1400647b0`): the "square power of two" range for HD textures went from
  32..1024 to 32..2048. Out of range is not refused: it is resampled, logged with the 8-bit page size it maps to (32 up
  to 44 px, 64 under 128, else 256).
- `APIDLLgpuSkidUpdate2` is now a forwarder to `APIDLLgpuSkidUpdate3`, which takes one more float: the two ends of a
  trail quad get their own value (`1404bcb60` passes the trail record's +0x5c and +0x58, both negated when +0x84 is
  set; 0.53 sent +0x58 to both ends). INFERRED: a per-end lateral value so trails join smoothly; the exe falls back to
  SkidUpdate2, then SkidUpdate.
- Reverse-Z (CONFIRMED): every vertex shader gets the engine's reversed projection (built by `1401ecbf0`); the water's
  coplanar bias was rescaled for it (distant water flicker fix).
- DX11 shader cache (CONFIRMED, `180006fe0`): compiled shaders kept in `shadercache\dx11\%016llx.dxbc`, tagged "MTM2
  dx11 shader cache v%u / d3dcompiler %d".
- Debug aids for the menu slowdown / empty frames: `drawgate.txt`, `presentgate.txt`, `shot.now`, `frozenshot_%lu.png`.

### 15.10 In OpenMTM2

What was built from sections 15.1 to 15.9, by item, with every place it differs from the engine. Nothing here was
copied from the decompiled code or the DLL's HLSL; both were only read to settle details the rules left open (the
float32 arithmetic of 15.2.2).

#### Settings and options (A, B)

- `src/app/settings.js` DEFAULT_SETTINGS: `cp4TerrainNormalAlways: false`, `cp4TerrainNormalStrength: 100`,
  `cp4WaterNormalAlways: false`, `cp4WaterNormalStrength: 100` (the engine's defaults). `migrateSettings` clamps the
  strengths to 0..300 (as the engine clamps them on reading); new keys take their defaults, so SETTINGS_VERSION stays 16.
  `cp4NormalsOf(settings)` is what the track build is handed; `CP4_NORMAL_STRENGTH` (0..300, step 5).
- `src/ui/options-panel.js`, Advanced, CP4, after Waterfalls and in the engine's menu order: "Always On Normal-Terrain",
  "Normal-Terrain Strength" (slider, %), "Always On Normal-Water" and "Normal-Water Strength" (slider, %). The presets
  are unchanged (the engine's defaults are off).
- `src/app/main.js` passes `cp4Normals` with every `trackRender` request; `src/worker/asset-worker.js` hands it to
  `buildTrackRender`. The strengths are applied at track load ("from the next race"), not every frame as the engine does.

#### A. Normal-Water (15.2)

- Loading, `src/worker/track-build.js` `loadWaterDetail`: `<level>_WMSK` with `loadPlainImage` (red channel kept, one
  byte a texel, any size, shrunk only past 4096 a side for the graphics card; the engine sets no limit) and `<level>_WDTL`
  with the new `loadDetailImage`. No `_WMSK`: with Always On Normal-Water a 4 x 4 black mask (the base strength everywhere),
  else no water detail at all (the mask is the switch, even with a `_WDTL`). Strength = the slider / 100 with the default
  mask, 1 with the track's own. Returned as `build.waterDetail = { mask, detail, defaultMask, strength }`.
- `src/worker/art-texture.js`: `loadDetailImage(vfs, stem)` (PNG then TGA; a side over 2048 is refused and the generated
  map is used; any other size loads, the odd shape noted as `odd` from `hdDimensionRefusal(..., DETAIL_MAX_DIM)`; shrunk to
  the Texture size as HD art is). Stems ending `_MASK`, `_WMSK`, `_WDTL`, `_DTL` are read from MaskArt first, per
  extension: an archive entry `MASKART\<name>`, then the game folder's loose `MaskArt` folder, then `ART\`.
  `src/worker/image-decoder.js` `hdDimensionRefusal` takes the largest side (`max`, default CP3's 1024);
  `DETAIL_MAX_DIM = 2048`.
- MaskArt folder: `src/install/inspect-source.js` `findMaskArt` (every PNG / TGA under `MaskArt/`, any case; only where
  the source can list its files, since the names are the levels'), copied to `install/MASKART` by
  `src/worker/install-store.js` `copyMaskArt` at install and at Reload POD.INI (`src/ui/screens/install.js`,
  `src/ui/options-panel.js`), listed in the manifest as `maskArt`. An install made before this has no MaskArt copy until
  POD.INI is reloaded.
- Generated map: `src/shared/detail-normal.js` `buildDetailNormal` / `generatedDetailNormal` (cached), the 15.2.2 recipe
  with the engine's float32 steps (Math.fround); built on the page, once a session, so the worker never transfers it.
  Test: `tests/cp4-hotfix.test.mjs` (pixel (0, 0)'s height from draws 0, 16, 80, 336 and 1360 of an independent BigInt
  xorshift, its normal from the wrapped neighbours, and six texels as built).
- Shader, `src/render/water-surface.js`, the open-water program only (`WATER_FRAGMENT`; not the ice program, not the
  game's ripple water in `water-effects.js`): `waterDetailTextures` (normal RGBA8, mask R8, both repeat-wrapped and
  mipmapped, the normal anisotropic x8), uniforms `uWaterDetail`, `uWaterMask`,
  `uWaterDetailAt` (on, strength, clock, the world's feet).
  Layers at `at / 64` and `at * 0.26953125 / 32` (69 to a world, so the planes moving by whole worlds never shift it),
  drift (0.020, 0.010) and (-0.010, 0.015) repeats a second on a clock wrapped at 3600 s (a whole number of repeats of
  each), mask at `at / W` (W the world's width: 8192 ft, or a track format version 6 world's own; row = game z, as
  the terrain mask), `d = -(nA + nB) * 0.02 * (1 + 4 mk) * lod * watt *
  strength`, `lod = 1 - smoothstep(1.5, 5, pxFt)` from `dFdx` / `dFdy` of the map point. `slope += d` feeds the Fresnel,
  the glint and the under-water view; the mirror uses `slope + 1.5 d` (`mirrorFace`); the mirrored light and the water's
  body are scaled by `clamp(1 + 2.4 d . (0.6, 0.8), 0.7, 1.3)`. CP4's lakes (`render/lakes.js`) wear the same program and
  so get it too, as 15.2.3 infers for the engine.
- Differences: `watt` is 1 - the scene's fog at the point (`mtmFogHides`, or the linear fog), not the engine's per-vertex
  fog factor; the brightness factor leaves the sun's glint out (OpenMTM2's glint is its own, Cox and Munk), and the
  engine's other two shade terms (waves 0.5, slope 0.8) have no counterpart, so only the detail's 2.4 is applied (as
  the working notes proposed); `waterDetailDbg` is not ported.
- Waterfalls: not done. The notes leave the falls to the waterfall analyst; for that work, the DLL's fall shader has its own
  Normal-Water copy (`gWfDet`: x the debug paint, y the mask's 1 / period, 0 = off, z the strength; the same two layers,
  0.02 x (1 + 4 mask) x footprint x distance fade), in the waterfall HLSL strings at `180177aa0` / `180179750`.
  `src/render/waterfalls.js` was not edited.

#### B. Normal-Terrain (15.3)

- `_DTL`: `loadDetailImage` (2048 cap, odd shapes loaded, MaskArt first), in `loadTerrainDetail` (`track-build.js`).
- Always On Normal-Terrain: with no `_MASK`, `cp4TerrainNormalAlways` builds the default mask,
  `src/shared/terrain-mask.js` `defaultTerrainMask(clr, colors, cells)` (one grey texel a tile, row = tile z, slot = CLR
  bits 0-11), `defaultMaskStrength(luma)` (2 to 75, the line to 1.42 at 109, 1.42 (109 / L)^2 above, at least 1) and
  `defaultMaskByte(v)` = int((v - 1) * 0.25 * 255 + 0.5). Colours: `averageColor` of each tile texture as decoded (the
  plain sRGB byte average; a large HD tile read every few texels). Difference: where that average is missing or black the
  engine uses the palette colour of the tile's legacy index; here the legacy RAW tile's own average stands in. The
  terrain's vertices read it through `terrainMaskShares` as they read a painted mask. Needs "CP3 Terrain detail" on and
  the Enhanced look, as any terrain detail here.
- Normal-Terrain Strength: `strength` in the build (the slider / 100 with the default mask, 1 with the track's own);
  `src/render/track-scene.js` `addTerrainDetail` multiplies `TERRAIN_DETAIL` by it, which scales the tilt, the occlusion
  and the sun term together, as the DLL's amount does.
- The sun term (hotfix 3): OpenMTM2's detail tilts the lit (Lambert) normal, whose first-order response is the lean times
  the sun's horizontal share, the 0.53 form that vanished with a high sun. `addTerrainDetail` now adds the rest of the
  hotfix form, `lean . sunD * 0.5 * (1 - sunH)` (sunD the sun's unit bearing, the diagonal straight overhead), clamped
  +-0.3, as a factor on the colour, so the total is `lean . sunD * lerp(0.5, 1, sunH)`. None with the sun below the
  horizon. Differences: the engine adds its term to the light it multiplies the texture by, here it multiplies the colour
  (the same where that light is about 1); the lean is OpenMTM2's own (4x the engine's slope gain, as the existing detail
  had it), and the +-0.3 clamp is on the added part.
- Not done: 15.9's general HD art range (32..2048, resampled instead of refused). `HDTEX_MAX_DIM` stays CP3's 1024 for
  other art; only the detail maps take 2048 and odd shapes.

#### C. Shore field and shore foam (15.4)

Not ported, by choice. OpenMTM2's Reflective water (`src/render/water-surface.js`) keeps its own shore foam (the depth
band at the waterline) and its own churned wake foam; 15.4 stays as the record of what the engine does.

#### D. Sun below the horizon (15.8)

The engine's change for "the sun anywhere" was not located (UNKNOWN in 15.8); this is behaviour matching from the
engine's own formulas, which give no direct light from a sun under the horizon.

- `src/game/lighting.js` `sunBelowHorizon(toSun)`; `lightRig` gives the sun no strength then (Dusk, which puts the sun at
  11 degrees, is never below).
- `src/render/sun-shadows.js` `follow`: below the horizon the cascades' light and shadow strength are 0 and `update`
  draws no caster pass (the engine bakes everything as shadowed; its down-pointing gate never lights from beneath).
- `src/render/water-surface.js`: `uSunColor` and `uSunGlint` 0 (the engine's Blinn glint gives almost nothing there).
  The light shafts under water (`render/underwater.js`) already had none (they scale with the sun's height and the glint's
  light); `src/game/water.js` `sunUnderWater` is unchanged.
- `src/render/sun-flare.js`: no flare from a sun below the horizon (a ray toward it meets the ground). The disc is
  unchanged, as the engine's.
- `src/worker/relief-mesh.js`: the relief's baked shade takes no sun term (the LTE's own shade stays, without the relief's
  modulation by how it faces the sun).
- Unchanged: the classic look's sun on the models is three.js's per-pixel N.L clamp, the engine's own diffuse clamp; the
  non-Natural-light weather rig still sets the sun's strength, but with the Enhanced look's cascades it is zeroed as above.

#### E. Water range, terrShadowFacing, slope cutoff (15.5 to 15.7)

Verified in the code, no change: the Reflective water and the game's water are planes a world wide in each of the
world's copies (`createWater`, `track-scene.js`), moved by whole worlds with the camera and clipped only by the far plane
and the fog, with no disc; the enhanced terrain is `MeshLambertMaterial`, whose directional shadow darkens only that
light's own N.L term (a face turned from the sun takes no cast shadow); and with Natural light the terrain casts into the
same cascades, so the hill-cut double darkening cannot occur.

#### Tests

`tests/cp4-hotfix.test.mjs` (the generated map, detail art loading and the 2048 cap, the default mask's formula,
the settings, the strengths' scope, the shader terms by text, the sun below the horizon).

### 15.11 Fog volumes in the renderer DLL (CONFIRMED, `trid3d11.dll`; `APIDLLgpuFogVolumes` `180022040`, pipeline `180008360`, noise `18001ac30`, the exe's packer in `1401f6bb0`)

The hotfix 3 DLL is the first CP4 build with the fog volume renderer, which section 4 left UNKNOWN.

**Per volume (28 floats, at most 16 volumes, from the exe):**
- the centre;
- the box's two horizontal axes and its three half extents;
- the weather-lit colour, and sigma = 3 / (max(vis, 1) x units a foot);
- the halving rate 1 / (half x units), 0 without a half;
- the side fade min(edge, half the smaller footprint side) and the top fade min(top, h);
- the opacity cap maxOp, clamped to 0..1;
- round and wisp;
- the noise scale 1 / (max(wsize, 1) x 8 ft), in tiles a unit;
- the drift phase, frac(time x wspd / (max(wsize, 1) x 8)), held under 1;
- the bottom fade min(bot, h), 0 when it is not above 0.

**The pass:**
- One instanced draw of the box's back faces (the front faces culled), after the opaque scene.
- The pixel reads the scene's depth, so each line of sight runs from where it enters the box to the nearer of where it
  leaves the box and where it meets the scene.
- In the water's reflection pass the line starts at the water's plane.

**The integral:**
- 12 midpoint samples along the line, jittered per pixel by `fract(52.9829189 fract(dot(pixel, (0.06711056, 0.00583715))))`.
- Density at a sample:
  - `exp2(-halving x height above the floor)`;
  - times, with wisp > 0, `mix(1, smoothstep(0.25, 0.75, nz) x 1.6, wisp)`. Here nz = 0.65 n1 + 0.35 n2: n1 is the noise at
    (point x scale - (0, 0, 1) x phase) and n2 at (point x scale x 2.7 - (1, 0, 2) x phase). The noise is trilinear and
    wraps.
- The footprint outline:
  - round 0 is the rectangle;
  - otherwise a superellipse whose exponent runs from 16 (round near 0) to 2 (round 1). The distance inside it is
    (1 - F) / |grad F|.
- The wisps fray the outline inward only: `sd = min(sd, sd + (nz - 0.5) x edge x wisp x 1.5)`, with edge and top
  floored at 1.
- The fades are smootherstep (`x^3 (x (6x - 15) + 10)`):
  - sides over `edge`;
  - top over `top`;
  - bottom over `bot`, only when bot > 0.5.
- The optical depth is the sum x sigma x the step. The alpha is `min(1 - exp(-depth), maxOp)`, faded by the weather fog's
  factor at the line's entry (horizontal distance).
- The output is premultiplied, with a +-0.5/255 dither.

**The noise volume:** 64 x 64 x 64 bytes, made once (`18001ac30`).
- Three octaves of value noise that tile: 16 lattice cells across with seed 2, weight 0.3; 8 cells with seed 1, weight
  0.5; 32 cells with seed 3, weight 0.2.
- Each is trilinear with the quintic fade, the lattice wrapped at its cell count.
- The lattice hash: `h = seed x 0x9e3779b9 ^ x x 0x8da6b343 ^ y x 0xd8163841 ^ z x 0xcb1ab31f`, then `h ^= h >> 16`,
  `h *= 0x7feb352d`, `h ^= h >> 15`, `h *= 0x846ca68b`, `h ^= h >> 16`. The value is `(h >> 8) / 2^24`.
- The sum is stretched from its minimum to its maximum over 0..255.
- The sampler is linear and wraps.

**In OpenMTM2** (`src/render/fog-volumes.js`, `src/game/fog-volumes.js`):
- The DLL's integral, wisps, superellipse, fades, dither and noise volume (`fogNoiseVolume`) as above.
- The scene's depth is not readable inside OpenMTM2's own pass, so instead:
  - the box's faces toward the eye are drawn with the depth test, so what stands in front of the box hides it;
  - inside the box the line ends where it first meets the ground, from a 32 x 32 map of the drawn ground over each
    box's footprint, made at load (`fogVolumeGround`).
- Trees and rocks in the fog do not end the line.
- The weather fog veils the colour (render/atmosphere.js) rather than fading the alpha.
- Before this port the line ran through the whole box, the hillside under it included, and there were no wisps. A
  waterfall's mist (vis 60 ft at the densest) drew as an opaque block.
- A waterfall's mist fades over more of its box than the engine's (OpenMTM2's own, `FALL_MIST_SOFTEN` in
  `game/fog-volumes.js`): the sides over 0.85 of the smaller half extent, the top over 0.6 of the height. At the mist's
  density, the engine's 20 ft sides and 5 ft top still showed the box's outline.

### 15.12 Object lighting: the highlight and foliage (CONFIRMED, `trid3d11.dll` object material VS `18012d040` and PS `18012eb00`)

- The sun's highlight is added only on a face whose `specEnable` is set, a Gouraud facet (CP3_EXE_ANALYSIS.md 6), at
  `s^specPower` (32 when the record's is unset) times ks. A material record does not turn it on.
- **TRANSLUCENCY (FOLIAGE):** for a material with a translucency (the record's top 16 bits, 0.5 = 32768), the light on a
  face is `mix(I, max(I, I_back), translucency)`. Here I is its own side's diffuse and I_back the diffuse for the
  flipped normal, so a leaf lit from behind glows instead of going dark.
- The cutout uses the material's own alpha reference.

**In OpenMTM2:**
- The highlight is now on shiny faces only (`modelMaterial`, `src/render/track-scene.js`).
- Before, every lit CP4 material had the white highlight in the enhanced look, and three.js's default specular on top.
  The sun turned the leaf cards of CP4 trees (flags LIT, ALPHATEST, TWOSIDED, specPower 0) white.
- The translucency is drawn since hotfix 4's port (`foliage`, `src/render/track-scene.js`): the sun's and the
  lamps' cosine is `mix(max(n.l, 0), |n.l|, t)`, which with the ambient floor outside both is the DLL's
  `mix(I, max(I, I_back), t)`. The hotfix 4 instanced pass (trees and grass of a .VEG) has the same rule: its vertex
  shader carries the front and back light as a pair and pulls both toward the brighter by the slot's translucency
  (`prm.y`). Its cutout is at a fixed alpha of 0.5; the per-object pass uses the material's own reference.

### 15.13 Texture mipmaps (CONFIRMED, beta 0.53 hotfix 4 `trid3d11.dll` `180011fd0`, levels `180012a40`)

- Every texture the DLL uploads, the classic art (its own size, 128 by default) and the HD art registered with
  `APIDLLgpuRegisterHdTex` (square, 32..4096), gets a full chain the DLL makes itself, down to 1 x 1
  (levels = floor(log2(side)) + 1). `APIDLLsetMipMapLevel` does nothing.
- Each level halves the last. With the switch at `1801b5134` (1 in the shipped DLL, never written): a texel's red, green
  and blue are each the integer mean of those of its four that are not black (r | g | b != 0), 0 when all four are;
  its **alpha is the bitwise OR of the four alphas**. The other branch (switch 0) averages all four channels.
- So a texel with anything solid under it stays solid at every level: a cut-out (`clip(a - 0.5)`) keeps a grass
  blade or a leaf a few texels thin as wide as a whole texel of the level drawn, where averaged mipmaps thin it away.
  Measured on BAJARUN's 1024 x 1024 GRASS_MAT.PNG: 7 % of the base texels are over the cut; at 64 x 64, 5 % averaged
  and 25 % by OR; at 32 x 32, 4 % and 34 %.

**In OpenMTM2:** a model's picture with see-through texels that is a square power of two takes this chain in the
enhanced look (`src/shared/cp4-mips.js`, render/track-scene.js `modelTexture`), and stays out of the texture stacks
(render/part-merge.js), which would make the GPU's. Before, the GPU's averaged mipmaps left CP4 grass small and
sparse and its trees' leaves see-through at a distance. The classic look keeps the GPU's.

## 16. Beta 0.53 hotfix 3: waterfalls and lakes

Hotfix 3 rebuilds the waterfall sheet: a slab with a back face, flow tubes that merge converging columns and drop
torn triangles, ribbons for lone columns, a world-space across coordinate, smoothed and slope-limited vertex speeds, and
up to four landings ("streams") per fall, each with its own mist, droplets, foam zone and landing ring, on water or on
dry ground. The WFL gains roughFrom (byte 130). The DLL gains the froth whitewater on looks 1/2, the back-face shading
and the Normal-Water detail on the fall. The lake loader, the WTR format and the fall validation are unchanged.
Cross-references in this section (2.3, 12.2.5, ...) are to section 12 unless they start with 16.

### 16.1 Function map (CONFIRMED)

| 0.53 | Hotfix 3 | Does | Change |
|---|---|---|---|
| `14024ef30` | `140262fd0` | loader | new keys wfDepthScale, waterfallBulk; per-fall cap 32768; roughFrom log; stream, fold and flow-tube log lines; dump; table entry 0x188 |
| `1402486c0` | `140251d20` | level name -> stem | none |
| `140248720` | `140251d80` | WFL parser | roughFrom (byte 0x82); parsed record 0x90 bytes |
| `140248ed0` | `140252540` | status text | none |
| `140250260` | `1402647a0` | validation (REFUSED) | none (relocations only) |
| `14024da50` | `140261930` | 2D normalize with fallback | none |
| `140248f60` | `140252c40` | crest | none |
| `1402493a0` | `140257170` | columns of one spacing | none |
| `140249c20` | `140258af0` | column walk | rules unchanged; adds a replay mode (records at `14784b690`, count `14784b698`) |
| `140249250` | `140256e10` | ground normal by 0.5 ft differences | none |
| `1402496b0` | `140258230` | count-pass callback | also stores a per-row air flag (air != 0) |
| `14024a160` | `140259590` | build-pass callback | also stores each row's x, y, z (doubles) and the row picked as the dry landing |
| `14024a650` | `140259b60` | the mesh build | rewritten around the old core: 16.3 |
| `140249840` | `1402583d0` | per-vertex normals (+ per-vertex flow and tangent arrays) | extended |
| `1402511a0` | `140265900` | ground callback | none |
| `1402525d0` | `140266da0` | water callback (source lake excluded) | none |
| `14024cc30` | `140260a80` | per-frame draw | new per-fall constants [2].zw, [3].xy (16.7.4) |
| `14024db20` | `140261a00` | landing rings | per stream |
| `14024e3a0` | `140262390` | foam zones | per stream |
| `140250080` | `1402645c0` | anim clock, calls the droplets | none |
| `140250b00` | `140265040` | droplets | per stream, dry streams too |
| `140251200` | `140265960` | one droplet burst | reads the stream record |
| `140251f10` | `1402666e0` | sounds | table layout only |
| `140251920` | `140266090` | mist | per stream, new width, density share, dry streams too |
| `14024c520`, `140250960`, `14024c680` | `14025f830`, `140264ea0`, `1402604d0` | waterfallDebug | layout only |
| `140250150` | `140264690` | clear | layout only |
| new | `140252f30` | Totals' back-face count (CountBack) | |
| new | `1402532a0` | per-vertex horizontal flow and (horizontal, vertical) tangent pairs | |
| new | `1402525d0` | per-row across arc of the sheet vertices | |
| new | `140259100` | across coordinate u (anchor column, 1-2-3-2-1 smoothing) | |
| new | `1402573d0` | sheet coverage statistics (log) | |
| new | `1402581a0` | run-out start row (dry landing, slide) | |
| new | `140253bb0` (+ `1402558b0`, `140255590`, `140255360`) | flow-tube merge | |
| new | `140253900`, `140256580`, `140255050`, `140254a20`, `140254cf0`, `140255ba0` | strip and junction triangles, the torn test | |
| new | `1402563f0`, `1402546d0` | zipper ties for the slab thickness | |
| new | `1402576c0` | ribbons (lone tubes) | |
| new | `140257e00`, `140252b40`, `140252b90`, `140256d60`, `140255000` | junction emit helpers | |
| new | `1402588d0` | slab thickness | |
| new | `140254480` | per-row live columns in order (fold clamp) | |
| new | `140256f60` | landContinuous | |
| new | `14025fb50` | fold statistics (log only) | |
| new | `140266e70` | `waterfalls_dump_%d.bin` ("WFDUMP1") | |
| new | `1402657e0` | records walk steps for the replay mode | |

Globals: falls built `148666960`, vertices `148666968` (count `148666964`), indices `148666970` (count
`148666978`), parsed records `1486692d0` (64 x 0x90), built table `148660760` (64 x 0x188), droplet timers
`148668a90` / `148668e90` (64 x 4 floats each). The DLL entry points and pointer table are as in 12.0.2 at new addresses
(gpuWaterfallsAvailable `14012eff0`, gpuWaterfallMesh `14012efb0`, gpuSprayAvailable `14012eb20`, gpuSprayBurst
`14012eb40`).

### 16.2 Loader and file (CONFIRMED, `140262fd0`, `140251d80`)

#### 16.2.1 Ini keys

All in `[Graphics]` of `.\system\monster.ini`, read once per level:

| Key | Default | Range | Use |
|---|---|---|---|
| waterfalls, waterBodyLog, waterfallDebug, wfRingDecay, wfRingStrength, wfChurn | as 12.1.1 | as 12.1.1 | unchanged |
| wfDepthScale | 100 | 1..1000 | **now also read by the exe** (`140af3ed0`), /100 = ds of the slab thickness (16.3.10) |
| waterfallBulk | 100 | 1..1000 | new (`140af3ed4`), /100 = bulk of the slab thickness (16.3.10) |
| waterfallMist | 100 | >= 0 | unchanged (16.4) |
| waterfallDroplets | 100 | 0..400 | unchanged (16.5) |

wfDepthScale is also still read by the DLL for looks 1/2 (`tune0.x`, 16.7): one key, two readers.

**There is no key, no WFL flag and no record byte for "mist and droplets on dry ground".** The flags check is still
`flags & 0xfff8` = badFlags (`140251d80`), the record bytes read are those of 12.1.2 plus 0x82, and no other string or
key exists. What the hotfix does is build landings on dry ground (16.3.12) and give every landing, water or dry, its
mist (when the fall's mist % > 0) and its droplets (when the fall has SPLASH and the droplet gate is open). So the
per-fall control is the WFL's own mist % and SPLASH flag (INFERRED: this is what the author's "option" refers to; Traxx
1.8.0 warns "The water lands on dry ground: no foam strip or landing rings (mist and droplets still appear)").

#### 16.2.2 Record v1.1 and roughFrom

- roughFrom = record byte 0x82 (130), read only when the stride is >= 0x84. 0 and 255 are kept; **251..254 become 0**
  and count `roughInvalid` (parse result +0x5c); 1..250 kept. Stored at parsed record +0x8c (the record grew to 0x90).
  Stride < 0x84: roughFrom 0.
- Byte 0x83 is not read. Mist depth / height (0x80, 0x81) are unchanged (0 -> 100, at most 250).
- The log line "roughFrom 251..254 on %d fall(s): invalid, treated as 0 (engine default)" is written only with
  waterBodyLog and only when the count is > 0. It raises **no** on-screen message and does not count for "skipped".
- roughFrom reaches the shader as the per-fall constant [3].y (16.7.4); the exe does nothing else with it.

#### 16.2.3 Caps, log, dump

- Per-fall vertex budget = min(**32768**, 262144 - used) (0.53: 16384), clamped again to 0x8000 inside the build. Track
  caps unchanged: 262,144 vertices (16 MiB buffer), 1,572,864 indices (6 MiB).
- Log (waterBodyLog >= 1): after the ring line, "slab (spec 4.2): wfDepthScale=%d%%  waterfallBulk=%d%%  per-fall cap
  %d verts, track cap %d" (32768, 262144). Per fall: "fall %d: source %d  points %d  columns %d  spacing %g ft  verts %d
  (sheet %d, foam %d, back %d)  tris %d (back %d)  rows %d..%d%s"; the ends line and bounds line as 0.53; "landing ...",
  the largest stream (16.3.12); "landings %d (the line above is the largest)"; per stream "stream %d: x, y, z ft  width
  %.1f ft  drop %.1f ft  dir %.2f, %.2f  columns %d  water|dry"; "folds: %d of %d front tris flipped (%d zero-area)
  neighbour spacing x%.3f (row %d col %d) .. x%.3f (row %d col %d) of the crest's  crossed %d of %d pairs" (statistics
  only, `14025fb50`); "flow tubes: %d of %d columns merged into a neighbour, %d sheet triangles dropped by the split;
  ribbons %d verts %d tris (lone tubes); SHEET COVERAGE %.1f %%  streams per row max %d median %d  lone columns %d".
- waterBodyLog >= 2 also writes `waterfalls_dump_<id>.bin` (magic "WFDUMP1", `140266e70`: the fall's vertices and
  indices plus ground and water samples, NaN where there is no water) and logs "  dump: wrote|FAILED to write ...".
- Messages (12.1.3): unchanged.

#### 16.2.4 The built fall table (`148660760` + i * 0x188)

| Offset | Field |
|---|---|
| +0x00..+0x8f | the parsed record (36 ints; roughFrom at +0x8c) |
| +0x90 | stream count, min(streams, 4) |
| +0x94 | total columns over the kept streams |
| +0x98 + 36 s | stream s (s < 4): x, y, z (ft, unwrapped), width, drop, fx, fz (floats), columns, water (ints) |
| +0x128 | first index |
| +0x12c | index count |
| +0x130, +0x134, +0x138 | anchor x0 * 16, height * 128, z0 * 16 |
| +0x13c..+0x153 | bounds min xyz, max xyz (vertex units) |
| +0x154 | main landing x, y, z (the largest stream) |
| +0x160, +0x164 | main width, drop |
| +0x168, +0x16c | crest length L, crest speed |
| +0x170 | water-end count (columns ending in water) |
| +0x174, +0x178 | animation index, clock |
| +0x17c, +0x180 | main landing direction fx, fz |
| +0x184 | RNG state, id * 0x3c6ef362 + 0x9e3779b1 |

### 16.3 The mesh build (`140259b60`)

#### 16.3.1 Unchanged (CONFIRMED by fdiff)

Crest, columns, spacings {2, 3, 4, 6, 8}, the 1100 cap, the walk (dt 1/60, -32/60, drape 0.3, drag 0.98, air
tolerance 0.05, rest < 2 ft/s and cos 5 deg, 4000 steps, water test, row emission), the ground and water callbacks,
the trailing-flat trim (12.2.5: 1.0 ft, 8.0 ft, cos 10 deg), the bisection and SHORTENED, the build-pass vertex fields
and the sink vertex (12.2.7), the normals rule (12.2.8, applied to the built grid), the foam strip constants (12.2.10:
1.5 x drop clamped 4..40 ft, +0.1 ft, 3 vertices a column of a water run of >= 2).

#### 16.3.2 Per-row air flags and the dry landing row (CONFIRMED, `140258230`, `1402581a0`, the build at `14025abc7`)

- The count pass stores air != 0 per row. Row 0 (the crest) takes row 1's flag.
- **landPick** for a column that does not end in water, has >= 2 trimmed rows and whose last row is draped:
  1. FALL: among the airborne stretches that touch down before the last row, the one with the largest drop (y of the
     row before the stretch, row 0 for a stretch starting at row 0, minus y of its touchdown row; the first on a tie).
     If that drop >= 0.5 * (crestY - y of the last row): its touchdown row.
  2. Else SLIDE: the run-out start (`1402581a0`, the trim's step 1..2 of 12.2.5: back over the flat-contact rows, then
     forward while y - y_last >= 1.0 ft), if it is in 1 .. rows - 2.
  3. Else none (-1): the column's last written row.
  A water-ending column has none. With R, landPick sees only the rows under R.

#### 16.3.3 Budget with the back face (CONFIRMED, `140252f30` in the Totals of 12.2.6)

Totals(R) adds the back-face vertices: with the per-row air flags over the min(rows, R) grid, every sheet triangle
(the 12.2.9 pattern) with at least one airborne corner marks its three corners; back vertices = marked vertices; back
triangles = such triangles. Fewer than 3 columns: none. The fit test is then verts (sheet + foam + back) <= budget and
3 * tris <= index room, on the full grid before the flow tubes (16.3.4); ribbons are added after the choice
(INFERRED: they can push a fall past the budget; the build aborts through `14072c070` beyond 0x7fff entries).

#### 16.3.4 Flow tubes: the merge (CONFIRMED, `140253bb0`, distance `1402558b0` / `140255590`)

Decisions in double on the written path points (the rows' x, y, z of 16.1's build callback, after the trim and R).
- Every column starts live, weight 1.0, with left and right live neighbours (a linked list over the columns) and a
  last path row (its rows - 1, the sink not counted).
- For row r = 1 .. maxRows - 1, for each live column c in order with last row >= r, try its left then its right live
  neighbour n with last row >= r: d2 = the squared horizontal distance from c's path step (row r - 1 to r) to n's
  polyline over rows max(0, r - 64) .. min(r + 64, n's last row) (segment-to-segment, 0 when they cross strictly). If
  d2 < (0.25 * spacing)^2 the two merge:
  - the merged one is the column farther from the crest's centre, |2 c - C + 1| against |2 n - C + 1|; on a tie the
    higher index merges;
  - the merged column ends at the junction row (its rows become junction + 1, its `end` field is 1.0 on every row, its
    sink is dropped); the survivor's weight += the merged one's weight; the list is relinked;
  - strips and junction records are added for the triangulation (`140253900`).
- "%d of %d columns merged into a neighbour" counts the merges.

#### 16.3.5 The split: torn triangles (CONFIRMED, `140254a20`, `140254cf0`, `140255ba0`)

A vertex (c, r) is torn from a neighbouring column n when its 3D distance to n's polyline (nearest segment, rows
r +- 64) is over **3 x spacing** (squared test against (3 * spacing)^2, built at `14025a95c`) **and** either
- the nearest point is n's last row and n is neither merged nor water-ending, or
- the ground between them rises: N = ceil(horizontal distance / 1 ft) samples at t = k / N, k = 1 .. N - 1, and some
  sample's ground > max(y of the vertex, y of the nearest point) + **8.0 ft**.
A sheet triangle with a torn rung is not emitted ("sheet triangles dropped by the split"). Up to 4 answers per vertex
are cached.

#### 16.3.6 Ribbons (CONFIRMED, `1402576c0`, the build at `14025c3a0..14025c8a0`)

- A sheet vertex that no kept triangle uses gets a ribbon slot; its lens counts (16.3.10) are 1 and 1, and its ribbon
  width is W = min(max(**0.35** * weight * spacing, **2.0**), weight * spacing) ft (weight = the column's merge weight).
- Two vertices per ribbon vertex, appended after the sheet: copies of it moved -W/2 and +W/2 across (perpendicular to
  the vertex's horizontal flow; fallback the column's crest flow dir), u -W/2 / +W/2, edge 0, kind 0; a draped one
  (air 0) is re-snapped to ground + 0.3 ft unless it is in a water column's last two rows. The source vertex's edge
  becomes 1.0.
- Runs of consecutive ribbon vertices down a column are stitched as strips; a run's ends tie to the next sheet vertex
  when within 2 W (squared 4 W^2), each tie once (a pair table, at most 0x8000).

#### 16.3.7 The across coordinate u (CONFIRMED, `1402525d0`, `140259100`)

u (float 3) is no longer the crest arc s. Per row r over the columns that have row r (a water column's sink row left
out):
- across arc A: for consecutive such columns a, b: flow = normalize(f_a + f_b) (per-vertex horizontal flow, fallback
  f_b when shorter than 1e-9), d = (p_b - p_a) in ft, lateral = d . perp(flow), along = d . flow; off = min over the two
  vertices' (horizontal, vertical) tangents of |t x (along, dy)| - 0.25 ft; if off > 0, lateral = sign(lateral) *
  sqrt(off^2 + lateral^2); A_b = A_a + lateral. Each row's mean is subtracted.
- anchor column: the column with row r nearest the middle (C / 2, then C / 2 - 1, C / 2 + 1, ... alternating).
  Value: the crest s of that column at row 0 or when it is the middle column, else its own u of row r - 1.
  u_c(r) = anchorValue + A_c(r) - A_anchor(r).
- Then u is smoothed down each column with weights 1, 2, 3, 2, 1 (rows r - 2 .. r + 2, missing rows left out, divided
  by the weights used). A sink vertex copies the row above.
The DLL comment calls it "u in ft across the water, measured in world space per row".

#### 16.3.8 Speed ADVECT (CONFIRMED, `14025cc40..14025cdf0`)

On the sheet vertices' smoothed speed (float 5, 12.2.7):
1. Across each row: v' = (2 v + v_left + v_right) / (2 + n), v_left / v_right the nearest columns on each side that
   have that row (a sink row excluded), n the number found (0..2). Computed from the old values.
2. Down each column, i >= 1: ds = max(0, path_i - path_i-1) (float 15); v_i = clamp(v'_i, v_i-1 - **1.25** ds,
   v_i-1 + 1.25 ds), v_i-1 the already-limited value. So |dv/ds| <= 1.25 per second.
3. Ribbon vertices copy their source vertex's speed.

#### 16.3.9 Path and tau relaxation (CONFIRMED structure, `14025d1d0..14025d5f0`; skipped when the debug switch `14784b69c` is set)

- A sheet vertex is flagged when a non-torn left or right neighbour's path differs from its own by more than
  0.5 * spacing. Every row within +-8 rows (row >= 1) of a flagged row in the same column is relaxed.
- 64 Jacobi iterations on path (float 15) and tau (float 4): new = the mean of the non-torn left and right neighbours'
  values, the row above plus the column's own original increment, and the row below minus its original increment.
- Then made non-decreasing down each column, and copied to the ribbon vertices.

#### 16.3.10 The slab (CONFIRMED, `1402588d0`, the build at `14025c540`, `14025da07..14025dc70`, `14025e0d0`)

Thickness per sheet vertex, ft (v0 the crest speed, vE the vertex's speed after 16.3.8, air, drop = float 11, s =
path, Lend = the column's last path, ds = wfDepthScale / 100, bulk = waterfallBulk / 100, both 1 when <= 0):
- h0 = min(2 * ds, ds * v0^2 / 32); pile = 2 * h0;
- hc = h0 * v0 / vE when vE > 1e-9, else pile (or 0 when h0 * v0 is 0); hc *= k1 * k2 (two per-vertex factors from
  the tube build, `147b0b6b0` and `1483cac50`; UNKNOWN meaning, 1 for an unmerged column INFERRED);
- hDrape = max(min(2.5, pile, hc), 0.5 * bulk);
- hAir = h0 * (1 + bulk * max(drop, 0) / 25);
- h = clamp(hDrape + (hAir - hDrape) * clamp(air, 0, 1), 0.05, 8.0);
- lens = sqrt(max(0, 1 - t^2)), t = (a - b) / (a + b), a and b the vertex's column counts to the tube's two sides
  (`147ecbad0`, `147eebad0`; 1 and 1 for a ribbon); 0 when a + b <= 0;
- along = min(clamp(s / 1.0, 0, 1), clamp((Lend - s) / 3.0, 0, 1));
- thickness = h * lens * along, and 0 when the fall has 2 columns or fewer.

Then:
1. **Fold clamp**: per row, over the live columns in across order (`140254480`), for neighbours a, b with the
   combined flow: if the pushed offsets close the gap (the across component of n_b h_b - n_a h_a is negative) and gap +
   closing < **0.5** * gap, both thicknesses are scaled by 0.5 * gap / -closing (the smallest factor per vertex wins).
2. **Zipper**: pairs tying neighbouring tubes (`1402563f0`, weight 1.75 * the smaller of their half-areas) keep
   |h_a - h_b| <= that weight, iterated until nothing changes.
3. **Back face** (kind 2): every vertex marked as in 16.3.3 (the final air flags) is copied after the sheet and the
   ribbons, **unpushed**, with kind 2.0, air = its flag (0 or 1) and the normal negated.
4. **Front face**: every sheet and ribbon vertex is pushed by normal * thickness * 256; float 9 (which held the
   thickness) is reset to 0.
The DLL lifts the back face exactly as the front (it negates the stored normal again) and fades it by air (16.7.3).

#### 16.3.11 Buffer order and counts (CONFIRMED)

Per fall: sheet (column by column), ribbons (2 per ribbon vertex), back face, foam strip. The per-fall vertex fields
are those of 12.2.7 with: u as 16.3.7, speed as 16.3.8, path and tau as 16.3.9, kind 0 / 1 (foam) / 2 (back), the
front pushed (16.3.10).

#### 16.3.12 Landings: one per stream (CONFIRMED, the build at `14025e4f0..14025f450`, `140256f60`)

- Candidates, over the live (not merged) columns in order: if any live column ends in water with rows <= R, the water
  columns with rows <= R (landing point = the last written row, never the sink); otherwise every live column (landing
  point = its landPick row, else its last written row). A fall's streams are therefore all water or all dry (the
  stream's water field).
- Groups: a new group starts at a non-candidate column between candidates, or when two neighbouring candidates'
  landing is not continuous (`140256f60`): along the straight horizontal segment between the two landing points,
  N = ceil(length / 1 ft), samples k = 1 .. N - 1: water candidates need a water surface (the walk's water callback,
  with the fall's source) above the ground at every sample; dry candidates need ground <= lerp(y_a, y_b, t) + **2.0 ft**.
- More than 4 groups: the 4 with the most columns are kept (the first on a tie), then put back in column order.
- Per stream, with only its own columns: y = mean landing y; drop = mean (crestY - y); dir = normalize(sum of the unit
  horizontal last steps into the landing row, those longer than 1e-6), fallback normalize(sum of the crest point
  dirs), then (0, 1); across a = z fx - x fz, along b = x fx + z fz; width = (max a - min a) + spacing, or for a
  one-column stream whose landing vertex has a ribbon, the ribbon's W; x = mean(b) fx - mid(a) fz, z = mean(b) fz +
  mid(a) fx; columns = the count.
- The fall's main landing (+0x154, the log's "landing" line, the sound's position) is the stream with the most
  columns (the first on a tie).
- "ends water / rest / limit" and the water-end count (+0x170) are counted as in 12.2.11.

### 16.4 Mist (CONFIRMED, `140266090`)

- Volumes are made per **stream**: the outer loop is the stream index 0..3, the inner the built falls, so all falls'
  first streams take the 64 shared slots (12.4) before any second stream.
- A stream gets mist when s < stream count and the fall's mist % > 0. **The 0.53 test "water-end count > 0" is gone**:
  dry streams get mist.
- share = columns_s / total columns (+0x94), 1 when the total is < 1.
- density = (mist / 100) * clamp(crestSpeed * L * drop_s / 7200 * share, 0.25, 2.0) * (waterfallMist / 100); <= 0: none.
- Box: L = max(0.6 drop_s, 20) * depth% / 100 (unchanged); **W = width_s + 2 * clamp(0.05 drop_s + 2, 2, 6), at least 6**
  (0.53: width + 0.6 drop, at least 20); H = min(0.7 drop_s, 120) * height% / 100, at most 240 (unchanged).
- Centre, axes, floor (landY_s - 2), vis, half, colour and the other fog fields, the weather mask (0x1df with FREEZE):
  as 12.4, from the stream's x, y, z and direction.
- Slot full: "fall %d: NO mist for stream %d (no fog slot free, %d volumes)". Logged: "fall %d: mist (stream %d of %d)
  at ...".

### 16.5 Droplets (CONFIRMED, `140265040`, `140265960`; DLL `180026b20`, `180026c70`, shader `180128770`)

The emitter is 12.5's, run per stream instead of per fall. Everything needed to implement it:

**Gate (every frame, `140265040`).** Water look 1 or 2 (`140220bf0` returns 1..2), a player view exists, the two
graphics option flags (`140af2d00`, `140af1b88`; ids 0x20 and 0x19, names not traced), `enhancedWaterSpray` > 0
(`140af334c`), gpuSprayAvailable. Otherwise both timer arrays are cleared. waterfallDroplets read once per level
(default 100, clamp 0..400; 0 = off); k = value / 100. dt = ticks / 65536 s.

**Budget.** B += dt * 500, at most 80 (banked bursts, global); each burst costs 1; at most 6 bursts per stream per frame.

**Per stream s of fall f** (s < 4): skipped and its timers zeroed when s >= stream count, or no SPLASH (flags bit 1),
or (weather Snow (5) and FREEZE). **No water test: dry streams emit too.** The stream's x, z are wrapped into
[0, 8192) and then to the copy nearest the player's position ((dx, dz) in [-4096, 4096)); beyond 150 ft (dx^2 + dz^2 >
22500) the timers are zeroed.
- kS = max(k * columns_s / total, 0.001) (k when the total is 0).
- Interval: when the stream's interval is <= 0, draw one: state += 0x9e3779b1; h = hash(state); u = (h >> 8) * 2^-24;
  interval = (0.4 + 1.2 u) * 0.02 / kS. Timer += dt.
- vLand = sqrt(max(0, crestSpeed^2 + 64 drop_s)) (INFERRED: the argument of the sqrt is hidden by the decompiler; it
  is 12.5's), sizeK = clamp(drop_s / 60, 0.3, 1.0).
- While timer >= interval and B >= 1 and fewer than 6 this frame: timer -= interval; draw a new interval; B -= 1; one
  burst. After the loop, a timer still >= interval becomes 0.999 * interval.
- hash(x): x ^= x >> 16; x *= 0x85ebca6b; x ^= x >> 13; x *= 0xc2b2ae35; x ^= x >> 16. The RNG state is the fall's
  (+0x184), shared by its streams.

**One burst (`140265960`)**, with the stream's record: (c, s) = its direction, or with (fx, fz) = (0, 0) a random angle
in 0 .. 2 pi; per-burst state += 0x2e2ac0ea (with a direction) or 0x6a99b44c, then the draws of 12.5 (the per-draw
offsets, e.g. + 0x78dde6c4, are in `140265960`):
- position (ft, then * 256): x = X + c a - s j + 1.5 (2u - 1), z = Z + s a + c j + 1.5 (2u - 1), y = landY_s;
  a = 8 u ahead (or +-4 ft with no direction), j = (2u - 1) * min(width_s / 2, 60);
- velocity * 256: horizontal 0.2 u vLand at the angle dir + theta, theta uniform in +-1.396 rad; vy = (0.06 + 0.12 u) vLand;
- intensity = min(1, (0.6 + 0.6 u) * sizeK * 0.3 * k); waterY = landY_s * 256; halfW = min(12, width_s / 2) * 256;
  size scale = (1.5 + 1.5 u) * clamp(k, 0.3, 4); dlt 0, carrier velocity 0, smear 0; seed = a hash value.
- `gpuSprayBurst(posX, posY, posZ, velX, velY, velZ, intensity, waterY, halfW, seed, dlt, tvX, tvZ, sizeScale, smear)`.

**The DLL's spray (unchanged from 0.53 except reversed Z).** A ring of 4096 records; each record: pos, spawn time,
vel, intensity (clamped 0..1), waterY, halfW (>= 0), seed, dlt (0..0.25), tv, size scale (<= 0 -> 1, at most 4),
smear (0..0.25). `gpuSprayDraw(camera, dt, opacity)` advances the clock, draws the records younger than 2.4 s, 83
sprites a record: 80 drops (kind 0) and 3 blobs (kind 1). Units 1/256 ft; gravity -8192 units/s^2 (32 ft/s^2).
- uhash(x): x ^= x >> 16; x *= 0x7feb352d; x ^= x >> 15; x *= 0x846ca68b; x ^= x >> 16; h01 = (x & 0xffffff) / 2^24.
  Sprite s: h = uhash(seed ^ s * 0x9e3779b9), then h2, h3, h4, h6, h7, h8, h9 by rehashing.
- sfv = saturate((|vel| - 1500) / 6200). A sprite is skipped when idx + 0.5 > count * intensity * (drops: 0.55 +
  0.45 sfv; blobs: 1).
- smear smr = min(smear, 0.25); back = h9 smr; age = clock - spawn + back - (smr > 0 ? 0 : 0.06 h9).
- life = 2.0 * (drops: 0.65 + 0.35 h6; blobs: 1); culled outside [0, life).
- spawn = pos + lat * (h2 - 0.5) * 2 halfW - tv * back (lat perpendicular to the horizontal velocity, or (1, 0)).
- spd = max(|vel|, 768); cone: angle 2 pi h3, radius sqrt(h4), horizontal.
- v0: drops vel (0.6 + 0.4 h6) + cone spd 0.2 + up spd 0.5 h8; blobs vel (0.8 + 0.5 h6) + cone spd 0.12 + up spd 0.75
  (0.5 + 0.5 h8).
- Motion with drag k = 0.5 /s: E = (1 - e^(-k age)) / k; p = spawn + v0 E; p.y += g (age - E) / k. Culled when p.y <
  waterY and age > 0.03.
- Size (sc = size scale): drop width 12 (0.8 + 0.4 h7) sc, length clamp(0.025 |v on screen|, 2w, 2w + 520 sc), alpha
  0.9; blob width 44 (0.8 + 0.5 h7) sc, length clamp(0.00875 |v on screen|, 2w, 3w), alpha 1. The quad trails the head
  along the screen velocity.
- alpha *= saturate((p.y - waterY) / 96) * saturate(age / 0.03); fog fades only (1 - saturate((d - fogStart) /
  fogLen)); light = saturate(0.22 + 1.15 ambient); tint drops (0.92, 0.97, 1.0), blobs (0.86, 0.94, 1.0).
- Drop PS: body = (1 - smoothstep(0.3, 1, |uv.y|)) (1 - smoothstep(0.65, 1, uv.x)) smoothstep(-1, 0.15, uv.x); core =
  (1 - |uv.y|) smoothstep(-0.6, 0.5, uv.x); rgb = saturate(1.12 col + (0.10 + 0.9 amb^2) core); a = saturate(body
  (0.75 + 0.35 core)). Blob PS: disc = 1 - smoothstep(0.7, 1, r); glint = exp(-14 |uv - (-0.30, 0.35)|^2); rgb =
  saturate(col (0.85 + 0.15 (1 - r)) + 0.7 amb^2 glint); a = saturate(disc (0.7 + 0.3 glint)). Discard < 0.003; rgb *
  gLook.x (default 1).

On dry ground the drops die where they fall below waterY = the landing's height, so they splash off the slope foot.

### 16.6 Foam zones, landing rings, sound (CONFIRMED)

- Foam zones (`140262390`): landing boxes are per stream (the stream's water field set, the fall's water-end count >
  0), up to 256 candidates, nearest first, 32 sent; box constants of 12.6.1 with the stream's width, drop and dir.
  The lake-fed crest segments follow as before.
- Landing rings (`140261a00`): per water stream, constants of 12.6.2 with the stream's width, drop and position; the
  Snow + FREEZE skip kept; the "lake draws this landing" bit is set per fall from its streams.
- So dry streams get mist and droplets but no foam zone, ring or foam strip.
- Sound (`1402666e0`): unchanged rules, at the main landing (+0x154), which on a dry fall is now its largest dry stream.

### 16.7 Renderer DLL (CONFIRMED, `trid3d11.dll`; VS `180177aa0`, PS `180179750`, pipeline `18000ea00`)

#### 16.7.1 What changed

- Reversed Z (the clip z is no longer flipped); shaders go through a disk cache (`180006fe0`); cbWaterfall 0x1110 ->
  0x1120 bytes (gWfDet added).
- VS: the lift and depth pull run for every kind except 1 (|kind - 1| > 0.5): kind 2 negates the stored normal, so the
  back face moves exactly like the front. fq = (planar flag, kind, F2.z, F2.w) is passed flat (no interpolation).
- PS kind tests on the flat kind: foam = |kind - 1| < 0.5, back = kind > 1.5; bkA = saturate(air) on the back face, 1
  elsewhere; every look ends with alpha *= bkA.
- Look 0: back-face rgb * 0.6; otherwise unchanged (texture, second layer, mask, foam strip). Look 3: unchanged (its
  back face only gets the air fade).
- Looks 1/2: the old whitewater streak noise (lattice 1.2 x 7 ft, two fbm layers, threshold lerp(0.92, 0.38, W), width
  0.08 (1 + brk)) and the clump cut are removed; the froth below replaces them; roughFrom, the Normal-Water detail, the
  back-face rules are new; no glint on the back face.
- The wf* key set, defaults and ranges are unchanged (12.0.1; reader `180019a10`). New DLL key `[Graphics]
  waterDetailDbg` (default 0, gWfDet.x).

#### 16.7.2 Looks 1/2: whitewater W, froth and colour

Inputs: u, tau, air, edge, end, drop, opac, spd (crest speed), t, flow = (tau - t) spd, sd = path, v = max(speed, 0.5),
fog as 12.0.1, kWhite = (0.86, 0.90, 0.94), wLit = lerp(kWhite * light, fogColour, fog).

- roughFrom: rfR = gWfFall[f][3].y; vR = rfR if 0.5 < rfR < 250.5 else 25; wwOn = 0 if rfR > 254.5 else 1.
- W = saturate((wwOn * max(saturate((drop - 27) / 30) * saturate(air), saturate((v - vR) / 20)) * 0.9 +
  smoothstep(0.5, 0, saturate(end)) * 0.85) * tune0.z) * saturate(sd / max(tune0.w, 0.1)). (0.53: no air factor, no
  wwOn, vR = 25.) So 255 turns off the drop and speed terms; the impact term (end near 0) stays.
- an (streak weight) = saturate(max(saturate(air), smoothstep(10, 35, v))) * smoothstep(0, 0.5, saturate(end)).
- Hash hU(X, Y) = the value-noise hash of 12.0.1 without the 24-bit mask. Worley cell(p): c = floor(p), f = p - c; for
  the 9 neighbours o, h = hU(c + o), feature = o + ((h & 0xffff), (h >> 16)) * 0.8 / 65535 + 0.1; F1, F2 = the two
  smallest Euclidean distances (start 8 squared).
- Froth(F) = max(0.30 + 0.40 smoothstep(0.05, 0.70, F1), 1 - smoothstep(0, kWfWall, F2 - F1)).
- Density D(q, fq, an, det): fA = det * saturate(1.6 - 2 max(fq.x / kWfCellA, fq.y / (kWfCellA kWfAniso))); fB = det *
  saturate(1.6 - 2 max(fq.x, fq.y) / kWfCellB); cA = lerp(kWfFrM, Froth(cell(q / (1, 3.5))), fA); cB = lerp(kWfFrM,
  Froth(cell(q / 0.8 + (7.31, 2.17))), fB); cl = lerp(cB, cA, lerp(0.15, 0.85, an)); dv = fbm(q / kWfDensFt + (23.1,
  11.9)) (12.0.1's fbm); D = saturate(0.5 + kWfCellAmp (cl - kWfFrM) + kWfDensAmp (dv - 0.5)).
- Coverage (only when W > 0.001, else dn = 0.5, fo = 0): det = 0 on the back face; d1 = D(q1), d2 = D(q2) (the flow
  map's two phases, 12.0.1 / DLL notes), d0 = D(qo = (u, flow)); dn = lerp(d0, mix2(d1, d2, w1), fmx), fmx =
  smoothstep(2, 12, drop); dn = saturate(dn + 0.6 brk (cn - 0.5)); soft = kWwSoft (x 1.6 on the back); fo =
  smoothstep(1 - W - soft, 1 - W + soft, dn) * saturate(4 W) * saturate(1.5 sideK) (x 0.7 on the back).
- Foam colour: hl = saturate(0.5 N . sun + 0.5); fC = kWhite * light * (kFoamAmb + 0.35 hl^2) * lerp((0.84, 0.92,
  1.0), 1, smoothstep(0.15, 0.85, fo)) * (0.90 + 0.14 dn), then fogged.
- Gaps: aer = saturate(1.25 W) * saturate(1.5 sideK) (x 0.5 on the back); gapC = lerp(water, fC * (0.80, 0.90, 0.96),
  kGapAer aer).
- Output: rgb = lerp(lerp(gapC, wLit (0.9 + 0.1 dn), cs), fC, fo); a = opac * lerp(lerp(sh (1 - kGapClear aer),
  max(sh, 0.92), cs), max(sh, kFoamA), fo) * mask(edge, end, fray 0.6 brk); a *= 1 - 0.4 brk (1 - 0.75 fo); the dry
  foot fade (unchanged); glint (look 2 only, 0 on the back); a *= bkA.

| Constant | Value | Constant | Value |
|---|---|---|---|
| kWfCellA | 1.0 ft | kWfDensFt | (3.5, 8.0) ft |
| kWfAniso | 3.5 | kWfDensAmp | 1.3 |
| kWfCellB | 0.8 ft | kWwSoft | 0.22 |
| kWfWall | 0.22 | kFoamAmb | 0.65 |
| kWfFrM | 0.577 | kFoamA | 0.95 |
| kWfCellAmp | 1.2 | kGapAer, kGapClear | 0.25, 0.25 |

The rest of looks 1/2 (body colour, thickness from v0^3 / (32 v) * wfDepthScale, ripples, flow map, reflection,
Fresnel, calm lines, breakup) is 0.53's; the full path is in re/cp4b2dll/notes and the hotfix agent notes.

#### 16.7.3 Back face in the shader

Every look: alpha *= saturate(air). Look 0: rgb * 0.6. Looks 1/2: water = the plain body (no reflection, no detail
brightening), no Worley cells in the density, erosion 1.6 x softer, fo x 0.7, aer x 0.5, no calm lines, no glint. The
slab's offset is built by the exe (16.3.10), not the DLL.

#### 16.7.4 Per-fall constants (exe `140260a80` -> DLL `180020860`)

[0], [1], [2].x, [2].y as 12.9. New: [2].z, [2].w = the absolute anchor X and Z modulo the world (x - floor(x /
2097152) * 2097152, engine units), used only for the detail mask lookup; [3].x = 1.0 (the DLL takes fall 0's > 0.5 as
"a new exe is present" before it enables the detail); [3].y = roughFrom as a float (record +0x8c).

#### 16.7.5 Normal-Water detail on the fall (looks 1/2 only)

Only when gWfDet.y (the mask's 1 / period) > 0 and fog < 1: lod = 1 - smoothstep(1.5, 5, ft per pixel of (u, flow));
mk = the world water mask at (anchor mod world + local xz) * gWfDet.y; nA, nB = the detail normal map at (u / 64, (tau
spd - t sA) / 48) and (u / 118.72 + 0.37, (tau spd - t sB) / 89 + 0.61), sA = round(600 spd / 48) 48 / 600, sB =
round(600 spd / 89) 89 / 600; sDet = -(nA + nB) 0.02 (1 + 4 mk) lod (1 - fog) gWfDet.z; the ripple slope += sDet; the
reflection normal adds 1.5 sDet more; front-face water *= clamp(1 + 2.4 sDet . (0.6, 0.8), 0.7, 1.3). gWfDet.z = the
Normal-Water strength (default 1, export gpuSetDetailStrength, clamp 0..3); the map is the supplied one
(gpuWaterDetailNormalUpload) or a generated 256 x 256.

Further rules of looks 1/2 that 16.7.2 names (settled from the DLL's shader for the port; rules, no code):
- Defaults of the keys looks 1/2 read: wfWhite 100 (W's gain / 100), wfLipBlend 40 (sd's ramp, / 10 ft), wfBreakup 100
  (/ 100), wfFlowCycle 8 (/ 10 s), wfFoam 100 (the foam strip's gain / 100), wfDepthScale 100, wfCalmSpeed 40 and
  wfRoughSpeed 160 (/ 10 ft/s: calm .. rough water).
- Flow map: vA = max(speed, crest speed, 1) ft/s; cycles = max(round(600 / T), 1), Tc = 600 / cycles (T = wfFlowCycle);
  p1 = frac(t / Tc), p2 = frac(t / Tc + 0.5), w1 = 1 - |2 p1 - 1|; the cycle indices c1 = floor(t / Tc), c2 = floor(t /
  Tc + 0.5), each mod cycles; q1 = (u, sd - vA Tc p1) + frac(c1 (0.6180340, 0.7548777)) (37, 91), q2 the same with p2,
  c2 and the fractions offset by (0.5, 0.25); fq = fwidth(q1). mix2(a, b, w) = saturate(0.5 + (w (a - 0.5) + (1 - w) (b
  - 0.5)) / sqrt(w^2 + (1 - w)^2)). Near the crest every flow-mapped term crosses from qo = (u, flow) by fmx.
- Footprint fade: a value-noise lattice faded to 0.5 by saturate(1.5 - max(fw)) (fw its footprint in cells); the fbm's
  octaves likewise at 1, 2.03 and 4.11 times the footprint.
- brk = saturate(wfBreakup * smoothstep(15, 100, drop) * smoothstep(0, 1, saturate(air))). The outline is 12.0.1's mask
  on the flow-mapped noises, its side term times (1 + fray), fray = 0.6 brk. sideK = saturate(sqrt(saturate(edge)) 1.3 -
  0.35 k (1 + 0.6 brk) nS), nS the side noise's first octave (u / 0.8, s / 4), flow-mapped. cn = the value noise at q /
  (5, 6) + (13.7, 5.1), flow-mapped.
- The thickness h = max(0.05, v0^2 / 32 * wfDepthScale / 100 * v0 / v) * sideK ft, v0 = max(crest speed, 0.5).
- The dry foot: foot = (1 - air) smoothstep(0.985, 0.998, |N.y|) smoothstep(8, 20, drop) smoothstep(0.15, 0.7, tau -
  sqrt(drop / 16)) (1 - smoothstep(3, 8, v)); a *= 1 - smoothstep(0, 1, foot (1 + 0.6 (cn - 0.5))).
- The textured foam strip in looks 1/2 (drawn unless the lake draws the landing, flags +4): two layers of the fall's
  texture at anchor-relative xz / 12 + (0.04, 0.02) t and xz / 8.5 + (0.5, 0.3) + (-0.03, 0.035) t; sf = saturate(0.5
  + 3 (0.55 (l1 - lm) + 0.45 (l2 - lm))), l the luma, lm the texture's mean; rgb = lerp(the lake body, the lit white,
  saturate(0.35 + 0.65 sf)); a = opac * saturate(wfFoam / 100 * end^0.6 * (0.3 + 0.7 sf)) * lerp(0.6, 1, edge).

#### 16.7.6 Lake shaders

The foam-zone function is unchanged (up to 32 boxes, mask = min of smoothstep(0, feather, outside distance)). Contact
foam is now three shaders: grain (`18015e7a0`, alpha * zone mask as 0.53), half-res closeness (`180165cb0`, zone mask
in its green), and the full-res bubbly composite (`18016cdd0`), which **multiplies its final alpha by the zone mask a
second time at the pixel's own world xz** (alpha = foam * 0.85 * zoneMask): the "mask applied again" of the notes, so
foam blurred back into a landing zone by the half-res blur is removed. The landing rings and churn in the lake PS are
unchanged.

### 16.8 Lakes (CONFIRMED)

- The WTR parser (`14024fc10`) and loader (`1402506f0`) are 0.53's (relocations only). The header minor (byte 6) is
  stored and only logged ("format %d.%d"); **byte 20 (Traxx's flags, bit 0 = the EDGE rule) is never read**.
- SKIPPED reasons, order and conditions unchanged: HEIGHT_RANGE, NO_TILES, BELOW_BODY0, TOUCHES_BODY0. There is no
  check of a lake's surface against the surrounding terrain; "tiles not wet at this height" is a log count only.
- The fall validation (FALL_SOURCE, FALL_HEIGHT exact, FALL_DIRECTION) and the water callback are unchanged. No
  waterfall function writes the lake tables, and the WTR loader runs before the WFL loader.
- So "a waterfall can let a lake exceed the terrain-height limit", "lake height limits adjusted" and "lakes interact
  with waterfalls more easily" are Traxx-side (its EDGE rule closes a lake-fed fall's notch edges to the fill, so Traxx
  lets the lake stand above the notch's ground); the engine takes the TMAP and heights as written (INFERRED).
- "Water in full tiles": lake tiles were already drawn as whole 32 ft quads at the surface Y in 0.53 (`1401e7000`,
  0.53 `1401e5e80`). What changed in the water pass (`1401fa8f0`, 0.53 `1401f9320`): the tile window around the
  camera is a full square dx, dz in [-R, R - 1] (0.53: a disc dx^2 + dz^2 <= (R + 1)^2), for lake and main-water tiles.
- Wave tiers (Realistic only, INFERRED): a lake tile's tier comes from `140220400(tiles, surfaceY - bed)`: <= 100
  tiles 0; 101..300 tiles 1 if depth >= 10 ft else 0; 301..600 tiles 2; > 600 tiles 3 (0.53: lakes forced to 1). The
  main water's flood-filled regions use the same rule with depth = level - the region's lowest bed (0.53: <= 10, 40,
  60 tiles, no depth).
- New shoreField (`14021b710`, Enhanced/Realistic shore foam): a 2048 x 2048 world grid (4 ft) of (water Y - terrain)
  with the lake surface from the TMAP, a marching-squares contour and distance field, uploaded with
  gpuShoreFieldUpload; lake water stops at TMAP tile edges.

### 16.9 Other differences and UNKNOWN

- Network join version, the sound rules, the texture lookup and the anim clock: unchanged.
- The replay mode of the walk (`14784b690`, `14784b698`, recorder `1402657e0`) and the switch `14784b69c` (setter
  `140260490`, skips the across-arc correction, the relaxation and the zipper) are debug paths; no ini key sets them
  (INFERRED).
- UNKNOWN: the two per-vertex thickness factors `147b0b6b0` / `1483cac50` (16.3.10); the exact zipper weight's
  half-area; the junction triangulation of merged tubes (`140253900`, `140257e00`) beyond "strips and junctions";
  the coverage statistics (`1402573d0`, 0.95 and 0.25) which only feed the log.

### 16.10 In OpenMTM2

Implemented; hotfix 3 replaces the 0.53 build (no version switch). Its author published no source code: everything below
is from the analysis above and the decompile, no code copied.

OpenPhotex (vendored into OpenMTM2 and, with types, JSTraxx):
- `sim/cp4/falls.ts`: `readFallFile` roughFrom rule and `roughInvalid` (A.1); `FALL_MAX_FALL_VERTICES` 32768;
  `FALL_GRAPHICS_DEFAULTS.wfDepthScale` / `waterfallBulk` (100, clamped 1..1000 by `buildFallMeshes` options of the
  same names); per-row air flags and `landPick` / `runoutStart` (16.3.2); `totals` with CountBack (16.3.3); `buildOne`
  writes the build pass into columns and hands them to `buildFallSheet`; the foam strip over live kept-water columns,
  broken over (3 x spacing)^2 between landings; `fallStreams` + `landContinuous` (16.3.12); `BuiltFall` gains
  `roughFrom`, `streams`, `totalColumns`, `columnRows`, `ribbonVertexCount`, `backVertexCount`, `backTriangleCount`,
  `ribbonTriangleCount`, `mergedColumns`, `droppedTriangles` (`landing` = the largest stream); `fallMist(fall, record,
  { stream })` and `fallMists` per stream, outer loop the stream index, `noSlot` as `{ slot, stream }` (16.4).
- `sim/cp4/fall-sheet.ts` (new): `buildFallSheet` (flow merge, strips zipped as `140256580`, junctions, the torn test,
  lens counts, merge weights, ribbons, per-vertex flow and tangents `1402532a0`, across arc and u `1402525d0` /
  `140259100`, the spread factor `1402573d0`, normals, ribbon vertices, slab thickness, ADVECT, relaxation, back face,
  fold clamp, zipper, push), `fallSlabThickness`, `fallRibbonWidth`, `fallCountBack`, `FALL_SHEET` constants.
- `sim/cp4/fall-droplets.ts` (new): `createFallDroplets` / `stepFallDroplets` (16.5's gate, bank, per-stream timers,
  intervals, kS, wrap and 150 ft test, bursts), `FALL_SPRAY` (the DLL's spray model), the two hashes.
- Tests: test/cp4-falls.test.ts updated for the hotfix (back face in the budget, per-stream landings and mist, dry mist)
  plus roughFrom, slab numbers, CountBack, streams split by dry ground and the slot order, ribbons, tubes, droplets.

OpenMTM2:
- `worker/cp4-falls.js`: the slab options at their defaults (no ini), the roughFrom console line, "NO mist for stream
  %d", per-fall `roughFrom` / stream count / tube and ribbon counts in `list`, and `falls.droplets` (the emitter's
  inputs: slot, flags, rngSeed, crest speed, total columns, streams) unless the option is off.
- `game/fog-volumes.js` `withFallMists`: one volume a stream (`fall`, `stream`), `noSlot` as `{ slot, stream }`.
- `render/waterfalls.js`: kind 2: the draped lift for |kind - 1| > 0.5 with the back face's normal turned back, the
  foam test |kind - 1| < 0.5, alpha x saturate(air) on the back face in every look, look 0's back rgb x 0.6; the drop
  and path (vertex floats 11 and 15) for the enhanced look, on in the enhanced picture (`setWaterfallWater`, from
  `render/scenery.js`, hands it the Reflective water's uniforms while that water exists); `game/waterfalls.js`
  `waterfallLook(weather, flags, enhanced)`.
- `render/waterfall-water.js` (new): the enhanced look's pixel shader (below).
- `render/waterfall-spray.js` (new): the spray, one instanced draw of a 1200-record ring (500 bursts/s x 2.4 s), 83
  sprites a record worked out in the vertex shader (sprite hash, thinning, life, lateral spread, cone, drag 0.5,
  gravity 32 ft/s^2, cull under waterY, drop and blob sizes and pixel shaders, fade near waterY, at birth and by fog).
  Driven by the OpenPhotex emitter at the camera each frame; hosted by `createWaterfalls`.
- Option "Waterfall droplets" (`cp4WaterfallDroplets`, default on, Options, Advanced, CP4, under "Waterfalls"):
  `app/settings.js`, `ui/options-panel.js`, `app/main.js` -> `worker/asset-worker.js` -> `worker/track-build.js`
  (`droplets`), Spanish strings in assets/lang/es.json. No settings version bump: the default fills older saves.
- tests/cp4-falls.test.mjs: per-stream mist fields, the dry spring's mist, roughFrom, the droplets' inputs and the
  emitter on them, the option off, the option's default. tests/cp4-falls-enhanced.test.mjs: the enhanced look's choice,
  roughFrom as its uniform, its shader's rules and constants.
- Lakes: nothing (16.8, F).

Enhanced look. In the enhanced picture a fall that is not frozen (look 3 still takes a FREEZE fall in Snow) wears an
enhanced look in place of look 0: the engine's `enhancedWater` rule (12.8.3), one program for every fall, each fall's
values as its material's uniforms. With "Reflective water" drawing the track's water (render/water-surface.js) the
water's own uniforms are shared (the same objects); without it, `render/waterfalls.js` fills the same uniforms each
frame from the scene's lights and sky dome (`ownWater`: the daylight the sky's light plus the sun's by its height, the
glint the sun's light above the horizon, the water's own colour, the sky by `mirrorSky`), with no Normal-Water.
- Follows the engine exactly (16.7.2 .. 16.7.5 and the rules above, keys at their defaults: game/waterfalls.js
  `FALL_WHITEWATER`): W from the drop in free fall, the speed and the impact, with roughFrom (`waterfallRough`: 0 -> 25
  ft/s, 1..250 the speed, 255 drop and speed whitewater off, the impact kept; 251..254 already 0 from the loader), the
  lip ramp; the flow map, the outline and its fray, sideK, brk, the clumps; the froth (Worley F1/F2 on the DLL's hash,
  the kWf* / kFoam* / kGap* table), its erosion by W, the foam light (half-Lambert over kFoamAmb), the gaps, the veil,
  the dry foot's fade; the back face (no cells, 1.6x softer, froth x 0.7, gaps x 0.5, its plain body, no glint, x air);
  Normal-Water on the sheet (two layers in the sheet's own u and flow, snapped clocks, 0.02 (1 + 4 mask), faded 1.5 to 5
  ft and by the fog, the mirror normal 1.5x more, the brightness 2.4x clamped), reading the lakes' textures, strength
  and mask at the lakes' own period; the foam strip's two texture layers and its alpha.
- OpenMTM2's own (the water body, from Reflective water, in place of CP4's lake material): the water's own colour
  (`uScatter`) in the same daylight, seen through a sheet as thick as the engine's thickness rule, red first
  (game/water.js); churned water between the engine's calm and rough speeds turned milky as the Reflective water's wakes
  are; the same sky, read where the reflected ray meets the dome, blurred by the sheet's roughness, darker where the ray
  looks down; the same Fresnel term and the lake's facet glint, none on churned froth; small ripples riding down with
  the water; the foam strip's white over the Reflective water's churned colour instead of the lake body. No planar
  reflection at the lip, no calm streaks, no landing rings or foam zones (looks 1/2's lake side, 6.1, 6.2), no shadow
  on the glint, and the scene's fog over all. The constants to tune are `FALL_WATER_LOOK`.

Settled from the decompile (were UNKNOWN or differ from the wording above):
- The two thickness factors: k1 = the spread factor of `1402573d0` (for a vertex, the nearest columns either side
  having its row: ratio = (u_right - u_left) at the row over the same at row 0, at least 0.25; k1 = 0.95 / ratio when
  ratio < 0.95, else 1); k2 = the per-row merge weight (`1483cac50`: 1 plus the weights of the columns merged in above).
- The lens counts (`140253900`, `140254ec0`): a and b propagate along kept-triangle edges from each side of the
  connected sheet (0 on its edge columns), a lone vertex 1 and 1.
- The zipper's weight: 1.75 x the smaller of the two vertices' distances to the other's column polyline
  (`1402546d0`); its pairs are kept sheet-triangle edges whose ends are each other's nearest kept neighbour across
  (the partner arrays `14796b6b0` / `14798b6b0`, 3D, also the relaxation's left and right neighbours).
- The relaxation leaves each column's last row and a water column's water row as they are (`148612fa0`).
- Order: the thickness is computed at `14025ca95`, before ADVECT (`14025cc40`) and the relaxation (`14025d1d0`), so
  it uses the 0.53 smoothed speed and the unrelaxed path (16.3.10 says "after 16.3.8"); a merged column's Lend is 1e30
  (no foot taper). Ribbon vertices are copied at `14025c3a0..` with float 9 zeroed, before the thickness pass: their
  thickness is 0 (not pushed). The back face is copied after the relaxation, before the fold clamp.
- Per-vertex flow: the step (row - 1 to row + 1, the water row not stepping into the sink), kept when at least 1e-6
  units horizontal and not steeper than |h| < 0.1 |d|, turned to agree with the previous row's, else carried; then a
  5 x 5 window average. The fold clamp's gap <= 0 gives factor 0.
- The foam strip skips merged columns and breaks between live kept-water columns whose landing points are further
  apart than `147b4b6e8` (taken as (3 x spacing)^2, the split's threshold; its value is set at run time, INFERRED).

INFERRED (simplest reading) in the port:
- Strip and junction records, `osL` / `osR` / `need`, the junction's six torn tests and its (l, m, r) triangle, and the
  ribbon joins' partners (boundary edges, horizontal distance; `1402548e0` not read in full) follow the structure Traxx
  1.8.0 ports, checked against the strip walker `140256580` and the ribbon function `1402576c0`.
- A ribbon vertex keeps its source's normal; the pair table stops adding past 0x8000 entries (still ties).
- landPick sees min(rows, R) rows per column (the engine's loop carries a previous column's shorter count into a later
  column on a shortened fall; not reproduced).
- A fall the ribbons take past 32768 vertices is kept when the track's buffers have room, else DROPPED (the engine
  aborts past 0x7fff ribbon entries).
- Buffer order sheet, ribbons, back, foam as 16.3.11 (the copy's offset expression in the decompile adds one more
  term; not followed). Back triangles are the front ones reversed (a, c, b), all before the front.
- Droplets: the burst's per-draw offsets are the port's own (alike, not bit for bit); the sprite hashes h2..h9 are a
  rehash chain; "v on screen" is the velocity across the line of sight; the spray's ambient is the luminance of the
  port's sky and ground light on a matt face; the player's position is the camera's.
- Droplets show whenever Waterfalls and Waterfall droplets are on, on SPLASH falls, not in Snow on a FREEZE fall: the
  engine's gate (looks 1/2, enhancedWaterSpray, two unnamed options) has no OpenMTM2 counterpart.

Not done:
- Looks 1/2 (16.7.2 W, roughFrom's vR / wwOn, the froth cells, 16.7.5 Normal-Water on the fall): OpenMTM2 draws falls in
  looks 0 and 3 only, and the 0.53 looks 1/2 body they sit on (colour, thickness term, ripples, flow map, reflection,
  Fresnel, calm lines, breakup) is documented only as the DLL's shader text, which a clean-room port cannot take
  over. `roughFrom` reaches the renderer's list per fall for when a look 1/2 exists. (Since done: the enhanced look,
  above.)

## 17. Beta 0.53 hotfix 4: limits kept, normalStrength, the lights' allWx

`monster.exe` of 13,348,864 bytes (built Nov 16 2026), with its `trid3d11.dll` (1,853,952 bytes) and `trivk.dll` (byte
for byte hotfix 3's). Decompiled as `tools/re/decompile.sh cp4b4` (into `re/cp4b4/`, default
`~/Downloads/Beta0.53_hotfix4`). The DLL's shader text is hotfix 3's; it changed only in code. Fila's notes call the
hotfix crash guards for edge cases plus the normal maps' default strength. Its author published no source code: what
follows is read from the executable. Traxx 1.8.0 and 1.8.1 (released source) cite the engine's handover notes for the
same changes; where a rule below comes from them and was not traced in the executable, it says so.

### 17.1 Limits kept instead of overrun (CONFIRMED)

Each list is read whole; past the limit the entries are read into a scratch record and dropped, and the load logs one
line. Older builds wrote past their tables.

| List | Kept | Message |
|---|---|---|
| The SIT's vehicles (after the player's slot) | first 10 | "This track places %d trucks; this build holds %d." (`DAT_158380d74` set to 10) |
| The SIT's ramp section | first 100 | "This track places %d ramps; this build holds %d." |
| Backdrop models | first 5 | "This track lists %d backdrop models; this build holds %d." |
| AI courses | the primary and the first 4 extended (slots 0 to 4) | "This track defines %d AI courses; this build holds %d." |
| Segments of a course | first 249 (0xf9), primary included | "An AI course on this track has more than %d segments; the rest were dropped." |
| `.TEX` ground textures | 4096 | "This track lists %d ground textures; this build holds %d."; "too many ground textures" |
| Ambient sound list (`DATA\SOUNDnnn.TXT`, Trucksfx.cpp) | of the entries the weather allows, in file order: 10 looping, 40 one-shot | "This track's ambient sound list has more than %d looping sounds." / "... one-shot sounds." |
| Looping sound slots (boxes, waterfalls) | as before (30) | now "Too many looping sounds on this track; '%s' is silent." |

The terrain's resident cache may now fail ("terrain: RESIDENT CACHE NOT BUILT (%s) ...", "This track's terrain could not
be cached (%s); it will draw slower.", reasons "the renderer refused the buffers", "too many .ANI frame batches", "too
many .ANI ground-box frame batches"); the terrain is then drawn by the per-frame path. Vegetation's limits are
unchanged from hotfix 3: 64 types, 32,768 trees, 2,097,152 grass clumps (Traxx 1.8.0 raises its own planter to the
same 2,097,152). Traxx 1.8.0's notes list further guards not traced here: long track and sound names cut to fit, the
21st checkpoint refused, `.ANI` entries with no frames skipped, no pool for a light under 1 ft, the cone's rim-0 divide.

### 17.2 normalStrength (CONFIRMED)

`[Graphics] normalStrength` (monster.ini only, no menu entry) defaults to **220**: 120 in betas 0.52, 0.53 and
hotfixes 2 and 3 (the default's `.data` word read in each build). The exe hands `normalStrength / 100` to the DLL
(`APIDLLgpuNormalStrength`), and a material with MATERIAL2's normal-map flag gives `its own strength x normalStrength /
100`. The DLL's object pixel shader multiplies the CP3 normal map's tangent xy by it (`tn.xy *= nrmStr`) before
building the bumped normal. Normal-Terrain and Normal-Water are separate (15.1).

### 17.3 The lights' allWx and their glow and cone

- **allWx** (CONFIRMED as read): the SIT light line (box type 12) takes a 13th field, `%d`, stored beside the other
  twelve, default 0; the header line is `Llight rad,hgt,r,g,b,glow,glowRad,coneLen,coneRim,coneBase,bright,aimOff,allWx`.
  A 12-field line reads 0. Its effect, from Traxx 1.8.0's engine rules (not traced here): non-zero draws the light's
  glow and cone in every weather; the ground pool keeps to the lamp weathers (rain, fog, dense fog, dusk, night, pitch
  black).
- **The glow and cone** (Traxx 1.8.0's engine rules, unchanged by the hotfix): only the first 128 lights (MAX_LIGHT_PROPS).
  The glow is a square `2 glowRad` a side in the box's XY plane at the lamp head (box-local (0, hgt, 0)), facing the box's
  +Z, additive, seen only from in front, its brightness times the eye's direction along +Z. The cone is a six-sided tube
  along +Z, `coneBase` across at the lamp (a diameter) and `coneRim` from the axis at `coneLen` (a radius), alpha 0.09 x
  brightness at the lamp to 0. Brightness is 1 while the lamp is nearer than groundVisX x 32 ft along the view (3840 ft
  at the default view range) and 0.2 past it, faded by the fog in Foggy, Dense fog and Snow.

### 17.4 Detail on ground boxes

Traxx 1.8.1 reports the engine bakes the ground boxes into its terrain buffer and shades them with the terrain detail
term, laid in world XZ on every face (tops continue the ground's pattern, walls take one smeared row of it, the relief
ignores the face normal). Not traced here.

### 17.5 Painted water removed (CONFIRMED)

Hotfix 3's painted water (`paintedWater`, `paintedWaterBand`, `paintedWaterLift`, `paintedWaterDebug`,
`paintedwater.txt`) is gone: the keys and its log line are no longer in the executable, and the shore field's key and
log drop the painted count (15.4.1). OpenMTM2 never ported it.

### 17.6 In OpenMTM2

- Limits (17.1): `src/game/cp4-limits.js` `withCp4Limits` (trucks, backdrops, courses, segments; applied to every
  non-CPR track's SIT in `worker/level-load.js`), the ramps in `worker/track-build.js` (the first 100 of the ramp
  section; ramps keep their SIT index), the ambient sounds in `src/audio/world-audio.js` (`AMBIENT_LOOPS_MAX`,
  `AMBIENT_SHOTS_MAX`). Each drop logs the engine's line to the console. The `.TEX` cap is not applied: a ground
  texture is addressed by 12 bits of the `.CLR`, so no more than 4096 can be used.
- normalStrength (17.2): an option, not the engine's default. Settings `cp4NormalMapStrength` (percent, 0 to 300,
  default 100: OpenMTM2's look keeps the strength it had), Options, Advanced, CP4, "Normal map strength";
  `render/track-scene.js` `setNormalMapStrength`, set by the race, replay and fly-by screens, multiplies the material's
  own strength on CP3 normal maps only (not 4x4 Evolution's bump maps).
- Lights (17.3): OpenPhotex reads and writes the 13th field (`SitLight.allWx`, `SIT_LIGHT_HEADER`);
  `worker/track-build.js` keeps the first 128 (`TRACK_LIGHTS_MAX`), puts the lamp head at the box's (0, hgt, 0) turned
  by its matrix and hands the box's axes and `allWx` on; `render/track-lights.js` draws the glow as the box-facing
  square with the facing fade, the cone with its base as a diameter, both with the distance step, glows and cones of an
  `allWx` light in every weather, and no pool under 1 ft. OpenMTM2's own: the glow's round texture (HEADLITE.RAW is not
  read) and the cone's look (render/light-beam.js).
- Ground boxes (17.4): an option, off by default (settings `cp4GroundBoxDetail`, "Detail on ground boxes"):
  `createGroundBoxes` gives them the terrain's detail term with the mask's shares at their vertices, in world XZ. Off,
  as before, since the grain on buildings' fronts looks wrong (OpenMTM2's own "Ground box grain" stays separate).
- Tests: tests/cp4-hotfix4.test.mjs.
