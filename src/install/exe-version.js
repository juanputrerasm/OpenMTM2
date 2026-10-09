/*
  Which MONSTER.EXE the install has. The game's own menu art (the classic skin) is laid out for the retail
  builds 2.00.41 and 2.00.42; any other build (the community patches among them) gets the modern skin.
*/

/** The builds the classic skin is made for. */
export const CLASSIC_VERSIONS = Object.freeze(["2.00.41", "2.00.42"]);

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

/** Whether the classic menu art fits this install; false when the build is unknown or not a retail one. */
export const classicUiAllowed = (version) => CLASSIC_VERSIONS.includes(version);
