/*
  Playing one of the game's videos (game/videos.js) over everything: the Smacker file decoded frame by frame (OpenPhotex
  video/smk.js), drawn to a canvas that fills the window with the picture's shape kept, its sound played through Web
  Audio and the picture kept in step with it. Any key, a click or a gamepad button ends it; Escape ends a run of videos
  (`playVideos`). Only rendering and input code here: the decoding is OpenPhotex's.
*/
import { openSmk } from "../vendor/openphotex/video/smk.js";
import { el } from "./dom.js";

/** Frames decoded between yields while the sound is read ahead. */
const AHEAD_CHUNK = 40;

/** The sound of a video, all of it: `{ rate, channels, samples }` for its first track, or null. */
async function readSound(bytes) {
  const d = openSmk(bytes);
  const track = d.info.audio[0];
  if (!track) return null;
  const parts = [];
  let length = 0, n = 0;
  for (let f = d.next(); f; f = d.next()) {
    for (const a of f.audio) if (a.track === track.track) { parts.push(a.samples.slice()); length += a.samples.length; }
    if (++n % AHEAD_CHUNK === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const samples = new Float32Array(length);
  let at = 0;
  for (const p of parts) { samples.set(p, at); at += p.length; }
  return { rate: track.rate, channels: track.channels, samples };
}

/** Whether a gamepad has any button down now. */
const padPressed = () => [...(navigator.getGamepads?.() ?? [])].some((pad) => pad?.buttons?.some((b) => b.pressed));

/**
 * Play the video at `path` (as the install keeps it). Resolves to "ended", "skipped" (a key, click or button) or
 * "stopped" (Escape), or "missing" when the install lacks it or it cannot be read.
 */
export async function playVideo(context, path) {
  const bytes = await context.assets.call("video", { path }).catch(() => null);
  if (!bytes) return "missing";
  let decoder;
  try { decoder = openSmk(bytes); } catch { return "missing"; }
  const { info } = decoder;
  const tall = info.doubled || info.interlaced ? 2 : 1;
  const canvas = el("canvas", { class: "video-canvas", width: info.width, height: info.height * tall });
  const overlay = el("div", { class: "video-overlay", role: "presentation" }, canvas);
  document.body.append(overlay);
  const g = canvas.getContext("2d");
  const image = g.createImageData(info.width, info.height * tall);

  let audio = null, source = null;
  const sound = await readSound(bytes).catch(() => null);
  try {
    if (sound && typeof AudioContext !== "undefined") {
      audio = new AudioContext();
      const frames = sound.samples.length / sound.channels;
      const buffer = audio.createBuffer(sound.channels, frames, sound.rate);
      for (let c = 0; c < sound.channels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < frames; i++) channel[i] = sound.samples[i * sound.channels + c];
      }
      source = audio.createBufferSource();
      source.buffer = buffer;
      const volume = audio.createGain();
      const levels = context.settings?.sound ?? {};
      volume.gain.value = levels.muted ? 0 : Math.max(0, Math.min(1, (levels.master ?? 1) * (levels.effects ?? 1)));
      source.connect(volume).connect(audio.destination);
      await audio.resume().catch(() => {});
      // No sound without the player's say-so (a browser's autoplay rule at launch): the picture runs on the clock.
      if (audio.state !== "running") { audio.close().catch(() => {}); audio = null; source = null; }
    }
  } catch { audio = null; source = null; }

  return new Promise((resolve) => {
    let done = false, shown = -1, startedAt = null;
    const padAtStart = padPressed();
    let padReleased = !padAtStart;
    const finish = (how) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      overlay.removeEventListener("pointerdown", onPointer);
      try { source?.stop(); } catch { /* not started */ }
      audio?.close().catch(() => {});
      overlay.remove();
      resolve(how);
    };
    const onKey = (event) => {
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === "Escape" ? "stopped" : "skipped");
    };
    const onPointer = () => finish("skipped");
    window.addEventListener("keydown", onKey, true);
    overlay.addEventListener("pointerdown", onPointer);

    const draw = (frame) => {
      const { pixels, palette } = frame;
      const out = image.data;
      for (let y = 0; y < info.height; y++) {
        for (let copy = 0; copy < tall; copy++) {
          let o = ((y * tall + copy) * info.width) * 4;
          for (let x = 0, i = y * info.width; x < info.width; x++, i++, o += 4) {
            const p = pixels[i] * 3;
            out[o] = palette[p]; out[o + 1] = palette[p + 1]; out[o + 2] = palette[p + 2]; out[o + 3] = 255;
          }
        }
      }
      g.putImageData(image, 0, 0);
    };
    const tick = () => {
      if (done) return;
      if (!padReleased && !padPressed()) padReleased = true;
      else if (padReleased && padPressed()) { finish("skipped"); return; }
      if (startedAt === null) {
        startedAt = audio ? audio.currentTime : performance.now() / 1000;
        source?.start();
      }
      const now = audio ? audio.currentTime : performance.now() / 1000;
      const want = Math.floor(((now - startedAt) * 1000) / info.frameMs);
      let frame = null;
      try {
        while (shown < want && shown < info.frames - 1) { frame = decoder.next(); shown++; }
      } catch { finish("ended"); return; }
      if (frame) draw(frame);
      if (shown >= info.frames - 1 && want >= info.frames) { finish("ended"); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Play videos one after another; Escape ends the run. */
export async function playVideos(context, paths) {
  for (const path of paths) {
    if ((await playVideo(context, path)) === "stopped") return;
  }
}
