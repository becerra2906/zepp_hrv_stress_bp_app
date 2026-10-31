// Temporizador periódico de Zepp OS 1.0 (timer.createTimer); setInterval solo como respaldo.
export function every(ms, fn) {
  const safe = () => {
    try {
      fn()
    } catch (e) {}
  }
  if (typeof timer !== 'undefined' && typeof timer.createTimer === 'function') {
    return { native: timer.createTimer(ms, ms, safe, {}) }
  }
  return { interval: setInterval(safe, ms) }
}

export function stop(handle) {
  try {
    if (handle.native) timer.stopTimer(handle.native)
    else clearInterval(handle.interval)
  } catch (e) {}
}
