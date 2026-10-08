# Recorridos guiados y manual de uso: Fase 0 (reconocimiento)

**30 de septiembre de 2026.** Informe sin código. Base: el encargo de product tours, su sección 11 (cambios posteriores al trabajo de seguridad), `docs/estado-actual.md` y `docs/gobernanza-y-seguridad-de-datos.md`, contrastados con el código en `pruebas` (`a1b2792`).

Donde el encargo y el repo se contradicen, lo señalo y manda el repo o los documentos.

---

## 0. Antes de todo: dos hallazgos de seguridad fuera del encargo

Aparecieron al revisar cómo aplican `tenantId` los handlers. Los confirmé leyendo el código; no los ejecuté contra ningún ambiente. Contradicen el punto 1.3 del checklist de gobernanza ("la empresa sale de la sesión, nunca del cliente"), que figura como implementado.

| Ruta | Qué pasa | Gravedad |
|---|---|---|
| `GET /signature-requests?tenantId=X` (`handlers/signature-requests/handler.js`, `list`) | Toma `tenantId` de la consulta, no llama a `conSesion` y **descifra** las solicitudes de esa empresa (trabajadores convocados con nombre, cargo y RUT). Cualquier sesión válida de cualquier empresa lee las de otra. `get` solo compara empresa si el cliente manda `tenantId`. `create` toma `solicitanteId` del cuerpo (contradice el 1.8: se actúa a nombre de otro). | Alta |
| `POST/GET/DELETE /ausencias` (`handlers/ausencias/handler.js`) | Las tres rutas toman `tenantId` del cuerpo o de la consulta, sin `conSesion`. Se leen, crean y borran ausencias de otra empresa, incluidas licencias médicas. `registradoPor` sale del cuerpo. | Alta |

Ninguna prueba de aislamiento cubre estas rutas (`aislamiento-*.test.js` no las nombra). No las toqué: es trabajo aparte y decides tú cuándo. Mi recomendación es corregirlas antes que cualquier fase de este encargo.

---

## 1. Frontend

| Tema | Lo que hay |
|---|---|
| Stack | React 19, TypeScript 5.9, Vite 7, `vite-plugin-pwa`. Node 24. |
| Router | `react-router-dom` 7, rutas declaradas a mano en `src/App.tsx` (`BrowserRouter` + `Routes`). No hay registro de pantallas: una pantalla es un patrón de ruta (`/obras/:obraId`). Algunas pantallas tienen pestañas internas (el detalle de obra), que el router no ve. |
| Control de acceso | `ProtectedRoute` con `requiredPermission`; `useAuth().hasPermission`, con bypass de `admin`. |
| Estado | Contextos propios (`AuthContext`, `ObraContext`, `LayoutContext`, `BrandContext`, `ToastContext`). Sin Redux ni React Query. |
| Ámbito multiobra | `ObraContext`: tras el login se elige una obra o la vista de empresa (`/seleccionar-obra`); sin ámbito elegido la app no se renderiza. |
| Componentes | Propios en `src/components/ui` (Modal, Drawer, Toast, Stepper, DataTable…). Iconos: `react-icons`. |
| Estilos y tema | CSS plano con variables (`src/css/*.css`), tema claro/oscuro (`useTheme`) y color de marca por empresa (`BrandContext`). Los `z-index` van de 2825 a 99999999: un overlay de recorridos tendrá que ubicarse con cuidado. |
| i18n | No existe. Todo en español, textos en línea. |
| Modales | `Modal.tsx` no declara `aria-modal` ni `role="dialog"` (solo `Drawer` y el widget de sugerencias lo hacen). Hoy no hay forma de detectar desde fuera que hay un modal crítico abierto. |
| Ayuda actual | `Header.tsx` ya tiene un botón de ayuda contextual: mapea el primer segmento de la ruta a una página de `/manual/modulos/*` (`MANUAL_SECTION`). Es el punto natural para el menú de ayuda. |
| Anclas | Ningún `data-tour` ni `data-testid` en el código. Todo se marca desde cero. |

---

## 2. Manual de uso actual

**Dónde y cómo.** Markdown versionado en el repo (`Frontend/src/manual/content/**/*.md`, 27 páginas, unas 2.170 líneas), renderizado dentro de la app con `react-markdown`, `remark-gfm`, `remark-directive` y callouts propios. Buscador cliente con `minisearch`. Ruta `/manual/*`, fuera del shell, **pública** (no exige sesión), cargada como chunk aparte. Capturas en `public/manual-img` (23 archivos, 144 KB). Es exactamente el formato que el encargo prefiere: no propongo cambiarlo.

