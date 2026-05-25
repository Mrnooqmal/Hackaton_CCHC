# Addendum DS44: Investigación de Incidentes (Árbol de Causas)

> Complemento al documento `DS44_DOCUMENTOS_Y_FASES.md`.
> Aplica específicamente al módulo `Incidents` en la fase DO (Art. 71 DS44).

---

## Contexto

El formato oficial de investigación es el **Informe de Investigación por Árbol de Causas**. No es un documento que firman todos los trabajadores de la obra — lo firman únicamente quienes **participaron en la investigación**.

---

## Firmantes del Informe de Investigación

| Rol | Participación | Firma |
|---|---|---|
| Prevencionista | Lidera y redacta el informe | ✅ Firma obligatoria (Art. 71) |
| Supervisor de la faena | Conocedor del proceso, entrevistado clave | ✅ Firma obligatoria |
| Miembros del CPHS | Si existe en la obra (>25 trabajadores) | ✅ Firma si participaron |
| Colaboradores del proceso | Otros que aportaron información | ✅ Firma si fueron incluidos |
| Trabajador accidentado | Solo es entrevistado — su declaración va como anexo | ❌ No firma el informe |
| Testigos | Solo son entrevistados — sus declaraciones van como anexo | ❌ No firman el informe |

---

## Estructura del Informe (campos que el sistema debe modelar)

El formato tiene estas secciones que deben reflejarse en el modelo de datos del módulo `Incidents`:

### Cabecera
- Quién realizó el informe: `nombre`, `cargo`, `fechaRealizacion`
- A quién va dirigido: `nombre`, `cargo`, `fechaEntrega`, `direccionCentroTrabajo`

### Sección 1 — Información del afectado
- Datos personales: nombre completo, RUT, fecha de nacimiento, género, nacionalidad, edad, contacto
- Datos contractuales: cargo contratado, categoría ocupacional, antigüedad, puesto de trabajo al momento del accidente, experiencia en el puesto, turno

### Sección 2 — Datos del accidente
- Fecha, día, hora del accidente
- Horas trabajadas al momento del accidente
- Dirección, comuna, región
- Fecha/lugar de defunción (si aplica — campo condicional)

### Sección 3 — Entrevistados
- Lista dinámica de entrevistados (1 a N): nombre, RUT, cargo
- El sistema debe permitir agregar N entrevistados
- El primero siempre es el accidentado (si puede declarar)

### Sección 4 — Análisis (árbol de causas)
- Relato del accidente (texto libre, en 3° persona)
- Antecedentes considerados (lista de documentos revisados — ej: IRL, MIPER, Procedimientos)
- Lista de hechos enumerados cronológicamente
- Árbol de causas: campo para subir imagen/diagrama o construirlo en el sistema
- Causas raíz identificadas (lista dinámica)

### Sección 5 — Medidas correctivas
Tabla con N filas (una por causa raíz):

| Campo | Tipo |
|---|---|
| N° | Autogenerado |
| Causa raíz | Texto |
| Medida correctiva/preventiva | Texto |
| Responsable de implementación | `personaId` — selector de persona en la obra |
| Fecha máxima de ejecución | Fecha |
| Estado | `pendiente` / `en_proceso` / `completada` |

### Sección 6 — Colaboradores del proceso investigativo
- Lista dinámica: nombre, RUT, cargo, tipo de colaboración

### Sección 7 — Anexos
- Archivos adjuntos (declaraciones de testigos, ODI, procedimientos, matrices, fotos del lugar)
- Subida a S3 — ya disponible en el sistema

---

## Cambios Requeridos en el Backend

### `Backend/handlers/incidents-module/handler.js`

El modelo actual de incidente probablemente no tiene toda esta estructura. Agregar o extender los campos del ítem DynamoDB:

```js
const incidente = {
  incidenteId,
  tenantId,
  obraId,
  estado: 'abierto', // abierto | en_investigacion | cerrado | archivado

  // Cabecera del informe
  realizadoPor: {
    personaId: null,
    nombre: '',
    cargo: ''
  },
  dirigidoA: {
    personaId: null,
    nombre: '',
    cargo: '',
    direccionCentroTrabajo: ''
  },

  // Afectado
  afectado: {
    personaId: null,       // si está en el sistema
    nombreCompleto: '',
    rut: '',
    fechaNacimiento: null,
    genero: '',
    nacionalidad: '',
    edad: null,
    telefono: '',
    mail: '',
    cargo: '',
    categoriaOcupacional: '', // 'trabajador_dependiente' | 'independiente' | 'empleador'
    antiguedadEmpresa: '',
    puestoAlMomentoAccidente: '',
    experienciaPuesto: '',
    turno: false,
    tipoTurno: ''
  },

  // Datos del accidente
  fechaAccidente: null,
  diaSemana: '',
  horaAccidente: '',
  horasTrabajadas: null,
  direccionAccidente: '',
  comunaAccidente: '',
  regionAccidente: '',
  esFatal: false,
  fechaDefuncion: null,
  lugarDefuncion: null,

  // Investigación
  entrevistados: [],         // [{ nombre, rut, cargo }]
  relatoAccidente: '',
  antecedentesConsiderados: [], // [{ tipo, descripcion, documentoId? }]
  listaHechos: [],           // [{ numero, descripcion }]
  arbolCausasUrl: null,      // S3 URL si suben imagen del árbol
  causasRaiz: [],            // [{ descripcion }]

  // Medidas correctivas
  medidasCorrectivas: [],
  // [{
  //   numero: 1,
  //   causaRaiz: '',
  //   medida: '',
  //   responsableId: null,
  //   responsableNombre: '',
  //   fechaMaxEjecucion: null,
  //   estado: 'pendiente'
  // }]

  // Colaboradores
  colaboradores: [],         // [{ nombre, rut, cargo, tipoColaboracion }]

  // Anexos
  anexos: [],                // [{ nombre, url, tipo, tamaño }]

  // Firmas del informe (solo investigadores, NO todos los trabajadores)
  firmas: [],
  // [{
  //   personaId,
  //   nombre,
  //   cargo,
  //   rol: 'prevencionista' | 'supervisor' | 'cphs' | 'colaborador',
  //   firmado: false,
  //   fechaFirma: null,
  //   signatureId: null
  // }]

  // Seguimiento de medidas
  fechaVerificacionMedidas: null,  // fecha posterior a la ejecución más lejana
  medidasVerificadas: false,

  fechaRealizacion: now,
  fechaCierre: null,
  createdAt: now,
  updatedAt: now
};
```

---

## Flujo en el Sistema

```
1. Supervisor o Prevencionista registra el incidente
   → estado: 'abierto'

2. Se inicia investigación
   → estado: 'en_investigacion'
   → Se asigna responsable de la investigación (prevencionista)
   → Se registran entrevistados
   → Se construye el árbol de causas (texto + imagen)

3. Se identifican causas raíz y se definen medidas correctivas
   → Se asignan responsables y fechas a cada medida
   → El sistema notifica a los responsables vía inbox

4. Se solicita firma del informe
   → SignatureRequest tipo INVESTIGACION (nuevo) dirigido a:
      - Prevencionista
      - Supervisor de la faena
      - Miembros CPHS (si aplica)
   → NO se envía a todos los trabajadores

5. Seguimiento de medidas correctivas
   → El sistema trackea el estado de cada medida
   → Cuando todas están 'completadas' → verificación final
   → estado del incidente: 'cerrado'
```

---

## Nuevo Tipo en `SignatureRequests`

Agregar a `REQUEST_TYPES` en `Backend/handlers/signature-requests/handler.js`:

```js
INVESTIGACION_ACCIDENTE: {
  label: 'Investigación de Accidente / EP',
  icon: 'search',   // usar nombre de icono, no emoji
  requiresDoc: true
},
```

---

## Resumen de Archivos a Modificar

| Archivo | Cambio |
|---|---|
| `Backend/handlers/incidents-module/handler.js` | Extender modelo de incidente con todas las secciones del informe árbol de causas |
| `Backend/handlers/incidents-module/incidents.repository.js` | Actualizar queries para los nuevos campos |
| `Backend/handlers/signature-requests/handler.js` | Agregar tipo `INVESTIGACION_ACCIDENTE` |
| `Frontend/src/pages/Incidents.tsx` (o similar) | Formulario multi-sección del informe de investigación |
