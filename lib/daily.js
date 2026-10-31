/**
 * Agregados para las gráficas de la pantalla de inicio: perfil por hora del día y series de los últimos días.
 */

const STATE_ORDER = ['recovery', 'balance', 'activation', 'high', 'exercise']

/**
 * Perfil horario del día a partir de la FC por minuto y la línea de tiempo de analyzeDay.
 * @param {number[]} minutes FC por minuto desde 00:00
 * @param {Array<{score:number,state:string}|null>} timeline salida de analyzeDay().timeline
 * @returns {Array<{hour:number, score:number|null, state:string|null, meanHr:number|null, minutes:number}>} 24 horas
 */
export function hourlyProfile(minutes, timeline) {
  const out = []
  for (let h = 0; h < 24; h++) {
    let n = 0
    let sumScore = 0
    let sumHr = 0
    const counts = {}
    for (let m = h * 60; m < (h + 1) * 60; m++) {
      const t = timeline && timeline[m]
      if (!t) continue
      n++
      sumScore += t.score
      sumHr += minutes[m]
      counts[t.state] = (counts[t.state] || 0) + 1
    }
    let state = null
    for (const st of STATE_ORDER) if (counts[st] && (!state || counts[st] > counts[state])) state = st
    out.push({
      hour: h,
      score: n ? Math.round(sumScore / n) : null,
      state,
      meanHr: n ? Math.round(sumHr / n) : null,
      minutes: n,
    })
  }
  return out
}

/** Hora con mayor activación media (mínimo 10 min con dato), o null. */
export function peakHour(profile) {
  let best = null
  for (const p of profile) if (p.minutes >= 10 && (!best || p.score > best.score)) best = p
  return best
}

function key(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const WEEKDAY_ES = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

/**
 * Serie de los últimos n días de calendario (terminando hoy), con null en los días sin dato.
 * @param {Array} days registros diarios { date: 'YYYY-MM-DD', ... }
 * @param {(day) => number|null} pick valor a graficar
 */
export function lastDaysSeries(days, pick, n = 7, today = new Date()) {
  const byDate = {}
  for (const d of days || []) byDate[d.date] = d
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const rec = byDate[key(d)]
    const v = rec ? pick(rec) : null
    out.push({ date: key(d), label: WEEKDAY_ES[d.getDay()], value: typeof v === 'number' ? v : null })
  }
  return out
}

/**
 * Tendencia en palabras: último valor frente a la media de los días anteriores de la serie.
 * @returns {'up'|'down'|'flat'|'none'}
 */
export function trendOf(series, tolerance = 0.05) {
  const vals = series.map((p) => p.value)
  let lastIdx = -1
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) { lastIdx = i; break }
  if (lastIdx < 0) return 'none'
  const prev = vals.slice(0, lastIdx).filter((v) => v !== null)
  if (prev.length < 2) return 'none'
  const mean = prev.reduce((a, b) => a + b, 0) / prev.length
  if (!mean) return 'flat'
  const rel = (vals[lastIdx] - mean) / Math.abs(mean)
  if (rel > tolerance) return 'up'
  if (rel < -tolerance) return 'down'
  return 'flat'
}

/** Alturas normalizadas (0–1) para mini barras: escala min–max con margen, para que se vean cambios pequeños. */
export function barHeights(series) {
  const vals = series.map((p) => p.value).filter((v) => v !== null)
  if (!vals.length) return series.map(() => null)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min
  return series.map((p) => {
    if (p.value === null) return null
    if (!span) return 0.6
    return Math.round((0.2 + (0.8 * (p.value - min)) / span) * 1000) / 1000
  })
}
