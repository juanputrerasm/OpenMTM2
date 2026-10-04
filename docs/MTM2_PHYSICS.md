# Monster Truck Madness 2: the simulation

A specification of how MONSTER.EXE 2.00.42 simulates trucks, ground, water and collisions,
written so that OpenMTM2 (and OpenPhotex's simulation module) can reproduce it without copying
game code. It is the physics companion to `MONSTER_EXE_ANALYSIS.md`, whose build notes,
address conventions and truck object table (section 8.3) it relies on.

**Confidence.** Everything below was read from the decompiled code of the routines named in
brackets. Items marked **hypothesis** were inferred, not traced. Every rule here comes from the
code; nothing was fitted to measurements. Replays are useful only as a regression check once the
port runs. Section 13 lists the few details still open.

**JSTrackViewer's Test Drive is not a source of truth.** Section 11 lists where it differs.

---

## 1. Units, frames and conventions

| Quantity | Unit |
|---|---|
| Length | ft |
| Velocity | ft/s |
| Angles | rad |
| Force | lbf |
| Weight | lb (what the data stores) |
| Mass | slug = lb / 32.174 |
| Inertia | slug ft2 |
| Time | 16.16 fixed point in the game loop, float seconds in the simulation |

**World axes:** x and z horizontal, **y up**.

**Body axes:** x right, y up, **z forward**.

**Orientation:** Euler angles `theta` (pitch about x), `phi` (roll about z), `psi` (yaw about y).
The body-to-world matrix is `M = Ry(psi) * Rx(theta) * Rz(phi)`, stored row-major; the forward
column is `(cos theta sin psi, -sin theta, cos theta cos psi)`. `world = M * body`,
`body = M^T * world`.

**Angular rates** keep the aerospace names but on MTM's axes: `p` = roll rate (about body z),
`q` = pitch rate (about body x), `r` = yaw rate (about body y).

**State per truck:** `ipos` (world, ft), `bvel` (body, ft/s), `ivel` (world velocity, derived),
`theta, phi, psi`, `p, q, r`.

---

## 2. The world the truck touches

### 2.1 Terrain height (`0x501820`)

- 256 x 256 cells of **32 ft**, wrapping at 8192 ft. Positions are converted to 1/256 ft integers.
- Each cell is split into **two triangles**. The diagonal **alternates in a checkerboard**:
  - cells where `(row + col)` is even split along (r, c) to (r+1, c+1);
  - odd cells split along the other diagonal.
- Height is **linear inside the triangle** (not bilinear). With `fx`, `fz` the position inside
  the cell (0..1) and `h(r, c)` the corner heights:

      even cell:  fz <  fx:  h = h00 + (h01 - h00) fx + (h11 - h01) fz
                  fz >= fx:  h = h00 + (h11 - h10) fx + (h10 - h00) fz
      odd cell:   fz < 1 - fx:  h = h01 + (h00 - h01)(1 - fx) + (h10 - h00) fz
                  otherwise:    h = h01 + (h10 - h11)(1 - fx) + (h11 - h01) fz

  (`h01` is the corner one column over, `h10` one row down.) **Rows follow z, columns follow
  x:** the height query is called as `(z, x)` (`0x54feb0`), and the level loader (`0x4f78d0`)
  copies the `.RAW` heightfield into the grid byte by byte in file order (`byte << 7`), so the
  height of corner `(row, col)` is `RAW[row * 256 + col] * 2` ft with no flip. The `.CLR` cell
  words are read the same way. Positions are truncated to 1/256 ft before the lookup.
- **Ramps** (sim kind 2) override the terrain where they stand: a ramp is an inclined box whose
  height falls linearly along its length (`0x54feb0`).
- **Snow** (weather 5): terrain below the water level is raised to the water level, so frozen
  water is drivable (`0x5017e0`).

### 2.2 Terrain normal (`0x501bc0`)

The flat normal of the same triangle, `normalize(dh_x, 32, dh_z)`. Straight up on frozen water.

### 2.3 Surface types (`0x503060`, `0x469fe0`)

The surface at a point is the `.TTY` value of the texture under it (OpenPhotex reads `.TTY`):
`type * 100 + depth`.

- Inside a **ground box** (section 2.5), the ground box's top texture is used.
- **At or below the water level** (terrain height `<=` level, integer height units) the surface
  is 1300 (deep water), or 800 (ice) in Snow. There is no "level has water" guard: on a level
  without water the level is 0, so ground at exactly 0 ft reads deep water. Ground boxes skip
  this rule.
- **Texture to type** (`0x5028f0`): each `.TTY` line `NAME,value` is matched (`strcmp`) against
  the `.TEX` names and attached to the first texture of that name; per texture the last matching
  entry wins, a texture without one gets 0 (Default), and a level with an empty `.TTY` gets 200
  (Dirt) everywhere. On the terrain the texture is the cell's `.CLR` word, bits 0-11.
- **Depth is in inches**: a wheel probe sinks by `depth / 12` ft (`0x46c9e0`).

Per type, the base friction coefficient and the fluid density used for drag:

| Type | Traxx name | mu | Drag density |
|---|---|---|---|
| 1 | Cement | 1.0 | 0.002377 |
| 2 | Dirt | 0.9 | 0.002377 |
| 3 | Water | 0.4 | **0.15** |
| 4 | Mud | 0.4 | 0.002377 |
| 5 | Sand | 0.7 | 0.002377 |
| 6 | Grass | 0.7 | 0.002377 |
| 7 | Gravel | 0.6 | 0.002377 |
| 8 | Ice | 0.2 | 0.002377 |
| 9 | Snow | 0.3 | 0.002377 |
| 10 | Metal | 0.8 | 0.002377 |
| 11 | Wood | 0.8 | 0.002377 |
| 12 | Rocks | 0.6 | 0.002377 |
| 13 | Deep water (below water level) | 0.4 | **0.15** |
| other | Default | 1.0 | 0.002377 |

0.002377 slug/ft3 is sea-level air. Water's 0.15 is a game value, not real water (1.94).

The tire-cut factor table (MONSTER_EXE_ANALYSIS.md section 8.6) multiplies mu per tire.

**Weather** multiplies every grip value: Rain 0.8, Snow 0.6, otherwise 1.0 (`0x6cef70`).

### 2.4 Water

- The water level comes from the LVL `!waterHeight`, in **half feet** (`0x5032e0` stores
  `value << 7`; 0 = no water, and the level then stays 0). Height units are 1/256 ft, the same as
  positions: the terrain grid keeps `RAW byte << 7` and the height query returns it times 4, so
  a 2 ft step is 512 units.
- **The water bobs** during a race (`0x505740`, while the race loop runs and the weather is not
  Snow): `level = base + trunc(trunc(sin(phase) / 256) / 4)` units, i.e. +-0.25 ft, with
  `phase += dt / 8` (16.16, wrapped to 16 bits): one cycle every 8 s. `sin` is the game's table
  `trunc(sin(i * 2 pi / 256) * 65536)`, i = 0..256 (`0x526440`), interpolated on the phase's
  low byte (`0x5264c0`). In Snow the level stays at the base.
- Each hull point and wheel records its water depth.
- **There is no buoyancy.** Water only adds drag (section 5.3).
- Entering water above 14.67 ft/s plays the splash.

### 2.5 Ground boxes (`0x553fa0`)

The `.RA0`/`.RA1` layers (bottom and top height x128 per cell, with `.CL0` textures) **are
physical**, built on demand. Around each truck, every cell in the 3 x 3 neighbourhood whose
bottom and top differ becomes a temporary box object: 32 x 32 ft footprint, height top minus
bottom, centred at mid-height, unrotated, mass 0 (immovable). At most 600 boxes. These collide
through the ordinary truck-versus-box code (section 7).

---

## 3. The truck

### 3.1 Parameters

Every truck gets the same physical constants (`0x4bd480`). The TRK supplies only geometry:
the four tire `static_bpos` anchors and the 12 scrape points.

| Parameter | Value |
|---|---|
| Body weight (+0x1040) | 6000 lb |
| Front and rear axle weight (+0x2ac, +0x51c) | 2000 lb each |
| Total | 10,000 lb, 310.8 slug |
| Inertia: roll axis I1 (+0x1044), pitch axis I2 (+0x1048), yaw axis I3 (+0x104c) | 5000, 5000, 7500 slug ft2 |
| Centre of gravity offset (+0x10a0) | (0, -3, 0) ft from the body origin |
| Tire radius (tire +0x6c) | 3.0 ft |
| Tire width (tire +0x74) | 4.0 ft |
| Hub anchors (tire +0x30) | from TRK `static_bpos`; defaults (+-4, -4, +5.67 / -4.0) |
| Wheelbase | **clamped to 11.6 ft, per side** (`0x4bd480`): for the right pair (FR, RR) and the left pair (FL, RL), if `abs(z_front) + abs(z_rear) - 11.6 > 0`, the front z moves back and the rear z forward by half the excess, then a front z below 0 becomes 0 and a rear z above 0 becomes 0 (float32). The TRK z values are kept at +0x1734 for drawing. The axle positions (+0x294 front, +0x504 rear) are the clamped right-side z values. |
| Axle articulation limit (axle +0x234) | +-0.5 rad |
| Suspension travel to bump stop (axle +0x238) | 2.0 ft |
| Torque split (axle +0x26c) | front 0.2, rear 0.8 |
| Drive type (+0x1074) | 4 = four-wheel drive |
| Aero areas (+0x1050, +0x1054, +0x1058) | x 125, y 150, z 75 ft2 |
| Aero coefficients (+0x105c, +0x1060, +0x1064) | y 1.5, z 1.5, x 5 |
| Engine, gears, transfer, shifting | MONSTER_EXE_ANALYSIS.md section 8.4 and 8.5 |

### 3.2 Garage settings

- **Transfer gear:** a table indexed by the Garage value, then scaled by difficulty
  (MONSTER_EXE_ANALYSIS.md 8.5).
- **Suspension** sets the static sag `s`: soft 1.0, medium 0.75, hard 0.5 ft.

      W       = front axle + body + rear axle weight
      k_front = (-z_rear / (z_front - z_rear)) * W * 0.5 / s     lb/ft per wheel
      k_rear  = ( z_front / (z_front - z_rear)) * W * 0.5 / s
      c       = 3.5 * sqrt(k)                                    lb s/ft

  So at rest each wheel sits `s` ft into its travel. With the default geometry, soft front is
  2068 lb/ft and the damping ratio is about 0.22.
- **Tire cut:** 0 shallow, 1 medium, 2 deep.

### 3.3 The 16 contact points

| Points | What |
|---|---|
| 1 to 12 | hull points from the TRK scrape points (fixed in the body); also the 12 damage zones |
| 13 to 16 | the four tire contact points (FR, FL, RR, RL), recomputed every step |

---

## 4. One simulation step

Order of one step for a truck (`0x470810`), with `dt` the substep (MONSTER_EXE_ANALYSIS.md
section 8.1: one step per frame, split only when a frame exceeds 0.1 s). While `heliTimer`
(+0x1078) is positive the helicopter carries the truck instead (`0x46ed90`) and steps 1 to 9 are
skipped.

1. **Controls:** player input or autopilot (MONSTER_EXE_ANALYSIS.md sections 7 and 9).
2. **Tire contact geometry** (`0x47f7d0` x4): each tire's position and velocity in body axes,
   including `omega x r`.
3. **Gearbox** (`0x477520`): instant shifts (section 6).
4. **Gravity:** `F_g = M^T (0, -W, 0)`.
5. **Drag** (section 5.3) and **aerodynamic damping** (section 5.4).
6. **Tires** (`0x47c870`): normal load, longitudinal and lateral forces (section 5).
7. **Hull contacts** (`0x475960`, section 6).
8. **Sum forces and moments** (`0x46cfe0`, `0x46d270`; section 8).
9. **Integrate** (`0x46d730`, `0x46da30`, `0x46e200`; section 9).

After every object has stepped: broadphase and collision response (section 7), then the
**post-step** (`0x471280`, section 10).

---

## 5. Tires

### 5.1 Normal load (`0x47d110`)

    load       = k * compression - c * extensionRate        (>= 0)
    mu_tire    = cutFactor(type, cut) * K * mu(type) * weather
    gripLimit  = mu_tire * (load along the ground normal)

`K` = 1.75; 2.0 for CPU trucks on Professional on a `Sonic` track (`0x647634`). The load is
applied along the ground normal at the tire (`0x47d310`).

### 5.2 Longitudinal force (`0x47dce0`)

The wheel frame is the body frame tilted by the ground under the tire (pitch
`atan2(n.z, n.y)`, roll `atan2(n.x, n.y)` of the body-frame normal), then turned by the steering
angle. `v_fwd` and `v_lat` are the contact velocity in that frame.

**On the ground:**

- **No longitudinal slip.** Wheel spin is exactly `v_fwd / radius`.
- **Engine rpm**:

      target = |transfer * gear * v_fwd * 60 / (radius * 2 pi)|, at least 800
               (in Park and Neutral: throttle * rpmLimit)
      rpm   += (target - rpm) * dt                 capped at the limit

  The update is inside the per-tire routine, so it runs four times a step, once per tire with
  that tire's target (FR, FL, RR, RL).

- **Torque:** `T = throttle * 1700 * (-2.367e-8 rpm^2 + 9.467e-5 rpm + 0.905)`.
  - x0.9 for a human player with autoShift;
  - x1.1 for CPU trucks on Professional on a `Sonic` track.
- **Drive force per wheel:** `transfer * gear * T / radius * axleSplit * 0.5`.
- **Rolling and brake drag:** `(0.02 + 0.8 * brake) * gripLimit`, opposing `v_fwd`.
- **Static hold below 14.67 ft/s:** the drag is replaced by whatever force cancels this
  wheel's share of the slope pull plus `-(v_fwd / dt) * mass * share`, if that fits within the
  drag. This is what stops a truck dead and holds it on slopes.
- **Clamp:** drive plus drag is limited to **+-0.8 * gripLimit**.
- **Friction circle**, Intermediate and Professional only: the lateral grip left is
  `sqrt(gripLimit^2 - F_lon^2)`. **On Rookie the lateral grip is not reduced.**

**In the air:** the target is `gear * spin * transfer * 60 / 2 pi`, at least `throttle * limit`
and at most the limit, then moved towards 0 by `(16000 * brake + 3200) * dt` without crossing it
(no 800 floor); rpm chases it as above (not capped), and the wheel then spins at the rpm-implied
rate `rpm * 2 pi / (gear * transfer * 60)` when the gear ratio is not 0.

**Torque gains** (`+0x176c` marks a human driver): x1.1 when not human, Professional and the
Sonic flag (`0x6407d8`); x0.9 when human with autoShift. Drive force needs drive type 4.

**Gearbox** (`0x477520`), instant shifts:

- autoShift: up when rpm > 7000 in first or second; down when rpm < 3500 in second or third;
  shift requests are ignored.
- manual: a +1 request shifts up to third; a -1 request shifts down from second or third at any
  speed, and from first, Neutral or Reverse only when `bvel.z <= 0`.
- in a drag race while the truck has passed fewer than 3 segments, Park and Neutral are adjacent
  (Park up goes to Neutral, Neutral down to Park).
- the request is then cleared; in Park both brakes are set to 1.

### 5.3 Lateral force (`0x47eb30`)

    alpha = atan2(v_lat, v_fwd), with |v_fwd| floored at 10 ft/s
    F_lat = lateralGrip * C(alpha) + slope share

`C(alpha)`, linear between points (degrees), opposing the slip:

| alpha | 0 | 5 | 10 | 15 | 20 | 25 | 90 |
|---|---|---|---|---|---|---|---|
| C | 0 | 0.5 | 0.8 | 0.9 | 1.0 | 1.0 | 0.95 |

The table continues symmetrically to +-180 degrees (rolling backwards: 1.0 at 155 and 160,
0.9 at 167.6, 0.8 at 170, 0.5 at 175, 0 at 180).
The table is stored in radians at `0x647568` as 25 (alpha, C) float pairs with four-decimal
angles (0.0873, 0.1745, ..., 3.1416), signed so that C opposes the slip; its 90 degree points are
-1.5707 and +1.5708.

Below 14.67 ft/s, `|F_lat| <= gripLimit` and the same static hold applies.

Each tire force is applied **at the hub/axle height**, not at the contact patch (section 8).

### 5.4 Drag and aerodynamic damping (`0x474f90`, `0x4740c0`, `0x475180`)

Per body axis `i`:

    F_i = -0.5 * rhoA_i * Cd_i * v_i * |v_i|

- `rhoA_i` adds up, over the area facing that axis (x 125, y 150, z 75 ft2), the fluid density
  of each part. Submerged wheel area (`0x473f10`) and submerged hull faces (`0x4726a0`) use 0.15;
  the rest uses 0.002377 (section 14.7.1).
- The game also sums water-drag moments about the CG, but only copies them to a debug block for
  the viewed truck; they never reach the dynamics.

Damping moments against rotation:

    q_bar  = 0.0011885 * |v|^2, at least its value at 150 ft/s
    M_roll  = -0.2 * p * A_x * L * q_bar
    M_pitch = -0.2 * q * A_y * L * q_bar
    M_yaw   = -0.4 * r * A_x * L * q_bar

`L` = twice the front hub z.

---

## 6. Hull contacts with the ground (`0x475960`)

1. A point is **in contact** when its clearance is above -0.25 ft. Clearances come from the
   previous post-step.
2. Contacts on hull points 1 to 12 trigger damage (MONSTER_EXE_ANALYSIS.md section 10) and
   scrape sounds.
3. **At most four contacts are used, in index order**, so hull points take precedence over the
   wheels.
4. Solver by count: 1 (inline), 2 (`0x478cd0`), 3 (`0x4798a0`), 4 (`0x47aab0`). All four are
   **force-based quasi-statics, not impulses**.

   **Support.** `N` = the net external force (gravity and drag, world axes) pushed into the
   contact plane's normal, at least 0. It is split by lever rules about `Q`, the **vertical
   projection of the body origin** (`ipos`, not the CG) onto the contact plane:

   - 1 contact: all of `N`, along that contact's normal.
   - 2 contacts: the normal is the average of the two; `N1 = N * d1 / (d1 + d2)` and
     `N2 = N * d2 / (d1 + d2)`, with `d1`, `d2` the distances of `Q` from each contact along the
     line between them: **the reverse of the lever rule**, as the code has it (section 14.12).
   - 3 contacts: the plane through the three points, its normal turned upwards. The line from
     contact 3 through `Q` meets edge 1-2 at `X`. Contact 3 takes `|QX| / |P3 X|`; contacts 1 and
     2 share the rest by where `X` lies, contact 1 taking `|X P2| / |P1 P2|`.
   - 4 contacts: the plane through contacts 1, 2, 3, treating 1-2 and 3-4 as two edges (for the
     wheels these are the front and rear axles). From the foot of `Q` on edge 1-2 a line
     through `Q` meets edge 3-4 at `X`. Edge 1-2 takes `|QX| / (|QX| + |Q foot|)` and edge 3-4
     the rest; each edge splits its share by the lever rule at the foot or at `X`.

   **Recovery** per contact (`0x4695d0`): the force that cancels the contact point's velocity
   along the normal in one step, using the inertia about the lever arm, scaled by
   `0.75 * min(|v| / 3, 1)` and by the contact's share. If the recovery total exceeds the
   support total, the recovery forces are used instead.

   **Friction** per contact (`0x477eb0`): opposing the point's tangential velocity, at most
   `0.5 * mu * weather * N` (`0x647638`) and at most the force that stops it in one step. When
   the point is not sliding it holds against the tangential part of gravity.
5. Each contact force is applied at its point, so it produces a moment.
6. The total contact force magnitude is the crash-damage input (+0x1760).

---

## 7. Collisions with objects

### 7.1 The rule behind all of them

**Anything that does not move becomes ground.** When a truck point or wheel meets the top of an
immovable object, the contact is written into the same tables the terrain probe fills (depth,
normal, `on_gnd`), and the ground model of sections 5, 6 and 10 handles it: suspension, grip,
support, friction, push-out. Only two kinds of contact exchange forces between bodies: a truck
against a **pushable box**, and a **truck against a truck**.

### 7.2 Broadphase (`0x488d90`)

- Every pair of simulated objects is tested by **bounding sphere**. Kinds: 1 box (movable or
  not), 2 ramp, 3 (**hypothesis** static object), 4 truck, 5 top-crush car.
- Pairs are unique, stored in per-object lists (50 slots).
- A truck in helicopter flight is skipped.

### 7.3 Truck against box (`0x489f90` with `0x4a52b0`)

1. **Mass class.** A box **lighter than the truck** (mass in slugs < truck weight / 32.174) is
   pushable, with effective mass `max(box mass, 1)`. A heavier box, or mass 0, is **immovable**.
   Ground boxes (2.5) are immovable boxes.
2. **Early out** (`0x49f520`): a separating-axis test in the box's frame, padded by approach
   speed * dt.
3. **Hull points 1 to 12 inside the box** (`0x4aad00`), in the box's frame:
   - immovable box: the penetration and the face normal become that hull point's **ground
     contact**;
   - pushable box: the box is moved out by the penetration, then a force
     `F = m_eff * (relative velocity of the two points along the face normal) / dt` acts on the
     box, and `-F` on the truck, each with its moment about the body's CG.
4. **Wheels against the box** (`0x4a7fc0`, `0x4a6390`, `0x4a5da0`): the wheel hub's movement
   this step is swept against the box faces (so fast wheels cannot tunnel). When the face met
   points mostly up in the truck's frame (body-frame normal y beyond 0.5), it becomes the
   wheel's ground: penetration, contact normal, `on_gnd`, lever arm, exactly as from the
   terrain probe. That is how trucks **drive on boxes**.
5. **Box corners against the wheels** (`0x49f920`): a corner inside a wheel pushes a pushable
   box out and applies the same force law.

The force law is **perfectly inelastic**: the closing speed along the normal is removed in one
step, with no bounce. Forces go into each body's external accumulators (truck +0xfbc force,
+0xfc8 moment) and are applied on the next integration.

