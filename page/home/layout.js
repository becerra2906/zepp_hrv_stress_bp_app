import { W, IS_ROUND, scale } from '../../utils/device.js'

const CX = Math.round(W / 2)

// Pantallas redondas (T-Rex 2 / GTR 3 454 px, GTR 3 Pro 480 px). Diseño en 480 px.
function roundLayout() {
  const RING = scale(300)
  return {
    ring: { x: CX - RING / 2, y: scale(40), w: RING, h: RING, lineWidth: scale(22) },
    score: { x: 0, y: scale(120), w: W, h: scale(90), size: scale(80) },
    state: { x: 0, y: scale(210), w: W, h: scale(40), size: scale(30) },
    hr: { x: 0, y: scale(250), w: W, h: scale(36), size: scale(28) },
    rhr: { x: scale(40), y: scale(352), w: W - scale(80), h: scale(34), size: scale(24) },
    load: { x: scale(40), y: scale(388), w: W - scale(80), h: scale(34), size: scale(24) },
    alert: { x: scale(40), y: scale(424), w: W - scale(80), h: scale(60), size: scale(24) },
    bpButton: { x: CX - scale(120), y: scale(500), w: scale(240), h: scale(66), size: scale(26) },
    insightsButton: { x: CX - scale(120), y: scale(578), w: scale(240), h: scale(66), size: scale(26) },
    bpLast: { x: scale(40), y: scale(656), w: W - scale(80), h: scale(40), size: scale(24) },
    bottomPad: scale(140), // espacio extra para poder desplazar hasta el final en pantallas redondas
  }
}

// Pantallas cuadradas (GTS 3 390×450). Diseño en 390 px.
function squareLayout() {
  const RING = scale(240)
  return {
    ring: { x: CX - RING / 2, y: scale(20), w: RING, h: RING, lineWidth: scale(18) },
    score: { x: 0, y: scale(85), w: W, h: scale(70), size: scale(64) },
    state: { x: 0, y: scale(155), w: W, h: scale(34), size: scale(24) },
    hr: { x: 0, y: scale(189), w: W, h: scale(30), size: scale(22) },
    rhr: { x: scale(16), y: scale(275), w: W - scale(32), h: scale(30), size: scale(20) },
    load: { x: scale(16), y: scale(307), w: W - scale(32), h: scale(30), size: scale(20) },
    alert: { x: scale(16), y: scale(339), w: W - scale(32), h: scale(52), size: scale(20) },
    bpButton: { x: CX - scale(110), y: scale(400), w: scale(220), h: scale(56), size: scale(22) },
    insightsButton: { x: CX - scale(110), y: scale(466), w: scale(220), h: scale(56), size: scale(22) },
    bpLast: { x: scale(16), y: scale(530), w: W - scale(32), h: scale(34), size: scale(20) },
    bottomPad: scale(40),
  }
}

export const LAYOUT = IS_ROUND ? roundLayout() : squareLayout()
