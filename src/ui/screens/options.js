/* The full Options route and the modal opened from each menu screen share one control panel. */
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { mountOptionsPanel } from "../options-panel.js";

export async function openOptionsModal(context) {
  if (context.optionsDialog?.isConnected) return;
  const panel = el("div", { class: "options-modal-panel" });
  const dialog = el("dialog", { class: "options-modal", "aria-label": "Options" },
    el("div", { class: "options-modal-title" }, el("h1", {}, "Options")), panel);
  context.optionsDialog = dialog;
  document.body.append(dialog);
  const close = () => dialog.close();
  const cleanup = await mountOptionsPanel(panel, context, { close });
  dialog.addEventListener("close", () => {
    cleanup();
    dialog.remove();
    if (context.optionsDialog === dialog) context.optionsDialog = null;
  }, { once: true });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.showModal();
}

export default async function mount(container, context) {
  const ui = await frame(container, context, {
    title: "Options", backdrop: "BLANK", bar: "none", options: false,
    regions: { main: [20, 16, 600, 448] },
  });
  const cleanup = await mountOptionsPanel(ui.regions.main, context, { close: () => context.router.back() });
  return { unmount: () => { cleanup(); ui.unmount?.(); } };
}
