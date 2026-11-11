# Fase 4: propuesta de reorganización del manual

**7 de noviembre de 2026.** Para aprobar antes de escribir contenido. Base: el manual en `tours` (`a4d110a`), que incluye la revisión completa de Benja del 12 de octubre (contenido contra el código, 45 capturas, filtro de páginas por permiso y buscador por subtítulo).

---

## 1. Cómo está hoy

Cuatro secciones, 33 páginas, unas 3.100 líneas, organizadas **por módulo del sistema**:

| Sección | Páginas |
|---|---|
| Guía de inicio | Qué es · Cómo ingresar · Primeros pasos · Registro de una empresa |
| DS44 y normativa | Qué es el DS 44 · Fases y estados · Documentos obligatorios · EPP · Capacitaciones · Firmas digitales |
| Módulos (17) | Resumen · Inicio · Obras · Personas · Repositorio · Actividades · Encuestas · Firmas · Incidentes · Prescripciones · Estructura preventiva · Notificaciones · Mi Empresa · Onboarding por cargo · Catálogos · Datos personales · Configuración |
| Roles (6) | Todos · Administrador · Prevencionista · Jefe de obra · Supervisor · Trabajador |

**Lo que ya está bien y se conserva:**
- El contenido está al día con el código; la revisión de octubre corrigió casi todo lo que señaló la Fase 0. Ya no aparece "Firmas Offline", los roles se explican como configurables y la validez del PIN se describe sin afirmarla.
- Las capturas.
- El filtro por permiso: cada persona ve solo las páginas de lo que puede hacer.
- El buscador por subtítulo.
- El formato: markdown en el repo, servido dentro de la app y disponible sin conexión.

**Lo que no funciona para quien lo usa en terreno:**
1. **Está ordenado como el sistema, no como el trabajo.** Un trabajador que quiere firmar tiene que saber que eso está en "Módulos → Firmas", junto con la firma asistida y la del relator, que no le tocan. "Actividades" tiene 427 líneas y mezcla planificar el mes (prevencionista) con firmar la asistencia (trabajador).
2. **Las páginas de rol son delgadas** (23 a 33 líneas). Describen el rol, pero no llevan a las tareas que le tocan.
3. **Dos páginas incumplen las reglas de redacción.** `ds44/index.md` ("El DS 44 se apoya en el ciclo Planificar → Hacer → Verificar → Actuar") y `ds44/fases-obra.md` ("la plataforma ordena los requisitos en las cuatro fases de ese ciclo") presentan ese ciclo como estructura del decreto. Además, el foco declarado es el DS 44 completo y no el FUF.
4. **Jerga:** "Tenants" (en 11 páginas), "Dashboard", "Onboarding".
5. **Falta lo nuevo:**
   - El menú de ayuda, los recorridos y las novedades.
   - "Mis datos y privacidad", el autoservicio del titular: `modulos/datos-personales` cubre solo el lado de la empresa.

---

## 2. Propuesta: por tarea, con una entrada por rol

Seis secciones. Las cuatro primeras se ordenan por **lo que la persona quiere hacer**; la quinta lleva a esas tareas **según el rol**; la sexta es la **referencia normativa**, separada del "cómo se hace". Cada página de tarea dice al comienzo quién la puede hacer, por permiso y no por nombre de rol.

