/*
  Chat over a network race, laid out as multiplayer shooters lay theirs (game/chat.js has the rules):

  - The feed, bottom left: the last few lines, each fading after a few seconds. A sender's name is in their team's
    colour, or their truck's; team and private lines are tagged, notices dim. A repeated line counts up ("x3"), and one
    sender's run of lines is held to three.
  - The box (the Chat key, Enter, or Team chat, K): the game's 20-line history behind it, Page Up and Page Down to scroll
    it (the game's View Next and View Prev Chat), Tab to change who it sends to (All, Team, Reply), the characters left,
    and the commands /w, /r, /t, /a, /mute, /unmute and /help. Enter sends, Escape closes.
  - The quick-message wheel for a gamepad: hold View (Back) while driving, point the right stick, let go to send.
  - The players' latency, top right, while Options, Multiplayer, Latency display is on.
  - A player leaving, told once in the chat and in the race's caption.

  Team lines go to the teammates the race knows (an extension mode's teams) where the room server routes them
  (`session.canTeamChat()`); the classic game has no team channel.
*/
import { el } from "./dom.js";
import { choosePad } from "../game/input/gamepad.js";
import { saveSettings } from "../app/settings.js";
import { TEAM_COLOURS } from "../game/extensions/teams.js";
import {
  CHAT_HELP, CHAT_HISTORY, CHAT_MAX, QUICK_MESSAGES, chatChannels, chatSettings, chatShown, feedAdd, feedLive, feedOpacity,
  nextChannel, parseChat, setMuted, wheelSlot,
} from "../game/chat.js";
import { msg } from "../game/strings.js";
import { latencyMs } from "../net/legacy-session.js";

/** The trucks' own colours, by entrant, for a name with no team. */
const TRUCK_COLOURS = Object.freeze(["#ffd23f", "#7fd6ff", "#ff9f5a", "#b98cff", "#7ff09a", "#ff7fb4", "#f2f2f2", "#5ae0d0"]);
/** The standard mapping's View (Back) button, and the right stick's axes. */
const PAD_VIEW = 8, STICK_X = 2, STICK_Y = 3;
const CHANNEL_NAMES = { all: msg("All"), team: msg("Team"), reply: msg("Reply") };

/**
 * @param {object} o
 * @param {object} o.context the app (settings, t, net, padDriving)
 * @param {HTMLElement} o.view the race's view, the overlay's parent
 * @param {{ name: string, member?: number|null, computer?: boolean }[]} o.entrants the race's trucks, the player's first
 * @param {(i: number) => number|null} o.teamOf entrant i's team, or null when the race has no teams
 * @param {(text: string) => void} [o.caption] shows a line in the race's caption (a player leaving)
 */
