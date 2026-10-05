/*
  The message table in use (settings.wording names a `.LOC` in the install), kept on the
  context as `context.t`. Nothing here may stop the game: a missing or unreadable table leaves
  the standard wording.
*/
import { createStrings } from "../game/strings.js";

export async function loadStrings(context) {
  let messages = [];
  const path = context.settings.wording;
  if (path) messages = (await context.assets.call("loc", { path }).catch(() => null)) ?? [];
  context.t = createStrings(messages);
  return context.t;
}
