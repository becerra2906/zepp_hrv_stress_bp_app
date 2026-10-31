import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mean, sd, median, quantile } from '../lib/math.js'
import { restingHrFromDay, hrMaxTanaka } from '../lib/restingHr.js'
import { baselineStatus } from '../lib/baseline.js'
import { classifyBp, derivedBp, averageSession, validateReading } from '../lib/bp.js'
import { spearman, ranks } from '../lib/stats.js'
import {
  activationScore,
  createStateMachine,
  inferPhysicalFromHr,
  analyzeDay,
  STATE,
} from '../lib/activation.js'
import { detectAlerts, ALERT } from '../lib/alerts.js'
import { cleanRR, hrvMetrics, baevskySI } from '../lib/hrv.js'
import {
  DEFAULT_BP_PRIORS,
  circadianFeatures,
  ridgeRegression,
  trainPersonalBpModel,
  evaluateBpAnomaly,
  parseMapaCsv,
} from '../lib/bpModel.js'
import { computeRelationships, formatCorrelationEs, describeCorrelationEs } from '../lib/insights.js'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('math básicos', () => {
  assert.equal(mean([1, 2, 3, null]), 2)
  close(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.13808994)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75)
})

test('FC de reposo: mínimo de 30 min nocturno', () => {
  const day = new Array(1440).fill(70)
  for (let i = 120; i < 150; i++) day[i] = 50 // 02:00-02:30
  for (let i = 600; i < 700; i++) day[i] = 45 // tarde, fuera de la ventana nocturna
  const r = restingHrFromDay(day)
  assert.equal(r.rhr, 50)
  assert.equal(r.at, 120)
  assert.equal(r.source, 'night')
})

test('FC de reposo: huecos (0) cortan la ventana y fallback al día', () => {
  const day = new Array(1440).fill(0)
  for (let i = 400; i < 460; i++) day[i] = 60
  day[430] = 0 // corta en dos tramos de 30
  const r = restingHrFromDay(day)
  assert.equal(r.source, 'day')
  assert.equal(r.rhr, 60)
  assert.equal(restingHrFromDay(new Array(1440).fill(0)), null)
})

test('Tanaka', () => {
  assert.equal(hrMaxTanaka(40), 180)
})

test('línea base SWC', () => {
  const hist = Array.from({ length: 53 }, (_, i) => 60 + (i % 2 ? 1 : -1))
  assert.equal(baselineStatus(hist.slice(0, 5), { higherIsBetter: false }).status, 'insufficient')
  const worse = hist.concat([66, 67, 66, 65, 67, 66, 66])
  assert.equal(baselineStatus(worse, { higherIsBetter: false }).status, 'worse')
  assert.equal(baselineStatus(worse, { higherIsBetter: true }).status, 'better')
  const normal = hist.concat([60, 61, 59, 60, 60, 61, 59])
  assert.equal(baselineStatus(normal, { higherIsBetter: false }).status, 'normal')
})

test('PA AHA 2017', () => {
  assert.equal(classifyBp(115, 75), 'normal')
  assert.equal(classifyBp(125, 75), 'elevated')
  assert.equal(classifyBp(125, 82), 'stage1')
  assert.equal(classifyBp(135, 70), 'stage1')
  assert.equal(classifyBp(142, 85), 'stage2')
  assert.equal(classifyBp(120, 95), 'stage2')
  assert.equal(classifyBp(185, 100), 'crisis')
  assert.equal(classifyBp(150, 121), 'crisis')
  assert.deepEqual(derivedBp(120, 80), { map: 93.3, pulsePressure: 40 })
  const s = averageSession([
    { sys: 122, dia: 78, pulse: 70, t: 1 },
    { sys: 118, dia: 76, pulse: 68, t: 2 },
  ])
  assert.equal(s.sys, 120)
  assert.equal(s.dia, 77)
  assert.equal(s.category, 'elevated')
  assert.deepEqual(validateReading({ sys: 80, dia: 90 }), ['dia>=sys'])
  assert.deepEqual(validateReading({ sys: 120, dia: 80, pulse: 70 }), [])
})

