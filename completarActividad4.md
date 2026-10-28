# Plan para completar la Actividad N°4

`actividad_4.docx` describe el sistema **después** de los cambios de este plan. Las filas que el informe marca como **"Implementado en esta actividad"** (destacadas en amarillo) todavía no están en el código. Hasta terminar este plan, el informe no coincide con el repositorio.

Estado de partida, verificado el 25 de octubre de 2026 en la rama `pruebas` (`b3cb99c`):

- `npm test` en `Backend/`: 1.052 pruebas, todas pasan.
- Subconjunto de seguridad citado en la sección 5.1 del informe: 218 pruebas, todas pasan.

Reglas del repo que aplican (ver `docs/estado-actual.md`, sección 2):

- Commitea y pushea la persona responsable.
- Toda prueba nueva se valida saboteando el control: se rompe, se comprueba que la prueba falla y se restaura.
- Primero se despliega en dev y después en prod. Backend y frontend van juntos cuando cambia una respuesta que usa el frontend (pasos 1 y 4).
- El frontend tiene que pasar `tsc -b`.

---

## Paso 1. Directorio mínimo en el listado de personas (cierra H-16)

**Lo que afirma el informe:** secciones 1.3 (fila "Respuesta GET /personas"), 3.2 (trabajador: "Directorio mínimo"), 4.2 e), 4.3 y 5.2.

### Backend: `Backend/handlers/personas-module/handler.js`

1. En `GET /personas` (hoy cerca de la línea 1593):
   - Con `personas.ver`: se mantiene `fichaVisible(p)` más `rolNombre` y `rolTipo`.
   - Sin `personas.ver`: se devuelve `entradaDirectorio(p)` con los campos `personaId`, `nombre`, `apellidoPaterno`, `apellidoMaterno`, `cargo`, `rol`, `rolNombre`, `rolTipo`, `obraIds`, `estado` y `asignaciones` reducidas a `{ obraId, cargos, supervisorPersonaId }`.
   - El directorio no lleva RUT, correo, teléfono, fecha de nacimiento, contacto de emergencia, evidencias ni salud.
   - El fragmento del informe (4.2 e) muestra la forma esperada; si el código final difiere, actualiza el fragmento.
2. En `GET /personas/{id}` y `GET /personas/by-rut/{rut}`: si la persona pedida no es la de la sesión y quien pide no tiene `personas.detalle`, responder **403** ("No tienes permiso para ver la ficha de otra persona").
3. Revisar las rutas `historial-epp` y `capacitaciones`, que ya comprueban permisos, para confirmar que siguen el mismo criterio.

### Incidentes: el RUT del afectado lo resuelve el servidor

`Frontend/src/pages/IncidentReportar.tsx` (líneas 402 y 460) toma `p.rut` del listado y lo envía como `trabajador.rut`. Con el directorio mínimo, una trabajadora ya no recibe ese dato.

1. Frontend: enviar `trabajador.personaId` (y `afectados[].personaId`) en vez del RUT. Quitar la búsqueda por RUT del autocompletado (línea 271) y la línea que muestra el RUT (407 y 464).
2. Backend (`Backend/handlers/incidents-module/handler.js` y su repositorio): si llega `personaId`, leer la persona de la empresa de la sesión, tomar su RUT y su cargo y calcular `afectadoRutHmac`. Si no pertenece a la empresa, responder 404. Mantener la entrada manual de nombre y RUT para un afectado externo que no está registrado.
3. Es un cambio a favor: el servidor deja de confiar en un RUT enviado por el navegador (mismo criterio que H-14).

### Frontend: revisar los demás consumidores del listado

Estas pantallas llaman a `workersApi.list()` o `personasApi.list()`. Para cada una, confirmar si el rol que la usa tiene `personas.ver`. Si no lo tiene, que funcione con los campos del directorio:

