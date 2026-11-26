# Community Patch 4 2.0.52.4: the engine's changes since August 2026

On 2026-11-24 the developer of Community Patch 4 (CP4) published two notes for OpenMTM2 on mtm2.com:
`KMASTER_ENGINE_UPDATES_SINCE_AUGUST.md` (rules, limits, network, INI) and `KMASTER_ENGINE_UPDATES_FORMATS.md`
(file layouts, sections F1 to F15). They describe build 2.0.52.4. **He provided no source code**: the notes state
behaviour, layouts and limits only, and name what he withheld (his section 9). This document restates what OpenMTM2
takes from them, in our words, and is what the code is written from. Where it overrides an older finding of
`CP4_EXE_ANALYSIS.md` (beta 0.52 and 0.53, build 2.0.52.2), this document wins for 2.0.52.4.

The author's status words are kept where they matter: **built** (in the build), **seen** (he checked it in game),
**pending** (built, not yet checked in game).

## 1. Track listing and identity

- The track list is one pass over the mounted archives in `pod.ini` order, taking `.SIT`, `.SI2` and `.SI3`
  situations as they come (any case). There is no merging by stem: `FOO.SIT` and `FOO.SI3` are two tracks, and so are
  `FOO.SIT` and `FOO.SI2`. At most 2,048 tracks across all archives.
- A track is known everywhere (profile, Hall of Fame, tournaments, saved games, replays, multiplayer) by its
  situation file name with its extension. Nothing may assume `.SIT`.
- `.SI2` has the content of a `.SIT`; a track is saved so when it omits the legacy texture fallback or uses anything
  retail would misread (16-bit heights, more than 20 checkpoints, a `.CPX`). `.SI3` is track format version 6.

## 2. The track version record, `DATA\<stem>.TXV`

- Optional ASCII `key=value` lines. `#` lines and blank lines are comments; keys are case-insensitive and values
  trimmed. A line is at most 255 characters and the file at most 64 KB: a larger file is unreadable and the track
  loads as classic. A repeated key: **the last one wins**. Unknown keys are ignored.
- Level files (`.TXV`, `.RA*`, `.CL*`, `.WTR`, `.VEG`, `.WFL`) are looked up by the level name first, then by the
  situation stem.
- A `formatVersion` above what the reader knows still loads and plays, with one note to the player ("needs a newer
  build"). Version 6 is shared by the race rules and track format 6, so classic against version 6 is decided by the
  situation's extension and the four version 6 keys (`worldCells`, `terrainHeightMap`, `terrainHeightStep`,
  `terrainHeightBase`), never by the number.
- An unknown `terrainGrid` value reads as classic, with the same note.
- `uiSmall`, `uiLarge`, `logo`: declared UI bitmaps (archive entry names), used as given; absent, the names are
  derived as before.
- `raceRules = drag | parallel | race` announces `WORLD\<level>.CPX` (section 7).

## 3. Track format version 6 (`.SI3`) as CP4 2.0.52.4 builds it

Departures from, and additions to, the open draft (revision 2026-11-19):

- A negative `terrainHeightBase` is refused (the draft allows it). Writers must not emit one.
- A `.SIT` or `.SI2` whose level `.TXV` carries any version 6 key is refused: "this level is a version 6 level".
  `formatVersion=6` with `raceRules` on a classic track is fine. A `.SI3` needs `formatVersion` 6 or more.
- A level is either classic or version 6: a version 6 level never shares its level files with a classic track
  (several `.SI3` may share one version 6 level).
- `!waterHeight` on a `.SI3` stays in half feet and must lie in 0 to 2 x (base + 65536 / step), else the track is
  refused.
- Lake and fall heights follow the track's kind, not the file's version: on `.SIT`/`.SI2` 1 to 4,096 half feet; on a
  256-cell `.SI3` (version 1 files) 1 to 4,096 **or** the track's window 2 x base + 1 to 2 x (base + 65536 / step); on
  a 512-cell `.SI3` (version 2 files) the track's window only.
- Sidecar sizes: `.CLR`, `.CL0`, `.LTE` and the `.RA0`/`.RA1` pair (8- or 16-bit, both alike) are checked for the
  world's size; a wrong size refuses the race and names the file. A missing `.CLR`, `.CL0`, or `.RA1` beside a
  `.RA0`, or a missing `.RAW` without a height map, loads the level (flat or empty, never a crash) but cancels the
  race, naming the file. A missing `.RA0` means no ground boxes. `.RA2` to `.RA5`, `.CL1` and `.CL2` (old cave
  layers) are never read: their size or absence changes nothing.
