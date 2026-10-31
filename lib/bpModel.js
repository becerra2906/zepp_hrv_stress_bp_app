import { isNum, mean, sd } from './math.js'

/**
 * Coeficientes prior aproximados basados en fisiología circadiana y reactividad autonómica.
 * Representa una persona promedio previa a la calibración personal.
 * 
 * Factores modelados:
 * - Intercepto base (~118 / ~78 mmHg)
 * - Reactividad a FC adicional no metabólica (+0.35 mmHg por cada lpm de extra HR en sistólica)
 * - Ritmo circadiano: armónicos seno/coseno de 24h para el nadir nocturno (dipping) y morning surge.
 */
export const DEFAULT_BP_PRIORS = {
  sys: {
    intercept: 118,
    extraHrCoeff: 0.35,      // mmHg / lpm adicional
    circadianSin: 3.5,       // pico vespertino
    circadianCos: -6.0,      // caída nocturna (dipping)
  },
  dia: {
    intercept: 76,
    extraHrCoeff: 0.22,
    circadianSin: 2.2,
    circadianCos: -4.0,
  },
}

/**
 * Convierte timestamp a variables circadianas (seno y coseno en ciclo de 24h).
 * @param {number} t Timestamp en ms
 */
export function circadianFeatures(t) {
  const d = new Date(t)
  const hourFraction = d.getHours() + d.getMinutes() / 60
  const angle = (2 * Math.PI * hourFraction) / 24
  return {
    sin: Math.sin(angle),
    cos: Math.cos(angle),
    hour: hourFraction,
  }
}

/**
 * Extrae vector de características para una lectura puntual.
 * @param {object} input { hr, rhr, t, moving, stress }
 */
export function extractBpFeatures(input) {
  const extraHr = Math.max(0, (input.hr || 70) - (input.rhr || 60))
  const circ = circadianFeatures(input.t || Date.now())
  return {
    extraHr,
    sin: circ.sin,
    cos: circ.cos,
    stress: isNum(input.stress) ? input.stress : 0,
  }
}

/**
 * Predice PA con un conjunto de coeficientes dado.
 * @param {object} features { extraHr, sin, cos, stress }
 * @param {object} coeffs { intercept, extraHrCoeff, circadianSin, circadianCos, stressCoeff? }
 */
export function predictWithCoeffs(features, coeffs) {
  let val = coeffs.intercept +
    (coeffs.extraHrCoeff || 0) * features.extraHr +
    (coeffs.circadianSin || 0) * features.sin +
    (coeffs.circadianCos || 0) * features.cos
  if (coeffs.stressCoeff && isNum(features.stress)) {
    val += coeffs.stressCoeff * (features.stress / 100)
  }
  return Math.round(val * 10) / 10
}

/**
 * Resuelve regresión multilineal con regularización Ridge (L2).
 * X: matriz N x K, y: vector N
 * Retorna vector de pesos w: (X^T X + lambda I)^(-1) X^T y
 */
export function ridgeRegression(X, y, lambda = 1.0) {
  const n = X.length
  if (n === 0 || y.length !== n) return null
  const k = X[0].length

  // X^T * X + lambda * I (sin penalizar el término independiente columna 0)
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0))
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let sum = 0
      for (let r = 0; r < n; r++) {
        sum += X[r][i] * X[r][j]
      }
      XtX[i][j] = sum + (i === j && i > 0 ? lambda : 0)
    }
  }

  // X^T * y
  const Xty = new Array(k).fill(0)
  for (let i = 0; i < k; i++) {
    let sum = 0
    for (let r = 0; r < n; r++) {
      sum += X[r][i] * y[r]
    }
    Xty[i] = sum
  }

  // Eliminación Gauss-Jordan para resolver XtX * w = Xty
  const M = XtX.map((row, i) => [...row, Xty[i]])
  for (let i = 0; i < k; i++) {
    let maxRow = i
    for (let r = i + 1; r < k; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) maxRow = r
    }
    if (Math.abs(M[maxRow][i]) < 1e-12) return null
    if (maxRow !== i) {
      const temp = M[i]
      M[i] = M[maxRow]
      M[maxRow] = temp
    }
    const pivot = M[i][i]
    for (let c = i; c <= k; c++) M[i][c] /= pivot
    for (let r = 0; r < k; r++) {
      if (r !== i) {
        const factor = M[r][i]
        for (let c = i; c <= k; c++) {
          M[r][c] -= factor * M[i][c]
        }
      }
    }
  }

  return M.map((row) => row[k])
}

