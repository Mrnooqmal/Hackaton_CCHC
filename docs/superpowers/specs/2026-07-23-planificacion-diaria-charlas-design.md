# Planificación diaria y reporte post-charla — Diseño

**Fecha:** 2026-07-23
**Estado:** Aprobado por el usuario
**Contexto:** Producto real en producción para la CChC (no prototipo). Priorizar solidez: validación backend, retrocompatibilidad, catálogos configurables.

## Objetivo

Cumplir el checklist de 8 puntos sobre charlas/planificación diaria:

1. Reporte post-charla con número de participantes y asistencia (sí/no).
2. Desplegable estandarizado de "tema tratado" con opción "otro".
3. Campo "recurso utilizado" con desplegable de equipos/herramientas y "otro" no obligatorio.
4. Desplegable de riesgos comunes con "otra identificación" no obligatoria.
5. Desplegable de medidas de prevención.
6. Campo de aplicación de protector solar.
7. Campo "observaciones o participación y consulta" (especialmente Comité Paritario).
8. Generación automática del registro/formulario al marcar permiso de trabajo (altura, espacio confinado, caliente).

## Estado actual (auditoría 2026-07-23)

- Módulo de actividades existente: `Backend/handlers/activities/handler.js` (create/list/get/attendance/stats) y `Frontend/src/pages/Activities.tsx`.
- La actividad ya registra: tipo, subtipo DS44 (capacitaciones), título, descripción, relator, fecha/horas, ubicación, asistentes requeridos, asistencias firmadas con PIN (FirmaService), recurrencia (serie), estado.
- Punto 1 parcial: el detalle muestra requeridos y firmados por separado; no hay cruce sí/no ni reporte descargable.
- Puntos 2–8: no existen.
- Bug detectado: `REUNION_COMITE` y `SIMULACRO` existen en `ACTIVITY_TYPES` del backend pero no aparecen en el selector del frontend.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Dónde viven los campos | En el form/entidad de actividad. La charla diaria (CHARLA_5MIN) y el ART SON la planificación diaria; no se crea módulo aparte. |
| Catálogos | Configurables por tenant con defaults de fábrica (Enfoque B), imitando el patrón `GET/PUT /tenants/{id}/cargos`. |
| Protector solar | El campo aparece siempre que el trabajo sea **exterior** — sin condición de mes ni clima (decisión explícita del usuario). Sept–mar solo agrega un aviso visual de temporada UV. |
| Permisos de trabajo | Formulario estructurado propio por tipo de permiso, embebido en la actividad (no entidad separada, no solo flag). |
| Reporte | Vista en el detalle + descarga vía vista imprimible (`@media print`), sin generación de PDF en backend. |

## Diseño

### 1. Catálogos configurables por tenant (puntos 2–5)

**Nuevo** `Backend/lib/catalogos-actividad.js` con los defaults de fábrica y helpers de sanitización:

- `temas`: aseo y orden, carpintería, fraguado, hormigonado, excavaciones, instalaciones eléctricas, trabajos en altura, izaje, demolición, soldadura, andamios, enfierradura, pintura, manejo manual de cargas, etc.
- `recursos`: betonera, andamio, esmeril angular, taladro, soldadora, grúa/izaje, herramientas de mano, plataforma elevadora, generador, compresor, etc.
- `riesgos`: caída a desnivel, caída a nivel, golpes por/contra, atrapamiento, contacto eléctrico, proyección de partículas, sobreesfuerzo, exposición a ruido, exposición a polvo/sílice, exposición UV, incendio/explosión, atropello por maquinaria, etc.
- `medidas`: uso de EPP, revisión de plataformas, aplicación de protocolos/PTS, chequeo de herramientas, señalización y segregación de áreas, bloqueo de energías (LOTO), orden y aseo, hidratación y pausas, ventilación, supervisión permanente, etc.

Formato de ítem: `{ codigo: string, label: string }` — código estable en MAYÚSCULA_SNAKE, label editable.

**Almacenamiento:** `tenant.reglas.catalogosActividad = { temas[], recursos[], riesgos[], medidas[] }`.