- The sky and shadow ceilings follow the terrain's top on a `.SI3`: top + 512 ft, never below 1,024 ft.
- The new race AI is off on every `.SI3`; the original autopilot drives there.
- Status: built; kinds 2 and 4 seen. Pending: driving across the 512 edge, replays at 512, `.SI3` save and load.

## 4. Classic tracks: the ground files

- Every classic track archive must carry `.RA0`, `.RA1` and `.CL0`, even with no ground boxes (zero-filled files of
  normal size are fine). In CP3 and before a missing `.RA0` stopped the ground load and left the previous level's
  ground in memory ("black terrain in clear weather").
- CP4 loads a track with none of the three as "no ground boxes". A track with a `.RA0` but no `.RA1` or no `.CL0` is
  refused.
- On a track with smooth terrain (`terrainGrid=spline` or `fine`), a truck start found under the ground is lifted to
  6 ft above it; nothing else is moved at load.

## 5. Sidecars and their archive

`.VEG`, `.WTR`, `.WFL` and `.CPX` count only when they sit in the same archive as `LEVELS\<level>.LVL`. A loose file
or a copy in another archive is absent. `<level>` is the first token of the situation's line 1, cut at the first dot.

- `.WTR`: a body is skipped (logged) when its id is 0 or repeated, its seed count is outside 1 to 8, its tile count
  differs from the tiles the map gives it, its height is outside the window of section 3, its height is at or below
  the track's water, or any of its tiles is already wet under the track's water (judged against that water's mean
  level). Only a damaged header, directory or tile map refuses the whole file.
- Painted water (water inferred from MTM1 "water" textures) is gone from CP4 since 2026-11-15: lakes are only
  authored, never inferred from a ground type.
- `MODELS\<model>.SRF` counts only in the same archive as the model's `.BIN`. At most 64 surface boxes a track.

## 6. Limits (2026-11-24)

| What | Limit |
|---|---|
| Placed objects | 4,608 on `.SIT`/`.SI2`, 16,384 on `.SI3` |
| Checkpoints | 100 slots on every track type; more refuses the track |
| Copies of a split checkpoint slot | 8 |
| Ramps, top-crush objects | 100, 100 |
| Movers (trains and type 13) | 100 |
| Lights (type 12) | 128 a track, 128 lit at once with the headlights |
| Fog volumes (type 14) | 64 a track, the nearest 16 drawn; waterfall mist shares the 64 |
| Lakes | 255, 8 seeds each |
| Waterfalls | 64, 2 to 8 crest points |
| Vegetation | 64 species, 32,768 trees, 2,097,152 ground-cover clumps, at most 1,024 a tile |
| `.CPX` walls | 64 walls, 1,024 points each, 8,192 in all |
| Looping sounds | 30, shared with waterfalls; over budget is silent |
| Unique models a level | 24,576 |
| Model texture table | 4,096 |
| Tracks listed | 2,048 |
| HD texture edge | 2,048 |

Over a limit, CP4 keeps the first N and logs a note the player does not see.

## 7. Content that changes a race

### 7.1 Tree trunks (`.VEG` collide = 1)

- A square box (not a cylinder) on the tree's origin, turned by the tree's heading.
- `trunkDiam` and `trunkHeight` when given, as authored (height still clamped). Otherwise the side is 65% of the
  model's widest horizontal extent among the vertices in its lowest 5 ft (15% of its widest side when there are
  none), and the height 30% of the model's height, clamped to 6 ft and the model's height.
- Everything times the tree's scale.
- Only the nearest trees collide: 24 a truck and 128 at once. Trees the scenery detail hides do not collide.
- Computer trucks do not see trees. Ground cover never collides.

### 7.2 Original Physics

One switch that turns off, at every level load, the triangle collision against props and the impulse and bottoming
dampers added on 2026-09-07, restoring the 1998 box collision for old freestyle and drag tracks. Online the host's
value is used (packet 42, section 10). OpenMTM2 folds it into its "CP4 collisions: Classic boxes" choice: classic
boxes also drops the impulse cap and the bottoming share.

### 7.3 Rumbles and drags

