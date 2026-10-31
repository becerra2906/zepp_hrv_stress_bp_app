import { W, IS_ROUND, scale } from '../../utils/device.js'
import { COLORS } from '../../utils/theme.js'
import { getDays, addHrvReading, dateKey } from '../../utils/data.js'
import { computeRelationships, formatCorrelationEs } from '../../lib/insights.js'

const TOP = IS_ROUND ? scale(60) : scale(28)
const PAD = IS_ROUND ? scale(36) : scale(18)

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
      const hr = hmSensor.createSensor(hmSensor.id.HEART)
      const last = hr.last
      if (typeof last === 'number' && last >= 30) this.state.hrNow = last
    } catch (e) {}
  },

  build() {
    const s = this.state
    let y = TOP

    // Título
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0, y, w: W, h: scale(42),
      text: 'Relaciones y HRV', text_size: scale(30), color: COLORS.text,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })
    y += scale(48)

    // 1. Estimación del modelo personal de PA
    s.w.bpEstTitle = hmUI.createWidget(hmUI.widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: scale(28),
      text: 'PA estimada por activación', text_size: scale(20), color: COLORS.muted,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })
    y += scale(28)

    s.w.bpEstVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: scale(40),
      text: '--/-- mmHg', text_size: scale(30), color: COLORS.accent,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })
    y += scale(40)

    s.w.bpEstMeta = hmUI.createWidget(hmUI.widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: scale(48),
      text: '', text_size: scale(20), color: COLORS.muted,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.WRAP,
    })
    y += scale(56)

    // 2. Registro rápido de HRV diaria (RMSSD en ms)
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: scale(28),
      text: 'HRV diaria (RMSSD ms)', text_size: scale(20), color: COLORS.muted,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })
    y += scale(30)

    const btnW = scale(68)
    const stepHrv = (delta) => {
      s.rmssdInput = Math.min(250, Math.max(10, s.rmssdInput + delta))
      s.w.hrvVal.setProperty(hmUI.prop.TEXT, `${s.rmssdInput} ms`)
    }

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: W / 2 - scale(165), y, w: btnW, h: scale(54), radius: scale(27),
      text: '−', text_size: scale(34), normal_color: 0x262626, press_color: 0x444444,
      click_func: () => stepHrv(-1),
      longpress_func: () => stepHrv(-5),
    })
    s.w.hrvVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: W / 2 - scale(85), y, w: scale(170), h: scale(54),
      text: `${s.rmssdInput} ms`, text_size: scale(36), color: COLORS.text,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })
    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: W / 2 + scale(165) - btnW, y, w: btnW, h: scale(54), radius: scale(27),
      text: '+', text_size: scale(34), normal_color: 0x262626, press_color: 0x444444,
      click_func: () => stepHrv(1),
      longpress_func: () => stepHrv(5),
    })
    y += scale(60)

    hmUI.createWidget(hmUI.widget.BUTTON, {
      x: W / 2 - scale(110), y, w: scale(220), h: scale(54), radius: scale(27),
      text: 'Guardar HRV hoy', text_size: scale(24), normal_color: 0x1c3d5a, press_color: 0x2fa3ff,
      click_func: () => {
        addHrvReading({ rmssd: s.rmssdInput, t: Date.now(), src: 'watch', context: 'daily' })
        this.refreshInsights()
      },
    })
    y += scale(62)

    s.w.hrvBase = hmUI.createWidget(hmUI.widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: scale(34),
      text: '', text_size: scale(20), color: COLORS.state.recovery,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })
    y += scale(42)

    // 3. Correlaciones Spearman (cómo se relaciona todo)
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: PAD, y, w: W - PAD * 2, h: scale(30),
      text: 'Correlaciones (Spearman)', text_size: scale(22), color: COLORS.text,
      align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    })
    y += scale(34)

    s.w.corrRows = []
    for (let i = 0; i < 5; i++) {
      const wRow = hmUI.createWidget(hmUI.widget.TEXT, {
        x: PAD, y, w: W - PAD * 2, h: scale(34),
        text: '', text_size: scale(20), color: COLORS.muted,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
      })
      s.w.corrRows.push(wRow)
      y += scale(34)
    }

    hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y: y + scale(10), w: 1, h: scale(120), color: COLORS.bg })
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
    s.w.bpEstVal.setProperty(hmUI.prop.TEXT, `~${Math.round(pred.sys)}/${Math.round(pred.dia)} mmHg`)
    if (m.reliable) {
      s.w.bpEstMeta.setProperty(hmUI.prop.MORE, {
        text: `Calibrado (${rel.bpModel.sampleCount} tomas · ±${m.loocvMaeSys} mmHg)`,
        color: COLORS.state.recovery,
      })
    } else {
      const maeTxt = m.loocvMaeSys ? ` · MAE ±${m.loocvMaeSys}` : ''
      s.w.bpEstMeta.setProperty(hmUI.prop.MORE, {
        text: `Experimental (${rel.bpModel.sampleCount}/10 tomas${maeTxt})`,
        color: COLORS.muted,
      })
    }

    // Línea base de HRV
    const hb = rel.baselines.hrv
    const todayHrvTxt = todayRec.rmssd ? `Hoy ${todayRec.rmssd} ms` : 'Sin HRV hoy'
    s.w.hrvBase.setProperty(hmUI.prop.TEXT, `${todayHrvTxt} · ${BASELINE_LABEL[hb.status]}`)

    // Correlaciones
    rel.pairs.forEach((p, idx) => {
      if (s.w.corrRows[idx]) {
        const isSig = p.result && p.result.significant
        s.w.corrRows[idx].setProperty(hmUI.prop.MORE, {
          text: formatCorrelationEs(p),
          color: isSig ? COLORS.text : COLORS.muted,
        })
      }
    })
  },
})
