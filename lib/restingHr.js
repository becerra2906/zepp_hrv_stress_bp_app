import { isNum } from './math.js'

const MIN_VALID_HR = 30
const MAX_VALID_HR = 220

function isValidHr(v) {
  return isNum(v) && v >= MIN_VALID_HR && v <= MAX_VALID_HR
}

/**
 * Promedio más bajo de `windowMin` minutos consecutivos válidos dentro de [start, end).
 * Devuelve { value, at } donde `at` es el minuto de inicio de la ventana, o null.
 */
function lowestRollingMean(minutes, start, end, windowMin) {
  let best = null
  let sum = 0
  let count = 0 // minutos válidos consecutivos en la ventana actual
  for (let i = start; i < end; i++) {
    const v = minutes[i]
    if (!isValidHr(v)) {
      sum = 0
      count = 0
      continue
    }
    sum += v
    count++
    if (count > windowMin) {
      sum -= minutes[i - windowMin]
      count = windowMin
    }
    if (count === windowMin) {
      const m = sum / windowMin
      if (best === null || m < best.value) best = { value: m, at: i - windowMin + 1 }
    }
  }
  return best
}

/**
 * FC de reposo a partir de la serie minuto a minuto de `HeartRate.getToday()`
 * (índice 0 = 00:00). Criterio: promedio más bajo de 30 min consecutivos
 * (enfoque Garmin/Firstbeat), priorizando la ventana nocturna.
 *
 * @param {number[]} minutes FC por minuto (0 o valores inválidos = sin dato)
 * @returns {{ rhr: number, at: number, source: 'night'|'day' } | null}
 */
export function restingHrFromDay(minutes, { windowMin = 30, nightEndMin = 360 } = {}) {
  if (!Array.isArray(minutes) || minutes.length < windowMin) return null
  const nightEnd = Math.min(nightEndMin, minutes.length)
  const night = lowestRollingMean(minutes, 0, nightEnd, windowMin)
  if (night) return { rhr: Math.round(night.value * 10) / 10, at: night.at, source: 'night' }
  const day = lowestRollingMean(minutes, 0, minutes.length, windowMin)
  if (day) return { rhr: Math.round(day.value * 10) / 10, at: day.at, source: 'day' }
  return null
}

/** FC máxima estimada (Tanaka, Monahan & Seals 2001). */
export function hrMaxTanaka(age) {
  return Math.round(208 - 0.7 * age)
}
