import { COLORS } from './theme.js'

// Piezas de interfaz del diseño, construidas solo con widgets de Zepp OS 1.0 (TEXT, BUTTON, FILL_RECT).

export function label(x, y, w, h, value, size, color = COLORS.text, alignH = hmUI.align.CENTER_H, wrap = false) {
  const opts = {
    x, y, w, h,
    text: value,
    text_size: size,
    color,
    align_h: alignH,
    align_v: hmUI.align.CENTER_V,
  }
  if (wrap) opts.text_style = hmUI.text_style.WRAP
  return hmUI.createWidget(hmUI.widget.TEXT, opts)
}

export function card(x, y, w, h, radius) {
  return hmUI.createWidget(hmUI.widget.FILL_RECT, { x, y, w, h, radius, color: COLORS.card })
}

/** Botón en forma de píldora. kind: 'primary' (azul), 'secondary' (azul oscuro) o 'control' (gris). */
export function pill(x, y, w, h, value, size, onClick, kind = 'control', onLongPress) {
  const palette = {
    primary: [COLORS.primary, COLORS.primaryPress, COLORS.primaryText],
    secondary: [COLORS.secondary, COLORS.primary, COLORS.text],
    control: [COLORS.control, COLORS.controlPress, COLORS.text],
  }[kind]
  const opts = {
    x, y, w, h,
    radius: Math.round(h / 2),
    text: value,
    text_size: size,
    normal_color: palette[0],
    press_color: palette[1],
    color: palette[2],
    click_func: onClick,
  }
  if (onLongPress) opts.longpress_func = onLongPress
  return hmUI.createWidget(hmUI.widget.BUTTON, opts)
}

/** Relleno invisible al final para poder desplazar todo el contenido en pantallas redondas. */
export function bottomPad(y, h) {
  hmUI.createWidget(hmUI.widget.FILL_RECT, { x: 0, y, w: 1, h, color: COLORS.bg })
}
