/*
  The note that says, once, that the game now starts with no server and no network
  (docs/ARCHITECTURE.md, "Without a server").

  It matters most to someone who has a headset on a cable to their PC only for this: it is the
  sign that the cable can come out. It shows when there is both a copy of the app and an
  installed game, since one without the other starts nothing.
*/
import { el } from "./dom.js";

const TOLD = "openmtm2.offline-told";
const SHOWN_MS = 12000;

/**
 * @param {{ offline: object, assets: object }} context the copy (app/offline.js) and the asset worker
 * @returns {{ check: () => Promise<void> }} `check` looks whether there is something to say;
 *   it runs by itself when the copy changes, and the Install screen calls it after an install
 */
export function offlineNote(context, storage = globalThis.localStorage) {
  const read = () => { try { return storage?.getItem(TOLD) === "1"; } catch { return true; } };
  const write = (told) => { try { if (told) storage?.setItem(TOLD, "1"); else storage?.removeItem(TOLD); } catch { /* nothing to remember it in */ } };
  let checking = false;

  async function check() {
    const { copy, enabled } = context.offline.status;
    // A copy that was taken away and is made again is news again.
    if (!copy) {
      if (!enabled) write(false);
      return;
    }
    if (read() || checking) return;
    checking = true;
    try {
      const { installed } = await context.assets.call("installStatus");
      if (!installed || read()) return;
      write(true);
      show();
    } catch {
      // Without an answer there is nothing to announce.
    } finally {
      checking = false;
    }
  }

  function show() {
    const note = el("div", { class: "offline-note", role: "status" },
      el("strong", {}, context.t("Saved in this browser.")),
      ` ${context.t("The game now starts at this address with no server and no network.")}`);
    note.addEventListener("click", () => note.remove());
    document.body.append(note);
    setTimeout(() => note.remove(), SHOWN_MS);
  }

  context.offline.onChange(check);
  return { check };
}