/**
 * Entrena y calibra el modelo personal de PA a partir de lecturas históricas (tensiómetro o MAPA).
 * Evalúa con Leave-One-Out (LOOCV) si hay entre 5 y 50 muestras, o MAE simple.
 * Compara contra el benchmark "Naive" (predecir siempre el promedio del usuario).
 *
 * @param {Array<{sys:number, dia:number, hr:number, rhr?:number, t:number, stress?:number}>} dataset
 * @param {object} priors Coeficientes iniciales opcionales
 * @returns {object} { modelSys, modelDia, metrics: { loocvMaeSys, naiveMaeSys, reliable }, sampleCount }
 */
export function trainPersonalBpModel(dataset, priors = DEFAULT_BP_PRIORS) {
  const valid = dataset.filter(
    (d) => isNum(d.sys) && isNum(d.dia) && isNum(d.hr) && d.sys > 60 && d.dia > 30
  )

  if (valid.length < 5) {
    // Insuficiente para ajustar: se retorna modelo con priors poblacionales
    return {
      coeffs: priors,
      sampleCount: valid.length,
      metrics: {
        reliable: false,
        reason: 'insufficient_data',
        minRequired: 5,
      },
      predict: (input) => {
        const feats = extractBpFeatures(input)
        return {
          sys: predictWithCoeffs(feats, priors.sys),
          dia: predictWithCoeffs(feats, priors.dia),
          reliable: false,
        }
      },
    }
  }

  // Matriz de diseño: [1, extraHr, sin, cos]
  const X = valid.map((d) => {
    const f = extractBpFeatures(d)
    return [1, f.extraHr, f.sin, f.cos]
  })
  const ySys = valid.map((d) => d.sys)
  const yDia = valid.map((d) => d.dia)

  // Calibración con Ridge (lambda moderado para no sobreajustar)
  const wSys = ridgeRegression(X, ySys, 2.0)
  const wDia = ridgeRegression(X, yDia, 2.0)

  const coeffsSys = wSys
    ? { intercept: wSys[0], extraHrCoeff: wSys[1], circadianSin: wSys[2], circadianCos: wSys[3] }
    : priors.sys
  const coeffsDia = wDia
    ? { intercept: wDia[0], extraHrCoeff: wDia[1], circadianSin: wDia[2], circadianCos: wDia[3] }
    : priors.dia

  // Evaluación Leave-One-Out Cross Validation (LOOCV)
  let sumErrModelSys = 0
  let sumErrNaiveSys = 0
  const meanSys = mean(ySys)

  for (let i = 0; i < valid.length; i++) {
    // Entrenar sin la muestra i si tenemos suficientes
    const trainX = X.filter((_, idx) => idx !== i)
    const trainYSys = ySys.filter((_, idx) => idx !== i)
    const trainMeanSys = mean(trainYSys)

    const w = ridgeRegression(trainX, trainYSys, 2.0)
    const predSys = w
      ? X[i][0] * w[0] + X[i][1] * w[1] + X[i][2] * w[2] + X[i][3] * w[3]
      : predictWithCoeffs(extractBpFeatures(valid[i]), priors.sys)

    sumErrModelSys += Math.abs(predSys - ySys[i])
    sumErrNaiveSys += Math.abs(trainMeanSys - ySys[i])
  }

  const loocvMaeSys = Math.round((sumErrModelSys / valid.length) * 10) / 10
  const naiveMaeSys = Math.round((sumErrNaiveSys / valid.length) * 10) / 10

  // El modelo se considera "reliable" para inferencia si:
  // 1. Hay al menos 10 lecturas
  // 2. Supera o iguala al benchmark Naive (no empeora la media constante)
  // 3. Su error MAE LOOCV en sistólica es inferior a 12 mmHg
  const reliable = valid.length >= 10 && loocvMaeSys <= naiveMaeSys && loocvMaeSys <= 12.0

  return {
    coeffs: { sys: coeffsSys, dia: coeffsDia },
    sampleCount: valid.length,
    metrics: {
      reliable,
      loocvMaeSys,
      naiveMaeSys,
      meanSys: Math.round(meanSys * 10) / 10,
      sdSys: Math.round((sd(ySys) || 0) * 10) / 10,
    },
    predict: (input) => {
      const feats = extractBpFeatures(input)
      return {
        sys: predictWithCoeffs(feats, coeffsSys),
        dia: predictWithCoeffs(feats, coeffsDia),
        reliable,
        mae: loocvMaeSys,
      }
    },
  }
}

/**
 * Evalúa si una lectura real de PA se desvía significativamente de lo esperado
 * según el estado autonómico / ritmo circadiano actual.
 * 
 * @param {object} actual { sys, dia, t, hr, rhr }
 * @param {object} trainedModel Objeto devuelto por trainPersonalBpModel
 * @returns {object} { expectedSys, deltaSys, anomaly: 'high'|'low'|'normal', comment }
 */