**Seguridad.** `react-markdown` no interpreta HTML crudo (no hay `rehype-raw`), así que el manual no es un sumidero de HTML.

**Offline.** El service worker precachea `**/*.{js,css,html,ico,png,svg,woff2}` con límite de 4 MiB por archivo; el chunk del manual y sus imágenes entran. Está disponible sin conexión, pero **no lo verifiqué en un navegador**: queda como prueba de la Fase 4.

**Claves estables.** Cada página ya tiene un slug estable derivado de su ruta (`modulos/firmas`, `ds44/epp`), y `rehype-slug` da anclas por encabezado. `manualSeccionKey` puede ser `slug` o `slug#encabezado` sin inventar otro identificador.

**Estructura actual:** Guía de inicio (4), DS44 y normativa (6), Módulos (11), Roles (6).

### Desactualizado o contrario a las reglas de redacción

| Dónde | Problema |
|---|---|
| `modulos/firmas.md` (secciones "Firmas Offline", preguntas), `guia-inicio/instalacion.md:44`, `modulos/actividades.md:329`, `ds44/firmas-digitales.md:21,76` | Describen una pantalla "Firmas Offline" con "Nueva Solicitud Offline" que ya no existe (el endpoint se retiró el 19 de septiembre). Hoy la firma sin conexión usa vales de un solo uso pedidos con red al inicio del turno (D-3), y la firma con vale vencido queda en revisión. Nada de eso está en el manual. |
| `ds44/fases-obra.md:3` ("Según el DS 44 … ciclo continuo") y `ds44/index.md:46` ("este ciclo normativo") | Presentan Planificar, Hacer, Verificar, Actuar como estructura del decreto. La regla dice que es un esquema propio del sistema. |
| `ds44/index.md:41` ("Verificación automática al avanzar de fase") | Puede leerse como que el sistema valida el contenido. Hay que precisar que verifica la presencia de evidencia, no su contenido. |
| `roles/index.md` | "La plataforma define 5 roles": los roles son por empresa y cada una crea los suyos; los presets son seis (incluye `colaborador`). "Tenants es exclusivo del admin": depende del permiso `empresa.ver`, que es delegable. |
| Tono general | Mucho "Módulos", "Tenants", "Dashboard": jerga para un usuario de terreno. |

### Sin documentación

Prescripciones; estructura preventiva (constituir órganos, comités); selección de obra y vista de empresa (multiobra); firma asistida (solo una mención en `ds44/`); restablecer PIN con control dual; vales de firma sin conexión; carga masiva en cola, con filas fallidas y reintento (hay una mención, a revisar); cargos de onboarding y catálogos de actividad; habilitar la Ficha Básica de Salud; derechos de los titulares y supresión en Mi Empresa; ausencias; repositorio y completitud del FUF; programa de trabajo preventivo (solo mención); configuración personal; widget de sugerencias.

La auditoría página por página contra cada pantalla queda para la Fase 4. Esto es lo que salió con búsqueda dirigida.

---

## 3. Roles y permisos

- **Roles por empresa.** `Tenant.roles[]` con `permisos[]`. Seis presets (`admin`, `jefe_obra`, `prevencionista`, `supervisor`, `colaborador`, `trabajador`) en `Backend/lib/permissions.js`, espejo de `Frontend/src/permissions.ts` (37 permisos). `admin` tiene todos.
- **Evaluación.** El autorizador resuelve los permisos al validar el token y los pasa en el contexto. En el backend, `conSesion(event)` entrega `{personaId, tenantId, rol, permisos}` y `sesionPuede(sesion, permiso)`. En el frontend, `hasPermission`.
- **Una persona, varias empresas.** El login admite elegir empresa (`TenantOpcion`). El progreso por `tenantId + personaId` separa bien cada caso.
- **No hay rol de plataforma.** Confirmado. Las operaciones de plataforma son scripts de operador con IAM (`crear-empresa.js`, `emitir-licencia.js`) y trazabilidad en CloudTrail. La sesión es siempre de una empresa, así que un rol de plataforma no cabe en el modelo actual sin crear una identidad nueva que cruce empresas.

---

## 4. Backend

