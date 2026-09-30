// Zip files, written and read with no library.
//
// Stored, not compressed. The text going out of here is small already, and
// the PDFs going into a backup are compressed inside themselves -- deflating
// them again would cost a phone's battery for a few percent. Stored entries
// are also what can be read back a piece at a time, straight out of the Blob,
// without the whole archive ever being held in memory.
//
// No Zip64, so one archive stays under 4 GB. A backup larger than that is
// split into parts by the caller rather than written as one file the share
// sheet would struggle to hand over anyway.

const CHUNK = 8 * 1024 * 1024;
export const MAX_ZIP_BYTES = 0xffffffff;

let crcTable = null;
function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

function crcUpdate(crc, bytes) {
  const t = table();
  for (let i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

/** CRC-32 of a Blob, read a few megabytes at a time. */
export async function crc32(blob) {
  let crc = 0xffffffff;
  for (let at = 0; at < blob.size; at += CHUNK) {
    crc = crcUpdate(crc, new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// The MS-DOS date and time a zip entry carries.
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Build a zip from [{ name, data }], where data is a Blob or a string.
 *
 * Names are UTF-8, flagged as such, so a manual titled in anything other than
 * plain English arrives with its name intact.
 */
export async function makeZip(entries, { onProgress } = {}) {
  const enc = new TextEncoder();
  const { time, day } = dosTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [i, entry] of entries.entries()) {
    const data = typeof entry.data === 'string'
      ? new Blob([entry.data], { type: 'text/plain' })
      : entry.data;
    const name = enc.encode(entry.name);
    const crc = await crc32(data);
    const size = data.size;
    if (offset + 30 + name.length + size > MAX_ZIP_BYTES) throw new Error('Too large for one zip');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);          // UTF-8 names
    local.setUint16(8, 0, true);               // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(dir.buffer, name);

    offset += 30 + name.length + size;
    onProgress?.(i + 1, entries.length);
  }

  const dirSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** Inflate raw deflate data, with the browser's own decompressor. */
async function inflate(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).blob();
}

/**
 * Read a zip's table of contents: [{ name, size, stored, blob, read() }].
 *
 * A stored entry's blob is a slice of the archive, not a copy, so a backup of
 * a few gigabytes can be opened without reading it into memory. A compressed
 * one -- every EPUB is one of these -- is inflated when read() is called,
 * and only then.
 */
export async function readZip(blob) {
  const tailSize = Math.min(blob.size, 22 + 0xffff);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
  let endAt = -1;
  for (let i = tailSize - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { endAt = i; break; }
  }
  if (endAt < 0) throw new Error('Not a zip file');
  const count = tail.getUint16(endAt + 10, true);
  const dirSize = tail.getUint32(endAt + 12, true);
  const dirAt = tail.getUint32(endAt + 16, true);

  const dir = new DataView(await blob.slice(dirAt, dirAt + dirSize).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (dir.getUint32(p, true) !== 0x02014b50) throw new Error('This zip is damaged');
    const method = dir.getUint16(p + 10, true);
    const packed = dir.getUint32(p + 20, true);
    const size = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true);
    const extraLen = dir.getUint16(p + 30, true);
    const commentLen = dir.getUint16(p + 32, true);
    const localAt = dir.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const local = new DataView(await blob.slice(localAt, localAt + 30).arrayBuffer());
    const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const raw = blob.slice(dataAt, dataAt + packed);
    const stored = method === 0;
    out.push({
      name, size, stored,
      blob: stored ? raw : null,
      read: stored ? async () => raw
        : method === 8 ? () => inflate(raw)
        : async () => { throw new Error(`${name} is packed in a way this cannot open`); }
    });
  }
  return out;
}
