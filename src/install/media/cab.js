/*
  Microsoft Cabinet (.CAB) files, as the MTM2 trial's installer carries one (docs/STANDALONE_ASSETS.md, "The trial").

  A cabinet is a header, a table of folders, a table of files and the folders' data blocks. A folder is one compressed
  stream cut into blocks of up to 32 KB of output; a file is a range of its folder's output. Only what the trial needs is
  read: one cabinet (no spanning to a next one), with folders stored plain or in MSZIP. LZX and Quantum are refused with a
  message.

  MSZIP is deflate, one stream per block, but a block may refer back into the previous blocks' output (up to 32 KB). The
  browser's DecompressionStream has no way to preset that history, so each block is given it as deflate "stored" blocks
  first: the history comes out unchanged, the block's own references reach into it, and the history is cut off again.

  Pure: works on Blobs and Uint8Arrays, so it runs in a worker, the page or under Node.
*/

const HEADER_SIZE = 36;
const HISTORY = 32768;
const COMPRESSION_NAMES = { 2: "Quantum", 3: "LZX" };

/**
 * Whether `bytes` at `at` start a plausible cabinet header (a stray "MSCF" in other data is common). `available` is how
 * many bytes the file has from `at` on, when `bytes` holds only the header.
 */
export function isCabinetHeader(bytes, at = 0, available = bytes.length - at) {
  if (at + HEADER_SIZE > bytes.length) return false;
  if (bytes[at] !== 0x4d || bytes[at + 1] !== 0x53 || bytes[at + 2] !== 0x43 || bytes[at + 3] !== 0x46) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, HEADER_SIZE);
  const reserved1 = view.getUint32(4, true), size = view.getUint32(8, true), filesAt = view.getUint32(16, true);
  const minor = view.getUint8(24), major = view.getUint8(25), folders = view.getUint16(26, true);
  return reserved1 === 0 && major === 1 && minor === 3 && size > HEADER_SIZE && size <= available && filesAt < size && folders > 0;
}

/**
 * Read a cabinet's tables. `blob` holds the cabinet starting at `offset`.
 * @returns {Promise<{ files: { path: string, size: number }[], open(path: string, onProgress?: (done: number, total: number) => void): Promise<Blob|null> }>}
 */
export async function openCab(blob, offset = 0) {
  const head = new Uint8Array(await blob.slice(offset, offset + HEADER_SIZE).arrayBuffer());
  if (!isCabinetHeader(head, 0, blob.size - offset)) throw new Error("This is not a cabinet file.");
  const hv = new DataView(head.buffer);
  const size = hv.getUint32(8, true), filesAt = hv.getUint32(16, true);
  const folderCount = hv.getUint16(26, true), fileCount = hv.getUint16(28, true), flags = hv.getUint16(30, true);
  if (flags & 3) throw new Error("The cabinet continues in another file, which OpenMTM2 cannot follow.");
  const bytes = new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let at = HEADER_SIZE, folderReserve = 0, dataReserve = 0;
  if (flags & 4) {
    const headerReserve = view.getUint16(at, true);
    folderReserve = view.getUint8(at + 2);
    dataReserve = view.getUint8(at + 3);
    at += 4 + headerReserve;
  }
  const folders = [];
  for (let i = 0; i < folderCount; i++) {
    folders.push({ dataAt: view.getUint32(at, true), blocks: view.getUint16(at + 4, true), compression: view.getUint16(at + 6, true) & 0x0f });
    at += 8 + folderReserve;
  }
  const files = [];
  at = filesAt;
  for (let i = 0; i < fileCount; i++) {
    const fileSize = view.getUint32(at, true), start = view.getUint32(at + 4, true), folder = view.getUint16(at + 8, true);
    const attributes = view.getUint16(at + 14, true);
    let end = at + 16;
    while (end < bytes.length && bytes[end] !== 0) end++;
    const raw = bytes.subarray(at + 16, end);
    // Attribute 0x80 marks a UTF-8 name; others are in the installer's code page, read here as Latin-1.
    const path = (attributes & 0x80 ? new TextDecoder() : new TextDecoder("latin1")).decode(raw).replace(/\\/g, "/");
    files.push({ path, size: fileSize, start, folder });
    at = end + 1;
  }
  const decoded = new Map();
  const decodeFolder = (index, onProgress) => {
    if (!decoded.has(index)) decoded.set(index, inflateFolder(bytes, folders[index], dataReserve, onProgress));
    return decoded.get(index);
  };
  return {
    files: files.map(({ path, size: fileSize }) => ({ path, size: fileSize })),
    async open(path, onProgress) {
      const file = files.find((f) => f.path.toUpperCase() === String(path).replace(/\\/g, "/").toUpperCase());
      if (!file) return null;
      if (file.folder >= folders.length) throw new Error(`${file.path} continues across cabinets, which OpenMTM2 cannot follow.`);
      const data = await decodeFolder(file.folder, onProgress);
      if (file.start + file.size > data.length) throw new Error(`${file.path} runs past the end of its data.`);
      return new Blob([data.subarray(file.start, file.start + file.size)]);
    },
  };
}

/** One folder's whole output. */
async function inflateFolder(bytes, folder, dataReserve, onProgress) {
  if (folder.compression !== 0 && folder.compression !== 1) {
    throw new Error(`The cabinet uses ${COMPRESSION_NAMES[folder.compression] ?? "an unknown"} compression, which OpenMTM2 cannot unpack.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pieces = [];
  let total = 0, at = folder.dataAt, history = new Uint8Array(0);
  for (let i = 0; i < folder.blocks; i++) {
    const packed = view.getUint16(at + 4, true), unpacked = view.getUint16(at + 6, true);
    const start = at + 8 + dataReserve;
    const data = bytes.subarray(start, start + packed);
    at = start + packed;
    let out;
    if (folder.compression === 0) {
      out = data;
    } else {
      if (data[0] !== 0x43 || data[1] !== 0x4b) throw new Error(`Block ${i} of the cabinet is not MSZIP data.`);
      out = await inflateWithHistory(history, data.subarray(2));
    }
    if (out.length !== unpacked) throw new Error(`Block ${i} of the cabinet unpacked to ${out.length} bytes, not ${unpacked}.`);
    pieces.push(out);
    total += out.length;
    history = lastBytes(history, out);
    onProgress?.(i + 1, folder.blocks);
  }
  const whole = new Uint8Array(total);
  let p = 0;
  for (const piece of pieces) { whole.set(piece, p); p += piece.length; }
  return whole;
}

/** The last 32 KB of `history` followed by `out`. */
function lastBytes(history, out) {
  if (out.length >= HISTORY) return out.slice(out.length - HISTORY);
  const keep = Math.min(history.length, HISTORY - out.length);
  const next = new Uint8Array(keep + out.length);
  next.set(history.subarray(history.length - keep), 0);
  next.set(out, keep);
  return next;
}

/**
 * Raw deflate `data` whose references may reach into `history`: the history goes first as stored blocks (header byte 0:
 * not final, type stored; then LEN and its complement), so the block decodes as if it followed it.
 */
export async function inflateWithHistory(history, data) {
  const parts = [];
  for (let i = 0; i < history.length; i += 65535) {
    const n = Math.min(65535, history.length - i);
    parts.push(new Uint8Array([0, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff]), history.subarray(i, i + n));
  }
  parts.push(data);
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out.subarray(history.length);
}
