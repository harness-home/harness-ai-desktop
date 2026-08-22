// Generate the app/tray icons (build/icon.png + build/icon.ico). Hand-encoded
// PNG instead of an imaging dependency: a deterministic rounded square with
// the brand "H" needs less code than a library, and the artifact is
// reproducible. The ICO embeds PNGs directly (allowed since Vista), which
// also sidesteps electron-builder's flaky WASM icon converter.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const BG = [15, 118, 110] // #0f766e — brand primary (light)
const FG = [255, 255, 255]

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function insideRoundedSquare(x, y, size, radius) {
  const nx = Math.min(x, size - 1 - x)
  const ny = Math.min(y, size - 1 - y)
  if (nx >= radius || ny >= radius) return true
  const dx = radius - nx
  const dy = radius - ny
  return dx * dx + dy * dy <= radius * radius
}

/** The brand "H": two pillars and a crossbar (mirrors the web BrandMark). */
function insideGlyph(x, y, size) {
  const u = x / size
  const v = y / size
  const inPillar = (left) => u >= left && u <= left + 0.125 && v >= 0.25 && v <= 0.75
  const inBar = u >= 0.3125 && u <= 0.6875 && v >= 0.4375 && v <= 0.5625
  return inPillar(0.25) || inPillar(0.625) || inBar
}

function renderPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      if (!insideRoundedSquare(x, y, size, Math.round(size * 0.2))) {
        raw[p++] = 0; raw[p++] = 0; raw[p++] = 0; raw[p++] = 0
        continue
      }
      const [r, g, b] = insideGlyph(x, y, size) ? FG : BG
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function renderIco(sizes) {
  const images = sizes.map((size) => ({ size, data: renderPng(size) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = []
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[4] = 1 // color planes
    entry[6] = 32 // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const out = join(root, 'build')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'icon.png'), renderPng(256))
writeFileSync(join(out, 'icon.ico'), renderIco([16, 24, 32, 48, 64, 128, 256]))
console.log('generate-icon: build/icon.png + build/icon.ico written')