### 7.4 Truck against truck (`0x4894a0`)

Each truck's hull points are tested against the other truck's hull box (two half boxes spanned by
its own hull points), with the lighter truck's mass as the effective mass; the faster truck is
moved out along the axis its relative motion leaves by soonest, and the inelastic force law
removes the closing speed along it. Section 14.20 has the steps; it replaces an earlier summary
here that had a factor of one half and a 0.05 ft margin the code does not show. The wheels are
tested against each other too (14.20).

### 7.5 Ramps (`0x4b2580`, `0x4b17c0`)

- The **top** of a ramp is ground through the height query (2.1), for wheels and hull points.
- The **sides** are walls: a hull point or wheel crossing a side is pushed out along the side
  normal plus a small margin, and gets the inelastic force with the truck's own mass
  (`0x48c8a0`).

### 7.6 Top-crush cars (`0x4a58b0`, `0x4a2d80`, `0x4aa9b0`, `0x4aab50`)

- The car is two boxes, a body and a cab, and is **ground** for the truck: hull points, tire
  points and wheels against its faces make ground contacts as for boxes, and its edges make
  edge contacts (14.26).
- **Crushing:** when a contact sinks more than **0.625 ft** (0.25 + 0.375) into the cab's roof,
  the roof comes down by **15% of the excess** per contact, never below the body's top plus
  0.25 ft. The truck's depths drop by the same amount, and the crushed fraction
  `1 - (cab top - cab bottom) / cab height` drives the cab's keyframed crush animation. The body
  never crushes. Section 14.27 has the details; no stock track has a top-crush car.

### 7.7 Box against box (`0x49f0d0`, `0x4ae1d0`)

A box's corners inside another box become that box's **ground contacts** (depth and face
normal), so loose boxes rest on and stack against each other through the box version of the
contact solver.

Moving objects (type 10) are boxes with a fixed `bvel` (14.18).

---

## 8. Forces and moments (`0x46cfe0`, `0x46d270`)

Total force in body axes:

    F = gravity + drag + sum(tire forces) + contact forces + external collision forces

`|F|` is clamped to 500,000 lbf.

Moments are taken about the CG (+0x10a0):

    M = aero damping + contact moments + external moments + accumulated impulse moments (+0x1098)
        + sum over tires of r_i x F_i

For the tire terms, the lever arm uses the **hub position** for vertical and longitudinal forces
and the **axle height** for lateral forces.

---

## 9. Integration

### 9.1 Rotation (`0x46d730`)

Euler's equations, each result clamped to **+-13 rad/s2**:

    p_dot = ((I2 - I3) / I1) q r + M_roll  / I1
    q_dot = ((I3 - I1) / I2) r p + M_pitch / I2
    r_dot = ((I1 - I2) / I3) p q + M_yaw   / I3

### 9.2 Linear

    a = F / m + transport terms (v x omega)
    bvel += a * dt
    p, q, r += rates * dt

### 9.3 Position (`0x46da30`)

    ivel  = M * bvel
    ipos += ivel * dt

**Rubber-banding:** on Rookie and Intermediate, the truck in **last place** integrates its
position with its velocity scaled by `1 + 0.00005 * d`, where `d` is the distance to the truck
one place ahead (capped at 1000 ft, so at most +5%). Its velocity is not changed.

**At rest:** below 0.1 ft/s, or below 0.5 ft/s with 3 or more contacts, velocity and rates are
zeroed and the stuck logic in section 10.3 is consulted.

### 9.4 Orientation (`0x46e200`)

    theta_dot = q cos(phi) - r sin(phi)
    phi_dot   = p + tan(theta) (q sin(phi) + r cos(phi))
    psi_dot   = (q sin(phi) + r cos(phi)) / cos(theta)

`theta` and `phi` wrap to [-pi, pi]; `psi` wraps to [0, 2 pi).

**Gimbal guard:** when `|theta|` > 1.05 rad, the step is integrated from zero angles in the
current frame and the Euler angles are re-extracted from the combined matrix.

---

## 10. Post-step (`0x471280`)

### 10.1 Hull push-out (`0x476810`)

All 16 points are probed against the ground (section 2). A point deeper than **0.25 ft** moves
the whole truck out along the ground normal by the excess, keeping a 0.25 ft skin. The other
points' recorded depths are updated, and the contact count is stored for the next step.

### 10.2 Wheels and solid axles (`0x476b80`, `0x47bfa0`, `0x47fa20`)

1. Each wheel is probed as a circle against the ground. It records penetration, normal and
   `on_gnd`. The contact point is the hub, offset half the tire width along the axle and
   lowered by `radius * max(|sin pitch|, |sin roll|)` of the ground.