| Tema | Lo que hay |
|---|---|
| Infra como código | Serverless Framework 4 (`Backend/serverless.yml`), HTTP API, 80 funciones. Despliegue solo por `infra/desplegar-backend.sh <commit> dev\|prod`. |
| Límite de recursos | **464 de 500.** El script avisa sobre 450 y se niega sobre 490 (D-16). Quedan 26. Cada función HTTP cuesta 4 a 6; la salida recomendada es una función por módulo con router (`itty-router`, como `inboxModule` con `/inbox` y `/inbox/{proxy+}`). |
| Handlers | Dos estilos: una función por ruta (lo antiguo) y módulos con router. Servicios en `lib/services`, repositorios en algunos módulos (`inbox.repository.js`). |
| Claves DynamoDB | Heterogéneas: `PK=TENANT#…`/`SK` (personas, obras), `documentId` con índice `tenantId-index`, y en lo reciente `tenantId` (HASH) + `sk` (RANGE) (ausencias, gobernanza, cargas). Para una tabla nueva, la convención reciente es la natural. |
| Cifrado | Todas las tablas con la CMK (`custom.cifradoTablas`), PITR activo. |
| Identidad | `conSesion` corta con 401 si falta contexto y con 403 si la credencial es provisional (cierre por omisión). `tests/rutas-autenticadas.test.js` rompe la build si aparece una ruta pública no declarada. |
| Validación | Manual, sin librería. No hay zod en el backend; en el frontend solo aparece como dependencia transitiva de eslint. |
| Respuestas | `lib/utils/response` (`success`, `error`, `created`), con `Cache-Control: no-store` comprobado por `sin-cache.test.js`. |
| Inventario | `lib/gobernanza/inventario.js`: toda tabla clasificada (evidencia, conveniencia, operacional), con `personasDe` y `alVencer`; `inventario-datos.test.js` falla si falta una. **Ojo:** la supresión por lotes (`lib/gobernanza/lotes.js`) nombra explícitamente las tablas de conveniencia (bandeja y sugerencias). Una tabla nueva de conveniencia exige extender `lotes.js`; no basta con clasificarla. |

---

## 5. Capa offline

- **Service worker** de `vite-plugin-pwa`: precachea archivos estáticos y la navegación; ninguna respuesta de la API (D-14).
- **No existe una cola de sincronización genérica.** Lo único es `useOfflineSignature`: firmas pendientes y vales en `localStorage`, sincronizadas al volver el evento `online`, específicas de firmas (llaman a los endpoints de firma con el vale). No se puede reutilizar tal cual sin mezclar recorridos con credenciales de firma.
- **Se borra al cerrar sesión:** `AuthContext` limpia token, firmas pendientes y vales, y `purgaOffline.ts` elimina la base IndexedDB antigua (la que guardaba PIN).
- **Conclusión:** para el progreso propongo un almacén mínimo propio, con el mismo patrón (clave en `localStorage`, envío al evento `online` y al arrancar, borrado en el mismo `logout`). No es paralelo a un mecanismo existente, porque no lo hay genérico. Guardaría solo el último estado por recorrido (`recorridoId → {version, estado, ultimoPaso}`), sin nombres ni textos.

---

## 6. Pruebas

- **Backend:** `node --test` con `tests/sin-aws.js` (credenciales falsas y red del SDK interceptada). 69 archivos. Las corre `desplegar-backend.sh` en un worktree limpio, con las dependencias del frontend instaladas.
- **Frontend:** sin framework de pruebas. Solo `tsc -b` y eslint. `desplegar-frontend.sh` **no corre pruebas**, solo `npm run build`.
- **Precedente útil:** `html-sin-escapar.test.js` carga TypeScript del frontend desde el backend, transpilándolo al vuelo. Sirve para probar la lógica pura del motor (cola, fusión de estados, vigencias, segmentación) sin sumar herramientas.
- **Lo que falta para los criterios de aceptación:** scroll, espera con `MutationObserver` y legibilidad a 360 px necesitan DOM real. Hay que decidir un entorno (ver preguntas).
- **Cobertura:** no hay medición en ninguno de los dos lados.

---

## 7. Librería de recorridos, CSP y XSS

No hay ninguna instalada (ni driver.js, shepherd, joyride, floating-ui o popper).

