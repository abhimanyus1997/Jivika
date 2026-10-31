// Packages Jivika Clipper: extension/dist/jivika-clipper/ (unpacked), extension/dist/jivika-clipper.zip and
// extension/dist/bookmarklet.txt, then copies the zip and bookmarklet to frontend/public/downloads/ so the site serves them.
// No dependencies beyond Node and the frontend's own rolldown (used only to minify the bookmarklet).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

const here = import.meta.dirname
const src = join(here, 'src')
const dist = join(here, 'dist')
const unpacked = join(dist, 'jivika-clipper')
const downloads = join(here, '..', 'frontend', 'public', 'downloads')

rmSync(dist, { recursive: true, force: true })
cpSync(src, unpacked, { recursive: true, filter: (p) => !p.endsWith('bookmarklet.js') })

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))

// Minimal zip writer (deflate, fixed 2026-01-01 timestamp so rebuilds are byte-identical).
function zip(paths, base) {
  const local = []
  const central = []
  let offset = 0
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const p of paths.sort()) {
    const name = Buffer.from(relative(base, p).split('\\').join('/'))
    const raw = readFileSync(p)
    const data = deflateRawSync(raw, { level: 9 })
    const crc = crc32(raw)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(8, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(offset, 42)
    local.push(head, name, data)
    central.push(cen, name)
    offset += head.length + name.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cd, end])
}

// Files sit at the zip root, so "Load unpacked" works on the folder the zip extracts into.
const zipped = zip(files(unpacked), unpacked)
writeFileSync(join(dist, 'jivika-clipper.zip'), zipped)

// Bookmarklet: the same extractor and hand-off code, minified into one javascript: URL.
const strip = (f) => readFileSync(join(src, f), 'utf8').replace(/^if \(typeof module !== 'undefined'\).*$/m, '')
const code = `(function(){${strip('extract.js')}\n${strip('clip.js')}\n${strip('bookmarklet.js')}})()`
const { minifySync } = createRequire(join(here, '..', 'frontend', 'package.json'))('rolldown/utils')
const min = minifySync('bookmarklet.js', code, { compress: true, mangle: true }).code.trim()
const bookmarklet = 'javascript:' + encodeURIComponent(min)
writeFileSync(join(dist, 'bookmarklet.txt'), bookmarklet + '\n')

mkdirSync(downloads, { recursive: true })
writeFileSync(join(downloads, 'jivika-clipper.zip'), zipped)
writeFileSync(join(downloads, 'bookmarklet.txt'), bookmarklet + '\n')
console.log(`jivika-clipper.zip ${zipped.length} bytes, bookmarklet ${bookmarklet.length} chars`)
