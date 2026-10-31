import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const { start } = require('@zeppos/zpm')

// Tabla CRC32 estándar IEEE 802.3
const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[i] = c >>> 0
}

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Crea un archivo ZIP 100% compatible con PKZIP 2.0 / Android ZipInputStream / minizip:
 * - Sin entradas de directorio vacías (0 bytes) que puedan fallar en minizip
 * - Sin descriptores de datos (bit 3 = 0), tamaños y CRC escritos en la cabecera local
 * - Si un archivo pequeño crece al comprimirse con Deflate (ej. TID.btxt de 4 bytes), usa STORE (method 0)
 */
function buildCleanZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  // Fecha/hora DOS fija válida (2024-06-01 12:00:00)
  const dosTime = (12 << 11) | (0 << 5) | 0
  const dosDate = ((2024 - 1980) << 9) | (6 << 5) | 1

  for (const { name, data, forceStore } of entries) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8')
    const rawBuf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const crc = crc32(rawBuf)
    const deflated = forceStore ? rawBuf : deflateRawSync(rawBuf, { level: 6 })

    const useDeflate = !forceStore && deflated.length < rawBuf.length
    const method = useDeflate ? 8 : 0
    const compBuf = useDeflate ? deflated : rawBuf
    const verNeeded = useDeflate ? 20 : 10

    const localHeader = Buffer.alloc(30 + nameBuf.length)
    localHeader.writeUInt32LE(0x04034b50, 0) // Local file header signature
    localHeader.writeUInt16LE(verNeeded, 4) // Version needed to extract
    localHeader.writeUInt16LE(0, 6) // General purpose bit flag
    localHeader.writeUInt16LE(method, 8) // Compression method (8=Deflate, 0=Store)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(compBuf.length, 18)
    localHeader.writeUInt32LE(rawBuf.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28) // Extra field length
    nameBuf.copy(localHeader, 30)

    const centralHeader = Buffer.alloc(46 + nameBuf.length)
    centralHeader.writeUInt32LE(0x02014b50, 0) // Central directory signature
    centralHeader.writeUInt16LE(20, 4) // Version made by (2.0, MS-DOS)
    centralHeader.writeUInt16LE(verNeeded, 6) // Version needed to extract
    centralHeader.writeUInt16LE(0, 8) // General purpose bit flag
    centralHeader.writeUInt16LE(method, 10) // Compression method
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(compBuf.length, 20)
    centralHeader.writeUInt32LE(rawBuf.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30) // Extra field length
    centralHeader.writeUInt16LE(0, 32) // File comment length
    centralHeader.writeUInt16LE(0, 34) // Disk number start
    centralHeader.writeUInt16LE(0, 36) // Internal file attributes
    centralHeader.writeUInt32LE(0, 38) // External file attributes (0 = normal file)
    centralHeader.writeUInt32LE(offset, 42) // Relative offset of local header
    nameBuf.copy(centralHeader, 46)

    localParts.push(localHeader, compBuf)
    centralParts.push(centralHeader)
    offset += localHeader.length + compBuf.length
  }

  const centralDirBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // End of central directory signature
  eocd.writeUInt16LE(0, 4) // Number of this disk
  eocd.writeUInt16LE(0, 6) // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // Comment length

  return Buffer.concat([...localParts, centralDirBuf, eocd])
}

function collectFiles(dir, rootDir = dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      results.push(...collectFiles(full, rootDir))
    } else if (st.isFile()) {
      const rel = path.relative(rootDir, full).replace(/\\/g, '/')
      results.push({ name: rel, data: readFileSync(full) })
    }
  }
  // Garantizar que app.json vaya siempre como primera entrada del ZIP
  results.sort((a, b) => {
    if (a.name === 'app.json') return -1
    if (b.name === 'app.json') return 1
    return a.name.localeCompare(b.name)
  })
  return results
}

function normalizeManifest(appJsonPath) {
  const manifest = JSON.parse(readFileSync(appJsonPath, 'utf8'))
  manifest.platforms = [
    { deviceSource: 418, st: 'r', dw: 480 },
    { deviceSource: 419, st: 'r', dw: 480 },
    { deviceSource: 6553856, st: 'r', dw: 480 },
    { deviceSource: 6553857, st: 'r', dw: 480 },
    { deviceSource: 8192256, st: 'r', dw: 480 },
    { deviceSource: 8192257, st: 'r', dw: 480 },
  ]
  manifest.packageInfo = {
    mode: 'preview',
    timeStamp: 1710000000,
    expiredTime: 315360000,
    zpm: '3.4.2',
  }
  writeFileSync(appJsonPath, JSON.stringify(manifest))
}

// Compila el paquete .zab en modo "preview" para Amazfit T-Rex 2 (sources 418, 419)
const zabName = await start({
  path: process.cwd(),
  buildMode: 'preview',
  targets: [],
  sources: [418, 419],
  jsc: 'bin',
  png2vg: true,
  prune: true,
  compress: true,
  ip: false,
  legacyZpkName: false,
})

const tmpDir = path.join('dist', '_tmp_preview_extract')
rmSync(tmpDir, { recursive: true, force: true })
mkdirSync(tmpDir, { recursive: true })
execSync(`tar -xf "${path.join('dist', zabName)}" -C "${tmpDir}"`)
const innerZpk = readdirSync(tmpDir).find((f) => f.endsWith('.zpk'))

const zpkDir = path.join(tmpDir, 'zpk')
const devDir = path.join(tmpDir, 'device')
const sideDir = path.join(tmpDir, 'app-side')
mkdirSync(zpkDir, { recursive: true })
mkdirSync(devDir, { recursive: true })
mkdirSync(sideDir, { recursive: true })

execSync(`tar -xf "${path.join(tmpDir, innerZpk)}" -C "${zpkDir}"`)
execSync(`tar -xf "${path.join(zpkDir, 'device.zip')}" -C "${devDir}"`)
execSync(`tar -xf "${path.join(zpkDir, 'app-side.zip')}" -C "${sideDir}"`)

normalizeManifest(path.join(devDir, 'app.json'))
normalizeManifest(path.join(sideDir, 'app.json'))

const cleanDeviceZip = buildCleanZip(collectFiles(devDir))
const cleanAppSideZip = buildCleanZip(collectFiles(sideDir))
const cleanZpk = buildCleanZip([
  { name: 'device.zip', data: cleanDeviceZip },
  { name: 'app-side.zip', data: cleanAppSideZip },
])

mkdirSync('release', { recursive: true })
writeFileSync(path.join('release', 'activacion-trex2.zpk'), cleanZpk)
writeFileSync(path.join('release', 'activacion-trex2-preview.zpk'), cleanZpk)
copyFileSync(
  path.join('release', 'activacion-trex2-preview.zpk'),
  path.join('release', 'activacion-trex2-v2.zpk')
)

rmSync(tmpDir, { recursive: true, force: true })
console.log('Clean ZPK generated:', {
  deviceZipBytes: cleanDeviceZip.length,
  appSideZipBytes: cleanAppSideZip.length,
  totalZpkBytes: cleanZpk.length,
})
