import { LocalStorage } from '@zos/storage'

// API 2.0 expone la clase LocalStorage; se guarda todo como JSON.
const store = new LocalStorage()

export function load(key, fallback) {
  try {
    const raw = store.getItem(key)
    if (raw === undefined || raw === null || raw === '') return fallback
    return JSON.parse(raw)
  } catch (e) {
    return fallback
  }
}

export function save(key, value) {
  store.setItem(key, JSON.stringify(value))
}