On these two types only, boxes without a model, and scenery boxes next to a checkpoint (the "posts" the computer
trucks normally drive through), are solid for every truck.

### 7.4 Tide and movers

- The track's water tide advances once a physics tick at a fixed rate with the remainder carried, so the surface
  steps at 25 Hz. It restarts at every race start, restart, saved-game load and attract start (a resumed race does
  not restart it). Lakes have no tide.
- Movers advance once a physics tick on the race clock and are drawn interpolated. The list of active boxes and ramps
  is rebuilt before every catch-up tick.

## 8. Race rules, `WORLD\<level>.CPX`

The byte layout is OpenPhotex's (`src/mtm/cpx.ts`, "MCPX" version 1). Requirements: a `.SI2` or `.SI3` situation, a
`.TXV` with `formatVersion=6` and `raceRules`, and the situation's track type 1 (drag), 2 (Parallel) or 2/3 (a race
with splits). The `.CPX` mode is the truth; the situation's type is what older builds fall back to. `WORLD\` + level +
`.CPX` fits in 31 characters (the level at most 21).

### 8.1 Modes

1. New-style drag, one run (`laps` 1) or looped (`laps` 0, laps from the menu).
2. **Parallel Race**, a new race type: two trucks, one lane each; touching a wall costs time instead of a
   disqualification.
3. An ordinary circuit or rally with split (alternate route) checkpoints.

### 8.2 Checkpoints

- One `CPBX` record per checkpoint box of the situation, in box order: slot, role (1 pre-stage, 2 stage, 3 launch,
  4 finish, 5 gate), split (0 none, 1 any copy, 2 per lane), lane (1 or 2 for per-lane copies, else 0), a flag to paint
  the ground line, and a fingerprint (heading and x, y, z of the box).
- Progress is per slot. Split 1: the first copy crossed credits the slot and the others are not tested again that
  lap. Split 2: a truck is tested only against its own lane's copy.
- On new-style drags a beam counts only when the front wheel's hub height is inside the box's height band
  (checkpoint boxes at least 8 ft tall). The entry direction is as retail.
- Pre-stage, stage and launch count once; gates and the finish every lap.
- A missed checkpoint is retail's rule: a truck passing close to a checkpoint without crossing it has missed it.
  With copies, crossing any copy credits the slot; the miss is held while the truck is still near any copy and
  reported only once it has left all of them.

### 8.3 Lanes and courses

- Lanes are assigned once at the start by the normal start-slot shuffle and stored: lane 1 is the first start slot
  and course 0, lane 2 the second and course 1. Online the lane comes from the spawn slot; trucks beyond the second
  slot have none. The drag tree lights the stored lane's side.
- A course marked first pass only (`COUR`) is a lead-in: the truck drives it once, to its last segment, then follows
  its lane course for good.

### 8.4 Walls

- Contact is a swept test of the body and tyres against the wall's ribbon (a path of points with bends, a thickness
  centred on the path and a height above an absolute base). Passing under the base or over the top is not contact;
  gap stretches have no wall.
- Drag: any wall contact disqualifies, staging included. Not judged during replay playback, on a reposition, or for
  remote trucks (each owner judges its own truck).
- Parallel: each contact adds `wallPenaltyMs` (design 5 s). The same wall cannot penalise the same truck again until
  the truck has been clear of it for `wallRearmMs` (design 1 s).

### 8.5 Laps, time-out, results

- The menu sets the laps; one-run drags are always 1 lap.
- Time-out = `timeoutMs` when not 0, else laps x 90 s (replacing the fixed 33 s on new-style drags). A truck not
  finished by then is out.
- Looped drags report the best lap as the fast lap and the total as the run time.
- A Parallel race ends when every truck has finished; offline it also ends when the time-out runs out, counted from
  the first finish. The order is finish time plus penalties, and the results note a truck that loses on penalties.
  Penalties survive pause-menu replays and resumed saved games.

### 8.6 Checks and refusals

`readCpx` reads the bytes; the game checks the rules:

- `CPBX` count equals the number of checkpoint boxes; slots run from 0 without gaps, never decrease, at most 100.
  Copies of a slot share role and split. Split 0 has one copy, split 1 at least two, split 2 exactly two (lane 1 and
  lane 2).
- Mode 1: slots 0, 1, 2 are pre-stage, stage, launch; one finish slot, last; gates between. If the start slots are
  per lane, every slot is.
