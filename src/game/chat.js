/*
  Chat in a network race (ui/race-chat.js): what it shows, how lines collapse, the typed commands, the channels and the
  gamepad's quick-message wheel. The game keeps a 20-line in-race buffer and has View Next and View Prev Chat keys to
  read back through it (MONSTER_EXE_ANALYSIS.md 11 and 14); the feed over the race fades as an FPS game's does.

  Settings live in `settings.net` (merged shallowly, so every field is read with its default here):
    chat       "all" (every line), "team" (team and private lines, and notices), "off" (no chat in the race). Older
               settings stored true or false (the game's networkChatFlag).
    chatLines  how many lines the feed shows at once, 3 to 10
    chatFadeS  how long a line stays in the feed, seconds, 4 to 30
    muted      the names whose lines are left out, in the lobby and in the race

  Pure: runs under Node in tests.
*/
import { msg } from "./strings.js";

export const CHAT_MODES = Object.freeze(["all", "team", "off"]);
/** The game's in-race buffer, the history the open chat box scrolls through. */
export const CHAT_HISTORY = 20;
/** A run of lines from one sender longer than this pushes out its own oldest, so one player cannot fill the feed. */
export const CHAT_RUN = 3;
/** The longest line each kind of session carries (the game's 0x80 packet holds 81 characters, a room 160). */
export const CHAT_MAX = Object.freeze({ classic: 81, rooms: 160 });

const clampInt = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : fallback);

/** The chat settings, each with its default. */
export function chatSettings(net = {}) {
  const raw = net?.chat;
  const mode = raw === false ? "off" : CHAT_MODES.includes(raw) ? raw : "all";
  const muted = Array.isArray(net?.muted) ? net.muted.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim()) : [];
  return { mode, lines: clampInt(net?.chatLines, 3, 10, 6), fadeS: clampInt(net?.chatFadeS, 4, 30, 8), muted };
}

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export const isMuted = (muted, name) => !!name && (muted ?? []).some((m) => sameName(m, name));

/** `muted` with `name` added (`on`) or taken out. */
export function setMuted(muted, name, on) {
  const kept = (muted ?? []).filter((m) => !sameName(m, name));
  return on && String(name ?? "").trim() ? [...kept, String(name).trim()] : kept;
}

/** Whether the race shows `line` under chat mode `mode`. Notices and one's own lines always show while chat is on. */
export function chatShown(line, mode) {
  if (mode === "off") return false;
  if (mode === "team") return !!(line.notice || line.own || line.private || line.team);
  return true;
}

/**
 * The feed with `line` added at `now` (ms): a line repeating the one before it from the same sender adds to its count
 * ("gg x3"); a run of more than `CHAT_RUN` lines from one sender drops the run's oldest; then the oldest past `max` go.
 * Each item is `{ line, count, at }`. Returns a new array.
 */
export function feedAdd(feed, line, now, max = 6) {
  const out = [...feed];
  const last = out.at(-1);
  const key = (l) => (l.notice ? null : `${l.from ?? l.name}`);
  if (last && !line.notice && key(last.line) === key(line) && last.line.text === line.text && !!last.line.private === !!line.private && !!last.line.team === !!line.team) {
    out[out.length - 1] = { line: last.line, count: last.count + 1, at: now };
  } else {
    out.push({ line, count: 1, at: now });
    if (!line.notice) {
      let run = 0;
      for (let i = out.length - 1; i >= 0 && key(out[i].line) === key(line); i--) run++;
      if (run > CHAT_RUN) out.splice(out.length - run, 1);
    }
  }
  while (out.length > max) out.shift();
  return out;
}

/** The feed's items still shown at `now`: those added within `fadeS` seconds. */
export const feedLive = (feed, now, fadeS) => feed.filter((item) => now - item.at < fadeS * 1000);

/** How far an item has faded at `now`: 1 shown, falling to 0 over its last second. */
export const feedOpacity = (item, now, fadeS) => Math.max(0, Math.min(1, (fadeS * 1000 - (now - item.at)) / 1000));

