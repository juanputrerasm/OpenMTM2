/*
  The Multiplayer Screen (MONSTER_EXE_ANALYSIS.md 14.3, dialog 7306): the players with their
  level, truck, latency and status, the messages, and a line to send one to everyone or to one
  player. GO starts the race for the host; for the others it is Ready. The host picks the track,
  laps and weather on the Races screen.

  Classic skin: the game's NETWORK.BMP, its lists and buttons where the art has them.

  An online room (state().kind "rooms") adds its code and invite link, and for its owner the
  computer opponents; the owner (the host in a classic game) can remove a player.
*/
import { el } from "../dom.js";
import { frame, uiImageUrl } from "../frame.js";
import { applyRaceConfig, inviteLink, leaveNet, netGo, netLocation, LOCATION } from "../../app/net.js";
import { statusText, latencyText, skillText, versionText } from "../../net/legacy-session.js";
import { weatherName } from "../../game/weather.js";
import { extensionById } from "../../game/extensions/loader.js";
import { msg } from "../../game/strings.js";

export default async function mount(container, context) {
  const { t } = context;
  const net = context.net;
  if (!net) { context.router.go("net-connect", {}, { replace: true }); return {}; }
  const session = net.session;
  netLocation(context, LOCATION.MULTIPLAYER);
  // The host's track, laps and weather from the Races screen.
  applyRaceConfig(context).catch((err) => console.warn(err));
  const truckNames = new Map(net.catalog.trucks.map((t) => [t.file.toUpperCase(), t.name]));
  const truckName = (file) => truckNames.get(String(file).toUpperCase()) ?? String(file).replace(/\.TRK$/i, "") ?? "";

  const playerList = el("table", { class: "results net-players" });
  const messages = el("table", { class: "results net-messages" });
  const sendTo = el("select", { "aria-label": t("Send to"), class: "net-send-to" });
  const privateBox = el("input", { type: "checkbox", "aria-label": t("Private"), title: t("Private message"), class: "net-private" });
  const entry = el("input", { type: "text", maxlength: 81, "aria-label": t("Message"), class: "net-entry", autocomplete: "off" });
  const sendButton = el("button", { class: "net-send", "aria-label": t("Send") }, t("Send"));
  const info = el("div", { class: "net-game-info" });
  const goButton = el("button", { class: "net-go", "data-menu-sound": "GOOFF" });
  const disconnect = el("button", { class: "net-disconnect", "data-menu-sound": "STARTOFF" }, t("Disconnect"));
  const radio = el("button", { class: "net-radio", disabled: true, title: t("Voice chat is not available") }, t("CB Radio"));
  const connect = el("button", { class: "net-connect-button", disabled: true }, t("Connect"));
  let readyArt = null, notReadyArt = null;
  const rooms = session.state().kind === "rooms";
  // An online room's extras: its code with the invite link, and the owner's computer opponents.
  const inviteButton = el("button", { class: "net-small", title: t("Copy a link that opens this room") }, t("Copy invite"));
  inviteButton.addEventListener("click", async () => {
    const link = inviteLink(context, session.state().room.code);
    try { await navigator.clipboard.writeText(link); addLine({ name: "", text: t("Invite link copied."), notice: true }); } catch { window.prompt(t("The invite link:"), link); }
  });
  const computers = el("select", { class: "net-small", "aria-label": t("Computer opponents") }, ...Array.from({ length: 8 }, (_, n) => el("option", { value: n }, String(n))));
  computers.addEventListener("change", () => session.setComputers(Number(computers.value)));
  const kickButton = (p) => {
    const b = el("button", { class: "net-kick", title: t("Remove <<1>> from the game", p.name), "aria-label": t("Remove <<1>>", p.name) }, "✕");
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.confirm(t("Remove <<1>> from the game?", p.name))) session.kick(p.dpid);
    });
    return b;
  };

  function showPlayers() {
    const st = session.state();
    playerList.replaceChildren(
      el("thead", {}, el("tr", {}, ...[msg("Player"), msg("Level"), msg("Truck"), msg("Latency"), msg("Status")].map((h) => el("th", {}, t(h))))),
      el("tbody", {}, ...st.players.map((p) => el("tr", { class: p.local ? "selected" : null },
        el("td", { title: p.classicClient ? t("Playing the original Monster Truck Madness 2") : null },
          st.isHost && !p.local && !p.computer ? kickButton(p) : null,
          `${p.name}${p.isHost ? ` (${rooms ? t("Owner") : t("Host")})` : ""}${p.computer ? ` (${t("Computer")})` : ""}${p.classicClient ? ` (${t("Classic")})` : ""}${versionText(p.version)}`),
        el("td", {}, t(skillText(p.skill))),
        el("td", {}, truckName(p.truck)),
        el("td", {}, context.settings.net?.latencyDisplay === false ? "" : t(latencyText(p))),
        el("td", {}, `${t(statusText(p))}${p.missingTrack ? ` (${t("no track")})` : p.otherVersion ? ` (${t("other version")})` : ""}`),
      ))),
    );
    const chosen = sendTo.value;
    sendTo.replaceChildren(el("option", { value: "" }, t("Everyone")),
      ...st.players.filter((p) => !p.local && !p.computer).map((p) => el("option", { value: p.dpid, selected: String(p.dpid) === chosen }, p.name)));
    const g = st.game;
    if (rooms) computers.value = String(g.computers ?? 0);
    info.replaceChildren(
      rooms ? el("div", {}, el("strong", {}, `${t("Room")} `), st.room.code, st.room.locked ? " 🔒" : "", st.room.classic ? ` (${t("Classic")})` : "", " ", inviteButton) : "",
      el("div", {}, el("strong", {}, `${t("Track")}: `), g.track?.name ?? (st.isHost ? t("choose one on the Races screen") : t("not chosen yet"))),
      el("div", {}, el("strong", {}, `${t(g.mode ? extensionById(g.mode)?.length?.label ?? "Length" : "Laps")}: `), String(g.laps), "  ", el("strong", {}, `${t("Weather")}: `), g.weather < 0 ? t("Random") : t(weatherName(g.weather))),
      g.mode ? el("div", {}, el("strong", {}, `${t("Mode")}: `), t(extensionById(g.mode)?.name ?? g.mode)) : "",
      rooms && !st.room.classic ? el("div", {}, el("strong", {}, `${t("Computers")}: `), st.isHost ? computers : String(g.computers ?? 0)) : "",
    );
    const me = st.players.find((p) => p.local);
    goButton.textContent = st.isHost ? t("GO") : me?.ready ? t("Not Ready") : t("Ready");
    goButton.title = st.isHost ? (st.canStart ? t("Start the race") : t("Waiting for every player to be Ready")) : "";
    goButton.classList.toggle("blocked", st.isHost && !st.canStart);
    if (ui?.art && !st.isHost) {
      goButton.classList.add("net-go-art");
      goButton.style.backgroundImage = `url(${me?.ready ? notReadyArt : readyArt})`;
    } else if (ui?.art) {
      goButton.classList.remove("net-go-art");
      goButton.style.backgroundImage = "";
    }
  }
  function addLine(line) {
    const body = messages.tBodies[0] ?? messages.appendChild(el("tbody"));
    body.append(el("tr", { class: line.notice ? "net-notice" : line.private ? "net-private-line" : null },
      el("td", {}, line.notice ? "" : line.private && !line.own ? `${line.name} (${t("private")})` : line.name),
      el("td", {}, line.text)));
    while (body.rows.length > 60) body.deleteRow(0);
    messages.parentElement?.scrollTo?.({ top: 1e6 });
  }
  messages.append(el("thead", {}, el("tr", {}, el("th", {}, t("Received From")), el("th", {}, t("Messages")))), el("tbody"));
  for (const line of net.log) addLine(line);
  net.onLine = addLine;

  const send = () => {
    const text = entry.value.trim();
    if (!text) return;
    const to = privateBox.checked && sendTo.value ? Number(sendTo.value) : null;
    session.chat(text, to);
    entry.value = "";
  };
  sendButton.addEventListener("click", send);
  entry.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
  sendTo.addEventListener("change", () => { privateBox.checked = !!sendTo.value; });
  goButton.addEventListener("click", () => {
    const error = netGo(context);
    if (error) addLine({ name: "", text: t(error), notice: true });
  });
  disconnect.addEventListener("click", () => {
    leaveNet(context);
    // Out of a room, back to the server's list; out of a classic game, to Connect.
    context.router.go(rooms && context.netRooms?.server.alive ? "rooms" : "net-connect", {}, { replace: true });
  });
  const off = session.on("change", showPlayers);

  const ui = await frame(container, context, {
    title: net.name || msg("Multiplayer"), backdrop: "NETWORK", bar: "net", current: "multi",
    regions: {
      players: [33, 116, 573, 66], info: [380, 36, 226, 52], radio: [33, 192, 90, 20], connect: [432, 192, 86, 20], disconnect: [520, 192, 86, 20],
      messages: [33, 236, 573, 94], sendTo: [33, 372, 150, 20], private: [187, 372, 22, 20], entry: [211, 372, 334, 20], send: [549, 372, 57, 20],
      go: [508, 408, 118, 44],
    },
    modernRegions: {
      players: [24, 64, 592, 120], info: [24, 190, 592, 40], radio: [24, 236, 100, 26], connect: [400, 236, 100, 26], disconnect: [506, 236, 110, 26],
      messages: [24, 268, 592, 92], sendTo: [24, 366, 150, 28], private: [178, 366, 28, 28], entry: [210, 366, 330, 28], send: [544, 366, 72, 28],
      go: [520, 408, 96, 44],
    },
  });
  if (ui.art) {
    [readyArt, notReadyArt] = await Promise.all([uiImageUrl(context.assets, "READYBTN"), uiImageUrl(context.assets, "NREDYBTN")]);
  }
  for (const [region, node] of [["players", playerList], ["info", info], ["radio", radio], ["connect", connect], ["disconnect", disconnect], ["messages", messages], ["sendTo", sendTo], ["private", privateBox], ["entry", entry], ["send", sendButton], ["go", goButton]]) {
    ui.regions[region].classList.add("net-region");
    ui.regions[region].append(node);
  }
  container.querySelector(".stage")?.classList.add("net-lobby");
  showPlayers();
  return {
    unmount() {
      off();
      if (net.onLine === addLine) net.onLine = null;
      ui.unmount?.();
    },
  };
}