- Mode 2: no start roles; the finish last; the rest gates.
- Mode 3: all gates but a final finish; split 0 or 1 only; lane 0; no ground lines; `RULE` timing fields 0; no walls.
- Modes 2 and 3: `laps` 0.
- Fingerprint: off by more than 16 units on any axis or 64 heading units: "Track rules do not match the track
  (re-export from Traxx)".
- `COUR`: one record a course; course 0 to 4; then-course not the course and not itself a lead-in; modes 1 and 2
  then-course 0 or 1; a lead-in's own course not 0 or 1; at most one lead-in a then-course. A `COUR` defect is
  ignored with a note; every other defect refuses the race.
- `raceRules` set but no `.CPX`: "This track's race rules (WORLD\X.CPX) are missing." A `.CPX` without the key is
  used, with a note. Bad magic or a truncated file refuses. A mode that does not fit the situation's type: "Track
  rules do not fit this track type (re-export from Traxx)."
- A refusal stops before the green flag and goes back to the race menu with "Race not started: <note>". Replays and
  attract mode are never refused. A drag track without a `.CPX` keeps the old drag rules exactly.
- The course map draws lane 2 in palette colour 253.

## 9. Drag racing, the computer trucks and offline modes

### 9.1 Drags (CP3 rules kept, CP4 additions)

Kept from CP3: beams broken by the front tyre only, within the beam's width; each truck judged on its own lane;
reversing faster than 2 ft/s for 0.5 s with a wheel down after green disqualifies; a disqualified truck is no longer
judged; staging gap per strip; a disqualified truck hitting a clean unfinished one flags a re-run; solo passes.

Added:

- In every drag, computer trucks coast 1.5 s after the finish, then brake to a stop and hold. A disqualified computer
  truck runs on to its would-be finish. The human truck is never touched.
- Computer trucks in drags shift automatically.
- A disqualification's run time is 3,600 s (was 60 s).
- Bracket seeding is the standard draw (1 v 8, 4 v 5, 3 v 6, 2 v 7).
- AI Speed 70 to 130 %, default 100, for every race type.

### 9.2 Computer trucks

They drive the player's whole garage setup (tyres, suspension, transfer gear). In Summit Rumble they are named after
their truck instead of "Computer".

### 9.3 Rumble

The scoring clock and the match clock run per physics tick, 25 ticks to a scoring second. A knock-off is debounced 50
ticks (2 s). The match ends at minutes x 60 x 25 ticks. Online the owner of a truck is authoritative.

### 9.4 Tournaments and drag weekends

- Classic scoring is retail's place table extended to 16 places, 80, 70, ... 10 for places 9 to 16. Championship
  scoring: 10-8-6-5-4-3-2-1 in the 8-truck format, 25-20-15-13-12-...-1 for 16-truck drags. A truck that does not
  finish still takes a place and scores.
- Drag weekend: qualifying then a bracket; a field of 2 to 16 with byes to 2, 4, 8 or 16; the better seed picks the
  lane; a tie at the shown hundredths or a double disqualification re-runs the pair. Qualifying is one lap; bracket
  passes run the chosen laps. Parallel tracks count as weekend tracks.