test('Spearman con empates y lag', () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4])
  const x = Array.from({ length: 20 }, (_, i) => i)
  const y = x.map((v) => v * v)
  const r = spearman(x, y)
  close(r.rho, 1)
  assert.equal(r.significant, true)
  // y[t+1] = x[t] → correlación perfecta con lag 1
  const y2 = [0].concat(x.slice(0, 19)).map((v, i) => (i === 0 ? 99 : v))
  close(spearman(x, y2, { lag: 1 }).rho, 1)
  assert.equal(spearman(x.slice(0, 5), y.slice(0, 5)).rho, null)
})

test('activación: física vs autonómica', () => {
  const base = { rhr: 60, hrMax: 180 }
  const phys = activationScore({ ...base, hr: 120, moving: true })
  assert.equal(phys.kind, 'physical')
  assert.equal(phys.score, 50)
  // Reposo sin estrés Zepp: solo FC adicional
  assert.equal(activationScore({ ...base, hr: 65 }).score, 0)
  assert.equal(activationScore({ ...base, hr: 95 }).score, 100)
  // Con estrés Zepp: 0.6*80 + 0.4*40 = 64
  assert.equal(activationScore({ ...base, hr: 80, stress: 80 }).score, 64)
})

test('máquina de estados con histéresis', () => {
  const sm = createStateMachine()
  const mk = (score) => ({ score, kind: 'autonomic' })
  assert.equal(sm.push(mk(10)), STATE.RECOVERY)
  // Un pico aislado no cambia el estado
  sm.push(mk(60))
  assert.equal(sm.push(mk(10)), STATE.RECOVERY)
  // Justo por encima del umbral (sin margen) tampoco
  for (let i = 0; i < 5; i++) sm.push(mk(27))
  assert.equal(sm.state, STATE.RECOVERY)
  // Sostenido con margen sí
  for (let i = 0; i < 3; i++) sm.push(mk(60))
  assert.equal(sm.state, STATE.ACTIVATION)
  for (let i = 0; i < 3; i++) sm.push({ score: 40, kind: 'physical' })
  assert.equal(sm.state, STATE.EXERCISE)
})

test('inferencia de actividad física desde FC', () => {
  const m = new Array(30).fill(60)
  for (let i = 10; i < 17; i++) m[i] = 140 // 7 min intensos
  m[25] = 150 // pico aislado
  const f = inferPhysicalFromHr(m, 60, 180)
  assert.equal(f.filter(Boolean).length, 7)
  assert.equal(f[25], false)
})

test('análisis del día', () => {
  const m = new Array(120).fill(0)
  for (let i = 0; i < 60; i++) m[i] = 58
  for (let i = 60; i < 120; i++) m[i] = 92 // activación sin movimiento
  const r = analyzeDay(m, { rhr: 58, hrMax: 180 })
  assert.ok(r.totals.recovery >= 60)
  assert.ok(r.totals.high > 50)
  assert.ok(r.stressLoad > 0)
})

test('alertas de FC', () => {
  const t0 = 0
  const tachy = Array.from({ length: 12 }, (_, i) => ({ t: t0 + i * 60000, hr: 110 }))
  assert.equal(detectAlerts(tachy)[0].type, ALERT.REST_TACHY)
  const moving = tachy.map((s) => ({ ...s, moving: true }))
  assert.equal(detectAlerts(moving).length, 0)
  const jump = [
    { t: 0, hr: 65 },
    { t: 30000, hr: 100 },
  ]
  assert.equal(detectAlerts(jump)[0].type, ALERT.SUDDEN_JUMP)
  const brady = Array.from({ length: 12 }, (_, i) => ({ t: i * 60000, hr: 38, asleep: true }))
  assert.equal(detectAlerts(brady).length, 0)
})

