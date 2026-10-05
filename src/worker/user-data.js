/*
  The player's own data in OPFS (`userdata/<key>.json`): driver profiles and the Hall of Fame.
  Kept apart from the install, so "Use a different install" does not touch it.
*/
import { readTextFile, removePath, writeBytesToFile } from "../shared/opfs.js";

const DIR = "userdata";
const validKey = (key) => /^[a-z0-9-]+$/.test(String(key));

export async function readUserData(key) {
  if (!validKey(key)) throw new Error(`Bad data key "${key}"`);
  try {
    return JSON.parse(await readTextFile(`${DIR}/${key}.json`));
  } catch {
    return null;
  }
}

export async function writeUserData(key, value) {
  if (!validKey(key)) throw new Error(`Bad data key "${key}"`);
  await writeBytesToFile(`${DIR}/${key}.json`, new TextEncoder().encode(JSON.stringify(value)));
}

export async function removeUserData() {
  await removePath(DIR);
}
