/*
  The archives OpenMTM2 cannot run without: the menus' art and fonts (UI, STARTUP), the music and the sounds, the
  cockpit and MTM2's trucks with the blimp and the helicopter (TRUCK2). An install without any of them is refused, and
  the POD manager does not take them out; every other archive is optional, POD.INI's included.

  The MTM2 trial (docs/STANDALONE_ASSETS.md, "The trial") has each of them under its own name: MUSICX, SOUNDX, TRUCK2X
  and UIX, with STARTUP and COCKPIT as in the full game. A trial archive counts as the one it stands for.

  They are named by archive for now. What is needed is the files in them, so the list should become one of files
  (UI\..., SOUND\...), found in whichever mounted archive holds them, whatever it is called.
*/
import { installPathKey } from "./pod-ini.js";
import { createStrings, msg } from "../game/strings.js";

export const REQUIRED_PODS = Object.freeze(["STARTUP.POD", "MUSIC.POD", "SOUND.POD", "COCKPIT.POD", "TRUCK2.POD", "UI.POD"]);

/** The trial's archive names, by the full game's archive each stands for. */
export const TRIAL_POD_NAMES = Object.freeze({ "MUSICX.POD": "MUSIC.POD", "SOUNDX.POD": "SOUND.POD", "TRUCK2X.POD": "TRUCK2.POD", "UIX.POD": "UI.POD" });

/** An archive's file name, upper case, from its path in the folder (`system\startup.pod` is STARTUP.POD). */
export const podFileName = (path) => installPathKey(path).split("/").pop();

/** The full game's name for an archive: the trial's MUSICX.POD is MUSIC.POD, any other keeps its own. */
export const podRole = (path) => TRIAL_POD_NAMES[podFileName(path)] ?? podFileName(path);

/** Whether OpenMTM2 needs the archive at `path`. */
export const isRequiredPod = (path) => REQUIRED_PODS.includes(podRole(path));

/** Whether archive names (any paths) are the trial's: one of its own archive names is among them. */
export const isTrialPodSet = (paths) => [...paths].some((path) => podFileName(path) in TRIAL_POD_NAMES);

/** The required archives none of `paths` is. */
export function missingRequiredPods(paths) {
  const have = new Set([...paths].map(podRole));
  return REQUIRED_PODS.filter((name) => !have.has(name));
}

/** What the player is told when an install lacks some of them: the tag and its figures, `[tag, ...args]`. */
export function requiredPodsParts(missing) {
  const tag = missing.length === 1
    ? msg("OpenMTM2 needs <<1>> to run, and <<2>> is not there. Pick a Monster Truck Madness 2 folder whose POD.INI lists them all.")
    : msg("OpenMTM2 needs <<1>> to run, and <<2>> are not there. Pick a Monster Truck Madness 2 folder whose POD.INI lists them all.");
  return [tag, REQUIRED_PODS.join(", "), missing.join(", ")];
}

/** The same in the words of `t` (game/strings.js). */
export const requiredPodsMessage = (missing, t = createStrings()) => t(...requiredPodsParts(missing));