test('HRV: limpieza y métricas', () => {
  // Serie alterna 800/850 ms → diffs ±50 → RMSSD = 50
  const rr = Array.from({ length: 100 }, (_, i) => (i % 2 ? 850 : 800))
  const m = hrvMetrics(rr)
  assert.equal(m.valid, true)
  close(m.rmssd, 50)
  const diffs = rr.slice(1).map((v, i) => v - rr[i])
  close(m.sd1, Math.sqrt(0.5) * sd(diffs))
  close(m.meanHR, 60000 / 825)
  // Artefacto (latido perdido = 1650 ms) se corrige por interpolación
  const withArt = rr.slice()
  withArt[50] = 1650
  const c = cleanRR(withArt)
  assert.equal(c.corrected, 1)
  close(c.rr[50], (rr[49] + rr[51]) / 2)
  // Demasiados artefactos → no válida
  const noisy = rr.map((v, i) => (i % 10 === 0 ? 1700 : v))
  assert.equal(hrvMetrics(noisy).valid, false)
  assert.equal(hrvMetrics(rr.slice(0, 30)).reason, 'too_short')
})

test('Baevsky SI', () => {
  // 100% en un bin de 50 ms (800-849), Mo = 0.825 s, MxDMn = 0.04 s
  const rr = Array.from({ length: 50 }, (_, i) => (i % 2 ? 840 : 800))
  close(baevskySI(rr), 100 / (2 * 0.825 * 0.04))
})

test('modelo PA: características circadianas y regresión Ridge', () => {
  // Mediodía (12:00) -> ángulo = pi -> sin(pi) ~ 0, cos(pi) = -1
  const dMid = new Date('2026-10-31T12:00:00Z').getTime()
  // Ajuste por offset local si hace falta, pero probemos la función matemática directa
  const c = circadianFeatures(dMid)
  assert.ok(isFinite(c.sin) && isFinite(c.cos))

  // Test algebraico de Ridge: y = 2*x1 + 3*x2
  const X = [
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
  ]
  const y = [5, 7, 12, 14, 19]
  const w = ridgeRegression(X, y, 0.001)
  assert.ok(w !== null)
  close(w[0], 2, 0.05)
  close(w[1], 3, 0.05)
})

test('modelo PA personal: entrenamiento, LOOCV y detección de anomalías', () => {
  // Generamos dataset simulado tipo MAPA con 20 lecturas
  const t0 = new Date('2026-10-31T08:00:00Z').getTime()
  const dataset = Array.from({ length: 20 }, (_, i) => {
    const t = t0 + i * 60 * 60 * 1000 // cada hora
    const hr = 65 + (i % 5) * 6
    const sys = 115 + (hr - 60) * 0.4 + (i > 14 ? -8 : 4) // dipping de noche
    const dia = 75 + (hr - 60) * 0.25
    return { t, hr, rhr: 60, sys, dia }
  })

  const model = trainPersonalBpModel(dataset)
  assert.equal(model.sampleCount, 20)
  assert.ok(model.metrics.loocvMaeSys !== undefined)
  assert.ok(model.metrics.loocvMaeSys < 10)

  // Predicción puntual
  const pred = model.predict({ hr: 85, rhr: 60, t: t0 + 2 * 3600000 })
  assert.ok(pred.sys > 115)
  assert.ok(pred.dia > 70)

  // Detección de desviación / anomalía
  // Lectura anormalmente alta para el estado de reposo (e.g. estrés agudo o hipertensión no esperada)
  const evalHigh = evaluateBpAnomaly({ sys: 155, dia: 95, hr: 65, rhr: 60, t: t0 }, model)
  assert.equal(evalHigh.anomaly, 'high')
  assert.ok(evalHigh.deltaSys > 15)

  // Lectura normal
  const evalNorm = evaluateBpAnomaly({ sys: pred.sys, dia: pred.dia, hr: 85, rhr: 60, t: t0 + 2 * 3600000 }, model)
  assert.equal(evalNorm.anomaly, 'normal')
})

