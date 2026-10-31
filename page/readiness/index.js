import { W, scale, top, COL_X, COL_W } from '../../utils/device.js'
import { COLORS } from '../../utils/theme.js'
import { label, pill, card, bottomPad, setProp, clearProps } from '../../utils/ui.js'
import { getDays, upsertDay, dateKey, invalidateDays } from '../../utils/data.js'
import { every, stop } from '../../utils/timer.js'
import { swipeBackToMain, releaseSwipe } from '../../utils/nav.js'
import {
  MEASURE_MS,
  DISCARD_MS,
  baselineFromSamples,
  validSpo2,
  spo2Status,
  readinessFromHistory,
  READINESS_LABEL_ES,
  READINESS_TIP_ES,
  SIGNAL_LABEL_ES,
} from '../../lib/readiness.js'

// Preparación: 90 s de FC sentado (se descartan los primeros 25 s, mediana) + SpO2 puntual.
// Un solo temporizador de 1 s maneja todas las fases y sus tiempos límite (no se detienen
// temporizadores dentro de su propio callback).
const T = (v) => top(v, 30)
const CX = Math.round(W / 2)
const RING = scale(240)
const ARC_START = -225
const ARC_SPAN = 270
const TICK_MS = 1000
const NO_HR_TIMEOUT_MS = 20 * 1000 // sin ninguna FC válida en este tiempo → se cancela
const SPO2_TIMEOUT_MS = 60 * 1000
const SPO2_MIN_MS = 10 * 1000 // una medición real de SpO2 no termina antes
const TOTAL_TIMEOUT_MS = 3 * 60 * 1000 // tope de seguridad de toda la medición

const UNIT = { morningHr: ' lpm', rhr: ' lpm', hrv: ' ms', spo2: ' %' }
const STATUS_TEXT = { better: 'mejor', worse: 'peor', normal: 'en tu rango', insufficient: 'sin base aún' }
const STATUS_COLOR = {
  better: COLORS.state.recovery,
  worse: COLORS.state.activation,
  normal: COLORS.soft,
  insufficient: COLORS.muted,
}
const FAIL_TEXT = {
  moved: 'Te moviste durante la medición. Siéntate quieto y repite.',
  few_samples: 'No llegó suficiente FC. Ajusta la correa y repite.',
  no_hr: 'No llega la FC. Ajusta el reloj en la muñeca y repite.',
  total_timeout: 'La medición tardó demasiado. Inténtalo de nuevo.',
}
const SPO2_TEXT = {
  measuring: 'SpO2: midiendo… muñeca quieta, a la altura del corazón.',
  not_worn: 'SpO2: no detecta la muñeca. Ajusta el reloj.',
  bad_signal: 'SpO2: señal débil. Ajusta la correa y no muevas la mano.',
}

