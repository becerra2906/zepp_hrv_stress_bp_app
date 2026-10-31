import { isNum, mean, median, sd } from './math.js'

/**
 * Módulo OPCIONAL: análisis de intervalos RR (ms) de una fuente externa
 * (Helio Strap / banda de pecho). Pendiente de confirmar que la fuente transmite RR.
 */

/**
 * Corrección de artefactos por umbral respecto a la mediana local
 * (método de umbral de Kubios; "medium" = 250 ms). Los latidos detectados se
 * reemplazan por interpolación lineal entre vecinos válidos.
 * TODO: implementar Lipponen & Tarvainen (2019) como método por defecto.
 */
export function cleanRR(rr, { thresholdMs = 250, window = 11, minMs = 300, maxMs = 2000 } = {}) {
  const n = rr.length
  const bad = new Array(n).fill(false)
  const half = Math.floor(window / 2)
  for (let i = 0; i < n; i++) {
    const v = rr[i]
    if (!isNum(v) || v < minMs || v > maxMs) {
      bad[i] = true
      continue
    }
    const local = median(rr.slice(Math.max(0, i - half), Math.min(n, i + half + 1)))
    if (Math.abs(v - local) > thresholdMs) bad[i] = true
  }
  const out = rr.slice()
  for (let i = 0; i < n; i++) {
    if (!bad[i]) continue
    let a = i - 1
    while (a >= 0 && bad[a]) a--
    let b = i + 1
    while (b < n && bad[b]) b++
    if (a >= 0 && b < n) out[i] = rr[a] + ((rr[b] - rr[a]) * (i - a)) / (b - a)
    else if (a >= 0) out[i] = rr[a]
    else if (b < n) out[i] = rr[b]
    else out[i] = null
  }
  const corrected = bad.filter(Boolean).length
  return { rr: out.filter(isNum), corrected, correctedPct: n ? (corrected / n) * 100 : 0 }
}

function successiveDiffs(rr) {
  const d = []
  for (let i = 1; i < rr.length; i++) d.push(rr[i] - rr[i - 1])
  return d
}

/** Índice de estrés de Baevsky: SI = AMo / (2·Mo·MxDMn), histograma de 50 ms. */
export function baevskySI(rr, binMs = 50) {
  if (rr.length < 2) return null
  const counts = {}
  for (const v of rr) {
    const b = Math.floor(v / binMs)
    counts[b] = (counts[b] || 0) + 1
  }
  let modeBin = null
  let modeCount = -1
  for (const k of Object.keys(counts)) {
    if (counts[k] > modeCount) {
      modeCount = counts[k]
      modeBin = Number(k)
    }
  }
  const mo = ((modeBin + 0.5) * binMs) / 1000 // s
  const amo = (modeCount / rr.length) * 100 // %
  const mxdmn = (Math.max(...rr) - Math.min(...rr)) / 1000 // s
  if (mxdmn === 0) return null
  return amo / (2 * mo * mxdmn)
}

/**
 * Métricas HRV estándar (Task Force ESC/NASPE 1996; Poincaré; Baevsky).
 * @returns null si la sesión no cumple calidad mínima.
 */
export function hrvMetrics(rawRR, { minBeats = 60, maxCorrectedPct = 5 } = {}) {
  const { rr, correctedPct } = cleanRR(rawRR)
  if (rr.length < minBeats) return { valid: false, reason: 'too_short', correctedPct }
  const diffs = successiveDiffs(rr)
  const rmssd = Math.sqrt(mean(diffs.map((d) => d * d)))
  const sdnn = sd(rr)
  const sdsd = sd(diffs)
  const meanRR = mean(rr)
  const si = baevskySI(rr)
  const result = {
    valid: correctedPct <= maxCorrectedPct,
    reason: correctedPct <= maxCorrectedPct ? null : 'too_many_artifacts',
    correctedPct: Math.round(correctedPct * 10) / 10,
    beats: rr.length,
    meanRR,
    meanHR: 60000 / meanRR,
    rmssd,
    lnRmssd: Math.log(rmssd),
    sdnn,
    pnn50: (diffs.filter((d) => Math.abs(d) > 50).length / diffs.length) * 100,
    sd1: Math.sqrt(0.5) * sdsd,
    sd2: Math.sqrt(Math.max(0, 2 * sdnn * sdnn - 0.5 * sdsd * sdsd)),
    baevskySI: si,
    stressIndex: si == null ? null : Math.sqrt(si), // escala de Kubios
  }
  return result
}