2. The axle with the deeper wheel is solved first. Each axle is a **rigid beam** with vertical
   travel (axle +0x244) and articulation (axle +0x228, the SIT's `faxle.angle`):
   - articulation = `atan((pen_R - pen_L) / (w_R + w_L))`, limited to +-0.5 rad;
   - per wheel, `compression = travel - static hub height + lateral offset * sin(articulation)`;
   - the axle is raised by the remaining penetration, up to the 2 ft bump stop. Anything
     beyond the bump stop **lifts the whole truck** along the ground normal;
   - extension rate = (old - new compression) / dt, which feeds the damper (5.1).
3. **Bottoming damper** (`0x46ba80`): for each wheel at full compression that is moving into
   the ground, 25% of that velocity component is removed (and the bump sound plays).
4. Ground-type changes under the wheels fire surface sounds and splashes (`0x46a2c0`).
5. When both axles are more than 30 ft clear and the truck is nearly level, the "doing air"
   commentary fires.

### 10.3 Stuck and flipped (`0x46da30`, `0x46fd30`, `0x470190`, `0x46ed90`, `0x46f7b0`)

`heliTimer` (+0x1078) is both the stuck count-down (negative) and the helicopter flight time
(positive). The checks run inside the position integrator (`0x46da30`), after the velocity
update and before the position moves. "Racing" means the race clock runs and the game is not
paused; in a drag race the checks wait until the truck has passed 3 course segments.

**Trucks under autopilot** (CPU trucks, or the player on Full Autopilot), while racing: when the
timer is not positive and the speed is under **15 ft/s**, the timer counts down by dt;
otherwise a negative timer counts back up by dt, stopping at 0.

**The player truck**: when the timer is not positive, the hull has contacts (`+0x890` > 0) and
**no wheel touches the ground**, the timer counts down by dt while it is above -5, and once it
passes **-5 s** the truck is **reset** (below). Otherwise it counts back up by dt to 0.

Then, for any truck, a timer below **-5 s** calls the **lift-off** (below).

**At rest** (the velocity zeroed by section 14.9): the player truck tries a reset; a CPU truck
on Rookie or Intermediate tries a lift-off; a CPU truck on Professional is reset instead
(`0x46f7b0`, unless +0x17a8 is set, when it lifts off): placed on the start of its course
segment, 10 ft up, facing along it, all motion zeroed.

**Reset** (`0x46fd30`), only while racing, with hull contacts and no wheel on the ground:
timer 0; velocity, rates, pitch and roll zeroed; the truck lifted **10 ft**; and, except in
Summit Rumble, its heading turned to face the end of its current course segment (a straight's
end point, or the point at the exit angle on an arc's circle):
`psi = atan2(target.x - x, target.z - z)`.

**Lift-off** (`0x470190`), while racing with hull contacts and no wheel on the ground, **or**
whenever the timer is below -5 s:

- timer = **15 s**, plus **5 s** for each other truck in flight on the same course segment;
- pitch and roll rates = 0.1 x their angles; so are the heading and x/z rates, toward the
  target: on a straight its start point and its direction (`atan2(end - start)`), on an arc the
  point at its entry angle and the direction of the straight before it. The heading difference
  is wrapped to +-pi. In Summit Rumble (no course) heading and position stay;
- the hover height = the truck's height above the ground (the lower of two ground queries), or
  2 x the truck's radius when that is negative. The radius (+0xfb8) is
  `hypot(front right hub x + width / 2, front hub z + tire radius)`;
- velocity and rates zeroed.

**Flight** (`0x46ed90`) replaces the whole truck step while the timer is positive, and the
post-step is skipped too. Each step:

- the engine eases toward 800 rpm: `rpm += (800 - rpm) * dt`;
- at exactly 15 s: commentary, and the wheels' contact data cleared;
- above 10 s: the truck stays put while the helicopter flies in: above 11.5 s it heads for the
  truck, then it circles, `(t - 10) * 40` ft out and up;
- below 10 s: pitch, roll, heading, x and z each move by `-rate * dt` (so they arrive in 10 s);
  the hover height rises 5 ft/s while more than 4 s remain, then falls 5 ft/s; and
  `y = ground(x, z) + hover`;
- the timer counts down by dt; at 0 it is released: timer 0, hover 0, the course error
  (+0x8ac) 0 and every contact depth -9999.

**The Helicopter key** (in the keyboard routine, not in a drag race or Summit Rumble): with the
timer at exactly 0 it sets the timer to **-15 s**, so the lift-off follows in the same step;
otherwise (counting down, or in flight) it sets the timer to 0 and clears the heading and x/z
rates, which drops the truck.

---

## 11. Where JSTrackViewer's Test Drive differs

| Topic | Test Drive | MTM2 |
|---|---|---|
| Physics rate | fixed, tuned to a measured "30 Hz" | one step per frame (a fixed step is fine for OpenMTM2) |
| Terrain triangles | MTM cells split along one diagonal | checkerboard split, as for CPR |
| Surface grip | hand-tuned table | mu table (2.3) x cut factor x 1.75 x weather |
| Tire model | slip-based longitudinal force | no longitudinal slip: drive force from torque, capped at 0.8 grip |
| Lateral force | fitted curve | `C(alpha)` table (5.3) |
| Friction circle | always | only above Rookie |
| Suspension | per-wheel | solid axles with articulation, 2 ft travel, push-out beyond |
| Hull contact | collider mesh | 16 points, force-based support split, 0.25 ft skin |
| Ground boxes | static collider meshes | temporary immovable boxes around each truck |
| Object collisions | | immovable objects become ground (box tops carry wheels with full suspension and grip); pushable boxes and trucks: perfectly inelastic, effective mass = lighter body |
| Truck against truck | | half the relative normal velocity removed from each truck; spinning tires climb |
| Crushable cars | | roof crushes 15% of the excess per step beyond 0.625 ft |
| Wheelbase | as in the TRK | clamped to 11.6 ft |
| Water | | drag only, density 0.15, no buoyancy |
| Rubber-banding | none | last place, +5% at 1000 ft, Rookie and Intermediate |

---

---

## 12. Autopilot (`0x480410`, `0x4805d0`, `0x481a70`, `0x481ea0`, `0x483600`)

CPU trucks, and the player with autopilot on, drive the SIT's `*** Course ***` segments.

**The course as stored and as driven.** A SIT's `*** Course ***` block holds only
**straights**. The loader (`0x4e0970`) reads them, and the course builder (`0x4e13b0`) inserts
an **arc** between each straight and the next, wrapping from the last straight to the first.

The SIT block, per course: `c1Count, course_direction`, then per straight:

    ctype, cspeed_type          1, 0 in every stock SIT
    cstart                      x, y, z (ft)
    cend                        x, y, z (ft)
    cdec_point, cspeed, lastentry
    &cSpeedLimit, cTrackWidth   optional line; defaults 0 and 32

Negative `x` or `z` are wrapped by +8192 ft. Up to four extended courses follow an `@` line
(their count, then the same block each). The loader also averages the straights' midpoints into
a course centre.

**In memory** each segment is 14 dwords (0x38 bytes), course `n` at `0x70cc28 + n * 0x6d68`,
**numbered from 1**: straights at the odd slots 1, 3, 5... (copied from the file, `lastentry`
cleared), arcs at the even slots. The last segment gets `lastentry = 1`. This is why the SIT
writer saves only the odd segments.

| Field | Straight | Arc (built) |
|---|---|---|
| 0 `ctype` | 1 | 2 |
| 1 `cspeed_type` | 0 (from the file) | 1 |
| 2-4 | `cstart` | centre x, ground height at the centre (`0x550090`, which includes box and ramp tops), centre z |
| 5-7 | `cend` | entry angle, exit angle, radius |
| 8 `cdec_point` | from the file | `min(radius / 3, 20)` |
| 9 `cspeed` | **replaced by the speed of the arc that follows it** | corner speed (below) |
| 10 `cSpeedLimit`, 11 `cTrackWidth` | from the file | not set |
| 12 | | bank angle (+0x30) |
| 13 `lastentry` | 0 | 0 |

**Building an arc** (`0x487c60`) between straight `i` (start `A`, end `B`) and straight `j`
(start `C`, end `D`), all horizontal (y ignored):

1. If `|C - B| >= 1 ft`: the corner `P` is the intersection of lines `AB` and `CD`
   (`0x468ee0`, in x and z). The arc joins `B` (entry leg `P->B`) and `C` (exit leg `P->C`).
   Otherwise the straights touch: the arc uses `A`, `B` and `D` with a default 30 ft fillet.
2. `u0 = unit(B - P)`, `u1 = unit(C - P)`, legs `d0 = |B - P|`, `d1 = |C - P|`; the half angle
   at the corner `alpha = acos(u0 . u1) / 2`; the bisector `b = unit(u0 + u1)`.
3. **Fillet:** `radius = tan(alpha) * max(d0, d1)`; centre `= P + b * radius / sin(alpha)`. The
   arc is tangent to both lines at distance `max(d0, d1)` from the corner.
   **Touching straights:** with `R = 30 / cos(alpha)`, if `R^2 >= 1800` the radius is
   `sqrt(R^2 - 900)` with the centre `R` from the corner, otherwise the radius is 30 and the
   centre is `30 / sin(alpha)` along the bisector.
4. **Angles** are headings from the centre (`atan2(dx, dz)`), with `half = pi/2 - alpha`:
   - normally `thetaC = heading(-b)` (centre to corner) and `ref = heading(-u0)`;
   - with the **far-side flag**, `thetaC = heading(b)` and `ref = heading(u0)`;
   - `sense = wrap(heading(u1) - ref)`; if `sense > 0`, entry (field 5) `= thetaC - half` and
     exit (field 6) `= thetaC + half`, otherwise the other way round (both wrapped).

   The builder (`0x4e13b0`) sets the far-side flag only when `|turn| > pi/2` (turn = wrapped
   heading of CD minus heading of AB): with `side = wrap(heading(C - B) - heading(AB))`, the
   flag is `turn >= 0` when `side <= 0`, else `turn <= 0`. The gap test `|C - B| >= 1` is in
   3D. `wrap(a) = a - trunc(a / 2 pi) * 2 pi`, then +-2 pi into [-pi, pi].

   **Line intersection** (`0x468ee0`): slope form in x and z, y = 0. Parallel lines give
   non-finite values. When a line has no extent in x, the code steps along the other line by
   `|t|`, `t = (D.x - A.x) / dir.x`, which lands on the crossing only for one sign of `t`
   (it does in the ordinary layout). Every stock course builds with finite arcs, one end of each
   arc on its neighbouring straight's end, and most primary-course corners about 128 ft in
   radius (OpenPhotex `stock.test.ts`).
5. **Bank:** `beta = atan((h(radius + 5) - h(radius - 5)) * 0.1)`, the terrain height
   (`0x550090`) 5 ft outside and inside the arc, along `thetaC`.
6. **Corner speed:** `v = sqrt(k * radius * 32.174 * max(0.1, sin(beta) + K * cos(beta)))`,
   with `k = 0.725` (0.75 on `Sonic` tracks) and `K = 1.75` (`0x647634`).

`course_direction` (`0x647564`) reverses the course; GOLD mode toggles it.

**Following a segment** (`0x481a70`): on a straight the aim point is its end. On an arc, the
truck's angle around the centre and the exit angle (field 6) give a target on the arc, and
the autopilot follows the arc's tangent at the nearest arc point, as a line 100 ft either side
of it (section 14.22, which replaces an earlier guess here).

**Steering** (`0x481ea0`):

    bearing  = angle from the truck to the segment's aim point, minus the segment heading
    e        = sin(bearing) * distance                         (+0x8e8, the cross-track error)
    correct  = distance > 50 ft ? asin(clamp(0.02 * e, -1, 1)) : bearing
               clamped to +-0.125 rad on straights, +-0.5 on arcs
    error    = segment heading - truck heading + correct       (wrapped)
    command  = 22 (+0x8b4) * dt * error
               x min(|e| / 32, 1.5) when more than 32 ft off line on a straight
               + course integrator (+0x8ac, ap.course_control): while all four wheels are off
                 the ground above 14.67 ft/s, error (clamped +-0.5) is integrated
               x distance / 30 within 30 ft of the aim point
               x min(sqrt(20 / |v_z|), 1) on straights
               clamped to +-0.45
    steering += (command - steering) * 6.66 (+0x8cc) * dt      (clamped +-0.45)
    rear     = -0.33 * front (drag mode x1.25)

The command scales with `dt`, so the original's AI steering depends on the frame rate. A fixed
step in OpenMTM2 should pick the dt the game was tuned at (**hypothesis**: about 1/30 s).

**Target speed** (+0x89c), keyed on `cspeed_type` (so on whether the segment is an arc):

- `mu_avg` = the average of the four tires' grip factors; it scales every target by
  `sqrt(mu_avg / K)` (K = 1.75, section 5.1).
- **Arcs** (`cspeed_type` 1): `cspeed * sqrt(difficulty gain) * sqrt(mu_avg / K) * sqrt(ratio)`.
  `ratio = (sin(beta_here) + K cos(beta_here)) / (sin(beta_arc) + K cos(beta_arc))`, where
  `beta_here` is the bank measured as in step 5 above but along the truck's own heading from
  the centre. When the truck runs wide (`d - radius > 0`, `d` its distance from the centre),
  `ratio` is multiplied by `min(sqrt((k * (d - radius) + radius) / radius), 1.2)`. `ratio` is at
  least 0.1.
- **Straights** (`cspeed_type` 0): `v^2 = cspeed^2 * gain + 2 * (slope acceleration) *
  distance to the end`, then `* sqrt(mu_avg / K)`. A straight's `cspeed` is the next arc's
  corner speed, so this is braking toward the corner.
- Never below 17 ft/s.

The speed controller (`0x4805d0`) turns the target into throttle and brake with gain 1.2
(MONSTER_EXE_ANALYSIS.md section 9).

**Traffic** (`0x483600`): the truck picks a truck just ahead to pass (+0x8e0) and a side
(+0x8d8 = +-1), aims beside it, and caps its target speed behind the nearest truck ahead
(+0x8e4). Section 14.25 has the rules; it replaces an earlier summary here.

---

## 13. Still open

Everything above was traced in code. What remains is detail, not mechanism:

1. The arc aim-point smoothing in `0x481a70`/`0x483070`.
2. The `.TTY` depth's effect beyond probe sinking (none found so far).
3. The `+0x2a8`/`+0x518` (15000) axle field and the `+0x5a0` weight term (0 in stock trucks).

Each is a few dozen lines in one routine and can be read out during the port.

- **Cornering roll** (an observation from the port, to compare with the running game): lateral
  tire forces act at the axle's travel height (§14.8), which at the static sag sits at about the
  CG height (-3 ft), so cornering makes almost no roll and the truck leans slightly into turns.
- **Pinned against a ramp** (an observation from the port, to compare with the running game): with
  the ramp edges' face normals zero (14.26.1), a truck whose hull box crosses a ramp's side edge
  gets straight-up contacts there and can roll onto its side against the ramp. The walls only
  move the truck (14.19) and the contact solver holds it, so its velocity stays (about 20 ft/s in
  one 8-truck Torture Pit race on Intermediate) and a CPU truck's stuck timer, which needs
  `|ivel| < 15` (10.3), never runs: it stays there. OpenMTM2's headless race test lists Torture
  Pit as a known case.
- **At rest** the 0.1 ft/s cut-off (§14.9) freezes a settling truck partway through its bounce,
  a few tenths of a foot from the static sag, depending on the step length.

---

## 14. Step details for the port

The routines of sections 4 to 10, as traced for OpenPhotex's `mtm2Sim` (milestone M4). Truck
fields are offsets from the truck; a tire block is 0x114 bytes (FR +0x4c, FL +0x160, RR +0x2bc,
RL +0x3d0) and an axle block starts at its right tire (front +0x4c, rear +0x2bc). `n` is a
world ground normal, `M` the body-to-world matrix, `dt` the step. `0x6f5a18` is a shared zero
vector, so every "external x, z" term below is 0.

### 14.1 Order of one truck step (`0x470810`)

1. Autopilot (`0x480410`).
2. Tire geometry for FR, FL, RR, RL (`0x47f7d0`).
3. Gearbox (`0x477520`).
4. `W` = body + both axle weights + the `+0x5a0` term; `m = W / g`; gravity in body axes
   `-W * (m3, m4, m5)` (the world up axis in body coordinates).
5. Drag (`0x474f90`), tires (`0x47c870`), aero damping (`0x475180`), hull contacts (`0x475960`).
6. Force sum (`0x46cfe0`), impulse moment (`0x469a40`: `+0x1098 = +0x1094 / dt`, then
   `+0x1094 = 0`), moment sum (`0x46d270`).
7. Accelerations (`0x46d730`), then **rates and body velocity are integrated first**
   (`p, q, r += rate_dot * dt`, `bvel += a * dt`), then position (`0x46da30`) and orientation
   (`0x46e200`) with the new values.
8. Tire geometry again, then contact probing (`0x471d70`).

After every object has stepped and collided, the post-step (`0x471280`) runs per truck.

Tire grip K (`0x647634`) is set at the start of the step: 2.0 for a non-human truck
(`+0x176c == 0`) on Professional on a Sonic track, else 1.75.

### 14.2 Tire geometry (`0x47f7d0`)

Each axle keeps its articulation `a` as `cos a` (+0x22c), `sin a` (+0x230) and its travel
(+0x244, the hub height in body y). For a tire with anchor `(ax, ay, az)`:

    hub (body)   = (ax cos a, ax sin a + travel, az)
    hub (world offset from ipos) = M * hub
    contact (body) = hub + r * (sin a, -cos a, 0)
    v_contact = bvel + omega x contact, omega = (q, r, p) on (x, y, z)

**On the ground the roll and pitch rate terms are left out** (only yaw `r` and, in the air,
`p + axle rate +0x23c` and `q` contribute).

### 14.3 Normal load and grip (`0x47d110`)

    load = k (axle +0x250) * compression (tire +0x78)
    on the ground: n_load = n . (M * (0, load, 0))      (the load along the ground normal)
                   mu_tire = K * mu(surface) * weather * cutFactor
                   grip    = mu_tire * n_load           (tire +0x90)
    in the air:    grip = 0
    load -= c (axle +0x254) * extensionRate (tire +0x7c), at least 0

The surface is looked up at the **hub's** world x, z, probing 100 ft above the terrain there
(`0x47cb50` for the cut factor, `0x469fe0` for mu and drag density); the value's depth is
dropped (`0x4de180` returns `(type * 100) << 16 | depth << 8 | particle flags`).

### 14.4 Longitudinal force (`0x47dce0`, on the ground)

    nb = M^T n;  pitchG = atan2(nb.z, nb.y);  rollG = atan2(nb.x, nb.y)  (tire +0xa8, +0xa4)
    vz' = cos(pitchG) v.z - sin(pitchG) v.y
    vx' = cos(rollG)  v.x - sin(rollG)  v.y
    v_fwd = vz' cos(delta) + vx' sin(delta);  v_lat = vx' cos(delta) - vz' sin(delta)
    D = (0.8 * brake + 0.02) * grip, negative when v_fwd > 0
    F_drive: section 5.2

Static hold, when the truck's body speed `|bvel| < 14.67`:

    slope = tF . (0, W, 0) * grip / sum(grip)      tF = M * (nb.x, -nb.z, nb.y), the ground
                                                    tangent ahead (unsteered)
    hold  = -(v_fwd / dt) * m * grip / sum(grip)
    f = slope + hold
    hold == 0: D = f when |f| <= |D| and D != 0
    hold >  0: D = min(D, f)
    hold <  0: D = max(D, f)

Then the clamp: if `F_drive + D > 0.8 grip`, `F_drive -= (F_drive + D - 0.8 grip)`; if
`F_drive + D < -0.8 grip`, likewise. `F = F_drive + D`, applied in the ground frame as
`(sin(delta) F, 0, cos(delta) F)`. Wheel spin `= v_fwd / r`; wheel angle integrates and wraps.
Above Rookie the grip left for the lateral force is `sqrt(grip^2 - F^2)`.

### 14.5 Lateral force (`0x47eb30`)

Only for a tire on the ground: an airborne tire returns at once with no force (`0x47f2ff`).

    alpha = atan2(v_lat, v_fwd) when |v_fwd| > 10, else atan2(v_lat, +-10) with the sign of
            v_fwd (0 or pi when v_lat = 0)
    C = table lookup (section 5.3)
    F = grip * C + tL . (0, W, 0) * grip / sum(grip)   tL = M * (nb.y, -nb.x, nb.z), the ground
                                                        tangent to the right
    below 14.67 ft/s: |F| <= grip (scaled), then the hold rule of 14.4 with
                      hold = -(v_lat / dt) * m * grip / sum(grip)
    applied in the ground frame as (cos(delta) F, 0, -sin(delta) F), added to 14.4's

`sum(grip)` is re-summed after the longitudinal pass (so it uses the reduced grips).

### 14.6 Tire force to body (`0x47d310`)

    Fb = (cos(rollG) Fx,  sin(rollG) Fx + sin(pitchG) Fz,  cos(pitchG) Fz)
    Fb += M^T (n * (n . (M * (0, load * n.y, 0))))

### 14.7 Drag and aero damping (`0x474f90`, `0x4740c0`, `0x475180`)

Per body axis `F_i = -rhoA_i * 0.5 * Cd_i * v_i |v_i|`, `rhoA_i = A_i * 0.002377` in air (the
submerged parts of section 5.4 add water density and moments). Coefficients: x 5, y 1.5,
z 1.5. Damping uses `q_bar = 0.0011885 |v|^2`, at least 26.74125:

    M_x (pitch, about x) = -0.2 * q * A_y * L * q_bar
    M_z (roll, about z)  = -0.2 * p * A_x * L * q_bar
    M_y (yaw)            = -0.4 * r * A_x * L * q_bar          L = 2 * front hub z

#### 14.7.1 Fluid areas (`0x4740c0`)

`rhoA` per body axis starts at 0, and the dry areas at the aero areas (x 125, y 150, z 75 ft2).
The density at a point (`0x469fe0`) is that of the surface type there: 0.15 for types 3 and 13
(water), 0.002377 otherwise. Everything below runs for every truck, every step.

**Wheels** (only when at least one wheel has a positive water depth). Each wheel's water depth
is the one its last wheel probe found (section 14.11.3, the probe point at the bottom of the
tire), moved with the truck when the solid axle lifts it. A wheel of radius `r` and width `w`
in water `d` deep has (`0x473f10`), with `d' = min(d, 2r)`:

    side (x)  = circular segment of height d': r^2 * a - (r - d') * r * sin(a), a = acos(|r - d'| / r);
                past half (d' > r) it is pi r^2 minus the segment of height 2r - d'
    under (y) = chord * w: 2 r sin(a) * w, or 2 r * w past half
    front (z) = d' * w

A dry wheel (depth <= 0) has no areas. The density is taken at the wheel's probe point.

- x: per axle, the deeper wheel only (the second of the pair on a tie); its side area leaves the
  dry x area and `density * area` joins `rhoA_x`.
- y: every wet wheel.
- z: per side, the deeper of the front and rear wheels (the rear on a tie).

**Hull faces** (`0x4726a0`), always. A face is four hull points (numbered 1 to 12, section 3)
and the body axis it faces. Its four corners are wet when their water depth is positive. The
area facing that axis is:

| Wet corners | Area |
|---|---|
| none | 0 |
| one | `0.5 * l_u * l_v`, the corner's two legs |
| two (any two) | `0.5 * L * (l1 + l2)`: L the distance between them along the axis they differ in, l the two corners' legs across it |
| three | full face minus the dry corner's triangle |
| four | full face |

The full face is the product of the extents, along the two axes in the face, from corner 1 to
corner 4. A corner's leg along a body axis is `waterDepth * n_axis` with `n` the ground normal
stored with that point (world axes, as stored), taken with the sign that points from the corner
toward the body centre on that axis (minus for a corner on the positive side). The face's
density is taken at its first wet corner; a dry face has density 0.

The faces, in order:

| Facing | Corners | When |
|---|---|---|
| z | 11, 12, 7, 8 | `bvel.z <= 0` (going back) |
| z | 1, 2, 7, 8 | `bvel.z > 0` |
| y | 1, 2, 11, 12 | `bvel.y <= 0` |
| y | 3, 4, 5, 6 then 5, 6, 7, 8 then 7, 8, 9, 10 | `bvel.y > 0` |

Areas are summed per axis; they leave the dry areas, and `rhoA_y += d_y * area_y`,
`rhoA_z += d_z * area_z`, with `d_z` the density of the z face and `d_y` that of the **last** y
face computed. No face faces x.

**Air**: the remaining dry area of each axis, floored at 0, times 0.002377, joins `rhoA`.

**Splash** (`0x429070`): when the z or y face density is 0.15 and the truck's speed exceeds
14.67 ft/s. (The game also compares the x density, which is always 0 here.)

### 14.8 Sums (`0x46cfe0`, `0x46d270`)

    F = gravity + drag + contact forces + external + tire forces (x, z sums; y sum of tire y)
    |F| <= 500000
    M about the CG c = (0, -3, 0):
      drag acts at the body origin: M += (-c) x D
      per tire: M_x += (hub.y - c.y) Fz - Fy (hub.z - c.z)
                M_y += Fx (hub.z - c.z) - Fz (hub.x - c.x)
                M_z += Fy (hub.x - c.x) - Fx (travel - c.y)     (lateral at axle height)
      M_x += the impulse moment (+0x1098)

### 14.9 Integration (`0x46d730`, `0x46da30`, `0x46e200`)

    q_dot = ((I3 - I1) / I2) r p + M_x / I2
    p_dot = ((I2 - I3) / I1) r q + M_z / I1
    r_dot = ((I1 - I2) / I3) q p + M_y / I3        each clamped to +-13
    a = F / m - omega x bvel

At rest: velocity, rates and `ivel` are zeroed when `|ivel| < 0.1`, or `< 0.5` with 3 or more
contacts (trucks). A zeroed player truck with **no wheel on the ground** after the race has
started is reset (`0x46fd30`); the stuck timer (`+0x1078`) counts down while no wheel touches
and resets at -5 s. Euler rates and the gimbal guard: section 9.4 (`|theta| > 1.05`).

### 14.10 Contact probing (`0x471d70`, `0x47f520`, `0x46c9e0`)

The ground probe of a body point `P`: `W = ipos + M P`; `n` = ground normal there
(`0x550380`). With an offset `o`, the point moves by `o` against the normal projected into the
body's y-z plane. Depth `= ground(W.x, W.z) - W.y - sinkDepth / 12` (inches); over deep water
the water depth is recorded too.

Tire contact points (hull points 13-16): the hub, moved half the tire width along the axle
(outward: + for FR and RR, - for FL and RL) and probed with offset `r * max(|sin pitchG|,
|sin rollG|)`. Each stored depth is `depth * n.y`. Hull points 1-12 are marked -9999.

### 14.11 Post-step (`0x471280`)

1. Each axle is reset: articulation 0, travel = the static anchor y.
2. **Push-out** (`0x476810`), points 1 to 16 in order: a hull point takes its fresh probe when
   deeper than stored; a tire keeps its stored depth `s`. When `s > 0.25` the truck moves by
   `n * (s - 0.25 n.y)`, and every point's stored depth (and water depth) drops by `n_j . move`.
   Every point with `s >= 0` counts as a contact (`+0x890`).
3. **Wheels** (`0x476b80`, `0x47bfa0`): each wheel probes at its **static** anchor moved half
   the width **inward** (- for FR and RR, + for FL and RL) with offset `r`. Its penetration
   along body y is `pen = (d n.y) / (n . bodyY)`; the deepest probe sets the tire's normal and
   `on_gnd`, and its lever `sqrt(r^2 + x_probe^2)`.
4. **Axles** (`0x47fa20`), the one with the deeper wheel first; any lift the first did is
   subtracted from the second's penetrations:
   - articulation: unchanged when neither wheel penetrates; else
     `atan(pen_R / lever_R)` or `atan(-pen_L / lever_L)` when their sum is not positive, else
     `atan((pen_R - pen_L) / (lever_R + lever_L))`; clamped to +-0.5;
     the penetrations follow: `pen_R += lever_R * (sin old - sin new)`, `pen_L -= ...`;
   - compression per wheel `= x_offset * sin(a) - anchor y + travel` (the rest position is
     compressed by the static sag);
   - above the 2 ft bump stop the excess lowers the travel and adds to both penetrations; the
     travel never drops below the static anchor (the difference moves into compression);
   - the remaining penetration first raises the axle (compression and travel) up to the bump
     stop; what is left **lifts the truck** along that wheel's normal by
     `pen * (n . bodyY)`, reducing every stored depth by the same;
   - compressions are floored at 0; `extensionRate = (old - new) / dt`.
5. **Bottoming** (`0x46ba80`): for each wheel at full compression, the part of the world
   velocity into its ground normal (when negative) is reduced by 25%: `bvel -= M^T (n * vn *
   0.25)` summed over those wheels.

### 14.12 Hull contacts (`0x475960` and the solvers)

**The contact list** (built each step): points 1 to 16 whose stored depth is at least -0.25
(hull points 1-12, then the tire contact points 13-16), in index order. Each contact point is
moved onto the ground: `C = ipos + M P + n * storedDepth`, with its stored normal `n`. A tire
contact only spins its wheel here (`0x4757f0`, visual); hull contacts also feed damage
(`0x532140`) and sounds. When the list is empty nothing happens.

`N` (the support) is always computed from `G = M * Fbody`, the gravity and drag force so far
(tire forces are not in it yet): `N = -(G . nP)`, at least 0, with `nP` the solver's plane
normal. `Q` is the vertical projection of the body origin onto that plane:
`Q = ipos - (|nP . (ipos - C1)| / nP.y) * (0, 1, 0)`.

- **1 contact:** `nP = n1`, all of `N` to it.
- **2 contacts:** `nP = unit(n1 + n2)`. With `a = |unit(C2 - C1) . (Q - C1)|` and `b = |C2 -
  C1| - a` (absolute), contact 1 takes `N a / (a + b)` and contact 2 `N b / (a + b)`. **This is
  the reverse of the lever rule** (the farther `Q` is from contact 1, the more contact 1 carries);
  section 6's description was wrong. When `n1 + n2` has zero length, `nP = (0, 1, 0)`. When
  `nP.y` is exactly 0 (two wall contacts, for example), `Q` is not formed and both shares are 0,
  so neither contact gets a support (the recovery below can still push).
- **3 contacts:** `nP = unit((C2 - C1) x (C3 - C1))`, turned upwards. `F` = foot of `Q` on edge
  1-2; the line from `C3` through `Q` meets edge 1-2 at `X`
  (`|QX| = |QF| / |cos(QF, C3Q)|`, `|FX| = sqrt(|QX|^2 - |QF|^2)`, signed along the edge).
  Contact 3 takes `|QX| / (|QX| + |C3 Q|)`; of the rest, contact 1 takes the fraction
  `|X - C2| / |C1 C2|` (at most 1) and contact 2 the remainder.
- **4 or more:** the first four only. `nP` from contacts 1-3 as above; edges 1-2 and 3-4. `F` =
  foot of `Q` on edge 1-2, `G` = foot on edge 3-4; the line from `F` through `Q` meets edge 3-4
  at `X` (as above with `G` in place of `F`). Edge 1-2 takes `|QX| / (|QF| + |QX|)`, contact 2
  `share * s / |C1 C2|` (`s` = position of `F` along the edge from `C1`) and contact 1 the rest;
  edge 3-4 takes the remainder, contact 3 `share * |X - C4| / |C3 C4|`, contact 4 the rest.
- **Horizontal plane** (all solvers from 2 contacts up, `0x478cd0`, `0x4798a0`, `0x47aab0`):
  when `nP.y` is exactly 0, `Q` is not formed and every share is 0. This is the case when a
  truck's nose meets a ground-box wall: contacts 1 to 3 then lie in the wall's vertical plane.
  The unit vector helper (`0x4797a0`) returns `(0, 1, 0)` for a zero-length vector, so a
  degenerate cross product gives a level plane instead.

Every contact's force is applied **along its own normal** `n_i` at `C_i` (to body axes, with
its moment about the origin added to the contact moment), then its friction.

**Recovery** (`0x4695d0`), per contact: with `v_P = bvel + omega x P` (body),
`s = 0.75 * min(|bvel| / 3, 1)`, the axis `u = unit(P x n_body)` and
`I_u = I2 u.x^2 + I3 u.y^2 + I1 u.z^2`:

    R = -(I_u * (n . M (s v_P))) / (dt |P|^2) * (N_i / sum N),  at least 0

If the recoveries sum to more than the supports, they replace them.

**Friction** (`0x477eb0`), per contact, with `v` = the point's world velocity (the rotation
term only when there are fewer than 3 contacts), `vt = v - (v . n) n`:

    limit = N_i * 0.5 * mu(surface at C_i) * weather
    s = |vt + v|   (as the code adds them)
    s == 0: f = (0, W, 0) minus its normal part, scaled by N_i / sum N; at most `limit`
    else:   dir = (vt + v) / s; stop = (W / g) * (s / dt) * N_i / sum N
            f = -min(limit, stop - dir . (0, W, 0) * N_i / sum N) * dir

The contact force total (`+0x1760`) is the crash-damage input.

### 14.13 Truck defaults (`0x4bd480`)

Besides section 3.1: tire radius 3, width 4; each tire's lateral offset for the compression
formula is +5 ft (right) and -5 ft (left); the axle articulation limit 0.5, bump stop 2.0; the
CG offset (0, -3, 0); the default spring 2757.67 (front) and 3909 (rear) before the Garage
setting; autopilot gains 1.2, 0.05, steering 22 and 6.66.

### 14.14 Ground boxes and truck against an immovable box

**Ground boxes** (`0x5543c0`, `0x553fa0`), every frame before the step: for each truck, the
cells (col, row) in the 3 x 3 around its cell (`floor(x / 32)`, `floor(z / 32)`) whose lower
(RA0) and upper (RA1) heights differ each become a box object: centre `(32 col + 16,
lo + trunc((hi - lo) / 2), 32 row + 16)`, unrotated, 32 ft along x and z, `hi - lo` high,
mass 0, with `lo` and `hi` the cell's heights in whole feet (`RA * 2`). A cell near two trucks
makes two boxes. At most 600.

**A box object** (`0x5495e0`) is centred on its position: half extents `a` (x), `c` (y), `b`
(z) from its sizes, bounding radius `sqrt(a^2 + b^2 + c^2)`. A mass of 0 means immovable. For a
truck, a box is **immovable** unless `0 < mass < truck weight / 32.174` (section 7.3).

**Pair test** (`0x489f90`), after every object has stepped and before the post-step. For a
truck and a box in sphere range (truck radius + box radius):

1. **Early out** (`0x49f520`), in the box frame, with `d` the truck centre's offset from the box
   centre and `v` the relative velocity (truck minus box): along each axis, only the part of `v`
   moving toward the box counts, and the pair is skipped when
   `d + R + v dt < min` (truck on the negative side) or `d - R + v dt > max` (positive side),
   `R` the truck's radius.
2. **Hull points 1 to 12** (`0x4a52b0`, `0x4aad00`). The ray starts at the truck's reference
   point **last step**: `(truck - box) - (v_truck - v_box) dt + M (0, 0.5 * y3, 0)`, with `y3`
   hull point 3's height, in the box frame. It runs through each hull point's current position.
   Of the six face planes it crosses inside the face (at most two are counted), the nearest
   with `t > 0` whose outward normal faces the ray (`dir . n < 0`) wins; the bottom face is
   tried first, then top, front (+z), back (-z), left (-x), right (+x), later faces winning
   ties. The point's depth is its current distance inside that face (negative when outside).
   When it beats the point's stored depth, the depth and the face's outward normal (world)
   become that point's contact, just like a terrain probe (section 14.10).
3. **Each wheel** (`0x4a7fc0`), tires 13 to 16 in order, side -1, +1, -1, +1:
   - **Suspension** (`0x4a6390`, `0x4a5da0`): a ray from last step's truck centre, moved half
     the tire width along the axle (the articulated axle, as for the probe), toward the bottom
     of the wheel at its static anchor (`anchor - (0, r, 0)`). The nearest crossed face wins,
     with no direction test, and it counts only when its outward normal points mostly up in
     the truck frame (`|n_y| > 0.5`); otherwise the wheel gets nothing from this box. When it
     counts (`n_y > 0.5` in the truck frame), the contact point is the anchor moved half the
     width out and `r` along the face's inward normal (its y and z in the truck frame,
     normalised); its depth inside the face, divided by the inward normal's truck y and negated,
     is a penetration along the truck's y. When that beats the wheel's penetration: a positive
     one also sets the wheel's ground normal (the face's outward normal, world) and on-ground;
     and the penetration and lever `hypot(r, anchor x + side w / 2)` are stored, as from the
     wheel probe (section 14.11.3).
   - **Tire contact point** (13 to 16): a ray from last step's truck centre (relative to the
     box's last position) toward the hub now. The nearest crossed face wins, no direction test.
     With `n` its outward normal in the truck frame: the point is the hub, moved `w / 2` toward
     the face's side in x (`+` when `n_x < 0`), and `r * max(|sin atan2(n_z, n_y)|, |sin
     atan2(n_x, n_y)|)` along `-(n_y, n_z)` normalised. Its depth inside the face, when it
     beats the stored one, becomes that point's contact: depth, outward normal (world) and the
     point itself (body).

The post-step then pushes the truck out of these contacts like terrain ones (section 14.11).
Pushable boxes (section 7.3), box corners against wheels, ramps and other trucks follow.

### 14.15 Level boxes as collision objects (`0x5495e0`, `0x5543c0`)

**Setup** (`0x5495e0`, once per box when the level loads). The box record holds the position
(`+0x4c`, feet; a negative x or z gets 8192 added), the angles theta, phi, psi (`+0x58`, `+0x5c`,
`+0x60`, in the SIT's order), the full sizes length (`+0x64`, along the box's z), width (`+0x68`,
x) and height (`+0x6c`, y), the mass (`+0x70`, slugs as the SIT writes it), the bounding radius
(`+0x74`), the model name (`+0x22c`), the type (`+0x244`) and the `priority` (`+0x24c`).

- **A box with a model takes its sizes from the model**, replacing the SIT's: the model's
  vertex bounds (`0x450ae0`; minimum and maximum x, y and z over its vertices, at the scale the
  model is drawn with, `v * 256 / magnify` in 1/256 ft), so width = the x extent, height = the y
  extent, length = the z extent, in feet.
- **Types 8 and 9** (camera-facing): length and width both become the larger of the two, then
  both are halved.
- The box is **centred on its position**: half extents are half the sizes, and the bounding
  radius is `sqrt(a^2 + b^2 + c^2)` of the half extents. The model's own origin and bounds
  offset are not used.
- The rotation is the same Euler matrix as the truck's (`0x468a90`) from theta, phi, psi;
  all three exactly 0 give the identity.
- A flag at `+0x0` is set when the mass is at least 1 (as stored).
- The 8 corners (`+0xc4`, body axes, in this order, `a`, `c`, `b` the half extents along x, y, z):
  `(-a, -c, b)`, `(a, -c, b)`, `(-a, c, b)`, `(a, c, b)`, `(-a, c, -b)`, `(a, c, -b)`,
  `(-a, -c, -b)`, `(a, -c, -b)`.

**Which boxes collide** (`0x5543c0`, every frame): every box except types 6 (checkpoint), 7 and 8,
whose `priority` is at most the MONSTER.INI `detailLevel` (`0x640778`, the same rule that decides
whether it is drawn). A box joins the frame's object list once, when it lies within `r + R + 10`
ft on both x and z of an object already listed (trucks first, then ramps, then earlier boxes;
`r` and `R` the two bounding radii), or when it moves faster than 0.1 ft/s. An AI truck (not the
player's) does not bring in a type 11 box (a box inside a checkpoint's footprint) or a box with
no model, unless the count at `0x646c40 + 0xc` is above 0 (its meaning is still open).

Pairs are then tested as in section 14.14, and whether a box is immovable or pushable for a
truck follows section 7.3 (immovable when its mass is 0 or at least the truck's).

### 14.16 Pushable boxes: their own motion (`0x470d70`, `0x4764d0`)

The frame loop (`0x46c0e0`) runs, for each sub-step: every listed object's step by kind (box
`0x470d70`, truck `0x470810`), the broadphase (`0x488d90`), every pair test (`0x489f90`), then the
post-step (`0x471280`). A box's force and moment from the pair tests (`+0x78`, `+0x84`, world) are
therefore applied in its **next** step, as for trucks.

**Box step** (`0x470d70`), only for a box whose flag (`+0x0`, mass at least 1) is set, and only
when its accumulated force or its velocity (`+0x94`) is non-zero (a box at rest with nothing
pushing it is not stepped):

1. The rotation is kept as last step's (`+0x28`).
2. Mass `m` = the box mass, weight `W = 32.174 m`; gravity is `-W` along world y, in body axes.
3. **Drag** (`0x474f90`, air only; the water areas of 14.7.1 are truck-only): face areas
   `A_x = h l`, `A_y = w l`, `A_z = w h` (w width along x, h height, l length along z, full
   sizes), every coefficient 1: `F_i = -(A_i * 0.002377) * 0.5 * v_i |v_i|`.
4. **Aero damping** (`0x475180`), with `L` = the length, `q_bar = 0.0011885 |v|^2` at least
   **0.11885** and every coefficient **-1** (a truck uses -0.2, -0.2, -0.4 and a floor of
   26.74125): `M_x = -q A_y L q_bar`, `M_z = -p A_x L q_bar`, `M_y = -r A_x L q_bar`.
5. **Contacts** (`0x475960`, the hull-contact solver of 14.12): the box's 8 corners whose depth is
   at least -0.25 are the contact list, in corner order, but only when the last post-step pushed
   the box out at least once (`+0x220`). The solver is the truck's, with the box's mass, weight
   and inertias.
6. **Sums** (`0x46cfe0`, `0x46d270`): `F = gravity + drag + contact force + the pair forces
   (+0x78)`, at most 500000 in size; `M = damping + contact moment + the pair moments (+0x84)`
   (no drag moment: a box's drag acts at its centre). Both accumulators are then cleared.
   **Integration** as for a truck (14.9, rates clamped to +-13, `a = F / m - omega x bvel`, then
   the Euler rates of section 9.4), with the inertias `I1 = m (h^2 + w^2) / 12`,
   `I2 = m (h^2 + l^2) / 12`, `I3 = m (w^2 + l^2) / 12` (the truck's I1, I2, I3 slots: about z,
   x and y). **At rest** (`0x46da30`): velocity and rates are zeroed when `|ivel| < 0.1`, or
   below **2.0** with 3 or more contacts (a truck's limit is 0.5); then `pos += ivel dt`.
7. The corner depths (`+0x200`) are reset to -9999.

**Box post-step** (`0x4764d0`): the push-out count (`+0x220`) is cleared, then each corner 1 to
8 in turn is probed against the terrain like a truck point (`0x46c9e0`, vertical depth `d` and
normal `n`):

- When `d * n_y` beats the corner's stored depth, it becomes the stored depth with `n` as the
  corner's normal, and the push is `(d - 0.25) * n_y` when `d` is above 0.25 or below 0, else 0.
- Otherwise the stored contact stays, and the push is `stored - 0.25 * n_y` (its own normal)
  when the stored depth is above 0.25 or below 0, else 0.
- When neither the push nor the stored depth is negative, the box moves by `push * n`, every
  corner's depth drops by `n_i . (push * n)`, and the count goes up by one.

A box whose flag is not set (immovable) only has its rotation matrix rebuilt from its angles.

### 14.17 Truck against a box: the pair, pushable boxes and box corners (`0x489f90`)

**Pair order** (`0x488d90`): the broadphase stores each overlapping pair (bounding spheres,
`|c1 - c2| < r1 + r2`; a truck in helicopter flight is left out) once, under the object listed
first. Trucks are listed before boxes, so a truck and a box always meet in the pair test's
"box against truck" branch.

**Mass class and effective mass** (that branch): with `M_t = W_t / 32.174` the truck's mass, a box
is **pushable** when its mass is not 0 and below `M_t`, and the effective mass is then the box's
mass; otherwise the box is immovable for this truck and the effective mass is `M_t`.

Then, in order:

1. **Hull points and wheels** (`0x4a52b0`, section 14.14): the early out, the 12 hull points
   (`0x4aad00`), then the four wheels (`0x4a7fc0`).
2. **Box corners against the wheels** (`0x4a1210` -> `0x49f920`), when the early out passes again
   and the box mass is above 0 (as stored), for each corner 1 to 8 and each wheel FR, FL, RR, RL.
3. The pair's forces and moments are added once: the truck's to its accumulators (`+0xfbc`,
   `+0xfc8`, body axes), the box's to its own (`+0x78`, `+0x84`, box axes). Both act in the next
   step. **Each contact below overwrites the pair's force and moment** (they are globals that
   the frame loop clears after every pair, `0x46c0e0`), so only the last contact that produced a
   force counts, however many hull points, tire points or corners hit. The push-outs, which move
   the box directly, all happen.

**Pushable box, hull point or tire contact point** (`0x4aad00`, `0x4a7fc0`): when the point's
depth inside the face (as in 14.14) is positive and beats its stored depth, the point does not
become a ground contact. Instead, with `n` the face's outward normal and every vector in the box's
axes:

- `v_rel = v_truck point - v_box point`, the truck point's velocity `bvel + omega x P` (P the hull
  point, or the tire contact point) and the box point's `bvel_box + omega_box x r` (r the point
  relative to the box);
- `closing = -(n . v_rel)`; when it is at least 0: `F = m_eff * closing / dt`, the box gets `-F n`
  with moment `r x (-F n)`, the truck gets `+F n` (to its body axes) with moment `P x F`;
- and only then the box moves out by the depth: its position moves by `-depth * n` (world), and
  the hull rays' reference point is formed again, so later points see the box where it now is.
  With `closing` below 0 nothing happens.

A point that is not deeper than its stored depth does nothing. The wheels' suspension test
(14.14, `0x4a6390`) has no class check, so a pushable box's top carries a wheel like an immovable
one.

**Box corners against a wheel** (`0x49f920`), for corner `i` (world `W`) and a wheel with hub `h`
(body), radius `r`, width `w` and axle `a = (1, 0, 0)`:

- The ray runs from the corner's position relative to the truck as it was last step (`A`, body
  axes; the code forms it from the tire's `+0x24`, which this doc reads as the hub's position at
  the last step, and the truck's last-step rotation `+0x28`) to its position now (`B = M^T (W -
  pos)`). `d = B - A`, `L = |d|`, `u = d / L`; nothing when `L` is 0.
- Candidates along the ray (each moved back by 0.1 ft and counted only when above -0.1 ft):
  the two end caps (planes through `h -+ (w / 2) a`, the hit within `r` of the cap centre, `t`
  in (0, L)), and the tire's side (the cylinder of radius `r` about the axle through `h`, both
  roots of the circle test in the plane across the axle, each within `w / 2` of `h` along the
  axle and below `L`). The nearest wins.
- On a hit at `P` (body): the box moves by `M (P - B)` (world), so the corner ends on the wheel's
  surface. With `n` = that move, normalised, in box axes, and `v_rel` = the hub's velocity
  (`bvel + omega x h`, to the box's axes) minus the corner's (`bvel_box + omega_box x corner`):
  `closing = v_rel . n`. When `closing` is below 0 only a tiny `(0, 0.01, 0)` is added straight
  to the box's accumulator (which wakes it for the next step; the pair's force is left as it
  was); otherwise `F = m_eff * closing / dt`, the box
  gets `+F n` with moment `corner x F`, and the truck `-F n` (to its body axes) with moment
  `h x F`.

**A box with mass is dynamic even when it is immovable for the truck**: any box whose flag is set
(mass at least 1) is stepped once something gives it a force or a velocity (14.16), so a heavy
box can still be shoved by the corner test.

### 14.18 Moving objects (`0x550c80`, `0x5543c0`, `0x502350`)

A SIT box of **type 10** is a moving object (TPARK's train cars are the stock ones, and the
engine's limit message calls them trains, but any type 10 box moves this way): the loader
(`0x550c80`) lists it (at most 50) and keeps its `bvel` (`+0x294`, feet per second, world). Its mass is 0 in every stock SIT, so for a truck
it is an immovable box (ground) that is never stepped; its own velocity (`+0x94`) stays 0, so the
pair tests see it as standing still where it is that frame.

Every frame, while the game runs (`0x63f4f0` set, not paused), the race clock (`0x6f5f98`) is
above 0 and the simulation is not frozen (`0x63f524`, slew mode), each moving object moves before the
frame's object list is built (`0x5543c0`), with `dt` the frame time:

    x += bvel.x * dt,  z += bvel.z * dt
    y  = groundBoxHeight(x, z, y) + height / 2
    x, z wrapped into [0, 8192)

**`groundBoxHeight(x, z, y)`** (`0x502350`): the cell is `(floor(x / 32), floor(z / 32))`, each
`& 255`; when x lies exactly on a cell's west edge and that cell's ground-box top is lower than
the west neighbour's, the neighbour is used, and the same for z and the north neighbour. When the
cell has a ground box (lower and upper heights differ) and its lower height is below `y`, the
height is the box's top; otherwise it is the terrain height (2.1), raised to the water level in
Snow weather. So a moving object rides on the deck of a ground-box bridge it is above, and on the terrain
everywhere else.

### 14.19 Ramps (`0x550890`, `0x549b40`, `0x54feb0`)

The SIT's `*** Ramps ***` section (sim kind 2, table `0xa2f270`, 0x118 bytes each). In the stock
game only SNAKE (8 ramps, 38 x 18 x 10 or 8 ft) and WAR (1, 82 x 80 x 30 ft) have any, and none of
them has a model.

**Loader** (`0x550890`): `ipos` (`+0x28`), the angles (`+0x34`, theta, phi, psi), then either a
`model` line (name at `+0x104`) or `length, width, height` (`+0x40`, `+0x44`, `+0x48`), the mass
(`+0x4c`) and two more triples (`+0x78`, `+0x84`).

**Setup** (`0x549b40`): a negative x or z gets 8192 added. A model replaces the sizes with its
vertex bounds (width = x extent, length = z extent, height = y extent, as for boxes). With
`a = width / 2`, `b = length / 2` and `H` the full height, a ramp is a **wedge standing on its
position**: the corners (`+0x9c`, ramp axes) are `(-a, 0, b)`, `(a, 0, b)`, `(-a, H, b)`,
`(a, H, b)`, `(-a, 0, -b)`, `(a, 0, -b)`, so its top rises from the back (`-z`, height 0) to the
front (`+z`, height `H`). The bounding radius (`+0x50`) is `sqrt(H^2 + a^2 + b^2)`; `sin psi`
and `cos psi` are kept (`+0xe4`, `+0xe8`); the slope's normal is `unit(0, 2b, -H)` turned by psi
(`+0xf8`); the rotation matrix is the usual Euler one (identity when all angles are 0).

**Listing** (`0x5543c0`): a ramp whose first word (`+0x0`) is set is always in the frame's object
list (nothing in the loader sets it); any other ramp joins when it lies within `r + R + 10` ft on
x and z of an object already listed, as boxes do (14.15).

**The height query** (`0x54feb0`, the one the probes use, 2.1) goes through the frame's listed
ramps in list order before the terrain. For a ramp at `(xr, yr, zr)` and a point `(x, z)`, with
`dx = xr - x`, `dz = zr - z`, both at most the ramp's radius:

    u = cos psi * dx - sin psi * dz        (minus the point's x in ramp axes)
    v = cos psi * dz + sin psi * dx        (minus its z)
    |u| <= width / 2 and |v| <= length / 2:  height = (length / 2 - v) * H / length + yr

The first ramp that holds the point wins, whatever the point's own height; otherwise the terrain
(Snow-aware, `0x5017e0`). Only psi turns the footprint. **The ground normal ignores ramps**
(`0x550380` is the terrain normal), so on a ramp the probes see the ramp's height with the
terrain's normal.

**The ramp as a solid** (the pair test of a truck and a ramp: `0x4b2580`, then the edges
`0x4b17c0`). In ramp axes the wedge holds a point `P` when

    -b <= P.z <= b,   -a <= P.x <= a,   0 <= P.y <= top,   top = (P.z + b) / (2 b) * H

(`0x48c230`). Its sides, its tall front end and its slope are faces; the slope is also ground
through the height query above. In order:

1. **The four wheels** (`0x4aa110`, FR, FL, RR, RL). With the hub's world position relative to
   the ramp `d` (3D), only when `|d| < R_ramp + rho` (the tire's bounding radius, 14.20): `d` in
   ramp axes; when `|d.x / width| <= |d.z / length|` the direction toward the ramp is
   `(0, 0, -sign d.z)`, else `(-sign d.x, 0, 0)` (ramp axes; the code forms the sign as
   `|v| / v`, so a zero there divides by zero; OpenPhotex takes it as +1). That direction in the truck's axes is
   `g`; the probe point is the hub plus `(s w / 2, r gy', r gz')`, with `s = +1` when `g.x > 0`
   else -1 and `(gy', gz') = unit((0, g.y, g.z))` (the tread point toward the ramp, at the tyre's
   side facing it). The point is taken to ramp axes, tested as above, and pushed out as for hull
   points (`0x4b3540`, the same rule with the probe point).
2. **Hull points 1 to 12** (`0x48c230`, `0x4b2950`), each in ramp axes. For a point inside, with
   `w = v_ramp(P) - v_truck(P)` (the ramp's own velocity `+0x78` and rates `+0x84`, zero for stock
   ramps; the truck's point velocity taken to ramp axes):
   - distances `dx = |(w.x <= 0 ? -a : a) - P.x|`, `dy = |top - P.y|`, `dz = |(w.z <= 0 ? -b : b) - P.z|`;
   - times `tx = dx / w.x` (100 when 0), `ty = dy / w.y` (10^6 when 0), `tz = dz / w.z` (100 when 0);
   - when `|ty| <= |tx|`: the z face if `|tz| < |ty|` and `tz > 0`, else nothing (the slope is
     left to the height query); otherwise, when `|tz| <= |tx|`: the z face if `tz > 0`, else
     nothing; otherwise the x face if `tx` is not 0. So only the sides and the front end (`+z`,
     the tall end, met while moving toward `-z` relative to the ramp) push; the back edge (height
     0) never does.
   - The push is `|t| w + 0.2 n` (`n` the face normal, `sign(t)` along its axis), in ramp axes,
     added to the truck's position (world).
   - The force law (`0x48c8a0`, 14.20) runs with whatever effective mass the last pair left
     (`0x6f1bf0`), but the ramp case of the pair dispatcher applies no pair forces: the walls
     only move the truck.
3. **The edges** (`0x4b17c0`): with the corners `c0..c5` in world space, the edges
   `c0 c2`, `c1 c3` (the front's vertical edges), `c2 c4`, `c3 c5` (the slope's sides) and `c2 c3`
   (the top of the front), each one whose line passes within the truck's radius of its centre,
   go to the edge system (14.26, shared with top-crush cars) with its ends in the truck's axes.

### 14.20 Truck against truck: hull points (`0x4894a0`, `0x48c010`, `0x48eb70`, `0x48c3d0`, `0x48c8a0`)

For a pair of trucks (neither in helicopter flight), with `|ivel|` their speeds: the pair's first
truck (listed first) is the **slower** one `S` unless the other is strictly slower; the other is
the **faster** one `F`.

1. **Pass 1**: each hull point 1 to 12 of `S` against the hull box of `F`; then the wheels
   against the wheels (`0x491950`, below).
2. **Pass 2**: each hull point of `F` against the hull box of `S`; then the wheels again.

**A point against a hull box** (`0x48c010`): with `O` the box's truck and `T` the point's, the
point `P` (T axes) is taken to O's axes, `r = M_O^T (pos_T + M_T P - pos_O)`, when it lies within
O's radius of O's centre. O's hull box is two half boxes made of O's own hull points (body axes;
the TRK order has P1, P2 the front bottom corners, P3 front top, P9 rear top, P11, P12 rear
bottom):

- `r.z >= 0`: `r.z <= P1.z`, `P1.x <= r.x <= P2.x`, `P1.y <= r.y <= P3.y`;
- `r.z < 0`: `P11.z <= r.z`, `P11.x <= r.x <= P12.x`, `P11.y <= r.y <= P9.y`.

**The response** (`0x48eb70`), for a point inside, everything in O's axes:

- `v_rel = v_O(r) - v_T(P)`: O's point velocity `bvel_O + omega_O x r` minus T's (`bvel_T +
  omega_T x P`, taken to O's axes); the effective mass is the **lighter** truck's mass,
  `min(W_O, W_T) * 0.031081`.
- The distances to the walls the relative motion points at: when `v_rel.z <= 0` the rear half
  box's (`x` to `P11.x` when `v_rel.x <= 0` else `P12.x`, `y` to `P11.y` when `v_rel.y <= 0` else
  `P9.y`, `z` to `P11.z`), else the front half box's (`P1.x` / `P2.x`, `P1.y` / `P3.y`, `P1.z`),
  each as an absolute value. The times `t_i = d_i / v_rel_i` (100 for x or z and 10^6 for y when
  that component is 0).
- **The axis** (`0x48c3d0`): when `|t_y| <= |t_x|`, z if `|t_z| <= |t_y|` (and `t_z` is not 0),
  else y (if `t_y` is not 0); otherwise z if `|t_z| <= |t_x|` (and not 0), else x (if not 0).
  None: nothing happens. The push is `v_rel |t_k|`, the normal `e` the axis `k` with the sign
  of `t_k`.
- **The faster truck moves**: by `M_O push` when O is the slower one (T moves), else O moves by
  `-M_O push`.
- **The force** (`0x48c8a0`): `F = m_eff |v_rel . e| / dt`; O gets `-F e` at `r` (its axes), T
  gets `+F e` (to its axes) at `P`, with their moments. As with boxes (14.17), each contact
  overwrites the pair's forces and only the last one is applied, once, to both trucks'
  accumulators (the code swaps them round so that each truck gets its own).

**Wheels against wheels** (`0x491950`, after each pass). `A` is the pass's box truck (pass 1
the faster, pass 2 the slower) and `B` the other. Each tire has its hub `c` (body, 14.2), radius
`r` (`+0x6c`), width `w` (`+0x74`) and bounding radius `rho = sqrt((w/2)^2 + r^2)` (`+0x70`,
`0x4bd370`); its axle's half axis is `h = (w/2)(cos d cos a, cos d sin a, sin d)` with `a` the
axle's articulation (`+0x22c`, `+0x230`, 14.2) and `d` its steer angle (`+0x24c`: the front
steer, or the rear counter-steer). For each wheel `Bw` of `B` within `rho_Bw + R_A` (the truck
radius) of `A`'s centre, each wheel `Aw` of `A` in the order FR, FL, RR, RL:

1. **Pretest** (`0x490790`): the hubs (world) closer than `rho_Aw + rho_Bw`.
2. **B's rim point**, in B's axes: `q = M_B^T (hub_Aw - hub_Bw)` (world hubs), `D_B = unit(h_B)`,
   `t = D_B . q`; the face centre `E = c_Bw - h_B` when `t <= 0`, else `c_Bw + h_B`; the rim
   point `R_B = E + r_Bw unit(q - t D_B)` (a zero vector unit is `(0, 1, 0)`). In A's axes,
   `R_A = M_A^T (pos_B + M_B R_B - pos_A)`.
3. **Inside A's wheel** (`0x48b5d0`): A's axis runs from the inner face outward: for a left
   wheel (anchor x below 1, as an integer test of the float) from `c_Aw + h_A` along `-h_A`, for a
   right wheel from `c_Aw - h_A` along `+h_A`; `D = unit(axis)`. The point is inside when its
   distance from the axis line is at most `r_Aw` and `sqrt(|R_A - c_Aw|^2 - dist^2) <= w_Aw / 2`.
4. **The response** (`0x491e20`), in A's axes, with `v = v_B(R_B) - v_A(R_A)` (point velocities,
   B's taken to A's axes), the lighter truck's mass `m` (as 14.20), `n = unit(-v)`:
   - axial: `k = D . (R_A - c_Aw)`, depth `d_a = max(0, w_Aw / 2 - k)`; `rad = (R_A - c_Aw) - k D`;
   - `E_A` = B's face centre in A's axes; `cos = |unit(R_A - E_A) . unit(rad)|` (the code
     compares against `0x60ef50` read as a float, which is 0: the low half of the double 1/128);
   - `e = (E_A - c_Aw) - D (D . (E_A - c_Aw))`, `l = |e|`; `p = -v - D (D . -v)` (the motion
     across the axis); `delta` the distance from A's axis to the line through `e` and `rad - p`
     (999999 when the two coincide);
   - radial depth: `lam = sqrt(l^2 - delta^2)`, `mu = sqrt((r_Bw cos + r_Aw)^2 - delta^2)` (each
     0 when negative); `d_r = mu - lam` when `n . unit(e) >= 0`, else `lam + mu`;
   - times `t_a = d_a / (-v).x` and `t_r = d_r / (-v).z` (100 when the component is 0; the code
     divides by those two components, not by the speeds along the normals);
   - when `|t_r| <= |t_a|` (and `t_r` not 0) the contact is **radial**: depth `d_r`, normal
     `N = unit(p)`; otherwise (`t_a` not 0) **axial**: depth `d_a`, `N = D`.
   - The faster truck moves out by `M_A N (depth + 0.05)` (B by `+`, when A is the slower; else
     A by `-`).
   - `F = |(v / 2) . N| / dt * m` and `f = F N`. A radial contact adds the tyres' climb: with
     `G = s / dt * m * 0.05`, `s` = 0 (the same float read of `0x60ef50`), replaced by `r_Aw spin_Aw` when `Aw` is on the ground,
     plus `r_Bw spin_Bw` when `Bw` is (spin is tire `+0xb8`, `v_fwd / r`), `f += (0, -G N.z, G N.y)`.
   - A gets `-f` at `R_A`, B gets `+f` (to its axes) at `R_B`, in the same last-contact record as
     the hull points.

The pair also posts crash sounds and damage (`0x532140`, `0x429cb0`, `0x424060`), not physics.

**Wheels against wheels** (`0x491950`): when two wheels' bounding spheres overlap, `0x490790`
forms the touching point on the wheel and `0x48b5d0` / `0x491e20` respond; still to be written up
here.

### 14.21 Box against box (`0x49f0d0`, `0x4ae1d0`)

For two boxes whose bounding spheres overlap (ground boxes included), when at least one has its
flag set (mass at least 1, 14.15): the **mover** `M` is the pair's second box when its flag is
set, else the first; the other is the **base** `B`. Only M's corners are tested, against B; B is
never pushed and no force passes between them: **B is ground for M's corners**, and M's contact
solver (14.16) does the rest.

- The ray starts at M's centre last step, relative to B and in B's axes: `M^T_B ((pos_M -
  pos_B) - ivel_M dt)` (only M's velocity), and runs through each corner 1 to 8 as it is now.
- The face test is the truck hull points' (14.14 step 2): faces in the order bottom, top, front,
  back, left, right, at most two crossings counted, the nearest with `t > 0` whose outward normal
  faces the ray; the depth is the corner's distance inside that face.
- When that depth beats the corner's stored depth, it becomes the corner's depth, B's face
  normal (world) its normal, and `(0, 0.01, 0)` is added to M's force (which keeps it stepping).

So loose boxes rest on ground boxes and stack on one another.

### 14.22 Autopilot: following, steering, target speed and speed control (`0x480410`)

Run first in the truck step (14.1) for a truck under autopilot, while racing (`0x6f58d8` not 0).
On a reversed course (`0x647564`) the current segment is turned round for the call (a
straight's start and end swapped, and for segment 1 its `cspeed` taken from the last segment;
an arc's entry and exit angles swapped) and restored after. Then `0x481a70`, then `0x4805d0`.
Angles are headings `atan2(dx, dz)`; `wrap` takes an angle into [-pi, pi]
(`a - trunc(a / 2 pi) 2 pi`, then +-2 pi). `H(x, z)` is the height query with box and ramp tops
(`0x550090`).

**Segment to line** (`0x481a70`, `0x483070`). The autopilot steers along a line `S -> E`:

- a **straight**: `S` its start, `E` its end;
- an **arc** (centre `c`, entry angle `a0`, exit `a1`, radius `R`): with the look-ahead position
  `L = pos + 2 ivel dt` and `u = unit(L - c)` (3D), `theta = heading(u)`, the progress
  `f = wrap(theta - a0) / wrap(a1 - a0)`. When `f < 0` or `f > 1`, `u.x, u.z` become
  `sin, cos` of `a0` (`f < 0`) or `a1` (`f > 1`), `u.y` kept. The arc point is `P = c + R u`
  and the tangent `T = (u.z, 0, -u.x)` when `wrap(a1 - a0) > 0`, else `(-u.z, 0, u.x)`; then
  `S = P - 100 T`, `E = P + 100 T`. (The routine also forms `|wrap(heading(pos - c) - a1)|`,
  the angle left to the exit, for later use; its height term passes the offsets from the centre
  to the height query, not a world position.)

**Bearing** (`0x481ea0`): `hs = heading(E - S)`; `D = |E - pos|` with the y difference taken
from `E.y - H(pos)`; `b = wrap(heading(E - pos) - hs)`; the cross-track error
`e = sin(b) D` (`+0x8e8`); the correction `c = D > 50 ? asin(clamp(0.02 e, -1, 1)) : b`
(`+0x8d0`), clamped to +-0.125 on a straight and +-0.5 on an arc.

**Target speed** (`+0x89c`), with `g = 32.174`, `K = 1.75` (`0x647634`), `k = 0.45`
(`0x647658`; both raised on Sonic tracks, section 6.5) and the difficulty gain `G` (`+0x8b8`:
0.5, 0.75, 1.0):

- `mu` = the average of the four tires' surface grip factors (tire `+0x8c`);
- the climb to the aim point: `w = unit(E.x - x, H(E) - y + 6, E.z - z)`;
  `a = g w.y + mu sqrt(1 - w.y^2) k g` (`+0x8bc`, the deceleration the truck can count on);
- **arc** (`cspeed_type` 1): `v = cspeed sqrt(G) sqrt(mu / K) sqrt(ratio)`, where
  `ratio = (sin b_h + K cos b_h) / (sin b_arc + K cos b_arc)`, `b_arc` the arc's bank and `b_h`
  the bank measured along the truck's own heading from the centre (`atan((H(R + 5) - H(R - 5))
  * 0.1)`); when the truck is wider than the radius (`d - R > 0`, `d` its distance from the
  centre) `ratio *= min(sqrt((k2 (d - R) + R) / R), 1.2)` with `k2 = 0.725` (0.75 Sonic);
  `ratio` at least 0.1;
- **straight**: `v = sqrt(max(0, (cspeed sqrt(G))^2 + 2 a D)) sqrt(mu / K)` (braking toward the
  next arc, whose speed the straight's `cspeed` holds).

Traffic (`0x483600`, below) may then adjust the target and the correction.

**Steering** (still `0x481ea0`), with `psi` the truck's heading:

    err  = wrap(hs - psi + c)
    cmd  = 22 (+0x8b4) * dt * err
    cmd *= min(|e| / 32, 1.5)                  when |e| > 32 on a straight
    in the air (no wheel on the ground) above 14.67 ft/s:
         I += clamp(err, -0.5, 0.5) / dt * 1.0 (+0x8b0) * dt;  cmd += I     (I is +0x8ac)
    cmd *= D / 30                              when D < 30
    cmd *= min(sqrt(|20 / bvel.z|), 1)         on a straight
    cmd  = clamp(cmd, -0.45, 0.45)
    steer += (cmd - steer) * 6.66 (+0x8cc) * dt,  clamped to +-0.45;  rear = -0.33 steer
    (x1.25 in drag mode)

The steering is applied only when the autopilot drives (`+0x894`) or for the player at
autopilot level 3; level 1 and 2 leave the player steering.

**Speed control** (`0x4805d0`):

    drag  = (0.8 brake_r + 0.02)(grip_RR + grip_RL) + (0.8 brake_f + 0.02)(grip_FR + grip_FL)
    acc   = ((a rpm + b) rpm + c) * throttle / r_RR * gearRatio * transfer - drag
    pred  = acc / m * dt * 0.05 (+0x8a4) + (v_FR + v_FL + v_RR + v_RL) / 4
    target = max(target, 17) (outside drag mode); and at most the segment's cSpeedLimit
             when that is 10 or more
    u     = 1.2 (+0x8a0) * dt * (target - pred)

`grip` is each tire's grip (`+0x90`, as the last step left it), `v` each tire's forward speed
(`+0x50`, `v_fwd`), `(a, b, c)` the torque curve without its scale (`+0x544..`), the brakes and
throttle last step's. When the autopilot drives: `u >= 0` gives throttle `min(u, 1)` and no brake;
`u < 0` gives no throttle and both brakes `min(-u, 1)`. (For the player, level 2 does the same,
and level 1 only brakes on a straight when `u` is below minus the front brake.) The same routine
also runs the race-start countdown for the player's truck (section 6).

**Frame time.** The game steps once per rendered frame with that frame's `dt` (MONSTER_EXE_ANALYSIS.md
section 5), and four autopilot terms scale with it: the look-ahead (`2 ivel dt`), the steering
command (`22 dt err`), the air integrator (`clamp(err)` per frame) and the speed controller
(`1.2 dt (target - pred)`, with `0.05 dt` in the prediction). A port that steps at a fixed, shorter
dt halves them at 60 Hz, and the trucks then run wide and stall against JUNK's walls.
**Hypothesis:** the game was tuned at about 30 frames per second; OpenPhotex evaluates those four
terms at `AUTOPILOT_FRAME_DT = 1/30 s` and everything else at the real step. With it, a CPU truck
laps every stock Circuit track (OpenMTM2 `tests/sim-session.test.mjs`).

### 14.23 Autopilot: the next segment and rubber-banding (`0x481060`)

Every tick (from the race logic, `0x487300`, for every truck while racing), the truck's segment
`ap.cnumber` (`+0x898`) moves on when the truck is closer to the segment's end line than the
segment's `cdec_point` (field 8):

- **straight** `S -> E`: the next segment's centre `N` (fields 2 to 4 of the arc that follows;
  for a reversed course the one before) is projected onto the line `S E` at `F`; the end line
  runs through `F` across the straight, from `F - 200 n` to `F + 200 n` with
  `n = unit(F - N)` (horizontal); the distance is the truck's from that line, in x and z;
- **arc** (centre `c`, exit angle `a1`, radius `R`): with `x = 2 R (sin a1, cos a1)`, when
  `x . (pos - c) > 0` (the truck is on the exit side) the distance is the truck's from the
  line through `c` along `x`, in x and z; otherwise it is `2 cdec_point` (no advance).

On advancing: the course integrator `I` (`+0x8ac`) is cleared, the segment count (`+0x8f0`) goes
up by one, the segment becomes the next (after the last, `lastentry`, segment 1; reversed: the
one before, from 1 to the last), and the estimated time to the segment's end is recomputed
(`+0x8dc`, `0x480ba0`, used by traffic and the race order). Entering a **straight**, the
difficulty gain `G` (`+0x8b8`) is set again: 0.5 Rookie, 0.75 Intermediate, 1.0 Professional,
**minus a rubber-band bonus** for a CPU truck in first or second place (`+0x8f8`) on Rookie or
Intermediate while the player is not first:

    bonus = trunc(frac(bvel.z) * 5 / place) * 0.1      (frac: bvel.z minus its truncation)

The fractional part of the truck's forward speed serves as a cheap random number, so the
leaders lose up to a few tenths of gain on some straights.

### 14.24 Race rules: checkpoints, laps, finish and the race order (`0x487300`, `0x485af0`, `0x52ee50`)

The race tick (`0x487300`), every frame while racing, for each truck: the checkpoint test
(`0x485af0`), the off-course check (`0x486630`), the estimated time to the segment's end
(`+0x8dc`, eased toward `0x480ba0` at `0.75 dt`), the segment advance (14.23) and the segment
progress; then, for all trucks, the race order; then the race clock (`0x6f61d8`) gains `dt`.

**Time to the segment's end** (`0x480ba0`), eased in as `eta += (T - eta) 0.75 dt`, with `v`
the average of the four tires' forward speeds (`v_fwd`, tire `+0x50`):

- straight (end `E`, `cdec_point` `L`, `cspeed` `vc`): `D = |E - pos|` with the y difference
  `E.y - H(pos)`; the braking deceleration `a` (`+0x8bc`, 14.22) and the forward acceleration
  `b` (`+0x8c4`, the body z acceleration the last integration produced, `+0x100c`), each at
  least 0.1 (a smaller `a` is written back as 0.1). The distance spent accelerating is
  `x = (2 a (D - L) + vc^2 - v^2) / (2 (a + b))`; when `x > 0` the peak speed is
  `vp = sqrt(2 b x + v^2)` and `t1 = (vp - v) / b`, otherwise `vp = v`, `t1 = 0`; then
  `T = t1 + (vp - vc) / a`;
- arc (centre `c`, exit angle `a1`, radius `R`): `T = R |wrap(heading(pos - c) - a1)| / v`,
  `v` at least 0.1.

On a new segment (14.23) `eta` is set to `T` outright.
The countdown is section 6.1 (3 s; then every truck goes and `raceStartTime` is stamped).

**Checkpoint test** (`0x485af0`, not in Summit Rumble), against the truck's next checkpoint
(`+0xfa8`, an index into the level's checkpoints in file order):

1. Sphere pretest against the **detector** (6.2): `|pos - c| < (r_c + r_truck) * 2`.
2. The hull-point test of 14.14 in **checkpoint mode** (`0x4a52b0` with `0x6f60bc` = 1): no
   contacts, forces or wheels; it only keeps the deepest hull point that crossed the box's
   **back face** (outward normal `-z`): its depth `d` and body point `P`.
3. When such a point exists (`d > 0`) and its velocity (`bvel + omega x P`, in the checkpoint's
   axes) is forward along the checkpoint (`v_z > 0`): outside drag mode the same test is made
   against the **gate**; crossing it too is a **pass**, otherwise a **miss**.

On a **pass**: the segment counter `+0x8fc` goes up (at most 90); the split
`split[lap][i] = clock - raceStart - d / v_z`, made relative (minus the lap's earlier splits and
minus the time of the laps before, `+0xfa4`), so each entry is the time since the last
checkpoint; the index `i` goes up and `+0xfac` = `lap * count + i` (checkpoints passed in all).
When `i` reaches the level's checkpoint count, the lap closes: its splits are added to the race
time `+0xfa4` and to the lap time `+0xf50[lap]`, the fastest lap `+0xfa0` is kept, the lap
counter `+0x8f4` goes up (and, for the leader, a laps-led count), `0x52ee50` runs, and `i`
returns to 0. A lap needs every checkpoint in order: only the next one is ever tested.

On a **miss** (reported once, until the state changes): the player hears the announcer; a CPU
truck is recovered. On **Professional** (and when `+0x17a8` is clear) it is put on the missed
checkpoint: x and z the checkpoint's, y raised 10 ft, velocity, rates, pitch and roll zeroed, the
heading the checkpoint's psi, then **20 ft back** along the checkpoint's axis. Otherwise the
stuck timer is set to -6 s and the **helicopter** lifts it (`0x470190`, section 10.3).

**Finish** (`0x52ee50`, after a lap closes): when the **first** truck completes the race's lap
count (`0x6407a4`, the menu's laps), the race is over: every other truck's finish lap becomes the
lap it is on (its laps + 1, at most the lap count), so each finishes at the end of its current
lap; finished trucks go on autopilot. The player's finish starts the results (and the
fast-simulation of section 5).

**Segment progress** (`+0x8c8`, for the order): `1 - f`, with `f` the share of the segment
left, less the hull's front offset `z1` (hull point 1's z, `+0x5b8`; hull point 11's,
`+0x630`, when the truck is passing, `+0x8d8` not 0):

- straight `S -> E`: `f = (|E - pos| - z1 / G0) / |E - S|` (`G0` the difficulty gain `+0x8c0`,
  which, unlike `+0x8b8`, the rubber band never lowers);
- arc (centre `c`, angles `a0 -> a1`, radius `R`): `f = (R wrap(a1 - theta) - z1) / (R wrap(a1 - a0))`,
  `theta = heading(pos - c)`.

**The race order** (`+0x8f8`): a truck's place is 1 plus the number of trucks ahead of it,
where another truck is ahead when:

- this truck has finished (its laps equal the lap count): the other has finished too, with a
  smaller race time;
- otherwise: the other has finished; or has passed more checkpoints (`+0xfac`); or as many and
  more segments (`+0x8f0`); or as many of both and more progress (`+0x8c8`).

### 14.25 Autopilot: traffic (`0x483600`)

Called from the steering routine (`0x481ea0`, 14.22) after the target speed, before the
steering error. It reads the other trucks' last values: segment (`+0x898`), course
(`+0xfb4`), progress (`+0x8c8`, 14.24), time to the segment's end (`+0x8dc`, 14.24), the
cross-track error `e` (`+0x8e8`) and the unclamped correction `c` (`+0x8d0`) of 14.22, the
bounding radius `r` (`+0xfb8`), position, matrix and tire speeds. It writes the pass target
(`+0x8e0`), the truck to follow (`+0x8e4`), the side (`+0x8d8`), the candidate count
(`+0x8ec`), and may change the correction `c` and lower the target speed (`+0x89c`). "None" is
the index 999. `A` is this truck, `G0` the difficulty gain `+0x8c0` (14.24), `hs` the segment
heading of 14.22, `n = wrap(hs + pi/2)` (the right of the segment), `R = r_A + r_other`, and an
other truck **on the line** has `|e| < 32`. Only CPU-style trucks (object type 4) count.

**1. Candidates.** The window is `w = z1 / vc * G0` (`z1` hull point 1's z, `vc` the segment's
`cspeed`), times 16 while passing (side not 0). A candidate is another truck on the same segment
and course with more progress, `eta_A < eta_other + w` (at most `w` seconds ahead), and on the
line. The best is the candidate with the largest `eta` (the nearest ahead); the count is the
number of candidates.

**2. The previous target** stays a candidate (the count goes up, and it remains the target)
when it is not the best, is on the line, and is on the **next** segment (segment 1 when `A`'s
is the last, `lastentry`; on a reversed course the one before). The target becomes the best
(or the kept one; none without candidates). The player's truck calls the announcer here
(not modelled).

**3. The side**, when the count is not 0. With the target `T` and the hysteresis
`hy = side G0 0.2`:

- **count 2**: the second truck `S` is the other candidate (with `|e| <= 32`). When `T` and `A`
  are both on straights (`ctype` 1): within `|A - T| <= 3 R` the side is `-1` when
  `hy + (c_T - c_A) <= 0`, else `+1`; farther, `-1` when `c_T - c_S > 0`, else `+1`. Otherwise
  (not both on straights): when `e_S < e_T` the target becomes `S` and `S` none; then with
  `q = (A - T)` in `T`'s body axes, `phi = atan2(q.x, |q.z|)`, the side is `-1` when
  `hy + phi <= 0`, else `+1`. After either, `S` becomes none if `eta_A < eta_S` (it is behind).
- **any other count**: the truck to follow is the nearest (3D distance) other truck, not the
  target, on the line, either on the same segment with more progress or on the segment after
  (`+1`, without wrapping). Then the side as for count 2 but without the far case: both on
  straights, `-1` when `hy + (c_T - c_A) <= 0`, else `+1`; otherwise by `phi` as above.

**4. Passing**, when there is a target `T`:

    beta = wrap(atan2(v . n, v . h))                v the world velocity, h = (sin hs, cos hs)
    ts   = wrap(hs + side pi/2)
    P    = T + R (sin ts, cos ts) - A               (x, z)
    phi  = wrap(atan2(P . n, P . h) - beta)

The truck goes for the gap only when `phi` lies on the side's side (`phi > 0` for side `+1`,
`phi < 0` otherwise). Then:

    th  = wrap(heading(T - A) + side pi/2)
    side +1: th = wrap(hs + pi/4) when wrap(th - hs) < pi/4
    side -1: th = wrap(hs - pi/4) when wrap(th - hs) > -pi/4
    P2  = T + R (sin th, cos th) - A
    c   = wrap(heading(P2) - psi)                   clamped +-0.125 on a straight, +-0.25 on an arc

`psi` is the truck's heading, so the steering error of 14.22, `wrap(hs - psi + c)`, counts the
heading twice while passing; that is the game's arithmetic.

**5. No target**: the side is 0 and the truck to follow is the nearest other truck on the same
course, on the line, either on the same segment with more progress or on the next segment (with
the wrap after the last; reversed: the one before).

**6. Following**, when there is a truck to follow `F` (from 3 or 5). The line through `F` along
`n` (from `F + 100 n` to `F - 100 n`, at `F`'s height) gives `l`, the
truck's 3D distance from it (how far behind it is); `d = |F - A|`. With `d' = l` when
`d < R / G0` on the same segment, else `d' = d`, and `v_F` the average of `F`'s tire forward
speeds:

    v^2 = v_F^2 + 2 a (d' - R)                      a = +0x8bc (14.22)
    target = min(target, sqrt(v^2))                 when v^2 >= 0

**7. Beside it**: with no target, when `d < 1.25 R / G0` on the same segment and `l / d < 0.866`
(more than about 30 degrees off its tail), the truck aims 100 ft up the segment beside `F` on its
own side: `q = (A - F)` in `F`'s body axes, `t = n` (or `wrap(n + pi)` when `q.x < 0`),
`P = F + R (sin t, cos t) + 100 h - A` and `c = wrap(heading(P) - hs)`, not clamped.

### 14.26 Edges: ramps and top-crush cars against a truck (`0x49b190`, `0x494fb0`, and their responses)

An obstacle's straight edges (a ramp's or a top-crush car's) are tested against the truck's
**hull box**, a box in the truck's body axes whose faces are taken from the hull points. Each
place where an edge crosses a face of the box becomes a **hull contact** of the truck (depth,
contact point, world normal) at the hull corner nearest it. No force is exchanged: like every
immovable contact (section 7.1), the obstacle becomes **ground** for the truck, and the post-step
push-out (14.11) and the next step's contact solver (14.12) make it act.

Notation below: `Pk` is hull point k in body axes (`+0x5a4 + 12k`: P1 = `+0x5b0`, P2 = `+0x5bc`,
P3 = `+0x5c8`, P4 = `+0x5d4`, P9 = `+0x610`, P10 = `+0x61c`, P11 = `+0x628`, P12 = `+0x634`; in
the TRK order P1, P2 are the front bottom corners (left, right), P3, P4 the front top, P9, P10
the rear top, P11, P12 the rear bottom). `M_t` is the truck's body-to-world matrix (the copy at
`0x6f61e0`), `M_o` the obstacle's (`0x6f58b0`), `pos_t` the truck's `ipos` (`+0xfe0`), `pos_o`
the obstacle's position (`0x6f5148`). `unit(v)` is `v / |v|`, and `(0, 1, 0)` when `|v|` is 0
(every normalisation in this section uses that rule).

