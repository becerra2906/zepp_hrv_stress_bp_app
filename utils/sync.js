import { mergeSyncedPayload, getDays } from './data.js'
import { slimHistory } from '../lib/export.js'

/**
 * Sincronización ligera y tolerante a fallos con el Side Service del teléfono
 * usando el MessageBuilder oficial de Zepp OS 1.0. Si el teléfono no está conectado, no bloquea la app.
 */
export function requestPhoneSync(onSynced) {
  try {
    const { messageBuilder } = getApp()._options.globalData
    if (!messageBuilder) return
    messageBuilder
      .request({ method: 'SYNC_REQ' }, { timeout: 10000 })
      .then((payload) => {
        if (!payload || typeof payload !== 'object') return
        mergeSyncedPayload(payload)
        if (typeof onSynced === 'function') onSynced(payload)
      })
      .catch(() => {})
  } catch (e) {}
}

/** Envía el historial diario del reloj al teléfono para verlo y exportarlo en Ajustes. */
export function pushHistoryToPhone() {
  try {
    const { messageBuilder } = getApp()._options.globalData
    if (!messageBuilder) return
    messageBuilder
      .request({ method: 'PUSH_HISTORY', params: { at: Date.now(), days: slimHistory(getDays()) } }, { timeout: 15000 })
      .catch(() => {})
  } catch (e) {}
}
