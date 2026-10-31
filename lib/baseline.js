import { isNum, mean, sd } from './math.js'

/**
 * Línea base individual con "smallest worthwhile change" (Plews et al. 2012-2013;
 * Buchheit 2014): media corta (7 d) vs. rango normal = media larga (60 d) ± 0.5·DE.
 *
 * @param {Array<number|null>} daily valores diarios en orden cronológico (el último = hoy)
 * @param {object} opts
 * @param {boolean} opts.higherIsBetter true para ln(RMSSD); false para FC de reposo / estrés
 * @returns {{ status: 'insufficient'|'normal'|'better'|'worse', short, mean, sd, lower, upper }}
 */
export function baselineStatus(
  daily,
  { shortWindow = 7, longWindow = 60, swcFactor = 0.5, minLong = 14, minShort = 3, higherIsBetter = true } = {}
) {
  const longVals = daily.slice(-longWindow).filter(isNum)
  const shortVals = daily.slice(-shortWindow).filter(isNum)
  if (longVals.length < minLong || shortVals.length < minShort) {
    return { status: 'insufficient', short: mean(shortVals), mean: mean(longVals), sd: null, lower: null, upper: null }
  }
  const m = mean(longVals)
  const s = sd(longVals)
  const short = mean(shortVals)
  const lower = m - swcFactor * s
  const upper = m + swcFactor * s
  let status = 'normal'
  if (short > upper) status = higherIsBetter ? 'better' : 'worse'
  else if (short < lower) status = higherIsBetter ? 'worse' : 'better'
  return { status, short, mean: m, sd: s, lower, upper }
}