- Files, `Tournaments\*.trn` (presets) and `*.trs` (seasons, `autosave.trs` the running one): text `key=value`,
  first line `MTM2 Series 1.0`, unknown keys ignored, absent keys default.
  - `.trn`: `NAME`, `DESCR`, `FORMAT` (0 standard: at most 8 entrants, circuits and rallies; 1 drags only: 16),
    `SCORING` (0 classic, 1 championship), `SONIC`, `AISPEED` (absent keeps the player's), `FIELD` (opponents),
    `ROUNDS` (at most 128), and a round each `R=<track file>,<pod>,<laps>,<weather>` (0 random; -2 reads as 0).
  - `.trs` adds `PROGRESS=1`, `CURROUND`, `PLAYERTRUCK`, `BANKED`, `ENTRANTS` (at most 16), an entrant each
    `E=<truck file>,<pod>,<isPlayer>,<total points>,<name>`, per round a `RP=<points>/<place>/<contested>` for each
    entrant, and `X=<hex>`, an opaque per-entrant computer state that may be ignored.
  - At most 64 files listed. A round's missing archive blocks the start.

### 9.5 Time Attack and ghosts

- Hot laps against your own best-lap ghost; the HUD shows the gap at each checkpoint against the ghost's splits. Laps
  driven before End Race bank to the Hall of Fame (whose track list holds 4,096 tracks).
- `Ghosts\*.gst`, text, lines at most 1,024 characters, `\n` (a `\r` before it tolerated):
  `MTM2GHOST 1`, `track <file>` (63), `trackname <name>` (95), `truck <file>` (63), `truckname <name>` (95),
  `driver <name>` (63), `laptime <s>` (above 0, at most 1e6), `splits <n> <n cumulative times>` (n 0 to 100),
  `samples <n>` (2 to 200,000) and n lines of 29 numbers (9 significant digits, single spaces): time into the lap
  (never decreasing), truck position (3), orientation (3), front and rear axle positions (3 + 3), axle articulation
  front and rear, steering front and rear, the four tyres' vertical offsets (FR, FL, RR, RL), their rotation angles
  and their spin rates.
- Recorded at 25 Hz from the player's own simulation, played back as recorded. Every value finite, |v| at most 1e7,
  |position| at most 1e6; a short or unterminated last line is an error. Written to a `.tmp` then renamed.
- The axis and angle conventions are the game's world frame and were withheld; OpenMTM2's ghosts are in its own frame
  and reading CP4's is not verified.

## 10. Network

- Packet 3's version is (build << 8) | revision: 2.0.52.0 = 0x3400, 2.0.52.2 = 0x3402, **2.0.52.4 = 0x3404**. The
  hello's client string in CP4 is `"CP4 2.0.52.4"`. The version is a layout id; a mismatch only warns.
- **Packet 42, Original Physics**: one signed 16-bit value after the 12-byte header, 0 off, 1 on; read only those two
  bytes. Only the host sends it: on every toggle, in the late joiner's snapshot and just before the start packet
  (20). Joiners race on it, show it read-only, never save it; it clears on disconnect.
- **Packet 43, Parallel race penalty**: i32 truck number (packet 38's numbering), u32 penalty total in ms; 20 bytes.
  The truck's owner sends its running total and the receiver sets it, so a repeat cannot double-count. Accepted after
  the receiver's race loop has ended. Only on `.CPX` Parallel races.
- Both packets travel on the ordered reliable channel. Ignoring 42 is safe only in a room on default physics, 43 only
  when the track is not Parallel.
- At most 8 racers a session. A truck mismatch warns, never refuses (a machine without the truck shows the first in
  its list). Online races wait for every human to finish; a mid-race disconnect ends the race with a message.

## 11. Saved games and replays

- Retail bodies are unchanged; blocks are added at the end only when needed, and older builds stop before them.
- Replay `penalties` block (Parallel races with penalties), after the last record: a line `penalties`, a line with
  the event count (at most 4,096), then `<time>,<vehicle slot>,<running total ms>` lines on the replay's clock. On
  playback each truck's total is set to its value at the current time. A resumed race writes one time-0 event for
  each non-zero restored total.
- Saved game `*** CPX Race State ***` block (while a `.CPX` governs the level), after the saved situation: the line,
  a count, then `<penalty ms>,<course being followed>` a truck in saved vehicle order.
- Saved game on a `.SI3`: a line `@si3 <situation file name>` after the weather line.
- Replays and saved games keep the real situation extension.

## 12. Look only (no race result changes)

Waterfalls, water styles and waves, foam, wakes and reflections, detail masks and normals, normal maps and AO,
materials, light pools, glow and cones, fog volumes, HD sky, the 3D cockpit, body dents, and the twin-props rule:

- Two static props are twins when their padded world boxes overlap by at least 80% of the smaller box and at least
  10% of the lower-priority prop's face area is doubled by same-texture faces of the other that face the same way
  (within 10 degrees) and lie within 0.5 ft. CP4 then skips drawing the higher-priority twin at Normal and Complex
  scenery detail. Collision and the AI are unchanged. Across the stock install this hides four boxes (ROCCASTL,
  PPCASTLE, JUNK GRAVEY); the rule is applied on every track, not from a list.

Also: HD art up to 2,048 px; truck level-of-detail models try `<full stem><digit>.BIN` first, then the old name.

## 13. What OpenMTM2 did differently before this document

Listed so the changes can be checked: the track list merged `.SIT` and `.SI2` of a stem and listed `.SI2` first; a
repeated `.TXV` key kept the first value; a negative `terrainHeightBase` loaded; version 6 keys on a `.SIT` were
ignored; `.RA2` to `.RA5`, `.CL1`, `.CL2` were checked on a `.SI3`; a `.RA0` without `.RA1`/`.CL0` loaded with no
ground boxes; a 256-cell `.SI3`'s version 1 lakes took only 1 to 4,096; one bad `.WTR` body refused the file; `.WTR`,
`.VEG` and `.SRF` were read from any archive; the surface box cap was off; HD art stopped at 1,024; trunks were
clamped to at least 1 ft and collided for every tree and every truck; the tide followed race time continuously;
computer trucks stopped at the finish and stopped when disqualified, kept the player's gearbox, and had no garage
setup; Summit scored on float seconds; tournaments scored 8 places; the network spoke 0x3402 and refused a missing
truck.

## 14. How OpenMTM2 takes them

Where each rule lives: track loading `worker/catalog.js`, `worker/level-load.js` (`RaceRefusal`), `game/cp4-limits.js`,
`worker/track-build.js` (`lakesOf`, the twin props through `worker/twin-props.js`); race rules `game/cpx-rules.js`,
`game/drag-race.js`, `game/cpx-walls.js`, `worker/sim-worker.js`; Time Attack `game/extensions/time-attack.js` (an extension, EXTENSIONS.md); tournaments
`game/race-points.js`, `game/events/tournament.js`, `app/tournament.js`; the formats in OpenPhotex (`mtm/txv.ts`,
`mtm/wtr.ts`, `mtm/cpx.ts`, `mtm/ghost.ts`, `mtm/series.ts`, `mtm/replay.ts`, `mtm/saved-game.ts`, `sim/mtm2/race`,
`sim/mtm2/world/water.ts`); the packets in the OpenMTM2 Server's `protocol/mtm2-packets.js`.

OpenMTM2's own choices, kept apart from CP4's:

- The rules of the CP4 engine itself (the 64 surface boxes, the nearest-tree limits, the tide per tick, Summit Rumble
  in ticks, the solid boxes on rumbles and drags, the computer trucks' drags) apply under the "CommPatch4" physics;
  OpenMTM2's own physics keeps its own (every surface box of a converted city counts, every tree collides).
- Original Physics is the Options choice "CP4 collisions: Classic boxes", not a Garage checkbox.
- A racer leaving mid-race ends the race only with a Community Patch room; OpenMTM2's own rooms hand the truck to the
  autopilot.
- Ghosts are kept with the player's data (by track), in the `MTM2GHOST 1` text, in OpenMTM2's frame. Time Attack is
  an extension, chosen from the Races screen's Mode list on a circuit or a rally (EXTENSIONS.md, "Shipped extension:
  Time Attack"), driven with the driver's Garage setup; it is not offered in online rooms.
- The `.CPX` walls can be drawn (Options, Advanced, "Race rule walls", off by default): see-through red boxes, each
  piece as the contact test sees it. The notes do not say Community Patch 4 draws them.
- The course map's lane 2 on a Parallel race is drawn in palette colour 253, magenta (255, 0, 255) in every stock
  level palette, on both maps.
- A network race waits for every other human's own finish, as 2.0.52.4 does; OpenMTM2's 10 s guard after the
  player's finish runs on the computer trucks only. The pause menu's Results still ends the wait for that player.
- Summit Rumble online: each machine sends its own trucks' scores in the results barrier (0x18) and the places
  follow those scores (the owner is authoritative). During the match the board already shows each owner's score:
  every truck state (0x02, the f32 at +0x39) carries it and the worker takes it (`sim-worker.js`, remote updates).
- The notes do not describe CP4's netcode; beta 0.54's executable does (CP4_EXE_ANALYSIS.md 18): the remote trucks'
  buffer and pin, 0x27's hit check and 0x26's send points. OpenMTM2 follows them in a CP4 room (18.5). 0x2b's truck
  "in packet 38's numbering" is the 0-based truck index, as 0x26's.

Not taken yet:

- HD art of another size resampled with a note (it is passed over for the legacy art, as before).
- Not applicable to OpenMTM2: the new race AI being off on `.SI3` (OpenMTM2's computer drivers are its own), the sky
  and shadow ceilings (its sky stands round the camera), truck level-of-detail names (it draws one model), the
  "Allow two copies" and renderer keys.