export function evaluateBpAnomaly(actual, trainedModel) {
  const pred = trainedModel.predict(actual)
  const deltaSys = Math.round((actual.sys - pred.sys) * 10) / 10
  const threshold = Math.max(12, (trainedModel.metrics.loocvMaeSys || 10) * 1.5)

  let anomaly = 'normal'
  let comment = 'Dentro de lo esperado para tu estado de activación y hora.'

  if (deltaSys > threshold) {
    anomaly = 'high'
    comment = `Presión ${Math.round(deltaSys)} mmHg por encima de lo esperado para tu nivel de activación actual.`
  } else if (deltaSys < -threshold) {
    anomaly = 'low'
    comment = `Presión ${Math.round(Math.abs(deltaSys))} mmHg por debajo de lo estimado para tu estado.`
  }

  return {
    expectedSys: pred.sys,
    expectedDia: pred.dia,
    deltaSys,
    anomaly,
    comment,
  }
}

/**
 * Parser de registros de un estudio MAPA (Monitoreo Ambulatorio de Presión Arterial)
 * o lista de lecturas en formato CSV (con o sin encabezado).
 * Formatos sin encabezado soportados:
 * - Fecha;PAS;PAD;Pulso (4 columnas)
 * - PAS;PAD;Pulso (3 columnas)
 * - PAS;PAD (2 columnas)
 * 
 * @param {string} csvText Contenido del archivo CSV
 * @returns {Array<{t:number, sys:number, dia:number, hr:number}>}
 */
export function parseMapaCsv(csvText) {
  if (typeof csvText !== 'string') return []
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (!lines.length) return []

  // Detectar delimitador (; o ,)
  const sep = lines[0].includes(';') ? ';' : ','
  const firstCols = lines[0].split(sep).map((c) => c.trim())

  // Determinar si la primera línea es encabezado o datos numéricos
  const hasHeader = firstCols.some((c) => /[a-zA-Z]{2,}/.test(c) && isNaN(Date.parse(c)))

  let idxDate = -1
  let idxSys = -1
  let idxDia = -1
  let idxHr = -1
  let startRow = 0

  if (hasHeader) {
    startRow = 1
    const header = firstCols.map((h) => h.toLowerCase())
    idxDate = header.findIndex((h) => h.includes('fecha') || h.includes('date') || h.includes('time') || h.includes('hora'))
    idxSys = header.findIndex((h) => h.includes('sys') || h.includes('pas') || h.includes('sist'))
    idxDia = header.findIndex((h) => h.includes('dia') || h.includes('pad') || h.includes('diast'))
    idxHr = header.findIndex((h) => h.includes('hr') || h.includes('fc') || h.includes('pulso') || h.includes('pulse'))
  } else {
    // Sin encabezado: detectar si la columna 0 es fecha o PAS
    const col0Num = Number(firstCols[0])
    const col0IsBp = isNum(col0Num) && col0Num >= 60 && col0Num <= 260 && !firstCols[0].includes('-') && !firstCols[0].includes(':')
    if (col0IsBp) {
      idxSys = 0
      idxDia = 1
      idxHr = firstCols.length >= 3 ? 2 : -1
    } else {
      idxDate = 0
      idxSys = 1
      idxDia = 2
      idxHr = firstCols.length >= 4 ? 3 : -1
    }
  }

  const readings = []
  const now = Date.now()
  for (let i = startRow; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim())
    if (cols.length < 2) continue
    const sys = idxSys >= 0 ? Number(cols[idxSys]) : NaN
    const dia = idxDia >= 0 ? Number(cols[idxDia]) : NaN
    const hrRaw = idxHr >= 0 && cols[idxHr] !== undefined && cols[idxHr] !== '' ? Number(cols[idxHr]) : 70
    const hr = isNum(hrRaw) && hrRaw >= 30 && hrRaw <= 220 ? hrRaw : 70
    let t = now - (lines.length - 1 - i) * 60000

    if (idxDate >= 0 && cols[idxDate]) {
      const parsedTime = Date.parse(cols[idxDate].replace(' ', 'T'))
      const fallbackTime = isNaN(parsedTime) ? Date.parse(cols[idxDate]) : parsedTime
      if (!isNaN(fallbackTime)) t = fallbackTime
    }

    if (isNum(sys) && isNum(dia) && sys >= 60 && sys <= 260 && dia >= 30 && dia <= 160 && dia < sys) {
      readings.push({ t, sys, dia, hr })
    }
  }

  return readings
}
