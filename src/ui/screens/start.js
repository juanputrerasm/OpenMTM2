/*
  The Start screen: the races, the Hall of Fame and the options. The modern skin also lists
  what the install holds, with the developer views (so does the classic one, below the menu,
  when the "Developer views" option is on).
*/
import { el } from "../dom.js";
import { currentDriver, getProfiles } from "../../app/profile-store.js";
import { frame } from "../frame.js";

export default async function mount(container, context) {
  let catalog;
  try {
    catalog = await context.assets.call("catalog");
  } catch (err) {
    const ui = await frame(container, context, { title: "OpenMTM2", regions: { main: [24, 120, 592, 280] } });
    ui.regions.main.append(el("p", { class: "error" }, `Could not read the install: ${err.message}`), reinstallButton(context));
    return { unmount: ui.unmount };
  }

  const driver = currentDriver(await getProfiles(context));
  const { showHiddenTracks, showHiddenTrucks, developer } = context.settings;
  const tracks = catalog.tracks.filter((t) => showHiddenTracks || !t.hidden);
  const trucks = catalog.trucks.filter((t) => showHiddenTrucks || !t.hidden);
  const go = (name, params) => () => context.router.go(name, params);

  const menu = [
    el("p", { class: "muted" }, `Driver: ${driver.name}`),
    el("div", { class: "screen-actions menu" },
      el("button", { class: "primary", onclick: go("race-select", { mode: "circuit" }) }, "Circuit Race"),
      el("button", { class: "primary", onclick: go("race-select", { mode: "rally" }) }, "Rally Race"),
      el("button", { class: "primary", onclick: go("race-select", { mode: "summit" }) }, "Summit Rumble"),
      el("button", { onclick: go("drivers") }, "Drivers"),
      el("button", { onclick: go("hall") }, "Hall of Fame"),
      el("button", { onclick: go("options") }, "Options")),
  ];
  const listing = [
    el("h2", {}, `${tracks.length} tracks`),
    el("ul", { class: "track-list" }, ...tracks.map((t) => el("li", {},
      el("button", { class: "link", title: "Look around this track", onclick: go("dev-track", { track: t }) }, t.name),
      " ", el("button", { class: "link", title: "Drive a truck on this track", onclick: go("dev-drive", { track: t }) }, "drive"),
      " ", el("span", { class: "muted" }, `${t.raceType}, ${t.locale}`)))),
    el("h2", {}, `${trucks.length} trucks`),
    el("p", {}, trucks.map((t) => t.name).join(", ")),
    catalog.problems.length ? el("p", { class: "error" }, catalog.problems.join("; ")) : null,
    el("div", { class: "screen-actions" }, reinstallButton(context)),
  ].filter(Boolean);

  const ui = await frame(container, context, {
    title: "OpenMTM2", backdrop: "START", bar: "start",
    regions: { menu: [10, 172, 172, 204], listing: [200, 186, 296, 190] },
  });
  ui.regions.menu.append(...menu);
  if (!ui.classic || developer) ui.regions.listing.append(...listing);
  else ui.regions.listing.remove();
  return { unmount: ui.unmount };
}

function reinstallButton(context) {
  return el("button", {
    onclick: async () => {
      await context.assets.call("uninstall");
      await context.router.go("install", {}, { replace: true });
    },
  }, "Use a different install");
}
