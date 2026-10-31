import { isNum } from './math.js'

/**
 * Alertas de FC anómala (bienestar, NO diagnóstico de arritmias).
 * Se evalúan sobre muestras recientes { t (ms), hr, moving, asleep? }.
 */
export const ALERT = {
  REST_TACHY: 'rest_tachycardia',
  BRADY_AWAKE: 'bradycardia_awake',
  SUDDEN_JUMP: 'sudden_jump',
}

export const ALERT_TEXT_ES = {
  rest_tachycardia: 'FC alta en reposo',
  bradycardia_awake: 'FC baja estando despierto',
  sudden_jump: 'Cambio brusco de FC sin actividad',
}

export const DEFAULT_ALERT_CONFIG = {
  tachyBpm: 100, // FC en reposo > 100 lpm (definición clínica de taquicardia)
  bradyBpm: 40,
  sustainMs: 10 * 60 * 1000, // sostenido 10 min
  jumpBpm: 30, // salto ≥ 30 lpm en ≤ 60 s sin movimiento
  jumpWindowMs: 60 * 1000,
}

/**
 * @param {Array<{t:number, hr:number, moving?:boolean, asleep?:boolean}>} samples ordenadas por t
 * @returns {Array<{type:string, t:number, hr:number}>}
 */
export function detectAlerts(samples, cfg = DEFAULT_ALERT_CONFIG) {
  const alerts = []
  const valid = samples.filter((s) => isNum(s.hr) && s.hr >= 25)
  if (!valid.length) return alerts

  // Condiciones sostenidas
  const sustained = (pred, type) => {
    let start = null
    for (const s of valid) {
      if (pred(s)) {
        if (start === null) start = s
        if (s.t - start.t >= cfg.sustainMs) {
          alerts.push({ type, t: start.t, hr: s.hr })
          start = null // evita alertas repetidas en el mismo tramo
          break
        }
      } else start = null
    }
  }
  sustained((s) => !s.moving && s.hr > cfg.tachyBpm, ALERT.REST_TACHY)
  sustained((s) => !s.asleep && s.hr < cfg.bradyBpm, ALERT.BRADY_AWAKE)

  // Saltos bruscos sin movimiento
  for (let i = 1; i < valid.length; i++) {
    const cur = valid[i]
    if (cur.moving) continue
    for (let j = i - 1; j >= 0 && cur.t - valid[j].t <= cfg.jumpWindowMs; j--) {
      if (!valid[j].moving && Math.abs(cur.hr - valid[j].hr) >= cfg.jumpBpm) {
        alerts.push({ type: ALERT.SUDDEN_JUMP, t: cur.t, hr: cur.hr })
        i = valid.length // una por evaluación
        break
      }
    }
  }
  return alerts
}
