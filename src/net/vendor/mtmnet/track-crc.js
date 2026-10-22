// Generated from openmtm2-server 0.1.0 protocol/track-crc.js. Do not edit; run its tools/vendor.mjs.
/*
  The game's track checksum (OpenMTM2 docs/MONSTER_EXE_ANALYSIS.md 14.2, 0x569e50): CRC-32/MPEG-2
  over the whole POD that holds the track's SIT. Polynomial 0x04C11DB7, most significant bit
  first, initial value 0xFFFFFFFF, no final XOR. Sent in packet 0x25 and used by rooms to tell
  two copies of a track apart. Browser and Node; no dependencies.
*/

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** Start a running checksum. */
export const crcStart = () => 0xffffffff;
/** Feed bytes into a running checksum; returns the new value. */
export function crcUpdate(crc, bytes) {
  let c = crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = ((c << 8) ^ TABLE[((c >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return c;
}
/** The checksum of a whole buffer. */
export const trackCrc = (bytes) => crcUpdate(crcStart(), bytes);
