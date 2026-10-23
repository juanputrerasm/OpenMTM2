/*
  Connect: how to play with others (docs/MULTIPLAYER.md). The game's own Connect, Host a Network
  Game and Join a Network Game dialogs (MONSTER_EXE_ANALYSIS.md 14.3) in one screen.

  Classic TCP/IP plays with Monster Truck Madness 2 itself (retail, patched, Community Patch 3's
  DirectPlay connection) through the desktop helper, since a browser cannot open the sockets
  DirectPlay needs. The helper also speaks Community Patch 3's own direct connect (UDP,
  MONSTER_EXE_ANALYSIS.md 14.5). Online rooms go through an OpenMTM2 server.
*/
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { saveSettings } from "../../app/settings.js";
import { bridgeStatus } from "../../net/bridge-transport.js";
import { classicHelper, hostClassic, joinClassic, hostCp3, joinCp3, sessionName, roomServerList, rememberServer } from "../../app/net.js";
import { getProfiles } from "../../app/profile-store.js";
import { currentDriver } from "../../game/profile.js";
import { msg } from "../../game/strings.js";

export const HELPER_COMMAND = "node bin/openmtm2-bridge.mjs";

export default async function mount(container, context) {
  if (context.net) { context.router.go("multiplayer", {}, { replace: true }); return {}; }
  const { t } = context;
  const net = { ...context.settings.net };
  const saveNet = (changes) => {
    context.settings.net = { ...context.settings.net, ...changes };
    saveSettings(context.settings);
  };
  const driver = currentDriver(await getProfiles(context));
  let disposed = false;

  const message = el("p", { class: "net-message", "aria-live": "polite" });
  const say = (text, error = false) => { message.textContent = text ?? ""; message.classList.toggle("error", !!error); };
  const busy = (button, work) => async () => {
    button.disabled = true;
    try { await work(); } catch (err) { say(t(err?.message ?? String(err)), true); } finally { if (!disposed) button.disabled = false; }
  };

  // ---- The helper ----
  const helperState = el("span", { class: "net-helper-state" }, t("Looking for the helper…"));
  const token = el("input", { type: "text", value: net.helperToken ?? "", maxlength: 32, autocomplete: "off", spellcheck: "false", "aria-label": t("Pairing token"), class: "net-token" });
  token.addEventListener("change", () => saveNet({ helperToken: token.value.trim() }));
  const help = el("div", { class: "net-help", hidden: true },
    el("p", {}, t("Classic games need the OpenMTM2 helper running on this computer. In the OpenMTM2 Server folder, run:")),
    el("code", {}, HELPER_COMMAND),
    el("p", {}, t("It prints a pairing token: type it here. Other players reach you on TCP 2300 to 2350, UDP 2350 to 2400 and, when you host, 47624: forward those ports or play over a VPN such as Radmin VPN. A CP3 direct connect host needs only its UDP port (2350).")),
  );
  async function checkHelper() {
    const status = await bridgeStatus(`http://127.0.0.1:${context.settings.net?.helperPort ?? 47650}/`);
    if (disposed) return status;
    helperState.textContent = status.running ? (status.busy ? t("The helper is busy with another page.") : t("The helper is running.")) : t("The helper is not running.");
    helperState.className = `net-helper-state ${status.running && !status.busy ? "ok" : "error"}`;
    help.hidden = status.running && !status.busy;
    return status;
  }
  const pair = async () => {
    saveNet({ helperToken: token.value.trim() });
    await classicHelper(context);
  };

  // ---- Host ----
  const name = el("input", { type: "text", maxlength: 60, value: sessionName(driver.name), "aria-label": t("Game name"), class: "net-session-name" });
  const players = el("select", { "aria-label": t("Number of players") }, ...[2, 3, 4, 5, 6, 7, 8].map((n) => el("option", { value: n, selected: n === 8 }, String(n))));
  const migrate = el("input", { type: "checkbox", checked: true, "aria-label": t("Another player hosts if the host leaves") });
  const hostButton = el("button", { class: "primary", "data-menu-sound": "STARTOFF" }, t("Host"));
  // The connection: DirectPlay (every version of the game), or CP3's own direct connect (UDP).
  const connection = el("select", { "aria-label": t("Connection") },
    el("option", { value: "dplay", selected: (net.classicKind ?? "dplay") === "dplay" }, t("DirectPlay TCP/IP (every version)")),
    el("option", { value: "cp3", selected: net.classicKind === "cp3" }, t("CP3 direct connect (UDP)")));
  const cp3Port = el("input", { type: "number", min: 1, max: 65535, value: net.cp3Port ?? 2350, "aria-label": t("Port"), class: "net-port" });
  const cp3JoinPort = el("input", { type: "number", min: 1, max: 65535, value: net.cp3Port ?? 2350, "aria-label": t("Host's port"), class: "net-port" });
  const cp3 = () => connection.value === "cp3";
  const portOf = (input) => Math.max(1, Math.min(65535, Math.trunc(Number(input.value)) || 2350));
  hostButton.addEventListener("click", busy(hostButton, async () => {
    say(t("Hosting…"));
    await pair();
    if (cp3()) {
      saveNet({ cp3Port: portOf(cp3Port) });
      await hostCp3(context, { port: portOf(cp3Port) });
    } else await hostClassic(context, { name: name.value.trim(), maxPlayers: Number(players.value), migrateHost: migrate.checked });
    context.router.go("multiplayer", {}, { replace: true });
  }));

  // ---- Join ----
  const hostIp = el("input", { type: "text", value: net.lastHost ?? "", placeholder: t("Host's IP address"), maxlength: 64, autocomplete: "off", spellcheck: "false", "aria-label": t("Host's IP address"), class: "net-host-ip" });
  const sessions = el("table", { class: "results net-sessions" });
  let found = [];
  const showSessions = () => {
    sessions.replaceChildren(
      el("thead", {}, el("tr", {}, el("th", {}, t("Game")), el("th", {}, t("Players")), el("th", {}, ""))),
      el("tbody", {}, ...(found.length ? found.map((s) => {
        const join = el("button", { "data-menu-sound": "STARTOFF" }, t("Join"));
        join.addEventListener("click", busy(join, () => joinFound(s)));
        return el("tr", {}, el("td", {}, s.name), el("td", {}, `${s.currentPlayers}/${s.maxPlayers}`), el("td", {}, join));
      }) : [el("tr", {}, el("td", { colspan: 3, class: "muted" }, t("No games found yet.")))])),
    );
  };
  const find = async (auto = false) => {
    saveNet({ lastHost: hostIp.value.trim() });
    say(hostIp.value.trim() ? t("Looking for games at <<1>>…", hostIp.value.trim()) : t("Looking for games on this network…"));
    await pair();
    const helper = await classicHelper(context);
    found = await helper.enumerate(hostIp.value.trim(), { timeoutMs: 1500 });
    showSessions();
    say(found.length ? "" : t("No game answered. Check the address, and that the host's ports are open."), !found.length);
    if (auto && found.length) await joinFound(found[0]);
  };
  async function joinFound(s) {
    say(t("Joining <<1>>…", s.name));
    await joinClassic(context, s.instance);
    context.router.go("multiplayer", {}, { replace: true });
  }
  const cp3JoinButton = el("button", { class: "primary", "data-menu-sound": "STARTOFF" }, t("Join"));
  cp3JoinButton.addEventListener("click", busy(cp3JoinButton, async () => {
    const ip = hostIp.value.trim();
    if (!ip) throw new Error(msg("Type the host's IP address."));
    saveNet({ lastHost: ip, cp3Port: portOf(cp3JoinPort) });
    say(t("Joining <<1>>…", `${ip}:${portOf(cp3JoinPort)}`));
    await pair();
    await joinCp3(context, { ip, port: portOf(cp3JoinPort) });
    context.router.go("multiplayer", {}, { replace: true });
  }));
  const findButton = el("button", {}, t("Find games"));
  findButton.addEventListener("click", busy(findButton, () => find(false)));
  const autoButton = el("button", { title: t("Join the first game found") }, t("Auto Select"));
  autoButton.addEventListener("click", busy(autoButton, () => find(true)));
  hostIp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); (cp3() ? cp3JoinButton : findButton).click(); } });
  showSessions();

  // ---- Online rooms ----
  const serverUrl = el("input", { type: "text", value: net.serverUrl ?? "", placeholder: "rooms.example.org", maxlength: 200, autocomplete: "off", spellcheck: "false", "aria-label": t("Room server address"), class: "net-server-url" });
  const browse = el("button", { class: "primary", "data-menu-sound": "STARTOFF" }, t("Browse rooms"));
  const browseServer = (address) => {
    if (!address) { say(t("Type a room server's address."), true); return; }
    saveNet({ serverUrl: address, recentServers: rememberServer(context.settings.net?.recentServers, address) });
    context.router.go("rooms", {}, { replace: true });
  };
  browse.addEventListener("click", () => browseServer(serverUrl.value.trim()));
  serverUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); browse.click(); } });
  // The default servers, then the ones used before: one click browses one.
  const serverList = el("ul", { class: "net-server-list", "aria-label": t("Room servers") },
    ...roomServerList(net).map((address) => el("li", {},
      el("button", {
        type: "button", class: address === net.serverUrl ? "net-server current" : "net-server", "data-menu-sound": "STARTOFF",
        onclick: () => { serverUrl.value = address; browseServer(address); },
      }, address))));
  const rooms = el("section", { class: "net-card net-card-main" },
    el("h2", {}, t("Online rooms")),
    el("p", { class: "muted" }, t("Join or create an online room on an OpenMTM2 server.")),
    el("div", { class: "net-field" }, el("span", {}, `${t("Server")} `), serverUrl, browse),
    serverList,
  );

  const byConnection = { dplay: [], cp3: [] };
  const dplayOnly = (node) => (byConnection.dplay.push(node), node);
  const cp3Only = (node) => (byConnection.cp3.push(node), node);
  const classic = el("section", { class: "net-card" },
    el("h2", {}, t("Classic TCP/IP")),
    el("p", { class: "muted" }, t("Plays with Monster Truck Madness 2 itself and with other OpenMTM2 players. DirectPlay plays with every version (2.00.42, the patched game, Community Patch 3); CP3 direct connect is Community Patch 3's own UDP connection.")),
    el("div", { class: "form-row" }, helperState, el("label", {}, `${t("Pairing token")} `, token)),
    help,
    el("label", { class: "net-field" }, `${t("Connection")} `, connection),
    el("div", { class: "net-columns" },
      el("div", {},
        el("h3", {}, t("Host a game")),
        dplayOnly(el("label", { class: "net-field" }, `${t("Game name")} `, name)),
        dplayOnly(el("label", { class: "net-field" }, `${t("Players")} `, players)),
        dplayOnly(el("label", { class: "net-check" }, migrate, ` ${t("Another player hosts if you leave")}`)),
        cp3Only(el("label", { class: "net-field" }, `${t("UDP port")} `, cp3Port)),
        el("div", { class: "screen-actions" }, hostButton)),
      el("div", {},
        el("h3", {}, t("Join a game")),
        el("label", { class: "net-field" }, `${t("Host")} `, hostIp),
        cp3Only(el("label", { class: "net-field" }, `${t("Port")} `, cp3JoinPort)),
        dplayOnly(el("div", { class: "screen-actions" }, findButton, autoButton)),
        cp3Only(el("div", { class: "screen-actions" }, cp3JoinButton)),
        dplayOnly(sessions))),
  );
  const showConnection = () => {
    for (const n of byConnection.dplay) n.hidden = cp3();
    for (const n of byConnection.cp3) n.hidden = !cp3();
  };
  connection.addEventListener("change", () => { saveNet({ classicKind: connection.value }); showConnection(); say(""); });
  showConnection();

  const ui = await frame(container, context, {
    title: msg("Multiplayer"), backdrop: "NETWORK", current: "multi",
    regions: { connect: [33, 100, 573, 300] },
    modernRegions: { connect: [24, 70, 592, 330] },
  });
  ui.regions.connect.classList.add("net-connect");
  ui.regions.connect.append(rooms, classic, message);
  // Online rooms come first; Classic TCP/IP is the other way to play, behind a button at the top, as the Races
  // screen's Tournament is. The choice lasts while the app is open.
  const viewButton = el("button", { class: "stage-event stage-tourney", "data-menu-sound": "STARTOFF" });
  const showView = () => {
    const isClassic = context.netView === "classic";
    rooms.hidden = isClassic;
    classic.hidden = !isClassic;
    viewButton.textContent = isClassic ? t("Online rooms") : t("Classic TCP/IP");
    say("");
  };
  viewButton.addEventListener("click", () => { context.netView = context.netView === "classic" ? "rooms" : "classic"; showView(); });
  ui.regions.connect.parentElement.append(viewButton);
  showView();
  checkHelper();
  const poll = setInterval(() => { if (context.netView === "classic" && !context.netHelper?.alive) checkHelper(); }, 3000);
  return { unmount() { disposed = true; clearInterval(poll); viewButton.remove(); ui.unmount?.(); } };
}
