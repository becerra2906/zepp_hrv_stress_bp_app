import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const QRCode = require('../node_modules/qrcode-terminal/vendor/QRCode/index.js')
const QRErrorCorrectLevel = require('../node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js')

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function renderQrPng(text, outPath, { scale = 10, margin = 4 } = {}) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M)
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  const size = (count + margin * 2) * scale

  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    const row = Math.floor(y / scale) - margin
    for (let x = 0; x < size; x++) {
      const col = Math.floor(x / scale) - margin
      const isDark = row >= 0 && row < count && col >= 0 && col < count ? qr.isDark(row, col) : false
      const c = isDark ? 0 : 255
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = c
      raw[o + 1] = c
      raw[o + 2] = c
      raw[o + 3] = 255
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(outPath, png)
  return { size, bytes: png.length }
}

const url =
  process.argv[2] ||
  'zpkd1://raw.githubusercontent.com/becerra2906/zepp_hrv_stress_bp_app/main/release/activacion-trex2-preview.zpk'
const customOut = process.argv[3]

if (customOut) {
  const res = renderQrPng(url, customOut)
  console.log('QR generated:', url, res)
} else {
  mkdirSync('release', { recursive: true })
  const res1 = renderQrPng(url, 'release/qr-trex2.png')
  const artifactQr =
    'C:/Users/aleja/.gemini/antigravity/brain/2a9f27db-070d-4492-8330-9ca9f7ae9b6e/qr-trex2.png'
  renderQrPng(url, artifactQr)
  console.log('QR generated:', url, res1)
}