**driver.js 1.8.0** (verificado bajando el paquete, sin instalarlo en el repo): MIT, unos 7,2 KB gzip de JS más 3 KB de CSS. Ni `eval` ni `new Function`, no inyecta `<style>`, y el CSS se importa y Vite lo empaqueta. **Es compatible con la CSP actual** (`script-src 'self'` más hashes; `style-src 'self' 'unsafe-inline'`), también cuando pase a activa el 5 de octubre. Pero pinta título, descripción, progreso y textos de botones con **`innerHTML`**. `html-sin-escapar.test.js` no recorre `node_modules`, así que usarlo abriría un sumidero que la prueba no ve. Habría que escapar todo con `escaparHtml` antes de pasárselo y ampliar la prueba para que solo un archivo revisado pueda importarlo.

**Alternativa que recomiendo: motor propio en React, sin dependencias.** El popover se renderiza con JSX (texto plano, escapado por React), así que no hay sumidero y resuelve las fallas 7 y 8 sin tocar la lista de revisados. Da control total sobre lo que el encargo pide y driver.js no resuelve bien: esperar el ancla, fijar el popover en el borde opuesto al elemento en pantallas de 360 px para que nunca lo tape, foco y teclado, y no lanzar encima de un modal. El costo es escribir el posicionamiento, del orden de 150 líneas. Si se complica, `@floating-ui/dom` (MIT) es la opción liviana; no verifiqué su versión ni su peso, lo haría antes de proponerla.

---

## 8. Recorridos como código frente a panel de administración

Lo pediste en la sección 11. Recomiendo **recorridos como código**.

| | Panel con rol de plataforma (5.1 y 5.5) | Recorridos como código |
|---|---|---|
| Quién edita | Un rol de plataforma que **no existe** y que no cabe en el modelo de sesión por empresa. Crearlo es una identidad nueva que cruza empresas: la superficie más delicada del sistema. | Quien tiene acceso al repo, por PR. La autorización es la de git y la del despliegue (IAM), como el resto de las operaciones de plataforma. |
| Validar anclas | En ejecución, en el backend, que tendría que conocer el registro del frontend (no hay paquete compartido). | **Al compilar:** `anclaKey` es un tipo; un recorrido con un ancla inexistente no pasa `tsc -b` y el frontend no se puede publicar. Una prueba cubre el caso inverso (ancla registrada que ningún componente usa). |
| XSS | Texto guardado en base de datos que hay que sanitizar. | Texto revisado en PR y renderizado como texto plano. |
| Offline | Hay que cachear definiciones. | Van en el bundle y el service worker ya las precachea. |
| Auditoría y versión | Campos de auditoría y versionado por construir. | Git da quién, cuándo y por qué. `version` explícita, y una prueba que falla si cambia el contenido de un recorrido sin subir su versión. |
| Borrador y publicación | Estados en base de datos. | Rama y despliegue a dev es el borrador; despliegue a prod es la publicación. `estado: 'inactivo'` y la vigencia por fechas siguen en la definición. |
| Vista previa | Pantalla real con datos de una empresa: problema abierto. | `?recorrido=<slug>&previa=1` en dev, sobre la pantalla real con la empresa desechable de pruebas. No escribe progreso. |
| Recursos del stack (26 libres) | Tabla de definiciones, tabla de progreso y rutas de administración. | Una tabla de progreso y una función con router (unos 7). |
| Costo | Edición sin desplegar. | Cambiar un texto exige desplegar el frontend (barato, con script). No lo edita alguien sin acceso al repo. |

Con código desaparecen por diseño las fallas 17, 18, 22, 23, 24, 28, 30, 31, 32 y 33, y la 15 se reduce a una sola lectura de progreso.

**Término medio, no recomendado ahora:** definiciones en el repo publicadas a una tabla por un script de operador (IAM). Solo tiene sentido si alguien sin acceso al repo necesita editar.

**Desactivar por empresa (5.1):** no es necesario en el primer corte. Si hace falta, sería una lista de `recorridoId` desactivados en la configuración de la empresa, gobernada por `empresa.identidad` o por un permiso nuevo. No lo implemento sin tu aprobación.

---

## 9. Segmentación por permiso

Estoy de acuerdo: segmentar por nombre de rol no escala. Propongo que cada recorrido declare:

```
visibleSi: { todos?: Permiso[]; alguno?: Permiso[]; ninguno?: Permiso[] }
ambito?: 'obra' | 'empresa' | 'cualquiera'
```

