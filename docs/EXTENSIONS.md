# OpenMTM2 extensions

Extensions add optional game modes without making them part of the original game simulation. OpenMTM2
currently ships with Hockey, Soccer, Tag, Cops & Robbers, Race & Rumble and Combat. They appear in the Races screen and in Options, but their rules,
settings, rendering and worker state stay behind extension loader contracts.

## Ownership boundary

None of these were modes in Monster Truck Madness or Monster Truck Madness 2 (Cops & Robbers and Race & Rumble
were played by the community under hand-kept rules; Combat is after Carmageddon's combat racing). They must never be
implemented in OpenPhotex. OpenPhotex owns TRI file formats and behavior found in the original games.
An OpenMTM2 extension may call public OpenPhotex simulation primitives, but its rules and adapters belong
in this repository:

- `src/game/extensions/` contains pure rules, manifests, race preparation and worker runtimes.
- `src/render/extensions/` contains optional three.js presentation.
- `src/game/extensions/loader.js` is the mode, settings and selection registry.
- `src/game/extensions/race-loader.js` adapts a mode to race setup, HUD and results.
- `src/game/extensions/session-loader.js` adapts a mode to the simulation worker lifecycle.
- `src/render/extensions/loader.js` creates optional scene objects.

Core modules may import those loaders. They must not import Hockey, Tag or another concrete extension.
`race-loader.js` keeps one adapter per mode in its `ADAPTERS` table; a new mode adds an entry there, not a branch.
A new extension should require a registry entry and its own modules, not a new mode branch in `flow.js`,
`settings.js`, `race-select.js`, `race.js`, `results.js` or `sim-worker.js`.

## User-facing behavior

The Races screen combines the core modes with every extension available for the installed tracks. An
extension declares its label, accepted tracks, length control, fixed weather if any, detail level and
settings. The length, weather and mode selectors share one row, with Mode at the far right.

Options has an Extensions tab. Each registered extension gets its own panel, built from that extension's
settings schema. Values are stored below `settings.extensions.<id>`. Extension races use the normal
countdown, selected computer opponents, Garage setup and difficulty. Their results use place, score in
the Points column and the extension's result time. They do not enter the Hall of Fame.

## Extension pseudo-format

This is the intended shape, not a serialized file format. Functions remain ordinary ES module exports.

```js
export const MY_EXTENSION = Object.freeze({
  id: "my-mode",                 // stable lowercase id
  name: "My Mode",               // menu and Options title
  description: "What it does.",
  length: {
    key: "rounds",               // key below settings.extensions["my-mode"]
    label: "Rounds",             // Races screen length label
    default: 3,
    min: 1,
    max: 99,
  },
  settings: [
    { key: "rounds", label: "Rounds", type: "number", min: 1, max: 99, default: 3 },
  ],
  acceptsTrack(track) { return true; },
  trackLocked: false,             // true when the mode owns the track choice
  keepsRace: false,               // true to play on the track's own race: checkpoints, laps and its ending
  minEntrants: 2,                 // trucks the mode needs (the player counts unless spectating); omit for none
  teamPicker: null,               // a team mode: (settings) => { teams, teamNames, teamColours, roles, roleColours }
  weather: null,                  // null uses the player's weather; a number locks it
  detailLevel: null,              // null uses the normal setting
  damageKey: null,                // "repair": the Crash Damage key is the mode's (adapter `keyAction`), damage always on
  watchWhenOut: false,            // true: a player out of the race (adapter `out`) watches it on, as in spectator mode
});
```

Settings may be `type: "number"`, `type: "boolean"` (a checkbox) or `type: "select"` (with `options`, each
`{ value, label }`). Register the manifest in
`game/extensions/loader.js`. Add an entry to `ADAPTERS` in `race-loader.js`. Its `prepare` returns only the pieces
the mode needs; the other members (labels and their colours, map marks and points, the arrow's truck, the finder's
target, the result time, the HUD, the network state) are listed at the top of that file:

```js
{
  id: "my-mode",
  dress: { mode: "my-mode", ...replaySafeData },
  course: optionalCourse,
  walls: optionalWalls,
  start(index, normalGridStart) { return normalGridStart; },
  simulation: { mode: "my-mode", ...plainWorkerData },
}
```

Register a factory in `session-loader.js`. Its runtime can implement these generic hooks:

```js
{
  id: "my-mode",
  held(index) { return false; },
  heliAllowed(index) { return true; },   // false refuses the Helicopter key
  heliSpot(index) { return null; },      // where the helicopter sets the truck down, or null for the course
  keepsRace: false,                      // finishing runs the trucks on for their times, then finish()
  tick() {},
  drive(truck, index) {},                // return false to leave the truck to the course's autopilot
  touch(a, b) {},
  afterTruckStep(truck) {},
  specialBox: null,
  collideSpecial(index, box, collide) { collide(); },
  addSpecialWalls(allBoxes, nearbyBoxes) {},
  view(secondsSinceStart) { return { mode: "my-mode" }; },
  score(index) { return 0; },
  finish() {},
  groundFor(index, ground) { return null; }, // a truck's own ground, set up once (Combat's hides a lost wheel's)
  movableBoxes() { return []; },          // the mode's own loose objects, met by every truck (Combat's lost wheels)
  selfRecovery(index) { return false; },  // a computer truck gets itself out of a jam (game/racer-recovery.js)
  action(name, index) {},                 // the input's `modeAction` (the mode's key, its menu's choices), for truck 0
}
```

The environment a runtime is given also has `liftTo(truck, segment)`: the helicopter for that truck, set down on
that course segment as for a missed checkpoint. A box from `movableBoxes` with `extensionOwned` set is not sent as
a level object's pose: the mode draws it from its own view.

Hooks are optional except for those the mode uses. The runtime owns mode state. The worker owns fixed-step
timing, trucks, collisions and race transport. Data returned by `view` must be structured-clone safe.

If the extension draws anything, register one scene adapter in `render/extensions/loader.js`. It returns
`updateMarker`, `update` and `dispose`; a replay receives the same plain `dress` data. `update(frame)` runs each frame of
a race (never in a replay) with `{ state, poses, drawn, dt, camera, effects, flags, near, floorAt }`: the mode's view,
the trucks as drawn and their objects (`setTire(i, { hidden, wobble })`, `tireModel(i)`), the race's tire effects (its
sparks), `near(pos)` the drawn copy of a world point and `floorAt(x, z, y)` the ground under it. A `marker` colour in the dress asks
for the arrow over one truck (the adapter's `markerTarget`).

## Teams, start grid and names

- **Team picks.** A mode with a `teamPicker` (Hockey, Soccer, Race & Rumble) lists the player and each picked
  truck in the Computer Opponents dialog, each with a team colour and, where the mode has roles, a role, "Auto"
  leaving it to the mode. The picks are kept below `settings.teamPicks.<id>` by the player (`@player`) and by truck
  file, and reach `prepare` as `ctx.picks`. Trucks left on Auto join the smallest team. An online room keeps its own
  teams.
- **Start grid.** A track with fewer start slots than trucks (a free roam level has one, or none) gets more for a
  party mode (`game/race-setup.js` `fillGrid`): behind and beside its first slot, or its start, in pairs 30 ft
  apart, a row every 40 ft, facing its way, riding as high over the ground as the first slot, none within 20 ft of
  another. A room fills all eight, the same on every machine. Spectator mode works on these tracks too.
- **Names** are on (drivers' names) when a party mode starts; the Names key cycles them as usual.

## Shared presentation

- **Names (N key):** shown over every truck at any distance, past the camera's far plane too; only a truck behind
  the camera or off the screen has none. Labels are not hidden by terrain.
- **The arrow** (Tag's It, the robber): drawn over everything, so it is found from anywhere on the track. Far
  away it keeps at least 3.5 percent of the picture's height, and past 90 percent of the far plane it is drawn on
  the same line of sight just inside it. It is hidden from inside that truck's cab.
- **The overlay map:** a mode may colour each truck's dot (its team) and mark one truck with a larger blinking
  diamond (`marker: "arrow"`), which stays at the map's edge, on the line to it, when the truck is off the map.
  It may add points of its own (the ball, in white).
- **The checkpoint finder:** a mode may point it somewhere else (It, the robber, the ball, a rival racer), without a
  number, or hide it; Race & Rumble's racers keep the checkpoints. Rendering modules are the only
extension modules that may import three.js.

Keep rules pure where practical and test them under Node. Add an integration test that starts a worker
session through the generic `extension` payload, checks the public `race.extension` state, and verifies
the finish condition. Also test selection availability, settings defaults and migration when changing a
stored setting shape.

## Over the network

Extension modes run in online rooms (`docs/MULTIPLAYER.md`), not in classic games. The room's owner
picks the mode on the Races screen, like the track; every machine then runs the same extension.

Each machine still simulates its own truck, but a mode's decisions need one judge, since every
machine sees slightly different copies of the other trucks. **The room owner's machine decides**:

- Its runtime runs as usual (`env.net.authority` is "owner") and offers `netState()`: the mode's
  state in plain data. The worker returns it with each tick (`modeNet`).
- `src/net/net-race.js` sends that state to the room 5 times a second, and at once when something
  happened (the event count, a face-off, a new It, the end).
- Every other machine's runtime is a **follower** (`env.net.authority` is "follower"). It skips
  the rules' decisions (Tag's touches and scoring, Hockey's goals and face-offs) and takes the
  owner's state with `applyNet(state)`. It still drives its own truck and its own escape and
  recovery.
- **Truck order.** Each machine numbers its trucks itself, its own player being truck 0. So
  per-truck values travel keyed by vehicle number, through `extensionNetToWire` and
  `extensionNetFromWire` in `race-loader.js` (helpers in `net-wire.js`).
- **The owner leaving.** If the owner leaves during the race, the new owner's machine becomes the
  judge and carries on from the last state it was given.

What each shipped mode sends:

- **Tag:** It, the points, the time as It, the opening hold, who may not be tagged back and until
  when, the last tag, the end, and the owner's scoring rules (MTM64's rules add the pass cooldown).
- **Soccer:** as Hockey, the ball for the puck.
- **Cops & Robbers:** the robber, the points and captures, the time safe, the last capture, the count of
  captures and where the robber was set down (a follower that drives the robber sets its own truck down there),
  the end.
- **Race & Rumble:** the mode, the teams and roles, the blockers' cheers or the chase's busts (the event and its
  count), each cop's busts and the bust cooldown, and the end; the times come from the results exchange as in a race.
- **Combat:** judged differently, as only the machine that drives a truck sees its own crashes (the others see a copy
  smoothed from 20 states a second). Each machine judges the trucks it drives: its player's, and on the owner's the
  computer trucks and any a player left. Its runtime's `netOwn()` (the worker returns it with each tick as
  `modeOwn`) is their state: each pool as a share, the wheels lost, the credits, the damage dealt and wrecks, the
  repairs, wrecked or left and by whom, and the credits owed to trucks judged elsewhere (running totals of hit points
  dealt and wrecks). `net-race.js` sends it as a `modeTruck` event (OpenMTM2 Server's `docs/PROTOCOL.md`) under the
  player's vehicle, 5 times a second and at once when a wheel comes off or goes back, a truck is wrecked or leaves, a
  repair is made or a wreck is owed. Another machine takes it with `applyNetOwn` (the adapter's `ownToWire` and
  `ownFromWire`): it shows a hit as debris, throws a lost wheel, tells wheels, wrecks and repairs, and adds the
  credits owed to its own trucks once. The owner's `mode` state is the end, the winner, the order the trucks went
  out in, and its rules (toughness, credits on or off, credits at the start), which every machine takes on the
  first state.
- **Hockey:**
  - the teams, the score, each truck's goals, the phase and its timer, the last touch, the last
    event, the number of face-offs, the time played, sudden death and the end;
  - the puck's position, velocity, rates and angles. A follower snaps its own puck to them, and
    its local physics moves the puck in between.
  - On the first state and at every face-off, a follower puts its own trucks on their spots for
    the owner's teams.

A new mode that should play online implements `netState` and `applyNet`, makes its runtime's
decisions depend on `env.net.authority`, and adds its wire mapping to `race-loader.js`. The places and
scores of an extension race come from the owner's state on every machine, so they are not taken from
the results exchange.

## Shipped extension: Hockey

Hockey runs only on the MTM2 Breakneck Ridge track (`ROCKQRY.SIT`) in Snow. Both track and weather are
locked while it is selected. Goals to win range from 1 to 99, with 3 as the default.

The rink is derived from the level. Its frozen lake contains `HPUCK.BIN`, a type 0 puck with mass 93.24
slugs and a 24 x 8 x 24 ft box, plus two non-colliding type 7 `HPOST3.BIN` goal frames. Each frame has two
invisible type 0 posts, 4 x 4 x 20 ft, at its mouth. The goals are the two frames; the posts are modelless
boxes within 45 ft. The long axis joins the goals. A mouth spans the inner faces of its posts, and the top
is the frame top. The water level is the ice. The shore is where the unfrozen ground rises to that level.

The extension adds boards 8 ft high and 2 ft thick, 8 ft inside the shore. Corners are cut at 45 degrees,
from 20 to 120 ft as needed to keep their midpoint on the ice. Boards collide with trucks and the puck.
A truck more than 4 ft outside for 2 seconds returns to its face-off spot. The Helicopter key (H) carries
the player's truck to the rink center, the puck's start, on the ice and facing the other goal; with the puck
still within 30 ft of the center, the truck is set down 30 ft short of it on its own side.

The level places the puck at 22 ft, below the 28.5 ft ice. Hockey starts it at rink center with its bottom
0.3 ft above the ice and publishes that pose before the first frame. The puck retains the original ice
surface. Trucks use gravel grip on the frozen water because the original ice grip and at-rest clamp leave
a stopped truck unable to drive away. Sounds and wheel effects still identify the surface as ice.

Options sets a time limit (0 to 99 minutes, 0 none, 10 by default) and sudden death (on by default), for Hockey
and Soccer alike. When the time runs out the side ahead wins; level, play goes on and the next goal wins
(the HUD reads "Sudden death"); with sudden death off a level game ends a draw. The clock counts from the
countdown's end, face-offs and celebrations included; time up during a celebration is judged after it.

The player's team is red or blue at random, unless picked in the Computer Opponents dialog. Computer trucks alternate starting with the other team, so
team sizes differ by at most one. Red defends the low-x goal. Driver labels use team colors. Goal frames
are tinted red and blue after their texture is made grey enough to accept the tint. Replays redraw the
boards and goal tints.

At a face-off, each team stands on its own half facing the other goal. Its first four slots in rink-local
feet are `(40, 28)`, `(40, -28)`, `(95, 55)` and `(95, -55)`. The normal 3 second countdown holds the first
face-off. Later face-offs hold trucks for 3 seconds.

A goal requires the whole puck to cross the line going out of the rink, between the posts and below the
frame top. The attacking team scores. Its last touching truck receives individual credit; an own goal
scores for the team only. Play continues for 2.5 seconds, then trucks and puck reset. A puck 20 ft beyond
the boards, 6 ft below the ice or 200 ft above it resets without a goal. The target goal ends the game
after the celebration. Places sort by team score, individual goals and entry order.

Rink-only unsticking gives a truck 0.6 ft/s in its gear direction after it has held throttle above half
while moving under 0.05 ft/s for 0.5 seconds. This handles the simulation clamp when a truck is pressed
against boards or another truck.

Computer teams assign the nearest truck as attacker and keep that role until a teammate is 25 ft nearer.
With at least three trucks, the last computer truck defends 60 ft in front of its goal while the puck is
in the other half. Other trucks are wings, alternating sides, 70 ft behind and 55 ft across from the puck.
The attacker lines up behind the puck and carries it toward a point 10 ft beyond the mouth at 40 ft/s.
It never reverses toward the target and keeps at least 0.12 of speed in a sharp turn. Extension-driven
trucks recover upright like the player and are not lifted merely for moving slowly.

## Shipped extension: Tag

Tag runs on any track and any weather that track permits. Round length is 1 to 99 minutes, with 5 as the
default. Time begins after the normal countdown. Options sets the proximity points: on or off, the zone's size
(50 to 2000 ft, 400 by default), the points a second beside It and at the zone's edge (0 to 20, 1 and 5 by
default) and the points It loses a second (0 to 20, 1 by default).

One truck is selected as It. It remains in Park for 5 seconds after the countdown while the field gets
away, although another truck can still shove it. A hull contact passes It to the touched truck. There is
no hold after a tag. The new It cannot tag the previous It back for 10 seconds.

Every truck starts with 100 points. After the opening hold, each whole second gives a free truck inside the
zone round It (on the ground, `d` under the zone's size `Z`) `round(near + (far - near) x d / Z)` points, by
default 1 alongside to 5 at the edge, so keeping a distance pays; nothing farther off, or with the points off.
It loses its drain. A tag transfers at least 8 and at most 28 points from the victim to the
tagger, capped by the victim's points and scaled by the victim's shared place. Places sort by points and
then entry order. The HUD lists scores like a Rumble, the player's rate now ("+3 a second" or "too far from
It") and each truck's time as It.

An orange arrow hangs above It and faces the camera (see "Shared presentation"). It is marked on the overlay
map. A free truck's finder points at It; It's finder at the nearest truck it may tag. Normal truck names still
follow the Names key.

Computer It pursues a legal target, favoring distance with a 55 ft divided by place bias, and leads the
target by travel time over 80 ft/s up to 1.5 seconds. It can route around a tall solid object, approach a
target 14 ft higher by a slope step, and use a ramp facing the target when still at least 140 ft away.
With no legal target it wanders.

Free computer trucks do not drive laps. They shadow It where the zone pays best: a point 60 to 92 percent of
the zone out from It when the edge pays more (240 to 368 ft by default), 40 to 87 percent when beside It pays more,
150 to 300 ft with the points off, on the truck's own side, turned up to 0.8 radians round it, which follows It as it moves, at up to 80 ft/s slowing as they reach
it. When It comes within 45 ft, about 55 percent hide (high ground, a ridge, cover or a ramp away) and the
rest flee, until It is 130 ft behind. Aims last 4 to 8 seconds. Their roaming rectangle is the course extent
plus 700 ft, or a 1400 ft area around the grid when no course covers ground.

### Tag, Monster Truck Madness 64's rules

Options' Rules select picks OpenMTM2's rules (above, the default) or Monster Truck Madness 64's, as read from the
N64 game's code (`mtm64conversion/docs/MINIGAME_RULES.md`; no N64 code or data is used). With MTM64's rules the
round length and the proximity settings are ignored:

- The round is 300 s after the countdown (MTM64's 306 s clock includes its countdown). It is not held at the start.
- Every truck starts with 0 points. Each free truck gains points all the time, by its ground distance `d` from It:
  1 a second at 100 ft or more, `10 x (1 - d^2 / 10000)` a second closer (10 beside It). The formula is the game's,
  so the rate dips under 1 between about 95 and 100 ft. It gains nothing. The HUD shows whole points.
- Hull touches do not tag. When any truck is within 25 ft of It, the nearest such truck becomes It and the truck
  that was It gains 50 points.
- After a pass, It cannot be passed on for 3 s (no tag-back rule; this cooldown replaces it).
- A free truck more than the level's edge less 32 ft out (its x or z under 32 ft or over 8160 ft; the terrain is
  256 cells of 32 ft) becomes It, with no bonus to anyone; the 3 s cooldown starts.
- Places by points, then entry order. It keeps the orange arrow (MTM64 hangs a chicken on it).
- Computer free trucks shadow It 35 to 70 ft away, where the rate pays most outside the catch radius, and break
  away when It comes within 32 ft. Computer It chases as with OpenMTM2's rules.

Routes (Tag and Cops & Robbers, `routePoint` in tag.js): a computer truck drives round a cover or a movable object
(any box with mass, its reach grown by 5 ft for the truck) on its line. It looks 140 ft ahead, every 14 ft: ground
rising faster than 0.6 ft a foot (about 31 degrees) is too steep, and ground under the water level (plus 1.5 ft) is
wet. Either way it takes the nearest heading that is clear, turned 0.35, 0.7, 1.05 or 1.4 radians either side,
and drives for a point 112 ft along it. It goes into the water when its target is in it, or when the only way
round a slope too steep is wet; a slope too steep everywhere is driven at all the same. A truck pinned against
something backs out (after 1.5 s at full throttle under 3 ft/s, for 1.4 s, the wheel turned), then drives for
2.4 s for a point 60 ft off, turned 1.1 radians to one side of its target: the target's side first, the other
side when pinned again within 8 s. It calls the helicopter only after failing to move 12 ft in 15 seconds,
except while It is deliberately held.

## Shipped extension: Soccer

Soccer runs only on Monster Truck Madness's Highlands Rally (`CASTLE.SIT` in MTM1's `GAME.POD`), in any weather.
Goals to win range from 1 to 99, with 3 as the default. It plays Hockey's rules (goals, face-offs, teams, places,
computer trucks, unsticking, the Helicopter key) on a pitch read from the level:

- The ball is the level's `SOCCER.BIN`, a pushable type 4 box of 3.108 slugs at about (4420, 263, 4992) ft. The
  goals are its four `GOALTEST.BIN` posts, each paired with the post nearest it: one goal at z 4868, one at z
  5114, about 40 ft between post centres. Goal 0 (red) is the one at the lower z. A mouth spans the posts' inner
  faces; the top is the posts' top.
- The pitch runs from goal line to goal line and 80 ft either side of the line joining the goals (the level
  marks no touchlines). The ground keeps its own grip.
- The trucks may leave the pitch; the ball may not. Walls 60 ft high that only the ball meets stand on the
  touchlines and on the goal lines either side of each goal, and a net 14 ft deep closes each goal. They are
  drawn as faint glass. A ball over the goal line outside a goal (over the bar) or over a touchline is out at once,
  and so is a ball hanging still more than 3 ft up for 2 s (caught on a wall); play then faces off again.
- The posts are tinted in the teams' colours. The ball is a white dot on the map, and every truck's finder points
  at it.
- The Helicopter key (H) sets the truck down at the centre spot facing the other goal, 30 ft short of the ball
  when it is still there.
- The computer trucks play the grass, not the ice (`SOCCER_TUNE`, `SOCCER_DRIVE` in soccer.js): they stand 10 ft
  behind the ball rather than 14, drive straight through it from within 35 ft when it lies toward the goal they
  attack, and a wing or defender within 45 ft of it plays it too. They slow to no less than 0.35 of their speed in
  a turn (Hockey's 0.12 suits sliding trucks), may back up to a target close behind, and a truck that keeps
  circling the ball inside its turning circle (within 40 ft, more than 1 radian off its nose, under 15 ft/s, for
  1.5 s) backs up, turning the other way, and comes at it again.

## Shipped extension: Cops & Robbers

After the community's rules (mtm2.com/~mtmg/cnr.php), judged by the game instead of the host. Any track, any
weather, 1 to 99 minutes with 20 as the default, at least two trucks.

- One truck, picked at random, is the robber; the others are cops. The cops are held 5 s after the countdown.
- A capture is a cop's hull touching the robber while the robber cannot drive: off its wheels (its up axis less
  than half upward) or stuck (under 3 ft/s for 3 s). A robber that turned over by itself is still captured by
  the first cop to reach it.
