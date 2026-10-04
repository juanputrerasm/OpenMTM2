/*
  Identify the MONSTER.EXE in a picked folder.

  OpenMTM2 never runs the executable; it only uses it to tell which build of the game the
  data comes from. Facts from MONSTER_EXE_ANALYSIS.md section 0 and JSTrackViewer's
  MTM2_PHYSICS_NOTES.md:

  | Build | Size | PE TimeDateStamp | Fixed file version |
  |---|---|---|---|
  | Retail 2.00.42 (official patch) | 2,925,568 | 900451983 | 2.0.42.0 |
  | Retail 2.0.41 (CD release) | 2,920,448 | 891472023 | 2.0.41.0 (not yet confirmed) |
  | Community Patch 3 | varies | varies | x86-64 (PE32+) |
*/

export const RETAIL_2_00_42 = Object.freeze({ size: 2925568, timeDateStamp: 900451983, fileVersion: "2.0.42.0" });
export const RETAIL_2_0_41 = Object.freeze({ size: 2920448, timeDateStamp: 891472023 });

const MACHINE_I386 = 0x014c;
const MACHINE_AMD64 = 0x8664;
// VS_FIXEDFILEINFO.dwSignature, little-endian.
const FIXED_INFO_SIGNATURE = [0xbd, 0x04, 0xef, 0xfe];

/**
 * Read what identifies a Windows executable.
 * @param {Uint8Array} bytes the whole file
 */
export function inspectExe(bytes) {
  const info = { size: bytes.length, isPe: false, machine: 0, timeDateStamp: 0, fileVersion: null };
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return info; // "MZ"
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peOffset = view.getUint32(0x3c, true);
  if (peOffset + 24 > bytes.length) return info;
  if (view.getUint32(peOffset, true) !== 0x00004550) return info; // "PE\0\0"
  info.isPe = true;
  info.machine = view.getUint16(peOffset + 4, true);
  info.timeDateStamp = view.getUint32(peOffset + 8, true);
  info.fileVersion = findFixedFileVersion(bytes, view);
  return info;
}

/** The FileVersion of the first VS_FIXEDFILEINFO in the file, as "a.b.c.d", or null. */
function findFixedFileVersion(bytes, view) {
  const [s0, s1, s2, s3] = FIXED_INFO_SIGNATURE;
  for (let i = 0; i + 16 <= bytes.length; i += 4) {
    if (bytes[i] !== s0 || bytes[i + 1] !== s1 || bytes[i + 2] !== s2 || bytes[i + 3] !== s3) continue;
    // The signature can occur by chance in code or data; the real structure is followed by
    // dwStrucVersion 0x00010000.
    if (view.getUint32(i + 4, true) !== 0x00010000) continue;
    const ms = view.getUint32(i + 8, true);
    const ls = view.getUint32(i + 12, true);
    return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
  }
  return null;
}

/**
 * Decide whether OpenMTM2 can use the install this executable belongs to.
 * @returns {{ build: string, supported: boolean, message: string }}
 */
export function classifyExe(info) {
  if (!info.isPe) {
    return { build: "unknown", supported: false, message: "MONSTER.EXE is not a Windows executable." };
  }
  if (info.machine === MACHINE_AMD64) {
    return {
      build: "community-patch",
      supported: false,
      message: "This is a Community Patch (64-bit) install. OpenMTM2 supports the retail 2.00.42 "
        + "version for now; Community Patch support comes later.",
    };
  }
  if (info.machine !== MACHINE_I386) {
    return { build: "unknown", supported: false, message: "MONSTER.EXE is not a 32-bit x86 executable." };
  }
  if (info.size === RETAIL_2_00_42.size && info.timeDateStamp === RETAIL_2_00_42.timeDateStamp) {
    return { build: "retail-2.00.42", supported: true, message: "Monster Truck Madness 2, version 2.00.42." };
  }
  if (info.size === RETAIL_2_0_41.size && info.timeDateStamp === RETAIL_2_0_41.timeDateStamp) {
    return {
      build: "retail-2.0.41",
      supported: true,
      message: "Monster Truck Madness 2, version 2.0.41 (before the official patch). Its tracks "
        + "and trucks are the same; OpenMTM2 is tested against 2.00.42.",
    };
  }
  return {
    build: "unknown",
    supported: false,
    message: `Unrecognised MONSTER.EXE (${info.size} bytes, version ${info.fileVersion ?? "unknown"}). `
      + "OpenMTM2 needs the retail version 2.00.42.",
  };
}
