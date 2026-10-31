# Activación — App Zepp OS (Amazfit T-Rex 2 y compatibles)

Aplicación de bienestar para relojes **Amazfit (Zepp OS 2.0+)** que estima en tiempo real el **nivel de activación autonómica**, calcula la **FC de reposo diaria** contra tu línea base individual, registra tu **HRV diaria (`RMSSD`)**, calibra un **modelo personal de presión arterial** con tus mediciones de tensiómetro o estudio **MAPA**, y calcula **cómo se relaciona todo**.

> ⚠️ **Aviso importante:** Esta aplicación es una herramienta de bienestar y seguimiento fisiológico personal. No es un dispositivo médico ni diagnostica arritmias o hipertensión arterial.

---

## Instalación Rápida por Código QR (Amazfit T-Rex 2)

El paquete compilado en modo `preview` para **Amazfit T-Rex 2** (`deviceSource` 418 / 419, pantalla redonda 454×454 px) se encuentra en [`release/activacion-trex2-v3.zpk`](./release/activacion-trex2-v3.zpk).

![Código QR de instalación para Amazfit T-Rex 2](./release/qr-trex2.png)

**URL del protocolo Zepp Developer Mode:**
```text
zpkd1://raw.githubusercontent.com/becerra2906/zepp_hrv_stress_bp_app/main/release/activacion-trex2-v3.zpk
```

### Pasos para instalar en el reloj:
1. **Activar el Modo Desarrollador en la app Zepp (solo la primera vez):**
   - Abre la app **Zepp** en tu teléfono.
   - Ve a **Perfil** → **Ajustes** → **Acerca de**.
   - Toca **7 veces seguidas** el icono de Zepp hasta que aparezca *"Modo desarrollador activado"*.
2. **Escanear el código QR:**
   - En la app Zepp, entra a **Perfil** → **Mis dispositivos** → **Amazfit T-Rex 2**.
   - Entra en **Modo Desarrollador** → pestaña **Mini Programa**.
   - Toca el icono de **Escanear QR** (arriba a la derecha) y escanea el código QR de arriba (el repositorio debe ser público en GitHub para que la app Zepp descargue el archivo `.zpk`).

---

## Arquitectura del Proyecto

```text
app.json                 Configuración Zepp OS v3 (API mín. 2.0, pantallas redondas 480px y cuadradas 390px)
page/home/               Pantalla "Ahora": anillo de activación, FC en vivo, estrés, FC reposo, alertas
page/bp/                 Registro de presión arterial en el reloj + detección de anomalías frente al modelo
page/insights/           Pantalla "Relaciones y HRV": PA estimada, registro HRV diaria y correlaciones Spearman
app-side/index.js        Side Service en el teléfono: sincronización BLE entre settingsStorage y el reloj
setting/index.js         App de Ajustes en el teléfono: ingreso individual de PA, importador CSV/MAPA, HRV y perfil
lib/                     Librería de algoritmos fisiológicos y estadísticos en JS puro (sin dependencias externas)
utils/                   Almacenamiento en el reloj, series históricas, puente BLE y paleta de colores
release/                 Paquete .zpk compilado para Amazfit T-Rex 2 y código QR en PNG
scripts/                 Generadores sin dependencias para icono (make-icon.mjs) y código QR (make-qr.mjs)
test/                    Suite de 19 pruebas unitarias automatizadas (node --test)
```

---

## Algoritmos Implementados (`lib/`)