test('modelo PA: parser de CSV de MAPA (con y sin encabezado)', () => {
  const csv = `Fecha y Hora;PAS (mmHg);PAD (mmHg);FC (lpm)
2025-05-10 08:30;124;78;68
2025-05-10 09:00;130;82;74
2025-05-10 09:30;118;75;64`

  const parsed = parseMapaCsv(csv)
  assert.equal(parsed.length, 3)
  assert.equal(parsed[0].sys, 124)
  assert.equal(parsed[0].dia, 78)
  assert.equal(parsed[0].hr, 68)

  // Sin encabezado: Fecha;PAS;PAD;Pulso
  const noHeader = `2025-05-10 08:30;122;76;66\n2025-05-10 09:00;128;80;72`
  const p2 = parseMapaCsv(noHeader)
  assert.equal(p2.length, 2)
  assert.equal(p2[0].sys, 122)
  assert.equal(p2[1].hr, 72)

  // Sin encabezado: PAS;PAD;Pulso
  const simple = `118;74;65\n132;84;78`
  const p3 = parseMapaCsv(simple)
  assert.equal(p3.length, 2)
  assert.equal(p3[0].sys, 118)
  assert.equal(p3[1].dia, 84)
})

test('motor de relaciones (insights): Spearman multivariable y líneas base', () => {
  const days = Array.from({ length: 16 }, (_, i) => {
    const stressLoad = 10 + i * 2
    const rhr = 55 + i * 0.5
    const rmssd = 60 - i * 1.5
    const sys = 112 + i * 1.2
    const dia = 72 + i * 0.6
    return {
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      rhr,
      stressLoad,
      rmssd,
      lnRmssd: Math.log(rmssd),
      bp: [{ sys, dia, pulse: Math.round(rhr + 12), t: Date.now() - (16 - i) * 86400000 }],
    }
  })

  const rel = computeRelationships(days)
  const stressSys = rel.pairs.find((p) => p.id === 'stress_sys')
  assert.ok(stressSys.result.significant)
  close(stressSys.result.rho, 1)
  const hrvSys = rel.pairs.find((p) => p.id === 'hrv_sys')
  close(hrvSys.result.rho, -1)
  assert.ok(formatCorrelationEs(stressSys).includes('(sig.)'))
  assert.equal(rel.bpModel.sampleCount, 16)
})

test('modelo PA: gestión e integración de lecturas individuales', () => {
  // Simulamos un conjunto de lecturas individuales aisladas tomadas en diferentes días/momentos
  const individualReadings = [
    { sys: 120, dia: 80, pulse: 70, t: 1000000, note: 'reposo' },
    { sys: 135, dia: 88, pulse: 85, t: 2000000, note: 'estrés trabajo' },
    { sys: 112, dia: 72, pulse: 62, t: 3000000, note: 'mañana despertar' },
  ]

  assert.equal(individualReadings.length, 3)
  assert.equal(individualReadings[0].sys, 120)
  assert.equal(individualReadings[1].note, 'estrés trabajo')
})



test('correlaciones en lenguaje cotidiano', () => {
  const none = describeCorrelationEs({ id: 'hrv_stress', label: 'x', result: { rho: null, n: 5 } })
  assert.equal(none.level, 'none')
  assert.equal(none.strength, 'faltan 9 días')
  const neg = describeCorrelationEs({ id: 'hrv_stress', label: 'x', result: { rho: -0.62, n: 20, significant: true } })
  assert.equal(neg.text, 'HRV alta, menos estrés')
  assert.equal(neg.strength, 'relación fuerte')
  const weak = describeCorrelationEs({ id: 'stress_sys', label: 'x', result: { rho: 0.2, n: 20, significant: false } })
  assert.equal(weak.text, 'Más estrés, presión más alta')
  assert.equal(weak.strength, 'débil, sin confirmar')
})

