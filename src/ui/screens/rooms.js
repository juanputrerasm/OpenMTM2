/*
  Online rooms (docs/MULTIPLAYER.md): the rooms on an OpenMTM2 server, to join or to make. The
  room itself is the Multiplayer screen, as for a classic game.

  params.invite = { code, server }: an invite link (`?room=CODE&server=address`) joins at once.
*/
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { saveSettings } from "../../app/settings.js";
import { roomServer, listRooms, createRoom, joinRoom, rememberServer } from "../../app/net.js";
import { getProfiles } from "../../app/profile-store.js";
import { currentDriver } from "../../game/profile.js";
import { msg } from "../../game/strings.js";

const STATE_TEXT = { lobby: msg("Waiting"), loading: msg("Loading"), racing: msg("Racing") };

export default async function mount(container, context, params = {}) {
  if (context.net) { context.router.go("multiplayer", {}, { replace: true }); return {}; }
  const { t } = context;
  const invite = params.invite ?? null;
  const address = invite?.server || context.settings.net?.serverUrl || "";
  if (!address) { context.router.go("net-connect", {}, { replace: true }); return {}; }
  const driver = currentDriver(await getProfiles(context));
  // The name MTM2 gives a hosted game (MONSTER_EXE_ANALYSIS.md 14.3, RC 11000).
  const defaultName = t("<<1>>'s Truckin' Game", driver.name).slice(0, 40);
  let disposed = false, server = null, rooms = [], poll = null;

  const message = el("p", { class: "net-message", "aria-live": "polite" });
  const say = (text, error = false) => { message.textContent = text ?? ""; message.classList.toggle("error", !!error); };
  const busy = (button, work) => async () => {
    button.disabled = true;
    try { await work(); } catch (err) { say(t(err?.message ?? String(err)), true); } finally { if (!disposed) button.disabled = false; }
  };
  const enter = () => context.router.go("multiplayer", {}, { replace: true });

  // ---- The server ----
  const serverLine = el("div", { class: "net-server-line" }, t("Connecting to <<1>>…", address));
  const motd = el("p", { class: "net-motd", hidden: true });
  const change = el("button", { "data-menu-sound": "STARTOFF" }, t("Change server"));
  change.addEventListener("click", () => { context.netRooms?.server.close(); context.router.go("net-connect", {}, { replace: true }); });

  // ---- The list ----
  const table = el("table", { class: "results net-rooms" });
  async function join(code, locked) {
    const password = locked ? window.prompt(t("This room has a password:")) : "";
    if (locked && password === null) return false;
    say(t("Joining <<1>>…", code));
    await joinRoom(context, code, password ?? "");
    enter();
    return true;
  }
  function show() {
    table.replaceChildren(
      el("thead", {}, el("tr", {}, ...[msg("Room"), msg("Players"), msg("Track"), "", ""].map((h) => el("th", {}, h && t(h))))),
      el("tbody", {}, ...(rooms.length ? rooms.map((r) => {
        const b = el("button", { "data-menu-sound": "STARTOFF", disabled: r.state !== "lobby" || r.players >= r.maxPlayers }, t("Join"));
        b.addEventListener("click", busy(b, () => join(r.code, r.locked)));
        return el("tr", {},
          el("td", { title: r.classic ? t("Owner: <<1>>. Open to classic MTM2 players.", r.owner) : t("Owner: <<1>>", r.owner) }, `${r.locked ? "🔒 " : ""}${r.name}${r.classic ? ` (${t("Classic")})` : ""}`),
          el("td", {}, `${r.players}/${r.maxPlayers}`),
          el("td", {}, r.track?.name ?? t("Not chosen")),
          el("td", {}, STATE_TEXT[r.state] ? t(STATE_TEXT[r.state]) : r.state),
          el("td", {}, b));
      }) : [el("tr", {}, el("td", { colspan: 5, class: "muted" }, t("No open rooms. Make one!")))])),
    );
  }
  async function refresh() {
    rooms = await listRooms(context);
    if (!disposed) show();
  }
  const refreshButton = el("button", {}, t("Refresh"));
  refreshButton.addEventListener("click", busy(refreshButton, refresh));
  const quickButton = el("button", { title: t("Join the fullest open room, or make one") }, t("Quick Join"));
  quickButton.addEventListener("click", busy(quickButton, async () => {
    await refresh();
    const open = rooms.filter((r) => r.state === "lobby" && !r.locked && r.players < r.maxPlayers).sort((a, b) => b.players - a.players);
    if (open.length) return join(open[0].code, false);
    say(t("No open room; making one…"));
    await createRoom(context, { name: roomName.value.trim() || defaultName, maxPlayers: Number(maxPlayers.value) });
    enter();
  }));

  // ---- Create a room ----
  const roomName = el("input", { type: "text", maxlength: 40, value: defaultName, "aria-label": t("Room name") });
  const password = el("input", { type: "text", maxlength: 32, placeholder: t("none"), autocomplete: "off", "aria-label": t("Password") });
  const maxPlayers = el("select", { "aria-label": t("Players") });
  const listed = el("input", { type: "checkbox", checked: true, "aria-label": t("Show in the list") });
  // Rooms that Monster Truck Madness 2 itself joins by the server's address, when the server runs its gateway.
  const classic = el("input", { type: "checkbox", "aria-label": t("Open to classic MTM2 players") });
  const classicRow = el("label", { class: "net-check", hidden: true, title: t("Players of the original game join with the server's address, as with any host. Up to 8 players, no computer opponents.") },
    classic, ` ${t("Open to classic MTM2 players (up to 8)")}`);
  classic.addEventListener("change", () => {
    if (classic.checked && Number(maxPlayers.value) > 8) maxPlayers.value = "8";
    for (const o of maxPlayers.options) o.disabled = classic.checked && Number(o.value) > 8;
  });
  const createButton = el("button", { class: "primary", "data-menu-sound": "STARTOFF" }, t("Create Room"));
  createButton.addEventListener("click", busy(createButton, async () => {
    say(t("Making the room…"));
    await createRoom(context, { name: roomName.value.trim() || defaultName, password: password.value.trim(), maxPlayers: Number(maxPlayers.value), public: listed.checked, classic: classic.checked });
    enter();
  }));

  // ---- Join by code ----
  const code = el("input", { type: "text", maxlength: 6, placeholder: t("Code"), autocomplete: "off", spellcheck: "false", "aria-label": t("Room code"), class: "net-code" });
  const codePassword = el("input", { type: "text", maxlength: 32, placeholder: t("Password"), autocomplete: "off", "aria-label": t("Room password") });
  const codeButton = el("button", { "data-menu-sound": "STARTOFF" }, t("Join"));
  codeButton.addEventListener("click", busy(codeButton, async () => {
    say(t("Joining <<1>>…", code.value.trim().toUpperCase()));
    await joinRoom(context, code.value, codePassword.value.trim());
    enter();
  }));
  code.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); codeButton.click(); } });

  const body = el("section", { class: "net-card" },
    el("div", { class: "form-row net-server-row" }, serverLine, change),
    motd,
    el("div", { class: "net-columns" },
      el("div", {},
        el("h3", {}, t("Create a room")),
        el("label", { class: "net-field" }, `${t("Name")} `, roomName),
        el("label", { class: "net-field" }, `${t("Password")} `, password),
        el("label", { class: "net-field" }, `${t("Players")} `, maxPlayers),
        el("label", { class: "net-check" }, listed, ` ${t("Show it in the list (otherwise by code only)")}`),
        classicRow,
        el("div", { class: "screen-actions" }, createButton),
        el("h3", {}, t("Join by code")),
        el("div", { class: "net-field" }, code, codePassword, codeButton)),
      el("div", {},
        el("h3", {}, t("Rooms")),
        el("div", { class: "screen-actions" }, refreshButton, quickButton),
        table)),
  );

  const ui = await frame(container, context, {
    title: msg("Online rooms"), backdrop: "NETWORK", current: "multi",
    regions: { connect: [33, 100, 573, 300] },
    modernRegions: { connect: [24, 70, 592, 330] },
  });
  ui.regions.connect.classList.add("net-connect");
  ui.regions.connect.append(body, message);
  show();

  try {
    server = await roomServer(context, address);
    if (disposed) return { unmount };
    const info = server.info.server;
    serverLine.textContent = `${info.name} (${server.url.replace(/^wss?:\/\//, "").replace(/\/play$/, "")})`;
    if (info.motd) { motd.textContent = info.motd; motd.hidden = false; }
    classicRow.hidden = !server.info.features?.includes("classic");
    const limit = server.info.limits?.maxPlayers ?? 8;
    maxPlayers.replaceChildren(...Array.from({ length: limit - 1 }, (_, i) => i + 2).map((n) => el("option", { value: n, selected: n === Math.min(8, limit) }, String(n))));
    if (invite?.server && context.settings.net?.serverUrl !== invite.server) {
      context.settings.net = { ...context.settings.net, serverUrl: invite.server, recentServers: rememberServer(context.settings.net?.recentServers, invite.server) };
      saveSettings(context.settings);
    }
  } catch (err) {
    serverLine.textContent = t("Not connected to <<1>>.", address);
    say(t(err?.message ?? String(err)), true);
    return { unmount };
  }
  if (invite?.code) {
    code.value = invite.code;
    try {
      if (await join(invite.code, false).catch((err) => (err.code === "password" ? join(invite.code, true) : Promise.reject(err)))) return { unmount };
    } catch (err) {
      say(t("Room <<1>>: <<2>>", invite.code, t(err?.message ?? String(err))), true);
    }
  }
  await refresh().catch((err) => say(t(err?.message ?? String(err)), true));
  poll = setInterval(() => { if (server?.alive && !disposed) listRooms(context).then((r) => { rooms = r; if (!disposed) show(); }).catch(() => {}); }, 10000);
  function unmount() { disposed = true; clearInterval(poll); ui.unmount?.(); }
  return { unmount };
}
