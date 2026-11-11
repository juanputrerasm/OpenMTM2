# Multiplayer (M15)

How OpenMTM2 plays over a network. What the original game does is in `MONSTER_EXE_ANALYSIS.md`
section 14; this file is the port's design.

**Status:** Step 1, classic TCP/IP, and Step 2's online rooms are built and passed their first
play test. The DirectPlay gateway, which opens a room to the original game, is built and
waiting for a play test with the retail game (below). CP3's own UDP direct connect is built, from a trace of CP3's executable, and waiting for a play test with CP3.

## Two ways to play

| | Classic TCP/IP | Online rooms |
|---|---|---|
| Plays with | retail 2.00.42, the patched retail, CP3 (DirectPlay), other OpenMTM2 | other OpenMTM2, retail players through a gateway room, CP3 once it adds rooms |
| Finding a game | type the host's IP, as in the game | a server browser |
| Path | browser, then a local helper on the player's PC, then DirectPlay TCP/UDP to the other machines | browser, then WebSocket to the OpenMTM2 Server, which relays |
| Players | 2 to 8 | 2 to 8 by default, up to 16 |
| Truck updates | 4 a second, as the game sends them over TCP/IP | 20 a second |
| Remote trucks | the game's rule: controls, velocity and angles from every update, position snapped at most once a second | smoothed: errors blended away over 0.5 s, snapped beyond 100 ft |

IPX, modem and serial connections are not supported.

## Who owns what

As in the game, **each machine simulates its own truck** and sends its state. Remote trucks are
ordinary physics bodies in the local simulation, driven by the controls and velocity they last
sent. Collisions between trucks are worked out on each machine against its own copies.

- The host (the room owner online) seats the players, resolves Random weather, and sends the
  start positions. Its machine also simulates the computer trucks and sends their state.
- Each machine reports its own checkpoints, damage, headlights, horn and YeeHaw.
- Results are exchanged at the end: by the game's results barrier in classic play, by the server
  online.
- A player who leaves mid-race hands their truck to the autopilot on every machine.

In the simulation the local player stays truck 0. A table in `src/net/net-race.js` maps the
network's slots (the game's vehicle numbers) to local truck indexes.

In a network race, as in the game: no pause, no cheats or GOLD keys, no Torture Pit check, and no
instant replay when more than one human raced.

## The pieces

**OpenMTM2** (`src/net/`, no DOM, also runs under Node in tests):

| File | Job |
|---|---|
| `transport.js` | the interface every transport offers: peers, send (reliable or not), events |
| `tests/helpers/loopback-transport.mjs` | in-memory, for tests (not part of the app) |
| `bridge-transport.js` | WebSocket to the local helper |
| `room-transport.js` | WebSocket to the room server, and the address a player types turned into a `wss://` one |
| `legacy-session.js` | the game's lobby and race protocol, host and client |
| `room-session.js` | the room protocol, offering what `legacy-session.js` offers, so the screens serve both |
| `net-race.js` | in-race glue for both |
| `vendor/mtmnet/` | generated from the OpenMTM2 Server project, never edited here: the game's packets, the room protocol's messages and truck state, the track checksum |

**OpenMTM2 Server** (separate project, Node 22, no dependencies):

- `openmtm2-bridge`, the desktop helper for classic play. It listens on `127.0.0.1:47650` only,
  checks the page's origin, and asks the page for a pairing token it prints when it starts.
- `openmtm2d`, the room server. It runs headless as a daemon (systemd unit, Docker image), needs no
  game files, and can host a DirectPlay gateway per room.