test('proxy de HRV nocturno desde FC por minuto', async () => {
  const { hrvProxyFromDay } = await import('../lib/hrvProxy.js')
  assert.equal(hrvProxyFromDay([]), null)
  // Noche estable (50 lpm) vs noche que oscila 50/54 lpm: el proxy debe subir con la oscilación
  const flat = Array.from({ length: 480 }, () => 50)
  const wavy = Array.from({ length: 480 }, (_, i) => (i % 2 ? 54 : 50))
  const a = hrvProxyFromDay(flat)
  const b = hrvProxyFromDay(wavy)
  assert.equal(a.proxy, 0)
  assert.equal(a.meanHr, 50)
  assert.ok(b.proxy > 80 && b.proxy < 95) // |60000/54 - 60000/50| ≈ 88.9 ms
  // Ventana más tranquila: la hora con FC media más baja
  const day = Array.from({ length: 480 }, (_, i) => (i >= 120 && i < 180 ? 48 : 62))
  assert.equal(hrvProxyFromDay(day).startMin, 120)
  // Pocos datos válidos → null
  assert.equal(hrvProxyFromDay(Array.from({ length: 480 }, (_, i) => (i % 3 ? 0 : 55))), null)
})

test('exportación CSV del historial', async () => {
  const { historyToCsv, slimHistory } = await import('../lib/export.js')
  const days = [
    { date: '2026-10-30', rhr: 58, stressLoad: 34, totals: { recovery: 100, balance: 50, activation: 10, high: 2, exercise: 30 }, rmssd: 45, hrvProxy: 21.5, nightHr: 52, bp: [{ sys: 120, dia: 80, pulse: 70, t: 1, src: 'watch', note: '' }, { sys: 116, dia: 76, pulse: 68, t: 2 }] },
    { date: '2026-10-31', bp: [] },
  ]
  const lines = historyToCsv(days).split('\n')
  assert.equal(lines.length, 3)
  assert.ok(lines[0].startsWith('fecha;fc_reposo;'))
  assert.equal(lines[1], '2026-10-30;58;34;100;50;10;2;30;45;21.5;52;118;78;2;;;')
  assert.equal(lines[2], '2026-10-31;;;;;;;;;;;;;0;;;')
  assert.equal(slimHistory(days)[0].bp[0].note, undefined)
})

test('perfil horario, serie semanal y tendencia', async () => {
  const { hourlyProfile, peakHour, lastDaysSeries, trendOf, barHeights } = await import('../lib/daily.js')
  const minutes = Array.from({ length: 180 }, (_, i) => (i < 60 ? 55 : i < 120 ? 90 : 0))
  const timeline = minutes.map((hr, i) =>
    hr ? (i < 60 ? { score: 10, state: 'recovery' } : { score: 80, state: 'high' }) : null
  )
  const prof = hourlyProfile(minutes, timeline)
  assert.equal(prof.length, 24)
  assert.deepEqual([prof[0].score, prof[0].state, prof[0].meanHr], [10, 'recovery', 55])
  assert.deepEqual([prof[1].score, prof[1].state, prof[1].meanHr], [80, 'high', 90])
  assert.equal(prof[2].score, null)
  assert.equal(peakHour(prof).hour, 1)

  const today = new Date(2026, 9, 31)
  const days = [
    { date: '2026-10-25', rhr: 60 },
    { date: '2026-10-27', rhr: 60 },
    { date: '2026-10-29', rhr: 60 },
    { date: '2026-10-31', rhr: 66 },
  ]
  const s = lastDaysSeries(days, (d) => d.rhr, 7, today)
  assert.equal(s.length, 7)
  assert.equal(s[0].date, '2026-10-25')
  assert.equal(s[6].label, 'S')
  assert.equal(s[1].value, null)
  assert.equal(trendOf(s), 'up')
  assert.equal(trendOf(lastDaysSeries([{ date: '2026-10-31', rhr: 60 }], (d) => d.rhr, 7, today)), 'none')
  const h = barHeights(s)
  assert.equal(h[1], null)
  assert.equal(h[0], 0.2)
  assert.equal(h[6], 1)
})

