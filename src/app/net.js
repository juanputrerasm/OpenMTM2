/*
  The network game the app is in, kept on `context.net` while the player moves between screens
  (docs/MULTIPLAYER.md): the session, its chat log and notices, and what happens when the host
  starts a race or the game ends.

    context.net = { kind: "classic" | "rooms", session, transport, log: [{ name, text, private, own, notice }], name, catalog }

  Classic games go through the desktop helper (context.netHelper), online rooms through a room
  server (context.netRooms); either connection outlives the game, so the player can pick another.
*/
import { connectBridge } from "../net/bridge-transport.js";
import { createLegacySession, LOCATION } from "../net/legacy-session.js";
import { connectRooms } from "../net/room-transport.js";
import { createRoomSession } from "../net/room-session.js";
import { cpuNames } from "../game/race-setup.js";
import { resolveGameMode } from "./flow.js";
import { extensionById, soloExtension } from "../game/extensions/loader.js";
import { getProfiles } from "./profile-store.js";
import { currentDriver } from "../game/profile.js";
import { resolveWeather } from "../game/weather.js";
import { createStrings, msg } from "../game/strings.js";
import { showAlert } from "../ui/dialogs.js";
import { chatSettings, isMuted } from "../game/chat.js";

/** The chat pane keeps this many lines (the game's in-race buffer holds 20). */
export const LOG_LINES = 60;

/** The game's default session name, `<<1>>'s Truckin' Game`. */
export const sessionName = (driver) => `${driver}'s Truckin' Game`;

/** The room servers every player is offered first, before the ones they have used. */
export const DEFAULT_ROOM_SERVERS = Object.freeze(["multiplayer.openmtm2.workers.dev", "localhost"]);
/** How many servers a player has used are remembered. */
export const RECENT_ROOM_SERVERS = 8;

const sameServer = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** The servers the Connect screen lists: the defaults, then the ones used before (newest first), each once. */
export function roomServerList(net = {}) {
  const list = [];
  for (const address of [...DEFAULT_ROOM_SERVERS, ...(Array.isArray(net?.recentServers) ? net.recentServers : [])]) {
    if (typeof address === "string" && address.trim() && !list.some((known) => sameServer(known, address))) list.push(address.trim());
  }
  return list;
}

/** `recentServers` with `address` put first (a default server is not repeated there). */
export function rememberServer(recent, address) {
  const value = String(address ?? "").trim();
  const kept = (Array.isArray(recent) ? recent : []).filter((known) => typeof known === "string" && !sameServer(known, value));
  if (!value || DEFAULT_ROOM_SERVERS.some((known) => sameServer(known, value))) return kept.slice(0, RECENT_ROOM_SERVERS);
  return [value, ...kept].slice(0, RECENT_ROOM_SERVERS);
}

/** The classic helper (openmtm2-bridge), connected and paired once per page. */
export async function classicHelper(context) {
  if (context.netHelper?.alive) return context.netHelper.helper;
  const settings = context.settings.net ?? {};
  const helper = await connectBridge({ url: `ws://127.0.0.1:${settings.helperPort ?? 47650}/bridge`, token: settings.helperToken ?? "" });
  const holder = { helper, alive: true };
  helper.on("closed", () => { holder.alive = false; if (context.netHelper === holder) context.netHelper = null; });
  context.netHelper = holder;
  return helper;
}

/** Who this player is on the network: name, truck and skill, from the current driver and the race settings. */
async function whoAmI(context) {
  const driver = currentDriver(await getProfiles(context));
  const catalog = await context.assets.call("catalog");
  const trucks = catalog.trucks.filter((t) => !t.hidden);
  const truck = trucks.find((t) => t.file === driver.lastTruck) ?? trucks[0];
  return { name: driver.name, truck: truck?.file ?? "", skill: Number(context.settings.difficulty ?? 1), catalog };
}

/** Host a classic game through the helper: `{ name, maxPlayers, migrateHost }`. */
export async function hostClassic(context, { name, maxPlayers = 8, migrateHost = true }) {
  const helper = await classicHelper(context);
  const me = await whoAmI(context);
  const transport = await helper.host({ name: name || sessionName(me.name), playerName: me.name, maxPlayers, migrateHost });
  return attachClassic(context, transport, me);
}

