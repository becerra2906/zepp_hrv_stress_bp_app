import { isNum, mean, sd, median, quantile } from './math.js'

/**
 * Preparación: FC de reposo medida sentado (~90 s) + SpO2 puntual, comparadas con tu propia historia
 * junto con la FC de reposo nocturna y la HRV (RMSSD medido o proxy nocturno).
 * Herramienta de bienestar: orienta la carga del día, no diagnostica.
 */

const MIN_VALID_HR = 30
const MAX_VALID_HR = 220

export const MEASURE_MS = 90 * 1000
export const DISCARD_MS = 25 * 1000
// Más de esto en pasos durante la medición = no estabas quieto
export const MAX_STEPS_DURING = 15

/**
 * Línea base de FC de la medición: descarta los primeros segundos (asentamiento) y toma la mediana.
 * @param {Array<{t:number, hr:number}>} samples muestras con t en ms desde el inicio de la medición
 * @param {object} opts { discardMs, minSamples, steps } steps = pasos dados durante la medición
 * @returns {{ valid: true, hr: number, n: number, spread: number } | { valid: false, reason: string }}
 */
export function baselineFromSamples(samples, { discardMs = DISCARD_MS, minSamples = 20, steps = 0 } = {}) {
  if (isNum(steps) && steps > MAX_STEPS_DURING) return { valid: false, reason: 'moved' }
  const kept = (samples || [])
    .filter((p) => p && p.t >= discardMs && isNum(p.hr) && p.hr >= MIN_VALID_HR && p.hr <= MAX_VALID_HR)
    .map((p) => p.hr)
  if (kept.length < minSamples) return { valid: false, reason: 'few_samples' }
  return {
    valid: true,
    hr: Math.round(median(kept) * 10) / 10,
    n: kept.length,
    spread: Math.round((quantile(kept, 0.75) - quantile(kept, 0.25)) * 10) / 10,
  }
}

/** SpO2 plausible (el sensor devuelve 0 o valores raros cuando falla). */
export function validSpo2(v) {
  return isNum(v) && v >= 70 && v <= 100
}

/**
 * ¿La marca `time` del sensor SpO2 es de hoy? La doc de 1.0 no dice si viene en segundos o ms:
 * se aceptan ambas (valores < 1e12 se toman como segundos).
 */
