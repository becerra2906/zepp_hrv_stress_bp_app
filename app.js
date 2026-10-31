import './shared/device-polyfill'
import { MessageBuilder } from './shared/message'

App({
  globalData: {
    messageBuilder: null,
  },
  onCreate() {
    // Canal BLE con el Side Service (protocolo oficial de Zepp OS 1.0)
    try {
      const appId = hmApp.packageInfo().appId
      this.globalData.messageBuilder = new MessageBuilder({ appId })
      this.globalData.messageBuilder.connect()
    } catch (e) {
      this.globalData.messageBuilder = null
    }
  },
  onDestroy() {
    try {
      if (this.globalData.messageBuilder) this.globalData.messageBuilder.disConnect()
    } catch (e) {}
  },
})
