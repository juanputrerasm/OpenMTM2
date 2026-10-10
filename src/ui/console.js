/*
  The in-game console (not the game's): a panel that drops from the top of the race, as in Quake III
  or Unreal Tournament, for typing commands. The key left of 1 opens and closes it, whatever it types
  on the keyboard's layout (see CONSOLE_KEYS); Escape closes it.

    Enter        runs the line
    Up, Down     the lines typed before
    Tab          completes the command's name, or its argument where the command offers a list

  A command is `{ usage, help, run(args, line), complete?(prefix) }`: `run` gets the words after the
  name and may return (or resolve to) a line of text to print; an error it throws is printed.
  While the console is open its keys do not reach the game.
*/
import { el } from "./dom.js";

const HISTORY_MAX = 50;
/**
 * The key left of 1, by its place on the keyboard, not by the character it types (`KeyboardEvent.code`): "Backquote"
 * on most keyboards. On a Mac with an ISO keyboard (Latin American, Spanish, German...) browsers report that key as
 * "IntlBackslash" and give "Backquote" to the key beside the left Shift, so both open the console.
 */
export const CONSOLE_KEYS = Object.freeze(["Backquote", "IntlBackslash"]);

/**
 * @param {{ parent: HTMLElement, window: Window, commands: Record<string, { usage?: string, help: string,
 *   run: (args: string[], line: string) => unknown, complete?: (prefix: string) => string[] | Promise<string[]> }>,
 *   history?: string[], banner?: () => string }} options `history` is kept by the caller between races; `banner` is
 *   printed the first time the console opens
 */
export function createConsole({ parent, window: win, commands, history = [], banner = null }) {
  const log = el("div", { class: "game-console-log" });
  const input = el("input", { class: "game-console-input", type: "text", spellcheck: "false", autocomplete: "off", "aria-label": "Console" });
  const panel = el("div", { class: "game-console", hidden: true }, log, el("div", { class: "game-console-line" }, el("span", {}, "]"), input));
  parent.append(panel);
  let at = history.length;

  const print = (text, cls = null) => {
    for (const line of String(text).split("\n")) log.append(el("div", { class: cls }, line));
    while (log.childElementCount > 200) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  };
  const names = () => Object.keys(commands).sort();
  commands.help ??= {
    help: "lists the commands",
    run: () => names().map((name) => `${(commands[name].usage ?? name).padEnd(22)} ${commands[name].help}`).join("\n"),
  };
  commands.clear ??= { help: "empties the console", run: () => { log.replaceChildren(); } };

  async function run(line) {
    const text = line.trim();
    if (!text) return;
    print(`] ${text}`, "game-console-echo");
    if (history[history.length - 1] !== text) history.push(text);
    if (history.length > HISTORY_MAX) history.shift();
    at = history.length;
    const [name, ...args] = text.split(/\s+/);
    const command = commands[name.toLowerCase()];
    if (!command) { print(`Unknown command "${name}". Type help.`, "game-console-error"); return; }
    try {
      const said = await command.run(args, text.slice(name.length).trim());
      if (said !== undefined && said !== null && said !== "") print(said);
    } catch (error) {
      print(error?.message ?? String(error), "game-console-error");
    }
  }

  /** Complete the word being typed: the longest common start of what fits, and the choices when there are several. */
  async function complete() {
    const text = input.value;
    const space = text.indexOf(" ");
    let prefix, options, head;
    if (space < 0) { prefix = text; options = names(); head = ""; }
    else {
      const command = commands[text.slice(0, space).toLowerCase()];
      if (!command?.complete) return;
      prefix = text.slice(space + 1);
      options = await command.complete(prefix);
      head = text.slice(0, space + 1);
    }
    const fits = options.filter((o) => o.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!fits.length) return;
    let common = fits[0];
    for (const o of fits) while (!o.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
    input.value = head + (fits.length === 1 ? `${fits[0]}${space < 0 ? " " : ""}` : common);
    if (fits.length > 1) print(fits.join("   "));
  }

  input.addEventListener("keydown", (event) => {
    // The game's own key handlers listen on the window: nothing typed here reaches them.
    event.stopPropagation();
    if (CONSOLE_KEYS.includes(event.code) || event.code === "Escape") return;
    if (event.key === "Enter") { const line = input.value; input.value = ""; run(line); }
    else if (event.key === "ArrowUp") { if (at > 0) input.value = history[--at]; event.preventDefault(); }
    else if (event.key === "ArrowDown") { at = Math.min(history.length, at + 1); input.value = history[at] ?? ""; event.preventDefault(); }
    else if (event.key === "Tab") { event.preventDefault(); complete(); }
  });

  let greeted = false;
  const setOpen = (open) => {
    panel.hidden = !open;
    if (open && !greeted) { greeted = true; print(banner ? banner() : "Type help for commands"); }
    if (open) { input.value = ""; input.focus(); log.scrollTop = log.scrollHeight; } else input.blur();
  };
  // In the capture phase, so the key works whether or not the input has the focus, and is never typed.
  const onKey = (event) => {
    if (CONSOLE_KEYS.includes(event.code) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(panel.hidden);
    } else if (event.code === "Escape" && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  win.addEventListener("keydown", onKey, true);

  return {
    element: panel,
    get open() { return !panel.hidden; },
    setOpen,
    print, run,
    dispose() { win.removeEventListener("keydown", onKey, true); panel.remove(); },
  };
}
