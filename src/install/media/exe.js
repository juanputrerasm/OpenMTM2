/*
  A self-extracting installer: a Windows program with one or more cabinets inside it, as the MTM2 trial's MtM2trial.EXE
  (docs/STANDALONE_ASSETS.md, "The trial"). Its stub code holds stray "MSCF" bytes too, so each hit is checked as a
  header (media/cab.js `isCabinetHeader`) and a cabinet found is stepped over whole.
*/
import { isCabinetHeader } from "./cab.js";

/** Programs larger than this are not read as installers: the whole file is scanned in memory. */
export const MAX_INSTALLER_BYTES = 256 * 1024 * 1024;

/** Whether `bytes` start like a Windows program. */
export const isExe = (bytes) => bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;

/** The offsets of the cabinets inside `bytes`. */
export function findCabinets(bytes) {
  const found = [];
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] !== 0x4d || bytes[i + 1] !== 0x53 || bytes[i + 2] !== 0x43 || bytes[i + 3] !== 0x46) continue;
    if (!isCabinetHeader(bytes, i)) continue;
    found.push(i);
    i += new DataView(bytes.buffer, bytes.byteOffset + i + 8, 4).getUint32(0, true) - 1;
  }
  return found;
}
