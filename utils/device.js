// Información de pantalla para Zepp OS 1.0 (no existe @zos/device; zpm reserva px/dp).
const info = hmSetting.getDeviceInfo()

export const W = info.width
export const H = info.height
// T-Rex 2 / GTR 3: 454×454, GTR 3 Pro: 480×480 → redondas; GTS 3: 390×450 → cuadrada.
export const IS_ROUND = info.width === info.height

// El diseño (lienzo "Activación — UI T-Rex 2") está en px reales del T-Rex 2 (454), escalado al ancho real.
const DESIGN_W = 454
export function scale(v) {
  return Math.round((v * W) / DESIGN_W)
}

// Posición vertical: en pantallas cuadradas no hace falta el margen superior de la redonda.
export function top(v, roundMargin = 0) {
  return scale(IS_ROUND ? v : v - roundMargin)
}

// Columna central de 360 px de diseño (no la corta el borde redondo).
export const COL_W = scale(360)
export const COL_X = Math.round((W - COL_W) / 2)
