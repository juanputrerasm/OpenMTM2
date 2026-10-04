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

### 7.6 Top-crush cars (`0x4a58b0`, `0x4a2d80`, `0x4aa9b0`)

- The car is **ground** for the truck: its box edges against the truck's hull box produce
  contacts written into the hull-contact table (depth and normal at the hull corner nearest
  the contact, chosen by octant, `0x496da0`).
- **Crushing:** when a truck point or wheel sinks more than **0.625 ft** (0.25 + 0.375) into
  the car's roof, the roof comes down by **15% of the excess per step**, never below half the
  car's height. The truck's penetration drops by the same amount, and the crushed fraction
  `1 - (roof - base) / height` drives the car's keyframed crush animation.

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

**Traffic** (`0x483600`): trucks on the same or the next segment are found (nearest ahead at
+0x8e4, count at +0x8ec). To pass, the truck picks a side (+0x8d8 = +-1) and aims at a point
beside the truck ahead, offset 90 degrees from its line by the two bounding radii, if that point
is within +-45 degrees of its heading. The correction is clamped to +-0.125 rad on straights and
+-0.25 on arcs. A truck ahead within 100 to 200 ft and +-30 degrees makes it adjust speed.

---

## 13. Still open

Everything above was traced in code. What remains is detail, not mechanism:

1. The exact speed-following law in the second half of `0x483600` (constants 100, 200, 0.25,
   1.25, 0.866).
2. The arc aim-point smoothing in `0x481a70`/`0x483070`.
3. The `.TTY` depth's effect beyond probe sinking (none found so far).
4. The `+0x2a8`/`+0x518` (15000) axle field and the `+0x5a0` weight term (0 in stock trucks).

Each is a few dozen lines in one routine and can be read out during the port.

- **Cornering roll** (an observation from the port, to compare with the running game): lateral
  tire forces act at the axle's travel height (§14.8), which at the static sag sits at about the
  CG height (-3 ft), so cornering makes almost no roll and the truck leans slightly into turns.
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

The ramp's sides are walls for hull points and wheels (`0x4b2580`: the four wheels through
`0x4aa110`, hull points 1 to 12 through the inside test `0x48c230` and the push-out `0x4b2950`
with the force law `0x48c8a0`, then `0x4b17c0`); they are still to be written up here.

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
