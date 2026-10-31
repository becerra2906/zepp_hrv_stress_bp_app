import { LAYOUT } from './layout.js'
import { scale, COL_W } from '../../utils/device.js'

import { COLORS } from '../../utils/theme.js'
import { label, pill, card, bottomPad, setProp, clearProps } from '../../utils/ui.js'
import { getUser, userHrMax, getDays, upsertDay, dateKey, dailySeries, invalidateDays } from '../../utils/data.js'
import { requestPhoneSync, pushHistoryToPhone } from '../../utils/sync.js'
import { every, stop } from '../../utils/timer.js'
import { swipeExitApp, releaseSwipe } from '../../utils/nav.js'
import { restingHrFromDay } from '../../lib/restingHr.js'
import { hrvProxyFromDay } from '../../lib/hrvProxy.js'
import { activationScore, createStateMachine, analyzeDay, STATE_LABEL_ES, DEFAULT_CONFIG } from '../../lib/activation.js'
import { baselineStatus } from '../../lib/baseline.js'
import { detectAlerts, ALERT_TEXT_ES } from '../../lib/alerts.js'
import { classifyBp, BP_LABEL_ES } from '../../lib/bp.js'
import { hourlyProfile, peakHour, lastDaysSeries, trendOf, barHeights } from '../../lib/daily.js'
import { forecastDay, expectedPeak, compareToForecast } from '../../lib/forecast.js'
import { READINESS_LABEL_ES, READINESS_SHIFT } from '../../lib/readiness.js'

// Días con perfil horario que necesita el pronóstico (mínimo por hora en forecastDay)
const FORECAST_MIN_DAYS = 3

const ARC_START = -225 // anillo de 270° abierto abajo
const ARC_SPAN = 270
const STEP_POLL_MS = 15 * 1000
const HR_POLL_MS = 2000
const STRESS_POLL_MS = 60 * 1000
// Reanalizar el día (FC por minuto, guardar historial) cada 5 min: los datos cambian poco más rápido
const ANALYZE_MS = 5 * 60 * 1000
// Evento y sondeo de FC pueden llegar casi juntos: no procesar dos lecturas en menos de esto
const HR_MIN_GAP_MS = 1500
const SAMPLE_BUFFER_MS = 15 * 60 * 1000
const RHR_FALLBACK = 60

const BASELINE_TEXT = {
  better: 'mejor que tu base',
  worse: 'sobre tu base',
  normal: 'en tu rango',
  insufficient: 'midiendo base',
}
const BASELINE_COLOR = {
  better: COLORS.state.recovery,
  worse: COLORS.state.activation,
  normal: COLORS.state.recovery,
  insufficient: COLORS.muted,
}

// Una frase cercana por estado: qué significa y qué hacer.
const STATE_TIP_ES = {
  recovery: 'Estás descansando bien. Buen momento para recargar.',
  balance: 'Tranquilo y estable. Sigue así.',
  activation: 'Algo te está activando. Prueba respirar lento 1 minuto.',
  high: 'Haz una pausa: inhala 4 s, exhala 6 s.',
  exercise: 'Estás en movimiento: no cuenta como estrés.',
}

// Tendencia en palabras; en FC reposo y estrés bajar es bueno, en HRV subir es bueno.
const TREND_TEXT = { up: 'subiendo', down: 'bajando', flat: 'estable', none: 'pocos datos' }
const WEEK_ROWS = [
  { title: 'FC reposo', pick: (d) => d.rhr, unit: ' lpm', goodWhen: 'down', color: COLORS.primary },
  { title: 'Estrés', pick: (d) => d.stressLoad, unit: '', goodWhen: 'down', color: COLORS.state.activation },
  { title: 'HRV', pick: (d) => (typeof d.rmssd === 'number' ? d.rmssd : d.hrvProxy), unit: ' ms', goodWhen: 'up', color: COLORS.state.recovery },
]

function trendColor(trend, goodWhen) {
  if (trend === 'none' || trend === 'flat') return COLORS.muted
  return trend === goodWhen ? COLORS.state.recovery : COLORS.state.activation
}

function hourText(h) {
  if (h === 0) return '12 a. m.'
  if (h === 12) return '12 p. m.'
  return h < 12 ? `${h} a. m.` : `${h - 12} p. m.`
}

