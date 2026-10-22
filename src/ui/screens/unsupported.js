import { el } from "../dom.js";

export default function mount(container, context, { missing = [] }) {
  const t = context?.t ?? ((text) => text);
  container.append(
    el("section", { class: "screen" },
      el("h1", { class: "screen-title" }, t("Browser not supported")),
      el("div", { class: "screen-panel" },
        el("p", {}, t("OpenMTM2 needs features this browser does not offer:")),
        el("ul", {}, ...missing.map((name) => el("li", {}, t(name)))),
        el("p", { class: "muted" },
          t("Use a current version of Chrome, Edge, Firefox or Safari, served over HTTPS or from localhost (file:// pages cannot use workers or OPFS).")),
      ),
    ),
  );
}