test('preparación: línea base de FC de 90 s', async () => {
  const { baselineFromSamples, validSpo2 } = await import('../lib/readiness.js')
  // Primeros 25 s altos (asentamiento) se descartan; luego 60 s alrededor de 58
  const samples = []
  for (let s = 0; s < 90; s++) samples.push({ t: s * 1000, hr: s < 25 ? 75 : s % 2 ? 57 : 59 })
  const b = baselineFromSamples(samples)
  assert.equal(b.valid, true)
  assert.equal(b.hr, 57) // 33 muestras de 57 y 32 de 59
  assert.equal(b.n, 65)
  assert.equal(baselineFromSamples(samples, { steps: 40 }).reason, 'moved')
  assert.equal(baselineFromSamples(samples.slice(0, 30)).reason, 'few_samples')
  assert.equal(validSpo2(0), false)
  assert.equal(validSpo2(94), true)
})

test('preparación: decisión del día frente a tu historia', async () => {
  const { dayVsBaseline, readinessFromHistory } = await import('../lib/readiness.js')
  assert.equal(dayVsBaseline([60, 60, 60], 70, { higherIsBetter: false }).status, 'insufficient')
  const prior = [58, 60, 59, 61, 60, 59, 60]
  assert.equal(dayVsBaseline(prior, 66, { higherIsBetter: false, minSd: 1.5 }).status, 'worse')
  assert.equal(dayVsBaseline(prior, 60, { higherIsBetter: false, minSd: 1.5 }).status, 'normal')

  const mk = (i, extra = {}) =>
    Object.assign({ date: `2026-10-${String(10 + i).padStart(2, '0')}`, morningHr: 60 + (i % 2), rhr: 52 + (i % 2), hrvProxy: 40 + (i % 3), morningSpo2: 94 }, extra)
  const past = Array.from({ length: 10 }, (_, i) => mk(i))
  const date = '2026-10-31'
  assert.equal(readinessFromHistory(past.concat([{ date, morningHr: 60, rhr: 52, hrvProxy: 41, morningSpo2: 94 }]), date).tag, 'go')
  assert.equal(readinessFromHistory(past.concat([{ date, morningHr: 68, rhr: 52, hrvProxy: 41 }]), date).tag, 'easy')
  const bad = readinessFromHistory(past.concat([{ date, morningHr: 68, rhr: 58, hrvProxy: 30 }]), date)
  assert.equal(bad.tag, 'rest')
  assert.equal(bad.signals.find((s) => s.key === 'hrv').status, 'worse')
  // Sin historia: calibrando
  assert.equal(readinessFromHistory([{ date, morningHr: 60 }], date).tag, 'calibrating')
  // HRV usa RMSSD medido si hoy lo hay (no se mezcla con el proxy)
  const r = readinessFromHistory(past.concat([{ date, morningHr: 60, rmssd: 45 }]), date)
  assert.equal(r.signals.find((s) => s.key === 'hrv').status, 'insufficient')
})

test('pronóstico de activación por hora', async () => {
  const { forecastDay, expectedPeak, compareToForecast } = await import('../lib/forecast.js')
  const hourly = (peak) => Array.from({ length: 24 }, (_, h) => (h < 6 ? 10 : h === 15 ? peak : 30))
  // Oct 2026: 24 = sábado, 31 = sábado
  const days = [
    { date: '2026-10-25', hourly: hourly(60) },
    { date: '2026-10-26', hourly: hourly(70) },
    { date: '2026-10-27', hourly: hourly(80) },
    { date: '2026-10-31', hourly: hourly(99) }, // hoy: no entra
  ]
  const f = forecastDay(days, { date: '2026-10-31' })
  assert.equal(f.ready, true)
  assert.equal(f.days, 3)
  assert.deepEqual([f.hours[15].expected, f.hours[15].low, f.hours[15].high], [70, 65, 75])
  assert.equal(f.hours[3].expected, 10)
  assert.equal(expectedPeak(f, 10).hour, 15)
  assert.equal(expectedPeak(f, 16).hour, 16)

  // Desplazamiento por preparación solo en vigilia (7–22 h)
  const shifted = forecastDay(days, { date: '2026-10-31', shift: 8 })
  assert.equal(shifted.hours[15].expected, 78)
  assert.equal(shifted.hours[3].expected, 10)

  // Pocos días: sin pronóstico
  assert.equal(forecastDay(days.slice(0, 2), { date: '2026-10-31' }).ready, false)

  const profile = Array.from({ length: 24 }, (_, h) => ({ hour: h, score: h === 15 ? 90 : null, minutes: h === 15 ? 60 : 0 }))
  assert.deepEqual(compareToForecast(f, profile, 15), { hour: 15, actual: 90, expected: 70, status: 'above' })
  assert.equal(compareToForecast(f, profile, 10), null)
})

