/*
  The message table in use, kept on the context as `context.t`. Every string is looked up by its English text (the tag,
  game/strings.js). Two tables can change it:
  - the app's own language (settings.language, app/settings.js `languageOf`): assets/lang/<id>.json, `[{ tag, text }]`.
    English needs none: the tags are English;
  - a `.LOC` in the install (settings.wording), over the language's table.
  Nothing here may stop the game: a missing or unreadable table leaves the standard wording.
*/
import { createStrings } from "../game/strings.js";
import { languageOf } from "./settings.js";

/** Each language's table, named one by one so the offline copy (shared/app-files.js) finds them. */
const LANGUAGE_TABLES = Object.freeze({
  es: new URL("../../assets/lang/es.json", import.meta.url),
});

const tables = new Map();

/** The app's table for a language, `[{ tag, text }]`; empty for English or when it cannot be read. */
export function languageTable(id) {
  const url = LANGUAGE_TABLES[id];
  if (!url) return Promise.resolve([]);
  if (!tables.has(id)) {
    tables.set(id, fetch(url).then((response) => (response.ok ? response.json() : [])).then((rows) => (Array.isArray(rows) ? rows : []))
      .catch(() => { tables.delete(id); return []; }));
  }
  return tables.get(id);
}

export async function loadStrings(context) {
  const id = languageOf(context.settings);
  const language = await languageTable(id);
  // The page says which language it is in, for screen readers and the browser's own translation offer.
  if (typeof document !== "undefined") document.documentElement.lang = id;
  let messages = [];
  const path = context.settings.wording;
  if (path && context.assets) messages = (await context.assets.call("loc", { path }).catch(() => null)) ?? [];
  // The first entry for a tag wins (createStrings): the install's wording, then the language's.
  context.t = createStrings([...messages, ...language]);
  return context.t;
}
