# OpenMTM2 and CP4 beta 0.54 in room-server rooms: what we matched, and our questions

To: the Community Patch 4 developer and his agent.
From: OpenMTM2 and OpenMTM2 Server.
Date: 2026-11-25.
About: Community Patch 4 beta 0.54 (`monster.exe` "Version 2.0.52.4", built Nov 24 2026, MD5
`d863d8143aff145b549693919c07595d`) racing OpenMTM2 in the room server's relay rooms ("CP4 rooms").

A note on sources: no source code was provided to us. What follows comes from your two notes of 2026-11-24 and from
our own reading of the beta 0.54 executable (OpenMTM2 `docs/CP4_EXE_ANALYSIS.md` section 18). Where we write "we
read", please correct us if your source says otherwise.

We aim for interoperability in the room server's CP4 rooms only. We will not pursue direct connect, and we may drop
OpenMTM2's classic peer-to-peer play in a later version.

## 1. What OpenMTM2 now does in a CP4 room

| Area | What we read in 0.54 | What OpenMTM2 does |
|---|---|---|
| Remote trucks (0x02) | 32-sample buffer by sender tick; per-sender offset (+0.02 / +0.3 of the error, resync past 1 s); delay = p97 of lateness over 2.5 s + 40 ms + 10 ms, held to 0.05 to 0.30 s (0.10 s with under 8 samples); playback clock slewed by +-10% (snap past 0.5 s); collision lead = applied delay (at most 0.25 s, slewed); extrapolation at most 0.2 s; fading correction over 0.15 s (none past 20 ft); pin before each tick at playback + lead; body velocity from the move over one tick x 25.0042 | The same constants. Our step is 1/60 s (or your substep under our CP4 physics), so we pin before every step; we send one 0x02 per 25 Hz tick |
| Older poses in 0x02 | Fill lost ticks: tick N - age, theta and phi wrapped, psi raw | The same; we send up to two, newest first, under 256 ticks old |
| 0x27 send | Only a pair of one owned truck and one remote copy; dt x the copy's own force and moment (its body frame) summed per victim; sent when the linear dv is 0.3 ft/s or more; not again to that victim for 0.4 s | The same |
| 0x27 receive | Mirror rule 0.30 s per attacker; hit check over delay + 0.2 s (accept 3 ft, reject past 8 ft, scale between); cap max(15, 1.25 x closing), at most 60; always 22 ft/s at most; pitch and roll 1 rad/s, yaw 2 rad/s; budget 30 ft/s, drained 25 a second, tilt costs 4x; fed in over 0.12 s | The same |
| 0x26 | Sent by the owner at each pass (after 0x0b) and each drag state change; the receiver sets +0x8fc and the total (when above 0); only the owner counts passes | The same, including the send points and values; our passes for remote trucks are not counted; a remote drag lane is judged only by its owner |
| 0x2b | Truck in "packet 38's numbering" | We had sent the 1-based vehicle number; now the 0-based truck index |
| Computer trucks | None online in 0.54 | None in a CP4 room |
| Game modes | The track's own race type: circuit, rally, drag, Summit and Parallel; no extension modes | A CP4 room plays the same race types, from the track as you do. OpenMTM2's extension modes (Tag, Hockey, Soccer, Cops & Robbers, Race & Rumble, Combat, Deathmatch) are not offered in a CP4 room, and the server keeps a relay room's `mode` empty |

## 2. Questions

### Packets

1. **0x26 at the finish line.** We read that the pass sends 0x0b and then 0x26, and only after that closes the lap.
   So the finish line's 0x26 carries the total *without* the closing lap, and on a race of two laps or more it puts
   back the shorter total that the 0x0b receiver had just computed. Is that intended? We send the same as you, so
   both games agree. If you change it, will you send a 0x26 after the lap close instead?
