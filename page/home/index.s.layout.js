import { getDeviceInfo } from '@zos/device'
import { px } from '@zos/utils'

// Pantallas cuadradas/rectangulares (GTS 4, Bip 5, Active...). Diseño en 390 px.
const { width: W } = getDeviceInfo()

const RING = px(240)
const CX = Math.round(W / 2)

export const LAYOUT = {
  ring: { x: CX - RING / 2, y: px(20), w: RING, h: RING, lineWidth: px(18) },
  score: { x: 0, y: px(85), w: W, h: px(70), size: px(64) },
  state: { x: 0, y: px(155), w: W, h: px(34), size: px(24) },
  hr: { x: 0, y: px(189), w: W, h: px(30), size: px(22) },
  rhr: { x: px(16), y: px(275), w: W - px(32), h: px(30), size: px(20) },
  load: { x: px(16), y: px(307), w: W - px(32), h: px(30), size: px(20) },
  alert: { x: px(16), y: px(339), w: W - px(32), h: px(52), size: px(20) },
  bpButton: { x: CX - px(110), y: px(400), w: px(220), h: px(56), size: px(22) },
  insightsButton: { x: CX - px(110), y: px(466), w: px(220), h: px(56), size: px(22) },
  bpLast: { x: px(16), y: px(530), w: W - px(32), h: px(34), size: px(20) },
  bottomPad: px(40),
}
