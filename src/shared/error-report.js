/*
  Error reports: every failure the game notices goes through `reportError`, so none of them is left to the browser's
  console alone. A screen (the race) adds what it knows with `addDebugInfo` (the track, the truck, where the truck and the
  camera are), and the page shows the report in a dialog (ui/error-dialog.js) the player can copy or take a picture of.

  No DOM here: the workers' client, the render loop and the screens all report through it, and it runs under Node.
  Until a dialog is attached (`setErrorSink`), reports are kept and shown once it is.

  The report's own text is in English on purpose: it is pasted to whoever reads it. The dialog's heading and the plain
  explanation (`explainError`) are translated.
*/
import { msg } from "../game/strings.js";

/** Name to a function giving `[label, value]` rows, or null when it has nothing to say. */
const providers = new Map();
/** Each distinct error is shown once; repeats are only counted. */
const seen = new Map();
let sink = null;
const waiting = [];
/** Told of each new report (the race pauses for it). */
const listeners = new Set();

/** Be told of each report as it is made. Returns the function that stops it. */
export function onReport(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Add what part of the game knows to every report. Returns the function that takes it off again. */
export function addDebugInfo(name, rows) {
  providers.set(name, rows);
  return () => { if (providers.get(name) === rows) providers.delete(name); };
}

/** Every provider's rows, a provider that throws reported as such rather than losing the report. */
export function debugRows() {
  const out = [];
  for (const [name, rows] of providers) {
    try {
      for (const row of rows() ?? []) if (row && row[1] !== undefined && row[1] !== null && row[1] !== "") out.push([String(row[0]), String(row[1])]);
    } catch (error) {
      out.push([name, `(could not be read: ${error?.message ?? error})`]);
    }
  }
  return out;
}

/** Where the dialog takes reports. Reports made before it was attached are handed over at once. */
export function setErrorSink(show) {
  sink = show;
  while (sink && waiting.length) sink(waiting.shift());
}

/** An Error from whatever was thrown or rejected (a string, an event, nothing). */
export function asError(thrown) {
  if (thrown instanceof Error) return thrown;
  if (thrown && typeof thrown === "object" && typeof thrown.message === "string") return Object.assign(new Error(thrown.message), thrown);
  return new Error(thrown === undefined ? "An unknown error (nothing was thrown)" : String(thrown));
}

/** What makes two errors the same one: the message and the first line of the stack that names a place. */
export function errorKey(error) {
  const place = String(error.workerStack ?? error.stack ?? "").split("\n").find((line) => /:\d+:\d+/.test(line))?.trim() ?? "";
  return `${error.message}|${place}`;
}

/**
 * Report a failure. `where` says what the game was doing ("render frame", "simulation step"), `fatal` that the game
 * cannot go on from it. Returns the report, or null when the same error was already shown (it is then counted).
 */
export function reportError(thrown, { where = "", fatal = false } = {}) {
  const error = asError(thrown);
  // A request cut short on purpose (a worker stopped as its screen closed) is not a failure.
  if (error.expected) return null;
  const key = errorKey(error);
  const before = seen.get(key);
  if (before) {
    before.count++;
    before.onRepeat?.(before.count);
    return null;
  }
  // Still in the console, for whoever has it open.
  try { console.error(where ? `OpenMTM2 error (${where}):` : "OpenMTM2 error:", error); } catch { /* no console */ }
  const report = {
    error, where, fatal, at: new Date(), count: 1, onRepeat: null,
    explain: explainError(error), rows: debugRows(),
  };
  report.text = formatReport(report);
  seen.set(key, report);
  for (const listener of listeners) { try { listener(report); } catch { /* a listener's failure is not this report's */ } }
  if (sink) sink(report); else waiting.push(report);
  return report;
}

/** Forget what was shown, so the same error is shown again (the tests; a new race). */
export function resetReports() {
  seen.clear();
  waiting.length = 0;
}

/**
 * A plain explanation of the error and what the player can do: `{ title, hint }`, both message tags (translated where
 * shown). The browser's own wording stays in the report.
 */
export function explainError(error) {
  const text = `${error.name ?? ""} ${error.message ?? ""}`;
  if (error.kind === "contextLost" || /context lost|CONTEXT_LOST/i.test(text)) return {
    title: msg("The graphics card stopped drawing the game."),
    hint: msg("The browser took the graphics away from the page (the driver restarted, or it ran out of video memory). Go back to the menu and start the race again; lower Graphics in Options if it happens again."),
  };
  if (error.kind === "stalled") return {
    title: msg("The simulation stopped answering."),
    hint: msg("The part of the game that moves the trucks has been busy for too long. The race cannot go on; go back to the menu."),
  };
  if (/out of memory|allocation failed|Invalid array length|Array buffer allocation/i.test(text)) return {
    title: msg("The game ran out of memory."),
    hint: msg("Close other tabs, lower the draw distance and Graphics in Options, then try again."),
  };
  if (/dynamically imported module|Importing a module script failed|Worker script failed to load/i.test(text)) return {
    title: msg("Part of the game could not be loaded."),
    hint: msg("The game was probably updated while it was open. Reload the page."),
  };
  if (/QuotaExceeded/i.test(text)) return {
    title: msg("The browser's storage for the game is full."),
    hint: msg("Free some space on the disk, or remove add-ons in Options, then reload."),
  };
  if (/NotFoundError|NotReadableError|A requested file or directory could not be found/i.test(text)) return {
    title: msg("A game file could not be read."),
    hint: msg("The game's copy of your install may be incomplete. Pick the game folder again from the install screen."),
  };
  if (error.worker) return {
    title: msg("A background part of the game failed."),
    hint: msg("The game may not work as it should from here. Copy the report, then go back to the menu."),
  };
  return {
    title: msg("Something went wrong in OpenMTM2."),
    hint: msg("The game may go on, or it may not work as it should. Copy the report so the problem can be fixed."),
  };
}

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** The report as text, to copy and paste: the error, what the game knew, the stack. */
export function formatReport(report) {
  const { error, where, fatal, at, rows } = report;
  const lines = [
    `OpenMTM2 error report (${stamp(at)})`,
    `Error: ${error.name && error.name !== "Error" ? `${error.name}: ` : ""}${error.message}`,
  ];
  if (where) lines.push(`While: ${where}`);
  if (error.worker) lines.push(`In: ${error.worker}`);
  if (fatal) lines.push("Fatal: the game cannot go on from it");
  if (report.count > 1) lines.push(`Seen: ${report.count} times`);
  if (rows.length) {
    lines.push("");
    const width = Math.min(18, Math.max(...rows.map(([label]) => label.length)));
    for (const [label, value] of rows) lines.push(`${`${label}:`.padEnd(width + 2)}${value}`);
  }
  const stack = String(error.workerStack ?? error.stack ?? "").split("\n").map((l) => l.trim())
    .filter((l) => l && l !== error.message && !l.endsWith(error.message)).slice(0, 12);
  if (stack.length) lines.push("", "Stack:", ...stack.map((l) => `  ${l.replace(/^at /, "at ")}`));
  return lines.join("\n");
}

/** A position as feet, to one decimal: "x 12.3, y 4.0, z -56.7". */
export function feet(pos) {
  if (!pos || pos.length < 3 || pos.some((v) => !Number.isFinite(v))) return pos ? `invalid (${Array.from(pos).join(", ")})` : null;
  return `x ${pos[0].toFixed(1)}, y ${pos[1].toFixed(1)}, z ${pos[2].toFixed(1)} ft`;
}