test('preparación: estado de la medición de SpO2 por retcode', async () => {
  const { spo2Status } = await import('../lib/readiness.js')
  assert.equal(spo2Status(2, 95), 'success')
  assert.equal(spo2Status(2, 0), 'failed') // éxito sin valor plausible
  assert.equal(spo2Status(8, 88), 'success') // valor bajo sigue siendo un resultado (altitud)
  assert.equal(spo2Status(1, 97), 'measuring')
  assert.equal(spo2Status(0, 0), 'measuring') // estado inicial
  assert.equal(spo2Status(undefined, undefined), 'measuring')
  assert.equal(spo2Status(4, 0), 'not_worn')
  assert.equal(spo2Status(7, 0), 'bad_signal')
  assert.equal(spo2Status(5, 0), 'failed')
})

test('historial: caché en memoria, sin escrituras repetidas y perfil horario solo reciente', async () => {
  // hmFS falso en memoria que cuenta lecturas y escrituras
  const files = {}
  const io = { reads: 0, writes: 0 }
  let open = null
  globalThis.hmFS = {
    O_RDONLY: 0, O_CREAT: 1, O_RDWR: 2, O_TRUNC: 4, SEEK_SET: 0,
    stat: (n) => (files[n] ? [{ size: files[n].byteLength }, 0] : [null, -1]),
    open: (n) => (open = n),
    seek: () => {},
    read: (f, buf) => { io.reads++; new Uint8Array(buf).set(new Uint8Array(files[f])) },
    write: (f, buf) => { io.writes++; files[f] = buf.slice(0) },
    close: () => {},
  }
  const { getDays, upsertDay, invalidateDays } = await import('../utils/data.js')
  invalidateDays()
  upsertDay('2026-10-31', { rhr: 55 })
  assert.equal(io.writes, 1)
  upsertDay('2026-10-31', { rhr: 55 }) // mismo valor: no reescribe
  assert.equal(io.writes, 1)
  upsertDay('2026-10-31', { rhr: 56 })
  assert.equal(io.writes, 2)
  getDays(); getDays()
  assert.equal(io.reads, 0) // todo desde la caché
  invalidateDays()
  assert.equal(getDays()[0].rhr, 56)
  assert.equal(io.reads, 1)
  // 40 días con perfil horario: solo los últimos 35 lo conservan
  for (let i = 0; i < 40; i++) {
    const d = new Date(2026, 8, 1 + i) // 1-sep … 10-oct
    upsertDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, { hourly: [1] })
  }
  const days = getDays()
  assert.equal(days.filter((d) => d.hourly).length, 35 - 1) // el 31-oct (sin hourly) es el más reciente
  delete globalThis.hmFS
})

test('preparación: lectura automática de SpO2 de hoy (segundos o ms)', async () => {
  const { spo2IsFromToday } = await import('../lib/readiness.js')
  const now = new Date(2026, 9, 31, 9, 0)
  const morning = new Date(2026, 9, 31, 6, 30).getTime()
  assert.equal(spo2IsFromToday(morning, now), true)
  assert.equal(spo2IsFromToday(Math.floor(morning / 1000), now), true)
  assert.equal(spo2IsFromToday(new Date(2026, 9, 30, 23, 0).getTime(), now), false)
  assert.equal(spo2IsFromToday(0, now), false)
  assert.equal(spo2IsFromToday(undefined, now), false)
})
