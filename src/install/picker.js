/*
  Picking the player's MTM2 folder (main thread).

  Chrome and Edge offer showDirectoryPicker; Firefox and Safari only `<input webkitdirectory>`.
  Either way the result is a source that hands out File objects by path relative to the picked
  folder, matched without regard to case (the game's POD.INI names are lowercase, the files
  uppercase).
*/
import { installPathKey } from "./pod-ini.js";

/** Ask the player for their game folder. Resolves to a source, or null if they cancel. */
export async function pickInstallFolder() {
  if (typeof window.showDirectoryPicker === "function") {
    try {
      const handle = await window.showDirectoryPicker({ id: "openmtm2-install", mode: "read" });
      return directorySource(handle);
    } catch (err) {
      if (err?.name === "AbortError") return null;
      throw err;
    }
  }
  const files = await chooseWithInput();
  return files ? fileListSource(files) : null;
}

/** A source over a FileSystemDirectoryHandle, listing each folder at most once. */
export function directorySource(root) {
  const listings = new Map(); // directory handle -> Map(UPPER name -> handle)
  async function listing(dir) {
    if (!listings.has(dir)) {
      const map = new Map();
      for await (const [name, handle] of dir.entries()) map.set(name.toUpperCase(), handle);
      listings.set(dir, map);
    }
    return listings.get(dir);
  }
  return {
    name: root.name,
    async getFile(path) {
      const parts = installPathKey(path).split("/").filter(Boolean);
      let dir = root;
      for (let i = 0; i < parts.length; i++) {
        const handle = (await listing(dir)).get(parts[i]);
        if (!handle) return null;
        if (i === parts.length - 1) return handle.kind === "file" ? handle.getFile() : null;
        if (handle.kind !== "directory") return null;
        dir = handle;
      }
      return null;
    },
  };
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
