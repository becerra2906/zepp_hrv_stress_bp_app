import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { start } = require('@zeppos/zpm')

// Compila el paquete .zab (Zepp OS 1.0, configVersion v2) con los parámetros de `zeus build`, pero en `buildMode: 'preview'`.
// Ojo: los paquetes preview caducan a las 48 h (packageInfo.expiredTime), hay que regenerarlos antes de instalar.
const zabName = await start({
  path: process.cwd(),
  buildMode: 'preview',
  targets: ['trex2', 'gtr3-pro', 'gts3'],
  sources: [],
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
// El .zab es un ZIP: hace falta bsdtar (el tar.exe de Windows); el GNU tar de Git Bash no lo abre.
const tarBin =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
execSync(`"${tarBin}" -xf "${path.join('dist', zabName)}" -C "${tmpDir}"`)

const manifest = JSON.parse(readFileSync(path.join(tmpDir, 'manifest.json'), 'utf8'))
const trexEntry = manifest.zpks.find((z) =>
  z.platforms.some(
    (p) =>
      p.screenType === 'round' &&
      p.screenResolution === '454x454' &&
      p.cpuPlatform === 'NXP'
  )
)

if (!trexEntry) {
  throw new Error('No se encontró el ZPK round 454x454 NXP en manifest.json')
}

const zpkPath = path.join(tmpDir, trexEntry.name)
const zpkBuf = readFileSync(zpkPath)
const actualMd5 = createHash('md5').update(zpkBuf).digest('hex')

if (actualMd5 !== trexEntry.md5) {
  throw new Error(`MD5 mismatch: expected ${trexEntry.md5}, got ${actualMd5}`)
}

mkdirSync('release', { recursive: true })
// El QR zpkd1:// debe servir el .zab completo (con manifest.json), igual que `zeus preview`:
// la app Zepp elige el ZPK del reloj desde el manifest. Un .zpk suelto da "failed to unzip package".
copyFileSync(path.join('dist', zabName), path.join('release', 'activacion-os1.zab'))
// ZPK del T-Rex 2 solo como referencia / instalación manual
copyFileSync(zpkPath, path.join('release', 'activacion-trex2.zpk'))

rmSync(tmpDir, { recursive: true, force: true })
console.log('Verified native @zeppos/zpm preview ZPK:', {
  zpkName: trexEntry.name,
  md5: actualMd5,
  bytes: zpkBuf.length,
})
