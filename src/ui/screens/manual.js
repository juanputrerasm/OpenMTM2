/*
  The Monster Manual (the Start screen's button): OpenMTM2's own guide (app/manual.js), a list of chapters and topics
  beside the topic shown, in either skin. Key tables show the player's own keys.
*/
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { msg } from "../../game/strings.js";
import { MANUAL } from "../../app/manual.js";
import { codeLabel, mergeBindings } from "../../game/input/bindings.js";
import { EXTENSIONS } from "../../game/extensions/loader.js";

export default async function mount(container, context, params = {}) {
  const { t } = context;
  const ui = await frame(container, context, {
    title: msg("Monster Manual"), bar: "none",
    regions: { manual: [16, 56, 608, 336] }, modernRegions: { manual: [16, 56, 608, 336] },
  });
  const keys = mergeBindings(context.settings.bindings);
  const keyText = (action) => (keys[action] ?? []).map(codeLabel).join(", ") || "-";

  const contents = el("nav", { class: "manual-contents", "aria-label": t("Contents") });
  const article = el("article", { class: "manual-topic", tabindex: "-1" });
  const links = new Map();

  const block = (item) => {
    if (typeof item === "string") return el("p", {}, t(item));
    if (item.list) return el("ul", {}, ...item.list.map((line) => el("li", {}, t(line))));
    if (item.extensions) return el("dl", { class: "manual-modes" }, ...EXTENSIONS.flatMap((x) => [el("dt", {}, t(x.name)), el("dd", {}, t(x.description))]));
    const rows = item.keys ? item.keys.map(([action, label]) => [keyText(action), t(label)]) : (item.fixed ?? []).map(([k, label]) => [k, t(label)]);
    return el("table", { class: "manual-keys" }, el("tbody", {}, ...rows.map(([k, label]) => el("tr", {}, el("th", { scope: "row" }, k), el("td", {}, label)))));
  };
  const show = (id) => {
    const topic = MANUAL.flatMap((chapter) => chapter.topics).find((x) => x.id === id) ?? MANUAL[0].topics[0];
    article.replaceChildren(el("h2", {}, t(topic.title)), ...topic.body.map(block));
    for (const [key, link] of links) link.classList.toggle("current", key === topic.id);
    article.scrollTop = 0;
  };
  for (const chapter of MANUAL) {
    contents.append(el("h3", {}, t(chapter.title)));
    const list = el("ul", {});
    for (const topic of chapter.topics) {
      const link = el("button", { type: "button", class: "manual-link", onclick: () => show(topic.id) }, t(topic.title));
      links.set(topic.id, link);
      list.append(el("li", {}, link));
    }
    contents.append(list);
  }
  ui.regions.manual.classList.add("manual");
  ui.regions.manual.append(contents, article);
  show(params.topic);
  return { unmount: ui.unmount };
}
