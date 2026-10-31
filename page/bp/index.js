import { W, scale, top } from '../../utils/device.js'
import { COLORS } from '../../utils/theme.js'
import { label, pill, bottomPad } from '../../utils/ui.js'
import { addBpReading, getDays, getAllBpReadings } from '../../utils/data.js'
import { validateReading, classifyBp, derivedBp, BP_LABEL_ES } from '../../lib/bp.js'
import { trainPersonalBpModel, evaluateBpAnomaly } from '../../lib/bpModel.js'

// Coordenadas del lienzo "Activación — UI T-Rex 2", artboard 2 · Registrar presión (454 px).
const T = (v) => top(v, 34)
const CX = Math.round(W / 2)

const FIELDS = [
  { key: 'sys', label: 'Sistólica (alta)', min: 60, max: 260 },
  { key: 'dia', label: 'Diastólica (baja)', min: 30, max: 160 },
  { key: 'pulse', label: 'Pulso (lpm)', min: 30, max: 220 },
]

// Indicación corta por categoría, en lenguaje cotidiano
const BP_HINT_ES = {
  normal: 'Dentro del rango saludable',
  elevated: 'Un poco por encima de lo ideal',
  stage1: 'Vigila la tendencia esta semana',
  stage2: 'Coméntalo con tu médico',
  crisis: 'Repite la medición y busca atención médica',
}

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
    label(0, T(62), W, scale(40), 'Presión arterial', scale(30))
    label(CX - scale(160), T(104), scale(320), scale(28), 'Copia lo que marca tu tensiómetro', scale(19), COLORS.muted)

    const rowH = scale(106)
    const btnW = scale(76)
    const btnH = scale(64)
    FIELDS.forEach((f, i) => {
      const y = T(150) + i * rowH
      label(0, y, W, scale(26), f.label, scale(20), COLORS.muted)
      const rowY = y + scale(28)
      const step = (delta) => {
        const v = Math.min(f.max, Math.max(f.min, s.values[f.key] + delta))
        s.values[f.key] = v
        s.w[f.key].setProperty(hmUI.prop.TEXT, String(v))
        this.renderPreview()
      }
      pill(CX - scale(170), rowY, btnW, btnH, '-', scale(40), () => step(-1), 'control', () => step(-5))
      s.w[f.key] = label(CX - scale(80), rowY, scale(160), btnH, String(s.values[f.key]), scale(52))
      pill(CX + scale(170) - btnW, rowY, btnW, btnH, '+', scale(40), () => step(1), 'control', () => step(5))
    })

    // Etiqueta de categoría: rectángulo de color + texto encima
    const chipY = T(488)
    s.w.chipBg = hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: CX - scale(150), y: chipY, w: scale(300), h: scale(44), radius: scale(22), color: COLORS.bpChip.normal.bg,
    })
    s.w.chipText = label(CX - scale(150), chipY, scale(300), scale(44), '', scale(22), COLORS.bpChip.normal.fg)
    s.w.hint = label(CX - scale(160), chipY + scale(50), scale(320), scale(52), '', scale(19), COLORS.muted, hmUI.align.CENTER_H, true)

    const saveY = T(610)
    pill(CX - scale(160), saveY, scale(320), scale(70), 'Guardar', scale(26), () => this.saveReading(), 'primary')
    label(CX - scale(170), saveY + scale(80), scale(340), scale(26), 'Mantén - / + para saltar de 5 en 5', scale(17), COLORS.muted)
    bottomPad(saveY + scale(110), scale(120))
    this.renderPreview()
  },

  renderPreview() {
    const s = this.state
    const { sys, dia, pulse } = s.values
    if (validateReading(s.values).length) {
      s.w.chipBg.setProperty(hmUI.prop.MORE, { color: COLORS.track })
      s.w.chipText.setProperty(hmUI.prop.MORE, { text: 'Valores no válidos', color: COLORS.danger })
      s.w.hint.setProperty(hmUI.prop.TEXT, 'La alta debe ser mayor que la baja')
      return
    }
    const cat = classifyBp(sys, dia)
    const chip = COLORS.bpChip[cat]
    s.w.chipBg.setProperty(hmUI.prop.MORE, { color: chip.bg })
    s.w.chipText.setProperty(hmUI.prop.MORE, { text: BP_LABEL_ES[cat], color: chip.fg })

    let hint = BP_HINT_ES[cat]
    if (cat !== 'crisis' && s.model) {
      const anom = evaluateBpAnomaly({ sys, dia, hr: pulse || 70, t: Date.now() }, s.model)
      if (anom.anomaly !== 'normal') {
        hint = anom.anomaly === 'high' ? 'Más alta de lo que esperaba tu modelo' : 'Más baja de lo que esperaba tu modelo'
      }
    }
    if (cat === 'normal' || cat === 'elevated') {
      hint += ` · PAM ${Math.round(derivedBp(sys, dia).map)}`
    }
    s.w.hint.setProperty(hmUI.prop.TEXT, hint)
  },

  saveReading() {
    const v = this.state.values
    if (validateReading(v).length) return
    addBpReading({ sys: v.sys, dia: v.dia, pulse: v.pulse, t: Date.now(), src: 'watch' })
    hmApp.goBack()
  },
})