2. **Truck numbering.** 0x26, 0x27 and 0x2b number trucks from 0. Is the truck index always the vehicle number (the
   0x87 slot) less one, on every machine?
3. **0x26 drag code 3** ("the tree has run"). We send 3 for a staged truck while the tree runs and after the green,
   until it launches. Is that what you mean, or is it tied to the per-lane stage-timer threshold we saw?
4. **0x27 delivery.** Is 0x27 sent on the reliable channel? It goes through the same call shape as 0x28 / 0x29, and
   you said every relay frame except 0x02's asks for reliable delivery.
5. **0x27 latency.** In the hit check, is the player's latency at +0x1c a round trip or one way?
6. **0x27 inertia.** The receiver divides the angular impulse's x, y and z by the inertias at +0x2944, +0x2948 and
   +0x294c (5000, 5000 and 7500). That is the collision solvers' pairing; the truck's own step takes the yaw rate with
   the third inertia and the roll rate with the first, so a received hit's yaw comes out 1.5 times and its roll two
   thirds of what the step would give. Is that intended? We copied it as read.
7. **0x2b's value.** Is it the running penalty total in milliseconds (u32), set rather than added, as your notes
   say?
8. **Version 0x3404.** Besides 0x2a and 0x2b, did any packet layout change from 0x3402? We saw that 0x82's byte is
   now 0 where retail wrote 1; does it mean anything?
9. **The tick's origin.** Our 0x02 tick counts 25 Hz from our race session's start (never 0). Does your receiver
   assume anything about where a sender's tick starts?

### Players who leave

10. Your notes say a mid-race disconnect ends the race with a message. In 0.54 we also read that the host keeps
    sending 0x02 for a departed player's truck. Which is right in a CP4 room? If the race goes on, who sends that
    truck's 0x0b and 0x26, and does the `rslt` barrier wait for the departed player? (We could not name the player
    entry's +0x1e and +0x20 flags.)

### The room protocol

11. **Rooms a CP4 client may join.** OpenMTM2's extension modes are played only in the server's ordinary
    (non-relay) rooms, which race by the room protocol, and CP4 can play neither. From OpenMTM2 Server's next
    release a CP4 client is kept out of them: OpenMTM2 now declares a second capability, `room-race/1`, and a
    client that declares `cp3-relay/1` without it cannot join or make an ordinary room. It gets the `capability`
    error, which your client already shows as "That room is for OpenMTM2 players only". Relay rooms stay open to
    you, and they never carry an extension mode, so a CP4 player only ever joins a race CP4 plays natively. Is
    that what you want? Please do not declare `room-race/1` in your hello unless CP4 learns the room protocol's
    own races. Would you also like the room list to mark the rooms you cannot join (it already carries `relay`)?
12. **A refused `start`.** When the server refuses your `start` (a member not ready, no track, or a member whose
    `content` says it lacks the track), your client logs it and the race runs anyway. The room then stays in the
    lobby state, open to joiners mid-race, and your `finish` never comes. Should your client stop the start when the
    server refuses it, or should the server accept a relay room's `start` as it comes?
13. **Laps and weather in `settings`.** Your owner sends only `track`, so the room list shows our defaults (3 laps,
    weather 0). Would you also send `laps` and `weather` when they change, so the list shows the real race?
14. **Results.** Your client does not read the server's `results` and we do not need it to. Do you want the server to
    keep sending `starting`, `synced` and `results` to CP4 members, or skip them for relay rooms?

### Computer trucks

15. Are computer trucks online planned? If so, how will they be announced (0x81 / 0x82 / 0x87 or something new), so
    that OpenMTM2 can show them and drive its own the same way? Until then, OpenMTM2 adds none in a CP4 room.

### Measurements

16. Could you send a `netsync.log` from a real internet race in a relay room? We will compare our playback against
    yours on the same packets. It also answers your earlier question about a UDP side channel.

Thank you. Corrections to anything in section 1 are as welcome as answers.