/** Host a game of Community Patch 3's direct connect (UDP, 14.5) through the helper, on `port`. */
export async function hostCp3(context, { port = 2350 } = {}) {
  const helper = await classicHelper(context);
  const me = await whoAmI(context);
  const transport = await helper.hostCp3({ playerName: me.name, port });
  return attachClassic(context, transport, me);
}

/** Join a Community Patch 3 direct connect host at `ip`:`port`. */
export async function joinCp3(context, { ip, port = 2350 }) {
  const helper = await classicHelper(context);
  const me = await whoAmI(context);
  const transport = await helper.joinCp3({ ip, port, playerName: me.name });
  return attachClassic(context, transport, me);
}

/** Join a session the helper found. */
export async function joinClassic(context, instance) {
  const helper = await classicHelper(context);
  const me = await whoAmI(context);
  const transport = await helper.join(instance, me.name);
  return attachClassic(context, transport, me);
}

// ---- Online rooms ----

/** The room server at `url`, connected once per page (again when the address changes or the connection dropped). */
export async function roomServer(context, url) {
  const held = context.netRooms;
  if (held?.server.alive && (!url || held.typed === url)) return held.server;
  held?.server.close();
  const me = await whoAmI(context);
  const server = await connectRooms({ url: url ?? held?.typed, name: me.name, client: "OpenMTM2" });
  const holder = { server, typed: url ?? held?.typed };
  server.on("closed", () => { if (context.netRooms === holder) context.netRooms = null; });
  context.netRooms = holder;
  return server;
}

/** The public rooms on the connected server. */
export async function listRooms(context) {
  return (await roomServer(context)).request("list").then((r) => r.rooms);
}

/** Make a room and enter it: `{ name, password, maxPlayers, public, classic }` (classic: open to MTM2 itself through the server's gateway). */
export async function createRoom(context, { name, password = "", maxPlayers = 8, public: listed = true, classic = false }) {
  const server = await roomServer(context);
  const me = await whoAmI(context);
  const { room } = await server.request("create", { name, maxPlayers, public: listed, ...(password ? { password } : {}), ...(classic ? { classic: true } : {}) });
  return attachRoom(context, server, room, me);
}

/** Enter a room by its code. */
export async function joinRoom(context, code, password = "") {
  const server = await roomServer(context);
  const me = await whoAmI(context);
  const { room } = await server.request("join", { room: String(code).trim().toUpperCase(), ...(password ? { password } : {}) });
  return attachRoom(context, server, room, me);
}

function attachRoom(context, server, room, me) {
  leaveNet(context);
  const tracks = trackLookup(me);
  const session = createRoomSession({
    server, room, me,
    hasTrack: (sit) => tracks.has(String(sit).toUpperCase()),
    trackCrc: (sit) => context.assets.call("trackChecksum", { sit }),
  });
  return attach(context, "rooms", session, { name: room.name, close: () => {} }, me);
}

/** An invite link to a room: this page with `?room=CODE&server=address`. */
export function inviteLink(context, code) {
  const url = new URL(globalThis.location?.href ?? "https://juanputrerasm.github.io/OpenMTM2/");
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  if (context.netRooms?.typed) url.searchParams.set("server", context.netRooms.typed);
  return url.href;
}

/** The computer drivers the room's owner brings: `n` of them, each with a truck from this install. */
export function pickComputers(context, n) {
  const catalog = context.net?.catalog;
  const trucks = (catalog?.trucks ?? []).filter((t) => !t.hidden);
  if (!trucks.length || n <= 0) return [];
  const names = cpuNames(context.settings.aiNames);
  return Array.from({ length: n }, (_, i) => ({ name: names[i % names.length], truck: trucks[Math.floor(Math.random() * trucks.length)].file }));
}

// ---- Either kind ----

const trackLookup = (me) => new Map(me.catalog.tracks.map((t) => [t.file.toUpperCase(), t]));