**API** (en `Backend/handlers/tenants-module/handler.js`, mismo patrón que cargos):
- `GET /tenants/{id}/catalogos-actividad` → catálogo del tenant o semilla de fábrica (sin persistir; flag `sembrado`).
- `PUT /tenants/{id}/catalogos-actividad` → guarda con sanitización backend (códigos únicos y válidos, labels no vacíos, merge en `reglas` sin pisar el resto).

**Consumo:** la respuesta de `GET /activities` (list) incluye `catalogos` resueltos para el tenant, para que el form los use sin llamada extra.

**Administración:** página nueva `Frontend/src/pages/CatalogosActividad.tsx`, ruta `/catalogos-actividad`, entrada en el Sidebar junto a "Onboarding" (`/cargos-onboarding`), protegida con el mismo permiso `CARGOS_GESTIONAR` (gestión de catálogos de empresa). Contiene las 4 listas editables (agregar/renombrar/eliminar) con guardado vía el PUT.

**"Otro":** en cada desplegable del form, opción "Otro…" que muestra input de texto libre; se guarda en el campo `otro` correspondiente. Recursos y riesgos son no obligatorios (checklist lo pide así); el tema tratado es requerido para CHARLA_5MIN/ART (o su `otro`).

### 2. Bloque `planificacion` en la actividad (puntos 3–7)

Campos nuevos del ítem en DynamoDB (opcional y retrocompatible: actividades antiguas no lo tienen y todo el render es defensivo):

```js
planificacion: {
  tema: { codigo: string|null, otro: string|null },      // requerido (uno de los dos) en CHARLA_5MIN y ART
  recursos: { codigos: string[], otro: string|null },    // opcional
  riesgos: { codigos: string[], otro: string|null },     // opcional
  medidas: { codigos: string[], otro: string|null },     // opcional
  tipoTrabajo: 'interior' | 'exterior' | null,
  condicionClimatica: 'despejado' | 'parcial' | 'nublado' | 'lluvia' | null,
  protectorSolar: boolean | null,   // solo relevante si tipoTrabajo === 'exterior'
  observaciones: string,            // "Observaciones o participación y consulta"
}
```

Reglas de UI (form "Nueva Actividad" en [Activities.tsx](Frontend/src/pages/Activities.tsx)):
- La sección "Planificación diaria" (tema, recursos, riesgos, medidas, tipo de trabajo, clima, protector solar) se muestra para tipos `CHARLA_5MIN` y `ART`.
- `observaciones` se muestra para **todos** los tipos; label "Participación y consulta" cuando el tipo es `REUNION_COMITE`, "Observaciones" en el resto.
- Protector solar: visible siempre que `tipoTrabajo === 'exterior'`, pre-marcado en `true`, editable. Entre el 1 de septiembre y el 31 de marzo se muestra junto al campo un aviso "Temporada de alta radiación UV". El campo NO se condiciona a mes ni clima.
- Fix incluido: agregar `REUNION_COMITE` y `SIMULACRO` al `ACTIVITY_TYPES` del frontend (con ícono y color), ya soportados por el backend.

Reglas de backend (`create` y `patch` en activities handler):
- Validar el bloque completo: enums (`tipoTrabajo`, `condicionClimatica`), tipos, y que cada `codigo` exista en el catálogo resuelto del tenant (default o del tenant). Códigos desconocidos → 400 con mensaje claro.
- `protectorSolar` se ignora/anula si `tipoTrabajo !== 'exterior'`.
- Strings recortados y con largo máximo razonable (`otro` ≤ 200, `observaciones` ≤ 4000).

### 3. Permisos de trabajo con formulario estructurado (punto 8)

Definición compartida (mismo archivo `catalogos-actividad.js`) de los 3 tipos de permiso y sus checklists (fijos, no configurables por tenant en esta fase):

- `ALTURA`: arnés y cabo de vida inspeccionados · puntos de anclaje/línea de vida definidos · plataformas y andamios revisados · examen de altura vigente del personal · delimitación del área bajo el trabajo.
- `ESPACIO_CONFINADO`: medición de gases realizada · ventilación asegurada · vigía asignado en el exterior · medios de comunicación y rescate disponibles · energías bloqueadas (LOTO).
- `TRABAJO_CALIENTE`: extintor disponible en el área · combustibles retirados o cubiertos · biombos/pantallas instalados · vigía de fuego durante y después del trabajo · chequeo del área al finalizar.

