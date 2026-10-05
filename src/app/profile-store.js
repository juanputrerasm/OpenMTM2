/*
  The player's profiles and Hall of Fame, loaded once through the asset worker and saved
  whenever they change. Storage trouble never stops the game: loading falls back to the
  defaults and a failed save is ignored.
*/
import { currentDriver, normalizeProfiles } from "../game/profile.js";
import { normalizeHall } from "../game/hall-of-fame.js";

/** The profiles, loaded on first use and kept on the context. */
export async function getProfiles(context) {
  if (!context.profiles) {
    context.profiles = normalizeProfiles(await context.assets.call("userData", { key: "profiles" }).catch(() => null));
  }
  return context.profiles;
}

export async function saveProfiles(context) {
  await context.assets.call("saveUserData", { key: "profiles", value: context.profiles }).catch(() => {});
}

export async function getHall(context) {
  if (!context.hall) {
    context.hall = normalizeHall(await context.assets.call("userData", { key: "hall" }).catch(() => null));
  }
  return context.hall;
}

export async function saveHall(context) {
  await context.assets.call("saveUserData", { key: "hall", value: context.hall }).catch(() => {});
}

export { currentDriver };
