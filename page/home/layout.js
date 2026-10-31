import { W, scale, top, COL_X, COL_W } from '../../utils/device.js'

const CX = Math.round(W / 2)
const RING = scale(280)
// En pantalla cuadrada se sube todo 26 px de diseño (no hay borde redondo arriba).
const T = (v) => top(v, 26)

// Coordenadas del lienzo "Activación — UI T-Rex 2", artboard 1 · Inicio (454 px).
export const LAYOUT = {
  ring: { x: CX - RING / 2, y: T(46), w: RING, h: RING, lineWidth: scale(22) },
  caption: { x: 0, y: T(96), w: W, h: scale(24), size: scale(18) },
  score: { x: 0, y: T(120), w: W, h: scale(84), size: scale(76) },
  state: { x: 0, y: T(204), w: W, h: scale(36), size: scale(28) },
  hr: { x: 0, y: T(242), w: W, h: scale(34), size: scale(26) },
  tip: { x: COL_X, y: T(346), w: COL_W, h: scale(64), size: scale(22) },

  header: { h: scale(30), size: scale(22) },
  hoyHeader: { y: T(432) },
  // Resumen 2×2
  tiles: {
    x: COL_X, y: T(470), w: Math.round((COL_W - scale(12)) / 2), h: scale(94), gap: scale(12), pad: scale(14),
    sizeLabel: scale(16), sizeValue: scale(30), sizeContext: scale(15), radius: scale(20),
  },
  // Tu día: 24 barras por hora
  day: {
    headerY: T(690), x: COL_X, y: T(726), w: COL_W, h: scale(120), pad: scale(12), radius: scale(16),
    barW: scale(10), barGap: scale(4), barMaxH: scale(80), labelSize: scale(14),
  },
  // Últimos 7 días: 3 filas con mini barras
  week: {
    headerY: T(870), x: COL_X, y: T(906), w: COL_W, h: scale(62), gap: scale(8), pad: scale(14), radius: scale(20),
    sizeLabel: scale(16), sizeValue: scale(22), barW: scale(20), barGap: scale(8), barMaxH: scale(44), labelSize: scale(14),
  },
  bpButton: { x: CX - scale(160), y: T(1146), w: scale(320), h: scale(66), size: scale(24) },
  insightsButton: { x: CX - scale(160), y: T(1224), w: scale(320), h: scale(66), size: scale(24) },
  bottomPad: scale(120),
}
