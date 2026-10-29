/*
  The in-game console in a network race (ui/console.js, ui/screens/race.js). Only commands that act at once are kept:
  one that starts the race again (overlap, backdrop, physics, truck, addbot...) would put this machine alone in a new
  race while the others race on with its truck left behind, and one that changes the race itself (laps, finish,
  weather, map) would make this machine's race differ from the others'.

  It adds the players' commands: `players` lists them, `mute` and `unmute` leave a player's chat out or put it back
  (game/chat.js), `kick` removes a player (the host or room owner only), `say` and `team` chat.
*/
import { msg } from "../game/strings.js";
import { chatSettings, isMuted, setMuted } from "../game/chat.js";

/** The race's own commands a network race keeps: none of them restarts the race or changes it for the others. */
export const NET_CONSOLE_COMMANDS = Object.freeze(new Set(["info", "bots", "music", "sound", "fps", "distance", "exit", "quit", "fly", "watch", "help", "clear"]));

/** `commands` without those a network race cannot use. Returns the same object. */
export function keepNetCommands(commands) {
  for (const name of Object.keys(commands)) if (!NET_CONSOLE_COMMANDS.has(name)) delete commands[name];
  return commands;
}

/**
 * The player `word` names among `players` (the others, as `players` lists them): its number in that list, or its name
 * (exact, any case, else the only one it starts). Returns the player, or a reason (a tag) as `{ error, args }`.
 */
export function findPlayer(players, word) {
  const w = String(word ?? "").trim();
  if (!w) return { error: msg("Name a player, or give their number in players.") };
  if (/^\d+$/.test(w)) return players[Number(w) - 1] ?? { error: msg("No player number <<1>>."), args: [w] };
  const lower = w.toLowerCase();
  const exact = players.find((p) => p.name.toLowerCase() === lower);
  if (exact) return exact;
  const starts = players.filter((p) => p.name.toLowerCase().startsWith(lower));
  if (starts.length === 1) return starts[0];
  return starts.length ? { error: msg("More than one player's name starts with <<1>>."), args: [w] } : { error: msg("No player is called <<1>>."), args: [w] };
}

/**
 * The players' commands.
 * @param {object} context the app: `net.session`, `settings`, `t`
 * @param {{ save: (settings: object) => void, latency?: (p: object) => string }} options
 */
export function netConsoleCommands(context, { save, latency = () => "" }) {
  const t = context.t;
  const session = () => context.net?.session ?? null;
  /** Everyone in the game, this player first, then the others in the session's order. */
  const everyone = () => {
    const list = session()?.state().players ?? [];
    return [...list.filter((p) => p.local), ...list.filter((p) => !p.local)];
  };
  const others = () => everyone().filter((p) => !p.local && !p.computer);
  const pick = (rest) => {
    const found = findPlayer(others(), rest);
    if (found.error) throw new Error(t(found.error, ...(found.args ?? [])));
    return found;
  };
  const muted = () => chatSettings(context.settings.net).muted;
  const setMute = (name, on) => {
    context.settings.net = { ...context.settings.net, muted: setMuted(muted(), name, on) };
    save(context.settings);
  };
  return {
    players: {
      help: msg("lists the players: number (for mute and kick), name, truck and latency"),
      run: () => {
        const list = everyone();
        if (!list.length) return t("Not in a network game.");
        let n = 0;
        return list.map((p) => {
          const number = p.local || p.computer ? " " : String(++n);
          const marks = [p.isHost ? t("host") : null, p.local ? t("you") : null, p.computer ? t("computer") : null, isMuted(muted(), p.name) ? t("muted") : null].filter(Boolean);
          return `${number.padStart(2)}  ${p.name.padEnd(16)} ${String(p.truck ?? "").padEnd(14)} ${latency(p).padEnd(10)} ${marks.length ? `(${marks.join(", ")})` : ""}`.trimEnd();
        }).join("\n");
      },
    },
    mute: {
      usage: "mute <n|name>", help: msg("leaves a player's chat out, in the race and in the lobby"),
      complete: () => others().map((p) => p.name),
      run: (args, rest) => { const p = pick(rest); setMute(p.name, true); return t("<<1>> is muted.", p.name); },
    },
    unmute: {
      usage: "unmute <n|name>", help: msg("shows a muted player's chat again"),
      complete: () => muted(),
      run: (args, rest) => {
        // A muted player may have left: a name on the list is enough.
        const name = muted().find((m) => m.toLowerCase() === rest.trim().toLowerCase()) ?? pick(rest).name;
        setMute(name, false);
        return t("<<1>> is no longer muted.", name);
      },
    },
    kick: {
      usage: "kick <n|name>", help: msg("removes a player from the game (the host only)"),
      complete: () => others().map((p) => p.name),
      run: (args, rest) => {
        const s = session();
        if (!s) return t("Not in a network game.");
        if (!s.isHost()) return t("Only the host can remove players.");
        const p = pick(rest);
        s.kick(p.dpid);
        return t("Removing <<1>>.", p.name);
      },
    },
    say: {
      usage: "say <text>", help: msg("says a line to everyone"),
      run: (args, rest) => { if (!rest) return t("Usage: <<1>>", "say <text>"); session()?.chat(rest); return null; },
    },
  };
}
