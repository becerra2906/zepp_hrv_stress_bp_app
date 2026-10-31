import { getDeviceInfo } from '@zos/device'
import { px } from '@zos/utils'

// Pantallas redondas (T-Rex 2 454 px, GTR 4 466 px, Balance 480 px...). Diseño en 480 px.
const { width: W } = getDeviceInfo()

const RING = px(300)
const CX = Math.round(W / 2)

export const LAYOUT = {
  ring: { x: CX - RING / 2, y: px(40), w: RING, h: RING, lineWidth: px(22) },
  score: { x: 0, y: px(120), w: W, h: px(90), size: px(80) },
  state: { x: 0, y: px(210), w: W, h: px(40), size: px(30) },
  hr: { x: 0, y: px(250), w: W, h: px(36), size: px(28) },
  rhr: { x: px(40), y: px(352), w: W - px(80), h: px(34), size: px(24) },
  load: { x: px(40), y: px(388), w: W - px(80), h: px(34), size: px(24) },
  alert: { x: px(40), y: px(424), w: W - px(80), h: px(60), size: px(24) },
  bpButton: { x: CX - px(120), y: px(500), w: px(240), h: px(66), size: px(26) },
  insightsButton: { x: CX - px(120), y: px(578), w: px(240), h: px(66), size: px(26) },
  bpLast: { x: px(40), y: px(656), w: W - px(80), h: px(40), size: px(24) },
  bottomPad: px(140), // espacio extra para poder desplazar hasta el final en pantallas redondas
}
