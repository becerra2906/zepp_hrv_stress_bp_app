import { isNum, mean } from './math.js'
import { spearman } from './stats.js'
import { baselineStatus } from './baseline.js'
import { trainPersonalBpModel } from './bpModel.js'

/**
 * Extrae series diarias alineadas a partir del arreglo de días:
 * [{ date, rhr, stressLoad, rmssd, lnRmssd, bp: [{sys, dia, pulse, t}] }]
 */
export function extractDailyAlignedSeries(days) {
  const rhr = []
  const stressLoad = []
  const lnRmssd = []
  const sys = []
  const dia = []

  for (const d of days || []) {
    rhr.push(isNum(d.rhr) ? d.rhr : null)
    stressLoad.push(isNum(d.stressLoad) ? d.stressLoad : null)
    const lnr = isNum(d.lnRmssd)
      ? d.lnRmssd
      : isNum(d.rmssd) && d.rmssd > 0
      ? Math.log(d.rmssd)
      : null
    lnRmssd.push(lnr)

    if (d.bp && Array.isArray(d.bp) && d.bp.length > 0) {
      sys.push(mean(d.bp.map((r) => r.sys)))
      dia.push(mean(d.bp.map((r) => r.dia)))
    } else {
      sys.push(null)
      dia.push(null)
    }
  }

  return { rhr, stressLoad, lnRmssd, sys, dia }
}

/**
 * Calcula las correlaciones fisiológicas clave (Spearman, lag 0 y lag 1)
 * y genera conclusiones legibles sobre cómo se relacionan la activación, HRV, FC de reposo y PA.
 *
 * @param {Array} days Historial diario ordenado cronológicamente
 * @param {object} opts { minN: 14 }
 */
export function computeRelationships(days, { minN = 14 } = {}) {
  const s = extractDailyAlignedSeries(days)

  const pairs = [
    {
      id: 'stress_sys',
      label: 'Carga de estrés → PAS',
      result: spearman(s.stressLoad, s.sys, { lag: 0, minN }),
    },
    {
      id: 'rhr_sys',
      label: 'FC reposo → PAS',
      result: spearman(s.rhr, s.sys, { lag: 0, minN }),
    },
    {
      id: 'hrv_sys',
      label: 'HRV (lnRMSSD) → PAS',
      result: spearman(s.lnRmssd, s.sys, { lag: 0, minN }),
    },
    {
      id: 'hrv_stress',
      label: 'HRV (lnRMSSD) ↔ Estrés',
      result: spearman(s.lnRmssd, s.stressLoad, { lag: 0, minN }),
    },
    {
      id: 'stress_next_rhr',
      label: 'Estrés hoy → FC reposo mañana',
      result: spearman(s.stressLoad, s.rhr, { lag: 1, minN }),
    },
  ]

  const rhrBaseline = baselineStatus(s.rhr, { higherIsBetter: false })
  const hrvBaseline = baselineStatus(s.lnRmssd, { higherIsBetter: true })

  // Aplanar lecturas individuales de PA con su contexto diario para el modelo personal
  const bpDataset = []
  for (const d of days || []) {
    if (d.bp && Array.isArray(d.bp)) {
      for (const r of d.bp) {
        bpDataset.push({
          sys: r.sys,
          dia: r.dia,
          hr: r.pulse || r.hr || 70,
          rhr: d.rhr || 60,
          t: r.t,
        })
      }
    }
  }

  const bpModel = trainPersonalBpModel(bpDataset)

  return {
    pairs,
    baselines: {
      rhr: rhrBaseline,
      hrv: hrvBaseline,
    },
    bpModel,
  }
}

// Frases en lenguaje cotidiano por relación: [si sube junto (rho > 0), si va al revés (rho < 0), sin datos]
const PLAIN_ES = {
  stress_sys: ['Más estrés, presión más alta', 'Más estrés, presión más baja', 'Estrés y presión'],
  rhr_sys: ['FC reposo alta, presión más alta', 'FC reposo alta, presión más baja', 'FC reposo y presión'],
  hrv_sys: ['HRV alta, presión más alta', 'HRV alta, presión más baja', 'HRV y presión'],
  hrv_stress: ['HRV alta, más estrés', 'HRV alta, menos estrés', 'HRV y estrés'],
  stress_next_rhr: ['Estrés hoy, FC reposo más alta mañana', 'Estrés hoy, FC reposo más baja mañana', 'Estrés hoy y FC reposo mañana'],
}

/**
 * Describe una correlación sin jerga para la pantalla del reloj.
 * @returns {{ text, strength, ratio: number 0-1, level: 'none'|'weak'|'moderate'|'strong' }}
 */
export function describeCorrelationEs(pair, { minN = 14 } = {}) {
  const phrases = PLAIN_ES[pair.id] || [pair.label, pair.label, pair.label]
  const r = pair.result
  if (!r || r.rho === null) {
    const missing = Math.max(0, minN - (r ? r.n : 0))
    return { text: phrases[2], strength: `faltan ${missing} días`, ratio: 0, level: 'none' }
  }
  const abs = Math.abs(r.rho)
  const level = abs >= 0.5 ? 'strong' : abs >= 0.3 ? 'moderate' : 'weak'
  const word = { strong: 'fuerte', moderate: 'moderada', weak: 'débil' }[level]
  return {
    text: phrases[r.rho >= 0 ? 0 : 1],
    strength: r.significant ? `relación ${word}` : `${word}, sin confirmar`,
    ratio: Math.min(1, abs),
    level,
  }
}

/**
 * Formatea una correlación de Spearman en texto breve para la UI del reloj o teléfono.
 */
export function formatCorrelationEs(pair) {
  const { label, result } = pair
  if (!result || result.rho === null) {
    return `${label}: ${result ? result.n : 0}/14 días`
  }
  const rStr = (result.rho >= 0 ? '+' : '') + result.rho.toFixed(2)
  const sig = result.significant ? ' (sig.)' : ''
  return `${label}: ρ=${rStr}${sig}`
}
