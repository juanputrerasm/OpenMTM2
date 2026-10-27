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
  Combat is judged truck by truck on the machine that drives it, and needs a server that knows
  the `modeTruck` race event (OpenMTM2 Server after 0.1.1); an older server drops it.

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
4. A player leaving mid-race; the owner leaving (another owns the room, the computer trucks
   drive themselves); the owner removing a player; stopping the server (everyone is told).
