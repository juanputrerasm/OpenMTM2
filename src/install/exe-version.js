/*
  Which MONSTER.EXE the install has, and what kind of build it is:
  - retail: 2.00.41 and 2.00.42;
  - beta: anything before 2.00.41;
  - community patch: anything after 2.00.42 (Community Patch 3 is 2.0.52.0).
  The menus start in the classic skin (the game's own art) on a retail or beta build and in the modern one on a community
  patch; the player can change it either way in Options.
*/

/** The retail builds. */
export const RETAIL_VERSIONS = Object.freeze(["2.00.41", "2.00.42"]);

/** Order two "2.00.42" style versions: negative, zero or positive. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** "retail", "beta", "patch" (a community patch), or "unknown" when the version could not be read. */
export function buildKind(version) {
  if (!version) return "unknown";
  if (compareVersions(version, "2.00.42") > 0) return "patch";
  if (compareVersions(version, "2.00.41") < 0) return "beta";
  return "retail";
}

/** The version string of a PE file, e.g. "2.00.42", from its version resource; null when it has none. */
export function readExeVersion(bytes) {
  const text = "FileVersion";
  // The resource's key in UTF-16: "FileVersion", then padding, then the value.
  const key = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) key[i * 2] = text.charCodeAt(i);
  const at = indexOf(bytes, key);
  if (at >= 0) {
    let p = at + key.length;
    while (p + 1 < bytes.length && bytes[p] === 0 && bytes[p + 1] === 0) p += 2;
    let out = "";
    while (p + 1 < bytes.length && (bytes[p] || bytes[p + 1]) && out.length < 32) { out += String.fromCharCode(bytes[p] | (bytes[p + 1] << 8)); p += 2; }
    const clean = out.replace(/[\s,]/g, ".").trim();
    if (/^\d+(\.\d+)+$/.test(clean)) return normalise(clean);
  }
  // The fixed file info: signature 0xFEEF04BD, structure version 0x10000, then the file version words.
  const sig = new Uint8Array([0xbd, 0x04, 0xef, 0xfe]);
  for (let i = indexOf(bytes, sig); i >= 0; i = indexOf(bytes, sig, i + 1)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + i, Math.min(16, bytes.length - i));
    if (view.byteLength < 16 || view.getUint32(4, true) !== 0x10000) continue;
    const ms = view.getUint32(8, true), ls = view.getUint32(12, true);
    return normalise(`${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`);
  }
  return null;
}

/** "2.0.0.42", "2.0.42.0" and "2.00.42" all read "2.00.42": major, minor to two digits, build to two digits. */
function normalise(version) {
  const p = version.split(".").map(Number);
  const [major, minor, build] = p.length === 4 ? [p[0], p[1], p[2] || p[3]] : p;
  const two = (n) => String(n ?? 0).padStart(2, "0");
  return `${major}.${two(minor)}.${two(build)}`;
}

function indexOf(bytes, pattern, from = 0) {
  outer: for (let i = from; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

/** The skin the menus use by default: classic for retail, beta and unread builds, modern for a community patch. */
export const defaultSkin = (version) => (buildKind(version) === "patch" ? "modern" : "classic");

/** The skin in force: the player's choice, or the build's default when the choice is "auto". */
export const resolveSkin = (choice, version) => (choice === "classic" || choice === "modern" ? choice : defaultSkin(version));