- After a capture the robber is set down at least 400 ft from every cop, on dry ground in the roaming
  rectangle, held 1 s, and cannot be captured for 5 s.
- The robber may call the helicopter only from deep water (3 ft or more under the water level); a cop may call
  it as usual.
- A capture is 60 points to its cop; the robber gains 1 point each whole second it is free. Places by points,
  then entry order. The HUD shows the time left, the points, the robber, and the captures or the time safe.
- The robber carries a red arrow and is marked on the map; labels name each truck Cop (blue) or Robber (red).
  The cops' finder points at the robber, the robber's at the nearest cop.
- Computer robbers hide while the nearest cop is beyond 220 ft and run or hide when it is closer (Tag's
  `shy` driving); computer cops chase as Tag's It does.

## Shipped extension: Race & Rumble

Circuit tracks only, the laps as the length (3 by default), at least two trucks. The race is the track's own
(`keepsRace`): checkpoints, laps, the countdown, the final lap and the ending. Options picks one of three modes:

- **Classic**, after the community's rules (mtm2.com/~mtmg/rnr.php): teams of two, a Racer and a Blocker in each,
  one team for every two trucks (at least two, four at most: red, blue, green, yellow). The first racer home wins
  it for its team. Teams and roles come from the Computer Opponents dialog; a truck left on Auto joins the
  smallest team in the role it lacks, a racer first (the player's role is Racer, or Blocker with "Play as blocker or cop").
  Places: the teams in order (the winner, then by each team's racer: one home by its time, the others by race
  place), its racer ahead of its blocker.
- **Timed block**: two sides, the Racers and the Blockers (a truck's side is its role, picked in the dialog). The
  Racers win as soon as any racer finishes within the time limit (1 to 99 minutes, 5 by default); when it runs out
  first, the Blockers win. The HUD warns of the last minute. Places: the winning side first; racers by their finish
  (those still racing by their place among the racers), blockers in entry order.
- **Chase**, Monster Truck Madness 64's (`mtm64conversion/docs/MINIGAME_RULES.md`, read from the N64 game's code;
  no N64 code or data is used): the timed block with one racer, the Suspect, and every other truck a Cop. Roles come
  from the Computer Opponents dialog (Suspect or Cop). There is exactly one suspect: the first truck picked Suspect;
  later Suspect picks become cops. With none picked the player is the suspect, or with "Play as blocker or cop" the
  first computer truck left on Auto (the first computer truck when none is). The suspect races the laps against the
  time limit (5 minutes by default, as in MTM64). A cop scores a bust whenever it is within 30 ft of the suspect
  (ground distance, the nearest cop when several are), once the countdown is over and while the suspect has not
  finished; after a bust none can be scored for 3 s. A bust does nothing else to the suspect. The suspect home in
  time wins for the Suspect side, else the Cops win (MTM64 names no overall winner; this is the timed block's rule).
  Places: the winning side first; the cops by busts, most first, then entry order. The Points column shows each
  cop's busts (the suspect's 0). The suspect carries the red arrow and is marked on the map; labels say Suspect
  (red) or Cop (blue). The HUD warns at 10 s left (MTM64 blinks its clock). A bust sounds the cop's horn. Blocks
  are not cheered in a chase.

Blockers are not in the race: they take no checkpoints (no checkpoint sounds, no missed checkpoint warning),
close no laps and have no place while the race runs. Only the racers are placed, among themselves (eight trucks in
four teams: places 1 to 4 of 4), on the timing board and on the map; a blocker's map dot has no number. The places
of every truck come once the race is decided, for the results.

The board: a racer sees its own times (place among the racers); a classic blocker sees its team's racer's lap, best,
clock, gap and place, with a Racer row naming it; a timed blocker sees the time left, the lap the leading racer is
on, and the leading racer's name. The timed block's racers see the time left above their times.

Computer racers drive the course's autopilot and get out of trouble themselves (game/racer-recovery.js). Stuck
(wanting to go, under 4 ft/s for 1.2 s, or within 12 ft for 4 s) a racer first shoves a truck within 28 ft in front
of it for 1.2 s, at its side toward the course, then backs out for 1.5 s turning, then drives round for 2.6 s for a
point 55 ft off, 0.9 radians to one side, and back to the course; the next try takes the other side. 70 ft from
where it stuck it is free. The helicopter comes only after six tries or 30 s stuck, or once it has lain over for
3 s; the course's own stuck timer is off for them. A racer minds the blockers against it: one within 150 ft,
closing at over 10 ft/s, that would pass within 24 ft in the next 2.2 s makes it steer up to 0.22 off the
autopilot's line, away from the side it comes from, at 0.9 throttle or more and no brake. Timed racers never
block: they only race.

Computer blockers drive at 95 ft/s for a point ahead of their target (its velocity times the distance over 90 ft/s,
at most 2 s), and back out and go round what pins them (as Tag's trucks do), the helicopter after 15 s within
12 ft. Their target (`blockerTarget`):

- **Classic**: its own racer blocked first: a truck of another team within 22 ft of it, or within 45 ft while it is
  under 25 ft/s, is attacked to free it. Otherwise the leading racer of the other teams (the best place). When
  that one is more than 700 ft away and another racer is nearer than half its distance, that nearer racer. A
  blocker never fights a blocker except one blocking its racer.
- **Timed block**: the leading racer, or the nearer racer by the same rule; never another blocker.

A block is cheered: when a blocker touches a racer it races against, and within 2.5 s that racer is rolled over
(its up axis under 0.3) or, having been at 30 ft/s or more, is held under 8 ft/s, the blocker's truck sounds a
YeeHaw (a roll-over) or its horn (a block), and the HUD says so. A blocker cheers at most once in 6 s. Online, the
room owner's machine decides it and sends it with the mode's state.

Points: 10 a truck on the winning team, 4 on the others. Labels say Racer or Blocker under each name, in the team's
colour, as are the map dots. A blocker's finder points at the nearest racer of another team.

## Shipped extension: Combat

After Carmageddon's combat racing, with no power-ups. Any track raced through checkpoints: a circuit, with the laps as
the length (3 by default), or a rally, always one run (not free roam, a Summit Rumble or a drag strip). At least two
trucks. The race is the track's own (`keepsRace`). Crash damage is always on; the Crash Damage key (X)
repairs instead. Rules in `game/extensions/combat.js`, the runtime in `combat-session.js`, the computer drivers in
`combat-ai.js`, the ground under a lost wheel in `combat-ground.js`, the debris in `combat-debris.js`, the drawing in
`render/extensions/combat-scene.js`. Options: the laps, the trucks' toughness (Soft 0.7, Normal 1, Tough 1.5 times
every pool), credits on or off, the credits at the start (500), whether the computer trucks repair themselves (on), and the computer trucks' aggression (Low, Normal, High).

**Hit points.** Every truck has a pool for the whole truck (1000 at Normal), the engine (300), the gearbox (300) and
each wheel (250). A hit is measured by how much the truck's velocity changes in a step past 4 ft/s, summed over the
steps of the hit (at most 8). Trucks are built for knocks, and fights between trucks matter most:

- **A hit between trucks** counts 4.5 hit points per ft/s of that change, times a share by how fast the two closed on
  each other: nothing under 15 ft/s (about 10 mph: trucks leaning on each other or tangled), all of it from 40 ft/s
  (about 27 mph), in proportion between. The closing speed is each truck's speed toward the other along the line
  between them, one going away counting against: two trucks the same way at the same speed close at nothing, however
  fast, and a fast truck into a slower one hits only as hard as the difference. A meeting keeps the closing speeds of
  its first contact for 0.25 s only; trucks still touching after that go by their closing speeds of the moment.
- **A fight pushed on fades out.** Two trucks touching, or apart for less than 0.75 s, are in one fight: its hits count
  in full for 0.5 s after the first contact, then less, down to nothing at 1.5 s. Pushing on cannot grind a truck
  down; the attacker must back off and come again. A new contact after at least 0.2 s apart, closing at 40 ft/s or
  more, is a new blow and starts a new fight.
- **A hit with no other truck in it** (a fence, an object, a wall, a roll) counts only past 30 ft/s of change, 0.35
  of the rate from there: crashing through a fence costs nothing, a wall at speed some.
- **A landing** (a change mostly upward) counts only past 45 ft/s (a drop of about 30 ft), at 1.5 times the rate
  from there: an ordinary jump costs nothing, a big one a lot.

- **A flip** (the truck going past its side) costs 0.8 hit points per ft/s of its fastest in the last second past
  30 ft/s, at most 50, off the whole truck only: a roll at full speed costs a few percent.

One hit takes at most a fifth of the whole truck's pool. Every hit comes off the whole truck; from 12 hit points up
some of it is shared out by where it came from:

- **A head-on** (pushed back, or the other truck ahead): the engine 0.6 of it, the nearer front wheel 0.6, the other 0.2.
- **From behind**: the gearbox 0.2, the nearer rear wheel 0.6, the other 0.2.
- **From the side**: the wheel at that corner 0.8, the other wheel on that side 0.4.
- **A landing**: the gearbox 0.15, each wheel 0.1.

The gearbox is under the truck, out of the way, so it takes little. Once a wheel is gone it is bared: every hit of
12 hit points or more also takes 0.35 of its amount from the gearbox.

**Debris and sparks.** Every hit throws debris, the harder the more (up to 120 pieces): mostly small grey bits of
metal in several shades, one in eight a bigger piece, some flecks of muted paint and glass, and a burst of sparks.

**Wheels come off last.** A wheel loses at most 30 percent of its pool in a hit. It comes off only when its pool was
already empty, the truck is at half its hit points or under, and that corner is hit again (a landing never takes
one off). The truck drives on with a bare axle end, its stub: the ground under the lost wheel is lowered by the
tire's radius less 0.6 ft, so the corner sags onto the stub (the simulation is not changed; `groundFor`), the stub has
no grip and drags (5 ft/s per second each), and it throws plenty of sparks. The wheel flies off as a loose object
(a box of the tire's size, 12 slugs, every truck hits it; 12 at most, the oldest goes), and a shock and a piece of
axle bar fly off with a flash (drawn only).

**Engine and gearbox.** The engine's throttle is held to 0.4 plus 0.6 of its share of hit points. A gearbox under
half its hit points can miss an upshift (up to 60 percent of them at none left): out of gear for 0.5 s. Neither ends
the race: with the engine or the gearbox dead the truck crawls, in first gear, the throttle at most 0.2 and held under
12 ft/s (about 8 mph), enough to reach the checkpoints whose credits repair it. The player is told once. A hurt engine smokes, grey under half, black under a fifth, with flames near none;
a wheel under 40 percent wobbles.

**Wrecked.** A truck is wrecked when its hit points run out, or when its last wheel comes off and it has not the
credits to put one back (200, or credits off). With them, it sits on its stubs until it repairs: the player is told
that X puts a wheel back, a computer truck does it at once. A lost engine, gearbox or any wheel short of the last
never wrecks a truck. A wreck stops where it lies (no
helicopter, no turning it back over), smokes, and leaves the race. The player may also leave the fight from the pause
menu ("Leave the fight and watch"). A player who is out watches the race on as in spectator mode (Left and Right: the
truck watched, B: the free camera), to the results.

**Rammer and victim.** When two trucks meet, the faster into the other (by 1.3 times, over 5 ft/s) is the rammer: it
takes a quarter of its damage, and is credited with the other's. Meeting evenly, both take it all and each is credited.

**Credits** (on by default): 50 a checkpoint, 200 a lap, 1 a hit point dealt, 1000 a wreck. X repairs as far as the
credits go, however few. A lost wheel is put back first (200 each, with 30 percent of its pool); the rest is spread
evenly over the damage, every pool (the whole truck, the engine, the gearbox, each wheel on) mended by the same share
of what it lacks, at 2 credits a hit point. Not within 3 s of the last repair. A repair takes that truck's dents out.

**The winner** is the first truck home, or the last truck running when every other is out. Places: those home, then
those running by race place, then the wrecked, the last wrecked first. Points: the hit points dealt by tens, and 50 a
wreck.

**Computer trucks** race the course. Fit (at least 40 percent of their hit points, the engine at least
30), after the first 15 s, they may ram a truck within 220 ft and 0.9 radians of their nose that is on their stretch
of course or the next: the odds are 0.04, 0.12 or 0.35 a second by aggression. The weakest target first (fewest
wheels, fewest hit points), then the leader. A ram aims where the target will be, 5 ft behind its middle, at
110 ft/s, for at most 4 s, broken off when the target falls behind or leaves their line, then 10 s before the next.
They get themselves out of a jam (`selfRecovery`). They repair with a wheel gone (with 200 credits), or under 35
percent of their hit points or 30 of their engine, unless the setting "Computer trucks repair themselves" is off. A truck shoved past its next checkpoint without going through it
(two stretches past, or one and 250 ft from the gate) is lifted back to that checkpoint's stretch (`liftTo`).

Measured on the 12 stock circuits, 8 computer trucks for 400 s on Intermediate, Normal aggression (docs/PLAN.md): the
field covers 85 to 100 percent of a plain race's checkpoints; 12 wheels off and 12 wrecks over the 12 races, 0 to 3
of each a race.

**HUD:** the lap, best and place, then the truck's hit points, engine, gearbox and wheels in percent (a lost wheel
`--`), each coloured green (60 percent and up), yellow (35), orange (15) or red, and after a space the credits and what a
full repair costs. Wheels lost, wrecks (with the wrecker's YeeHaw) and the player's
repairs are told. The names over the trucks carry each truck's hit points in percent, in the same colours; Wrecked or
Out under a truck that is out.

Not in replays: a replay shows the trucks without the loose wheels, the debris and the smoke. Online rooms: see "Over the
network" (each machine judges the trucks it drives; the owner decides the end).