- Se evalúa con `hasPermission`, los mismos permisos que ya gobiernan la ruta.
- `ninguno` resuelve el caso del trabajador: la introducción general de terreno se muestra a quien **no** tiene `obras.crear`, por ejemplo. Como `admin` tiene todos los permisos, queda fuera de los recorridos de terreno y ve los de gestión. Es lo esperable, pero tu admin verá muchos recorridos: la cola tiene que ser prudente (ver preguntas).
- `ambito` distingue obra y vista de empresa (`ObraContext`).
- El contenido no es secreto (el manual es público), así que el backend no necesita filtrar definiciones. Solo guarda progreso.

---

## 10. Diseño de datos propuesto (a confirmar en la Fase 1)

**Definiciones** (TypeScript, en `Frontend/src/ayuda/`): `slug`, `tipo: 'obligatorio' | 'opcional' | 'anuncio'` (unión compartida, falla 16), `pantalla: PantallaKey`, `visibleSi`, `ambito`, `version`, `reiniciarAlPublicar`, `vigenciaDesde` y `vigenciaHasta` (`AAAA-MM-DD`, evaluadas en `America/Santiago` con `Intl`), `estado`, `pasos[]` (`ancla: AnclaKey`, `titulo`, `descripcion`, `posicion` de una unión cerrada, `accion?: 'abrir_ayuda'`, `manual?: ManualSeccionKey`), `manual?`, y límites de largo verificados por prueba. Textos como `{ es: string }`, preparados para más idiomas sin implementar traducción.

**Registro de pantallas y anclas:** `PANTALLAS` con patrón de ruta, pestaña opcional, descripción y `manual`. `ANCLAS` por pantalla, con descripción. Los componentes marcan con un helper (`{...ancla('obra.detalle', 'pestana-cumplimiento')}`), nunca con cadenas sueltas. Reemplaza `MANUAL_SECTION` del header.

**Progreso** (tabla nueva, `tenantId` HASH + `sk = <personaId>#<recorridoId>`): `version`, `estado: 'en_progreso' | 'omitido' | 'completado'`, `ultimoPaso`, `actualizadoEn`. Escritura con `UpdateItem` condicional que no retrocede: una versión mayor reinicia; en la misma versión el estado solo sube (`en_progreso < omitido < completado`). Un evento viejo que llega tarde de la cola se descarta y responde éxito (idempotente). `tenantId` y `personaId` salen de `conSesion`.

- **Clasificación:** conveniencia, se suprime a solicitud del titular y con la ficha. Se agrega al inventario, a `lotes.js` y al registro de tratamientos.
- **Persona bloqueada:** no se registra progreso nuevo de quien tiene un bloqueo temporal (es tratamiento nuevo).
- **Alternativa evaluada:** guardarlo como campo de conveniencia en la ficha de la persona (`lotes.js` ya quita esos campos). Ahorra la tabla, pero mezcla escrituras frecuentes de interfaz con el registro de evidencia y su camino de cifrado. La descarto salvo que el margen de recursos apriete.

**API:** una función `ayudaModule` con router: `GET /ayuda/progreso` (todo el progreso de la persona en la empresa, una lectura) y `PUT /ayuda/progreso/{recorridoId}`. Con definiciones en el bundle, la lectura por pantalla no hace falta: el filtrado es local. Validación de forma (slug, entero acotado, estado de la unión) y tope de filas por persona. Sin endpoints de administración ni de depuración.

---

## 11. Vista previa de las 33 fallas

