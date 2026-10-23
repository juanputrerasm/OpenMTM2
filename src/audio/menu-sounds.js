/*
  Menu interface sounds from UI.POD. An ordinary button uses CONOPTUP. A button can select a
  specific sound with data-menu-sound, including "none". One listener covers modern controls
  and the classic skin's invisible hotspots.
*/
export function playMenuSound(audio, settings, name, gain = 0.6) {
  if (!audio || settings.sound?.muted || !name || name === "none") return;
  audio.resume();
  audio.play(name, { gain });
}

/** The sound a press of `node` makes, as a click of it does: null for a control that is not a button. */
export function menuSoundFor(node) {
  const button = node?.closest?.("button:not(:disabled), .stage-hotspot:not(:disabled)");
  return button ? button.dataset.menuSound ?? "CONOPTUP" : null;
}

export function attachMenuSounds(doc, audio, settings) {
  let lastHover = null;
  const isButton = (target) => target?.closest?.("button:not(:disabled), .stage-hotspot:not(:disabled)");
  const play = (name, gain) => playMenuSound(audio, settings, name, gain);
  const onOver = (e) => {
    const button = isButton(e.target);
    if (!button || button === lastHover) return;
    lastHover = button;
    play("MOUSEON", 0.35);
  };
  const onOut = (e) => { if (!e.relatedTarget || !isButton(e.relatedTarget)) lastHover = null; };
  const onDown = () => audio.resume();
  const onUp = (e) => {
    const name = menuSoundFor(e.target);
    if (name) play(name, 0.6);
  };
  doc.addEventListener("pointerover", onOver);
  doc.addEventListener("pointerout", onOut);
  doc.addEventListener("pointerdown", onDown);
  doc.addEventListener("pointerup", onUp);
  return () => {
    doc.removeEventListener("pointerover", onOver);
    doc.removeEventListener("pointerout", onOut);
    doc.removeEventListener("pointerdown", onDown);
    doc.removeEventListener("pointerup", onUp);
  };
}
