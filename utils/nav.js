// Navegación por gestos (Zepp OS 1.0, hmApp.registerGestureEvent): deslizar a izquierda o derecha
// en una pantalla de detalle vuelve a Inicio; en Inicio sale a la lista de apps.
// Arriba/abajo siguen con el comportamiento por defecto (desplazar la página).

// Cada página es un bundle aparte: el dueño del gesto se guarda en globalData (compartido),
// así el onDestroy de la página anterior no borra el gesto que acaba de registrar la nueva.
function globalData() {
  try {
    return getApp()._options.globalData
  } catch (e) {
    return null
  }
}

function onHorizontalSwipe(action) {
  const token = `${Date.now()}-${Math.random()}`
  const g = globalData()
  if (g) g.swipeOwner = token
  try {
    hmApp.registerGestureEvent((event) => {
      if (event === hmApp.gesture.LEFT || event === hmApp.gesture.RIGHT) {
        action()
        return true // salta el comportamiento por defecto
      }
      return false
    })
  } catch (e) {}
  return token
}

/** Pantallas de detalle: volver a Inicio. Devuelve el token para releaseSwipe. */
export function swipeBackToMain() {
  return onHorizontalSwipe(() => hmApp.goBack())
}

/** Inicio: salir del mini programa a la lista de apps (gotoHome iría a la esfera). */
export function swipeExitApp() {
  return onHorizontalSwipe(() => hmApp.exit())
}

/** En onDestroy: solo quita el gesto si sigue siendo de esta página. */
export function releaseSwipe(token) {
  const g = globalData()
  if (g && g.swipeOwner && g.swipeOwner !== token) return
  if (g) g.swipeOwner = null
  try {
    hmApp.unregisterGestureEvent()
  } catch (e) {}
}