Estructura guardada en la actividad:

```js
permisosTrabajo: [{
  tipo: 'ALTURA' | 'ESPACIO_CONFINADO' | 'TRABAJO_CALIENTE',
  responsableId: string,            // persona del tenant; backend valida existencia
  responsableNombre: string,        // denormalizado para el reporte
  horaInicio: 'HH:MM',
  horaFin: 'HH:MM',
  ubicacion: string,
  checklist: { [itemKey]: 'si' | 'no' | 'na' },
  completo: boolean,                // derivado: todos los ítems respondidos y datos comunes presentes
}]
```

UI: sección "Permisos de trabajo especiales" con 3 checkboxes; al marcar uno se expande inline su formulario (esto materializa la "generación automática del registro/formulario"). Al desmarcar, se descarta ese permiso (con confirmación si tenía datos).

Backend: valida tipo, estructura del checklist contra la definición, formato de horas, y que `responsableId` sea una persona del tenant. `completo` lo calcula el backend, no el cliente.

### 4. Reporte post-charla (punto 1)

Sin endpoint nuevo — se deriva del registro:

- En el **detalle de actividad**, sección "Reporte de asistencia": nº requeridos, nº asistentes, % de asistencia, y tabla por persona con columnas Nombre · Cargo · Asistió (Sí/No) · Hora de firma. El cruce es `asistentesRequeridos × asistentes`; quien firmó sin estar requerido aparece con asistió = Sí (marcado "no convocado").
- El reporte incluye además el bloque de planificación (tema, recursos, riesgos, medidas, tipo de trabajo, clima, protector solar, observaciones) y los permisos de trabajo con su checklist — es el acta completa post-charla.
- **Descarga:** botón "Descargar reporte" que abre una vista imprimible (CSS `@media print`, `window.print()`); el usuario la guarda como PDF desde el navegador. Sin generación de PDF en backend.

### 5. Edición post-charla — `PATCH /activities/{id}`

Las observaciones y los permisos son datos que pueden completarse después de la charla. Se agrega un endpoint de actualización acotado:

- **Solo** puede modificar `planificacion` y `permisosTrabajo`. Nunca `asistentes`, `firmaRelator` ni campos de identidad de la actividad (auditoría de firmas intocable).
- Autorización: el relator de la actividad o quien tenga el permiso de crear actividades (`ACTIVIDADES_CREAR`), del mismo tenant.
- Aplica las mismas validaciones del create; actualiza `updatedAt`.
- Frontend: desde el detalle, botón "Completar registro" (visible según permiso) que abre el mismo formulario de planificación/permisos pre-cargado.

## Trazabilidad checklist → diseño

| Punto | Sección |
|---|---|
| 1 Reporte post-charla | §4 |
| 2 Tema tratado | §1 + §2 |
| 3 Recurso utilizado | §1 + §2 |
| 4 Riesgos comunes | §1 + §2 |
| 5 Medidas de prevención | §1 + §2 |
| 6 Protector solar | §2 |
| 7 Observaciones / participación y consulta | §2 + fix tipos frontend |
| 8 Permisos de trabajo | §3 |

## Fuera de alcance (esta fase)

- Checklists de permisos configurables por tenant (los catálogos §1 sí lo son; los checklists de permisos son fijos).
- Generación de PDF en backend para el reporte.
- Permisos de trabajo como entidad con ciclo de vida/firmas propio.
- Integración con datos meteorológicos reales (el clima se declara manualmente).

## Testing

- Backend: tests unitarios de validación del bloque `planificacion` (códigos inválidos → 400, protectorSolar anulado si interior, límites de largo), de la sanitización de catálogos del PUT, del cálculo de `completo` en permisos y de la autorización del PATCH.
- Frontend: typecheck (`tsc --noEmit`) y verificación manual del flujo: crear charla con planificación completa + permiso → detalle muestra reporte → imprimir.
- Retrocompatibilidad: actividad antigua sin `planificacion` renderiza detalle y reporte sin errores.
