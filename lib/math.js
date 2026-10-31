// Utilidades numéricas básicas (sin dependencias, compatibles con Zepp OS).

export function isNum(v) {
  return typeof v === 'number' && isFinite(v)
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

export function mean(arr) {
  const xs = arr.filter(isNum)
  if (!xs.length) return null
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** Desviación estándar muestral (n - 1). */
export function sd(arr) {
  const xs = arr.filter(isNum)
  if (xs.length < 2) return null
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / (xs.length - 1))
}

/** Cuantil con interpolación lineal (tipo 7, igual que R/Excel). */
export function quantile(arr, q) {
  const xs = arr.filter(isNum).sort((a, b) => a - b)
  if (!xs.length) return null
  const pos = (xs.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)
}

export function median(arr) {
  return quantile(arr, 0.5)
}
