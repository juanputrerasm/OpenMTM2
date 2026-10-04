import { el } from "../dom.js";

export default function mount(container, _context, { missing = [] }) {
  container.append(
    el("section", { class: "screen" },
      el("h1", { class: "screen-title" }, "Browser not supported"),
      el("div", { class: "screen-panel" },
        el("p", {}, "OpenMTM2 needs features this browser does not offer:"),
        el("ul", {}, ...missing.map((name) => el("li", {}, name))),
        el("p", { class: "muted" },
          "Use a current version of Chrome, Edge, Firefox or Safari, served over HTTPS or from "
          + "localhost (file:// pages cannot use workers or OPFS)."),
      ),
    ),
  );
}
