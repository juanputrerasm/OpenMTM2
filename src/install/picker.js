/*
  Picking the player's MTM2 folder (main thread).

  Every browser goes through `<input webkitdirectory>`. Chromium's showDirectoryPicker is not
  used: its directory handles hide files it deems unsafe, POD.INI and the DLLs among them
  (listing skips them, getFileHandle throws "Name is not allowed"), while the input hands over
  every file. The result is a source that hands out File objects by path relative to the picked
  folder, matched without regard to case (the game's POD.INI names are lowercase, the files
  uppercase).
*/
import { installPathKey } from "./pod-ini.js";

/** Ask the player for their game folder. Resolves to a source, or null if they cancel. */
export async function pickInstallFolder() {
  const files = await chooseWithInput();
  return files ? fileListSource(files) : null;
}

/**
 * A source over the FileList of `<input webkitdirectory>`. Every path starts with the picked
 * folder's own name, which is dropped.
 */
export function fileListSource(files) {
  const byPath = new Map();
  let name = "";
  for (const file of files) {
    const relative = file.webkitRelativePath || file.name;
    const slash = relative.indexOf("/");
    if (!name && slash > 0) name = relative.slice(0, slash);
    byPath.set(installPathKey(slash > 0 ? relative.slice(slash + 1) : relative), file);
  }
  return {
    name,
    async getFile(path) {
      return byPath.get(installPathKey(path)) ?? null;
    },
    /** Every file's path relative to the picked folder (upper case, forward slashes). */
    async list() {
      return [...byPath.keys()];
    },
  };
}

function chooseWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.addEventListener("change", () => resolve(input.files?.length ? [...input.files] : null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}
