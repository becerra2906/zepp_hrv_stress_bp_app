import { LAYOUT } from './layout.js'

import { COLORS } from '../../utils/theme.js'
import { getUser, userHrMax, getDays, upsertDay, dateKey, dailySeries } from '../../utils/data.js'
import { requestPhoneSync } from '../../utils/sync.js'
import { restingHrFromDay } from '../../lib/restingHr.js'
import { activationScore, createStateMachine, analyzeDay, STATE_LABEL_ES, DEFAULT_CONFIG } from '../../lib/activation.js'
import { baselineStatus } from '../../lib/baseline.js'
import { detectAlerts, ALERT_TEXT_ES } from '../../lib/alerts.js'
import { classifyBp, BP_LABEL_ES } from '../../lib/bp.js'

const ARC_START = -225 // anillo de 270° abierto abajo
const ARC_SPAN = 270
const STEP_POLL_MS = 15 * 1000
const SAMPLE_BUFFER_MS = 15 * 60 * 1000
const RHR_FALLBACK = 60

const BASELINE_TEXT = {
  better: 'mejor que tu base',
  worse: 'sobre tu base',
  normal: 'en tu rango',
  insufficient: 'construyendo base',
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

function text(cfg, value, color = COLORS.text) {
  return hmUI.createWidget(hmUI.widget.TEXT, {
    x: cfg.x,
    y: cfg.y,
    w: cfg.w,
    h: cfg.h,
    text: value,
    text_size: cfg.size,
    color,
    align_h: hmUI.align.CENTER_H,
    align_v: hmUI.align.CENTER_V,
  })
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
    w: {},
  },

  onInit() {
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
    })
  },

  /** Reconstruye el día con la FC por minuto (heart.today) y guarda FC de reposo y carga. */
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
    }
    s.today = upsertDay(today, patch)
  },

  build() {
    const s = this.state
    const L = LAYOUT
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
    s.w.score = text(L.score, '--')
    s.w.state = text(L.state, 'Midiendo…', COLORS.muted)
    s.w.hr = text(L.hr, '-- lpm', COLORS.muted)
    s.w.rhr = text(L.rhr, '')
    s.w.load = text(L.load, '')
    s.w.alert = text(L.alert, '', COLORS.danger)
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: L.bpButton.x,
      y: L.bpButton.y,
      w: L.bpButton.w,
      h: L.bpButton.h,
      radius: Math.round(L.bpButton.h / 2),
      text: 'Registrar PA',
      text_size: L.bpButton.size,
      normal_color: 0x1c3d5a,
      press_color: 0x2fa3ff,
      click_func: () => hmApp.gotoPage({ url: 'page/bp/index' }),
    })
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: L.insightsButton.x,
      y: L.insightsButton.y,
      w: L.insightsButton.w,
      h: L.insightsButton.h,
      radius: Math.round(L.insightsButton.h / 2),
      text: 'Relaciones y HRV',
      text_size: L.insightsButton.size,
      normal_color: 0x262626,
      press_color: 0x444444,
      click_func: () => hmApp.gotoPage({ url: 'page/insights/index' }),
    })
    s.w.bp = text(L.bpLast, '', COLORS.muted)
    // Relleno para permitir desplazamiento hasta el final
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 0,
      y: L.bpLast.y + L.bpLast.h,
      w: 1,
      h: L.bottomPad,
      color: COLORS.bg,
    })

    this.renderSummary()
    this.startLive()
  },

  renderSummary() {
    const s = this.state
    const b = baselineStatus(dailySeries('rhr'), { higherIsBetter: false })
    s.w.rhr.setProperty(hmUI.prop.TEXT, `FC reposo ${Math.round(s.rhr)} · ${BASELINE_TEXT[b.status]}`)
    const t = (s.today && s.today.totals) || null
    if (t) {
      const load = s.today.stressLoad || 0
      s.w.load.setProperty(hmUI.prop.TEXT, `Carga hoy ${load} · ${t.recovery} min recup.`)
    }
    const bp = lastBp()
    if (bp) {
      const cat = classifyBp(bp.sys, bp.dia)
      s.w.bp.setProperty(hmUI.prop.MORE, {
        text: `Última PA ${bp.sys}/${bp.dia} · ${BP_LABEL_ES[cat]}`,
        color: COLORS.bp[cat],
      })
    }
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
    try {
      s.stressCallback = readStress
      s.stressSensor.addEventListener(hmSensor.event.CHANGE, readStress)
    } catch (e) {
      s.stressCallback = null
    }

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
    s.timers.push(setInterval(pollSteps, STEP_POLL_MS))

    // FC en tiempo real (evento CURRENT de hmSensor; sondeo como respaldo)
    const onHr = () => {
      let hr = null
      try {
        hr = s.hrSensor.current
      } catch (e) {}
      if (typeof hr === 'number' && hr > 0) this.update(hr)
    }
    try {
      s.hrSensor.addEventListener(hmSensor.event.CURRENT, onHr)
      s.hrCallback = onHr
    } catch (e) {
      s.timers.push(setInterval(onHr, 2000))
    }

    // Cada minuto: refrescar resumen (incluye PA recién registrada)
    s.timers.push(
      setInterval(() => {
        this.analyzeToday()
        this.renderSummary()
      }, 60 * 1000)
    )
  },

  update(hr) {
    const s = this.state
    const now = Date.now()
    const r = activationScore({ hr, rhr: s.rhr, hrMax: s.hrMax, moving: s.moving, stress: s.stress })
    if (!r) return
    const st = s.sm.push(r)
    const color = COLORS.state[st]

    s.w.arc.setProperty(hmUI.prop.MORE, {
      end_angle: ARC_START + Math.max(1, Math.round((r.score / 100) * ARC_SPAN)),
      color,
    })
    s.w.score.setProperty(hmUI.prop.TEXT, String(r.score))
    s.w.state.setProperty(hmUI.prop.MORE, { text: STATE_LABEL_ES[st], color })
    const stressTxt = s.stress ? ` · estrés ${s.stress}` : ''
    s.w.hr.setProperty(hmUI.prop.TEXT, `${hr} lpm${stressTxt}`)

    // Alertas de FC anómala (bienestar, no diagnóstico)
    s.samples.push({ t: now, hr, moving: s.moving })
    s.samples = s.samples.filter((p) => now - p.t <= SAMPLE_BUFFER_MS)
    const alerts = detectAlerts(s.samples)
    s.w.alert.setProperty(hmUI.prop.TEXT, alerts.length ? `⚠ ${ALERT_TEXT_ES[alerts[0].type]}` : '')
  },

  onDestroy() {
    const s = this.state
    s.timers.forEach((t) => clearInterval(t))
    try {
      if (s.hrCallback) s.hrSensor.removeEventListener(hmSensor.event.CURRENT, s.hrCallback)
      if (s.stressCallback) s.stressSensor.removeEventListener(hmSensor.event.CHANGE, s.stressCallback)
    } catch (e) {}
    try {
      hmSetting.setBrightScreenCancel()
    } catch (e) {}
  },
})