export function createRaceChat({ context, view, entrants, teamOf = () => null, caption = () => {} }) {
  const { t } = context;
  const net = context.net;
  const session = net?.session;
  const options = () => chatSettings(context.settings.net);
  const maxLength = CHAT_MAX[net?.kind === "rooms" ? "rooms" : "classic"];

  const feedBox = el("div", { class: "race-chat", "aria-live": "polite" });
  const history = el("div", { class: "race-chat-history" });
  const chip = el("button", { type: "button", class: "race-chat-channel", tabindex: "-1", title: t("Tab: who the line goes to") });
  const input = el("input", { class: "race-chat-entry", type: "text", maxlength: maxLength, autocomplete: "off", spellcheck: "false", "aria-label": t("Message") });
  const counter = el("span", { class: "race-chat-count" });
  const box = el("div", { class: "race-chat-box", hidden: true }, history, el("div", { class: "race-chat-line" }, chip, input, counter));
  const wheelItems = QUICK_MESSAGES.map((text, i) => {
    const angle = (i / QUICK_MESSAGES.length) * 2 * Math.PI;
    return el("div", { class: "race-chat-wheel-item", style: `left: ${50 + 40 * Math.sin(angle)}%; top: ${50 - 40 * Math.cos(angle)}%` }, t(text));
  });
  const wheel = el("div", { class: "race-chat-wheel", hidden: true, "aria-hidden": "true" }, el("div", { class: "race-chat-wheel-hint" }, t("Quick message")), ...wheelItems);
  // The players' latency, top right (Options, Multiplayer, Latency display).
  const ping = el("div", { class: "race-ping", hidden: true, "aria-label": t("Latency") });
  view.append(feedBox, box, wheel, ping);

  let feed = [], channel = "all", disposed = false, frame = 0;
  const api = { typing: false };

  // ---- Who is who ----
  const indexOf = (line) => (line.own ? 0 : entrants.findIndex((e) => e.member != null && e.member === line.from));
  const colourOf = (line) => {
    const i = indexOf(line);
    if (i < 0) return TRUCK_COLOURS[6];
    const team = teamOf(i);
    return team != null ? TEAM_COLOURS[team % TEAM_COLOURS.length] : TRUCK_COLOURS[i % TRUCK_COLOURS.length];
  };
  /** The other people on the player's team, as member ids. */
  const teammates = () => {
    const mine = teamOf(0);
    if (mine == null) return [];
    return entrants.flatMap((e, i) => (i > 0 && !e.computer && e.member != null && teamOf(i) === mine ? [e.member] : []));
  };
  const channels = () => chatChannels({ team: !!session?.canTeamChat?.() && teammates().length > 0, reply: !!net?.lastPrivate });
  const others = () => (session?.state().players ?? []).filter((p) => !p.local && !p.computer);

  // ---- Drawing ----
  function lineNode(line, count = 1) {
    if (line.notice) return el("div", { class: "race-chat-row race-chat-notice" }, line.text);
    const tag = line.team ? t("[Team]") : line.private ? (line.own ? t("[Private]") : t("[From]")) : line.quick ? t("[Quick]") : null;
    return el("div", { class: `race-chat-row${line.team ? " is-team" : line.private ? " is-private" : ""}` },
      tag ? el("span", { class: "race-chat-tag" }, tag) : null,
      el("span", { class: "race-chat-name", style: `color: ${colourOf(line)}` }, line.name), ": ",
      el("span", { class: "race-chat-text" }, line.text),
      count > 1 ? el("span", { class: "race-chat-count-badge" }, ` x${count}`) : null);
  }
  function drawFeed(now = performance.now()) {
    const { fadeS } = options();
    feed = feedLive(feed, now, fadeS);
    // While the box is open its history shows every line; the feed steps aside.
    feedBox.hidden = api.typing;
    feedBox.replaceChildren(...feed.map((item) => {
      const node = lineNode(item.line, item.count);
      node.style.opacity = String(feedOpacity(item, now, fadeS));
      return node;
    }));
  }
  function drawHistory() {
    const { mode } = options();
    const lines = (net?.log ?? []).filter((line) => chatShown(line, mode)).slice(-CHAT_HISTORY);
    history.replaceChildren(...lines.map((line) => lineNode(line)));
    history.scrollTop = history.scrollHeight;
  }
  function drawChannel() {
    chip.textContent = t(CHANNEL_NAMES[channel]) + (channel === "reply" && net?.lastPrivate ? ` ${net.lastPrivate.name}` : "");
    box.dataset.channel = channel;
  }
  const drawCount = () => { counter.textContent = String(maxLength - input.value.length); };

  // A player leaving is announced once, in the chat and the caption, whichever tells of it first: the race's own
  // "gone" event or the session's notice.
  const leftAt = new Map();
  const LEFT_WINDOW_MS = 8000;
  /** Whether `name` leaving has been told already; marks it told. */
  const toldLeft = (name) => {
    const key = String(name).toLowerCase(), at = performance.now();
    const before = leftAt.get(key);
    leftAt.set(key, at);
    return before !== undefined && at - before < LEFT_WINDOW_MS;
  };
  api.left = (name) => {
    if (disposed || toldLeft(name)) return;
    const text = `${name} ${t("has left the race")}.`;
    caption(text);
    show({ name: "", text, notice: true, code: "left", who: name, told: true });
  };

  /** A line in the feed (and in the history, while the box is open). */
  function show(line) {
    if (disposed) return;
    if (line.notice && line.code === "left" && line.who && !line.told) {
      if (toldLeft(line.who)) return;
      caption(line.text);
    }
    if (!chatShown(line, options().mode)) return;
    feed = feedAdd(feed, line, performance.now(), options().lines);
    drawFeed();
    if (api.typing) drawHistory();
  }
  /** A line only this player sees: a command's answer. */
  const tell = (text) => show({ name: "", text, notice: true });

  // ---- Sending ----
  function send(text) {
    const said = parseChat(text, others().map((p) => p.name));
    const toChannel = (words) => {
      if (channel === "team") return sendTeam(words);
      if (channel === "reply" && net?.lastPrivate) return session.chat(words, net.lastPrivate.from);
      return session.chat(words);
    };
    function sendTeam(words) {
      if (!session.canTeamChat?.()) return tell(t("This game has no team chat."));
      const ids = teammates();
      if (!ids.length) return tell(t("You have no teammates in this race."));
      session.teamChat(words, ids);
    }
    switch (said.kind) {
      case "say": if (said.text) toChannel(said.text); return;
      case "team": return sendTeam(said.text);
      case "reply":
        if (!net?.lastPrivate) return tell(t("Nobody has sent you a private line yet."));
        return session.chat(said.text, net.lastPrivate.from);
      case "whisper": {
        const to = others().find((p) => p.name === said.name);
        return to ? session.chat(said.text, to.dpid) : tell(t("No player is called <<1>>.", said.name));
      }
      case "noPlayer": return tell(t("No player is called <<1>>.", said.text));
      case "mute": case "unmute": {
        const muted = setMuted(options().muted, said.name, said.kind === "mute");
        context.settings.net = { ...context.settings.net, muted };
        saveSettings(context.settings);
        return tell(said.kind === "mute" ? t("<<1>> is muted.", said.name) : t("<<1>> is no longer muted.", said.name));
      }
      case "help": for (const line of CHAT_HELP) tell(t(line)); return;
      case "usage": return tell(t("/<<1>> needs more words. /help lists the commands.", said.command));
      default: return tell(t("No command /<<1>>. /help lists the commands.", said.name));
    }
  }

  // ---- The box ----
  api.open = (wanted = "all") => {
    if (disposed || options().mode === "off") return;
    const available = channels();
    channel = available.includes(wanted) ? wanted : "all";
    api.typing = true;
    box.hidden = false;
    input.value = "";
    drawChannel();
    drawCount();
    drawHistory();
    drawFeed();
    input.focus();
  };
  api.close = () => {
    api.typing = false;
    box.hidden = true;
    input.blur();
    drawFeed();
  };
  // The keys typed go to the message, not to the truck.
  for (const type of ["keydown", "keyup"]) input.addEventListener(type, (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const text = input.value.trim();
      if (text) send(text);
      api.close();
    } else if (e.key === "Escape") { e.preventDefault(); api.close(); }
    else if (e.key === "Tab") { e.preventDefault(); channel = nextChannel(channel, channels()); drawChannel(); }
    else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      history.scrollBy({ top: (e.key === "PageUp" ? -1 : 1) * Math.max(40, history.clientHeight - 20) });
    }
  });
  input.addEventListener("input", drawCount);
  input.addEventListener("blur", () => { if (api.typing) api.close(); });
  chip.addEventListener("mousedown", (e) => { e.preventDefault(); channel = nextChannel(channel, channels()); drawChannel(); });

  // ---- The latency panel ----
  const pingClass = (ms) => (ms === null ? "" : ms < 120 ? "good" : ms < 250 ? "fair" : "poor");
  function drawPing() {
    const on = context.settings.net?.latencyDisplay !== false && !!session;
    ping.hidden = !on;
    if (!on) return;
    const players = (session.state().players ?? []).filter((p) => !p.computer);
    ping.replaceChildren(...players.map((p) => {
      const ms = latencyMs(p);
      return el("div", { class: `race-ping-row ${pingClass(ms)}` },
        el("span", { class: "race-ping-name" }, p.name), el("span", { class: "race-ping-ms" }, ms === null ? (p.local ? t("Local") : "-") : `${ms} ms`));
    }));
  }

  // ---- The gamepad's wheel, and the fading ----
  let wheelOpen = false, slot = -1, lastDraw = 0, lastPing = -Infinity;
  const loop = (now) => {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    if (feed.length && now - lastDraw > 100) { lastDraw = now; drawFeed(now); }
    if (now - lastPing > 1000) { lastPing = now; drawPing(); }
    const pad = navigator.getGamepads ? choosePad([...navigator.getGamepads()]) : null;
    const held = !!pad?.buttons[PAD_VIEW]?.pressed && pad.mapping === "standard";
    let driving = false;
    try { driving = !!context.padDriving?.(); } catch { driving = false; }
    if (held && !wheelOpen && driving && options().mode !== "off") { wheelOpen = true; wheel.hidden = false; }
    if (!wheelOpen) return;
    if (held) {
      slot = wheelSlot(pad.axes[STICK_X] ?? 0, pad.axes[STICK_Y] ?? 0);
      wheelItems.forEach((item, i) => item.classList.toggle("selected", i === slot));
      return;
    }
    // Let go: the message pointed at goes, nothing with the stick at rest.
    wheelOpen = false;
    wheel.hidden = true;
    if (slot >= 0) session?.quick(t(QUICK_MESSAGES[slot]));
    slot = -1;
  };
  frame = requestAnimationFrame(loop);

  // The session's lines, as they come (app/net.js keeps the log the box shows).
  if (net) net.onLine = show;
  api.show = show;
  api.notice = tell;
  api.dispose = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    if (net && net.onLine === show) net.onLine = null;
    feedBox.remove(); box.remove(); wheel.remove(); ping.remove();
  };
  return api;
}
