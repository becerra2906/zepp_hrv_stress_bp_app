/**
 * Side Service (corre dentro del app Zepp en el teléfono).
 * Sincroniza el perfil de usuario, lecturas individuales de PA, importaciones de MAPA
 * y registros de HRV entre settingsStorage (teléfono) y el reloj.
 */
import { MessageBuilder } from '../shared/message'

const messageBuilder = new MessageBuilder()

function getSettingsPayload() {
  try {
    const userRaw = settings.settingsStorage.getItem('userConfig')
    const bpRaw = settings.settingsStorage.getItem('bpReadings')
    const hrvRaw = settings.settingsStorage.getItem('hrvReadings')
    return {
      type: 'SYNC_RESP',
      user: userRaw ? JSON.parse(userRaw) : null,
      bpReadings: bpRaw ? JSON.parse(bpRaw) : [],
      hrvReadings: hrvRaw ? JSON.parse(hrvRaw) : [],
    }
  } catch (e) {
    return { type: 'SYNC_RESP', user: null, bpReadings: [], hrvReadings: [] }
  }
}

AppSideService({
  onInit() {
    messageBuilder.listen(() => {})
    messageBuilder.on('request', (ctx) => {
      const payload = messageBuilder.buf2Json(ctx.request.payload)
      if (payload && payload.method === 'SYNC_REQ') {
        ctx.response({ data: getSettingsPayload() })
      } else if (payload && payload.method === 'PUSH_HISTORY') {
        // Historial diario del reloj → settingsStorage, para la sección "Historial del reloj" en Ajustes
        try {
          settings.settingsStorage.setItem('watchHistory', JSON.stringify(payload.params || {}))
          ctx.response({ data: { ok: true } })
        } catch (e) {
          ctx.response({ data: { ok: false } })
        }
      }
    })
  },
  onRun() {},
  onDestroy() {},
})
