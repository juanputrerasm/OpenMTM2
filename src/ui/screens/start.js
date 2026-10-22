/* The Start screen follows its four switches. Demo and Manual remain visible but deferred. */
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { goDemo } from "../../app/flow.js";
import { msg } from "../../game/strings.js";

export default async function mount(container, context) {
  const ui = await frame(container, context, {
    title: msg("OpenMTM2"), plainTitle: true, backdrop: "START", bar: "start", scene: "start",
    regions: { main: [24, 120, 592, 260] }, modernRegions: { main: [24, 398, 592, 40] },
  });
  const { t } = context;
  if (ui.classic) {
    ui.regions.main.remove();
  } else {
    ui.regions.main.append(el("div", { class: "screen-actions menu start-actions" },
      el("button", { onclick: () => window.open("https://mtm2.com/", "_blank", "noopener") }, t("Web Page")),
      el("button", { "data-menu-sound": "STARTOFF", onclick: () => goDemo(context) }, t("Monster Demo")),
      el("button", { disabled: true, title: t("Not implemented yet") }, t("Monster Manual")),
      el("button", { class: "primary", "data-menu-sound": "STARTOFF", onclick: () => context.router.go("drivers") }, t("Driver Check-in"))));
    ui.regions.main.after(photoCredit(t));
  }
  return { unmount: ui.unmount };
}

/** The credit CC BY-SA 2.0 asks for beside the modern skin's background photo (assets/start-background.webp). */
function photoCredit(t) {
  const link = (href, text) => el("a", { href, target: "_blank", rel: "noopener" }, text);
  return el("p", { class: "stage-credit" },
    `${t("Photo:")} `, link("https://www.flickr.com/photos/fortes/222692658/", "Untitled"),
    ` ${t("by")} `, link("https://www.flickr.com/photos/fortes/", "Filipe Fortes"),
    `, ${t("modified")}, `, link("https://creativecommons.org/licenses/by-sa/2.0/", "CC BY-SA 2.0"));
}