| Módulo | Método y Referencia Científica |
|---|---|
| [`restingHr.js`](./lib/restingHr.js) | **FC de reposo diaria:** promedio móvil más bajo de 30 min consecutivos (criterio Garmin/Firstbeat) con prioridad en ventana nocturna (00:00–06:00). **FC máxima:** ecuación de Tanaka ($208 - 0.7 \times \text{edad}$). |
| [`activation.js`](./lib/activation.js) | **Activación autonómica (0–100):** separa actividad física (por cadencia de pasos o FC de reserva $\ge 50\%$ sostenida $\ge 5$ min) de la elevación no metabólica (*Additional Heart Rate*, Myrtek 2004) combinada con estrés autonómico. Máquina de estados con histéresis y cálculo de carga diaria (área bajo la curva). |
| [`baseline.js`](./lib/baseline.js) | **Línea base individual (SWC):** compara la media móvil de 7 días frente a la ventana de 60 días $\pm 0.5 \cdot \text{DE}$ (*Smallest Worthwhile Change*, Plews et al. 2013; Buchheit 2014). |
| [`bp.js`](./lib/bp.js) | **Presión arterial clínica:** clasificación **AHA/ACC 2017** (Normal, Elevada, HTA Etapa 1, Etapa 2, Crisis), presión arterial media ($\text{PAM}$) y presión de pulso ($\text{PP}$). |
| [`bpModel.js`](./lib/bpModel.js) | **Modelo personal de PA calibrado:** regresión multilineal con regularización **Ridge ($L_2$)** usando FC adicional y armónicos circadianos ($\sin/\cos$ de 24h para *dipping* nocturno y *morning surge*). Validación cruzada **Leave-One-Out (LOOCV)** comparada contra referencia *Naive*, detector de anomalías y parser CSV para estudios **MAPA** (con o sin encabezado). |
| [`stats.js`](./lib/stats.js) | **Correlación no paramétrica de Spearman ($\rho$):** manejo de empates por rangos promediados y soporte de desfase temporal (*lag* de 0 a 2 días). |
| [`insights.js`](./lib/insights.js) | **Motor multivariable:** cruza series diarias alineadas (Carga de estrés $\rightarrow$ PAS, FC reposo $\rightarrow$ PAS, HRV $\ln\text{RMSSD} \rightarrow$ PAS, HRV $\leftrightarrow$ Estrés y Estrés hoy $\rightarrow$ FC reposo mañana). |
| [`alerts.js`](./lib/alerts.js) | **Alertas de FC anómala:** taquicardia en reposo sostenida ($>100$ lpm por $\ge 10$ min sin movimiento), bradicardia en vigilia ($<40$ lpm) y saltos bruscos ($\ge 30$ lpm en $\le 60$ s sin actividad). |
| [`hrv.js`](./lib/hrv.js) | **Análisis de intervalos RR:** filtrado de artefactos por mediana local (umbral Kubios 250 ms), $\text{RMSSD}$, $\ln(\text{RMSSD})$, $\text{SDNN}$, $\text{pNN50}$, Poincaré $\text{SD1}/\text{SD2}$ e índice de estrés de Baevsky ($\sqrt{\text{SI}}$). |

---

## Desarrollo y Comandos

```bash
npm install                  # Instala dependencias (@zeppos/zeus-cli y @zeppos/device-types)
npm test                     # Ejecuta las 19 pruebas unitarias (node --test)
npm run build                # Compila el paquete .zab multi-dispositivo en dist/
node scripts/make-qr.mjs     # Regenera el código QR en release/qr-trex2.png
npx zeus dev                 # Ejecuta en el simulador oficial de Zepp OS
```

---

## Guía para Publicar y Monetizar en Zepp App Store

1. **Registro y `appId`:**
   - Crea una cuenta en [Zepp Open Platform Console](https://console.zepp.com/), registra un nuevo *Mini Program* y reemplaza `"appId": 1000001` en [`app.json`](./app.json) por el `appId` asignado.
2. **Revisión de Salud y Bienestar:**
   - Incluye en la descripción de la tienda el aviso explícito de que es una herramienta de bienestar y no de diagnóstico médico, y justifica el uso de los permisos `heart_rate`, `stress` y `step`.
3. **Estrategia de Monetización:**
   - El pago nativo directo de Zepp Store está restringido a cuentas corporativas en China continental. Para desarrolladores globales, el estándar es publicar la app como **Gratuita (Freemium)** en Zepp Store y desbloquear las funciones Pro (calibración MAPA, modelo personal y correlaciones de Spearman) mediante un código de licencia en [`setting/index.js`](./setting/index.js) vendido a través de **Gumroad, Stripe, Lemon Squeezy o KiezelPay**, incluyendo un código de prueba en las notas para el revisor de Zepp.