export function spo2IsFromToday(time, now = new Date()) {
  if (!isNum(time) || time <= 0) return false
  const d = new Date(time < 1e12 ? time * 1000 : time)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

/**
 * Estado de una medición manual de SpO2 según `retcode` (doc Zepp OS 1.0, sensor SPO2):
 * 1 = sigue midiendo, 2 = éxito, 3 = fallo, 4 = sin muñeca, 5 = tiempo agotado, 6 = mal puesto,
 * 7 = señal inválida, 8/9 = valor bajo/alto (es un resultado), 0 y 10 = medición inválida.
 * El 0 se trata como "midiendo": puede ser el estado inicial antes de que empiece la medición.
 * @returns {'success'|'measuring'|'not_worn'|'bad_signal'|'failed'}
 */
export function spo2Status(retcode, value) {
  if (retcode === 2 || retcode === 8 || retcode === 9) return validSpo2(value) ? 'success' : 'failed'
  if (retcode === 4) return 'not_worn'
  if (retcode === 6 || retcode === 7) return 'bad_signal'
  if (retcode === 3 || retcode === 5 || retcode === 10) return 'failed'
  return 'measuring'
}

/**
 * Compara el valor de hoy con los días anteriores (no con una media corta: es una lectura de un solo día).
 * better/worse = más de `zCut` desviaciones de tu media en la dirección buena/mala.
 * @param {Array<number|null>} prior valores de días anteriores (cronológico)
 * @returns {{ status: 'insufficient'|'normal'|'better'|'worse', value, mean, sd, z }}
 */
export function dayVsBaseline(prior, value, { higherIsBetter = true, minDays = 5, window = 30, minSd = 1, zCut = 1 } = {}) {
  const vals = (prior || []).slice(-window).filter(isNum)
  if (!isNum(value) || vals.length < minDays) {
    return { status: 'insufficient', value: isNum(value) ? value : null, mean: mean(vals), sd: null, z: null }
  }
  const m = mean(vals)
  const s = Math.max(sd(vals) || 0, minSd)
  const z = (value - m) / s
  let status = 'normal'
  if (z > zCut) status = higherIsBetter ? 'better' : 'worse'
  else if (z < -zCut) status = higherIsBetter ? 'worse' : 'better'
  return { status, value, mean: Math.round(m * 10) / 10, sd: Math.round(s * 10) / 10, z: Math.round(z * 100) / 100 }
}

// Peso de cada señal en la decisión; la SpO2 cuenta menos (varía con la altitud y la medición en muñeca).
const SIGNALS = [
  { key: 'morningHr', field: 'morningHr', higherIsBetter: false, minSd: 1.5, weight: 1 },
  { key: 'rhr', field: 'rhr', higherIsBetter: false, minSd: 1.5, weight: 1 },
  { key: 'hrv', field: null, higherIsBetter: true, minSd: 2, weight: 1 },
  { key: 'spo2', field: 'morningSpo2', higherIsBetter: true, minSd: 1, weight: 0.5 },
]

// HRV: RMSSD medido si hoy lo hay, si no el proxy nocturno; nunca se mezclan en la misma serie.
function hrvField(today) {
  return today && isNum(today.rmssd) ? 'rmssd' : 'hrvProxy'
}

/**
 * Decisión del día: 'go' (adelante), 'easy' (suave), 'rest' (descanso) o 'calibrating' (aún sin historia).
 * @param {Array} days registros diarios cronológicos; el de `date` es el de hoy
 * @param {string} date 'YYYY-MM-DD'
 * @returns {{ tag: string, signals: Array<{key, status, value, mean, z}>, available: number, worseWeight: number }}
 */
export function readinessFromHistory(days, date) {
  const list = days || []
  const today = list.find((d) => d.date === date) || {}
  const prior = list.filter((d) => d.date < date)
  const signals = SIGNALS.map((sig) => {
    const field = sig.field || hrvField(today)
    const series = prior.map((d) => (isNum(d[field]) ? d[field] : null))
    const r = dayVsBaseline(series, today[field], { higherIsBetter: sig.higherIsBetter, minSd: sig.minSd })
    return Object.assign({ key: sig.key, weight: sig.weight }, r)
  })
  const available = signals.filter((s) => s.status !== 'insufficient')
  const worseWeight = available.filter((s) => s.status === 'worse').reduce((a, s) => a + s.weight, 0)
  let tag
  // Con menos de dos señales comparables no se decide nada
  if (available.length < 2) tag = 'calibrating'
  else if (worseWeight >= 2) tag = 'rest'
  else if (worseWeight >= 1) tag = 'easy'
  else tag = 'go'
  return { tag, signals, available: available.length, worseWeight }
}

export const READINESS_LABEL_ES = {
  go: 'Adelante',
  easy: 'Día suave',
  rest: 'Descansa',
  calibrating: 'Calibrando',
}

export const READINESS_TIP_ES = {
  go: 'Tu cuerpo está en su rango: buen día para entrenar.',
  easy: 'Una señal fuera de tu rango: mejor algo suave o corto.',
  rest: 'Varias señales fuera de tu rango: prioriza descanso.',
  calibrating: 'Mide tu preparación cada mañana: en 5 días tendrás tu base.',
}

export const SIGNAL_LABEL_ES = {
  morningHr: 'FC sentado',
  rhr: 'FC noche',
  hrv: 'HRV',
  spo2: 'SpO2',
}

/**
 * Desplazamiento (puntos de activación) que se suma al pronóstico del día en horas de vigilia:
 * una mala recuperación suele venir con FC más alta durante el día. Heurística, no un modelo ajustado.
 */
export const READINESS_SHIFT = { go: 0, easy: 4, rest: 8, calibrating: 0 }
