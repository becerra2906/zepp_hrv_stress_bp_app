import { createWidget, widget, prop, align, text_style } from '@zos/ui'
import { HeartRate } from '@zos/sensor'
import { getDeviceInfo, SCREEN_SHAPE_ROUND } from '@zos/device'
import { px } from '@zos/utils'

import { COLORS } from '../../utils/theme.js'
import { getDays, addHrvReading, dateKey } from '../../utils/data.js'
import { computeRelationships, formatCorrelationEs } from '../../lib/insights.js'

const { width: W, screenShape } = getDeviceInfo()
const TOP = screenShape === SCREEN_SHAPE_ROUND ? px(60) : px(28)
const PAD = screenShape === SCREEN_SHAPE_ROUND ? px(36) : px(18)

const BASELINE_LABEL = {
  better: 'mejor que tu base',
  worse: 'bajo tu base',
  normal: 'en tu rango',
  insufficient: 'construyendo base',
}

function lastRmssd(days) {
  for (let i = days.length - 1; i >= 0; i--) {
    if (typeof days[i].rmssd === 'number') return Math.round(days[i].rmssd)
  }
  return 45
}

Page({
  state: {
    rmssdInput: 45,
    hrNow: 70,
    w: {},
  },

  onInit() {
    const days = getDays()
    this.state.rmssdInput = lastRmssd(days)
    try {
      const hr = new HeartRate()
      const last = hr.getLast()
      if (typeof last === 'number' && last >= 30) this.state.hrNow = last
    } catch (e) {}
  },

  build() {
    const s = this.state
    let y = TOP

    // Título
    createWidget(widget.TEXT, {
      x: 0, y, w: W, h: px(42),
      text: 'Relaciones y HRV', text_size: px(30), color: COLORS.text,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
    })
    y += px(48)

    // 1. Estimación del modelo personal de PA
    s.w.bpEstTitle = createWidget(widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: px(28),
      text: 'PA estimada por activación', text_size: px(20), color: COLORS.muted,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
    })
    y += px(28)

    s.w.bpEstVal = createWidget(widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: px(40),
      text: '--/-- mmHg', text_size: px(30), color: COLORS.accent,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
    })
    y += px(40)

    s.w.bpEstMeta = createWidget(widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: px(48),
      text: '', text_size: px(20), color: COLORS.muted,
      align_h: align.CENTER_H, align_v: align.CENTER_V, text_style: text_style.WRAP,
    })
    y += px(56)

    // 2. Registro rápido de HRV diaria (RMSSD en ms)
    createWidget(widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: px(28),
      text: 'HRV diaria (RMSSD ms)', text_size: px(20), color: COLORS.muted,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
    })
    y += px(30)

    const btnW = px(68)
    const stepHrv = (delta) => {
      s.rmssdInput = Math.min(250, Math.max(10, s.rmssdInput + delta))
      s.w.hrvVal.setProperty(prop.TEXT, `${s.rmssdInput} ms`)
    }

    createWidget(widget.BUTTON, {
      x: W / 2 - px(165), y, w: btnW, h: px(54), radius: px(27),
      text: '−', text_size: px(34), normal_color: 0x262626, press_color: 0x444444,
      click_func: () => stepHrv(-1),
      longpress_func: () => stepHrv(-5),
    })
    s.w.hrvVal = createWidget(widget.TEXT, {
      x: W / 2 - px(85), y, w: px(170), h: px(54),
      text: `${s.rmssdInput} ms`, text_size: px(36), color: COLORS.text,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
    })
    createWidget(widget.BUTTON, {
      x: W / 2 + px(165) - btnW, y, w: btnW, h: px(54), radius: px(27),
      text: '+', text_size: px(34), normal_color: 0x262626, press_color: 0x444444,
      click_func: () => stepHrv(1),
      longpress_func: () => stepHrv(5),
    })
    y += px(60)

    createWidget(widget.BUTTON, {
      x: W / 2 - px(110), y, w: px(220), h: px(54), radius: px(27),
      text: 'Guardar HRV hoy', text_size: px(24), normal_color: 0x1c3d5a, press_color: 0x2fa3ff,
      click_func: () => {
        addHrvReading({ rmssd: s.rmssdInput, t: Date.now(), src: 'watch', context: 'daily' })
        this.refreshInsights()
      },
    })
    y += px(62)

    s.w.hrvBase = createWidget(widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: px(34),
      text: '', text_size: px(20), color: COLORS.state.recovery,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
    })
    y += px(42)

    // 3. Correlaciones Spearman (cómo se relaciona todo)
    createWidget(widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: px(30),
      text: 'Correlaciones (Spearman)', text_size: px(22), color: COLORS.text,
      align_h: align.CENTER_H, align_v: align.CENTER_V,
    })
    y += px(34)

    s.w.corrRows = []
    for (let i = 0; i < 5; i++) {
      const wRow = createWidget(widget.TEXT, {
        x: PAD, y, w: W - PAD * 2, h: px(34),
        text: '', text_size: px(20), color: COLORS.muted,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
      })
      s.w.corrRows.push(wRow)
      y += px(34)
    }

    createWidget(widget.FILL_RECT, { x: 0, y: y + px(10), w: 1, h: px(120), color: COLORS.bg })
    this.refreshInsights()
  },

  refreshInsights() {
    const s = this.state
    const days = getDays()
    const todayRec = days.find((d) => d.date === dateKey()) || {}
    const rhr = todayRec.rhr || 60
    const rel = computeRelationships(days)

    // Estimación de PA
    const pred = rel.bpModel.predict({ hr: s.hrNow, rhr, t: Date.now() })
    const m = rel.bpModel.metrics
    s.w.bpEstVal.setProperty(prop.TEXT, `~${Math.round(pred.sys)}/${Math.round(pred.dia)} mmHg`)
    if (m.reliable) {
      s.w.bpEstMeta.setProperty(prop.MORE, {
        text: `Calibrado (${rel.bpModel.sampleCount} tomas · ±${m.loocvMaeSys} mmHg)`,
        color: COLORS.state.recovery,
      })
    } else {
      const maeTxt = m.loocvMaeSys ? ` · MAE ±${m.loocvMaeSys}` : ''
      s.w.bpEstMeta.setProperty(prop.MORE, {
        text: `Experimental (${rel.bpModel.sampleCount}/10 tomas${maeTxt})`,
        color: COLORS.muted,
      })
    }

    // Línea base de HRV
    const hb = rel.baselines.hrv
    const todayHrvTxt = todayRec.rmssd ? `Hoy ${todayRec.rmssd} ms` : 'Sin HRV hoy'
    s.w.hrvBase.setProperty(prop.TEXT, `${todayHrvTxt} · ${BASELINE_LABEL[hb.status]}`)

    // Correlaciones
    rel.pairs.forEach((p, idx) => {
      if (s.w.corrRows[idx]) {
        const isSig = p.result && p.result.significant
        s.w.corrRows[idx].setProperty(prop.MORE, {
          text: formatCorrelationEs(p),
          color: isSig ? COLORS.text : COLORS.muted,
        })
      }
    })
  },
})
