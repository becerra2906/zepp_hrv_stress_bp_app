import { isNum, mean } from './math.js'

/** Rangos con empates promediados. */
export function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}

export function pearson(x, y) {
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/**
 * Correlación de Spearman entre series diarias alineadas, con desfase opcional:
 * lag = 1 compara x[t] con y[t+1] (¿lo de hoy afecta mañana?).
 * Significancia aproximada (α≈0.05, bilateral): |ρ| > 1.96/√(n−1).
 */
export function spearman(x, y, { lag = 0, minN = 14 } = {}) {
  const px = []
  const py = []
  for (let i = 0; i + lag < y.length && i < x.length; i++) {
    if (isNum(x[i]) && isNum(y[i + lag])) {
      px.push(x[i])
      py.push(y[i + lag])
    }
  }
  const n = px.length
  if (n < minN) return { rho: null, n, significant: false, lag }
  const rho = pearson(ranks(px), ranks(py))
  if (rho == null) return { rho: null, n, significant: false, lag }
  return { rho, n, significant: Math.abs(rho) > 1.96 / Math.sqrt(n - 1), lag }
}