function attachClassic(context, transport, me) {
  leaveNet(context);
  const tracks = trackLookup(me);
  const session = createLegacySession({
    transport, me,
    hasTrack: (sit) => tracks.has(String(sit).toUpperCase()),
    trackCrc: (sit) => context.assets.call("trackChecksum", { sit }),
  });
  return attach(context, "classic", session, transport, me);
}

function attach(context, kind, session, transport, me) {
  // `lastPrivate`: who sent the last private line, for a reply (/r, the race chat's Reply channel).
  const net = { kind, session, transport, log: [], name: transport.name, catalog: me.catalog, lastPrivate: null };
  const say = (line) => {
    net.log.push(line);
    if (net.log.length > LOG_LINES) net.log.splice(0, net.log.length - LOG_LINES);
    net.onLine?.(line);
  };
  session.on("chat", (c) => {
    // A muted player's lines are left out, in the lobby and in the race (game/chat.js).
    if (!c.own && isMuted(chatSettings(context.settings.net).muted, c.name)) return;
    if (c.private && !c.own) net.lastPrivate = { from: c.from, name: c.name };
    say({ from: c.from, name: c.name, text: c.text, private: !!c.private, team: !!c.team, quick: !!c.quick, own: !!c.own });
  });
  // `code` and `who` let the race announce a player leaving once (ui/race-chat.js).
  session.on("notice", (n) => say({ name: "", text: n.text, notice: true, code: n.code ?? null, who: n.name ?? null }));
  session.on("start", (e) => startNetRace(context, net, e));
  session.on("left", async ({ reason }) => {
    if (context.net !== net) return;
    context.net = null;
    const text = reason === "removed" ? msg("You have been removed from the game.") : reason === "closed" ? msg("The room was closed.")
      : reason === "left" ? null : msg("The connection to the game was lost.");
    if (text) { const t = context.t ?? createStrings(); await showAlert(t, t(text)); }
    if (reason !== "left") context.router.go(kind === "rooms" && context.netRooms ? "rooms" : "net-connect", {}, { replace: true });
  });
  const pinger = setInterval(() => session.update(), 1000);
  net.stop = () => clearInterval(pinger);
  context.net = net;
  return net;
}

/** Leave the network game, if any. */
export function leaveNet(context) {
  const net = context.net;
  if (!net) return;
  context.net = null;
  net.stop?.();
  net.session.leave();
}

/**
 * The host's choice on the Races screen (`context.raceConfig`: track, laps, weather) as the game's settings, sent to the
 * others when they changed (0x12 track, 0x16 laps, 0x1b weather; Random is -1).
 */
export async function applyRaceConfig(context) {
  const net = context.net, config = context.raceConfig;
  if (!net || !config || !net.session.isHost()) return;
  const game = net.session.state().game;
  const track = net.catalog.tracks.find((t) => t.file === config.track);
  if (track && game.track?.sit?.toUpperCase() !== track.file.toUpperCase()) await net.session.setTrack({ sit: track.file, name: track.name });
  const laps = Math.max(1, Math.trunc(Number(config.laps) || track?.defaultLaps || 3));
  if (laps !== game.laps) net.session.setLaps(laps);
  const weather = config.weather === "random" ? -1 : Number(config.weather ?? 0);
  if (weather !== game.weather) net.session.setWeather(weather);
  // An extension mode (Hockey, Tag) in an online room; classic games and classic rooms have none.
  if (net.kind === "rooms" && !net.session.state().room?.classic) {
    const mode = track ? roomMode(config.gameMode, track) ?? "" : "";
    if (mode !== (game.mode ?? "")) net.session.setMode(mode);
  }
}

/** The mode a room plays: an extension the track takes, never one driven alone (Freestyle), which has no room. */
function roomMode(gameMode, track) {
  const mode = resolveGameMode(gameMode, track);
  return mode && !soloExtension(extensionById(mode)) ? mode : null;
}

/** Tell the others where this player is (the Status column), when in a network game. */
export function netLocation(context, location) {
  context.net?.session.setLocation(location);
}
export { LOCATION };

/**
 * The host's GO: start when every player is ready. Random weather is drawn from what the track allows. Returns an error
 * message, or null.
 */