| Sección (nav) | Para quién | Página nueva | Sale de |
|---|---|---|---|
| **Empezar** | Todos | `empezar` — Qué es Build & Serve y qué no hace | `guia-inicio/index` + "Cómo lo resuelve" de `ds44/index` |
| | | `empezar/ingresar` — Primer ingreso, contraseña, PIN y recuperar el acceso | `guia-inicio/instalacion` |
| | | `empezar/elegir-obra` — Elegir obra o vista de empresa, el menú y la pantalla de Inicio | `guia-inicio/primeros-pasos` + `modulos/dashboard` |
| | | `empezar/ayuda` — **Nueva:** el botón de ayuda, los recorridos guiados y las novedades | — |
| | | `empezar/mi-cuenta` — Contraseña, PIN, cerrar sesión, cambiar de obra | `modulos/configuracion` |
| **En terreno** | Todos | `terreno/firmar` — Firmar lo que te asignaron | Mis firmas y "Sin conexión" de `modulos/firmas`; partes de `ds44/firmas-digitales` |
| | | `terreno/encuestas` — Responder una encuesta y la Ficha Básica de Salud | "Responder" y "Ficha" de `modulos/encuestas` |
| | | `terreno/reportar` — Reportar un hallazgo o un incidente, y en qué se diferencian | "Reportar" de `modulos/incidentes` |
| | | `terreno/avisos` — Tus avisos y mensajes | `modulos/bandeja-entrada` |
| | | `terreno/mis-datos` — **Nueva:** tus datos, tus consentimientos y tus solicitudes | — (pantalla `/mis-datos`, D-29 y D-30) |
| **En la obra** | Prevención, supervisión y jefatura, por permiso | `obra/cumplimiento` — Seguir el cumplimiento del FUF en la obra | `ds44/fases-obra` + la ficha de `modulos/obras` |
| | | `obra/actividades` — Programar charlas y capacitaciones, y planificar el mes | Primera mitad de `modulos/actividades` |
| | | `obra/asistencia` — Registrar asistencia y ausencias, y cerrar la actividad | Segunda mitad de `modulos/actividades` |
| | | `obra/pedir-firmas` — Pedir firmas, firma asistida y firma del relator | `modulos/firmas` + `SignatureRequests` |
| | | `obra/documentos` — Subir, versionar y difundir documentos | `modulos/documentos` + el "cómo" de `ds44/documentos-obligatorios` |
| | | `obra/epp` — Registrar y validar entregas de EPP | `ds44/epp` + "EPP" de `modulos/personas` |
| | | `obra/equipo` — Sumar personas a la obra y su incorporación por cargo | "Equipo" de `modulos/personas` + `modulos/onboarding-cargos` (la parte de obra) |
| | | `obra/incidentes` — Revisar, calificar e investigar incidentes | Listado y estadísticas de `modulos/incidentes` |
| | | `obra/prescripciones` — Prescripciones | `modulos/prescripciones` |
| | | `obra/estructura` — Comité paritario y delegados | `modulos/estructura-preventiva` |
| | | `obra/encuestas` — Crear encuestas y revisar resultados | "Crear" y "Resultados" de `modulos/encuestas` |
| **Empresa** | Administración y lo delegado | `empresa` — Mi empresa: identidad | "Identidad" de `modulos/tenants` |
| | | `empresa/roles` — Roles y permisos | "Roles" de `modulos/tenants` + `roles/index` |
| | | `empresa/personas` — Agregar personas, carga masiva, ficha, restablecer PIN, desvincular | `modulos/personas` |
| | | `empresa/obras` — Crear y administrar obras | `modulos/obras` |
| | | `empresa/cargos` — Cargos, kits de incorporación y catálogos (actividades y EPP) | `modulos/onboarding-cargos` + `modulos/catalogos` + "Cargos" y "EPP" de `modulos/tenants` |
| | | `empresa/salud` — Ficha Básica de Salud | "Ficha de salud" de `modulos/tenants` |
| | | `empresa/datos-personales` — Solicitudes de los titulares y supresiones | `modulos/datos-personales` |
| | | `empresa/alta` — Activar una empresa nueva | `guia-inicio/onboarding` |
| **Por rol** | Todos | `roles` — Cómo funcionan los roles (los configura cada empresa) | `roles/index` |
| | | `roles/trabajador`, `roles/supervisor`, `roles/prevencionista`, `roles/jefe-obra`, `roles/administrador` | Las páginas actuales, reescritas como **lista de tareas con enlace** ("Lo que te toca: firmar → …, reportar → …") |
| **FUF y DS 44** | Todos | `fuf` — Qué cubre el sistema del FUF, qué no y cómo se fiscaliza | `ds44/index`, reescrito |
| | | `fuf/requisitos` — Qué documentos y registros pide el FUF y dónde ver qué falta | El "qué pide" de `ds44/documentos-obligatorios` |
| | | `fuf/capacitaciones` — Art. 16: duración, evaluación y acta | `ds44/capacitaciones` |
| | | `fuf/firmas` — Qué registra cada firma y en qué está la validez del PIN | `ds44/firmas-digitales` |

