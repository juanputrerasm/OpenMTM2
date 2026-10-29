/*
  The jukebox's music (ui/jukebox-dialog.js, audio/jukebox.js): every piece of music the mounted archives hold, each once.

  - The menus' music, SOUND\SPLASH (audio/menu-music.js).
  - The music each MTM1 and MTM2 track's level names (the LVL's music line, worker/track-build.js `musicName`): a WAV
    with its KLP loop points, an OGG or MP3 that replaces one (sound-file.js), or a tracker module (`.MOD`).
  - Every sound in a music archive (an archive whose name says MUSIC, as the game's MUSIC.POD), named by a level or not.
  - Every tracker module in MUSIC\ or SOUND\ (MTM1's GAME.POD carries three).

  A sound is one piece of music by its stem: FARM.WAV and an add-on's FARM.OGG are the one track the game would play,
  so they are listed once. A module and a sound are different files and may share a stem. The effects' own KLP loops
  (Sound.POD's engines and ambience) are not music, and are listed only when a level names one as its music.

  Pure: it reads through a VFS (vfs.js) and the catalogue's tracks, and returns plain data.
*/
import { parseMtmLvl } from "../vendor/openphotex/mtm/sit.js";
import { podPathTitle } from "../vendor/openphotex/pod/paths.js";
import { SOUND_EXTENSIONS, soundStem } from "./sound-file.js";

/** The stem of the menus' music (audio/menu-music.js). */
export const MENU_MUSIC = "SPLASH";

/** A jukebox entry's id: "sound:FARM", "mod:METAL". */
export const jukeboxId = (kind, stem) => `${kind}:${stem}`;

const isModName = (name) => /\.mod$/i.test(String(name ?? ""));
const modStem = (name) => podPathTitle(String(name ?? "")).toUpperCase().replace(/\.MOD$/, "");
/** An archive of music, by its name: the game's MUSIC.POD, or an add-on's own. */
const isMusicArchive = (mount) => /music/i.test(String(mount?.name ?? ""));

/**
 * The music: `[{ id, kind: "sound"|"mod", stem, format: "wav"|"ogg"|"mp3"|"mod", menu, tracks: [track names] }]`,
 * the menus' first, then the tracks' in catalogue order, then the rest of the music archives, then the modules.
 * @param {ReturnType<import("./vfs.js").createVfs>} vfs
 * @param {{ path: string, name: string, game?: string, scope?: string|null, level?: string|null }[]} tracks the catalogue's
 */
export async function buildJukeboxList(vfs, tracks = []) {
  const entries = new Map();
  /** The format a sound plays in: the first of OGG, MP3, WAV that an archive holds (sound-file.js `findSound`). */
  const soundFormat = (stem) => SOUND_EXTENSIONS.find((ext) => vfs.find(`SOUND\\${stem}.${ext}`))?.toLowerCase() ?? null;
  const hasModule = (stem) => !!(vfs.find(`MUSIC\\${stem}.MOD`) ?? vfs.find(`SOUND\\${stem}.MOD`));
  const add = (kind, stem, use = {}) => {
    if (!stem) return null;
    const id = jukeboxId(kind, stem);
    let entry = entries.get(id);
    if (!entry) {
      const format = kind === "mod" ? (hasModule(stem) ? "mod" : null) : soundFormat(stem);
      if (!format) return null;
      entry = { id, kind, stem, format, menu: false, tracks: [] };
      entries.set(id, entry);
    }
    if (use.menu) entry.menu = true;
    if (use.track && !entry.tracks.includes(use.track)) entry.tracks.push(use.track);
    return entry;
  };

  add("sound", MENU_MUSIC, { menu: true });

  // The tracks' music, as loadLevel finds their level (worker/level-load.js).
  for (const track of tracks) {
    if (track.scope && track.scope !== "MTM") continue;
    if (track.game && track.game !== "MTM1" && track.game !== "MTM2") continue;
    try {
      const stem = podPathTitle(track.path).toUpperCase().replace(/\.SIT$/, "");
      const lvlTitle = track.level ? podPathTitle(track.level) : `${stem}.LVL`;
      const bytes = (await vfs.read(`LEVELS\\${lvlTitle}`)) ?? (await vfs.read(`LEVELS\\${stem}.LVL`));
      const music = bytes ? parseMtmLvl(bytes).musicName : null;
      if (!music) continue;
      if (isModName(music)) add("mod", modStem(music), { track: track.name });
      else add("sound", soundStem(music), { track: track.name });
    } catch {
      // A level that does not read gives no music; the track itself reports the problem when it is driven.
    }
  }

  // The rest of the music archives' sounds (normalized paths: upper case, "/" between folders).
  for (const mount of vfs.mounts ?? []) {
    if (!isMusicArchive(mount)) continue;
    for (const entry of mount.archive.entries) {
      const path = entry.normalizedName;
      const match = /^SOUND\/([^/]+)\.(WAV|OGG|MP3)$/.exec(path);
      if (match) add("sound", match[1]);
    }
  }

  // Every tracker module.
  for (const { path } of vfs.list(".MOD")) {
    const match = /^(?:MUSIC|SOUND)\/([^/]+)\.MOD$/.exec(path);
    if (match) add("mod", match[1]);
  }
  return [...entries.values()];
}
