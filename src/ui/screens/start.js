/*
  The Start screen. Until the race flow exists (M7) it shows what the install offers.
*/
import { el } from "../dom.js";

export default async function mount(container, context) {
  const body = el("div", {}, el("p", { class: "muted" }, "Reading your install…"));
  const panel = el("div", { class: "screen-panel" }, body);
  container.append(
    el("section", { class: "screen" },
      el("h1", { class: "screen-title" }, "OpenMTM2"),
      panel,
    ),
  );

  let catalog;
  try {
    catalog = await context.assets.call("catalog");
  } catch (err) {
    body.replaceChildren(el("p", { class: "error" }, `Could not read the install: ${err.message}`), reinstallButton(context));
    return;
  }

  const { showHiddenTracks, showHiddenTrucks } = context.settings;
  const tracks = catalog.tracks.filter((t) => showHiddenTracks || !t.hidden);
  const trucks = catalog.trucks.filter((t) => showHiddenTrucks || !t.hidden);
  body.replaceChildren(...[
    el("h2", {}, `${tracks.length} tracks`),
    el("ul", { class: "track-list" }, ...tracks.map((t) => el("li", {},
      el("button", { class: "link", title: "Look around this track", onclick: () => context.router.go("dev-track", { track: t }) }, t.name),
      " ", el("button", { class: "link", title: "Drive a truck on this track", onclick: () => context.router.go("dev-drive", { track: t }) }, "drive"),
      " ", el("span", { class: "muted" }, `${t.raceType}, ${t.locale}`)))),
    el("h2", {}, `${trucks.length} trucks`),
    el("p", {}, trucks.map((t) => t.name).join(", ")),
    catalog.problems.length ? el("p", { class: "error" }, catalog.problems.join("; ")) : null,
    el("div", { class: "screen-actions" }, reinstallButton(context)),
  ].filter(Boolean));
}

function reinstallButton(context) {
  return el("button", {
    onclick: async () => {
      await context.assets.call("uninstall");
      await context.router.go("install", {}, { replace: true });
    },
  }, "Use a different install");
}
