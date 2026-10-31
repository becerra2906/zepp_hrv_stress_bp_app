import { load, save } from './storage.js'
import { hrMaxTanaka } from '../lib/restingHr.js'
import { hrvMetrics } from '../lib/hrv.js'

const KEY_CONFIG = 'config'
const KEY_DAYS = 'days'
const MAX_DAYS = 120

export const DEFAULT_USER = {
  age: 35,
  hrMax: null, // si es null se usa Tanaka
}

export function getUser() {
  return Object.assign({}, DEFAULT_USER, load(KEY_CONFIG, {}))
}

export function setUser(patch) {
  save(KEY_CONFIG, Object.assign(getUser(), patch))
}

export function userHrMax(user = getUser()) {
  return user.hrMax || hrMaxTanaka(user.age)
}

export function dateKey(d = new Date()) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Registros diarios: { date, rhr, stressLoad, totals, bp: [{sys,dia,pulse,t}] } */
export function getDays() {
  return load(KEY_DAYS, [])
}

export function upsertDay(date, patch) {
  const days = getDays()
  let rec = days.find((d) => d.date === date)
  if (!rec) {
    rec = { date, bp: [] }
    days.push(rec)
    days.sort((a, b) => (a.date < b.date ? -1 : 1))
  }
  Object.assign(rec, patch)
  save(KEY_DAYS, days.slice(-MAX_DAYS))
  return rec
}

export function addBpReading(reading) {
  const t = reading.t || Date.now()
  const date = dateKey(new Date(t))
  const days = getDays()
  const rec = days.find((d) => d.date === date)
  const item = {
    sys: reading.sys,
    dia: reading.dia,
    pulse: reading.pulse || reading.hr || 70,
    t,
    src: reading.src || 'manual',
    note: reading.note || reading.context || '',
  }
  const existing = rec && rec.bp ? rec.bp : []
  // Evitar duplicados por timestamp exacto
  if (existing.some((r) => r.t === t && r.sys === item.sys && r.dia === item.dia)) {
    return rec
  }
  const bp = existing.concat([item])
  return upsertDay(date, { bp })
}

/**
 * Registra una medición diaria o puntual de HRV (RMSSD en ms) o calculada desde intervalos RR.
 */
export function addHrvReading({ rmssd, rawRR, t = Date.now(), src = 'manual', context = 'morning' }) {
  let finalRmssd = rmssd
  let details = null
  if (Array.isArray(rawRR) && rawRR.length) {
    const m = hrvMetrics(rawRR)
    if (!m.valid) return { valid: false, reason: m.reason }
    finalRmssd = Math.round(m.rmssd * 10) / 10
    details = m
  }
  if (typeof finalRmssd !== 'number' || finalRmssd <= 5 || finalRmssd > 300) {
    return { valid: false, reason: 'invalid_rmssd' }
  }
  const date = dateKey(new Date(t))
  const days = getDays()
  const rec = days.find((d) => d.date === date)
  const hrvList = (rec && rec.hrv ? rec.hrv : []).concat([
    { rmssd: finalRmssd, lnRmssd: Math.round(Math.log(finalRmssd) * 100) / 100, t, src, context },
  ])
  const updated = upsertDay(date, {
    rmssd: finalRmssd,
    lnRmssd: Math.round(Math.log(finalRmssd) * 100) / 100,
    hrv: hrvList,
  })
  return { valid: true, day: updated, details }
}

/**
 * Fusiona datos sincronizados desde la app del teléfono (perfil, lecturas PA y HRV).
 */
export function mergeSyncedPayload(payload) {
  if (!payload || typeof payload !== 'object') return
  if (payload.user) setUser(payload.user)
  if (Array.isArray(payload.bpReadings)) {
    importBpReadings(payload.bpReadings)
  }
  if (Array.isArray(payload.hrvReadings)) {
    for (const h of payload.hrvReadings) {
      if (h && h.rmssd) addHrvReading(h)
    }
  }
}

/** Elimina una lectura individual por su timestamp. */
export function deleteBpReading(timestamp) {
  const days = getDays()
  for (const d of days) {
    if (d.bp && d.bp.length) {
      const filtered = d.bp.filter((r) => r.t !== timestamp)
      if (filtered.length !== d.bp.length) {
        d.bp = filtered
        save(KEY_DAYS, days)
        return true
      }
    }
  }
  return false
}

/** Importa un conjunto de lecturas individuales (por ejemplo de un MAPA o CSV). */
export function importBpReadings(readings) {
  let count = 0
  for (const r of readings) {
    if (r.sys && r.dia) {
      addBpReading(r)
      count++
    }
  }
  return count
}

/** Serie diaria (con huecos = null) de un campo, para líneas base y correlaciones. */
export function dailySeries(field) {
  return getDays().map((d) => (typeof d[field] === 'number' ? d[field] : null))
}

/** Devuelve todas las lecturas históricas de PA aplanadas con su contexto (rhr). */
export function getAllBpReadings() {
  const all = []
  const days = getDays()
  for (const d of days) {
    if (d.bp && Array.isArray(d.bp)) {
      for (const r of d.bp) {
        all.push({
          sys: r.sys,
          dia: r.dia,
          hr: r.pulse || 70,
          rhr: d.rhr || 60,
          t: r.t,
        })
      }
    }
  }
  return all
}
