import { isNum, clamp, median, quantile } from './math.js'

/**
 * Pronóstico de activación por hora para hoy, aprendido de tus días anteriores.
 * Cada día guarda `hourly`: 24 valores de activación media (0–100, null = sin dato).
 * Esperado = mediana de las últimas semanas, mezclada con la del mismo día de la semana si hay ≥ 2;
 * rango probable = percentiles 25–75.
 */

const WAKE_START = 7
const WAKE_END = 22

function weekday(date) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/**
 * @param {Array} days registros diarios { date, hourly }
 * @param {object} opts { date: hoy 'YYYY-MM-DD', window: días hacia atrás, minDays: por hora, shift: puntos extra en vigilia }
 * @returns {{ ready: boolean, days: number, hours: Array<{hour, expected, low, high, n}> }}
 */
export function forecastDay(days, { date, window = 28, minDays = 3, shift = 0 } = {}) {
  const past = (days || [])
    .filter((d) => d.date < date && Array.isArray(d.hourly) && d.hourly.length === 24)
    .slice(-window)
  const wd = weekday(date)
  const hours = []
  for (let h = 0; h < 24; h++) {
    const all = past.map((d) => d.hourly[h]).filter(isNum)
    if (all.length < minDays) {
      hours.push({ hour: h, expected: null, low: null, high: null, n: all.length })
      continue
    }
    const same = past.filter((d) => weekday(d.date) === wd).map((d) => d.hourly[h]).filter(isNum)
    let expected = median(all)
    if (same.length >= 2) expected = (expected + median(same)) / 2
    const s = h >= WAKE_START && h <= WAKE_END ? shift : 0
    hours.push({
      hour: h,
      expected: Math.round(clamp(expected + s, 0, 100)),
      low: Math.round(clamp(quantile(all, 0.25) + s, 0, 100)),
      high: Math.round(clamp(quantile(all, 0.75) + s, 0, 100)),
      n: all.length,
    })
  }
  return { ready: hours.some((p) => p.expected !== null), days: past.length, hours }
}

/** Hora con mayor activación esperada desde `fromHour` hasta el final del día, o null. */
export function expectedPeak(forecast, fromHour = 0) {
  let best = null
  for (const p of forecast.hours) {
    if (p.hour < fromHour || p.expected === null) continue
    if (!best || p.expected > best.expected) best = p
  }
  return best
}

/**
 * Cómo va hoy frente al pronóstico: última hora con dato (al menos 10 min) dentro, sobre o bajo el rango.
 * @param {Array<{hour, score, minutes}>} profile salida de hourlyProfile()
 * @returns {null | { hour, actual, expected, status: 'above'|'below'|'within' }}
 */
export function compareToForecast(forecast, profile, nowHour) {
  for (let h = Math.min(nowHour, 23); h >= 0; h--) {
    const p = profile && profile[h]
    const f = forecast.hours[h]
    if (!p || p.score === null || p.minutes < 10 || f.expected === null) continue
    let status = 'within'
    if (p.score > f.high) status = 'above'
    else if (p.score < f.low) status = 'below'
    return { hour: h, actual: p.score, expected: f.expected, status }
  }
  return null
}