**Portada del manual:** dos entradas, "¿Qué quieres hacer?" (las tareas más frecuentes) y "Soy…" (los cinco roles), más el buscador.

**Total:** 39 páginas contra 33. Sube porque se parten las dos más largas (`actividades`, `firmas`), se separa el lado del trabajador del lado de la gestión en encuestas e incidentes, y se agregan las dos nuevas. Casi todo el contenido se **mueve y se reordena**; lo que se escribe desde cero es poco: `empezar/ayuda`, `terreno/mis-datos`, las páginas de rol y `fuf`.

---

## 3. Reglas de redacción que se aplican al mover

- **Planificar, Hacer, Verificar, Actuar** queda como un esquema propio del sistema para ordenar los requisitos de la obra ("La plataforma ordena…"), nunca como "el ciclo en que se apoya el DS 44".
- **El foco es el FUF**, no el DS 44 completo. Ninguna página afirma que el sistema garantice el cumplimiento.
- **El sistema registra y custodia; no valida el contenido de los documentos** que sube la persona. "Validar una entrega de EPP" se mantiene, porque lo hace una persona, y se dice así.
- **Validez del PIN:** se describe sin afirmarla, como hoy.
- **Sin "Tenants", "Dashboard" ni "Onboarding"** en el texto: "tu empresa", "Inicio", "incorporación".
- Frases cortas, tuteo.

---

## 4. Integración con la ayuda y los recorridos

- **La ayuda de cada pantalla abre su tarea.** `PANTALLAS[…].manual` en `src/ayuda/registro.ts` pasa a las páginas nuevas. Hoy `/my-signatures` abre "Módulos → Firmas"; con esto abre `terreno/firmar`. El verificador del build ya falla si una pantalla apunta a una página que no existe.
- **Las direcciones viejas siguen funcionando.** Un mapa de las 33 rutas viejas a las nuevas, con redirección dentro del manual: hay enlaces viejos en la app, en correos y en marcadores. Una prueba exige que cada página vieja tenga destino.
- **"Ver recorrido" desde el manual:** un enlace `[Ver recorrido](recorrido:<id>)` en el markdown.
  - Con sesión, y si el recorrido está publicado y la persona lo puede ver, lleva a la pantalla y lo lanza.
  - Sin sesión (el manual es público) o sin el recorrido disponible, no se muestra.
  - El verificador comprueba que el id exista.
  - Hace falta que el proveedor acepte `?recorrido=<id>` también sin `previa=1`. Es un cambio solo del frontend.
- **"Leer más" desde los recorridos:** ya existe (`manual` en cada paso). Pasa a apuntar a las páginas nuevas.
- **Sin conexión:** el manual ya entra en el precaché. Se agrega una prueba de Playwright sobre el build: abrir el manual, cortar la red y navegar entre páginas.

**Recursos del backend:** ninguno. Todo es frontend.

---

## 5. Preguntas

1. **¿Apruebas la estructura** (seis secciones, 39 páginas)? Cualquier ajuste de nombres o de dónde va cada página, mejor ahora.
2. **¿Se quita el índice por módulo?** Propongo que sí. Quien llega desde una pantalla ya cae en su página por el botón de ayuda, y el buscador encuentra los nombres de módulo. Mantenerlo duplica la navegación.
3. **Benja hizo la revisión de octubre y las capturas.** ¿Revisa él el contenido antes de que llegue a `pruebas`? Las capturas se reutilizan; `empezar/ayuda` y `terreno/mis-datos` necesitan capturas nuevas que puedo dejar marcadas para él.
4. **Sección FUF y DS 44:** ¿la revisa alguien con criterio normativo antes de publicar?
5. **Fuera del manual:** la firma sin conexión con vales (D-3) está en el hook y en la API, pero **ninguna pantalla pide vales** (`habilitarSinConexion` y `emitirVales` no se llaman desde ninguna parte). Sin vales no se puede firmar sin red. El manual dice hoy, con razón, que firmar requiere conexión, y así lo dejaría. Que exista o no la pantalla para pedir vales es una decisión de producto aparte.
