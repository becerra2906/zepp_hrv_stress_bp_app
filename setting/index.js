import { parseMapaCsv, trainPersonalBpModel } from '../lib/bpModel.js'
import { classifyBp, BP_LABEL_ES } from '../lib/bp.js'
import { hrMaxTanaka } from '../lib/restingHr.js'

/**
 * Página de Ajustes y Gestión de Datos en el teléfono (Zepp App).
 * Sincroniza automáticamente con el reloj a través de settingsStorage -> app-side -> BLE.
 */

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    return fallback
  }
}

AppSettingsPage({
  build(props) {
    const store = props.settingsStorage
    const draft = readJson(store, 'draftForm', {
      sys: '',
      dia: '',
      pulse: '',
      context: 'reposo_manana',
      rmssd: '',
      csvText: '',
    })
    const user = readJson(store, 'userConfig', { age: 35, hrMax: null })
    const readings = readJson(store, 'bpReadings', [])
    const hrvReadings = readJson(store, 'hrvReadings', [])
    const message = store.getItem('statusMessage') || ''

    const updateDraft = (patch) => {
      store.setItem('draftForm', JSON.stringify(Object.assign({}, draft, patch)))
    }

    const bpModel = trainPersonalBpModel(
      readings.map((r) => ({
        sys: r.sys,
        dia: r.dia,
        hr: r.pulse || r.hr || 70,
        rhr: 60,
        t: r.t,
      }))
    )

    const effectiveHrMax = user.hrMax || hrMaxTanaka(user.age || 35)

    return View({ style: { padding: '16px', backgroundColor: '#f5f5f7' } }, [
      Text(
        { style: { fontSize: '20px', fontWeight: 'bold', marginBottom: '6px', color: '#1c1c1e' } },
        'Activación, HRV y Presión Arterial'
      ),
      Text(
        { style: { fontSize: '13px', color: '#6e6e73', marginBottom: '14px' } },
        'Herramienta de bienestar (no sustituye diagnóstico médico). Todo lo que registres aquí se sincroniza con tu reloj.'
      ),

      message
        ? View(
            {
              style: {
                padding: '10px 12px',
                marginBottom: '14px',
                borderRadius: '8px',
                backgroundColor: '#e5f1ff',
              },
            },
            [Text({ style: { fontSize: '13px', color: '#0055d4' } }, message)]
          )
        : null,

      // SECCIÓN 1: Estado del Modelo Personal de PA
      Section({ title: 'Estado del Modelo Personal de PA' }, [
        Text(
          { style: { fontSize: '14px', fontWeight: 'bold', color: '#1c1c1e', marginBottom: '4px' } },
          bpModel.metrics.reliable
            ? `Calibrado (${bpModel.sampleCount} lecturas · MAE ±${bpModel.metrics.loocvMaeSys} mmHg)`
            : `En calibración (${bpModel.sampleCount}/10 lecturas mínimas)`
        ),
        Text(
          { style: { fontSize: '12px', color: '#6e6e73' } },
          bpModel.metrics.loocvMaeSys !== undefined
            ? `Error validación cruzada (LOOCV): ±${bpModel.metrics.loocvMaeSys} mmHg vs referencia Naive ±${bpModel.metrics.naiveMaeSys} mmHg.`
            : 'Agrega al menos 5–10 mediciones en distintos momentos del día o importa tu estudio MAPA para activar el ajuste.'
        ),
      ]),

      // SECCIÓN 2: Agregar lectura individual de PA
      Section({ title: 'Nueva medición individual (Tensiómetro)' }, [
        TextInput({
          label: 'Sistólica (PAS, mmHg)',
          placeholder: 'Ej: 120',
          value: String(draft.sys || ''),
          onChange: (val) => updateDraft({ sys: val }),
        }),
        TextInput({
          label: 'Diastólica (PAD, mmHg)',
          placeholder: 'Ej: 80',
          value: String(draft.dia || ''),
          onChange: (val) => updateDraft({ dia: val }),
        }),
        TextInput({
          label: 'Pulso (lpm)',
          placeholder: 'Ej: 70',
          value: String(draft.pulse || ''),
          onChange: (val) => updateDraft({ pulse: val }),
        }),
        Select({
          label: 'Contexto de la medición',
          options: [
            { name: 'Reposo matutino', value: 'reposo_manana' },
            { name: 'Reposo diurno / sentado', value: 'reposo_dia' },
            { name: 'Estrés laboral o mental', value: 'estres_mental' },
            { name: 'Post-actividad física (>30 min)', value: 'post_ejercicio' },
            { name: 'Nocturno antes de dormir', value: 'reposo_noche' },
          ],
          value: draft.context || 'reposo_manana',
          onChange: (val) => updateDraft({ context: val }),
        }),
        Button({
          label: 'Guardar Lectura Individual',
          style: { marginTop: '10px', backgroundColor: '#007aff', color: '#ffffff' },
          onClick: () => {
            const sys = Number(draft.sys)
            const dia = Number(draft.dia)
            const pulse = Number(draft.pulse) || 70

            if (!sys || !dia || sys < 60 || sys > 260 || dia < 30 || dia > 160 || dia >= sys) {
              store.setItem('statusMessage', 'Valores inválidos: verifica PAS (60-260) > PAD (30-160).')
              return
            }

            const newReading = {
              sys,
              dia,
              pulse,
              context: draft.context || 'reposo_manana',
              t: Date.now(),
              src: 'phone_individual',
            }

            const next = [newReading].concat(readings)
            store.setItem('bpReadings', JSON.stringify(next))
            updateDraft({ sys: '', dia: '', pulse: '' })
            const cat = classifyBp(sys, dia)
            store.setItem('statusMessage', `Lectura ${sys}/${dia} (${BP_LABEL_ES[cat]}) guardada.`)
          },
        }),
      ]),

      // SECCIÓN 3: Importar lote o estudio MAPA (CSV)
      Section({ title: 'Importar lote o estudio MAPA (CSV)' }, [
        Text(
          { style: { fontSize: '12px', color: '#6e6e73', marginBottom: '6px' } },
          'Pega líneas con o sin encabezado (ej: Fecha;PAS;PAD;Pulso o PAS;PAD;Pulso):'
        ),
        TextInput({
          label: 'Datos CSV / MAPA',
          placeholder: '2025-05-10 08:30;120;80;72\n2025-05-10 09:00;125;82;75',
          value: String(draft.csvText || ''),
          onChange: (val) => updateDraft({ csvText: val }),
        }),
        Button({
          label: 'Procesar e Importar CSV',
          style: { marginTop: '8px', backgroundColor: '#34c759', color: '#ffffff' },
          onClick: () => {
            const parsed = parseMapaCsv(draft.csvText || '')
            if (!parsed.length) {
              store.setItem('statusMessage', 'No se encontraron filas válidas en el CSV.')
              return
            }
            const formatted = parsed.map((r) => ({
              sys: r.sys,
              dia: r.dia,
              pulse: r.hr,
              t: r.t,
              src: 'mapa_csv',
              context: 'mapa',
            }))
            const next = formatted.concat(readings)
            store.setItem('bpReadings', JSON.stringify(next))
            updateDraft({ csvText: '' })
            store.setItem('statusMessage', `Se importaron ${formatted.length} lecturas de MAPA/CSV.`)
          },
        }),
      ]),

      // SECCIÓN 4: Registrar HRV diaria (RMSSD)
      Section({ title: 'Registrar HRV Diaria (RMSSD en ms)' }, [
        TextInput({
          label: 'RMSSD (ms)',
          placeholder: 'Ej: 45',
          value: String(draft.rmssd || ''),
          onChange: (val) => updateDraft({ rmssd: val }),
        }),
        Button({
          label: 'Guardar HRV',
          style: { marginTop: '8px', backgroundColor: '#5856d6', color: '#ffffff' },
          onClick: () => {
            const rmssd = Number(draft.rmssd)
            if (!rmssd || rmssd < 5 || rmssd > 300) {
              store.setItem('statusMessage', 'Ingresa un valor RMSSD válido entre 5 y 300 ms.')
              return
            }
            const nextHrv = [{ rmssd, t: Date.now(), src: 'phone', context: 'morning' }].concat(hrvReadings)
            store.setItem('hrvReadings', JSON.stringify(nextHrv))
            updateDraft({ rmssd: '' })
            store.setItem('statusMessage', `HRV de ${rmssd} ms registrada.`)
          },
        }),
      ]),

      // SECCIÓN 5: Perfil fisiológico
      Section({ title: `Perfil del Usuario (FC máx. activa: ${effectiveHrMax} lpm)` }, [
        TextInput({
          label: 'Edad (años, para fórmula de Tanaka)',
          placeholder: '35',
          value: String(user.age || 35),
          onChange: (val) => {
            const age = Number(val)
            if (age >= 12 && age <= 105) {
              store.setItem('userConfig', JSON.stringify(Object.assign({}, user, { age })))
              store.setItem('statusMessage', `Edad actualizada a ${age} años (FC máx Tanaka: ${hrMaxTanaka(age)} lpm).`)
            }
          },
        }),
        TextInput({
          label: 'FC máxima personalizada (opcional, vacío = Tanaka)',
          placeholder: String(hrMaxTanaka(user.age || 35)),
          value: user.hrMax ? String(user.hrMax) : '',
          onChange: (val) => {
            const hrMax = val ? Number(val) : null
            if (hrMax === null || (hrMax >= 120 && hrMax <= 230)) {
              store.setItem('userConfig', JSON.stringify(Object.assign({}, user, { hrMax })))
              store.setItem('statusMessage', 'FC máxima actualizada.')
            }
          },
        }),
      ]),

      // SECCIÓN 6: Historial reciente de lecturas individuales
      Section({ title: `Lecturas de PA registradas (${readings.length})` }, [
        readings.length === 0
          ? Text({ style: { fontSize: '13px', color: '#8e8e93' } }, 'No hay lecturas registradas aún.')
          : View(
              {},
              readings.slice(0, 15).map((r) => {
                const dateStr = new Date(r.t).toLocaleString()
                const cat = classifyBp(r.sys, r.dia)
                return View(
                  {
                    style: {
                      padding: '8px 0',
                      borderBottom: '1px solid #e5e5ea',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    },
                  },
                  [
                    View({}, [
                      Text(
                        { style: { fontWeight: 'bold', fontSize: '14px' } },
                        `${r.sys}/${r.dia} mmHg · ${r.pulse || 70} lpm (${BP_LABEL_ES[cat]})`
                      ),
                      Text({ style: { fontSize: '11px', color: '#8e8e93' } }, `${dateStr} · ${r.context || r.src}`),
                    ]),
                    Button({
                      label: 'Eliminar',
                      style: { backgroundColor: '#ff3b30', color: '#ffffff', fontSize: '11px', padding: '4px 8px' },
                      onClick: () => {
                        const filtered = readings.filter((item) => item.t !== r.t)
                        store.setItem('bpReadings', JSON.stringify(filtered))
                        store.setItem('statusMessage', 'Lectura eliminada.')
                      },
                    }),
                  ]
                )
              })
            ),
        readings.length > 0
          ? Button({
              label: 'Borrar todas las lecturas',
              style: { marginTop: '12px', backgroundColor: '#8e8e93', color: '#ffffff' },
              onClick: () => {
                store.setItem('bpReadings', JSON.stringify([]))
                store.setItem('statusMessage', 'Historial de lecturas borrado.')
              },
            })
          : null,
      ]),
    ])
  },
})
