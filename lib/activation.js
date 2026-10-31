import { clamp, isNum } from './math.js'

/** Estados de activación (de menor a mayor). */
export const STATE = {
  RECOVERY: 'recovery',
  BALANCE: 'balance',
  ACTIVATION: 'activation',
  HIGH: 'high',
  EXERCISE: 'exercise',
}

export const STATE_LABEL_ES = {
  recovery: 'Recuperación',
  balance: 'Equilibrio',
  activation: 'Activación',
  high: 'Estrés alto',
  exercise: 'Actividad física',
}

export const DEFAULT_CONFIG = {
  // "FC adicional" (Myrtek 2004): elevación no explicada por actividad física.
  // Margen postural/digestivo sobre la FC de reposo antes de considerarla activación.
  restMarginBpm: 10,
  // Elevación adicional que equivale a score 100.
  extraHrFullScaleBpm: 25,
  // Peso del estrés Zepp frente al componente de FC (configurable).
  stressWeight: 0.6,
  // Cadencia (pasos/min) a partir de la cual se considera movimiento.
  movingStepsPerMin: 10,
  // Umbrales de estado (score 0-100).
  thresholds: [25, 50, 75],
  // Histéresis: puntos de margen y muestras consecutivas para cambiar de estado.
  hysteresisMargin: 5,
  hysteresisSamples: 3,
}

/** Fracción de la FC de reserva (Karvonen), 0-1. */
export function hrReserve(hr, rhr, hrMax) {
  if (!isNum(hr) || !isNum(rhr) || !isNum(hrMax) || hrMax <= rhr) return null
  return clamp((hr - rhr) / (hrMax - rhr), 0, 1)
}

/**
 * Score de activación de un instante/minuto.
 * @param {object} s
 * @param {number} s.hr FC (lpm)
 * @param {number} s.rhr FC de reposo
 * @param {number} s.hrMax FC máxima
 * @param {boolean} [s.moving] hay movimiento (pasos/acelerómetro)
 * @param {number} [s.stress] estrés Zepp 0-100 (0 o null = sin dato)
 * @param {number} [s.sns] índice SNS externo (si hay RR), sustituye al estrés Zepp. Escala z (-2..+4 aprox.)
 * @returns {{ score: number, kind: 'physical'|'autonomic', hrr: number|null, hrComponent: number }|null}
 */
export function activationScore(s, cfg = DEFAULT_CONFIG) {
  if (!isNum(s.hr) || !isNum(s.rhr)) return null
  const hrr = hrReserve(s.hr, s.rhr, s.hrMax)
  if (s.moving) {
    // Carga física: no se contabiliza como estrés.
    return { score: Math.round((hrr || 0) * 100), kind: 'physical', hrr, hrComponent: 0 }
  }
  const extra = s.hr - (s.rhr + cfg.restMarginBpm)
  const hrComponent = clamp((extra / cfg.extraHrFullScaleBpm) * 100, 0, 100)

  let autonomic = null
  if (isNum(s.sns)) {
    // SNS z-score: 0 = media poblacional; +3 ≈ activación muy alta.
    autonomic = clamp(((s.sns + 1) / 4) * 100, 0, 100)
  } else if (isNum(s.stress) && s.stress > 0) {
    autonomic = clamp(s.stress, 0, 100)
  }
  const score =
    autonomic === null ? hrComponent : cfg.stressWeight * autonomic + (1 - cfg.stressWeight) * hrComponent
  return { score: Math.round(score), kind: 'autonomic', hrr, hrComponent: Math.round(hrComponent) }
}

export function stateForScore(score, thresholds = DEFAULT_CONFIG.thresholds) {
  if (score < thresholds[0]) return STATE.RECOVERY
  if (score < thresholds[1]) return STATE.BALANCE
  if (score < thresholds[2]) return STATE.ACTIVATION
  return STATE.HIGH
}

const ORDER = [STATE.RECOVERY, STATE.BALANCE, STATE.ACTIVATION, STATE.HIGH]

/**
 * Máquina de estados con histéresis, para evitar saltos por ruido.
 * Uso: const sm = createStateMachine(); sm.push(result) -> estado actual.
 */
export function createStateMachine(cfg = DEFAULT_CONFIG) {
  let current = null
  let candidate = null
  let count = 0

  function target(result) {
    if (result.kind === 'physical') return STATE.EXERCISE
    const raw = stateForScore(result.score, cfg.thresholds)
    if (current === null || current === STATE.EXERCISE) return raw
    // Con histéresis: solo se cambia si el score supera el umbral por el margen.
    const ci = ORDER.indexOf(current)
    const ri = ORDER.indexOf(raw)
    if (ri > ci && result.score >= cfg.thresholds[ri - 1] + cfg.hysteresisMargin) return raw
    if (ri < ci && result.score < cfg.thresholds[ci - 1] - cfg.hysteresisMargin) return raw
    return current
  }

  return {
    push(result) {
      if (!result) return current
      const t = target(result)
      if (current === null) {
        current = t
        return current
      }
      if (t === current) {
        candidate = null
        count = 0
        return current
      }
      if (t === candidate) count++
      else {
        candidate = t
        count = 1
      }
      if (count >= cfg.hysteresisSamples) {
        current = t
        candidate = null
        count = 0
      }
      return current
    },
    get state() {
      return current
    },
  }
}

/**
 * Para el historial (sin pasos por minuto): marca como físicos los minutos dentro de
 * tramos con FC de reserva ≥ `hrrThreshold` sostenida ≥ `minRun` minutos.
 */
export function inferPhysicalFromHr(minutes, rhr, hrMax, { hrrThreshold = 0.5, minRun = 5 } = {}) {
  const flags = new Array(minutes.length).fill(false)
  let runStart = -1
  for (let i = 0; i <= minutes.length; i++) {
    const hrr = i < minutes.length ? hrReserve(minutes[i], rhr, hrMax) : null
    const high = hrr !== null && minutes[i] > 0 && hrr >= hrrThreshold
    if (high && runStart < 0) runStart = i
    if (!high && runStart >= 0) {
      if (i - runStart >= minRun) for (let k = runStart; k < i; k++) flags[k] = true
      runStart = -1
    }
  }
  return flags
}

/**
 * Reconstruye el día minuto a minuto y resume la carga.
 * @param {number[]} minutes FC por minuto desde 00:00 (getToday)
 * @param {object} ctx { rhr, hrMax, stress?: number[] (por minuto, opcional) }
 */
export function analyzeDay(minutes, { rhr, hrMax, stress = null }, cfg = DEFAULT_CONFIG) {
  const physical = inferPhysicalFromHr(minutes, rhr, hrMax)
  const sm = createStateMachine(cfg)
  const timeline = new Array(minutes.length).fill(null)
  const totals = { recovery: 0, balance: 0, activation: 0, high: 0, exercise: 0 }
  let stressLoad = 0
  for (let i = 0; i < minutes.length; i++) {
    const hr = minutes[i]
    if (!isNum(hr) || hr < 30) continue
    const r = activationScore(
      { hr, rhr, hrMax, moving: physical[i], stress: stress ? stress[i] : null },
      cfg
    )
    const st = sm.push(r)
    timeline[i] = { score: r.score, state: st }
    totals[st]++
    // Carga de estrés: área por encima del umbral de activación (solo autonómica).
    if (r.kind === 'autonomic' && r.score > cfg.thresholds[1]) {
      stressLoad += (r.score - cfg.thresholds[1]) / (100 - cfg.thresholds[1])
    }
  }
  return { timeline, totals, stressLoad: Math.round(stressLoad * 10) / 10 }
}
