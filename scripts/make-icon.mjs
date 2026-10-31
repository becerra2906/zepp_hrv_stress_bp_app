// Genera un icono PNG simple (anillo de activación) sin dependencias.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const S = 248
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

const raw = Buffer.alloc(S * (S * 4 + 1))
const stops = [
  [0x34, 0xc7, 0x59],
  [0x2f, 0xa3, 0xff],
  [0xff, 0x9f, 0x0a],
  [0xff, 0x3b, 0x30],
]
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  for (let x = 0; x < S; x++) {
    const o = y * (S * 4 + 1) + 1 + x * 4
    const dx = x - S / 2 + 0.5
    const dy = y - S / 2 + 0.5
    const r = Math.hypot(dx, dy)
    let px = [0, 0, 0, 0]
    if (r <= S / 2) px = [0x10, 0x10, 0x10, 255]
    // ángulo desde abajo-izquierda en sentido horario, arco de 270°
    let a = (Math.atan2(dy, dx) * 180) / Math.PI + 225
    a = ((a % 360) + 360) % 360
    if (r >= S * 0.3 && r <= S * 0.42 && a <= 270) {
      const t = (a / 270) * (stops.length - 1)
      const i = Math.min(stops.length - 2, Math.floor(t))
      const f = t - i
      px = [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)).concat([255])
    }
    raw.set(px, o)
  }
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
for (const dir of ['assets/default.r', 'assets/default.s']) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/icon.png`, png)
}
console.log('icon ok', png.length)
