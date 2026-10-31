// Zepp OS 1.0 no tiene LocalStorage: se guarda cada clave como un archivo JSON (UTF-16) con hmFS.
function fileName(key) {
  return `activacion_${key}.json`
}

function str2ab(str) {
  const buf = new ArrayBuffer(str.length * 2)
  const view = new Uint16Array(buf)
  for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i)
  return buf
}

function ab2str(buf) {
  const view = new Uint16Array(buf)
  let out = ''
  // Por bloques para no exceder el límite de argumentos de fromCharCode
  for (let i = 0; i < view.length; i += 4096) {
    out += String.fromCharCode.apply(null, view.subarray(i, i + 4096))
  }
  return out
}

export function load(key, fallback) {
  try {
    const [stat, err] = hmFS.stat(fileName(key))
    if (err !== 0 || !stat.size) return fallback
    const buf = new ArrayBuffer(stat.size)
    const file = hmFS.open(fileName(key), hmFS.O_RDONLY)
    hmFS.seek(file, 0, hmFS.SEEK_SET)
    hmFS.read(file, buf, 0, stat.size)
    hmFS.close(file)
    const raw = ab2str(buf)
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    return fallback
  }
}

export function save(key, value) {
  try {
    const buf = str2ab(JSON.stringify(value))
    const file = hmFS.open(fileName(key), hmFS.O_CREAT | hmFS.O_RDWR | hmFS.O_TRUNC)
    hmFS.seek(file, 0, hmFS.SEEK_SET)
    hmFS.write(file, buf, 0, buf.byteLength)
    hmFS.close(file)
  } catch (e) {}
}