/**
 * Why the host cannot start yet, or null: `{ text, args }`, `text` a tag. In order: no track; a player without the
 * track (they could not race on it); a player whose truck is not installed on the host's machine, unless Options,
 * Multiplayer allows that (`allowMissingTrucks`: the truck is then drawn as another); a player not Ready.
 * @param {ReturnType<ReturnType<typeof createRoomSession>["state"]>} st the session's state
 * @param {{ hasTruck?: (file: string) => boolean, allowMissingTrucks?: boolean }} [options]
 */
export function startProblem(st, { hasTruck = () => true, allowMissingTrucks = false } = {}) {
  if (!st.game.track) return { text: msg("Choose a track on the Races screen first."), args: [] };
  const guests = st.players.filter((p) => !p.local && !p.computer);
  const lacking = guests.filter((p) => p.missingTrack);
  if (lacking.length) return { text: msg("Without the track: <<1>>. Choose a track everyone has."), args: [lacking.map((p) => p.name).join(", ")] };
  if (!allowMissingTrucks) {
    const odd = guests.filter((p) => p.truck && !hasTruck(p.truck));
    if (odd.length) return { text: msg("Trucks not installed here: <<1>>. They must choose another, or Options, Multiplayer can allow it."), args: [odd.map((p) => `${p.name} (${p.truck})`).join(", ")] };
  }
  if (!st.canStart) return { text: msg("Every player must be Ready."), args: [] };
  return null;
}

/** Whether `file` is one of this install's trucks (the catalogue's, hidden ones left out). */
export const catalogHasTruck = (catalog, file) => (catalog?.trucks ?? []).some((t) => !t.hidden && t.file.toUpperCase() === String(file).toUpperCase());

export function netGo(context) {
  const net = context.net;
  if (!net) return msg("Not in a network game.");
  const s = net.session;
  if (!s.isHost()) { s.setReady(!s.state().players.find((p) => p.local).ready); return null; }
  const st = s.state();
  const problem = startProblem(st, { hasTruck: (file) => catalogHasTruck(net.catalog, file), allowMissingTrucks: !!context.settings.net?.allowMissingTrucks });
  if (problem) { const t = context.t ?? createStrings(); return t(problem.text, ...problem.args); }
  const track = net.catalog.tracks.find((t) => t.file.toUpperCase() === st.game.track.sit.toUpperCase());
  s.start({ resolveWeather: () => resolveWeather("random", track?.weatherMask), computers: net.kind === "rooms" ? pickComputers(context, st.game.computers ?? 0) : [] });
  return null;
}

/** The race the host started: the race screen with the network's entrants and seating. */
async function startNetRace(context, net, e) {
  const catalog = net.catalog;
  const track = catalog.tracks.find((t) => t.file.toUpperCase() === String(e.sit).toUpperCase());
  if (!track) {
    const t = context.t ?? createStrings();
    await showAlert(t, t("You do not have this track: <<1>>.", e.track?.name ?? e.sit));
    net.session.raceLink()?.leave();
    return;
  }
  const trucks = catalog.trucks.filter((t) => !t.hidden);
  const known = new Map(trucks.map((t) => [t.file.toUpperCase(), t.file]));
  const driver = currentDriver(await getProfiles(context));
  const mine = known.get(String(net.session.state().players.find((p) => p.local)?.truck ?? "").toUpperCase()) ?? trucks[0]?.file;
  const entrants = e.entrants.map((x) => ({
    ...x,
    // A truck this install lacks is drawn as the player's own (the game shows its first truck).
    file: known.get(String(x.truck).toUpperCase()) ?? mine,
    owned: x.local || (x.computer && e.host),
  }));
  context.router.go("race", {
    track, mode: track.raceType, laps: e.laps, difficulty: Number(context.settings.difficulty ?? 1), weather: e.weather,
    gameMode: net.kind === "rooms" ? roomMode(e.mode, track) : null,
    truck: mine, trucks, setup: { ...driver.garage }, opponents: [],
    net: { link: net.session.raceLink(), entrants, host: e.host, policy: net.kind === "rooms" ? "smooth" : "legacy", rateHz: net.kind === "rooms" ? 20 : 4 },
  }, { replace: true });
}
