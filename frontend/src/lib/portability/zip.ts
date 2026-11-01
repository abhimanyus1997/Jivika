/* Minimal ZIP writer (stored entries) and reader (stored and DEFLATE via DecompressionStream). No ZIP64, no encryption. */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export const ZIP_LIMITS = { maxBytes: 25 * 1024 * 1024, maxEntries: 2000, maxTotal: 100 * 1024 * 1024, maxRatio: 50 }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()
export const utf8 = (s: string) => enc.encode(s)

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** Builds a ZIP with every entry stored (no compression). Names are UTF-8 (flag bit 11). */
export function writeZip(files: { name: string; data: Uint8Array | string }[], now = new Date()): Uint8Array {
  const { time, date } = dosTime(now)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = utf8(f.name)
    const data = typeof f.data === 'string' ? utf8(f.data) : f.data
    const crc = crc32(data)
    const head = new Uint8Array(30 + name.length)
    const h = new DataView(head.buffer)
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 0x0800, true)
    h.setUint16(8, 0, true)
    h.setUint16(10, time, true)
    h.setUint16(12, date, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, data.length, true)
    h.setUint32(22, data.length, true)
    h.setUint16(26, name.length, true)
    head.set(name, 30)
    const cen = new Uint8Array(46 + name.length)
    const c = new DataView(cen.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    cen.set(name, 46)
    locals.push(head, data)
    centrals.push(cen)
    offset += head.length + data.length
  }
  const cenSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, files.length, true)
  e.setUint16(10, files.length, true)
  e.setUint32(12, cenSize, true)
  e.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cenSize + 22)
  let p = 0
  for (const b of [...locals, ...centrals, end]) {
    out.set(b, p)
    p += b.length
  }
  return out
}

export const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

/** Lists entry names from the central directory without inflating anything. */
export function zipNames(bytes: Uint8Array): string[] {
  return centralDirectory(bytes).map((e) => e.name)
}

interface CenEntry {
  name: string
  method: number
  flags: number
  crc: number
  csize: number
  usize: number
  offset: number
}

function centralDirectory(bytes: Uint8Array): CenEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('The ZIP file is damaged (no central directory).')
  const count = v.getUint16(eocd + 10, true)
  const cenOffset = v.getUint32(eocd + 16, true)
  if (count === 0xffff || cenOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported.')
  if (count > ZIP_LIMITS.maxEntries) throw new Error(`The ZIP file has more than ${ZIP_LIMITS.maxEntries} entries.`)
  const dec = new TextDecoder()
  const out: CenEntry[] = []
  let p = cenOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('The ZIP file is damaged (bad directory entry).')
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    out.push({
      flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true),
      crc: v.getUint32(p + 16, true),
      csize: v.getUint32(p + 20, true),
      usize: v.getUint32(p + 24, true),
      offset: v.getUint32(p + 42, true),
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Inflates raw DEFLATE data, stopping as soon as the output passes `max` bytes. */
async function inflate(data: Uint8Array, max: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel()
      throw new Error('A file in the ZIP expands to more than its stated size.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}

/**
 * Reads entries whose name passes `want` (default: all files). Enforces the size, entry count,
 * total and expansion ratio caps, and checks each CRC.
 */
export async function readZip(bytes: Uint8Array, want: (name: string) => boolean = () => true, limits = ZIP_LIMITS): Promise<ZipEntry[]> {
  if (bytes.length > limits.maxBytes) throw new Error(`The ZIP file is larger than ${limits.maxBytes / 1024 / 1024} MB.`)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: ZipEntry[] = []
  let total = 0
  for (const e of centralDirectory(bytes)) {
    if (e.name.endsWith('/') || !want(e.name)) continue
    if (e.flags & 1) throw new Error('Encrypted ZIP files are not supported.')
    total += e.usize
    if (total > limits.maxTotal) throw new Error(`The ZIP file expands to more than ${limits.maxTotal / 1024 / 1024} MB.`)
    if (e.csize > 0 && e.usize / e.csize > limits.maxRatio && e.usize > 1024 * 1024) throw new Error('A file in the ZIP is compressed suspiciously well, so it was not opened.')
    if (e.offset + 30 > bytes.length || v.getUint32(e.offset, true) !== 0x04034b50) throw new Error('The ZIP file is damaged (bad file header).')
    const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true)
    const raw = bytes.subarray(start, start + e.csize)
    if (raw.length !== e.csize) throw new Error('The ZIP file is truncated.')
    let data: Uint8Array
    if (e.method === 0) data = raw
    else if (e.method === 8) data = await inflate(raw, e.usize)
    else throw new Error(`Unsupported compression method in the ZIP (${e.method}).`)
    if (data.length !== e.usize || crc32(data) !== e.crc) throw new Error(`The ZIP entry ${e.name} is damaged (checksum mismatch).`)
    out.push({ name: e.name, data })
  }
  return out
}
