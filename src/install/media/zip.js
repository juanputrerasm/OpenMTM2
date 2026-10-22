/*
  ZIP files: the MTM2 trial as the Internet Archive serves it (MtM2trial.zip), or a player's game folder zipped up.

  The central directory at the end lists every entry; an entry's data follows its local header. Entries are stored or
  deflated. A stored entry is a slice of the zip itself; a deflated one is inflated with the browser's
  DecompressionStream when it is opened, so a large zip is never read into memory whole. ZIP64 (zips over 4 GB) and
  encrypted entries are refused with a message.

  Pure: works on Blobs, so it runs in a worker, the page or under Node.
*/

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** Whether `bytes` start like a zip (a local header, or an empty zip's end record). */
export const isZip = (bytes) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);

/**
 * @param {Blob} blob
 * @returns {Promise<{ files: { path: string, size: number }[], open(path: string): Promise<Blob|null> }>}
 */
export async function openZip(blob) {
  const tailSize = Math.min(blob.size, 65535 + 22);
  const tail = new Uint8Array(await blob.slice(blob.size - tailSize).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === EOCD) { end = i; break; }
  if (end < 0) throw new Error("This zip file has no directory; it may be damaged or incomplete.");
  const count = tv.getUint16(end + 10, true), dirSize = tv.getUint32(end + 12, true), dirAt = tv.getUint32(end + 16, true);
  if (count === 0xffff || dirAt === 0xffffffff) throw new Error("This zip file is in the ZIP64 format, which OpenMTM2 cannot read.");
  const dir = new Uint8Array(await blob.slice(dirAt, dirAt + dirSize).arrayBuffer());
  const dv = new DataView(dir.buffer);
  const entries = [];
  for (let at = 0, i = 0; i < count; i++) {
    if (dv.getUint32(at, true) !== CENTRAL) throw new Error("This zip file's directory is damaged.");
    const flags = dv.getUint16(at + 8, true), method = dv.getUint16(at + 10, true);
    const packed = dv.getUint32(at + 20, true), size = dv.getUint32(at + 24, true);
    const nameLength = dv.getUint16(at + 28, true), extraLength = dv.getUint16(at + 30, true), commentLength = dv.getUint16(at + 32, true);
    const localAt = dv.getUint32(at + 42, true);
    const raw = dir.subarray(at + 46, at + 46 + nameLength);
    // Bit 11 marks a UTF-8 name; others are in the DOS code page, read here as Latin-1.
    const path = new TextDecoder(flags & 0x800 ? "utf-8" : "latin1").decode(raw).replace(/\\/g, "/");
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;
    entries.push({ path, size, packed, method, flags, localAt });
  }
  const byPath = new Map(entries.map((e) => [e.path.toUpperCase(), e]));
  return {
    files: entries.map(({ path, size }) => ({ path, size })),
    async open(path) {
      const entry = byPath.get(String(path).replace(/\\/g, "/").toUpperCase());
      if (!entry) return null;
      if (entry.flags & 1) throw new Error(`${entry.path} is encrypted, which OpenMTM2 cannot read.`);
      const local = new DataView(await blob.slice(entry.localAt, entry.localAt + 30).arrayBuffer());
      if (local.getUint32(0, true) !== LOCAL) throw new Error(`${entry.path} is damaged in the zip.`);
      const dataAt = entry.localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      const data = blob.slice(dataAt, dataAt + entry.packed);
      if (entry.method === 0) return data;
      if (entry.method !== 8) throw new Error(`${entry.path} is compressed in a way OpenMTM2 cannot unpack (method ${entry.method}).`);
      const out = await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
      if (out.size !== entry.size) throw new Error(`${entry.path} unpacked to ${out.size} bytes, not ${entry.size}.`);
      return out;
    },
  };
}