- **Las usa un trabajador o un supervisor:** `IncidentReportar.tsx`, `SurveyNueva.tsx`, `Surveys.tsx`, `SignatureRequests.tsx`, `Activities.tsx`, `ActivityNueva.tsx`, `ActivityPlanificar.tsx`, `components/ObraEquipoPanel.tsx`, `components/obra/RepositorioDs44.tsx`, `components/obra/NuevaVersion.tsx`.
- **Las usa la gestión, con `personas.ver`, y no deberían cambiar:** `PersonasManagement.tsx`, `PersonaNueva.tsx`, `MiEmpresa.tsx`, `EstructuraConstituir.tsx`, `ObraDetalle.tsx`, `ObraNueva.tsx`, `Incidents.tsx`, `Workers.tsx`, `UserManagement.tsx` y los paneles de gobernanza.

Busca en cada pantalla los usos de `.rut`, `.email`, `.telefono` y `.fechaNacimiento` sobre elementos del listado.

### Pruebas: `Backend/tests/minimizacion-personas.test.js` (nuevo)

El informe cita estos nombres exactos:

- `sin personas.ver, el listado es el directorio mínimo`: el JSON no contiene `rut`, `email`, `telefono`, `fechaNacimiento`, `contactoEmergencia` ni `vigilanciaSalud`.
- `con personas.ver, el listado trae la ficha completa sin salud`
- `sin personas.detalle no se lee la ficha de otra persona`: 403.
- Recomendado: `cada persona puede leer su propia ficha sin permisos`.
- En incidentes: `el RUT del afectado lo resuelve el servidor desde su personaId` y `un afectado de otra empresa no se acepta`.

Apóyate en los dobles de `tests/aislamiento-tenant.test.js`, que ya arman sesiones con permisos.

### Prueba de punta a punta

En `Backend/scripts/prueba-punta-a-punta.js`, agregar que la trabajadora recibe el directorio sin RUT ni correo y que `GET /personas/{id}` de otra persona le da 403. H-16 lo pedía expresamente.

---

## Paso 2. Quitar la copia de permisos de la ficha

**Lo que afirma el informe:** 1.2 (permisos: "Eliminado"), 1.3, 4.2 a), 4.3 y 5.4.

Se verificó que nadie autoriza con `persona.permisos`. El autorizador y `/auth/me` usan `resolvePersonaPermisos`, y el login sobrescribe `permisos` con los calculados (`handlers/auth/handler.js:79`). Ningún archivo del frontend lee `persona.permisos`.

1. `Backend/lib/models/Persona.js`:
   - Quitar `this.permisos` del constructor, de `toDynamoItem()` y de `toSafeFormat()`.
   - Quitar `tienePermiso()`.
   - Reducir `ROLES` a los nombres, o eliminarlo si no tiene otros usos (búscalo con `grep -rn "ROLES" Backend/lib Backend/handlers`).
2. `Backend/lib/services/PersonaService.js:189`: quitar `permisos: rolConfig ? rolConfig.permisos : []`.
3. Crear la migración `Backend/scripts/quitar-permisos-legados.js` copiando el patrón de `scripts/quitar-notificaciones-sms.js` (`REMOVE permisos`, que por omisión solo cuenta). Ejecutarla en dev y después en prod con `--aplicar`.
4. Prueba en `minimizacion-personas.test.js`: `la ficha guardada no lleva la lista de permisos`. Sobre `toDynamoItem()` y sobre `toSafeFormat()`.
5. Actualizar `lib/gobernanza/inventario.js` si alguna descripción menciona los permisos.

---

## Paso 3. Sesiones sin IP, sin agente de usuario y sin RUT

**Lo que afirma el informe:** 1.2 (Sessions), 1.3 (dos filas), 4.3 y 5.4.

Archivo: `Backend/handlers/auth/handler.js`.

1. En `emitirSesion` (línea 133 aprox.): quitar `ipAddress` y `userAgent`. Se verificó con grep que ningún código los lee después.
2. En el login multiempresa (línea 255 aprox.):
   - Guardar `sessionId: hashToken(selectionToken)`, importado de `lib/auth/sesion.js`.
   - Quitar `rut`.
   - Conservar `opciones: [{ personaId, tenantId }]`.
3. En `selectTenant`:
   - Buscar por `hashToken(body.selectionToken)`.
   - Elegir la opción por `tenantId`.
   - Leer la persona con `personaService.getById(opcion.personaId)` y comprobar que `persona.tenantId === tenantId`.
   - Borrar por la misma clave hasheada.
