/**
 * Exportación del historial diario a CSV (separador ';', compatible con Excel en español).
 */

const HEADER = [
  'fecha',
  'fc_reposo',
  'carga_estres',
  'min_recuperacion',
  'min_equilibrio',
  'min_activacion',
  'min_estres_alto',
  'min_ejercicio',
  'hrv_rmssd_ms',
  'hrv_proxy_noche_ms',
  'fc_media_noche',
  'pa_sis_media',
  'pa_dia_media',
  'pa_tomas',
]

function cell(v) {
  return v === null || v === undefined || Number.isNaN(v) ? '' : String(v)
}

/** Promedio de las tomas de PA del día. */
export function dayBpSummary(day) {
  const bp = (day && day.bp) || []
  if (!bp.length) return null
  const sys = bp.reduce((a, r) => a + r.sys, 0) / bp.length
  const dia = bp.reduce((a, r) => a + r.dia, 0) / bp.length
  return { sys: Math.round(sys), dia: Math.round(dia), n: bp.length }
}

export function historyToCsv(days) {
  const rows = [HEADER.join(';')]
  for (const d of days || []) {
    const t = d.totals || {}
    const bp = dayBpSummary(d)
    rows.push(
      [
        d.date,
        d.rhr,
        d.stressLoad,
        t.recovery,
        t.balance,
        t.activation,
        t.high,
        t.exercise,
        d.rmssd,
        d.hrvProxy,
        d.nightHr,
        bp && bp.sys,
        bp && bp.dia,
        bp ? bp.n : 0,
      ]
        .map(cell)
        .join(';')
    )
  }
  return rows.join('\n')
}

/** Versión compacta del historial para enviar del reloj al teléfono por BLE. */
export function slimHistory(days, maxDays = 60) {
  return (days || []).slice(-maxDays).map((d) => ({
    date: d.date,
    rhr: d.rhr,
    stressLoad: d.stressLoad,
    totals: d.totals,
    rmssd: d.rmssd,
    hrvProxy: d.hrvProxy,
    nightHr: d.nightHr,
    bp: (d.bp || []).map((r) => ({ sys: r.sys, dia: r.dia, pulse: r.pulse, t: r.t })),
  }))
}
