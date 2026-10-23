/*
  The Drag Weekend (game/events/drag-event.js, hosted by app/drag-weekend.js): qualifying, then the bracket, each
  pairing driven, watched or simulated, then the final order. Drawn on the plain stage in both skins: the game has no
  art for it.
*/
import { el } from "../dom.js";
import { frame } from "../frame.js";
import { canSimulate, chooseLane, currentPairing, finalOrder, roundName, simulateOthers, simulatePairing, winOdds } from "../../game/events/drag-event.js";
import { LEFT, RIGHT, runPass, takePass } from "../../app/drag-weekend.js";
import { abandonTournament, takeDragWeekend } from "../../app/tournament.js";
import { msg } from "../../game/strings.js";
import { showConfirm } from "../dialogs.js";

const seconds = (value) => (value === null || value === undefined ? "" : value.toFixed(2));
const LANES = [msg("left"), msg("right")];

export default async function mount(container, context, { pass = null } = {}) {
  const weekend = context.dragWeekend;
  const { t } = context;
  const round = (r) => roundName(event, r, t);
  const ui = await frame(container, context, { title: msg("Drag Weekend"), bar: "none", regions: { main: [20, 62, 600, 404] } });
  const panel = ui.regions.main;
  if (!weekend) {
    // A weekend lives for the session: after a reload there is none to show.
    panel.append(el("p", {}, t("No drag weekend is in progress. Start one from the Races screen, on a drag strip.")));
    return { unmount: ui.unmount };
  }
  const { event } = weekend;
  takePass(weekend, pass);
  panel.classList.add("drag-event");
  const name = (driver) => (driver === null ? "" : event.drivers[driver].name);
  const leaveForRaces = () => context.router.go("race-select", { mode: "drag" }, { replace: true });
  const button = (label, onclick, cls = null) => el("button", { class: cls, "data-menu-sound": "STARTOFF", onclick }, label);
  const cancel = button(t("Cancel"), async () => {
    if (!await showConfirm(t, t("Abandon the drag weekend?"))) return;
    // Abandoning a tournament's drag event abandons the tournament.
    if (weekend.tournament) abandonTournament(context);
    context.dragWeekend = null;
    leaveForRaces();
  });

  /** What the last pass, simulation or bye came to. */
  const lastNote = () => {
    const last = event.last;
    if (!last) return event.phase === "bracket" ? t("Qualifying is over. The baseline is <<1>> s.", seconds(event.baseline)) : "";
    const which = round(last.round);
    const again = { "dead heat": msg("a dead heat"), "double dq": msg("both trucks were disqualified"), "rerun": msg("a disqualified truck hit the other"), "no result": msg("neither truck set a time") }[last.outcome];
    if (again) return t("<<1>>: <<2>>. The pairing is run again.", which, t(again));
    const w = last.winner, loser = last.drivers[1 - w];
    const how = last.dq[1 - w] ? t("<<1>> was disqualified", name(loser)) : last.times[1 - w] === null ? t("<<1>> set no time", name(loser)) : t("<<1>> to <<2>>", seconds(last.times[w]), seconds(last.times[1 - w]));
    return last.how === "simulated"
      ? t("<<1>>: <<2>> beat <<3>> (simulated), <<4>>.", which, name(last.drivers[w]), name(loser), how)
      : t("<<1>>: <<2>> beat <<3>>, <<4>>.", which, name(last.drivers[w]), name(loser), how);
  };

  /** The drivers in their order: seed, qualifying time, best pass, and where they stand. */
  const table = () => {
    const truckName = (file) => weekend.trucks.find((t) => t.file === file)?.name ?? file;
    const standing = (i) => (i === event.winner ? t("Winner") : event.drivers[i].out !== null ? t("Out: <<1>>", round(event.drivers[i].out)) : "");
    return el("table", { class: "results drag-event-table" },
      el("thead", {}, el("tr", {}, ...["", msg("Driver"), msg("Truck"), msg("Seed"), msg("Qualify"), msg("Best"), ""].map((h) => el("th", {}, h && t(h))))),
      el("tbody", {}, ...finalOrder(event).map((i, k) => {
        const d = event.drivers[i];
        return el("tr", { class: d.player ? "player" : null },
          ...[String(k + 1), d.name, truckName(d.truck), String(d.seed), d.qualify === null ? t("no time") : seconds(d.qualify), seconds(d.best), standing(i)]
            .map((cell) => el("td", {}, cell)));
      })));
  };

  /** The bracket: a column a round, each pairing its two drivers with their seeds and times. */
  const bracket = () => {
    const now = currentPairing(event);
    const line = (entry, slot) => {
      const driver = entry.drivers[slot];
      const time = entry.how === "bye" ? "" : entry.dq[slot] ? "DQ" : seconds(entry.times[slot]);
      return el("div", { class: `drag-pair-line${entry.over && entry.winner === slot ? " won" : ""}${driver !== null && event.drivers[driver].player ? " player" : ""}` },
        el("span", {}, driver === null ? (entry.how === "bye" ? t("bye") : "") : `${event.drivers[driver].seed}. ${name(driver)}`), el("span", {}, time));
    };
    const columns = event.bracket.map((entries, r) => el("div", { class: "drag-round" },
      el("h2", {}, round(r)),
      ...entries.map((entry, p) => el("div", { class: `drag-pair${now && now.round === r && now.pair === p ? " current" : ""}` }, line(entry, 0), line(entry, 1)))));
    return el("div", { class: "drag-bracket" }, ...columns);
  };

  const head = el("p", { class: "drag-event-head" });
  const note = el("p", { class: "drag-event-note" });
  const body = el("div", { class: "drag-event-body" });
  const actions = el("div", { class: "screen-actions drag-event-actions" });
  panel.append(head, note, body, actions);

  const show = () => {
    note.textContent = lastNote();
    if (event.phase === "qualifying") {
      head.textContent = t("<<1>>: qualifying, <<2>> drivers", event.strip.name, event.drivers.length);
      body.replaceChildren(
        el("p", {}, t("Run one pass alone, in the lane you like. Your elapsed time is your qualifying time, and the order is the seeding for the bracket.")),
        el("p", { class: "muted" }, t("A computer truck runs beside you: its time is the weekend's baseline, which the computer drivers' own times come from.")));
      actions.replaceChildren(button(t("Qualify: left lane"), () => runPass(context, LEFT), "primary"), button(t("Qualify: right lane"), () => runPass(context, RIGHT), "primary"), cancel);
      return;
    }
    body.replaceChildren(table(), bracket());
    if (event.phase === "done") {
      head.textContent = t("<<1>>: <<2>> wins the drag weekend", event.strip.name, name(event.winner));
      // A tournament's drag event (app/tournament.js): its points go to the tournament, which shows what is next.
      actions.replaceChildren(weekend.tournament
        ? button(t("Continue tournament"), async () => { await takeDragWeekend(context); context.router.go("tournament", {}, { replace: true }); }, "primary")
        : button(t("Continue"), () => { context.dragWeekend = null; leaveForRaces(); }, "primary"));
      return;
    }
    const pairing = currentPairing(event);
    const [a, b] = pairing.drivers;
    const odds = winOdds(event);
    const lanes = pairing.lanes ? `, ${t("<<1>> in the <<2>> lane", name(a), t(LANES[pairing.lanes[0]]))}` : "";
    head.textContent = `${event.strip.name}: ${round(pairing.round)}, ${t("<<1>> against <<2>>", name(a), name(b))}${lanes}`
      + (odds === null ? "" : ` (${t("<<1>>% to <<2>>%", Math.round(odds * 100), Math.round((1 - odds) * 100))})`);
    const race = (lane) => () => { if (lane !== undefined) chooseLane(event, lane); runPass(context); };
    // The better seed picks the lane: a player who has the choice makes it here.
    const drive = pairing.lanes
      ? [button(pairing.hasPlayer ? t("Race (<<1>> lane)", t(LANES[pairing.lanes[pairing.drivers.findIndex((i) => event.drivers[i].player)]])) : t("Watch"), race(), "primary")]
      : [button(t("Race: left lane"), race(LEFT), "primary"), button(t("Race: right lane"), race(RIGHT), "primary")];
    actions.replaceChildren(...[
      ...drive,
      canSimulate(event) ? button(t("Simulate"), () => { simulatePairing(event); show(); }) : null,
      button(t("Run all others"), () => { simulateOthers(event); show(); }),
      cancel,
    ].filter(Boolean));
  };
  show();
  return { unmount: ui.unmount };
}
