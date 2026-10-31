import { W, IS_ROUND, scale } from '../../utils/device.js'
import { COLORS } from '../../utils/theme.js'
import { addBpReading, getDays, getAllBpReadings } from '../../utils/data.js'
import { validateReading, classifyBp, derivedBp, BP_LABEL_ES } from '../../lib/bp.js'
import { trainPersonalBpModel, evaluateBpAnomaly } from '../../lib/bpModel.js'

// En pantallas redondas se deja más margen superior para no cortar contenido.
const TOP = IS_ROUND ? scale(70) : scale(30)

const FIELDS = [
  { key: 'sys', label: 'Sistólica', min: 60, max: 260 },
  { key: 'dia', label: 'Diastólica', min: 30, max: 160 },
  { key: 'pulse', label: 'Pulso', min: 30, max: 220 },
]

function lastReading() {
  const days = getDays()
  for (let i = days.length - 1; i >= 0; i--) {
    const bp = days[i].bp
    if (bp && bp.length) return bp[bp.length - 1]
  }
  return { sys: 120, dia: 80, pulse: 70 }
}

Page({
  state: { values: {}, w: {}, model: null },

  onInit() {
    const last = lastReading()
    this.state.values = { sys: last.sys, dia: last.dia, pulse: last.pulse || 70 }
    try {
      this.state.model = trainPersonalBpModel(getAllBpReadings())
    } catch (e) {}
  },

  build() {
    const s = this.state
    const rowH = scale(96)
    const btn = scale(76)

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0, y: TOP, w: W, h: scale(50),
      text: 'Presión arterial', text_size: scale(32), color: COLORS.text,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })

    FIELDS.forEach((f, i) => {
      const y = TOP + scale(60) + i * rowH
      hmUI.createWidget(hmUI.widget.TEXT, {
        x: 0, y, w: W, h: scale(28),
        text: f.label, text_size: scale(22), color: COLORS.muted,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
      })
      const rowY = y + scale(26)
      const step = (delta) => {
        const v = Math.min(f.max, Math.max(f.min, s.values[f.key] + delta))
        s.values[f.key] = v
        s.w[f.key].setProperty(hmUI.prop.TEXT, String(v))
        this.renderPreview()
      }
      hmUI.createWidget(hmUI.widget.BUTTON, {
        x: W / 2 - scale(170), y: rowY, w: btn, h: scale(60), radius: scale(30),
        text: '−', text_size: scale(40), normal_color: 0x262626, press_color: 0x444444,
        click_func: () => step(-1),
        longpress_func: () => step(-5),
      })
      s.w[f.key] = hmUI.createWidget(hmUI.widget.TEXT, {
        x: W / 2 - scale(80), y: rowY, w: scale(160), h: scale(60),
        text: String(s.values[f.key]), text_size: scale(48), color: COLORS.text,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
      })
      hmUI.createWidget(hmUI.widget.BUTTON, {
        x: W / 2 + scale(170) - btn, y: rowY, w: btn, h: scale(60), radius: scale(30),
        text: '+', text_size: scale(40), normal_color: 0x262626, press_color: 0x444444,
        click_func: () => step(1),
        longpress_func: () => step(5),
      })
    })

    const yPrev = TOP + scale(60) + FIELDS.length * rowH + scale(4)
    s.w.preview = hmUI.createWidget(hmUI.widget.TEXT, {
      x: scale(20), y: yPrev, w: W - scale(40), h: scale(60),
      text: '', text_size: scale(22), color: COLORS.muted,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.WRAP,
    })
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: W / 2 - scale(110), y: yPrev + scale(66), w: scale(220), h: scale(66), radius: scale(33),
      text: 'Guardar', text_size: scale(30), normal_color: 0x1c3d5a, press_color: 0x2fa3ff,
      click_func: () => this.saveReading(),
    })
    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: yPrev + scale(140), w: 1, h: scale(120), color: COLORS.bg })
    this.renderPreview()
  },

  renderPreview() {
    const { sys, dia, pulse } = this.state.values
    const errors = validateReading(this.state.values)
    if (errors.length) {
      this.state.w.preview.setProperty(hmUI.prop.MORE, { text: 'Valores no válidos', color: COLORS.danger })
      return
    }
    const cat = classifyBp(sys, dia)
    const d = derivedBp(sys, dia)
    let msg = `${BP_LABEL_ES[cat]} · PAM ${Math.round(d.map)} · PP ${d.pulsePressure}`
    if (cat === 'crisis') {
      msg = 'Rango de crisis: repite la medición y busca atención médica'
    } else if (this.state.model) {
      const anom = evaluateBpAnomaly({ sys, dia, hr: pulse || 70, t: Date.now() }, this.state.model)
      if (anom.anomaly !== 'normal') {
        msg += ` (${anom.anomaly === 'high' ? '▲ alta' : '▼ baja'} vs estimación)`
      }
    }
    this.state.w.preview.setProperty(hmUI.prop.MORE, { text: msg, color: COLORS.bp[cat] })
  },

  saveReading() {
    const v = this.state.values
    if (validateReading(v).length) return
    addBpReading({ sys: v.sys, dia: v.dia, pulse: v.pulse, t: Date.now(), src: 'watch' })
    hmApp.goBack()
  },
})
