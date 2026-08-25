// Generate the app/tray icons (build/icon.png + build/icon.ico). Hand-encoded
// PNG instead of an imaging dependency: the artifact stays reproducible and the
// build keeps working on a machine that cannot compile a native imaging module.
// The ICO embeds PNGs directly (allowed since Vista), which also sidesteps
// electron-builder's flaky WASM icon converter.
//
// The mark is the DeepSeek whale, inverted: white glyph on the brand blue. That
// needs a real vector fill, so this file carries a small path rasterizer —
// tokenize, flatten the cubics, scanline fill with nonzero winding, 4x vertical
// supersampling with exact horizontal coverage. Still no dependency.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const BG = [0x00, 0x73, 0xd5] // #0073D5 — DeepSeek blue
const FG = [255, 255, 255]
/** Fraction of the canvas the glyph's longest side spans. */
const GLYPH_SCALE = 0.7
/** Corner radius of the tile, as a fraction of the canvas. */
const CORNER_RADIUS = 0.2

// The DeepSeek whale, viewBox 0 0 50 50. Absolute M/C/Z only.
const WHALE_PATH =
  'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

// --- PNG container -----------------------------------------------------------

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

// --- Geometry ----------------------------------------------------------------

/** Flatten an SVG path (absolute M/L/C/Z) into closed polylines. */
function flattenPath(d, steps = 24) {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []
  const polys = []
  let poly = null
  let cx = 0
  let cy = 0
  let i = 0
  let op = ''
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/^[MLCZ]$/i.test(tokens[i])) op = tokens[i++].toUpperCase()
    if (i >= tokens.length && op !== 'Z') break
    if (op === 'M') {
      cx = num()
      cy = num()
      poly = [[cx, cy]]
      polys.push(poly)
      op = 'L' // a repeated coordinate pair after M is a lineto, per the grammar
    } else if (op === 'L') {
      cx = num()
      cy = num()
      poly.push([cx, cy])
    } else if (op === 'C') {
      const x1 = num()
      const y1 = num()
      const x2 = num()
      const y2 = num()
      const x = num()
      const y = num()
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const u = 1 - t
        poly.push([
          u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        ])
      }
      cx = x
      cy = y
    } else if (op === 'Z') {
      poly = null
      op = ''
    } else {
      i++ // unreachable for this path; skip rather than spin
    }
  }
  return polys
}

/** A rounded square as a single polygon, corners as arcs. */
function roundedSquare(size, radius, steps = 24) {
  const pts = []
  const corners = [
    [radius, radius, Math.PI, 1.5 * Math.PI],
    [size - radius, radius, 1.5 * Math.PI, 2 * Math.PI],
    [size - radius, size - radius, 0, 0.5 * Math.PI],
    [radius, size - radius, 0.5 * Math.PI, Math.PI],
  ]
  for (const [cx, cy, from, to] of corners) {
    for (let s = 0; s <= steps; s++) {
      const a = from + ((to - from) * s) / steps
      pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)])
    }
  }
  return [pts]
}

function transform(polys, scale, dx, dy) {
  return polys.map((p) => p.map(([x, y]) => [x * scale + dx, y * scale + dy]))
}

function bounds(polys) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys)
    for (const [x, y] of poly) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  return { minX, minY, maxX, maxY }
}

/**
 * Per-pixel coverage of the polygons, nonzero winding. Scanlines are sampled
 * SS times per pixel row; within a row the span is integrated exactly, so a
 * near-vertical edge comes out clean without a full sample grid per pixel.
 */
function rasterize(polys, size, SS = 4) {
  const cov = new Float64Array(size * size)
  const edges = []
  for (const poly of polys)
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]
      const [x1, y1] = poly[(i + 1) % poly.length]
      if (y0 !== y1) edges.push([x0, y0, x1, y1])
    }
  const xs = []
  for (let sy = 0; sy < size * SS; sy++) {
    const y = (sy + 0.5) / SS
    xs.length = 0
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 <= y === y1 <= y) continue
      xs.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1])
    }
    if (xs.length < 2) continue
    xs.sort((a, b) => a[0] - b[0])
    const row = Math.min(size - 1, (sy / SS) | 0)
    let winding = 0
    for (let i = 0; i < xs.length - 1; i++) {
      winding += xs[i][1]
      if (winding === 0) continue
      let a = Math.max(0, xs[i][0])
      const b = Math.min(size, xs[i + 1][0])
      while (a < b) {
        const px = Math.floor(a)
        const end = Math.min(b, px + 1)
        cov[row * size + px] += (end - a) / SS
        a = end
      }
    }
  }
  return cov
}

function renderPng(size) {
  const tile = rasterize(roundedSquare(size, size * CORNER_RADIUS), size)

  const glyph = flattenPath(WHALE_PATH)
  const b = bounds(glyph)
  const scale = (size * GLYPH_SCALE) / Math.max(b.maxX - b.minX, b.maxY - b.minY)
  const mark = rasterize(
    transform(
      glyph,
      scale,
      (size - (b.minX + b.maxX) * scale) / 2,
      (size - (b.minY + b.maxY) * scale) / 2,
    ),
    size,
  )

  const raw = Buffer.alloc(size * (size * 4 + 1))
  let p = 0
  for (let y = 0; y < size; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const a = Math.min(1, Math.max(0, tile[y * size + x]))
      const w = Math.min(a, Math.max(0, mark[y * size + x]))
      for (let c = 0; c < 3; c++) raw[p++] = Math.round(BG[c] + (FG[c] - BG[c]) * w)
      raw[p++] = Math.round(a * 255)
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
