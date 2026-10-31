import { isNum, mean } from './math.js'

/** Categorías AHA/ACC 2017. */
export const BP_CATEGORY = {
  NORMAL: 'normal',
  ELEVATED: 'elevated',
  STAGE1: 'stage1',
  STAGE2: 'stage2',
  CRISIS: 'crisis',
}

export const BP_LABEL_ES = {
  normal: 'Normal',
  elevated: 'Elevada',
  stage1: 'HTA etapa 1',
  stage2: 'HTA etapa 2',
  crisis: 'Crisis hipertensiva',
}

export function validateReading({ sys, dia, pulse }) {
  const errors = []
  if (!isNum(sys) || sys < 60 || sys > 260) errors.push('sys')
  if (!isNum(dia) || dia < 30 || dia > 160) errors.push('dia')
  if (isNum(sys) && isNum(dia) && dia >= sys) errors.push('dia>=sys')
  if (pulse != null && (!isNum(pulse) || pulse < 30 || pulse > 220)) errors.push('pulse')
  return errors
}

/** Clasificación AHA/ACC 2017 (Whelton et al., Hypertension 2018). */
export function classifyBp(sys, dia) {
  if (sys > 180 || dia > 120) return BP_CATEGORY.CRISIS
  if (sys >= 140 || dia >= 90) return BP_CATEGORY.STAGE2
  if (sys >= 130 || dia >= 80) return BP_CATEGORY.STAGE1
  if (sys >= 120) return BP_CATEGORY.ELEVATED
  return BP_CATEGORY.NORMAL
}

/** Presión arterial media (aprox. clásica) y presión de pulso. */
export function derivedBp(sys, dia) {
  return {
    map: Math.round((dia + (sys - dia) / 3) * 10) / 10,
    pulsePressure: sys - dia,
  }
}

/**
 * Promedia lecturas de una misma sesión (AHA recomienda ≥ 2 lecturas, separadas 1 min).
 * @param {Array<{sys:number, dia:number, pulse?:number, t:number}>} readings
 */
export function averageSession(readings) {
  if (!readings.length) return null
  const sys = Math.round(mean(readings.map((r) => r.sys)))
  const dia = Math.round(mean(readings.map((r) => r.dia)))
  const p = mean(readings.map((r) => r.pulse))
  return {
    sys,
    dia,
    pulse: p == null ? null : Math.round(p),
    t: readings[0].t,
    n: readings.length,
    category: classifyBp(sys, dia),
    ...derivedBp(sys, dia),
  }
}
