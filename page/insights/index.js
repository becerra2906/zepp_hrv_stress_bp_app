import { W, scale, top, COL_X, COL_W } from '../../utils/device.js'
import { COLORS } from '../../utils/theme.js'
import { label, pill, card, bottomPad } from '../../utils/ui.js'
import { getDays, addHrvReading, dateKey, invalidateDays } from '../../utils/data.js'
import { computeRelationships, describeCorrelationEs } from '../../lib/insights.js'
import { swipeBackToMain, releaseSwipe } from '../../utils/nav.js'

// Coordenadas del lienzo "Activación — UI T-Rex 2", artboard 3 · Relaciones y HRV (454 px).
const T = (v) => top(v, 34)
const CX = Math.round(W / 2)
const REL_ROWS = 5
const BAR_W = scale(120)

const BASELINE_LABEL = {
  better: 'Mejor que tu base de 7 días',
  worse: 'Por debajo de tu base de 7 días',
  normal: 'En tu rango habitual',
  insufficient: 'Construyendo tu base (registra varios días)',
}
const BASELINE_COLOR = {
  better: COLORS.state.recovery,
  worse: COLORS.state.activation,
  normal: COLORS.state.recovery,
  insufficient: COLORS.muted,
}
const LEVEL_COLOR = {
  strong: COLORS.state.recovery,
  moderate: COLORS.state.activation,
  weak: COLORS.primary,
  none: COLORS.faint,
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
    invalidateDays()
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
    this.state.swipe = swipeBackToMain()
    label(0, T(62), W, scale(40), 'Tu cuerpo hoy', scale(30))

    // 1. Presión estimada por el modelo personal
    label(0, T(112), W, scale(26), 'Presión estimada ahora', scale(19), COLORS.muted)
    s.w.bpEstVal = label(0, T(138), W, scale(56), '--/--', scale(46), COLORS.accent)
    s.w.bpEstMeta = label(CX - scale(160), T(196), scale(320), scale(52), '', scale(18), COLORS.muted, hmUI.align.CENTER_H, true)

    // 2. Tarjeta de HRV diaria
    const cy = T(268)
    card(COL_X, cy, COL_W, scale(256), scale(24))
    label(COL_X, cy + scale(16), COL_W, scale(26), 'HRV de hoy (RMSSD)', scale(20), COLORS.muted)
    const stepHrv = (delta) => {
      s.rmssdInput = Math.min(250, Math.max(10, s.rmssdInput + delta))
      s.w.hrvVal.setProperty(hmUI.prop.TEXT, `${s.rmssdInput} ms`)
    }
    const rowY = cy + scale(50)
    pill(CX - scale(160), rowY, scale(68), scale(60), '-', scale(36), () => stepHrv(-1), 'control', () => stepHrv(-5))
    s.w.hrvVal = label(CX - scale(90), rowY, scale(180), scale(60), `${s.rmssdInput} ms`, scale(40))
    pill(CX + scale(160) - scale(68), rowY, scale(68), scale(60), '+', scale(36), () => stepHrv(1), 'control', () => stepHrv(5))
    pill(CX - scale(120), rowY + scale(72), scale(240), scale(60), 'Guardar HRV', scale(22), () => {
      addHrvReading({ rmssd: s.rmssdInput, t: Date.now(), src: 'watch', context: 'daily' })
      this.refreshInsights()
    }, 'secondary')
    s.w.hrvBase = label(COL_X + scale(10), rowY + scale(140), COL_W - scale(20), scale(50), '', scale(18), COLORS.muted, hmUI.align.CENTER_H, true)

    // 3. Relaciones en lenguaje cotidiano
    label(0, T(560), W, scale(32), 'Qué se relaciona', scale(24))
    s.w.relDays = label(0, T(592), W, scale(24), '', scale(17), COLORS.muted)

    s.w.rels = []
    const relH = scale(84)
    const gap = scale(10)
    for (let i = 0; i < REL_ROWS; i++) {
      const y = T(632) + i * (relH + gap)
      const x = COL_X
      const pad = scale(18)
      card(x, y, COL_W, relH, scale(20))
      const text = label(x + pad, y + scale(8), COL_W - pad * 2, scale(36), '', scale(19), COLORS.text, hmUI.align.LEFT, true)
      hmUI.createWidget(hmUI.widget.FILL_RECT, { x: x + pad, y: y + scale(56), w: BAR_W, h: scale(8), radius: scale(4), color: COLORS.track })
      const bar = hmUI.createWidget(hmUI.widget.FILL_RECT, { x: x + pad, y: y + scale(56), w: scale(4), h: scale(8), radius: scale(4), color: COLORS.faint })
      const strength = label(x + pad + BAR_W + scale(8), y + scale(46), COL_W - pad * 2 - BAR_W - scale(8), scale(28), '', scale(16), COLORS.muted, hmUI.align.LEFT)
      s.w.rels.push({ text, bar, strength, barX: x + pad, barY: y + scale(56) })
    }
    bottomPad(T(632) + REL_ROWS * (relH + gap), scale(120))
    this.refreshInsights()
  },

  refreshInsights() {
    const s = this.state
    const days = getDays()
    const todayRec = days.find((d) => d.date === dateKey()) || {}
    const rhr = todayRec.rhr || 60
    const rel = computeRelationships(days)

    // Presión estimada
    const pred = rel.bpModel.predict({ hr: s.hrNow, rhr, t: Date.now() })
    const m = rel.bpModel.metrics
    s.w.bpEstVal.setProperty(hmUI.prop.TEXT, `~${Math.round(pred.sys)}/${Math.round(pred.dia)}`)
    if (m.reliable) {
      s.w.bpEstMeta.setProperty(hmUI.prop.MORE, {
        text: `Calibrado con ${rel.bpModel.sampleCount} tomas (±${m.loocvMaeSys} mmHg)`,
        color: COLORS.state.recovery,
      })
    } else {
      const missing = Math.max(0, 10 - rel.bpModel.sampleCount)
      s.w.bpEstMeta.setProperty(hmUI.prop.MORE, {
        text: missing ? `Experimental: faltan ${missing} tomas para calibrar` : 'Experimental: aún poco preciso',
        color: COLORS.muted,
      })
    }

    // Línea base de HRV
    const hb = rel.baselines.hrv
    if (!todayRec.rmssd && typeof todayRec.hrvProxy === 'number') {
      // Sin HRV medida: se muestra el proxy nocturno calculado de la FC por minuto (no es RMSSD real)
      s.w.hrvBase.setProperty(hmUI.prop.MORE, {
        text: `Estimada de tu FC nocturna: ${todayRec.hrvProxy} ms (proxy)`,
        color: COLORS.muted,
      })
    } else {
      const todayTxt = todayRec.rmssd ? '' : 'Sin HRV hoy · '
      s.w.hrvBase.setProperty(hmUI.prop.MORE, {
        text: `${todayTxt}${BASELINE_LABEL[hb.status]}`,
        color: BASELINE_COLOR[hb.status],
      })
    }

    // Relaciones
    s.w.relDays.setProperty(hmUI.prop.TEXT, `Según tus últimos ${days.length} días`)
    rel.pairs.forEach((p, idx) => {
      const row = s.w.rels[idx]
      if (!row) return
      const d = describeCorrelationEs(p)
      const color = LEVEL_COLOR[d.level]
      row.text.setProperty(hmUI.prop.MORE, { text: d.text, color: d.level === 'none' ? COLORS.muted : COLORS.text })
      row.bar.setProperty(hmUI.prop.MORE, {
        x: row.barX,
        y: row.barY,
        w: Math.max(scale(4), Math.round(BAR_W * d.ratio)),
        h: scale(8),
        radius: scale(4),
        color,
      })
      row.strength.setProperty(hmUI.prop.TEXT, d.strength)
    })
  },

  onDestroy() {
    releaseSwipe(this.state.swipe)
  },
})