4. Pruebas en `Backend/tests/sesion-minima.test.js` (nuevo):
   - `la sesión guardada no lleva IP ni agente de usuario` (este nombre lo cita el informe).
   - `la selección de empresa no guarda RUT ni el token en claro`
   - `seleccionar empresa resuelve a la persona por personaId`
   - `un token de selección inventado no sirve`

Las sesiones viejas vencen solas por TTL (6 horas). No hace falta migración.

---

## Paso 4. Mayoría de edad del administrador en vez de su fecha de nacimiento

**Lo que afirma el informe:** 1.2 y 1.3 (dos filas de fecha de nacimiento), 1.4, 4.3 y 6.1.

1. `Backend/lib/services/AltaEmpresaService.js`:
   - Se mantiene `problemaFechaNacimiento()` para validar.
   - Al crear el administrador (línea 188 aprox.) se guarda `fechaNacimiento: null` y `mayoriaEdadVerificadaEn: <ISO de ahora>`.
   - Si `admin.fechaNacimiento` no viene (alta por script), no se escribe la verificación.
2. `Backend/lib/models/Persona.js`: agregar `mayoriaEdadVerificadaEn` al constructor, a `toDynamoItem()` y a `toSafeFormat()`.
3. `Backend/handlers/onboarding/handler.js`: sin cambios (sigue exigiendo la fecha para validarla).
4. `Frontend/src/pages/Settings.tsx:108`: si no hay `fechaNacimiento` y sí `mayoriaEdadVerificadaEn`, mostrar "Mayoría de edad verificada" en vez de la fecha.
5. Personal (no administradores): `fechaNacimiento` sigue opcional. Confirmar que `PersonaNueva.tsx` no la exige; hoy no la exige.
6. Prueba en `Backend/tests/onboarding-licencia.test.js`: `el alta guarda la verificación de mayoría de edad, no la fecha de nacimiento`. También debe pasar `un administrador menor de edad se rechaza`, si no existe ya.
7. **Decisión para Adrean:** si los administradores ya registrados conservan la fecha o se migran a la verificación. Es un cambio de datos en prod.

---

## Paso 5. Validación de los campos opcionales en el servidor

**Lo que afirma el informe:** 1.2 (contacto de emergencia y nivel escolar "validados"), 1.3, 1.4, 1.5 y 4.1.

1. Crear `Backend/lib/validacionPersona.js` con una función que devuelva el primer problema o `null`:
   - `nivelEscolar`: vacío, o un valor de `NIVEL_ESCOLAR_OPCIONES`. Moverlo desde `personas-module/handler.js:890` a este módulo y reexportarlo.
   - `contactoEmergencia`: objeto con solo `nombre`, `telefono` y `relacion`, todos strings de 100 caracteres o menos. Cualquier otra clave se rechaza.
   - `telefono`: vacío, o `/^\+?[0-9 ]{8,15}$/`.
2. Llamarla en `PersonaService.crear` y `PersonaService.actualizar`, para que cubra el alta manual, la edición y la carga masiva en cola. Lanzar un error con `statusCode = 400` y verificar que el handler lo traduce a 400.
3. Revisar que la plantilla de carga masiva ya restringe el nivel escolar a la lista. Hoy lo hace con una validación de datos del Excel (`handler.js:944`).
4. Pruebas en `minimizacion-personas.test.js`:
   - `un nivel escolar fuera de la lista no se guarda`
   - `un contacto de emergencia con campos extra no se guarda`
   - `un teléfono con formato inválido no se guarda`

---

## Paso 6. Errores 5xx sin el mensaje interno

**Lo que afirma el informe:** 2.4 (fila "Errores devueltos al cliente"), 4.1, 4.2 g), 4.3 y 5.3.

Hoy hay 68 lugares con `return error(err.message, 500)` o equivalentes. Para listarlos:

```bash
grep -rn "error(err\.message\|err\.message, 500" Backend/handlers Backend/lib
```

