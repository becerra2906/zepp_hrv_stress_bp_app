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