/** The channels the open box offers, in Tab order: everyone, the team (when there is one), a reply (when there is someone to reply to). */
export function chatChannels({ team = false, reply = false } = {}) {
  return ["all", ...(team ? ["team"] : []), ...(reply ? ["reply"] : [])];
}

/** The channel after `current` (Tab), round the list. */
export function nextChannel(current, available) {
  const i = available.indexOf(current);
  return available[(i + 1) % available.length] ?? "all";
}

/**
 * What a typed line asks: `{ kind: "say", text }`, or a command:
 *   /w name text  /msg name text   a private line to the player whose name the rest starts with (longest name first)
 *   /r text                        a private reply to the last player who sent one
 *   /t text  /team text            a team line
 *   /a text  /all text             a line to everyone
 *   /mute name  /unmute name       leave a player's lines out, or put them back
 *   /help  /?                      the commands
 * An unknown command is `{ kind: "unknown", name }`; a command missing its words is `{ kind: "usage", command }`.
 * `names` are the other players' names, for /w and /mute.
 */
export function parseChat(input, names = []) {
  const text = String(input ?? "").trim();
  if (!text.startsWith("/") || text.startsWith("//")) return { kind: "say", text: text.startsWith("//") ? text.slice(1) : text };
  const space = text.search(/\s/);
  const command = (space < 0 ? text.slice(1) : text.slice(1, space)).toLowerCase();
  const rest = space < 0 ? "" : text.slice(space).trim();
  /** The player `rest` starts with, the longest name that fits, and what follows it. */
  const named = () => {
    const name = [...names].sort((a, b) => b.length - a.length).find((n) => {
      const head = rest.slice(0, n.length);
      return sameName(head, n) && (rest.length === n.length || /\s/.test(rest[n.length]));
    });
    return name ? { name, after: rest.slice(name.length).trim() } : null;
  };
  switch (command) {
    case "w": case "msg": case "whisper": {
      const who = named();
      if (!who) return rest ? { kind: "noPlayer", text: rest.split(/\s/)[0] } : { kind: "usage", command };
      return who.after ? { kind: "whisper", name: who.name, text: who.after } : { kind: "usage", command };
    }
    case "r": case "reply": return rest ? { kind: "reply", text: rest } : { kind: "usage", command };
    case "t": case "team": return rest ? { kind: "team", text: rest } : { kind: "usage", command };
    case "a": case "all": return rest ? { kind: "say", text: rest } : { kind: "usage", command };
    case "mute": case "unmute": {
      if (!rest) return { kind: "usage", command };
      return { kind: command, name: named()?.name ?? rest };
    }
    case "help": case "?": return { kind: "help" };
    default: return { kind: "unknown", name: command };
  }
}

/** The commands' help, one line each (shown as notices). */
export const CHAT_HELP = Object.freeze([
  msg("/w name text: a private line. /r text: reply to the last private line."),
  msg("/t text: to your team. /a text: to everyone. Tab changes who the box sends to."),
  msg("/mute name and /unmute name: leave a player's lines out. Page Up and Page Down scroll back."),
]);

/** The quick messages of the gamepad's wheel, clockwise from the top. */
export const QUICK_MESSAGES = Object.freeze([
  msg("Good race!"), msg("Nice one!"), msg("Go go go!"), msg("Wait for me!"),
  msg("Sorry!"), msg("Help!"), msg("Thanks!"), msg("Rematch?"),
]);

/**
 * The wheel's slot a stick at (`x`, `y`) points to (`count` slots clockwise from the top, y down as the Gamepad API
 * reports it), or -1 while it rests inside `dead` of the centre.
 */
export function wheelSlot(x, y, count = QUICK_MESSAGES.length, dead = 0.5) {
  if (Math.hypot(x, y) < dead) return -1;
  const angle = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round(angle / ((2 * Math.PI) / count)) % count;
}