1. `Backend/lib/utils/response.js`: en `error()`, si `statusCode >= 500`, reemplazar el mensaje por `'Ocurrió un error interno. Intenta nuevamente en unos minutos.'`. Se arregla en un solo lugar, sin tocar los 68 llamados.
2. Revisar que los `console.error` de esos `catch` registren `err.name` y `err.message` pero nunca el cuerpo de la petición. `tests/logs-sin-datos.test.js` ya prohíbe serializar entidades.
3. Revisar en el frontend que ninguna pantalla dependa del texto de un 500.
4. Pruebas en `Backend/tests/errores-genericos.test.js` (nuevo):
   - `una respuesta 5xx no lleva el mensaje del error interno` (este nombre lo cita el informe).
   - `una respuesta 4xx conserva su mensaje`
   - Una prueba que invoque un handler real con un doble que lance `new Error('ResourceNotFoundException: tabla X')` y compruebe que el cuerpo no contiene "tabla X".

---

## Paso 7. La copia de tablas no puede llevar datos de producción a otro ambiente

**Lo que afirma el informe:** 2.4 (fila "Ambientes"), 3.3 (operador) y 4.3.

1. `Backend/scripts/copy-dynamo-tables.js`: extraer a una función exportada la resolución de origen y destino, y rechazar con un error cualquier par en que el origen sea de prod y el destino no lo sea. Hoy el script copia cada ambiente sobre sí mismo (de las tablas viejas a las nuevas), así que la regla no rompe su uso actual.
2. Prueba en `Backend/tests/scripts-entorno.test.js`: `copiar tablas de producción a otro ambiente se rechaza`.

---

## Paso 8. Documentación y cifras del informe

1. `docs/gobernanza-y-seguridad-de-datos.md`:
   - Marcar **H-16** como resuelto, con la fecha.
   - Agregar la decisión **D-28: minimización (Actividad 4)**, que resuma los pasos 1 a 7.
   - Pasar el punto **7.5** del checklist a "Implementado".
   - En el 2.3, anotar que la selección de empresa ya guarda el token hasheado.
2. `docs/estado-actual.md`: quitar H-16 de pendientes y agregar D-28 a la tabla.
3. **Actualizar `actividad_4.docx`:**
   - Sección 5.1: reemplazar `1052` por la nueva cifra de `npm test` y agregar los archivos nuevos al comando del subconjunto de seguridad, con su cifra nueva.
   - Sección 4.1, fila "Pruebas": "1.052 pruebas" y "218".
   - Secciones 5.2 a 5.4: cambiar el resultado de las filas "Implementado en esta actividad" a **Pasa**.
   - Portada (sección 0.1): cambiar el texto si ya no corresponde decir "implementados en esta actividad". Si se prefiere, quitar el resaltado amarillo.
   - Si el código final difiere de los fragmentos 4.2 e) y g), copiar el código real.
4. Capturas para la entrega (las pide el enunciado): la salida de `npm test`, la del subconjunto de seguridad, y la respuesta de `GET /personas` en dev con una sesión de trabajadora y con una de administrador.

---

## Lo que el informe deja como riesgo y no se implementa aquí

Estos puntos aparecen en las secciones 6.2 y 6.3 del informe como pendientes. **No** hay que implementarlos para que el informe sea correcto:

- **H-15:** salud en el Registro AT/EP y la investigación de accidentes. Es una decisión de producto.
- **Throttling de la API** (checklist 2.8).
- **`GEMINI_API_KEY` resuelta al desplegar:** moverla a un SecureString de SSM.
- **Restringir `kms:Decrypt` y la llave HMAC:** que queden solo para los roles de las Lambda y un rol de operador con MFA. Depende de D-22, porque hoy nadie tiene MFA, y hacerlo antes rompería los scripts del operador. También hay que cuidar el uso de la CMK por DynamoDB y S3 (`kms:ViaService`).
- **Protocolo de notificación de brechas, región de tratamiento y Object Lock.**

## Orden sugerido de commits

1. Pasos 2, 3 y 6, que son solo backend y no cambian lo que usa el frontend. Pueden ir en un mismo despliegue.
2. Paso 5 (validación).
3. Paso 4: backend junto con `Settings.tsx`.
4. Paso 1: backend y frontend juntos, primero en dev con la prueba de punta a punta y después en prod.
5. Paso 7 y paso 8.

Después de cada paso, correr `npm test` en `Backend/` y `npx tsc -b` en `Frontend/`.
