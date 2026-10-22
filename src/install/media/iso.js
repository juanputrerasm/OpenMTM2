/*
  CD images (.ISO, ISO 9660), as a player makes one from their own Monster Truck Madness 2 disc.

  Volume descriptors start at sector 16, 2048 bytes per sector. The Joliet one (a supplementary descriptor with UCS-2
  names) is preferred where the disc has it, else the primary one's short names are used, without their ";1" version.
  A file is one extent of sectors, so it is handed out as a slice of the image: nothing is copied until the install
  copies it.

  Pure: works on Blobs, so it runs in a worker, the page or under Node.
*/

const SECTOR = 2048;
const MAX_DEPTH = 16;

/** Whether `bytes` (at least the first 34 KB of a file) hold an ISO 9660 volume descriptor at sector 16. */
export function isIso(bytes) {
  const at = 16 * SECTOR + 1;
  return bytes.length >= at + 5 && String.fromCharCode(...bytes.subarray(at, at + 5)) === "CD001";
}

/**
 * @param {Blob} blob
 * @returns {Promise<{ files: { path: string, size: number }[], open(path: string): Promise<Blob|null> }>}
 */
export async function openIso(blob) {
  const read = async (at, length) => new Uint8Array(await blob.slice(at, at + length).arrayBuffer());
  let primary = null, joliet = null;
  for (let sector = 16; sector < 64; sector++) {
    const d = await read(sector * SECTOR, SECTOR);
    if (d.length < SECTOR || String.fromCharCode(...d.subarray(1, 6)) !== "CD001") break;
    if (d[0] === 255) break;
    if (d[0] === 1 && !primary) primary = d;
    // Joliet: a supplementary descriptor whose escape sequence is %/@, %/C or %/E (UCS-2 levels 1 to 3).
    if (d[0] === 2 && d[88] === 0x25 && d[89] === 0x2f && [0x40, 0x43, 0x45].includes(d[90])) joliet = d;
  }
  const descriptor = joliet ?? primary;
  if (!descriptor) throw new Error("This disc image has no ISO 9660 volume.");
  const ucs2 = descriptor === joliet;
  const rootView = new DataView(descriptor.buffer, descriptor.byteOffset + 156, 34);
  const files = [];
  const walk = async (extent, size, prefix, depth) => {
    if (depth > MAX_DEPTH) return;
    const data = await read(extent * SECTOR, size);
    const view = new DataView(data.buffer);
    for (let at = 0; at < data.length;) {
      const length = data[at];
      // A zero length pads to the next sector.
      if (length === 0) { at = (Math.floor(at / SECTOR) + 1) * SECTOR; continue; }
      if (at + 33 > data.length) break;
      const fileExtent = view.getUint32(at + 2, true), fileSize = view.getUint32(at + 10, true);
      const flags = data[at + 25], nameLength = data[at + 32];
      const raw = data.subarray(at + 33, at + 33 + nameLength);
      at += length;
      if (nameLength === 1 && (raw[0] === 0 || raw[0] === 1)) continue;
      const name = isoName(raw, ucs2);
      if (flags & 2) await walk(fileExtent, fileSize, `${prefix}${name}/`, depth + 1);
      else files.push({ path: `${prefix}${name}`, size: fileSize, at: fileExtent * SECTOR });
    }
  };
  await walk(rootView.getUint32(2, true), rootView.getUint32(10, true), "", 0);
  const byPath = new Map(files.map((f) => [f.path.toUpperCase(), f]));
  return {
    files: files.map(({ path, size }) => ({ path, size })),
    async open(path) {
      const file = byPath.get(String(path).replace(/\\/g, "/").toUpperCase());
      return file ? blob.slice(file.at, file.at + file.size) : null;
    },
  };
}

function isoName(raw, ucs2) {
  let name = "";
  if (ucs2) for (let i = 0; i + 1 < raw.length; i += 2) name += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
  else name = new TextDecoder("latin1").decode(raw);
  return name.replace(/;\d+$/, "").replace(/\.$/, "");
}