- `dplay/`, DirectPlay 4 over TCP/IP, written from Microsoft's open specification
  ([MC-DPL4CS](https://learn.microsoft.com/en-us/openspecs/windows_protocols/mc-dpl4cs/)) and used by
  both.
- `docs/PROTOCOL.md`, the room protocol specification, written so other clients (CP3) can
  implement it; `docs/DAEMON.md`, how to run the server.

## Ports and networks

Classic play uses DirectPlay's ports: 47624 (TCP and UDP) to find a game, and TCP and UDP 2300 to
2400 between players. DirectPlay connects every player to every other, so each machine must accept
incoming connections on those ports: forward them on the router, or play over a VPN (Radmin VPN,
Hamachi), as MTM2 players do today. The helper and a running `MONSTER.EXE` on the same PC would
fight for these ports, so one PC runs one of them.

Online rooms need only an outgoing connection to the server (`wss://`, behind a TLS proxy).

## Community Patch 3

CP3 can join classic games through its DirectPlay TCP/IP connection. Its own recommended UDP/IP
(direct connect) protocol stays as it is, and OpenMTM2 speaks it too: Connect, Classic TCP/IP,
Connection **CP3 direct connect**. The facts are in `MONSTER_EXE_ANALYSIS.md` 14.5, traced from CP3's
executable, since its author published no source code. The helper's `cp3udp/` node implements them.

- **The transport:** a star over one UDP port (2350 by default). The host relays everything, so
  only the host needs its port reachable. There is no game list: players type the host's address.
- **The game layer:** the same MTM2 packets as over DirectPlay. A client hears of the other players
  only through the host's 0x81 and 0x82. OpenMTM2's host sends them as retail and CP3 do, and also
  sends 0x83 when a player leaves.
- **Truck state:** sent unreliably, everything else reliably, as CP3 does.
- **Host migration:** when the host goes quiet for 8 s, the lowest player ID in its last roster
  takes over.

Its play test, with the helper on OpenMTM2's side and CP3 2.0.52 on another machine:

1. CP3 hosts (Multiplayer, UDP/IP direct connect), OpenMTM2 joins with its address. Then OpenMTM2
   hosts (UDP port 2350 open), CP3 joins.
2. Three players, two of them CP3: everyone sees everyone's name, truck and level.
3. The lobby, the race and the results as in the classic checklist above; a player leaving; the
   host leaving. Separately, the room protocol will be
written up for the CP3 developer to review, so CP3 can offer online rooms beside its existing
connections.

### Packet profiles (CP3 and CP4)

The game layer is not quite retail's in Community Patch 3 and 4 (`CP4_EXE_ANALYSIS.md` section 9,
read from CP4 beta 0.52's executable and CP3's; their author published no source code). The
protocol module (`src/net/vendor/mtmnet/mtm2-packets.js`, from the server project's `protocol/`)
keeps one layout per game version, a **profile**, picked by the version in a player's 0x03 at
+0x3A with `profileForVersion`:

| Profile | Version | 0x02 truck state | 0x14 start | New packets |
|---|---|---|---|---|
| retail | 0x0201 | 61 bytes, angles and steering byte-coded | 36 | none |
| cp3 | 0x3400 | 65: angles and steering f32 radians, then a u32 sender tick (25 Hz, 0xa3d/65536 s) at +0x3D | 36 | 0x26 progress (24), 0x27 collision (44) |
| cp4 | 0x3402 | 116: CP3's, then up to two older poses (+0x41 count, +0x42 ages in ticks, +0x44 positions, +0x5C theta, +0x64 phi, +0x6C psi) | 40, raceId at +0x24 | CP3's, and 0x28 race loaded / 0x29 race release (16, raceId at +0x0C) |

0x25 (the track checksum) and every other packet are retail's in all three. Any other version is
read as retail. Decoding is strict: a packet must have its profile's exact size (0x89, the voice
radio, at least 20 bytes, and it is not decoded); anything else comes back with `kind: null` and a
`reason`, so a 65-byte 0x02 is refused as retail and read as CP3.

`legacy-session.js`:

- **Reading:** each player's packets in the profile of its 0x03; before that arrives, in the
  host's. 0x03 itself is the same everywhere.
- **Sending:** retail's, OpenMTM2's own, unless it joined a CP3 or CP4 host; then the host's
  profile. Our 0x03 still says 0x0201, so CP3 and CP4 show us as "(Version 2.01)".
- **Truck state:** a CP3 or CP4 0x02 becomes the same remote-truck event as retail's (feet,
  radians, the packet's own pose, which is the newest); the tick and the older poses are not used
  by the simulation yet. Sent in CP3's or CP4's form, our tick counts 25 Hz from the race start,
  and in CP4's we add up to two of the poses we sent before (newest first, under 256 ticks old).
  CP4 itself takes them from a ring filled every tick.
- **CP4's race start:** the raceId from the host's 0x14; after loading, 0x28 with it, then a wait
  for the host's matching 0x29 (300 s at most, or until the host is lost or we become host). CP4
  appears to skip the `sync` barrier when this one ran (INFERRED), so we wait for no `sync`, but
  still send our 0x15 `sync` once for a host that does.

TODO:

- 0x26 (progress) and 0x27 (collision) are decoded and passed to the race as `progress` and
  `collision` events, which `net-race.js` does not apply yet (CP4_EXE_ANALYSIS.md 9 has the
  collision's rules); OpenMTM2 sends neither.
- Over CP3's direct connect, when OpenMTM2 hosts, it sends retail packets to everyone, so CP3 and
  CP4 joiners would not read our truck states. In a relay room (below) it hosts in CP4's profile,
  with the host's side of the 0x28 / 0x29 barrier; the direct connect host could do the same once
  the player says which game the joiners run.
- The server's DirectPlay gateway (`rooms/gateway.js`) still reads every player as retail.

### Relay rooms (CP4 cross-play, experimental)

Community Patch 4 will reach online rooms through the server's relay (OpenMTM2 Server
`docs/PROTOCOL.md`, "Relay rooms"; its developer's proposal and our reply,
`docs/REPLY_TO_CP3_ONLINE_ROOMS.md`): the room layer is ours, and inside a relay room each client
carries the game's own packets, which the server passes on unread. With **Options, Network, CP4
cross-play** on, OpenMTM2 declares the `cp3-relay/1` capability, lists and joins relay rooms
(marked CP4) and can make one ("A CP4 room"). In such a room (`src/net/relay-transport.js`):

- the classic session (`legacy-session.js`) plays the game's whole lobby and race protocol inside
  the relay, as over CP3's direct connect: 0x03 player info, ready, track and settings, 0x14 start,
  the race's packets;
- a player's id, in its packets' headers too, is its room member id; one relay payload is one game
  packet, its 12-byte header included; flags bit 0 asks for reliable delivery;
- the room's `member`, `left` and `owner` messages are the direct connect's joined, left and host
  events, and the host is the room's owner, whom the server chooses;
- OpenMTM2 announces CP4's version (0x3402) and sends CP4's layouts whether it hosts or joins
  (`createLegacySession({ profile: PROFILES.cp4 })`); as host it gives the 0x14 a raceId
  (`now ^ (id << 20) | 1`), broadcasts its own 0x28, waits up to 120 s for every human's, then
  broadcasts 0x29, and answers a late 0x28 with 0x29 at once.

**Confirmed by CP4's developers** (OpenMTM2 Server `docs/REPLY_TO_CP4_ONLINE_ROOMS_2.md`, answering
their reply_to_kmaster_online_rooms_2.md): the payload is the whole game packet with its header; ids
are member ids; the whole game protocol, lobby included, runs inside the relay; flags bit 0 is
"reliable", and a reliable payload is at most 1024 bytes (udpnet's `OUTREL_MAXLEN`; the server drops a
longer one). The retail end-of-race results barrier (`rslt`, 30 s) still runs after CP4's 0x28 / 0x29
barrier, and OpenMTM2 answers it as in classic play.

