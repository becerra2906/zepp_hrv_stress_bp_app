import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { start } = require('@zeppos/zpm')

// Compila el paquete .zab en modo "preview" específicamente para Amazfit T-Rex 2 (sources 418, 419)
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
mkdirSync(tmpDir, { recursive: true })
execSync(`tar -xf "${path.join('dist', zabName)}" -C "${tmpDir}"`)
const innerZpk = readdirSync(tmpDir).find((f) => f.endsWith('.zpk'))

mkdirSync('release', { recursive: true })
copyFileSync(path.join(tmpDir, innerZpk), path.join('release', 'activacion-trex2.zpk'))
copyFileSync(path.join(tmpDir, innerZpk), path.join('release', 'activacion-trex2-preview.zpk'))
rmSync(tmpDir, { recursive: true, force: true })
console.log('Updated release/activacion-trex2-preview.zpk with inner preview ZPK:', innerZpk)