| # | Resolución prevista |
|---|---|
| 1 | Scroll al elemento antes de resaltar; se descarta solo lo inexistente u oculto (`display`, `visibility`, tamaño cero). |
| 2 | Espera con `MutationObserver` y timeout configurable por paso. |
| 3 | Tres estados; cerrar deja `en_progreso`. Regla explícita de cola (pregunta 1). |
| 4 | `completado` solo desde el botón final. |
| 5 | Cola ordenada: primero anuncios, después obligatorios, de a uno. |
| 6 | Pasos saltados y recorridos sin anclas quedan en `console.warn` estructurado (ver pregunta 6), sin marcar progreso. |
| 7 | Anclas tipadas; el selector sale del registro, nunca de texto libre. |
| 8 | Render en JSX como texto plano, sin sumidero. |
| 9 | Sin configuración libre: opciones como uniones cerradas del tipo. |
| 10 | Copias inmutables (`toSorted`, `readonly`). |
| 11 | Sin código muerto; eslint y revisión. |
| 12 | Abrir la ayuda espera la presencia real del elemento, no un `setTimeout`. |
| 13 | El modo vista previa no instancia el emisor de progreso. |
| 14 | Almacén local y envío idempotente al volver la red. |
| 15 | Una lectura de progreso; las definiciones van en el bundle. |
| 16 | Uniones tipadas; el backend valida contra la misma lista. |
| 17 | Sin caché de servidor: no hay definiciones en el servidor. |
| 18 | Claves tipadas, sin normalizar cadenas. |
| 19 | Clave natural compuesta y escritura condicional. |
| 20 | El estado sube (omitido a completado) y la versión reinicia. |
| 21 | Códigos correctos y registro con `console.error`, sin datos personales (H-11). |
| 22 | Sin endpoints de depuración. |
| 23 | Sin lista de IDs: la edición es por repo y despliegue. |
| 24 | Sin administración por API. Si algún día la hay, 403 uniforme. |
| 25 | Tipos más prueba de límites (largos, cantidad de pasos, `desde <= hasta`). Backend: validación de forma del progreso. |
| 26 | `version` más `reiniciarAlPublicar`, con prueba de versión subida. |
| 27 | Vigencias en `America/Santiago`. |
| 28 | Un solo esquema tipado. |
| 29 | Git como auditoría de definiciones; `actualizadoEn` en el progreso. |
| 30 | Pantallas y anclas desde el registro. |
| 31 | `anuncio` es un tipo de primera clase. |
| 32 | Los tipos exigen título y descripción, y una prueba rechaza cadenas vacías. |
| 33 | Vista previa por parámetro de ruta en la app real, sin `localStorage` ni iframe. |

---

## 12. Preguntas abiertas

1. **Regla de la cola de obligatorios.** Propongo que salgan de la cola con `completado` o con "Omitir recorrido" explícito; cerrar con la X o con Esc deja `en_progreso` y vuelve a mostrarse en la próxima entrada a esa pantalla, como máximo tres veces, y después cuenta como omitido. ¿Te sirve?
2. **Prudencia de la cola.** ¿Un solo recorrido automático por sesión, o todos los pendientes de la pantalla uno tras otro?
3. **Recorridos como código.** ¿Apruebas descartar el panel y el rol de plataforma?
4. **Motor propio frente a driver.js.** Recomiendo el propio.
5. **Entorno de pruebas del DOM.** Para scroll, espera y 360 px hace falta un navegador. Opciones: Playwright como dependencia de desarrollo del frontend, corrido a mano y por el script de despliegue (suma tiempo y un navegador descargado); o happy-dom o jsdom para la lógica, más una verificación manual documentada a 360 px. Recomiendo Playwright solo para esos criterios.
6. **Traza de anclas rotas.** No hay telemetría de cliente. ¿Basta `console.warn` más la prueba de anclas, o quieres un endpoint de reporte como `POST /csp/reporte`? Costaría recursos y otra ruta pública.
7. **Frontend sin pruebas en su despliegue.** Para que "el build falle", la verificación de anclas tiene que correr en `npm run build` (por ejemplo, un script de Node antes de `tsc -b`) o en `desplegar-frontend.sh`. Es un cambio pequeño en la cadena de publicación: ¿de acuerdo?
8. **Modales críticos.** Propongo un contexto `BloqueoAyuda` que la firma, la firma asistida y el cambio de PIN activan mientras están abiertos, y agregar `role="dialog"` y `aria-modal` a `Modal.tsx`, que hoy no los tiene. ¿Hay otros flujos que deban bloquear?
9. **Manual y rutas nuevas.** ¿Mantengo la estructura actual (guía, normativa, módulos, roles) o la reorganizo por tarea y rol, como pide la sección 6? La propuesta concreta va en la Fase 4.
10. **Progreso en persona bloqueada:** confirmar que no se registra.

## 13. Riesgos

- **Margen del stack:** 26 recursos. Este encargo usaría unos 7.
- **Anclas y trabajo de Benja:** las pantallas cambian seguido. Las anclas tipadas convierten un rediseño en un error de compilación: es lo buscado, pero le agrega trabajo a él. Hay que acordarlo.
- **`z-index` desordenados:** el overlay puede quedar debajo de un modal o de un toast.
- **Contenido normativo:** los textos de recorridos y del manual necesitan revisión con las reglas de redacción. Hay páginas actuales que ya las incumplen (sección 2).
- **Carpeta sin versionar ajena:** apareció `Backend/scripts/prueba-punta-a-punta.js` sin versionar durante la sesión, además de `Backend/scripts/e2e/`. No son míos y no los toqué.
