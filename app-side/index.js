/**
 * Side Service (corre dentro del app Zepp en el teléfono).
 * Sincroniza el perfil de usuario, lecturas individuales de PA, importaciones de MAPA
 * y registros de HRV entre settingsStorage (teléfono) y el reloj.
 */

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

function sendPayloadToWatch() {
  try {
    if (typeof messaging === 'undefined' || !messaging.peerSocket) return
    const str = JSON.stringify(getSettingsPayload())
    const buf = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i)
    messaging.peerSocket.send(buf.buffer)
  } catch (e) {}
}

AppSideService({
  onInit() {
    try {
      if (typeof messaging !== 'undefined' && messaging.peerSocket) {
        messaging.peerSocket.addListener('message', () => {
          sendPayloadToWatch()
        })
      }
      if (typeof settings !== 'undefined' && settings.settingsStorage) {
        settings.settingsStorage.addListener('change', () => {
          sendPayloadToWatch()
        })
      }
    } catch (e) {}
  },
  onRun() {},
  onDestroy() {},
})