**Versions:** a Community Patch version is `(build << 8) | rev` and names exactly that build's layouts,
with nothing negotiated. OpenMTM2 refuses what it cannot read rather than guess (`knownVersion` in the
vendored `mtm2-packets.js`): a patch build it has no profile for, and in a relay room any build but
CP4's 0x3402. Such a player's packets are dropped and a notice says why; when it is the host, the
session ends ("The host runs a version of the game this one cannot play with."). Not done: the server's `start` / `finish` for the room (the
room stays in its lobby state during the race, so joiners are not refused mid-race); CP4's
netcode (jitter buffer, collision lead, hit check, 0x26 / 0x27), so OpenMTM2's trucks still move
by OpenMTM2's own smoothing in such a race.

## To check against the retail game

Step 1 follows the analysis. Some details are guesses (marked H there) or could only be checked
between OpenMTM2 machines:

- **DirectPlay:** our messages against a Windows capture (Wireshark's DPlay dissector, switched
  on for TCP and UDP): the dialect version we send (DX9, 14), the player flags, whether a
  non-guaranteed game message over UDP goes without the 20-byte prefix, as Wine sends it.
- **The truck name** in packets 0x03 and 0x0f: the TRK file name (`BIGFOOT.TRK`) is assumed.
- **Vehicle numbers** are the 1-based slots, and packet 0x17 is indexed by them (index 0 unused).
- **Packet 0x0b's** truck field is taken as the vehicle number.
- **Computer opponents** in a classic game are not offered yet: 0x81 and 0x82 turned out to be the host's list of every player (`MONSTER_EXE_ANALYSIS.md` 14.2), and how the game announces computer players is not known.

The play test, one Windows computer (or virtual machine) with DirectPlay switched on and the game,
and one running OpenMTM2 with the helper:

1. Retail hosts, OpenMTM2 joins; then OpenMTM2 hosts, retail joins.
2. The same with the patched game, and with Community Patch 3 using its DirectPlay connection.
3. Two OpenMTM2 players and one retail.

