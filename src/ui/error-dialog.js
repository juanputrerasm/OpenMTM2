/*
  The error dialog: what shared/error-report.js reports, shown as the game's own message box (ui/dialogs.js), in place of
  an error only the browser's console would see. MTM2 stops with a message box ("FATAL! Too many objects!"); this one
  says what went wrong in plain words and holds the report (the track, the truck, where the truck and the camera were,
  the stack) to copy, or to take a picture of.

  `startErrorReporting` also catches what nothing else did: an exception thrown anywhere on the page and a promise
  rejected with nobody waiting for it.
*/
import { el } from "./dom.js";
import { addDebugInfo, reportError, setErrorSink } from "../shared/error-report.js";
import { VERSION } from "../app/version.js";
import { graphicsHardware } from "../app/graphics-hardware.js";

/** One dialog at a time: reports that come while it is open queue behind it. */
const queue = [];
let open = null;

/** Catch the page's errors and show every report from here on. */
export function startErrorReporting(context) {
  addDebugInfo("app", () => {
    const screen = context.router?.stack?.at(-1)?.name;
    const gpu = graphicsHardware().renderer;
    return [
      ["Version", `OpenMTM2 v${VERSION}${context.exeVersion ? `, MONSTER.EXE ${context.exeVersion}` : ""}`],
      ["Screen", screen],
      ["Graphics", context.settings?.graphics],
      ["GPU", gpu || null],
      ["Window", typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio}x` : null],
      ["Browser", typeof navigator !== "undefined" ? navigator.userAgent : null],
    ];
  });
  window.addEventListener("error", (event) => {
    // A script or image that failed to load fires this too, with no error: those are reported where they are loaded.
    if (!event.error && !event.message) return;
    reportError(event.error ?? Object.assign(new Error(event.message), {
      stack: event.filename ? `${event.message}\n    at ${event.filename}:${event.lineno}:${event.colno}` : undefined,
    }), { where: "page script" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { where: "background task" });
  });
  setErrorSink((report) => {
    queue.push(report);
    if (!open) showNext(context);
  });
}

function showNext(context) {
  const report = queue.shift();
  if (!report) { open = null; return; }
  const t = context.t ?? ((text) => text);
  const field = el("textarea", { class: "error-report-text", readonly: true, rows: 12, spellcheck: "false", "aria-label": t("Error report") });
  field.value = report.text;
  const repeats = el("p", { class: "error-report-repeats", hidden: true });
  report.onRepeat = (count) => {
    repeats.hidden = false;
    repeats.textContent = t("This error happened <<1>> times.", count);
  };
  const copied = el("span", { class: "error-report-copied", hidden: true }, t("Copied"));
  const copy = async () => {
    try { await navigator.clipboard.writeText(field.value); } catch {
      // No clipboard (not allowed, or not a secure page): select it, for Ctrl+C.
      field.focus();
      field.select();
      document.execCommand?.("copy");
    }
    copied.hidden = false;
  };
  let leave = null;
  const dialog = el("dialog", { class: "options-sub message-box error-report", "aria-label": t("OpenMTM2 error") },
    el("h2", {}, t("OpenMTM2 error")),
    el("p", { class: "message-box-text error-report-title" }, t(report.explain.title)),
    el("p", { class: "message-box-text" }, t(report.explain.hint)),
    repeats,
    field,
    el("div", { class: "options-sub-actions" },
      copied,
      el("button", { onclick: copy }, t("Copy report")),
      el("button", { onclick: () => { leave = "menu"; dialog.close(); } }, t("Main menu")),
      el("button", { onclick: () => { leave = "reload"; dialog.close(); } }, t("Reload")),
      report.fatal ? null : el("button", { class: "primary", onclick: () => dialog.close() }, t("Continue"))));
  dialog.addEventListener("close", () => {
    dialog.remove();
    report.onRepeat = null;
    if (leave === "reload") { window.location.reload(); return; }
    if (leave === "menu") {
      queue.length = 0;
      open = null;
      context.router?.go("start").catch((error) => reportError(error, { where: "going back to the menu" }));
      return;
    }
    showNext(context);
  }, { once: true });
  // A fatal error has nothing to go back to: Escape does not close it.
  if (report.fatal) dialog.addEventListener("cancel", (event) => event.preventDefault());
  // The mouse is the player's again, out of the race's pointer lock.
  try { document.exitPointerLock?.(); } catch { /* not locked */ }
  document.body.append(dialog);
  open = dialog;
  dialog.showModal();
  dialog.querySelector("button.primary, button")?.focus();
}
