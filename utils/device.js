// Información de pantalla para Zepp OS 1.0 (no existe @zos/device; zpm reserva px/dp).
const info = hmSetting.getDeviceInfo()

export const W = info.width
export const H = info.height
// T-Rex 2 / GTR 3: 454×454, GTR 3 Pro: 480×480 → redondas; GTS 3: 390×450 → cuadrada.
export const IS_ROUND = info.width === info.height

// Diseño de referencia: 480 px (redondas) y 390 px (cuadradas), escalado al ancho real.
const DESIGN_W = IS_ROUND ? 480 : 390
export function scale(v) {
  return Math.round((v * W) / DESIGN_W)
}