#### 14.26.1 Who calls it, and what is set up before

Live callers (the call from `0x494eb3` lies in code nothing references, and is dead):

- **Ramps**, `0x4b17c0`, after the ramp's side walls (`0x4b2580`). The obstacle is the ramp
  (`0x6f60a4`); `pos_o` = ramp `+0x28`, its velocity `v_o` = ramp `+0x78..+0x80` and its rates
  `w_o = (+0x88, +0x8c, +0x84)` (x, y, z). The ramp's six corners (14.19: `c0 (-a, 0, b)`, `c1
  (a, 0, b)`, `c2 (-a, H, b)`, `c3 (a, H, b)`, `c4 (-a, 0, -b)`, `c5 (a, 0, -b)`) are taken to
  world, `pos_o + M_o c`, and five edges are tested, in this order: `c0-c2`, `c1-c3` (the two
  front vertical edges), `c2-c4`, `c3-c5` (the two slope edges), `c2-c3` (the top front edge).
  At the end the pair's force and moment records (`0x6f64c0`, `0x6ed4d8`) are set to zero.
- **Top-crush cars**, `0x4a2d80` (directly, or through `0x495290`, which does the same
  set-up). The obstacle is the car (`0x6f5fb4`); `v_o` = car `+0x94..+0x9c`, `w_o = (+0xa4,
  +0xa8, +0xa0)`. Two passes over the 12 edges of a box:
  - pass 1: `pos_o` = car `+0x28`, corners = car `+0xb8` (8 corners, 12 bytes each);
  - pass 2: `pos_o` = car `+0x34`, corners = car `+0x124` (8 corners); **hypothesis**: the
    second box is the car's crushed roof part (14.27).

  The corners are in the box order of 14.15 (`c0 (-a, -c, b)`, `c1 (a, -c, b)`, `c2 (-a, c, b)`,
  `c3 (a, c, b)`, `c4 (-a, c, -b)`, `c5 (a, c, -b)`, `c6 (-a, -c, -b)`, `c7 (a, -c, -b)`). Each
  edge carries the outward normals `A` (`0x6cef60`) and `B` (`0x6cef50`) of its two faces, in the
  car's axes. The same table is used in both passes, in this order:

  | # | edge | A | B |
  |---|---|---|---|
  | 1 | c0-c1 | (0, -1, 0) | (0, 0, 1) |
  | 2 | c0-c2 | (0, 0, -1) | (0, 0, 1) |
  | 3 | c0-c6 | (-1, 0, 0) | (0, -1, 0) |
  | 4 | c4-c2 | (0, 1, 0) | (-1, 0, 0) |
  | 5 | c4-c5 | (0, 1, 0) | (0, 0, -1) |
  | 6 | c4-c6 | (-1, 0, 0) | (0, 0, -1) |
  | 7 | c3-c1 | (1, 0, 0) | (0, 0, 1) |
  | 8 | c3-c2 | (0, 1, 0) | (0, 0, 1) |
  | 9 | c3-c5 | (1, 0, 0) | (0, 1, 0) |
  | 10 | c7-c1 | (1, 0, 0) | (0, -1, 0) |
  | 11 | c7-c5 | (1, 0, 0) | (0, 0, -1) |
  | 12 | c7-c6 | (0, -1, 0) | (0, 0, -1) |

  Edge 2 (the front left vertical edge) has `A = (0, 0, -1)` where `(-1, 0, 0)` would be the
  left face; the bytes say `(0, 0, -1)` (checked in the disassembly), so a port copies it.

- **The ramps' `A` and `B` are never set.** Only `0x4a2d80` writes `0x6cef50` and `0x6cef60`, so
  a ramp edge uses whatever the last top-crush edge processed left there, or `(0, 0, 0)` for
  both when no top-crush car has been tested since the program started (they are in zeroed
  memory). With both zero the normal comes out as `(0, 1, 0)` world (14.26.4). No stock SIT has
  a top-crush car (14.27), so in the stock game ramp edges always push straight up; a port keeps
  the last top-crush edge's `A`, `B` as state for levels that have both.

**Per edge**, with world endpoints `W0`, `W1`:

1. **Pretest** (`0x48e9d0`): the distance from `pos_t` to the infinite line through `W0` and
   `W1`, `|(pos_t - W0) x (W1 - W0)| / |W1 - W0|` (999999 when the edge has zero length), must
   be below the truck's radius (`+0xfb8`). Otherwise the edge is skipped.
2. The crossing list `X[0], X[1]` (`0x6f5a00`, 12 bytes each) is cleared to zero.
3. The endpoints go to the truck's body axes: `E0 = M_t^T (W0 - pos_t)` (`0x6ed4e8`) and
   `E1 = M_t^T (W1 - pos_t)` (`0x6f6058`).
4. The edge against the four wheels (`0x494fb0`, 14.26.9).
5. The edge against the hull box (`0x49b190`, below).

#### 14.26.2 Clipping the edge against the hull box (`0x49b190`)

    d = E1 - E0
    L = |d|                    (0x6ee834; 0 if the squared length is negative)
    u = unit(d)                (0x6f6048; (0, 1, 0) when L is 0)
    count = 0                  (0x6ee844)

A **face test** for the plane `axis = c` with bounds on the other two axes is:

    t = (c - E0.axis) / u.axis          (0x6f64bc)
    hit = 0                             (0x6f61a4, cleared before every test)
    if count < 2 and t > 0 and t < L:   (t > 0 is an integer test on the float's bits:
                                         strictly positive, +0 fails)
        H = E0 + t u
        if lo1 < H.a1 < hi1 and lo2 < H.a2 < hi2:   (all strict)
            X[count] = H; count += 1; hit = 1

After each face test the matching **response** runs (it does nothing unless `hit` is 1, and then
works on the point just added, `X[count - 1]`). The faces, in test order:

| # | plane | bounds (strict) | response |
|---|---|---|---|
| 1 | bottom, `y = P1.y` | `P1.x < x < P2.x`, `P11.z < z < P1.z` | `0x497be0` (Y) |
| 2 | top, `y = P3.y` | `P3.x < x < P4.x`, `P10.z < z < P3.z` | `0x497be0` (Y) |
| 3 | front, `z = P1.z` | `P1.x < x < P2.x`, `P1.y < y < P3.y` | `0x496e30` (Z) |
| 4 | rear, `z = P11.z` | `P11.x < x < P12.x`, `P11.y < y < P9.y` | `0x496e30` (Z) |
| 5 | left, `x = P1.x` | `P1.y < y < P3.y`, `P11.z < z < P1.z` | `0x498980` (X) |
| 6 | right, `x = P2.x` | `P2.y < y < P4.y`, `P12.z < z < P2.z` | `0x498980` (X) |

Grouping and gates:

- Faces 1 and 2 are tested only when `u.y != 0`; faces 3 and 4 only when `u.z != 0` **and**
  `count < 2` on arriving there; faces 5 and 6 only when `u.x != 0` and `count < 2` on arriving.
  Inside a group each test also needs `count < 2` (the first test of a group is always reached
  with `count < 2`).
- Face 6's test is the helper `0x4957c0(t, P4.y, P2.y, P2.z, P12.z)`, the same test written out
  (`H = E0 + t u`, bounds `y < P4.y`, `y > P2.y`, `z < P2.z`, `z > P12.z`).
- **At most two crossings** per edge: once two are found every later test fails. A segment with
  both ends inside the box crosses nothing and produces no contact; a segment from outside to
  inside gives one crossing; one passing through gives two. Crossings are only looked for
  between `E0` and `E1` (`0 < t < L`), and the order of the faces decides which two are kept
  when more would qualify (only possible through the bounds being looser than a true box).
- The faces are not one consistent box: each uses its own hull points as listed (for example
  the top face's x bounds come from P3, P4 and its z bounds from P10, P3).

#### 14.26.3 Relative velocity at the crossing (`0x496880`)

Every response starts with this, for the crossing `H = X[count - 1]` (body axes):

    P   = pos_t + M_t H                          (world)
    r   = M_o^T (P - pos_o)                      (the point in the obstacle's axes, 0x6f5118)
    v_o = M_o (vel_o + w_o x r)                  (world; vel_o, w_o as in 14.26.1, obstacle axes)
    v_t = bvel + omega x H                       (body; omega = (q, r, p) = (+0x1038, +0x103c,
                                                   +0x1034), bvel = +0xff8)
    v_rel = M_t^T v_o - v_t                      (0x6ee7d0, body: the obstacle's motion
                                                   relative to the truck)

#### 14.26.4 The responses (`0x497be0`, `0x496e30`, `0x498980`)

The three are the same routine working in the plane of the face that was crossed. Call the two
in-plane axes `a1, a2` and the dropped axis `k`:

| response | faces | k (dropped) | a1 | a2 |
|---|---|---|---|---|
| Y `0x497be0` | bottom, top | y | x | z |
| Z `0x496e30` | front, rear | z | x | y |
| X `0x498980` | left, right | x | y | z |

`flat(v)` below is `v` with its `k` component set to 0.

**Step 1: the normal `n` and the in-plane direction `e`.** With the edge's face normals in world
axes `A_w = M_o A`, `B_w = M_o B` (A, B from 14.26.1) and a steering vector `s` (world), the
**blend** (`0x4966f0`) is

    alpha = max(0, A_w . s),  beta = max(0, B_w . s)       (scratch 0x6f1be0, 0x6f1bdc)
    nraw  = alpha A_w + beta B_w                           (0x6ee7c0)

so the normal leans to the face(s) the steering vector points out of.

- **When `|v_rel|` is exactly 0** (the square root of the squared length, compared with 0):
  the position case,

      s = P - pos_o                          (from the obstacle's origin to the point, world)
      e = unit(flat(M_t^T (pos_o - P)))      (from the point toward the obstacle's origin,
                                               body, in the face plane)
      nraw = blend(s)

- **Otherwise**, the velocity case. The part of `v_rel` along the edge is removed first (and
  `v_rel` is left changed):

      v_perp = v_rel - u (u . v_rel)          (body)
      s = M_t v_perp                          (world)
      nraw = blend(s)
      e = -unit(flat(v_perp))                 (the truck's motion relative to the obstacle,
                                               across the edge, in the face plane)

  and **when `nraw` comes out exactly zero** (neither face faces `s`, or `v_perp` is 0), the
  whole position case above is done instead (its `e` replaces this one).

Then `n = unit(nraw)` (world; `(0, 1, 0)` when `nraw` is zero, which is what both `A` and `B`
being zero gives). Note that when `flat(v_perp)` is zero in the velocity case, `e` is
`-(0, 1, 0) = (0, -1, 0)`, also in the Y response where y was meant to be dropped; this only
survives when `nraw` is not zero.

**Step 2: the depth.** From `H`, the distances to the hull box's sides in the direction `e`, on
the two in-plane axes:

    side x:  (e.x > 0 ? P2.x : P1.x) - H.x
    side y:  (e.y > 0 ? P3.y : P1.y) - H.y
    side z:  (e.z > 0 ? P1.z : P11.z) - H.z

(each `e > 0` is an integer test on the float's bits, so `-0` and `+0` both take the second
choice). These sides are fixed: the Z response uses P1.y and P3.y for the rear face too, the Y
response P1.x, P2.x and P1.z, P11.z for both its faces, the X response P1.y, P3.y and P11.z, P1.z
for both. With `D1`, `D2` the distances on `a1`, `a2`:

    t1 = |D1 / e.a1|,  t2 = |D2 / e.a2|
    t1 <= t2 (or either is NaN):  depth = |n.a1 * D1|
    else:                         depth = |n.a2 * D2|

So the side that a ray from `H` along `e` reaches first gives the penetration, measured along
the normal's component on that axis. A zero `e` component gives an infinite time (or NaN when
the distance is 0 too). The code writes the depth as `(n . (unit a1 vector)) * D1` through a dot
product with the shared zero vector (`0x6f5a18`) plus one bare component; only the bare
component survives, as above. All the "below zero, negate" absolute values compare with float 0
(`0x60f078`, `0x60f060`, `0x60f090`). The depth is never negative.

**Step 3: the contact point and the hull corner.**

    C = H + depth * e                        (body; C.k = H.k since e.k = 0)

The corner (`0x496da0`, integer tests on the float bits of `C`):

| | `C.x <= 0` (left) | `C.x > 0` (right) |
|---|---|---|
| `C.z > 0`, `C.y > 1.0` | 3 | 4 |
| `C.z > 0`, `C.y <= 1.0` | 1 | 2 |
| `C.z <= 0`, `C.y > 1.0` | 9 | 10 |
| `C.z <= 0`, `C.y <= 1.0` | 11 | 12 |

(`C.y > 1.0` is the bit pattern above `0x3f800000`, so top versus bottom splits at 1 ft above
the body origin, not at 0; zero and negative values go left, rear, bottom.)

**Step 4: the write.** With `k` that corner, only when the new depth is strictly deeper:

    if depth > depth[k] (truck +0x808 + 4k):
        point[k]  (truck +0x670 + 12k) = C          (body)
        depth[k]                       = depth
        normal[k] (truck +0x73c + 12k) = n          (world)

Nothing else is written: no truck position, no velocity, no force or moment record (`0x6cef28`,
`0x6f1bd0`, `0x6f64c0`, `0x6ed4d8` are untouched by this system). Two crossings of one edge, other
edges, and other obstacles all compete for the same 12 slots, the deepest winning; so do the
terrain probe and box contacts (14.14).

#### 14.26.5 State carried in globals

- Per edge: `X[0..1]` (cleared by the caller), `count` (reset by `0x49b190`), `u`, `L`, `t`, the
  hit flag (cleared before each face test). A port can keep all of these local to the edge.
- Per caller: `A`, `B` (per edge for cars; **stale for ramps**, 14.26.1), the obstacle's matrix,
  position, velocity and rates, the truck's matrix.
- `v_rel` is overwritten with `v_perp` by the velocity case; nothing reads it afterwards here.
- `0x6f5a18` is read as the zero vector; it sits right after `X[1]`, and the two-crossing limit
  keeps this system from writing it.
- The truck's hull-contact table (`+0x670` points, `+0x808` depths, `+0x73c` normals, slots 1 to
  12) is the only lasting output.

#### 14.26.6 How the contacts take effect

1. **Reset**: at the end of each truck step the contact probe (`0x471d70`, 14.10) copies every
   hull point into its contact point slot (`+0x670 + 12k = Pk`) and sets depths 1 to 12 to -9999.
2. **Pair tests** run after every object has stepped (14.16); this system writes into the table
   then, alongside the boxes (14.14).
3. **Post-step push-out** (`0x476810`, 14.11.2), points 1 to 16 in order: the terrain is probed
   at the stored contact point (`C` for an edge contact). If the terrain is deeper than the
   stored depth it replaces it; otherwise the stored depth `s` and normal `n` stand, the push
   is `s - 0.25 n.y` when `s > 0.25` (or below 0) and else 0, and when neither the push nor
   `s` is negative the truck moves by `push * n` (world) and every stored depth drops by its
   own normal's dot with that move. With `n = (0, 1, 0)` (the ramp case),
   the truck is lifted by `s - 0.25`.
4. **Next step's contact solver** (`0x475960`, 14.12): every slot with depth at least -0.25 is a
   contact at `ipos + M_t C + n * depth` with normal `n`, sharing the support, recovery and
   friction as for terrain contacts. Hull contacts also feed damage (`0x532140`) and sounds.
5. The table is reset again by the next probe, so an edge contact lives for one step unless the
   pair test finds it again.

#### 14.26.7 Constants and helpers

| address | value | use |
|---|---|---|
| `0x60f070`, `0x60f058`, `0x60f088` (double) | 0 | "is zero" tests of `|v_rel|`, `|nraw|`, the flat direction |
| `0x60f078`, `0x60f060`, `0x60f090` (float) | 0 | absolute values in the depth (Y, Z, X) |
| `0x60f030` (double) | 0 | the blend's clamp |
| `0x60db00` (float) | 0 | the length helper `0x468e70` returns 0 below it |
| `0x3f800000` (bit pattern) | 1.0 | top/bottom split of the corner choice |

Helpers: `0x468d50` add, `0x468e10` subtract (first minus second), `0x468db0` scale, `0x468e70`
length (0 when the square is below 0), `0x46ba30` square root (0 for a negative argument, an
integer test on the bits), `0x469250` `M v`, `0x4692f0` `M^T v` (row-major 3 x 3).

#### 14.26.8 Open points

- The meaning of car `+0x34` / `+0x124` (pass 2) as the roof box is a **hypothesis**.
- A twin of this system at `0x49bc90`
  (with responses `0x49a4a0`, `0x499730`, `0x49ab20`, reached only from unreferenced code at
  `0x4946e0`, `0x494b10` and `0x495040`) were not traced.

#### 14.26.9 Edges against the wheels (`0x494fb0`, `0x49df20`, `0x49d630`, `0x49d440`, `0x49c620`)

For one edge, `0x494fb0` runs the wheel test `0x49df20` on each tire in the order **FR, FL, RR,
RL** (tire `+0x4c` with axle `+0x4c`, `+0x160` with axle `+0x4c`, `+0x2bc` with axle `+0x2bc`,
`+0x3d0` with axle `+0x2bc`), before the edge against the hull box (14.26.2). Everything below is read from the code; interpretations are marked.

**Inputs** (globals set by the caller; `0x4b17c0` for a ramp):

| Name | Global | Meaning |
|---|---|---|
| `E0`, `E1` | `0x6ed4e8`, `0x6f6058` | the edge's ends in the truck's body axes, `M_t^T (corner - pos_t)`, formed once per edge **before** any tire runs and not formed again after the truck is moved |
| `M_t` | `0x6f61e0` | the truck's body-to-world matrix (copied from truck `+4` by the pair dispatcher) |
| `M_o` | `0x6f58b0` | the other object's (ramp's) body-to-world matrix |
| `pos_o` | `0x6f5148` | the other object's position (ramp `+0x28`) |
| `v_o` | `0x6ceee8` | the other object's velocity (ramp `+0x78`), used as if in its own axes |
| `omega_o` | `(0x6cef78, 0x6cef7c, 0x6cef80)` on `(x, y, z)` | its rates: ramp `(+0x88, +0x8c, +0x84)`; zero for stock ramps |
| `m_eff` | `0x6f1bf0` | the effective mass **left by the last pair that set it** (see "Stale state") |
| `mover` | `0x6f5168` | 1 = "the other object moves", 2 = "the truck moves", left by the last pair that set it |
| `dt` | `0x6f1bc8` | the substep |

Truck: `pos_t` (`+0xfe0`), `bvel` (`+0xff8`), `omega_t = (q, r, p) = (+0x1038, +0x103c, +0x1034)`.
Tire: hub `c` (`+0xc`, body, the current hub with articulation and travel, 14.2), static anchor
`A` (`+0x30`, body), radius `r` (`+0x6c`), bounding radius `rho` (`+0x70`), width `w` (`+0x74`),
penetration `pen` (`+0x94`), lever (`+0x98`), ground normal (`+0xac`, world), `on_gnd` (`+4`).
Axle: `cos a` (`+0x22c`), `sin a` (`+0x230`). **The steer angle is not used**: the wheel's axis is
the articulated body x axis for front and rear tires alike.

Helpers used throughout:

    unit(v)      = v / |v|, or (0, 1, 0) when |v| is 0              (0x4797a0)
    pv(v, w, R)  = v + w x R                                        (0x48d6c0: the call passes the
                                                                     rates as (z, x, y) components)
    lineDist(P1, P2, Q) = |(P2 - P1) x (Q - P1)| / |P2 - P1|, 999999 when |P2 - P1| is 0   (0x48e9d0)
    abs(x)       = -x when x is negative (the code tests the sign bit, so -0 stays -0)

Each tire then goes through two independent tests, A and B, in that order.

##### A. The edge as ground for the wheel (`0x49d630`)

Runs first, **only when `m_eff >= 1.0`** (the code compares the float's bits as a signed integer
with `0x3f800000`, so any negative `m_eff` also skips it). This is a suspension test against the
wheel at its **static anchor** with an **unarticulated** axle `D = (1, 0, 0)`:

    F+ = A + (w/2, 0, 0),  F- = A - (w/2, 0, 0)
    d  = E1 - E0;  L = sqrt(|d|^2)  (0 when the sum is negative);  u = unit(d)
    D  = unit(F+ - F-)                       ((1, 0, 0) for w > 0, (0, 1, 0) for w = 0)
    stop unless |u.y| < 0.866                (the edge is less than 60 deg from the body's x-z plane)
    t  = u . (A - E0)
    stop unless -w < t < w + L               (the full width, not w/2; both strict)
    P  = E0 + t u                            (the foot of the anchor on the edge's line)
    q  = P - A;  k = q . D;  rad = q - k D
    Pw = pos_t + M_t P                       (world; also R = M_o^T (Pw - pos_o) is formed, unused)
    stop unless |k| < w/2                    (strict)
    stop unless |rad|^2 <= r^2
    s   = rad.y                              (see note 1)
    hz  = |(rad.x, 0, rad.z)|
    pen_e = sqrt(r^2 - hz^2) + s             (the sqrt term is 0 when r^2 - hz^2 < 0)
    stop unless pen_e > pen                  (strict, against the tire's stored +0x94)

On a hit the tire's ground contact is written, as the wheel probe (`0x47bfa0`, 14.11.3) would:

    +0x94 (pen)    = pen_e
    +0x04 (on_gnd) = +1 when q . D > 0, else -1           (written as an integer)
    +0xac (normal) = groundNormal(Pw.x, Pw.z)            (0x550460, below)
    +0x98 (lever)  = sqrt(r^2 + (A.x + k)^2)             (0 when the sum is negative)

`pen_e` is how far the edge point stands above the bottom of the wheel circle at the same body z
(the wheel circle lies across `D`, so `rad.x` is 0 up to rounding): a penetration along the
truck's y, exactly like the probe's. Unlike the probe, the normal and `on_gnd` are written even
when `pen_e` is not positive.

**`groundNormal(x, z)`** (`0x550460`) is not the edge's normal and not `0x550380`: it walks the
frame's object list in order; the first **box** (kind 1) whose footprint holds `(x, z)` (centre
`+0x4c`, `+0x54`; within its radius `+0x74` on both axes, then, turned by its `sin`, `cos`
(`+0x224`, `+0x228`), within half of `+0x68` across and half of `+0x64` along) gives
`(0, 1, 0)`; the first **ramp** (kind 2) whose footprint holds it (centre `+0x28`, `+0x30`,
radius `+0x50`, turned by `+0xe4`, `+0xe8`, half of `+0x44` and of `+0x40`) gives the ramp's slope
normal (`+0xf8`); otherwise the terrain normal (2.2) at `(x, z)`. So a ramp edge's ground normal
is normally the slope's own normal, or the terrain's just past the ramp.

How it is consumed: the post-step (14.11) leaves a positive `pen` and the written normal,
`on_gnd` and lever in place (`0x476b80` clears `on_gnd` only when `pen` is negative), the terrain
probe replaces them only when deeper (`0x47bfa0`), and the axle solver (`0x47fa20`) raises the
axle and lifts the truck from `pen` like any terrain penetration. The tire force step of the next
substep (14.3 to 14.6) then uses that compression and normal. **So test A makes the edge
ground for the wheel through the ordinary suspension path; it moves nothing and writes no
force.**

##### B. The edge against the tire's side and tread (`0x49df20`)

Runs only when the tire's `pen` (`+0x94`) is **exactly -9999.0** (bit pattern `0xc61c3c00`):
contact probing (`0x471d70`, 14.10) resets it to that at the end of each truck step, so this test
only sees wheels that nothing (a box's suspension test, test A of this or an earlier edge) has
given a ground contact since. Test B itself never writes `pen`, so every later edge and tire can
run it too.

    stop unless lineDist(E0, E1, c) < rho          (the hub against the edge's infinite line)
    h  = (w/2) (cos a, sin a, 0)
    F+ = c + h,  F- = c - h                        (the two face centres)
    d  = E1 - E0;  L = sqrt(|d|^2);  u = unit(d)   ((0, 1, 0) when |d| is 0)
    D  = unit(F+ - F-)                             (the articulated axle, (cos a, sin a, 0))

**Cap hits** (`0x49d440`, for `F+` then `F-`), counted in `n` (`0x6ee844`, set to 0 first):

    tc = abs(D . (F - E0)) / abs(u . D)             (both made absolute: see note 2)
    X  = E0 + tc u
    |X - F|^2 < r^2 (strict):  n += 1, X stored    (0x6f5a00, then 0x6f5a0c; nothing here reads them)

When `u . D` is 0 the division gives an infinite or undefined `tc` and the comparison fails (no
hit). Then:

    rel = c - E0;  t = u . rel
    stop unless n < 2 and t > 0 and t < L          (t > 0 is an integer test of the float bits)
    P   = E0 + t u                                 (the foot of the hub on the edge segment)
    q   = P - c;  k = q . D;  rad = q - k D        (axial offset and radial vector of P)
    Pw  = pos_t + M_t P;  R = M_o^T (Pw - pos_o)   (P in the other object's axes, 0x6f5118)

Relative velocity, in the truck's axes:

    vo    = M_t^T (M_o pv(v_o, omega_o, R))         (the other object's point velocity)
    vt    = pv(bvel, omega_t, P)
    vrel  = vt - vo                                 (the truck relative to the edge)
    vperp = vrel - (u . vrel) u                     (0x6ee7d0: across the edge)
    vD    = vperp . D

Depths (with `hw = w / 2`):

    uperp = u - (u . D) D                           (the edge direction across the axle)
    Cm    = P - k D                                 (= c + rad, P moved into the wheel's mid-plane)
    delta = lineDist(Cm, Cm + uperp, c)             (hub to the edge projected into the mid-plane)
    s     = sqrt(delta^2 - r^2) when delta >= r, else sqrt(r^2 - delta^2)   (0 when negative)
    f     = q . uperp
    if k / vD >= 0:   kk = hw - abs(k);  s = s - abs(f)
    else:             kk = hw + abs(k);  s = s + abs(f)       (also when k / vD is undefined, 0 / 0)
    g     = abs(u . uperp)                          (= 1 - (u . D)^2; see note 3)
    s     = s / g
    kk    = kk + abs(s (u . D))
    stop unless abs(kk - hw) <= hw                  (an undefined value stops)
    stop unless |rad|^2 <= r^2

`k / vD` with `vD = 0` is an infinity (sign of `k`) or undefined (`k = 0`); `+inf` takes the first
branch, `-inf` and undefined the second. With `g = 0` (edge parallel to the axle) `s` becomes
infinite or undefined and the test `abs(kk - hw) <= hw` fails.

The contact (`n` is set to 2, which has no further effect):

    vrad  = vperp - D vD                            (0x6ee868)
    dR    = r - |rad|                               (radial depth)
    tR    = dR / |vrad|                             (may be infinite or undefined)
    N     = unit(vperp)
    if kk / abs(vD) > tR:      radial:  depth = dR / (unit(rad) . N)
    else:                      axial:   depth = kk / abs(N . D)
                               (the "else" includes equality and any undefined comparison)

In both cases the push direction is the **relative velocity across the edge**, not the face or
radial normal; only the depth is chosen by which way out (`kk` along the axle, `dR` across it)
the motion reaches first. The radial depth can come out negative when `unit(rad) . N < 0`.

##### The response (`0x49c620`)

    n    = -N                                       (against the truck's motion across the edge)
    C    = P - n depth                              (the contact point, body, 0x6f5fa0)
    move = M_t (n (depth + 0.2))                    (world; 0.2 is the float at 0x60f118)

- When `mover` is **not 1** (2, or 0 before any pair set it): the **truck moves**,
  `pos_t += move`, and every one of the 16 contact points' stored depths drops by its own normal's
  share, `depth_j (+0x80c + 4j) -= n_j (+0x748 + 12j) . move`, j = 0..15 (water depths are not
  touched, unlike the post-step push-out).
- When `mover` is 1: with `O` the pair's owner (the object listed first, `0x6f5164`) and `P2` its
  partner (`0x6cef74`), the object `0x6f6074` moves by `-move` (its `+0x4c` position) and plays its
  crash sound (`0x428bc0`) only when `O` is a box, or `O` is a truck and `P2` a box. **In a ramp
  pair neither holds, so with `mover` = 1 nothing moves at all.**

Then the force record (globals, each contact overwriting the last):

    F     = |vperp| / dt * m_eff                    (|vperp| is 0 when its square is negative)
    f     = F n                                     (truck force, body axes, 0x6cef28)
    Mt    = C x f                                   (truck moment, 0x6f1bd0)
    fo    = M_o^T (M_t (-f))                        (other's force, its axes, 0x6f64c0)
    Mo    = R x fo                                  (other's moment, 0x6ed4d8)

**For a ramp these are thrown away**: the ramp case of the pair dispatcher (`0x489f90`) adds no
pair forces, `0x4b17c0` zeroes the other's force and moment when it returns, and the frame loop
(`0x46c0e0`) zeroes all four after every pair. So against a ramp edge test B only moves the
truck (or nothing). For a top-crush car the dispatcher does add the record to both bodies'
accumulators (truck `+0xfbc`, `+0xfc8`; car `+0x6c`, `+0x78`), so the last contact of the pair
counts there (**hypothesis**: `0x4a2d80` itself was not traced to see whether a later step
overwrites it).

##### State carried between calls

- `E0`, `E1` stay as the caller formed them. When test B moves the truck, later tires of the same
  edge still use the old body-axes ends, while `Pw` (and so `R` and the ground normal of test A)
  uses the moved `pos_t`.
- `pen` (`+0x94`): written by test A, read by both tests of every later edge and tire. The first
  test A hit on a tire switches test B off for that tire for the rest of the substep, and only a
  deeper edge point replaces the stored one.
- `m_eff` (`0x6f1bf0`) and `mover` (`0x6f5168`) are **never set by the ramp pair**. They hold
  whatever the last pair that set them left, in this substep or an earlier frame: a truck against a
  box or top-crush car sets both (`mover` 1 with the lighter object's mass, raised to 1.0 in the
  truck-first orders, when that object's mass is non-zero and below the truck's; else 2 with the
  truck's mass `W / 32.174`), the truck-against-truck
  responses (`0x48eb70`, `0x491e20`, `0x48f6f0`) and `0x493410` set `m_eff` only. Both start at 0.
  The port must keep both as state across pairs and frames to match, because they decide whether
  test A runs (`m_eff >= 1`) and whether test B moves the truck (`mover != 1`). Ground boxes make
  a truck-box pair with an immovable box, which leaves `m_eff = W / 32.174` and `mover = 2`, so on
  most tracks test A runs and test B moves the truck (**hypothesis** about typical play, not
  measured).
- Every other global these routines write (`0x6ed4c8`, `0x6f5f88`, `0x6f6048`, `0x6f6044`,
  `0x6f6178`, `0x6f61c0`, `0x6cef84`, `0x6f5f9c`, `0x6f1bcc`, `0x6ee7d0`, `0x6f5118`, the cap
  points at `0x6f5a00`) is formed again before it is read in the next call; `0x49b190`, which
  runs after the four tires for the same edge, forms its own direction and count.

##### Notes on the code

1. Test A forms `s` as a dot product of `rad` with `(Z.x, 1, Z.z)`, `Z` the shared zero vector
   `0x6f5a18`, and the horizontal part as `rad - s (Z.x, 1, Z.z)`; with `Z` zero that is `rad.y`
   and `(rad.x, 0, rad.z)`. The cap points of test B (at most two, `0x6f5a00` to `0x6f5a17`) never
   reach `0x6f5a18`, and the caller resets them to zero before each edge.
2. The cap test takes the absolute value of both `D . (F - E0)` and `u . D`, so `tc` is never
   negative: when the plane lies behind `E0` along `u` the point tested is the mirror image
   `E0 + |tc| u`, not the true crossing. It is only used to count, and only the count (`n < 2`)
   matters.
3. `g` is compared with the float at `0x60f1a8`, which is 0.0 (the low half of the double 1/128
   stored there), so it is a plain absolute value; it is never negative anyway.
4. Constants: 0.5 (`0x60f198`, `0x60f160`, doubles), 0.866 (`0x60f170`, double), 0.2
   (`0x60f118`, float), zero thresholds (`0x60f158`, `0x60f1a0`, `0x60f178`, `0x60f120`,
   `0x60e370`, `0x60ee38`, `0x60db00`).
5. **Hypothesis** on intent: test B is a side and tread collision of a cylinder with a line
   segment; the time comparison picks the shorter way out (along the axle or across it) for the
   current closing motion, and the push always goes back along that motion by the matching depth
   plus 0.2 ft. The quantities `f`, `s` and `g` do not reduce to a clean geometric construction
   (with `P` the foot of the hub, `f = -k (u . D)`); port them as written.

### 14.27 Top-crush cars (`0x551660`, `0x54a000`, `0x4a58b0`, `0x4a2d80`, `0x4aa9b0`, `0x4aab50`, `0x54ec00`)

A top-crush car is sim kind 5, from the SIT's `*** Top Crush ***` section (table `0xa30338`,
0x2b8 bytes each, count `0xa35428`). **No stock SIT has one**: all 15 stock SITs give a count of
0. Every record is two boxes sharing one rotation: the **body** (`ipos`, `modelName`) and the
**cab** (`ipos2`, `cabModelName`). Only the cab can be flattened; only trucks touch either part.

#### 14.27.1 The SIT record (`0x551660`) and the in-memory layout

The loader (inside `0x551f90`) reads the section after `*** Cylinders ***`: a label line, the
count (`%d`, no upper bound is checked; the table has room for 29 records before it runs into
other globals), then each record with `0x551660`, and stores the record's index at `+0x2b4`.
Each record, line by line (label lines are skipped unread):

    *******************         (delimiter)
    ipos                        x, y, z            -> +0x28 +0x2c +0x30   (feet, world)
    ipos2                       x, y, z            -> +0x34 +0x38 +0x3c
    theta,phi,psi               three floats       -> +0x40 +0x44 +0x48
    then EITHER
      modelName                 %s                 -> +0x28c (16 bytes)
      cabModelName              %s                 -> +0x29c (16 bytes)
    OR (any other label on that line)
      length,width,height       three floats       -> +0x4c +0x50 +0x54   (body; +0x28c := 0)
      length2,width2,height2    three floats       -> +0x58 +0x5c +0x60   (cab)
    mass                        %f                 -> +0x64   (slugs as written)
    bvel                        x, y, z            -> +0x94
    p,q,r                       three floats       -> +0xa0 +0xa4 +0xa8

The first label must be exactly `modelName` to take the model form. `+0x2ac` is set to 0. (The
writer `0x5518f0` prints the two model-name lines without passing the names, so a SIT saved by
the engine loses them; irrelevant for reading.)

In-memory fields used below (offsets from the record start):

| Offset | Meaning |
|---|---|
| `+0x00` | word never written by any code found (stays 0, **hypothesis**); gates replay recording and the broadphase "first object" role |
| `+0x04`..`+0x24` | rotation matrix `M` (row-major 3x3, body to world), shared by body and cab |
| `+0x28` | body centre `P_b` (world) |
| `+0x34` | cab centre `P_c` (world; its y is recomputed, below) |
| `+0x40` | theta, phi, psi |
| `+0x4c`, `+0x50`, `+0x54` | body length (z), width (x), height (y), full sizes |
| `+0x58`, `+0x5c`, `+0x60` | cab length2 (z), width2 (x), height2 (y), full sizes |
| `+0x64` | mass |
| `+0x68` | bounding radius |
| `+0x6c`, `+0x78` | force and moment accumulators (written by the pair, never read) |
| `+0x84` | crush fraction `f` (0 = intact), drives the cab animation |
| `+0x94`, `+0xa0` | bvel and p, q, r from the SIT (never integrated) |
| `+0xb8`..`+0x114` | 8 body corners (car axes, relative to `P_b`) |
| `+0x124`..`+0x180` | 8 cab corners (car axes, relative to the cab centre) |
| `+0x284`, `+0x288` | sin psi, cos psi |
| `+0x28c`, `+0x29c` | body and cab model names |
| `+0x2ac` | "do not draw" word, 0 at load, nothing found that sets it |
| `+0x2b0` | listed this frame |
| `+0x2b4` | index in the table |

#### 14.27.2 Setup (`0x54a000`, once per record at load)

1. A strictly negative `ipos.x`, `ipos.z`, `ipos2.x` or `ipos2.z` gets 8192 added (each one
   separately; `-0` is left alone).
2. **A model replaces that part's sizes** with its vertex bounds (`0x450ae0`, min and max x, y, z,
   in 1/256 ft, times 1/256): body model: width `+0x50` = x extent, length `+0x4c` = z extent,
   height `+0x54` = y extent; cab model the same into `+0x5c`, `+0x58`, `+0x60`. For a keyframed
   cab model (opcode 0x20, see 14.27.6) `0x450ae0` loads one of its frame models and measures that
   (**hypothesis**: the first frame).
3. Half extents: body `a = width / 2` (x), `c = height / 2` (y), `b = length / 2` (z); cab
   `a2`, `c2`, `b2` likewise from the cab sizes.
4. Corners, in the box order of 14.15, body at `+0xb8` (three floats each) and cab at `+0x124`:

        k:  0           1          2          3          4           5          6            7
           (-a,-c, b)  (a,-c, b)  (-a, c, b)  (a, c, b)  (-a, c,-b)  (a, c,-b)  (-a,-c,-b)  (a,-c,-b)

   So the body **top** is `y = +0xd4` (corner 2's y, equal to corners 3, 4, 5: `+0xe0`, `+0xec`,
   `+0xf8`), the body bottom `+0xbc`; the cab top `+0x140` (= `+0x14c`, `+0x158`, `+0x164`) and
   the cab bottom `+0x128`. These eight cab-top values are the only geometry that ever changes.
5. `sin psi`, `cos psi` into `+0x284`, `+0x288`.
6. Bounding radius, from **full** sizes and mixing the parts:

        R = sqrt(height2^2 + length^2 + width^2)          -> +0x68

7. Rotation: identity when theta, phi and psi are all exactly 0, otherwise the truck's Euler
   matrix (`0x468a90`) from theta, phi, psi, into `+0x04`.
8. **The cab stands on the body's bottom**: the SIT's `ipos2.y` is replaced by

        P_c.y = P_b.y - height / 2 + height2 / 2

   (`ipos2.x` and `ipos2.z` are kept).

**Mass and motion**: the car is never stepped. The frame loop's kind-5 step (`0x46c0e0`,
`0x46c770`) only sets the current-object pointer `0x6f5fb4`; no gravity, no integration, no
post-step. `bvel` and `p, q, r` are never applied to the position, but they are handed to the
edge routines as the car's velocity and rates (14.27.4), so a non-zero SIT `bvel` would make
those contacts see a moving car that stays put. The mass only decides the pair's mass class.

#### 14.27.3 Listing (`0x553790`, `0x5543c0`)

- At load (`0x553790`) every car is appended to the object list as kind 5 (limit 550 entries,
  "Too many sims!").
- Every frame (`0x5543c0`) the list is rebuilt. All `+0x2b0` words are cleared first. Cars are
  considered **after** trucks, always-listed ramps, boxes and the ramp pass, and each unlisted car
  joins (once, `+0x2b0 := 1`) when some object among the first `n` list entries lies within

        |x_obj - P_b.x| < r_obj + R + 10    and    |z_obj - P_b.z| < r_obj + R + 10

  with `n` the list length **before the ramp pass** (so ramps listed in that pass, and other
  cars, never bring a car in), `r_obj` the object's bounding radius (box `+0x74` at `+0x4c`,
  ramp `+0x50` at `+0x28`, truck `+0xfb8` at `+0xfe0`) and `R` the car's `+0x68`. There is no
  speed rule and no detail-level rule for cars.

#### 14.27.4 The pair with a truck (`0x488d90`, `0x489f90`)

**Broadphase**: as 14.17, bounding spheres `|P_truck - P_b| < R_truck + R`. As the first object
of a pair a kind-5 entry needs `+0x00 != 0`, which never holds, so the pair is always stored
under the truck (trucks are listed first). **Only truck and car pairs do anything**: the
dispatcher has no case for car against box, ramp or car. Cars are also absent from the height
query (`0x54feb0`), the ground normal (`0x550460`) and the terrain probes, so the pair test is the
only way anything touches a car.

**Pair setup** (`0x489f90`, case "partner kind 5, owner kind 4"; the mirrored case is identical
and unreachable): `0x6ceebc` = truck, `0x6f5fb4` = car, `0x6f58b0` = car `M`, `0x6f61e0` =
truck `M_t`. Mass class and effective mass, with `M_t_mass` the truck's mass as for boxes
(`(+0x5a0 + +0x51c + +0x1040 + +0x2ac) * 0.031081`, 14.17):

    class 2 (immovable), m_eff = M_t_mass
    if 0 != m_car < M_t_mass:  class 1 (pushable), m_eff = max(m_car, 1)

stored in `0x6f5168` and `0x6f1bf0`. The class matters only inside the edge routines (the hull
point and wheel tests below write ground contacts whatever the class). Then, in order:

1. `0x4a58b0`: hull points 1 to 12 (body box then cab box for each), then the four wheels
   (body then cab for each).
2. `0x4a2d80`: the 12 body edges, then the 12 cab edges.
3. The pair's force and moment globals are added once, as for boxes (14.17, last contact wins):
   truck `+0xfbc` (from `0x6cef28`), `+0xfc8` (from `0x6f1bd0`); car `+0x6c` (from `0x6f64c0`),
   `+0x78` (from `0x6ed4d8`). The car's accumulators are never consumed or cleared.

There is no early-out test (unlike boxes' `0x49f520`).

##### Hull points (`0x4a58b0` with `0x4ac490` body, `0x4ad330` cab)

With `d = P_truck - P_b` (world), `v` the truck's world velocity (`+0xfec`) and `dt` the
sub-step (`0x6f1bc8`), the ray reference is

    Rf = M^T (d - v dt)                      (car axes; no car velocity, no hull-point-3 lift)

and for hull point `i` = 1..12 (body point `p_i` at truck `+0x5a4 + 12 i`):

    Q_i = M^T (d + M_t p_i)                  (car axes, relative to P_b)

`u = unit(Q_i - Rf)` (zero length gives `(0, 1, 0)`). The **same `Rf` and `Q_i` are used for the
cab box**: the cab test is centred on `P_b`, not on `P_c` (a quirk, kept: its box sits
`(height2 - height) / 2` lower, and offset in x and z by `ipos2 - ipos`, compared with where the
cab is drawn and where its edges and wheels are tested).

Face test, for the body with its corners (cab: the same with the cab corners). Faces are tried in
this order; a face's hit is `Rf + t u` with `t = (plane - Rf_axis) / u_axis`, counted when it
lies strictly inside the face's two other ranges; at most two faces are counted (a face is only
looked at while the count is below 2; a group is skipped when `u` has 0 on its axis):

| Face | Plane | Hit ranges | Accept also needs | Outward n | Depth |
|---|---|---|---|---|---|
| bottom | `y = +0xbc` | x in (`+0xb8`, `+0xc4`), z in (`+0x108`, `+0xc0`) | `t > 0`, `u_y > 0`, `|t| < 999999` | (0,-1,0) | `Q.y - bottom` |
| top | `y = +0xd4` | x in (`+0xd0`, `+0xdc`), z in (`+0xf0`, `+0xd8`) | `t > 0`, `u_y < 0`, `|t| <= best` | (0,1,0) | `top - Q.y` |
| front | `z = +0xc0` | x in (`+0xb8`, `+0xc4`), y in (`+0xbc`, `+0xd4`) | `t > 0`, `u_z < 0`, `|t| <= best` | (0,0,1) | `b - Q.z` |
| back | `z = +0x108` | x in (`+0x100`, `+0x10c`), y in (`+0x104`, `+0xec`) | `t > 0`, `u_z > 0`, `|t| <= best` | (0,0,-1) | `Q.z + b` |
| left | `x = +0xb8` | y in (`+0xbc`, `+0xd4`), z in (`+0x108`, `+0xc0`) | `t > 0`, `u_x > 0`, `|t| <= best` | (-1,0,0) | `Q.x + a` |
| right | `x = +0xc4` | y in (`+0xc8`, `+0xe0`), z in (`+0x114`, `+0xcc`) | `t > 0`, `u_x < 0`, `|t| <= best` | (1,0,0) | `a - Q.x` |

(`best` starts at 999999 and becomes `|t|` of each accepted face; later faces win ties. Cab
offsets: `+0x124`/`+0x128`/`+0x12c` for corner 0 and so on, 0x6c higher than the body's.)
No accepted face gives depth -9999. Then, when `depth > stored` (truck `+0x808 + 4 i`):

- if the race-rules checkpoint mode is on (`0x6f60bc` = 1, 14.24) nothing is stored (only the
  back-face record `0x6f5edc` of that mode is updated);
- otherwise, **if the winning face is the top** the crush rule runs (body: `0x4aa9b0`, cab:
  `0x4aab50`, 14.27.5) and may lower `depth`; then `depth` is stored at `+0x808 + 4 i` and the
  world outward normal `M n` at `+0x73c + 12 i`. Nothing else (no contact point, no on-ground
  word), exactly like a box's ground contact (14.14 step 2).

The body test runs before the cab test for the same point, so the cab sees the body's result as
its stored depth.

##### Wheels (`0x4a58b0` with `0x4b6350` body, `0x4b9d20` cab)

For contact index `k` = 13, 14, 15, 16 the axle `0x6cef1c` and tire `0x6f602c` are truck `+0x4c`
with tires `+0x4c` and `+0x160`, then `+0x2bc` with `+0x2bc` and `+0x3d0`; the side `s`
(`0x6f5134`) is -1, +1, -1, +1. For each wheel: body (`0x4b6350`) then cab (`0x4b9d20`). Each
one first runs the **suspension test** (`0x4b46f0` body, `0x4b80c0` cab; skipped in checkpoint
mode), then the **tire contact point test**. Below, `C` is the part's centre (`P_b` for the
body, `P_c` for the cab: unlike the hull points, both wheel tests use the cab's own centre) and
the corner offsets are the part's own. With `r` = tire `+0x6c`, `w` = tire `+0x74`, the hub
body position `h` = tire `+0x0c`, the static anchor `A` = tire `+0x30`, the tire's world point
`S` = tire `+0x24` (read in 14.17 as the hub's position at the last step) and its world offset
`H` = tire `+0x18`.

**Suspension** (`0x4b46f0`):

    Wb  = P_truck + M_t (A - (0, r, 0))                (wheel bottom at its anchor, world)
    u   = unit(M^T (Wb - S))                           (zero gives (0, 1, 0))
    o   = M_t (cA r + sA s w/2,  cA s w/2 - sA r,  0)  with cA = axle +0x230, sA = axle +0x22c
    Rf  = M^T (S - C + o)

Faces in the order left (`x = -a`), right, bottom, top, front (`z = +b`), back, each counted
when its hit `Rf + t u` lies strictly inside the face's ranges (same ranges as the hull table),
at most two counted, a group skipped when `u` has 0 on its axis. **No `t > 0` and no direction
test.** A counted face wins when `|t| <= best`; on winning, the part's **inward** axis normal
`n_in` (left +x, right -x, bottom +y, top -y, front -z, back +z) is kept only when its truck-axis
y, `|(M_t^T M n_in).y|`, is above 0.5, otherwise the winner carries a zero normal. Afterwards,
with `n_t = M_t^T M n_in`: only when `n_t.y < -0.5` (the face's outward normal points up for the
truck, a roof under the wheel) does the apply step (`0x4b4110` body, `0x4b7ae0` cab) run:

    (cy, cz) = unit(n_t.y, n_t.z)                      ((1, 0) when zero)
    Pc   = (A.x + s w/2,  A.y + r cy,  A.z + r cz)     (truck body)
    Q    = M^T (P_truck + M_t Pc - C)
    d    = depth of Q inside the face of n_in (as the "Depth" column: e.g. top - Q.y)
    pen  = -d / n_t.y                                  (penetration along truck y)

When `pen > ` tire `+0x94`:

- if `pen > 0`: the crush rule runs with `pen` as the depth (14.27.5) and may lower `pen`; the
  tire's ground normal (`+0xac`) becomes the outward world normal `-M n_in`, and the tire's
  on-ground word `+0x04` becomes `trunc(s)`, that is **-1 for tires 13 and 15, +1 for 14 and 16**
  (non-zero either way);
- otherwise `0x6f1bc0` is cleared;
- in both cases tire `+0x94 = pen` and the lever `+0x98 = sqrt(r^2 + (A.x + s w/2)^2)`.

**Tire contact point** (body `0x4b6350`, cab `0x4b9d20`, contact index `k`):

    Rf = M^T (S - C)
    u  = unit(M^T (P_truck + H - S))                   (zero gives (0, 1, 0))

Faces in the order left, right, bottom, top, front, back, the same counting rules; the first
(left) needs `|t| < 999999`, the others `|t| <= best`; **no `t > 0` or direction test**. The
winner's inward normal `n_in` (as above, no `|y|` filter) is kept; no counted face: nothing.
Then, with `n_w = M n_in` and `n_t = M_t^T n_w`:

    a1 = atan2(-n_t.z, -n_t.y),   a2 = atan2(-n_t.x, -n_t.y)
         (atan2(0, x) is 0 for x >= +0 and pi otherwise; atan2(y, 0) is +-pi/2 by the sign of y)
    K  = r * max(|sin a1|, |sin a2|)
    sx = +1 when n_t.x > 0 (strictly), else -1
    (ey, ez) = unit(n_t.y, n_t.z)                      ((1, 0) when zero)
    Pt = h + (w sx / 2,  K ey,  K ez)                  (truck body)
    Q  = M^T (P_truck + M_t Pt - C)
    depth = depth of Q inside the face of n_in

When `depth > ` truck `+0x808 + 4 k` (and not in checkpoint mode): if the face is the **top**
(`n_in.y = -1`) the crush rule runs; then the (possibly lowered) depth goes to `+0x808 + 4 k`,
the outward world normal `-n_w` to `+0x73c + 12 k`, and `Pt` to `+0x5a4 + 12 k`. This is the
box tire-contact-point test of 14.14 with the car as the box.

##### Edges (`0x4a2d80`)

The car is tested edge by edge against the truck. First the body: `0x6f5148 := P_b`,
`0x6ceee8 := bvel (+0x94)`, `0x6cef78, 0x6cef7c, 0x6cef80 := +0xa4, +0xa8, +0xa0` (the rates in
the same rotated order the box pair uses), world corners `W_k = P_b + M c_k` for the 8 body
corners. Then the 12 edges below. Then the cab the same way with `0x6f5148 := P_c` and
`W_k = P_c + M c2_k` (cab corners, so the edges do follow the crushed roof).

| # | Edge `A - B` | n1 (`0x6cef50`) | n2 (`0x6cef60`) |
|---|---|---|---|
| 1 | W0 - W1 | (0,0,1) | (0,-1,0) |
| 2 | W0 - W2 | (0,0,1) | **(0,0,-1)** (the code's value; the geometric one would be (-1,0,0)) |
| 3 | W0 - W6 | (0,-1,0) | (-1,0,0) |
| 4 | W4 - W2 | (-1,0,0) | (0,1,0) |
| 5 | W4 - W5 | (0,0,-1) | (0,1,0) |
| 6 | W4 - W6 | (0,0,-1) | (-1,0,0) |
| 7 | W3 - W1 | (0,0,1) | (1,0,0) |
| 8 | W3 - W2 | (0,0,1) | (0,1,0) |
| 9 | W3 - W5 | (0,1,0) | (1,0,0) |
| 10 | W7 - W1 | (0,-1,0) | (1,0,0) |
| 11 | W7 - W5 | (0,0,-1) | (1,0,0) |
| 12 | W7 - W6 | (0,0,-1) | (0,-1,0) |

`A` goes to `0x6f1bf8`, `B` to `0x6f1870`; n1 and n2 are the two face normals in car axes (as
given, unrotated). For each edge, when the distance from the truck's centre to the **infinite
line** through `A` and `B` (`0x48e9d0`: `|(P_truck - A) x (B - A)| / |B - A|`, 999999 when
`A = B`) is below the truck's radius `+0xfb8`:

    clear 0x6f5a00..0x6f5a14 (two vectors)
    0x6ed4e8 := M_t^T (A - P_truck)          (edge start, truck axes)
    0x6f6058 := M_t^T (B - P_truck)          (edge end, truck axes)
    0x49df20 four times: (axle, tire) = (+0x4c, +0x4c), (+0x4c, +0x160), (+0x2bc, +0x2bc), (+0x2bc, +0x3d0)
    0x49b190 once (edge against the hull box)

(`0x495290` does exactly this; some cab edges, 2, 4, 5, 7, 9, 11, 12, inline it as
`0x494fb0` + `0x49b190`, with the same effect.) The other inputs those routines read are the
pair globals above: car and truck rotations, the class `0x6f5168`, `m_eff` `0x6f1bf0`, the car
centre `0x6f5148`, velocity `0x6ceee8` and rates `0x6cef78`. The hull-contact entries "at the
hull corner nearest the contact, chosen by octant (`0x496da0`)" that section 7.6 describes come
from inside `0x49b190`; both are in 14.26. The
crush rule is never called from the edge routines.

#### 14.27.5 The crush rule (`0x4aa9b0` body, `0x4aab50` cab)

Input: the current contact's depth `D` (`0x6f5fb8`: a hull point's or tire point's depth inside
the top face, or a wheel's `pen`). Both routines start the same way:

    if D <= 0.25: return
    E = D - 0.25 - 0.375                      (so D must exceed 0.625 ft)
    if E <= 0: return
    e = 0.15 E

**Body** (`0x4aa9b0`): `e = min(e, top - 0.5 height)` with `top = +0xd4` and `height = +0x54`.
The top starts at exactly `height / 2` and nothing raises it, so the limit is 0 and **the body
never crushes** (the routine returns at its `e > 0` check). For completeness, when `e > 0` it
would lower the body top and the cab top together by `e` and then do what the cab version does.

**Cab** (`0x4aab50`):

    n     = groundNormal(P_b.x, P_b.z)              (0x550460, below)
    L     = (top_body - P_c.y + P_b.y + 0.25) / n.y  (lowest allowed cab top, cab axes)
    if top_cab - e < L:  e = top_cab - L
    if e <= 0: return
    top_cab -= e      (+0x140, and +0x14c, +0x158, +0x164 copied from it)
    D       -= e
    f = 1 - (top_cab - bottom_cab) / height2        -> +0x84   (bottom_cab = +0x128)
    truck +0x80c .. +0x848 (the 16 contact depths, indices 1 to 16) -= e

Since `P_c.y - P_b.y = (height2 - height) / 2`, on flat ground (`n.y = 1`) the cab top stops
0.25 ft above the body's top: the cab keeps at least `height + 0.25` of its `height2`, so

    f_max = 1 - (height + 0.25) / height2        (no crush at all when height2 <= height + 0.25)

The roof therefore comes down by 15% of the excess over 0.625 ft **per contact that reaches the
rule**, which can be several per sub-step (each hull point, tire point and wheel that beats its
stored depth on the cab top). Lowering all 16 stored depths by `e` keeps later points of the same
step consistent with the lowered roof; the wheels' suspension penetrations (`+0x94`) are not
lowered, only the current one through `D`. The caller stores the lowered `D`.

`groundNormal(x, z)` (`0x550460`): the first listed box (kind 1, including ground boxes) whose
footprint holds the point gives `(0, 1, 0)`: `|x_box - x|` and `|z_box - z|` at most its radius
`+0x74`, then with `dx = x_box - x`, `dz = z_box - z` and the box's sin/cos psi (`+0x224`,
`+0x228`), `|cos dx - sin dz| <= width (+0x68) / 2` and `|cos dz + sin dx| <= length (+0x64) / 2`.
Else the first listed ramp holding it the same way (radius `+0x50`, sin/cos `+0xe4`/`+0xe8`,
width `+0x44`, length `+0x40`) gives its slope normal `+0xf8`. Else the terrain normal (2.2) at
the point, scaled by 1/65536.

#### 14.27.6 What persists, and drawing (`0x54f570`, `0x54ec00`, opcode 0x20 at `0x431960`)

**Persistent state**: the cab top (the four `+0x140` family values) and `f` (`+0x84`) only; they
last until the SIT is loaded again. Setup rebuilds the corners on a reload but never writes
`+0x84`, so **hypothesis**: a car keeps the previous race's drawn crush until it is crushed
again (the physics roof is fresh). Replays (`0x5665b0`, `0x568a00`) would record a car as kind 2
(position `+0x28`, `bvel`, angles, index) only when `+0x00` is non-zero, which no code found ever makes it (so, **hypothesis**, cars are
never recorded); the
roof is not in the record either way, and playback (`0x566f00`) writes back only position,
angles, `bvel` and rates.

**Drawing**: each frame `0x54f570` registers every car (not only listed ones) with the draw
callback `0x54ec00`, which does nothing when `+0x2ac` is non-zero. Positions go to the renderer
as integers in 1/256 ft (`x 256`) and angles as binary angles (`x 10430.378`, 65536 / 2pi), the
same three angles for both parts. It draws, in order:

1. **Cab** at `P_c`. Without a cab model: a box from the eight cab corners (so it visibly
   flattens). With one: the model must begin with opcode **0x20** (keyframed), otherwise the game
   stops with "Top crush must be keyframed 1"; before every draw the model's time word (`+0x10`
   of the 0x20 record) is set to `trunc(f * 65535)`.
2. **Body** at `P_b`. Without a model: a box from the body corners. With one: any model.

The 0x20 opcode (`0x431960`) turns the time word into a frame position: with `N` frames
(`+0x08`) and frame length `T` (`+0x0c`),

    k    = floor(time / T)   (clamped to 0x7fff),   frac = (time mod T) / T   (16.16)
    frames k - 1 (wrapping to N - 1), k, k + 1 and k + 2 (each wrapping to 0 past N - 1)

are blended with cubic weights built from `frac` and the constants 0.5, -0.5, 1.5, -2.5, 1 and 2
(**hypothesis**: a Catmull-Rom blend), and the op then overwrites `+0x10` with the global clock
`0x644618` modulo `N T` (which is why the crush draw sets it every time). So the crushed look is
chosen purely by `f`: an intact cab draws at time 0 (frame 0), a fully crushed one at
`trunc(f_max * 65535)`. **Open**: OpenPhotex's `BIN.md` reads animated BINs as a frame count
followed by a "magnify" word; this code uses that second word as the frame length `T`, and the
mapping from `f` to the "after" frame depends on it. The model format work belongs in
OpenPhotex.

#### 14.27.7 Corrections to earlier text

- Section 7.6: hull points, tire points and wheels against the car's **faces** are the ground
  contacts (as for boxes); the **edges** add the separate edge-against-hull and edge-against-wheel
  contacts. "Never below half the car's height" describes the body routine, whose limit is 0 so
  the body never crushes; the cab's floor is the body's top plus 0.25 ft, divided by the ground
  normal's y at the car. The fraction is the cab's: `1 - (cab top - cab bottom) / height2`.
- MONSTER_EXE_ANALYSIS.md used to give `0x54ec00` as the box draw rule; the rule is in
  `0x54f570` (corrected there), and `0x54ec00` is the top-crush callback.