function stressValue(raw) {
  if (raw == null) return null
  const v = typeof raw === 'object' ? raw.value : raw
  return typeof v === 'number' && v > 0 && v <= 100 ? v : null
}

function lastKnownRhr() {
  const days = getDays()
  for (let i = days.length - 1; i >= 0; i--) if (typeof days[i].rhr === 'number') return days[i].rhr
  return RHR_FALLBACK
}

function lastBp() {
  const days = getDays()
  for (let i = days.length - 1; i >= 0; i--) {
    const bp = days[i].bp
    if (bp && bp.length) return bp[bp.length - 1]
  }
  return null
}

Page({
  state: {
    hrSensor: null,
    stressSensor: null,
    stepSensor: null,
    timers: [],
    hrCallback: null,
    stressCallback: null,
    sm: null,
    rhr: RHR_FALLBACK,
    hrMax: 180,
    stress: null,
    moving: false,
    stepHistory: [], // [{t, steps}]
    samples: [], // [{t, hr, moving}] para alertas
    lastHrAt: 0,
    forecastKey: null,
    profile: null, // 24 horas: { score, state, meanHr }
    w: {},
  },

  onInit() {
    invalidateDays()
    try {
      hmSetting.setBrightScreen(5 * 60)
    } catch (e) {}
    const s = this.state
    s.hrSensor = hmSensor.createSensor(hmSensor.id.HEART)
    s.stressSensor = hmSensor.createSensor(hmSensor.id.STRESS)
    s.stepSensor = hmSensor.createSensor(hmSensor.id.STEP)
    s.sm = createStateMachine(DEFAULT_CONFIG)
    s.hrMax = userHrMax(getUser())
    this.analyzeToday()
    requestPhoneSync(() => {
      s.hrMax = userHrMax(getUser())
      this.analyzeToday()
      this.renderSummary()
      pushHistoryToPhone()
    })
  },

  /** Reconstruye el día con la FC por minuto (heart.today) y guarda FC de reposo, carga y proxy de HRV nocturno. */
  analyzeToday() {
    const s = this.state
    let minutes = []
    try {
      minutes = s.hrSensor.today || []
    } catch (e) {}
    const today = dateKey()
    const r = restingHrFromDay(minutes)
    s.rhr = r ? r.rhr : lastKnownRhr()
    const patch = {}
    if (r) patch.rhr = r.rhr
    if (minutes.length) {
      const day = analyzeDay(minutes, { rhr: s.rhr, hrMax: s.hrMax })
      patch.stressLoad = day.stressLoad
      patch.totals = day.totals
      s.profile = hourlyProfile(minutes, day.timeline)
      // Activación media por hora: es lo que aprende el pronóstico de los días siguientes
      patch.hourly = s.profile.map((p) => p.score)
      const night = hrvProxyFromDay(minutes)
      if (night) {
        patch.hrvProxy = night.proxy
        patch.nightHr = night.meanHr
      }
    }
    s.today = upsertDay(today, patch)
    // El pronóstico solo depende de días anteriores y de la preparación de hoy: se recalcula si cambian
    const fKey = `${today}|${s.today.readiness || ''}`
    if (s.forecastKey !== fKey) {
      s.forecast = forecastDay(getDays(), {
        date: today,
        minDays: FORECAST_MIN_DAYS,
        shift: READINESS_SHIFT[s.today.readiness] || 0,
      })
      s.forecastKey = fKey
    }
  },

  build() {
    const s = this.state
    const L = LAYOUT
    this.state.swipe = swipeExitApp()
    s.w.track = hmUI.createWidget(hmUI.widget.ARC, {
      x: L.ring.x,
      y: L.ring.y,
      w: L.ring.w,
      h: L.ring.h,
      start_angle: ARC_START,
      end_angle: ARC_START + ARC_SPAN,
      color: COLORS.track,
      line_width: L.ring.lineWidth,
    })
    s.w.arc = hmUI.createWidget(hmUI.widget.ARC, {
      x: L.ring.x,
      y: L.ring.y,
      w: L.ring.w,
      h: L.ring.h,
      start_angle: ARC_START,
      end_angle: ARC_START + 1,
      color: COLORS.state.balance,
      line_width: L.ring.lineWidth,
    })
    label(L.caption.x, L.caption.y, L.caption.w, L.caption.h, 'ACTIVACIÓN', L.caption.size, COLORS.muted)
    s.w.score = label(L.score.x, L.score.y, L.score.w, L.score.h, '--', L.score.size)
    s.w.state = label(L.state.x, L.state.y, L.state.w, L.state.h, 'Midiendo…', L.state.size, COLORS.muted)
    s.w.hr = label(L.hr.x, L.hr.y, L.hr.w, L.hr.h, '-- lpm', L.hr.size, COLORS.muted)
    s.w.tip = label(L.tip.x, L.tip.y, L.tip.w, L.tip.h, 'Mantén la muñeca quieta unos segundos.', L.tip.size, COLORS.soft, hmUI.align.CENTER_H, true)

    // Hoy: resumen 2×2
    label(L.tiles.x, L.hoyHeader.y, COL_W, L.header.h, 'Hoy', L.header.size, COLORS.text, hmUI.align.LEFT)
    s.w.readiness = label(L.tiles.x + scale(60), L.hoyHeader.y, COL_W - scale(60), L.header.h, '', scale(16), COLORS.muted, hmUI.align.RIGHT)
    const P = L.tiles
    const tile = (i, title) => {
      const x = P.x + (i % 2) * (P.w + P.gap)
      const y = P.y + Math.floor(i / 2) * (P.h + P.gap)
      const iw = P.w - P.pad * 2
      card(x, y, P.w, P.h, P.radius)
      label(x + P.pad, y + scale(8), iw, scale(22), title, P.sizeLabel, COLORS.muted, hmUI.align.LEFT)
      const value = label(x + P.pad, y + scale(30), iw, scale(36), '--', P.sizeValue, COLORS.text, hmUI.align.LEFT)
      const context = label(x + P.pad, y + scale(66), iw, scale(22), '', P.sizeContext, COLORS.muted, hmUI.align.LEFT)
      return { value, context }
    }
    s.w.tRhr = tile(0, 'FC reposo')
    s.w.tStress = tile(1, 'Estrés hoy')
    s.w.tHrv = tile(2, 'HRV')
    s.w.tBp = tile(3, 'Última PA')

    // Tu día: actividad por hora (altura = activación media, color = estado dominante).
    // Detrás, el pronóstico: rango probable (gris) y marca del valor esperado; las horas futuras solo muestran eso.
    const D = L.day
    label(D.x, D.headerY, D.w, L.header.h, 'Tu día', L.header.size, COLORS.text, hmUI.align.LEFT)
    s.w.peak = label(D.x + scale(90), D.headerY, D.w - scale(90), L.header.h, '', scale(16), COLORS.muted, hmUI.align.RIGHT)
    card(D.x, D.y, D.w, D.h, D.radius)
    s.w.dayBase = D.y + D.pad + D.barMaxH
    s.w.dayBars = []
    const flat = (x, color) =>
      hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y: s.w.dayBase - scale(4), w: D.barW, h: scale(4), radius: scale(3), color })
    for (let h = 0; h < 24; h++) {
      const x = D.x + D.pad + h * (D.barW + D.barGap)
      s.w.dayBars.push({ x, band: flat(x, COLORS.card), rect: flat(x, COLORS.track), mark: flat(x, COLORS.card) })
    }
    const ticks = ['0 h', '6', '12', '18', '24']
    const innerW = D.w - D.pad * 2
    ticks.forEach((t, i) => {
      const cx = D.x + D.pad + Math.round((innerW * i) / 4)
      label(cx - scale(20), s.w.dayBase + scale(4), scale(40), scale(22), t, D.labelSize, COLORS.muted)
    })

    // Últimos 7 días: FC reposo, estrés y HRV con mini barras y tendencia
    const K = L.week
    label(K.x, K.headerY, K.w, L.header.h, 'Últimos 7 días', L.header.size, COLORS.text, hmUI.align.LEFT)
    const barsW = 7 * K.barW + 6 * K.barGap
    const barsX = K.x + K.w - K.pad - barsW
    s.w.weekRows = WEEK_ROWS.map((r, i) => {
      const y = K.y + i * (K.h + K.gap)
      card(K.x, y, K.w, K.h, K.radius)
      label(K.x + K.pad, y + scale(6), barsX - K.x - K.pad, scale(22), r.title, K.sizeLabel, COLORS.muted, hmUI.align.LEFT)
      const value = label(K.x + K.pad, y + scale(28), barsX - K.x - K.pad - scale(4), scale(30), '--', K.sizeValue, COLORS.text, hmUI.align.LEFT)
      const base = y + Math.round((K.h + K.barMaxH) / 2)
      const bars = []
      for (let d = 0; d < 7; d++) {
        const x = barsX + d * (K.barW + K.barGap)
        bars.push({
          x,
          rect: hmUI.createWidget(hmUI.widget.FILL_RECT, {
            x, y: base - scale(4), w: K.barW, h: scale(4), radius: scale(4), color: COLORS.track,
          }),
        })
      }
      return { value, bars, base }
    })
    const lastY = K.y + WEEK_ROWS.length * (K.h + K.gap)
    s.w.weekLabels = []
    for (let d = 0; d < 7; d++) {
      const x = barsX + d * (K.barW + K.barGap) - scale(6)
      s.w.weekLabels.push(label(x, lastY - scale(4), K.barW + scale(12), scale(22), '', K.labelSize, COLORS.muted))
    }

    const R = L.readinessButton
    pill(R.x, R.y, R.w, R.h, 'Medir preparación', R.size, () => hmApp.gotoPage({ url: 'page/readiness/index' }), 'primary')
    const B = L.bpButton
    pill(B.x, B.y, B.w, B.h, 'Registrar presión', B.size, () => hmApp.gotoPage({ url: 'page/bp/index' }), 'secondary')
    const I = L.insightsButton
    pill(I.x, I.y, I.w, I.h, 'Relaciones y HRV', I.size, () => hmApp.gotoPage({ url: 'page/insights/index' }))
    bottomPad(I.y + I.h, L.bottomPad)

    this.renderSummary()
    this.startLive()
  },

  renderSummary() {
    const s = this.state
    const today = s.today || {}

    // Resumen 2×2
    const b = baselineStatus(dailySeries('rhr'), { higherIsBetter: false })
    setProp(s.w.tRhr.value, hmUI.prop.TEXT, String(Math.round(s.rhr)))
    setProp(s.w.tRhr.context, hmUI.prop.MORE, { text: BASELINE_TEXT[b.status], color: BASELINE_COLOR[b.status] })

    const load = typeof today.stressLoad === 'number' ? today.stressLoad : null
    setProp(s.w.tStress.value, hmUI.prop.TEXT, load === null ? '--' : String(Math.round(load)))
    const calmMin = today.totals ? (today.totals.recovery || 0) + (today.totals.balance || 0) : null
    setProp(s.w.tStress.context, 
      hmUI.prop.TEXT,
      calmMin === null ? 'sin datos aún' : calmMin >= 60 ? `${Math.floor(calmMin / 60)} h en calma` : `${calmMin} min en calma`
    )

    if (typeof today.rmssd === 'number') {
      setProp(s.w.tHrv.value, hmUI.prop.TEXT, `${Math.round(today.rmssd)} ms`)
      setProp(s.w.tHrv.context, hmUI.prop.TEXT, 'medida hoy')
    } else if (typeof today.hrvProxy === 'number') {
      setProp(s.w.tHrv.value, hmUI.prop.TEXT, `${Math.round(today.hrvProxy)} ms`)
      setProp(s.w.tHrv.context, hmUI.prop.TEXT, 'proxy nocturno')
    } else {
      setProp(s.w.tHrv.value, hmUI.prop.TEXT, '--')
      setProp(s.w.tHrv.context, hmUI.prop.TEXT, 'sin datos de noche')
    }

    const bp = lastBp()
    if (bp) {
      const cat = classifyBp(bp.sys, bp.dia)
      setProp(s.w.tBp.value, hmUI.prop.TEXT, `${bp.sys}/${bp.dia}`)
      setProp(s.w.tBp.context, hmUI.prop.MORE, { text: BP_LABEL_ES[cat], color: COLORS.bp[cat] })
    } else {
      setProp(s.w.tBp.value, hmUI.prop.TEXT, '--')
      setProp(s.w.tBp.context, hmUI.prop.MORE, { text: 'sin registros', color: COLORS.muted })
    }

    const tag = today.readiness
    setProp(s.w.readiness, 
      hmUI.prop.MORE,
      tag ? { text: `Preparación: ${READINESS_LABEL_ES[tag]}`, color: COLORS.readiness[tag] } : { text: 'Sin medir hoy', color: COLORS.muted }
    )

    this.renderDay()
    this.renderWeek()
  },

  renderDay() {
    const s = this.state
    const D = LAYOUT.day
    const prof = s.profile || []
    const fc = s.forecast || { ready: false, days: 0, hours: [] }
    const nowHour = new Date().getHours()
    const px = (v) => Math.round((v / 100) * D.barMaxH)
    s.w.dayBars.forEach((bar, h) => {
      const p = prof[h]
      const has = p && p.score !== null
      const bh = has ? Math.max(scale(4), px(p.score)) : scale(4)
      setProp(bar.rect, hmUI.prop.MORE, {
        x: bar.x, y: s.w.dayBase - bh, w: D.barW, h: bh, radius: scale(3),
        // Sin dato: en horas futuras con pronóstico se deja ver solo el rango
        color: has ? COLORS.state[p.state] : COLORS.track,
      })
      const f = fc.hours[h]
      const hasF = f && f.expected !== null
      const bandTop = hasF ? s.w.dayBase - Math.max(scale(4), px(f.high)) : s.w.dayBase - scale(4)
      const bandH = hasF ? Math.max(scale(4), px(f.high) - px(f.low)) : scale(4)
      setProp(bar.band, hmUI.prop.MORE, {
        x: bar.x, y: bandTop, w: D.barW, h: bandH, radius: scale(3),
        color: hasF ? COLORS.forecastBand : COLORS.card,
      })
      setProp(bar.mark, hmUI.prop.MORE, {
        x: bar.x, y: s.w.dayBase - Math.max(scale(3), px(hasF ? f.expected : 0)), w: D.barW, h: scale(3), radius: 0,
        color: hasF ? COLORS.forecastMark : COLORS.card,
      })
    })

    if (!fc.ready) {
      const pk = peakHour(prof)
      const missing = Math.max(1, FORECAST_MIN_DAYS - fc.days)
      setProp(s.w.peak, hmUI.prop.MORE, {
        text: pk ? `Pico: ${hourText(pk.hour)} · ${STATE_LABEL_ES[pk.state]}` : `Pronóstico en ${missing} ${missing === 1 ? 'día' : 'días'}`,
        color: COLORS.muted,
      })
      return
    }
    const cmp = compareToForecast(fc, prof, nowHour)
    if (cmp && cmp.hour === nowHour && cmp.status === 'above') {
      setProp(s.w.peak, hmUI.prop.MORE, { text: 'Ahora: sobre lo esperado', color: COLORS.state.activation })
    } else if (cmp && cmp.hour === nowHour && cmp.status === 'below') {
      setProp(s.w.peak, hmUI.prop.MORE, { text: 'Ahora: más calma de lo esperado', color: COLORS.state.recovery })
    } else {
      const pk = expectedPeak(fc, nowHour)
      setProp(s.w.peak, hmUI.prop.MORE, { text: pk ? `Pico esperado: ${hourText(pk.hour)}` : '', color: COLORS.muted })
    }
  },

  renderWeek() {
    const s = this.state
    const K = LAYOUT.week
    const days = getDays()
    WEEK_ROWS.forEach((r, i) => {
      const row = s.w.weekRows[i]
      const series = lastDaysSeries(days, r.pick, 7)
      const heights = barHeights(series)
      const last = series[series.length - 1].value
      const trend = trendOf(series)
      const valueTxt = last === null ? '--' : `${Math.round(last)}${r.unit}`
      setProp(row.value, hmUI.prop.MORE, {
        text: `${valueTxt} · ${TREND_TEXT[trend]}`,
        color: trend === 'none' ? COLORS.text : trendColor(trend, r.goodWhen),
      })
      row.bars.forEach((bar, d) => {
        const hv = heights[d]
        const bh = hv === null ? scale(4) : Math.max(scale(4), Math.round(hv * K.barMaxH))
        setProp(bar.rect, hmUI.prop.MORE, {
          x: bar.x, y: row.base - bh, w: K.barW, h: bh, radius: scale(4),
          // Hoy en el color de la métrica; días anteriores en gris para no competir
          color: hv === null ? COLORS.track : d === 6 ? r.color : COLORS.trackLight,
        })
      })
      if (i === 0) series.forEach((p, d) => setProp(s.w.weekLabels[d], hmUI.prop.TEXT, p.label))
    })
  },

  startLive() {
    const s = this.state
    // Estrés Zepp
    const readStress = () => {
      try {
        s.stress = stressValue(s.stressSensor.current)
      } catch (e) {}
    }
    readStress()
    // En API 1.0 STRESS figura como "temporalmente no disponible": se escucha si existe y se sondea igual.
    try {
      s.stressSensor.addEventListener(hmSensor.event.CHANGE, readStress)
      s.stressCallback = readStress
    } catch (e) {
      s.stressCallback = null
    }
    s.timers.push(every(STRESS_POLL_MS, readStress))

    // Movimiento: cadencia de pasos en el último minuto
    const pollSteps = () => {
      const now = Date.now()
      let steps = null
      try {
        steps = s.stepSensor.current
      } catch (e) {}
      if (typeof steps !== 'number') return
      s.stepHistory.push({ t: now, steps })
      s.stepHistory = s.stepHistory.filter((p) => now - p.t <= 60 * 1000 + STEP_POLL_MS)
      const first = s.stepHistory[0]
      const mins = Math.max((now - first.t) / 60000, 0.25)
      s.moving = (steps - first.steps) / mins >= DEFAULT_CONFIG.movingStepsPerMin
    }
    pollSteps()
    s.timers.push(every(STEP_POLL_MS, pollSteps))

    // FC en tiempo real. En API 1.0 el evento vive en la instancia (heart.event.CURRENT, no hmSensor.event)
    // y registrarlo es lo que enciende la medición continua. Se sondea además por si el evento no llega.
    const onHr = () => {
      let hr = null
      try {
        hr = s.hrSensor.current || s.hrSensor.last
      } catch (e) {}
      const now = Date.now()
      if (typeof hr !== 'number' || hr <= 0 || now - s.lastHrAt < HR_MIN_GAP_MS) return
      s.lastHrAt = now
      this.update(hr)
    }
    try {
      s.hrSensor.addEventListener(s.hrSensor.event.CURRENT, onHr)
      s.hrCallback = onHr
    } catch (e) {
      s.hrCallback = null
    }
    onHr()
    s.timers.push(every(HR_POLL_MS, onHr))

    // Cada 15 min: mandar el historial al teléfono (Ajustes → Historial del reloj)
    s.timers.push(every(15 * 60 * 1000, pushHistoryToPhone))

    // Cada 5 min: reanalizar el día y refrescar el resumen
    s.timers.push(
      every(ANALYZE_MS, () => {
        this.analyzeToday()
        this.renderSummary()
      })
    )
  },

  update(hr) {
    const s = this.state
    const now = Date.now()
    const stressTxt = s.stress ? ` · estrés ${s.stress}` : ''
    setProp(s.w.hr, hmUI.prop.MORE, { text: `${hr} lpm${stressTxt}`, color: COLORS.text })
    const r = activationScore({ hr, rhr: s.rhr, hrMax: s.hrMax, moving: s.moving, stress: s.stress })
    if (!r) return
    const st = s.sm.push(r)
    const color = COLORS.state[st]

    setProp(s.w.arc, hmUI.prop.MORE, {
      end_angle: ARC_START + Math.max(1, Math.round((r.score / 100) * ARC_SPAN)),
      color,
    })
    setProp(s.w.score, hmUI.prop.TEXT, String(r.score))
    setProp(s.w.state, hmUI.prop.MORE, { text: STATE_LABEL_ES[st], color })

    // Alertas de FC anómala (bienestar, no diagnóstico)
    s.samples.push({ t: now, hr, moving: s.moving })
    while (s.samples.length && now - s.samples[0].t > SAMPLE_BUFFER_MS) s.samples.shift()
    // Si hay alerta, ocupa el lugar de la frase de ayuda, en rojo.
    const alerts = detectAlerts(s.samples)
    setProp(s.w.tip, 
      hmUI.prop.MORE,
      alerts.length
        ? { text: `Atención: ${ALERT_TEXT_ES[alerts[0].type]}`, color: COLORS.danger }
        : { text: STATE_TIP_ES[st], color: COLORS.soft }
    )
  },

  onDestroy() {
    const s = this.state
    s.timers.forEach(stop)
    try {
      if (s.hrCallback) s.hrSensor.removeEventListener(s.hrSensor.event.CURRENT, s.hrCallback)
      if (s.stressCallback) s.stressSensor.removeEventListener(hmSensor.event.CHANGE, s.stressCallback)
    } catch (e) {}
    try {
      hmSetting.setBrightScreenCancel()
    } catch (e) {}
    releaseSwipe(this.state.swipe)
    clearProps()
  },
})
