/*
  The menus' click sounds (`SOUND\MOUSEON.WAV` as the pointer reaches a button, `DOWN.WAV` and
  `UP.WAV` as it is pressed and released, from UI.POD). One listener on the document covers every
  button, including the classic skin's hotspots.
*/
export function attachMenuSounds(doc, audio, settings) {
  let lastHover = null;
  const isButton = (target) => target?.closest?.("button:not(:disabled), .stage-hotspot:not(:disabled)");
  const play = (name, gain) => {
    if (settings.sound?.muted) return;
    audio.resume();
    audio.play(name, { gain });
  };
  const onOver = (e) => {
    const button = isButton(e.target);
    if (!button || button === lastHover) return;
    lastHover = button;
    play("MOUSEON", 0.35);
  };
  const onOut = (e) => { if (!e.relatedTarget || !isButton(e.relatedTarget)) lastHover = null; };
  const onDown = (e) => { if (isButton(e.target)) play("DOWN", 0.5); };
  const onUp = (e) => { if (isButton(e.target)) play("UP", 0.5); };
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
