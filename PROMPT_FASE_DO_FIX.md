# Fix: Fase DO — Interfaz y Lógica de Documentos de Onboarding

## 1. Corrección ya enviada (referencia)
En `Backend/lib/models/Obra.js`, `DOCS_OBLIGATORIOS_PLAN` queda con exactamente 5 tipos:
`'POLITICA_SSO'`, `'DIAGNOSTICO_LEGAL'`, `'MIPER'`, `'MAPA_RIESGOS'`, `'REGLAMENTO_INTERNO'`.
`'PROCEDIMIENTO_TRABAJO'` fue eliminado — el PTP es un proceso, no un documento subible.

---

## 2. Notificación al completar fase PLAN

Cuando los 5 documentos PLAN estén en estado `activo`, mostrar una notificación/toast de confirmación breve (2-3 segundos) indicando que la fase PLAN está completa y que la obra avanza a la fase DO. No bloquear la UI, solo informar.

---

## 3. Documento de nivel obra en fase DO

La fase DO tiene **un documento formal de nivel obra** que actualmente no aparece en la interfaz:

- **Tipo:** `REGISTRO_ACTIVIDAD`
- **Nombre:** Registro de Actividad Preventiva (Art. 72 DS44)
- **Quién lo sube:** Prevencionista o Jefe de Obra
- **Alcance:** toda la obra, no por trabajador

Este documento debe aparecer en la sección de fase DO como un ítem separado, distinto del onboarding por trabajador. Si no existe aún en el sistema, crearlo como cualquier otro documento de obra.

---

## 4. Lógica de onboarding por trabajador — regla fundamental

**Los documentos de onboarding de un trabajador NO están atados a la fase de la obra.**

Un trabajador que se une a la obra en fase PLAN, DO, CHECK o cualquier otra, **siempre** debe completar sus documentos de onboarding. Estos documentos se generan y se trackean en el momento en que el trabajador es vinculado a la obra, independientemente de la fase actual.

### Documentos de onboarding (6 ítems por trabajador)

| # | Tipo | Art. DS44 | Cómo se genera |
|---|---|---|---|
| 1 | IRL (Información de Riesgos Laborales) | Art. 15 | Asignado automáticamente al vincular trabajador |
| 2 | Capacitación SST 8 horas | Art. 16 | SignatureRequest tipo CAPACITACION |
| 3 | Entrega RIHS/RIOHS | Art. 56 | Asignado automáticamente al vincular trabajador |
| 4 | Entrega y Capacitación EPP | Art. 13 | SignatureRequest tipo ENTREGA_EPP |
| 5 | Procedimientos de Trabajo Seguro | Art. 10 | Asignado automáticamente al vincular trabajador |
| 6 | Inducción Plan de Emergencia | Art. 19 | SignatureRequest tipo INDUCCION |

### Generación automática al vincular trabajador

Verificar si al hacer `POST /personas/:id/obras` (o el endpoint equivalente que vincula un trabajador a una obra), el backend **genera automáticamente** los 6 documentos/registros de onboarding para ese trabajador. Si no lo hace, implementarlo:

```
Al vincular personaId + obraId:
1. Crear documento tipo IRL asignado al trabajador (estado: pendiente_firma)
2. Crear documento tipo REGLAMENTO_INTERNO asignado al trabajador (estado: pendiente_firma)
3. Crear documento tipo PROCEDIMIENTO_TRABAJO asignado al trabajador (estado: pendiente_firma)
4. Crear SignatureRequest tipo ENTREGA_EPP para el trabajador
5. Crear SignatureRequest tipo INDUCCION para el trabajador
6. La Capacitación SST 8h (CAPACITACION) puede ser grupal — no se auto-genera
   individual, pero el sistema debe trackear si el trabajador tiene una
   capacitación completada en esa obra. Si no tiene ninguna, cuenta como pendiente.
7. Notificar al trabajador vía inbox: "Tienes X documentos pendientes de firma"
```

---

## 5. UI de la fase DO — rediseño del panel de trabajadores

### Problema actual
La lista de trabajadores con `0/6 items 0%` no es interactuable ni informativa. No se puede saber qué documentos faltan ni actuar sobre ellos.

### Comportamiento esperado

El panel de fase DO debe tener **dos secciones claramente separadas**:

#### Sección A — Documento de obra
```
Fase DO — Documentos de la Obra
─────────────────────────────────
[ ] Registro de Actividad Preventiva (Art. 72)   [Subir documento]
```

#### Sección B — Onboarding por trabajador
Cada trabajador muestra:
- Nombre y cargo
- Barra de progreso (X/6)
- Al hacer clic o expandir: lista de los 6 ítems con estado individual
- Cada ítem pendiente tiene una acción: "Asignar" o "Ver"

```
Adrean Torres — Operador                    2/6 ██░░░░ 33%
  ✅ IRL firmado
  ✅ Entrega RIHS/RIOHS firmada
  ⏳ Capacitación SST 8h          [Ver actividades]
  ⏳ Entrega EPP                  [Asignar]
  ⏳ Procedimientos               [Asignar]
  ⏳ Inducción emergencia         [Asignar]

Alonso Cárdenas — Soldador                  0/6 ░░░░░░  0%
  ⏳ IRL                          [Asignar]
  ...
```

### Indicador global de la fase DO
En el header de la sección mostrar el progreso agregado:
```
Fase DO — Onboarding trabajadores: 4/12 documentos completados (33%)
```

### Trabajador agregado en fase posterior
Si se agrega un trabajador cuando la obra ya pasó la fase DO, sus documentos de onboarding deben aparecer igualmente en el panel — con una etiqueta que indique la fecha de ingreso del trabajador. **No retroceder la fase de la obra.**

---

## 6. Resumen de archivos a revisar e implementar

| Archivo | Acción |
|---|---|
| Endpoint de vinculación trabajador-obra | Verificar e implementar generación automática de documentos de onboarding |
| `Backend/lib/models/Obra.js` | Confirmar que el tracking de onboarding es independiente de la fase |
| Frontend — vista `/obras/:obraId` sección DO | Rediseñar panel: separar documento de obra vs onboarding por trabajador; hacer ítems expandibles e interactuables |
| Frontend — al agregar trabajador a obra | Mostrar feedback inmediato de documentos generados automáticamente |