Page({
  state: {
    hrSensor: null,
    spo2Sensor: null,
    stepSensor: null,
    hrCallback: null,
    spo2Callback: null,
    tick: null,
    phase: 'idle', // idle | hr | spo2 | done
    samples: [],
    t0: 0,
    spo2T0: 0,
    spo2PrevTime: null,
    steps0: null,
    morningHr: null,
    spo2Value: null,
    w: {},
  },

  onInit() {
    invalidateDays()
    try {
      hmSetting.setBrightScreen(5 * 60)
    } catch (e) {}
    const s = this.state
    // Cada sensor por separado: si uno no existe en el reloj, el resto sigue funcionando
    try {
      s.hrSensor = hmSensor.createSensor(hmSensor.id.HEART)
    } catch (e) {}
    try {
      s.spo2Sensor = hmSensor.createSensor(hmSensor.id.SPO2)
    } catch (e) {}
    try {
      s.stepSensor = hmSensor.createSensor(hmSensor.id.STEP)
    } catch (e) {}
  },

  build() {
    const s = this.state
    s.swipe = swipeBackToMain()
    label(0, T(56), W, scale(40), 'Preparación', scale(30))
    const ringX = CX - RING / 2
    const ringY = T(104)
    hmUI.createWidget(hmUI.widget.ARC, {
      x: ringX, y: ringY, w: RING, h: RING,
      start_angle: ARC_START, end_angle: ARC_START + ARC_SPAN, color: COLORS.track, line_width: scale(16),
    })
    s.w.arc = hmUI.createWidget(hmUI.widget.ARC, {
      x: ringX, y: ringY, w: RING, h: RING,
      start_angle: ARC_START, end_angle: ARC_START + 1, color: COLORS.primary, line_width: scale(16),
    })
    s.w.value = label(0, ringY + scale(70), W, scale(80), '90 s', scale(60))
    s.w.unit = label(0, ringY + scale(150), W, scale(30), 'sentado y quieto', scale(20), COLORS.muted)
    s.w.status = label(
      COL_X, T(356), COL_W, scale(70),
      'Siéntate, apoya el brazo y respira normal. Luego mide SpO2.',
      scale(20), COLORS.soft, hmUI.align.CENTER_H, true
    )
    s.w.start = pill(CX - scale(140), T(436), scale(280), scale(66), 'Empezar', scale(26), () => this.guard(() => this.startHr()), 'primary')
    bottomPad(T(510), scale(120))
  },

  /** Cualquier error se muestra en pantalla en vez de dejar la página colgada. */
  guard(fn) {
    try {
      fn()
    } catch (e) {
      this.fail(`Error: ${(e && e.message) || e}`)
    }
  },

  setStatus(text, color = COLORS.soft) {
    setProp(this.state.w.status, hmUI.prop.MORE, { text, color })
  },

  setRing(fraction, color) {
    const f = Math.max(0, Math.min(1, fraction))
    setProp(this.state.w.arc, hmUI.prop.MORE, {
      end_angle: ARC_START + Math.max(1, Math.round(f * ARC_SPAN)),
      color,
    })
  },

  showStart(visible) {
    try {
      this.state.w.start.setProperty(hmUI.prop.VISIBLE, visible)
    } catch (e) {}
  },

  readSteps() {
    try {
      const v = this.state.stepSensor.current
      return typeof v === 'number' ? v : null
    } catch (e) {
      return null
    }
  },

  readHr() {
    try {
      const v = this.state.hrSensor.current
      return typeof v === 'number' && v > 0 ? v : null
    } catch (e) {
      return null
    }
  },

  startHr() {
    const s = this.state
    if (s.phase === 'hr' || s.phase === 'spo2') return
    if (!s.hrSensor) return this.fail(FAIL_TEXT.no_hr)
    this.showStart(false)
    s.phase = 'hr'
    s.samples = []
    s.t0 = Date.now()
    s.steps0 = this.readSteps()
    s.w.value.setProperty(hmUI.prop.TEXT, '--')
    s.w.unit.setProperty(hmUI.prop.TEXT, 'lpm')
    this.setRing(0, COLORS.trackLight)
    this.setStatus('Asentando la FC… no hables ni te muevas.')
    // Registrar CURRENT enciende la medición continua; el tick además sondea por si el evento no llega.
    const onHr = () => this.guard(() => this.sampleHr())
    try {
      s.hrSensor.addEventListener(s.hrSensor.event.CURRENT, onHr)
      s.hrCallback = onHr
    } catch (e) {
      s.hrCallback = null
    }
    if (!s.tick) s.tick = every(TICK_MS, () => this.guard(() => this.onTick()))
  },

  sampleHr() {
    const s = this.state
    if (s.phase !== 'hr') return
    const hr = this.readHr()
    if (hr === null) return
    const t = Date.now() - s.t0
    const last = s.samples[s.samples.length - 1]
    // Evento y sondeo pueden llegar en el mismo segundo: una muestra por medio segundo basta
    if (last && t - last.t < 500) return
    s.samples.push({ t, hr })
    s.w.value.setProperty(hmUI.prop.TEXT, String(hr))
  },

  onTick() {
    const s = this.state
    const now = Date.now()
    if (s.phase === 'idle' || s.phase === 'done') return
    if (now - s.t0 > TOTAL_TIMEOUT_MS) return this.fail(FAIL_TEXT.total_timeout)

    if (s.phase === 'hr') {
      this.sampleHr()
      const t = now - s.t0
      if (!s.samples.length && t > NO_HR_TIMEOUT_MS) return this.fail(FAIL_TEXT.no_hr)
      this.setRing(t / MEASURE_MS, t < DISCARD_MS ? COLORS.trackLight : COLORS.primary)
      if (t >= DISCARD_MS) this.setStatus(`Midiendo… quedan ${Math.max(0, Math.ceil((MEASURE_MS - t) / 1000))} s`)
      if (t >= MEASURE_MS) this.finishHr()
      return
    }

    if (s.phase === 'spo2') {
      const t = now - s.spo2T0
      this.setRing(Math.min(1, t / SPO2_TIMEOUT_MS), COLORS.state.recovery)
      this.checkSpo2()
      if (s.phase === 'spo2' && t >= SPO2_TIMEOUT_MS) this.finishSpo2(null)
    }
  },

  stopHr() {
    const s = this.state
    try {
      if (s.hrCallback) s.hrSensor.removeEventListener(s.hrSensor.event.CURRENT, s.hrCallback)
    } catch (e) {}
    s.hrCallback = null
  },

  finishHr() {
    const s = this.state
    this.stopHr()
    const steps1 = this.readSteps()
    const steps = s.steps0 !== null && steps1 !== null ? steps1 - s.steps0 : 0
    const b = baselineFromSamples(s.samples, { steps })
    if (!b.valid) return this.fail(FAIL_TEXT[b.reason])
    s.morningHr = b.hr
    s.w.value.setProperty(hmUI.prop.TEXT, String(Math.round(b.hr)))
    this.startSpo2()
  },

  startSpo2() {
    const s = this.state
    s.phase = 'spo2'
    s.spo2T0 = Date.now()
    s.w.unit.setProperty(hmUI.prop.TEXT, 'lpm · midiendo SpO2')
    this.setRing(0, COLORS.state.recovery)
    if (!s.spo2Sensor) return this.finishSpo2(null)
    this.setStatus(SPO2_TEXT.measuring)
    const onSpo2 = () => this.guard(() => this.checkSpo2())
    // Marca de tiempo del último resultado guardado: un "éxito" con la misma marca es una lectura vieja
    try {
      s.spo2PrevTime = s.spo2Sensor.time
    } catch (e) {
      s.spo2PrevTime = null
    }
    try {
      // La doc recomienda stop() antes de start() para cortar una medición anterior
      s.spo2Sensor.stop()
      s.spo2Sensor.addEventListener(hmSensor.event.CHANGE, onSpo2)
      s.spo2Callback = onSpo2
      s.spo2Sensor.start()
    } catch (e) {
      s.spo2Callback = null
    }
  },

  /** Lee el sensor; solo acepta retcode 2 (éxito) con un valor plausible. */
  checkSpo2() {
    const s = this.state
    if (s.phase !== 'spo2' || !s.spo2Sensor) return
    let value = null
    let retcode = null
    let time = null
    try {
      value = s.spo2Sensor.current
      retcode = s.spo2Sensor.retcode
      time = s.spo2Sensor.time
    } catch (e) {}
    const st = spo2Status(retcode, value)
    if (st === 'success') {
      // Se exige un resultado nuevo: marca de tiempo distinta a la de antes de start(),
      // o, si el reloj no da marca, al menos SPO2_MIN_MS desde que empezó.
      const fresh =
        typeof time === 'number' && typeof s.spo2PrevTime === 'number'
          ? time !== s.spo2PrevTime
          : Date.now() - s.spo2T0 >= SPO2_MIN_MS
      if (fresh) return this.finishSpo2(value)
      return
    }
    if (st === 'failed') return this.finishSpo2(null)
    if (SPO2_TEXT[st]) this.setStatus(SPO2_TEXT[st])
  },

  stopSpo2() {
    const s = this.state
    try {
      if (s.spo2Callback) s.spo2Sensor.removeEventListener(hmSensor.event.CHANGE, s.spo2Callback)
    } catch (e) {}
    try {
      if (s.spo2Sensor) s.spo2Sensor.stop()
    } catch (e) {}
    s.spo2Callback = null
  },

  finishSpo2(value) {
    const s = this.state
    if (s.phase !== 'spo2') return
    this.stopSpo2()
    s.spo2Value = validSpo2(value) ? value : null
    this.saveAndShow()
  },

  /** Cancela la medición en curso, muestra el motivo y deja repetir. */
  fail(text) {
    const s = this.state
    this.stopHr()
    this.stopSpo2()
    s.phase = 'idle'
    this.setRing(0, COLORS.primary)
    try {
      s.w.value.setProperty(hmUI.prop.TEXT, '--')
    } catch (e) {}
    this.setStatus(text, COLORS.danger)
    this.showStart(true)
  },

  saveAndShow() {
    const s = this.state
    s.phase = 'done'
    const date = dateKey()
    const patch = { morningHr: s.morningHr, readinessAt: Date.now() }
    if (s.spo2Value !== null) patch.morningSpo2 = s.spo2Value
    upsertDay(date, patch)
    const r = readinessFromHistory(getDays(), date)
    upsertDay(date, { readiness: r.tag })
    this.showResult(r)
  },

  showResult(r) {
    const s = this.state
    const color = COLORS.readiness[r.tag]
    this.setRing(1, color)
    s.w.unit.setProperty(hmUI.prop.TEXT, s.spo2Value !== null ? `lpm · SpO2 ${s.spo2Value} %` : 'lpm · SpO2 sin lectura')
    this.setStatus(READINESS_TIP_ES[r.tag])

    // Resultado debajo (se desplaza): etiqueta del día + una fila por señal
    const chipY = T(436)
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: CX - scale(140), y: chipY, w: scale(280), h: scale(56), radius: scale(28), color,
    })
    label(CX - scale(140), chipY, scale(280), scale(56), READINESS_LABEL_ES[r.tag], scale(28), COLORS.bg)

    const rowH = scale(54)
    const gap = scale(8)
    const y0 = chipY + scale(76)
    r.signals.forEach((sig, i) => {
      const y = y0 + i * (rowH + gap)
      card(COL_X, y, COL_W, rowH, scale(18))
      const v = typeof sig.value === 'number' ? `${Math.round(sig.value)}${UNIT[sig.key]}` : '--'
      label(COL_X + scale(16), y, scale(150), rowH, SIGNAL_LABEL_ES[sig.key], scale(19), COLORS.muted, hmUI.align.LEFT)
      label(COL_X + scale(120), y, scale(100), rowH, v, scale(20), COLORS.text, hmUI.align.LEFT)
      label(COL_X + scale(210), y, COL_W - scale(226), rowH, STATUS_TEXT[sig.status], scale(18), STATUS_COLOR[sig.status], hmUI.align.RIGHT)
    })
    const btnY = y0 + r.signals.length * (rowH + gap) + scale(12)
    pill(CX - scale(140), btnY, scale(280), scale(66), 'Listo', scale(26), () => hmApp.goBack(), 'secondary')
    bottomPad(btnY + scale(80), scale(120))
  },

  onDestroy() {
    const s = this.state
    if (s.tick) stop(s.tick)
    s.tick = null
    this.stopHr()
    this.stopSpo2()
    releaseSwipe(s.swipe)
    clearProps()
    try {
      hmSetting.setBrightScreenCancel()
    } catch (e) {}
  },
})