Check: the game in the list; joining; the lobby's columns (level, truck, latency, status);
chat, both ways and private; Ready; the host's track, laps and weather, and the missing-track
and different-version messages; the start (everyone waits, then counts down together); trucks
moving both ways; horn, headlights, damage; the results; a player leaving mid-race (their truck
drives itself); the host leaving.

## Online rooms

The screens: **Multiplayer**, then under **Online rooms** the server's address, then the room
list (`src/ui/screens/rooms.js`): the public rooms with their players, track and state; Refresh;
Quick Join (the fullest open room, or a new one); Create Room (name, password, players, listed
or by code only); Join by code. The room itself is the Multiplayer screen, with the room's code,
a Copy invite button, and for the owner the number of computer opponents. An invite link
(`?room=CODE&server=address`) opens OpenMTM2 straight into that room.

How a room differs from a classic game:

- The server seats the players and runs the loading and results barriers. The owner sends the
  start positions and drives the computer trucks.
- Truck state goes 20 times a second, at full precision, and remote trucks are smoothed.
- Up to 16 players when the server allows it, as many as the track's start grid holds.
- Nobody can join a room while it races.
- Players whose copy of the track is missing or differs are marked in the Status column.
- The owner may pick an extension mode (Hockey, Tag) on the Races screen. The owner's machine
  judges the mode, and the others follow its state (`docs/EXTENSIONS.md`, "Over the network").
  Combat and Deathmatch are judged truck by truck on the machine that drives it, and need a server
  that knows the `modeTruck` race event (OpenMTM2 Server after 0.1.1); an older server drops it.

**Classic rooms.** On a server that runs the gateway (OpenMTM2 Server's `docs/GATEWAY.md`), Create
Room offers **Open to classic MTM2 players**. The original game then joins the room by typing the
server's address, as it joins any host, and its players appear in the room marked "(Classic)".
They race the OpenMTM2 players with the game's own packets. Such a room keeps the game's limits:
8 players, no computer opponents, one per server. Classic players need their DirectPlay ports
reachable, as in any classic game; OpenMTM2 players do not.

The gateway's play test, with `node bin/openmtm2d.mjs --gateway` on a machine the game can reach:

1. In OpenMTM2, make a room open to classic players and choose a track.
2. In the game: Multiplayer, TCP/IP, Join, the server's address. The room is listed; join it.
3. Check both lobbies: names, trucks, levels, status, latency, chat both ways and private, Ready,
   the track, laps and weather in the game, and its track check.
4. Start: the game waits, then counts down with OpenMTM2; trucks, horn, headlights and damage
   both ways; results on both sides; back in the lobby.
5. A second retail player; the game leaving mid-race; the owner removing the game's player; the
   owner leaving (the room closes and the game says the session was lost).

The play test, with `node bin/openmtm2d.mjs --state-dir ./state --log-format text` in the
OpenMTM2 Server folder and two browsers (or two computers) at `localhost` or the machine's address:

1. Make a room in one browser, find it in the other's list and join; join by code; copy the
   invite link and open it.
2. Chat, Ready, the owner's track, laps, weather and computer opponents; a player without the
   track.
3. The race: everyone waits, then counts down together; trucks, horn, headlights and damage
   both ways; the computer trucks; results; back in the room.
   In the race, the chat (`ui/race-chat.js`): lines both ways in the feed, the box's history,
   a whisper (/w) and a reply (Tab to Reply, or /r), team lines in Hockey or Soccer reaching only
   the teammates, a muted player, and the gamepad's quick-message wheel.
4. A player leaving mid-race; the owner leaving (another owns the room, the computer trucks
   drive themselves); the owner removing a player; stopping the server (everyone is told).

### The owner's rules (0.6.6, server 0.4.0)

With the start the owner sends the room's `rules` setting (`game/host-rules.js` `hostRules`): the physics model, how
the computer trucks drive and their AI speed, the opponent frame rate, Sonic trucks, shifting in automatic, the Evo
helicopter, the skill, the CommPatch4 physics' collisions (`cp4Collision`, triangles or classic boxes), and the chosen
extension's settings as `ext.<id>.<key>`. Under CommPatch4 a network race always steps in CP4's 10 ms substeps and
its computer trucks get no `aiGrip`, as CP4 online (docs/CP4_EXE_ANALYSIS.md 10.2, 10.4). Every player's race runs by them over
their own settings, for that race only (`withHostRules`, `ui/screens/race.js` `raceRules`); cameras, keys, the
gamepad, graphics and sound stay each player's. A server before 0.4.0 refuses the field, and a client before 0.6.6
ignores it.

