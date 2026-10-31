import { mergeSyncedPayload } from './data.js'

/**
 * Sincronización ligera y tolerante a fallos con el Side Service del teléfono.
 * Funciona en Zepp OS 2.0+ cuando el teléfono está conectado sin bloquear la app si está desconectado.
 */
export function requestPhoneSync(onSynced) {
  try {
    const ble = typeof hmBle !== 'undefined' ? hmBle : null
    if (!ble || typeof ble.createConnect !== 'function') return

    ble.createConnect((index, data, size) => {
      try {
        const bytes = new Uint8Array(data, 0, size)
        let str = ''
        for (let i = 0; i < bytes.length; i++) {
          str += String.fromCharCode(bytes[i])
        }
        const start = str.indexOf('{')
        const end = str.lastIndexOf('}')
        if (start >= 0 && end > start) {
          const payload = JSON.parse(str.slice(start, end + 1))
          mergeSyncedPayload(payload)
          if (typeof onSynced === 'function') onSynced(payload)
        }
      } catch (e) {}
    })

    const msg = JSON.stringify({ type: 'SYNC_REQ' })
    const buf = new Uint8Array(msg.length)
    for (let i = 0; i < msg.length; i++) buf[i] = msg.charCodeAt(i)
    ble.send(buf.buffer, buf.byteLength)
  } catch (e) {}
}
