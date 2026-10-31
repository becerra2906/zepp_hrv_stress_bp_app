/**
 * Proxy de HRV a partir de la FC por minuto (heart.today en Zepp OS 1.0, que no expone intervalos RR).
 *
 * NO es RMSSD latido a latido: se toma la hora más tranquila de la noche (00:00–06:00),
 * se convierte la FC de cada minuto a intervalo medio (60000 / FC, ms) y se calcula el RMSSD
 * entre minutos consecutivos. Refleja cuánto oscila la FC en reposo nocturno; sirve para seguir
 * tendencias propias día a día, no para compararse con valores de RMSSD de otras apps.
 */

const VALID_MIN = 30
const VALID_MAX = 220

/**
 * @param {number[]} minutes FC por minuto desde las 00:00 (0 o null = sin dato)
 * @param {object} opts { windowMin: 60, minValid: 45, nightStart: 0, nightEnd: 360 }
 * @returns {null | { proxy: number, meanHr: number, meanRr: number, startMin: number, valid: number }}
 */
export function hrvProxyFromDay(minutes, { windowMin = 60, minValid = 45, nightStart = 0, nightEnd = 360 } = {}) {
  if (!Array.isArray(minutes)) return null
  const end = Math.min(nightEnd, minutes.length)
  let best = null
  for (let start = nightStart; start + windowMin <= end; start += 5) {
    const block = minutes.slice(start, start + windowMin)
    const valid = block.filter((v) => typeof v === 'number' && v >= VALID_MIN && v <= VALID_MAX)
    if (valid.length < minValid) continue
    const meanHr = valid.reduce((a, b) => a + b, 0) / valid.length
    if (!best || meanHr < best.meanHr) best = { start, block, meanHr, valid: valid.length }
  }
  if (!best) return null

  // Diferencias solo entre minutos consecutivos con dato (un hueco corta la serie)
  let sumSq = 0
  let n = 0
  for (let i = 1; i < best.block.length; i++) {
    const a = best.block[i - 1]
    const b = best.block[i]
    const ok = (v) => typeof v === 'number' && v >= VALID_MIN && v <= VALID_MAX
    if (!ok(a) || !ok(b)) continue
    const d = 60000 / b - 60000 / a
    sumSq += d * d
    n++
  }
  if (n < minValid - 1) return null
  const proxy = Math.sqrt(sumSq / n)
  return {
    proxy: Math.round(proxy * 10) / 10,
    meanHr: Math.round(best.meanHr * 10) / 10,
    meanRr: Math.round(60000 / best.meanHr),
    startMin: best.start,
    valid: best.valid,
  }
}
