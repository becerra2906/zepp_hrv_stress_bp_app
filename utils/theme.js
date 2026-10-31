// Colores compartidos (fondo negro AMOLED, colores planos: Zepp OS 1.0 no tiene degradados).
export const COLORS = {
  bg: 0x000000,
  text: 0xffffff,
  soft: 0xd0d0d0,
  muted: 0x9a9a9a,
  faint: 0x6e6e6e,
  card: 0x161616,
  track: 0x262626,
  trackLight: 0x4a4a4a,
  control: 0x262626,
  controlPress: 0x444444,
  primary: 0x2fa3ff,
  primaryText: 0x00121f,
  primaryPress: 0x7cc4ff,
  secondary: 0x1c3d5a,
  accent: 0x2fa3ff,
  danger: 0xff453a,
  state: {
    recovery: 0x34c759,
    balance: 0x2fa3ff,
    activation: 0xff9f0a,
    high: 0xff453a,
    exercise: 0xbf5af2,
  },
  bp: {
    normal: 0x34c759,
    elevated: 0xffd60a,
    stage1: 0xff9f0a,
    stage2: 0xff453a,
    crisis: 0xff2d55,
  },
  // Preparación: color de la etiqueta del día
  readiness: {
    go: 0x34c759,
    easy: 0xff9f0a,
    rest: 0xff453a,
    calibrating: 0x9a9a9a,
  },
  // Pronóstico de "Tu día": rango probable (detrás de la barra) y marca del valor esperado
  forecastBand: 0x343434,
  forecastMark: 0xc8c8c8,
  // Etiqueta de categoría de PA: fondo de color + texto oscuro/claro legible
  bpChip: {
    normal: { bg: 0x34c759, fg: 0x001a07 },
    elevated: { bg: 0xffd60a, fg: 0x1a1600 },
    stage1: { bg: 0xff9f0a, fg: 0x1a0f00 },
    stage2: { bg: 0xb3261e, fg: 0xffffff },
    crisis: { bg: 0xc1121f, fg: 0xffffff },
  },
}
