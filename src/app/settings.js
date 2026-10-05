/*
  Per-browser preferences, kept in localStorage.

  Storage can be unavailable (private windows, blocked site data), so every access is guarded
  and the defaults always apply. Game data (the install, driver profiles, the Hall of Fame)
  lives in OPFS instead, through the workers.
*/

const KEY = "openmtm2.settings";

export const DEFAULT_SETTINGS = Object.freeze({
  look: "classic",            // "classic" or "enhanced"
  detailLevel: 2,             // MONSTER.INI detailLevel: boxes with a higher priority are not drawn
  difficulty: 1,              // 0 Rookie, 1 Intermediate, 2 Professional
  laps: 3,
  weather: 0,                 // 0 Clear ... 8 Pitch Black, or "random" (a track may not allow it)
  opponents: 3,               // MONSTER.INI defaultOpponents (built-in default 3)
  opponentTrucks: Object.freeze([]), // explicitly selected CPU truck files from the Races dialog
  wording: "",                // a .LOC from the install that rewords the game's text ("" is the standard wording)
  skin: "classic",            // "classic" (the game's own menu art from UI.POD) or "modern"
  developer: false,           // list tracks and trucks with the developer views on the Start screen
  sound: Object.freeze({ master: 1, effects: 1, music: 0.6, muted: false }),
  commentary: false,          // reserved for commentaryFlag; voice playback is temporarily disabled
  textCommentary: false,      // textCommentaryFlag: its lines as text (off by default)
  menuMusic: true,            // the menus play SOUND\\SPLASH.WAV from MUSIC.POD
  kookyHorn: false,           // MONSTER.INI kookyHorn: three horns instead of one
  autoShift: true,            // automatic gears (the game's default)
  bindings: Object.freeze({}), // key code overrides by action, see game/input/bindings.js
  fullAutopilot: false,       // the game's "Full Autopilot": the player's truck drives itself
  showHiddenTracks: false,
  showHiddenTrucks: false,
});

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not persisted; the session keeps working with what it has.
  }
}

export function clearSettings(storage = globalThis.localStorage) {
  try {
    storage.removeItem(KEY);
  } catch {
    // The OPFS data can still be cleared when local storage is unavailable.
  }
}
