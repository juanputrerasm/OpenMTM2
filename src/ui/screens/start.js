/* The Start screen follows its four switches. Demo and Manual remain visible but deferred. */
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { goDemo } from "../../app/flow.js";

export default async function mount(container, context) {
  const ui = await frame(container, context, {
    title: "OpenMTM2", plainTitle: true, backdrop: "START", bar: "start", regions: { main: [24, 120, 592, 260] },
  });
  if (ui.classic) {
    ui.regions.main.remove();
  } else {
    ui.regions.main.append(el("div", { class: "screen-actions menu start-actions" },
      el("button", { onclick: () => window.open("https://mtm2.com/", "_blank", "noopener") }, "Web Page"),
      el("button", { "data-menu-sound": "STARTOFF", onclick: () => goDemo(context) }, "Monster Demo"),
      el("button", { disabled: true, title: "Not implemented yet" }, "Monster Manual"),
      el("button", { class: "primary", "data-menu-sound": "STARTOFF", onclick: () => context.router.go("drivers") }, "Driver Check-in")));
  }
  return { unmount: ui.unmount };
}
