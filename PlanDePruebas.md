# Plan de Pruebas — Build and Serve

Checklist de pruebas manuales de punta a punta. Cubre todas las pantallas enrutadas en `Frontend/src/App.tsx`, todas las acciones visibles en ellas (botones, menús, paneles), los procesos automáticos del backend y los endpoints que hoy no tienen pantalla.

Cada caso es una historia de usuario con sus criterios de aceptación. Marca `[x]` el caso cuando **todos** sus criterios se cumplan; si alguno falla, deja el caso sin marcar y anota el hallazgo al final.

## Preparación

- **Ambiente:** `dev`, sembrado con `Backend/scripts/sembrar-demo-dev.js`, o una empresa desechable creada con `Backend/scripts/e2e/empresa-desechable.js`.
- **Cuentas, una por rol:** `admin`, `jefe_obra`, `prevencionista`, `supervisor` y `trabajador`. Además, una segunda empresa para las pruebas de aislamiento.
- **Archivos de prueba:**
  - un PDF de menos de 10 MB, con texto (para la lectura en voz alta);
  - un PDF escaneado, sin texto;
  - un PDF de más de 10 MB;
  - una imagen JPG/PNG, un .docx y un .xlsx;
  - un archivo no permitido (`.zip` o `.exe`);
  - la plantilla Excel de carga masiva, llenada con filas válidas, con advertencias y con errores;
  - un audio corto (para la transcripción).
- **PIN de firma:** 4 dígitos.
- **Dispositivos:** escritorio y un celular Android real (para firmar sin conexión).

**Leyenda de roles:** `[A]` admin · `[J]` jefe de obra · `[P]` prevencionista · `[S]` supervisor · `[T]` trabajador · `[Todos]`.

---
1. Activación de empresa
## 1. Activación de empresa

- [x] **1.1** `[Interno]` Como desarrollador quiero emitir una licencia para una empresa nueva, para validar que el enlace de activación se genera.
  - [x] `Backend/scripts/emitir-licencia.js` entrega un enlace `/onboarding?token=…`.
  - [x] El enlace abre el asistente de activación.

- [ ] **1.2** `[Nuevo admin]` Como desarrollador quiero completar el asistente de activación, para validar el alta de punta a punta.
  - [x] El asistente muestra los pasos **Empresa → Identidad → Tus datos → Acceso**, con un indicador del paso en curso.
  - [x] **Empresa:** valida la razón social y el RUT; con un RUT inválido no deja continuar.
  - [x] **Identidad:** permite subir el logo y elegir el color principal, con la paleta o con "Elegir otro color".
  - [x] **Tus datos:** pide los datos del administrador.
  - [x] **Acceso:** la contraseña muestra sus requisitos en vivo ("Una letra", "Un número", "Coinciden"); el botón de mostrar u ocultar funciona en los dos campos.
  - [x] "Volver" regresa al paso anterior sin perder lo escrito.
  - [x] "Crear empresa" muestra la pantalla "Empresa creada"; "Ir al inicio de sesión" permite entrar con el administrador recién creado.
  - [ ] Al entrar, la interfaz ya usa el logo y el color de la empresa.

- [x] **1.3** Como desarrollador quiero abrir un enlace de licencia vencido, inválido o ya usado, para comprobar que se rechaza.
  - [x] Aparece "Enlace inválido o vencido" y no se crea ninguna empresa.
  - [x] "¿Ya tienes cuenta? Inicia sesión" lleva a `/login`.

- [x] **1.4** `[Interno]` Como desarrollador quiero crear y borrar una empresa por script, para validar las herramientas internas.
  - [x] `crear-empresa.js` deja una empresa operativa.
  - [x] `borrar-empresa.js` elimina sus datos sin tocar los de otras empresas.

---

## 2. Inicio de sesión, contraseña y sesión

- [x] **2.1** `[Todos]` Como desarrollador quiero iniciar sesión con credenciales válidas, para validar el acceso.
  - [x] Con RUT o correo y contraseña correctos, "Ingresar" entra a la plataforma.
  - [x] El ojo de la contraseña la muestra y la oculta.
  - [x] Si la persona pertenece a varias empresas, ve la lista para elegir una; "Volver" regresa al formulario.
  - [x] Después del ingreso llega a `/seleccionar-obra`, o directo al inicio si corresponde.

- [x] **2.2** Como desarrollador quiero iniciar sesión con credenciales incorrectas, para comprobar el rechazo.
  - [x] El mensaje de error es genérico: no revela si el usuario existe.
  - [x] El intento fallido queda en la auditoría (ver 16.8).
  - [x] Después de muchos intentos seguidos, la API responde 429.

- [ ] **2.3** Como desarrollador quiero recuperar mi contraseña, para validar "¿Olvidaste tu contraseña?".
  - [x] `/recuperar-clave` acepta el correo y muestra una confirmación neutra, exista o no la cuenta.
  - [x] Llega un correo con el enlace a `/restablecer-clave`.
  - [ ] La nueva contraseña debe cumplir los requisitos; los ojos de mostrar y ocultar funcionan.
  - [ ] Después del cambio se entra con la clave nueva y la anterior deja de funcionar.
  - [x] Un enlace vencido o ya usado ofrece "Solicitar nuevo enlace".
  - [x] "Volver al inicio de sesión" funciona.

- [ ] **2.4** `[Todos]` Como desarrollador quiero cambiar mi contraseña desde mi perfil, para validar el cambio con sesión iniciada.
  - [ ] **Configuración → Cambiar contraseña** abre `/change-password`.
  - [ ] Pide la contraseña actual y la nueva, con los requisitos en vivo.
  - [ ] La pantalla explica "Qué pasa al cambiarla".
  - [ ] "Cancelar" vuelve a Configuración sin cambiar nada.
  - [ ] Después de guardar, las demás sesiones abiertas de la misma persona se cierran.

- [ ] **2.5** `[Persona nueva]` Como desarrollador quiero entrar con una credencial provisional, para comprobar el primer ingreso obligatorio.
  - [ ] En el primer ingreso se obliga a cambiar la contraseña; se ven los "Pasos de tu primer ingreso".
  - [ ] No se puede navegar a otras pantallas antes de terminar.
  - [ ] "Cerrar sesión" desde esa pantalla funciona.

- [ ] **2.6** `[Todos]` Como desarrollador quiero cerrar sesión, para validar que el token se invalida.
  - [ ] Funciona desde el menú del perfil, en el sidebar.
  - [ ] Después, cualquier ruta protegida redirige a `/login`.
  - [ ] Si se reutiliza el token anterior contra la API, la respuesta es 401.

- [ ] **2.7** `[T]` Como desarrollador quiero entrar a una ruta para la que no tengo permiso, para comprobar la protección de rutas.
  - [ ] `/mi-empresa`, `/personas`, `/obras/nueva`, `/firmas/revision` y `/cargos-onboarding` llevan a `/unauthorized`.
  - [ ] "Volver al Dashboard" regresa al inicio.
  - [ ] El sidebar solo muestra las entradas que permite el rol.
  - [ ] Las rutas antiguas `/workers`, `/users` y `/settings` redirigen a `/personas` y `/configuracion`; una ruta inexistente redirige a `/`.

- [ ] **2.8** `[Todos]` Como desarrollador quiero dejar la sesión inactiva hasta que venza el token, para validar la expiración.
  - [ ] La siguiente acción lleva a `/login` sin dejar la pantalla rota.

---

## 3. Primer ingreso: enrolamiento, PIN y foto

- [x] **3.1** `[T]` Como desarrollador quiero completar mi enrolamiento (`/enroll-me`), para habilitar la firma.
  - [x] "Comenzar" lleva a crear el PIN de 4 dígitos; se pide confirmarlo.
  - [x] El botón de mostrar u ocultar el PIN funciona.
  - [x] Si los dos PIN no coinciden, aparece "Elegir otro PIN".
  - [x] Se puede subir una foto de perfil, quitarla o elegir otra.
  - [x] "Guardar y terminar" guarda el perfil; "Omitir por ahora" continúa sin foto.
  - [x] "Cerrar sesión" funciona en cualquier paso.

- [ ] **3.2** `[J][P]` Como desarrollador quiero enrolar a un trabajador en terreno (`/workers/enroll`), para validar el alta asistida.
  - [ ] Se completan los datos y el trabajador crea su PIN en el equipo del supervisor.
  - [ ] "Crear otro PIN" y "Volver" funcionan.
  - [ ] "Ver Trabajadores" lleva a `/personas`.

---

## 4. Perfil y configuración personal

- [ ] **4.1** `[Todos]` Como desarrollador quiero abrir mi perfil desde el sidebar, para validar el acceso.
  - [ ] El avatar del sidebar (foto o iniciales) abre el menú con "Configurar mi perfil", "Cambiar de obra" y "Cerrar sesión".
  - [ ] "Configurar mi perfil" abre `/configuracion`.

- [ ] **4.2** `[Todos]` Como desarrollador quiero cambiar mi foto de perfil, para validar la identidad visual.
  - [ ] En `/configuracion` se puede elegir una foto nueva; muestra que está guardando y luego confirma.
  - [ ] La foto nueva aparece de inmediato en el sidebar y en el panel de identidad.
  - [ ] "Quitar" elimina la foto y vuelven a mostrarse las iniciales.
  - [ ] La foto se mantiene al recargar y en otro dispositivo.

- [ ] **4.3** `[Todos]` Como desarrollador quiero editar mis datos personales, para validar la edición del perfil.
  - [ ] "Editar" habilita el campo de correo; la fecha de nacimiento se muestra pero la mantiene la empresa.
  - [ ] El RUT, el cargo y el rol se muestran pero no se pueden editar.
  - [ ] Mientras se edita aparece "Edición en curso", con la cantidad de campos modificados.
  - [ ] "Cancelar" descarta los cambios; "Guardar" los conserva al recargar.
  - [ ] Un correo o un teléfono inválido muestra un error y no se guarda.
  - [ ] Si se corta la conexión al guardar, aparece "Error de conexión al guardar." y no se pierde lo escrito.

- [ ] **4.4** `[Todos]` Como desarrollador quiero cambiar mi PIN de firma, para validar el reemplazo del PIN.
  - [ ] "Cambiar PIN de firma" pide confirmación y lleva a crear un PIN nuevo.
  - [ ] Después, el PIN anterior ya no sirve para firmar y el nuevo sí.

- [ ] **4.5** `[Todos]` Como desarrollador quiero ir a "Mis datos y privacidad" desde Configuración, para validar el enlace (contenido en la sección 17).

- [ ] **4.6** `[Todos]` Como desarrollador quiero cambiar entre modo claro y oscuro, para validar el tema.
  - [ ] El botón de luna o sol del encabezado cambia el tema.
  - [ ] El tema se mantiene al recargar.
  - [ ] Todas las pantallas se leen bien en los dos modos, logo incluido (versión clara y oscura).

---

## 5. Navegación, selección de obra e inicio

- [ ] **5.1** `[J][P][S]` Como desarrollador quiero elegir una obra después de iniciar sesión, para validar el contexto de obra.
  - [ ] `/seleccionar-obra` lista solo las obras a las que tengo acceso; el buscador "Buscar obra" filtra la lista.
  - [ ] Al elegir una obra, el encabezado muestra "Estás trabajando en: …" y el sidebar muestra "Detalle de obra", Repositorio, Actividades, etc.
  - [ ] "Gestionar la empresa" (solo con `empresa.ver`) entra en modo empresa: el sidebar muestra Obras, Personas, Mi Empresa, Onboarding y Catálogos.
  - [ ] Si la lista falla, aparece "Volver a intentar".
  - [ ] "Cerrar sesión" funciona desde esta pantalla.
  - [ ] La obra elegida se mantiene al recargar.

- [ ] **5.2** `[J][P][S]` Como desarrollador quiero cambiar de obra sin cerrar sesión, para validar el cambio de contexto.
  - [ ] **Perfil → Cambiar de obra** vuelve al selector.
  - [ ] Al elegir otra obra se actualizan actividades, repositorio, incidentes y DS44.

- [ ] **5.3** `[T][S]` Como desarrollador quiero ver mi inicio en terreno, para validar el panel personal.
  - [ ] Saluda con "Hola, {nombre}" y muestra "Accesos rápidos", "Tus pendientes" y "Tu día".
  - [ ] "Tus pendientes" muestra firmas, encuestas y actividades pendientes; "Ver todos tus pendientes" lleva a cada módulo.
  - [ ] El resumen de firmas lleva al "Centro de firmas" (`/my-signatures`).

- [ ] **5.4** `[A]` Como desarrollador quiero ver el panorama de la empresa (inicio en modo empresa), para validar los indicadores consolidados.
  - [ ] Se muestran los bloques "Brechas que se repiten", "Cumplimiento por obra", "Por vencer", "Reposiciones de EPP", "Siniestralidad", "Cumple y accidenta" y "Medidas prescritas vencidas".
  - [ ] Hacer clic en una obra abre su detalle.
  - [ ] "Actualizar" recarga los datos.
  - [ ] Las cifras coinciden con las de cada obra.

- [ ] **5.5** `[Todos]` Como desarrollador quiero usar la pantalla "Crear" (`/crear`), para validar los atajos.
  - [ ] Las tarjetas Documento, Actividad, Encuesta e Incidente llevan a `/signature-requests`, `/activities`, `/surveys` e `/incidents`.

- [ ] **5.6** `[Todos]` Como desarrollador quiero navegar con las migas de pan y el logo, para validar la navegación global.
  - [ ] Las migas de pan muestran la ruta actual y cada tramo es clicable.
  - [ ] El logo lleva al inicio.
  - [ ] En el celular, el botón de menú abre y cierra el sidebar.

- [ ] **5.7** `[Todos]` Como desarrollador quiero ver la campana de notificaciones, para validar el contador.
  - [ ] Muestra la cantidad sin leer y se actualiza al leer mensajes; al hacer clic abre la bandeja.

- [ ] **5.8** `[Todos]` Como desarrollador quiero ver el contador de firmas pendientes en el sidebar, para validar que coincide.
  - [ ] El número es igual al de "Mis firmas → Pendientes" y se actualiza solo (cada minuto).

---

## 6. Ayuda: qué hace cada pantalla

- [ ] **6.1** `[Todos]` Como desarrollador quiero abrir el menú de ayuda de cualquier pantalla, para saber qué hace la interfaz.
  - [ ] El botón "Ayuda de esta pantalla" del encabezado abre un panel con los recorridos de esa pantalla, su página del manual y las novedades.
  - [ ] Cada recorrido muestra su estado: Visto, Omitido o Pendiente.
  - [ ] El panel se cierra con Escape o al hacer clic fuera.

- [ ] **6.2** `[Todos]` Como desarrollador quiero ver los recorridos obligatorios la primera vez, para validar el acompañamiento inicial.
  - [ ] Se lanzan solos según el rol: `inicio-terreno` (sin `obras.ver`), `inicio-gestion` (con obra, sin `empresa.ver`), `inicio-empresa` (con `empresa.ver`) y `mis-firmas` (todos).
  - [ ] Cada paso resalta el elemento correcto de la pantalla y se puede avanzar, retroceder y omitir.
  - [ ] Al terminar u omitir no vuelve a aparecer, tampoco en otro dispositivo (el progreso se guarda en `/ayuda/progreso`).

- [ ] **6.3** `[Según permiso]` Como desarrollador quiero lanzar cada recorrido opcional desde el menú de ayuda, para validar que todos funcionan.
  - [ ] `cambiar-de-obra` (inicio) · `programar-actividades` (actividades) · `subir-documentos` y `encontrar-documentos` (repositorio) · `cumplimiento-obra` (detalle de obra) · `reportar` (reportar incidente) · `gestionar-incidentes` (incidentes).
  - [ ] Ningún paso apunta a un elemento que no existe; si falta, el recorrido no se rompe.
  - [ ] Cada recorrido solo se ofrece a quien tiene el permiso indicado (`npm run recorridos:listar`).
  - [ ] `?recorrido=<id>&previa=1` muestra la vista previa sin guardar progreso.

- [ ] **6.4** `[Todos]` Como desarrollador quiero consultar el manual de uso (`/manual`), para validar la documentación.
  - [ ] Se abre desde el pie ("Manual de uso") y desde el menú de ayuda, en la página que corresponde a la pantalla.
  - [ ] "Mi rol" filtra el contenido según mi rol; "Todo el manual" lo muestra entero.
  - [ ] El buscador encuentra secciones y salta al ancla correcta.
  - [ ] El índice "En esta página" y el menú de secciones (también en el celular) funcionan.
  - [ ] Las imágenes cargan.
  - [ ] "Volver a la aplicación" regresa a la pantalla de origen.
  - [ ] Las secciones Empezar, Empresa, FUF, Obra, Roles y Terreno cargan; los atajos "Qué hago según mi rol", "Firmas" y "Ver mis tareas" funcionan.

- [ ] **6.5** `[Todos]` Como desarrollador quiero abrir "Preguntas frecuentes", "Acerca de" (`/about`) y "Equipo" (`/equipo`) desde el pie, para validar las páginas informativas.
  - [ ] Cada una carga.
  - [ ] "Ir a la plataforma" y "← Volver a la plataforma" funcionan.
  - [ ] Los enlaces externos (LinkedIn) se abren en una pestaña nueva.

- [ ] **6.6** `[Todos]` Como desarrollador quiero enviar una sugerencia, para validar el widget.
  - [ ] "Déjanos tu sugerencia" abre el formulario.
  - [ ] "Cancelar" y la X lo cierran sin enviar.
  - [ ] Enviar muestra una confirmación y el registro queda en `/suggestions`.

---

## 7. Obras

- [ ] **7.1** `[A][J]` Como desarrollador quiero crear una obra, para validar el alta.
  - [ ] "Nueva obra" abre `/obras/nueva` con nombre, código, empresa mandante, dirección, región, comuna y estado.
  - [ ] Al elegir una dirección del autocompletado se llenan la región y la comuna ("De esa dirección se tomó…").
  - [ ] Se pueden asignar trabajadores con el buscador; sin coincidencias aparece "Nadie calza con esa búsqueda."
  - [ ] Faltando un campo obligatorio no deja guardar; "Cancelar" vuelve a `/obras`.
  - [ ] La obra nueva aparece en `/obras` y en el selector de obras.

- [ ] **7.2** `[A][J][P][S]` Como desarrollador quiero ver el listado de obras, para validar la navegación.
  - [ ] Cada tarjeta abre el detalle de su obra.
  - [ ] Sin `obras.crear`, el botón "Nueva obra" no aparece.

- [ ] **7.3** `[A][J]` Como desarrollador quiero editar una obra, para validar la edición y sus restricciones.
  - [ ] "Editar obra" en la cabecera abre el modal "Solo puedes editar nombre, etapa y estado".
  - [ ] El estado se puede cambiar a Activa, Pausada o Finalizada, y el cambio se refleja en la cabecera y en el listado.
  - [ ] "Cancelar" descarta los cambios.
  - [ ] Cada cambio queda en "Historial de cambios" con autor y fecha.
  - [ ] Una obra Finalizada o Pausada se distingue en el selector de obras.

- [ ] **7.4** `[A][J]` Como desarrollador quiero cambiar la foto de la obra, para validar la imagen de cabecera.
  - [ ] Sin foto aparece "Sin foto de la obra"; al elegir una imagen se guarda y se ve al recargar.

- [ ] **7.5** `[J][P][S]` Como desarrollador quiero revisar la pestaña **Resumen** de la obra, para validar la ficha.
  - [ ] Se ven Identificación, Ubicación, Dotación y Condiciones de la faena.
  - [ ] "Copiar código de la obra" lo copia al portapapeles y confirma.
  - [ ] "Abrir en el mapa" abre la ubicación correcta.
  - [ ] En **Condiciones de la faena**, responder Sí o No a cada condición se guarda y cambia los requisitos DS44 que aplican.
  - [ ] Los accesos "Documentos de la obra", "Equipo · activos" e "Incidentes · N abiertos" llevan a su módulo, filtrado por la obra.

- [ ] **7.6** `[J][S]` Como desarrollador quiero gestionar el equipo de la obra, para validar la asignación de personas.
  - [ ] Las vistas Lista y Cuadrícula muestran a las mismas personas.
  - [ ] "Agregar" busca entre las "Personas de la empresa"; "Agregar seleccionados (N)" las suma con los cargos marcados.
  - [ ] "Guardar" en una persona guarda sus cargos en la obra.
  - [ ] "Dar de baja" pide confirmación y saca a la persona del equipo sin borrar su historial; "Reactivar" la devuelve.
  - [ ] "Ver ficha" abre su ficha de persona.
  - [ ] Asignar un cargo genera los "Documentos de onboarding generados" del kit DS44 de ese cargo.

- [ ] **7.7** `[J][S]` Como desarrollador quiero armar cuadrillas, para validar la relación supervisor → trabajadores.
  - [ ] Existen los grupos "Equipo de gestión", "Cuadrilla · {supervisor}" y "Sin cuadrilla".
  - [ ] "Agregar personas" en una cuadrilla abre el panel con buscador, grupos y "Mostrar".
  - [ ] Se puede seleccionar a varias personas y moverlas en lote a otra cuadrilla con "Mover".
  - [ ] Transferir a un trabajador a otro supervisor u obra pide confirmación y se refleja en ambos lados.
  - [ ] Un supervisor solo ve a su cuadrilla en las pantallas que filtran por supervisor.

- [ ] **7.8** `[J][P]` Como desarrollador quiero asignar una encuesta a la obra desde el panel de equipo, para validar "Asignar encuesta".
  - [ ] La encuesta les llega a las personas de la obra (ver sección 13).

- [ ] **7.9** `[A][J][P]` Como desarrollador quiero revisar la aplicabilidad del kit DS44 por cargo, para validar el cálculo de requisitos.
  - [ ] Al abrir cada cargo se ven los requisitos que aplican.
  - [ ] Cambiar la aplicabilidad se guarda en la obra.

- [ ] **7.10** `[A][J]` Como desarrollador quiero gestionar las plantillas de onboarding de la obra, para validar las plantillas por cargo.
  - [ ] "Ver plantilla" la previsualiza; "Quitar plantilla" la elimina y vuelve a usarse la de la empresa.

---

## 8. Cumplimiento DS44 (pestaña "Cumplimiento DS 44" de la obra)

- [ ] **8.1** `[J][P][S]` Como desarrollador quiero navegar las fases del DS 44, para validar el ciclo Planificar → Hacer → Verificar → Actuar.
  - [ ] Cada fase muestra su porcentaje de completados y la barra "Avance del DS 44".
  - [ ] El filtro por estado muestra solo los requisitos pendientes, completos, etc.
  - [ ] Al completar Planificar aparece "Planificar quedó completa — La obra pasa a la fase Hacer" y la fase actual avanza.
  - [ ] Se puede revisar una fase pasada sin cambiar la fase actual.

- [ ] **8.2** `[J][P]` Como desarrollador quiero subir un documento al cumplimiento DS44, para validar que funciona correctamente.
  - [ ] "Cargar" en un requisito pendiente abre el panel "Sube el archivo, selecciona firmantes y define caducidad".
  - [ ] El archivo se puede adjuntar con clic o arrastrando; "Cambiar" lo reemplaza antes de guardar.
  - [ ] La fecha del hecho viene con la fecha de hoy (hora de Chile) y se puede cambiar.
  - [ ] La caducidad tiene atajos (3 meses, 6 meses, 1 año, 2 años), fecha libre o sin caducidad.
  - [ ] Los firmantes se eligen con buscador y "seleccionar todos"; en una capacitación el rótulo dice "Asistentes (firman el registro)".
  - [ ] Al guardar, el requisito pasa a "pendiente de firmas" (o a completo, si no requiere firmas) y sube el avance.
  - [ ] El documento aparece en **Repositorio → DS44 · Cumplimiento**.
  - [ ] Los firmantes lo reciben en **Mis firmas → Pendientes** y en la bandeja.

- [ ] **8.3** `[J][P]` Como desarrollador quiero subir archivos no válidos al DS44, para comprobar las validaciones.
  - [ ] Un archivo de más de 10 MB se rechaza **antes** de subirlo, con un mensaje claro.
  - [ ] Un tipo no permitido (distinto de PDF, imagen, Word o Excel) se rechaza.
  - [ ] Sin `obra.subir_documentos` no aparece "Cargar".

- [ ] **8.4** `[J][P]` Como desarrollador quiero elegir firmantes para un documento ya cargado, para validar el modo "Firmantes".
  - [ ] "Firmantes" abre el panel sin pedir archivo; los elegidos reciben su solicitud.

- [ ] **8.5** `[J][P]` Como desarrollador quiero volver a subir un documento (publicar una nueva versión), para validar el reemplazo de evidencia.
  - [ ] "Nueva versión" o "Publicar nueva versión" abre el panel con archivo, caducidad, revisión, participantes de la revisión y firmantes.
  - [ ] Después de "Publicar vN", el número de versión sube y la vigente es la nueva.
  - [ ] La versión anterior queda en el historial con "Ver" y "Descargar".
  - [ ] Las firmas de la versión anterior no pasan a la nueva; los firmantes vuelven a quedar pendientes.
  - [ ] Si se escucha la versión nueva (ver 9.3), se lee su contenido y no el de la anterior.

- [ ] **8.6** `[J][P][S]` Como desarrollador quiero ver el documento cargado de un requisito, para validar la evidencia.
  - [ ] "Ver documento cargado" o "Ver" abre el visor (ver 9.2).

- [ ] **8.7** `[J][P]` Como desarrollador quiero solicitar o recordar firmas, para validar los recordatorios.
  - [ ] Se puede pedir la firma a una persona o a todas las que faltan.
  - [ ] "Recordar a quienes no han firmado" notifica solo a las pendientes y deja constancia.

- [ ] **8.8** `[J][P]` Como desarrollador quiero registrar el envío de un documento, para validar las constancias de envío.
  - [ ] "Registrar" o "Registrar envío" guarda la constancia, que queda visible en "Constancias de envío".

- [ ] **8.9** `[J][P]` Como desarrollador quiero responder Sí o No a las declaraciones de un requisito, para validar que el requisito cambia.
  - [ ] Responder "No" lo marca como no aplicable; responder "Sí" lo vuelve exigible.

- [ ] **8.10** `[J][P]` Como desarrollador quiero programar una actividad desde un requisito, para validar "Programar".
  - [ ] Abre la creación de la actividad con el tipo ya elegido; al completarla, el requisito avanza.

- [ ] **8.11** `[J][P][S]` Como desarrollador quiero ir al módulo de origen de un requisito, para validar "Ir al módulo".
  - [ ] Lleva al módulo que corresponde: actividades, incidentes, personas, estructura o representante.

- [ ] **8.12** `[A]` Como desarrollador quiero completar un requisito que exige el representante legal, para validar la designación.
  - [ ] Sin representante designado aparece "Designar", que lleva a **Mi Empresa → Identidad**.
  - [ ] Después de designarlo, el representante recibe la solicitud de firma.

- [ ] **8.13** `[J][P]` Como desarrollador quiero usar los módulos de cada fase, para validar los paneles internos.
  - [ ] **Registro de actividad preventiva (Art. 72):** muestra las actividades de la obra.
  - [ ] **Onboarding de la obra:** muestra el avance por trabajador.
  - [ ] **Registros de gestión:** cada uno lleva a su módulo ("Ver"); los que no tienen pantalla muestran "Módulo pendiente".
  - [ ] **Eventos sobrevinientes:** "Programar simulacro" crea el "Ensayo anual del plan de emergencias"; "Registrar" sube la evidencia del evento.
  - [ ] **Consolidado del período (Arts. 14, 22.4):** muestra accidentes, tasa de frecuencia e investigaciones (pendientes / cerradas), y cuadra con incidentes.
  - [ ] **Fase Actuar:** se ven las medidas correctivas de los incidentes; avanzar el estado de una medida se guarda.
  - [ ] "Ver incidentes", "Ver investigaciones", "Ver / investigar" y "Ver origen" llevan a `/incidents` filtrado por la obra.

- [ ] **8.14** `[J][P]` Como desarrollador quiero cerrar una investigación desde la obra, para validar "Cerrar investigación (Art. 71)".
  - [ ] Exige los datos obligatorios y deja la investigación cerrada en la obra y en incidentes.

- [ ] **8.15** `[J][P]` Como desarrollador quiero exportar y firmar el Registro AT/EP, para validar el registro de accidentes.
  - [ ] "Exportar y Firmar" genera el registro, pide la firma con PIN y deja el documento firmado.

- [ ] **8.16** `[J][P]` Como desarrollador quiero abrir el expediente de la obra y el check consolidado, para validar los reportes.
  - [ ] El expediente se abre con todos los documentos.
  - [ ] El check consolidado muestra el estado de cada ítem.

- [ ] **8.17** `[J][P][S]` Como desarrollador quiero navegar el repositorio DS44 (secciones del FUF), para validar la búsqueda.
  - [ ] "Buscar documento o ítem" y el filtro por estado funcionan.
  - [ ] "Ver detalles" abre el panel del documento: archivo, firmantes ("ver firmantes"), versiones y constancias.
  - [ ] "Ver archivo" y "Descargar archivo" funcionan.

- [ ] **8.18** `[J][P]` Como desarrollador quiero abrir el reporte imprimible del FUF, para validar la exportación.
  - [ ] Se abre en una pestaña nueva con todas las secciones y el estado de cada ítem.
  - [ ] Imprimirlo o guardarlo como PDF se ve bien.

- [ ] **8.19** `[J][P]` Como desarrollador quiero eliminar un documento de la obra, para validar el borrado.
  - [ ] "Eliminar documento" pide confirmación; "Cancelar" no borra nada.
  - [ ] El requisito vuelve a quedar pendiente.

- [ ] **8.20** `[Proceso]` Como desarrollador quiero que un documento venza, para comprobar la caducidad.
  - [ ] Pasada la fecha de caducidad, el requisito vuelve a pendiente o vencido.
  - [ ] Aparece en "Por vencer" del panorama antes de vencer.
  - [ ] La revisión documental programada genera la alerta en la bandeja.

---

## 9. Repositorio de documentos, visor y lectura en voz alta

- [ ] **9.1** `[A][J][P]` Como desarrollador quiero subir un documento al repositorio, para validar la carga general.
  - [ ] "Subir documento" abre el formulario: Tipo de documento, Título, Descripción y Archivo.
  - [ ] Sin un campo obligatorio no deja guardar; "Cancelar" cierra el formulario.
  - [ ] Se puede subir a la empresa, a la obra o a una persona, y el documento aparece en la pestaña correspondiente.
  - [ ] Valen los mismos límites de tamaño y tipo que en 8.3.

- [ ] **9.2** `[Todos]` Como desarrollador quiero previsualizar y descargar un documento, para validar el visor.
  - [ ] "Previsualizar" abre el visor con PDF, imágenes y documentos de Office.
  - [ ] "Descargar" o "Descargar archivo" baja el archivo original con su nombre.
  - [ ] Cerrar el visor con la X o con Escape funciona.

- [ ] **9.3** `[Todos]` Como desarrollador quiero escuchar un documento en voz alta, para validar la lectura accesible.
  - [ ] "Escuchar", en el visor, abre la barra de lectura y empieza a leer solo.
  - [ ] Funcionan reproducir/pausar, "Retroceder 15 segundos", "Adelantar 15 segundos" y la barra de posición.
  - [ ] "Cerrar la lectura en voz alta" la detiene.
  - [ ] Con un PDF escaneado, sin texto, aparece un error claro.
  - [ ] Al cambiar de documento se detiene la lectura anterior y se lee el nuevo.
  - [ ] En el modal de firma la lectura sigue sonando aunque se equivoque el PIN.

- [ ] **9.4** `[J][P]` Como desarrollador quiero volver a subir un documento y escucharlo, para validar que la lectura usa la versión nueva.
  - [ ] Después de publicar una nueva versión (8.5 o 9.7), "Escuchar" lee el texto del archivo nuevo.

- [ ] **9.5** `[Todos]` Como desarrollador quiero buscar y filtrar en el repositorio, para validar la navegación.
  - [ ] Las pestañas son Repositorio general, DS44 · Cumplimiento, Documentos de empresa, de obra y de personas, Registros y actividades, Mis documentos y Otros.
  - [ ] Los alcances Empresa, Esta obra, General y Personal filtran bien.
  - [ ] "Buscar en todo el repositorio…" y "Limpiar búsqueda" funcionan; sin coincidencias aparece "Sin resultados".
  - [ ] Un trabajador solo ve sus documentos asignados.

- [ ] **9.6** `[A][J][P]` Como desarrollador quiero difundir un documento, para validar la distribución.
  - [ ] El panel de distribución pide los destinatarios, la fecha de entrada en vigencia y la vigencia; la vigencia se puede editar.
  - [ ] "Seleccionar archivo" adjunta la evidencia de la difusión; registrar el envío por tipo deja constancia.
  - [ ] Los destinatarios reciben su notificación o solicitud de firma.

- [ ] **9.7** `[A]` Como desarrollador quiero publicar una nueva versión de un documento corporativo (RIOHS, Política SST, procedimientos PR-PO), para validar el versionado a nivel empresa.
  - [ ] La nueva versión pasa a ser la vigente en **todas** las obras y conserva el historial.

- [ ] **9.8** `[A][J][P]` Como desarrollador quiero editar los datos de un documento, para validar la actualización.
  - [ ] Los cambios de título, descripción o asignación quedan guardados.

- [ ] **9.9** `[A][J][P]` Como desarrollador quiero eliminar un documento, para validar el borrado.
  - [ ] Pide confirmación y el documento desaparece del listado.
  - [ ] Revisar qué pasa con un documento que ya tiene firmas (anotar el comportamiento esperado).

---

## 10. Firma electrónica

- [ ] **10.1** `[Todos]` Como desarrollador quiero firmar un documento, para comprobar que la funcionalidad está operativa.
  - [ ] En **Mis firmas → Pendientes** aparece el documento asignado y el sidebar muestra el contador.
  - [ ] "Firmar" abre el modal en pasos: primero **revisar** el documento ("Ver documento / Abrir", "Escuchar") y luego "Continuar a firmar".
  - [ ] "Revisar de nuevo" vuelve al documento.
  - [ ] El teclado del PIN funciona: dígitos, "Borrar último dígito" y mostrar u ocultar.
  - [ ] Con el PIN correcto, la firma se registra y el documento pasa a **Historial**.
  - [ ] El contador del sidebar baja en uno y sube el avance de firmas del requisito DS44.
  - [ ] "Actualizar" recarga la lista; "Ver historial completo" cambia de pestaña.

- [ ] **10.2** `[Todos]` Como desarrollador quiero firmar con un PIN incorrecto, para comprobar el límite de intentos.
  - [ ] Un PIN incorrecto muestra un error y no registra la firma.
  - [ ] El bloqueo es de 1 minuto al 5.º fallo, 5 minutos al 10.º, 15 minutos al 15.º y 60 minutos desde el 20.º.
  - [ ] Durante el bloqueo, ni el PIN correcto permite firmar, y se muestra cuánto falta.

- [ ] **10.3** `[Todos]` Como desarrollador quiero ver el documento firmado, para corroborar que el token aparece correctamente.
  - [ ] En **Historial**, el detalle de la firma muestra "Firma válida", el **Token de verificación**, "Validado con PIN" y la IP.
  - [ ] "Descargar comprobante" genera un PDF con los datos de la firma y el mismo token.
  - [ ] El documento firmado descargado (`/documents/{id}/download-firmado`) incluye la página "Registro de Firmas Digitales": título, total de firmas y, por rol, nombre, RUT, fecha y hora, método y **Token** de cada firmante.
  - [ ] El token del PDF es idéntico al que se ve en pantalla.
  - [ ] `GET /signatures/verify/{token}` responde que la firma es válida e identifica el documento y al firmante.
  - [ ] Un token alterado o inexistente responde que no es válido.
  - [ ] "Cargar más" pagina el historial.

- [ ] **10.4** `[T]` Como desarrollador quiero firmar sin conexión, para validar la firma diferida.
  - [ ] Con red, al escribir el PIN se renuevan solos los vales del turno, sin que se vea nada.
  - [ ] En modo avión, firmar deja la firma guardada en el equipo y avisa que está pendiente de envío.
  - [ ] Al volver la red, el sincronizador la envía solo ("Enviando…", y luego "Entendido") y el documento pasa a Historial.
  - [ ] Si el envío automático falla durante más de 2 minutos con señal, aparece "Enviar ahora".
  - [ ] Sin vales, la firma se hace con el sobre de firma y también se sincroniza.
  - [ ] Un vale alterado o reutilizado es rechazado por el servidor.

- [ ] **10.5** `[J][P]` Como desarrollador quiero revisar firmas sin conexión dudosas, para validar **Firmas en revisión**.
  - [ ] Entran a revisión las firmas cuyo vale venció antes de sincronizar, las que tienen una hora poco creíble y las de personas desvinculadas antes de que llegara la firma.
  - [ ] Cada una muestra la cadena de fechas: emisión y vencimiento del vale, firma en terreno, anulación y llegada.
  - [ ] "Confirmar" la cuenta como cumplimiento; "Rechazar" pide un motivo y la deja revocada, sin borrarla.
  - [ ] Si no hay pendientes, aparece "No hay firmas en revisión".

- [ ] **10.6** `[J][P][S]` Como desarrollador quiero hacer una firma asistida en terreno, para validar que un supervisor puede recoger firmas.
  - [ ] "Firma asistida" o "Firmar asistido", en el equipo de la obra, abre el modal con los documentos pendientes de cada trabajador.
  - [ ] "Abrir documento" lo muestra; "Firmar" pide el PIN **del trabajador**; "Confirmar firma" la registra.
  - [ ] La firma queda a nombre del trabajador, con registro de quién asistió.
  - [ ] El contador "N firmas recogidas" se actualiza; "Volver" y "Cerrar" funcionan.

- [ ] **10.7** `[J][P][S]` Como desarrollador quiero crear una solicitud de firma, para validar `/signature-requests`.
  - [ ] "Nueva solicitud" pide título, descripción, fecha límite (los tres opcionales), documentos y trabajadores.
  - [ ] Se pueden quitar documentos antes de enviar.
  - [ ] Los firmantes la reciben pendiente y en la bandeja.
  - [ ] "Ver detalles" muestra el avance por firmante.
  - [ ] Firmar desde ahí ("Ingresa tu PIN de 4 dígitos" → "Confirmar Firma") funciona.

- [ ] **10.8** `[J][P][S]` Como desarrollador quiero cancelar una solicitud de firma, para validar la anulación.
  - [ ] "Cancelar solicitud" pide confirmación y la quita de los pendientes de los firmantes.

- [ ] **10.9** `[A]` Como desarrollador quiero restablecer el PIN de otra persona, para validar el permiso `persona.restablecer_pin`.
  - [ ] En la ficha de la persona, "Restablecer PIN" borra su PIN; la persona no puede firmar hasta crear uno nuevo.
  - [ ] "Configurar PIN nuevo con … tiene el equipo" deja que el trabajador escriba su PIN en el equipo de otra persona, sin la opción de mostrarlo.
  - [ ] Quien restableció el PIN **no** puede asistir en la configuración del nuevo.
  - [ ] Sin el permiso, la acción no aparece.

---

## 11. Personas

- [ ] **11.1** `[A][J][P][S]` Como desarrollador quiero ver el directorio de personas, para validar el listado.
  - [ ] "Buscar por nombre o RUT…" funciona con y sin puntos ni guion.
  - [ ] Los filtros por rol y por cargo funcionan.
  - [ ] Las vistas Lista y Cuadrícula muestran a las mismas personas; "Cargar más" pagina.
  - [ ] El menú "⋯" de cada fila ofrece "Ver datos", "Ver asignaciones" y "Cumplimiento", y cada opción abre la pestaña correcta.

- [ ] **11.2** `[A][J]` Como desarrollador quiero crear una persona, para validar el alta individual.
  - [ ] `/personas/nueva` pide RUT, nombre, apellido paterno y materno, correo, fecha de nacimiento, cargo, rol, nivel de escolaridad y contacto de emergencia (nombre completo y relación).
  - [ ] El RUT se valida al escribirlo; un RUT inválido o duplicado se rechaza.
  - [ ] Se puede crear sin correo; la persona queda con una credencial provisional.
  - [ ] "Ir a personas" muestra a la persona recién creada; "Cancelar" vuelve al listado.

- [ ] **11.3** `[A][J]` Como desarrollador quiero cargar personas de forma masiva, para validar la carga por planilla.
  - [ ] "Descargar plantilla Excel" baja la plantilla.
  - [ ] Se puede subir el archivo, quitarlo y elegir otro.
  - [ ] La vista previa clasifica las filas en Listo, Con advertencia y Con error; "Solo con problemas" filtra.
  - [ ] "Crear N personas" encola la carga y muestra el "Avance de la carga".
  - [ ] La carga termina como completada o completada con errores; las filas con error no se crean e indican el motivo.
  - [ ] "Cargas recientes" muestra el historial; una carga incompleta se puede reintentar.
  - [ ] "Cargar otra planilla", "Ver personas", "Volver" y "Cancelar" funcionan.

- [ ] **11.4** `[A][J][P][S]` Como desarrollador quiero ver la ficha de una persona, para validar el detalle.
  - [ ] La pestaña **Datos** muestra datos personales, contacto de emergencia, currículum, cursos y vigilancia de salud (esta última, según permiso).
  - [ ] La pestaña **Asignaciones** muestra la obra actual, las obras asignadas y anteriores, el onboarding DS 44 (Completado / Pendiente / No aplica) y el historial de cumplimiento.
  - [ ] "Volver al listado" funciona.

- [ ] **11.5** `[A][J]` Como desarrollador quiero editar la ficha de una persona, para validar la edición.
  - [ ] "Editar" en Datos (o en Vigilancia) muestra "Edición en curso"; "Cancelar" descarta.
  - [ ] Al guardar, los cambios se ven al recargar y quedan en el historial.

- [ ] **11.6** `[A][J][P]` Como desarrollador quiero registrar evidencias y capacitaciones de una persona, para validar el currículum.
  - [ ] "Registrar" agrega una evidencia con su vigencia; aparece como "Vigente" o "Vencida".
  - [ ] "Asignar contenido" asigna un documento de onboarding a la persona.

- [ ] **11.7** `[J][P]` Como desarrollador quiero entregar EPP a un trabajador, para validar la entrega con firma.
  - [ ] "Nueva entrega" abre el formulario: elementos del catálogo, cantidad (con +/−), condiciones de la entrega y motivo de reposición.
  - [ ] "Agregar elemento" suma una fila; cada fila se puede quitar.
  - [ ] El trabajador valida la entrega con su PIN y queda en "Elementos entregados" e "Historial de EPP".
  - [ ] La entrega cuenta como evidencia DS44 y alimenta "Reposiciones de EPP" del panorama.

- [ ] **11.8** `[J][P]` Como desarrollador quiero registrar la vigilancia de salud, para validar los datos sensibles.
  - [ ] Solo con `persona.vigilancia_salud` se ven la aptitud laboral y "En vigilancia".
  - [ ] Cada lectura de esos datos queda en la auditoría.

- [ ] **11.9** `[A][J]` Como desarrollador quiero exportar la ficha de una persona, para validar "Exportar ficha".
  - [ ] Baja un archivo con la ficha completa; sin `persona.exportar` la acción no aparece.

- [ ] **11.10** `[A][J]` Como desarrollador quiero desvincular o eliminar a una persona, para validar la baja.
  - [ ] "Eliminar persona" pide confirmación.
  - [ ] La persona pierde el acceso y sale de las obras, pero su historial y sus firmas se conservan.
  - [ ] Una firma sin conexión suya que llegue después entra en revisión (10.5).

- [ ] **11.11** `[A]` Como desarrollador quiero restablecer la contraseña de otra persona, para validar el soporte.
  - [ ] Se genera una credencial provisional y la persona debe cambiarla al entrar (2.5).

---

## 12. Actividades

- [ ] **12.1** `[J][P][S]` Como desarrollador quiero crear una actividad, para validar el registro.
  - [ ] "Nueva actividad" o "Crear actividad" abre `/activities/nueva` con Tipo y detalle, Horario, Responsable, Asistentes requeridos ("Convocados"), Permisos de trabajo especiales y Planificación del día.
  - [ ] "Ver toda la obra" muestra a todas las personas de la obra y no solo a la cuadrilla.
  - [ ] Los checklists de permisos de trabajo (altura, caliente, etc.) se pueden marcar.
  - [ ] En la planificación del día se pueden marcar ítems y agregar "Otro".
  - [ ] El umbral de asistencia es 70 % en general y 90 % en altura o SPDC.
  - [ ] "Cancelar" vuelve a `/activities`.

- [ ] **12.2** `[J][P]` Como desarrollador quiero planificar el mes, para validar los borradores en masa.
  - [ ] "Planificar el mes" abre `/activities/planificar` (solo con `actividades.planificar`).
  - [ ] "Agregar otro ítem" y quitar ítems funcionan; se generan borradores para el rango.
  - [ ] Los borradores aparecen como "Del plan, por completar".

- [ ] **12.3** `[J][P][S]` Como desarrollador quiero navegar las actividades, para validar las vistas.
  - [ ] Las vistas Lista y Calendario muestran las mismas actividades.
  - [ ] En el calendario funcionan "Mes anterior", "Mes siguiente" y "Hoy".
  - [ ] Al hacer clic en un día se abre su línea de tiempo; "Nueva actividad este día" crea una con esa fecha.
  - [ ] Los rangos "7 días" y "30 días", "Limpiar" y "Quitar filtros" funcionan.
  - [ ] "Historial de actividades realizadas" pagina con "Mostrar 20 más".

- [ ] **12.4** `[J][P][S]` Como desarrollador quiero completar un borrador del plan, para validar "Completar registro".
  - [ ] "Completar" abre el formulario con los datos ya cargados.
  - [ ] "Eliminar borrador" pide confirmación ("Volver" cancela).

- [ ] **12.5** `[J][P][S]` Como desarrollador quiero registrar la asistencia, para validar el pase de lista.
  - [ ] "Registrar asistencia" abre el modal de convocados; "Ver pendientes" muestra quiénes faltan.
  - [ ] "Justificar" marca a una persona como ausente con un motivo; se puede deshacer.
  - [ ] Cada asistente firma con su PIN ("Firmar con PIN").
  - [ ] Con menos asistencia que el umbral, la actividad no queda cumplida.

- [ ] **12.6** `[T]` Como desarrollador quiero firmar mi propia asistencia, para validar "Firmar mi asistencia".
  - [ ] Con el PIN correcto, la asistencia queda registrada y la actividad sale de mis pendientes.

- [ ] **12.7** `[J][P][S]` Como desarrollador quiero cerrar una actividad, para validar el cierre.
  - [ ] Se registra la duración real.
  - [ ] Se puede subir la evaluación ("Ver" y "Reemplazar" el archivo).
  - [ ] La actividad cerrada cuenta como evidencia DS44.

- [ ] **12.8** `[J][P][S]` Como desarrollador quiero ver y descargar el reporte de una actividad, para validar el informe.
  - [ ] "Ver reporte" muestra asistentes, firmas y evaluación; "Descargar reporte" baja un PDF.

- [ ] **12.9** `[J][P]` Como desarrollador quiero editar y eliminar una actividad, para validar su ciclo de vida.
  - [ ] Los cambios se guardan; eliminar pide confirmación.

- [ ] **12.10** `[J][P][S]` Como desarrollador quiero registrar una ausencia (licencia o permiso), para validar que no cuenta en contra.
  - [ ] Una persona con ausencia vigente no baja el porcentaje de asistencia; al eliminar la ausencia vuelve a contar.

- [ ] **12.11** `[A][J]` Como desarrollador quiero gestionar los catálogos de actividad, para validar la configuración.
  - [ ] En `/catalogos-actividad`, "Agregar" suma una opción y "Deshacer" revierte el último cambio.
  - [ ] Las opciones nuevas aparecen al crear una actividad.

---

## 13. Encuestas

- [ ] **13.1** `[J][P]` Como desarrollador quiero crear una encuesta, para validar el alta.
  - [ ] `/surveys/nueva` pide título, descripción y cargo de destino.
  - [ ] Hay tres tipos de pregunta: Selección múltiple (con opciones que se pueden agregar y quitar), Escala 1 a N (con valor máximo) y Pregunta abierta.
  - [ ] "Agregar pregunta" y "Eliminar pregunta" funcionan; se pueden marcar preguntas como obligatorias.
  - [ ] La "Vista previa para el trabajador" refleja los cambios en vivo.
  - [ ] "Cancelar" vuelve a `/surveys`.

- [ ] **13.2** `[T]` Como desarrollador quiero responder una encuesta asignada, para validar la respuesta.
  - [ ] Aparece en **Mis encuestas asignadas → Pendientes**.
  - [ ] Si falta una obligatoria, aparece "Esta pregunta es obligatoria." y no deja enviar.
  - [ ] "Firmar y enviar" pide el PIN; luego la encuesta pasa a "Respondidas" y no se puede responder de nuevo.
  - [ ] Sin conexión, la respuesta se guarda y se sincroniza después.

- [ ] **13.3** `[J][P]` Como desarrollador quiero ver los resultados de una encuesta, para validar el detalle.
  - [ ] "Ver detalles" muestra las pestañas Preguntas y Destinatarios, con el avance de respuestas.

---

## 14. Incidentes

- [ ] **14.1** `[Todos]` Como desarrollador quiero reportar un incidente o hallazgo, para validar el registro.
  - [ ] "Reportar incidente" o "Reportar hallazgo" abre `/incidents/reportar`.
  - [ ] Se elige el tipo (Hallazgo, Incidente, Accidente), la condición o acción subestándar y la gravedad (Leve, Grave, Fatal).
  - [ ] Se eligen el trabajador o los trabajadores afectados.
  - [ ] Se adjunta evidencia fotográfica; cada foto se puede quitar.
  - [ ] Antes de enviar aparece la "Confirmación de envío"; después, el incidente está en el listado.
  - [ ] "Cancelar" vuelve sin guardar.

- [ ] **14.2** `[Todos]` Como desarrollador quiero dictar la descripción por audio, para validar la transcripción.
  - [ ] Se graba el audio, se transcribe y el texto llena la descripción, que luego se puede editar.
  - [ ] Si la transcripción falla, se avisa y se puede escribir a mano.

- [ ] **14.3** `[Todos]` Como desarrollador quiero reportar sin haber dado el consentimiento de datos, para validar el aviso de privacidad.
  - [ ] Aparece el aviso con "Ir a Mis datos y privacidad".
  - [ ] Si ya escribí algo, se pide confirmar antes de descartar el reporte.

- [ ] **14.4** `[J][P][S]` Como desarrollador quiero revisar el listado de incidentes, para validar los filtros y el detalle.
  - [ ] Los filtros de etapa, gravedad, cierre y mes (‹ ›) funcionan, y también el filtro por obra que viene en la URL.
  - [ ] Abrir un incidente lo marca como visto.
  - [ ] Las fotos se ven en el visor, con imagen anterior y siguiente.
  - [ ] "Cerrar" cierra el detalle.

- [ ] **14.5** `[J][P]` Como desarrollador quiero calificar un incidente como accidente, para validar la calificación.
  - [ ] "Marcar como accidente" pide confirmación ("Cancelar" no hace nada) y el incidente pasa a la categoría Accidentes.
  - [ ] Requiere `incidentes.calificar_accidente`.

- [ ] **14.6** `[J][P]` Como desarrollador quiero editar la gobernanza de un hallazgo, para validar el seguimiento.
  - [ ] "Editar gobernanza" permite fijar el responsable de cierre (Prevencionista, Jefe directo, Comité paritario), el plazo de respuesta y el estado (Abierto, En proceso, Cerrado).
  - [ ] Los cambios se ven en el listado y en las estadísticas.

- [ ] **14.7** `[J][P][S]` Como desarrollador quiero revisar las estadísticas, para validar el consolidado.
  - [ ] La pestaña Estadísticas muestra el consolidado: abiertos, cerrados, accidentes, % de hallazgos cerrados e índice proactivo.
  - [ ] Las cifras cuadran con el listado.
  - [ ] Descargar el reporte en CSV y en PDF funciona.
  - [ ] Sin `incidentes.historial` solo se ve Estadísticas; sin `incidentes.estadisticas` solo el Listado.

---

## 15. Prescripciones

- [ ] **15.1** `[J][P]` Como desarrollador quiero registrar una prescripción, para validar el alta.
  - [ ] "Registrar prescripción" o "Registrar la primera" abre el formulario con el origen ("Quién la ordenó"), la medida y la fecha ("Usar hoy" funciona).
  - [ ] "Cancelar" vuelve al listado.

- [ ] **15.2** `[J][P]` Como desarrollador quiero registrar la implementación de una prescripción, para validar el cierre.
  - [ ] "Registrar implementación" pide la fecha ("Usar hoy") y la evidencia; el panel explica "Qué sirve como evidencia".
  - [ ] El archivo se puede quitar antes de guardar.
  - [ ] Luego queda Implementada, con su "Línea de tiempo".

- [ ] **15.3** `[J][P]` Como desarrollador quiero filtrar las prescripciones, para validar los estados.
  - [ ] Funcionan los filtros Todas, Pendientes, Implementadas y Vencidas, y el filtro por origen; "Ver vencidas" atajo incluido.
  - [ ] Una prescripción con el plazo vencido aparece como Vencida y en "Medidas prescritas vencidas" del panorama.
  - [ ] "Cómo se lleva una prescripción" se puede mostrar y ocultar.

---

## 16. Mi Empresa

- [ ] **16.1** `[A]` Como desarrollador quiero editar la identidad de la empresa, para validar el branding.
  - [ ] En la pestaña **Identidad**, Datos de la empresa se puede editar.
  - [ ] Logo: "Reemplazar" sube uno nuevo; se pueden cargar versiones para modo claro y oscuro ("Cambiar" y "Quitar").
  - [ ] Color principal: los colores sugeridos, el selector y el código hexadecimal funcionan.
  - [ ] Los cambios se aplican en toda la interfaz.
  - [ ] Se puede designar al representante legal.
  - [ ] El "Historial" registra cada cambio.

- [ ] **16.2** `[A]` Como desarrollador quiero gestionar los roles y permisos, para validar la autorización.
  - [ ] "Añadir rol" pide nombre y descripción.
  - [ ] Los permisos se pueden marcar uno por uno o por grupo.
  - [ ] Los roles se distinguen como Predefinido, Personalizado y Heredado.
  - [ ] "Descartar" revierte los cambios sin guardar.
  - [ ] Una persona con el rol nuevo ve solo lo permitido, tanto en el sidebar como en la API.

- [ ] **16.3** `[A]` Como desarrollador quiero gestionar los cargos de la empresa, para validar el catálogo.
  - [ ] En la pestaña **Cargos**, agregar, editar y eliminar funciona.
  - [ ] "Onboarding por cargo" lleva a `/cargos-onboarding`.

- [ ] **16.4** `[A][J]` Como desarrollador quiero configurar el onboarding por cargo, para validar los kits DS44.
  - [ ] "Nuevo cargo" o "Crear cargo" pide el nombre; "Duplicar" copia un cargo y "Eliminar cargo" pide confirmación.
  - [ ] "Agregar ítem" o "Guardar ítem" agrega un documento del kit.
  - [ ] Cada documento se puede ver, reemplazar o quitar.
  - [ ] Se puede eliminar un ítem.
  - [ ] En la "Matriz de EPP", "Agregar EPP" asigna elementos de protección.
  - [ ] "Restablecer" vuelve al kit predefinido, previa confirmación.

- [ ] **16.5** `[A][J][P]` Como desarrollador quiero gestionar el catálogo de EPP, para validar los elementos.
  - [ ] En la pestaña **EPP**, "Nuevo elemento" o "Agregar el primero", "Guardar elemento" y "Eliminar" funcionan; "Buscar elemento" filtra.
  - [ ] Los adjuntos de cada elemento se pueden ver.
  - [ ] Los elementos nuevos aparecen en la entrega de EPP (11.7).

- [ ] **16.6** `[A]` Como desarrollador quiero revisar el DS44 de la empresa, para validar la vista consolidada.
  - [ ] La pestaña **DS44** muestra el cumplimiento del FUF ("Exportar" funciona, los bloques se expanden), el SGSST (subir evidencia por ítem, "Ver") y la estructura preventiva ("Ver" en cada órgano).

- [ ] **16.7** `[A]` Como desarrollador quiero registrar las organizaciones sindicales, para validar ese apartado.
  - [ ] "Agregar" y "Quitar" funcionan y quedan en el historial.

- [ ] **16.8** `[A]` Como desarrollador quiero consultar la auditoría, para validar la trazabilidad.
  - [ ] La pestaña **Auditoría** muestra quién hizo qué sobre los datos personales, los ingresos fallidos y las alertas; "Actualizar" recarga.
  - [ ] La consulta misma queda registrada; sin `empresa.auditoria` la pestaña no aparece.

- [ ] **16.9** `[A]` Como desarrollador quiero encender o apagar la Ficha Básica de Salud, para validar el permiso dedicado.
  - [ ] La pestaña **Ficha de salud** pide confirmación ("Cancelar" no cambia nada).
  - [ ] Solo funciona con `empresa.ficha_salud`.
  - [ ] Al apagarla, los campos de salud desaparecen de las fichas.

- [ ] **16.10** `[A]` Como desarrollador quiero gestionar las solicitudes de los titulares de datos, para validar la pestaña **Datos personales**.
  - [ ] "Registrar solicitud" la crea; los filtros de solicitudes funcionan.
  - [ ] "Registrar verificación", "Registrar prórroga" y "Responder" cambian el estado, y el titular lo ve en `/mis-datos`.
  - [ ] Se puede exportar el detalle de una solicitud.
  - [ ] "Proponer lote de supresión" crea un lote en la pestaña Supresiones.

- [ ] **16.11** `[A]` Como desarrollador quiero aprobar y ejecutar un lote de supresión, para validar el control de dos personas.
  - [ ] La pestaña **Supresiones** muestra el contenido del lote.
  - [ ] "Aprobar este contenido" y "Ejecutar la supresión" piden confirmación.
  - [ ] La misma persona no puede aprobar y ejecutar el mismo lote.
  - [ ] Después de ejecutarlo, los datos ya no son recuperables desde la interfaz.
  - [ ] También se pueden proponer lotes por retención vencida.

---

## 17. Mis datos y privacidad (Ley 21.719)

- [ ] **17.1** `[Todos]` Como desarrollador quiero leer cómo se tratan mis datos, para validar el aviso.
  - [ ] La pestaña **Cómo se tratan** muestra el aviso de privacidad y los datos que se tratan.

- [ ] **17.2** `[Todos]` Como desarrollador quiero dar y retirar mis consentimientos, para validar la pestaña **Consentimientos**.
  - [ ] Otorgar y revocar quedan en "Historial de tus decisiones".
  - [ ] "Lo que no depende de tu consentimiento" explica las bases legales.
  - [ ] Al revocar el consentimiento de fotos, el reporte de incidentes avisa de la falta (14.3).

- [ ] **17.3** `[Todos]` Como desarrollador quiero descargar mis datos, para validar el derecho de acceso y portabilidad.
  - [ ] La pestaña **Descargar mis datos** pide la contraseña; con una contraseña incorrecta no descarga.
  - [ ] La "Copia de tus datos" incluye todo lo que hay sobre mí.

- [ ] **17.4** `[Todos]` Como desarrollador quiero presentar una solicitud y oponerme a un tratamiento, para validar el autoservicio.
  - [ ] En **Solicitudes**, "Nueva solicitud" (rectificación, oposición, supresión, etc.) aparece en "Tus solicitudes" y en el panel de la empresa (16.10).
  - [ ] "Tus oposiciones vigentes" se puede retirar una por una.

---

## 18. Estructura preventiva

- [ ] **18.1** `[J][P]` Como desarrollador quiero constituir un órgano preventivo (Comité Paritario, Departamento de Prevención), para validar la constitución.
  - [ ] `/estructura/constituir` avanza por pasos (datos, integrantes, confirmación) con "Continuar" y "Atrás".
  - [ ] Se pueden quitar integrantes; sin integrantes no deja continuar.
  - [ ] "Cancelar" vuelve a la pantalla anterior.
  - [ ] El órgano aparece en Mi Empresa → DS44 y en el DS44 de la obra.

- [ ] **18.2** `[J][P]` Como desarrollador quiero gestionar un órgano, para validar su seguimiento.
  - [ ] En `/estructura/organos/:id` se puede marcar la acreditación de cada integrante.
  - [ ] "Registrar acta" sube el acta ("Seleccionar archivo") y registra la reunión.
  - [ ] "Convocar extraordinaria" crea la reunión; "Cancelar" la descarta.
  - [ ] Se pueden vincular documentos y comunicar acuerdos.
  - [ ] El órgano se puede disolver, previa confirmación.
  - [ ] Los vencimientos (reuniones, mandatos) generan alertas en la bandeja.

---

## 19. Bandeja de entrada y notificaciones

- [ ] **19.1** `[Todos]` Como desarrollador quiero revisar mi bandeja, para validar las notificaciones.
  - [ ] Las carpetas Recibidos (con contador de no leídos), Enviados y Archivados funcionan.
  - [ ] Los filtros de tipo (Mensaje, Notificación, Alerta, Tarea), prioridad (Urgente, Alta, Normal), fecha (Hoy, Semana, Mes) y estado (No leídos, Prioritarios) funcionan; "Quitar filtros" los limpia.
  - [ ] La búsqueda y "Limpiar búsqueda" funcionan.
  - [ ] Si la carga falla, "Reintentar" funciona.

- [ ] **19.2** `[Todos]` Como desarrollador quiero gestionar los mensajes, para validar las acciones.
  - [ ] Abrir un mensaje lo marca como leído; "Marcar como no leído" lo revierte.
  - [ ] "Archivar" y "Eliminar" funcionan sobre uno o sobre varios ("Seleccionar todos").
  - [ ] "Marcar todos como leídos" deja el contador en 0.
  - [ ] "Volver a la lista" funciona en el celular.

- [ ] **19.3** `[J][P][S]` Como desarrollador quiero enviar un mensaje, para validar la redacción.
  - [ ] "Nuevo mensaje" permite elegir destinatarios (por persona o por cargo), escribir el mensaje y enviarlo.
  - [ ] El mensaje aparece en Enviados y en los Recibidos de cada destinatario.

- [ ] **19.4** `[Proceso]` Como desarrollador quiero recibir los correos de eventos, para validar el envío por correo.
  - [ ] Recuperación de clave, solicitud de firma y alertas llegan con enlaces correctos.
  - [ ] Los rebotes y las quejas de correo se registran (`handlers/correo/eventos.js`).

---

## 20. Procesos automáticos (backend)

- [ ] **20.1** `[Proceso]` Como desarrollador quiero ejecutar el scheduler de vencimientos, para validar las alertas.
  - [ ] `handlers/scheduler/handler.js` genera alertas de documentos, EPP y capacitaciones por vencer.

- [ ] **20.2** `[Proceso]` Como desarrollador quiero ejecutar la revisión documental, para validar `revision-documental.js`.
  - [ ] Los documentos vencidos cambian de estado y avisan a los responsables.

- [ ] **20.3** `[Proceso]` Como desarrollador quiero ejecutar las alertas de estructura, para validar `estructura-alertas.js`.
  - [ ] Avisa de reuniones atrasadas y mandatos por vencer.

- [ ] **20.4** `[Proceso]` Como desarrollador quiero ejecutar la retención de datos, para validar `gobernanza/retencion.js`.
  - [ ] Propone lotes de supresión para los datos con la retención vencida, sin borrar nada sin aprobación.

- [ ] **20.5** `[Proceso]` Como desarrollador quiero comprobar la cola de trabajos, para validar `cola/trabajador.js`.
  - [ ] La carga masiva y los eventos durables se procesan.
  - [ ] Un trabajo fallido se reintenta y no se pierde.

- [ ] **20.6** `[Proceso]` Como desarrollador quiero comprobar el reporte de CSP, para validar `/csp/reporte`.
  - [ ] Una violación de CSP se registra sin datos personales.

---

## 21. Endpoints sin pantalla (solo API)

Hoy no tienen interfaz. Se prueban con `curl` o Postman, con un token válido.

- [ ] **21.1** Como desarrollador quiero firmar varios documentos en lote, para validar `POST /documents/{id}/sign-bulk`.
  - [ ] Crea una firma por documento, cada una con su propio token.

- [ ] **21.2** Como desarrollador quiero disputar y resolver una firma, para validar `POST /signatures/{id}/dispute` y `PUT /signatures/{id}/resolve`.
  - [ ] Al disputarla, el estado pasa a "disputada" y en Mis firmas se ve en ámbar como "Firma disputada".
  - [ ] Al resolverla, el estado final se refleja; `GET /signatures/disputes` la lista.

- [ ] **21.3** Como desarrollador quiero probar los endpoints de investigación de incidentes (`addInvestigation`, `completarFlash`, `quickReport`, `uploadDocument`, `getDocuments`), para validar que responden y respetan los permisos.

- [ ] **21.4** Como desarrollador quiero reagendar una reunión de un órgano, para validar `reagendarReunion`.

- [ ] **21.5** Como desarrollador quiero publicar una versión corporativa, para validar `POST /documents/corporativo/nueva-version` (si no se llega desde la UI en 9.7).

> Si alguno de estos flujos debería tener pantalla, registrarlo como hallazgo.

---

## 22. Pruebas transversales

- [ ] **22.1** Como desarrollador quiero comprobar el aislamiento entre empresas.
  - [ ] Un usuario de la empresa A no puede leer documentos, personas, firmas, obras ni incidentes de la empresa B, aunque cambie los ID en la URL o en la API (403 o 404).

- [ ] **22.2** Como desarrollador quiero comprobar los permisos por rol en la API, no solo en la interfaz.
  - [ ] Llamar a un endpoint protegido con el token de un trabajador responde 403.

- [ ] **22.3** Como desarrollador quiero usar la plataforma en el celular.
  - [ ] Login, inicio, Mis firmas, firma asistida, reportar incidente, asistencia y DS44 se pueden usar a 360 px de ancho, sin scroll horizontal.

- [ ] **22.4** Como desarrollador quiero usar la plataforma con mala o ninguna conexión.
  - [ ] Sin red aparece el aviso "Sin conexión".
  - [ ] Firmas y encuestas se encolan; las acciones que no pueden esperar se bloquean con un mensaje claro.
  - [ ] Las pantallas de carga muestran esqueletos y no quedan en blanco.

- [ ] **22.5** Como desarrollador quiero probar la seguridad básica.
  - [ ] HTML o scripts escritos en campos libres se muestran escapados.
  - [ ] Las URL de descarga firmadas vencen y no sirven para otra empresa.
  - [ ] Superar el límite de solicitudes devuelve 429.
  - [ ] Los logs no contienen RUT, PIN ni datos de salud en claro.

- [ ] **22.6** Como desarrollador quiero probar la accesibilidad.
  - [ ] Todo se puede operar con teclado: Tab, Enter y Escape cierran modales y paneles.
  - [ ] Los botones de solo ícono tienen `aria-label`.
  - [ ] Los avisos (toasts) se pueden cerrar.

- [ ] **22.7** Como desarrollador quiero correr las pruebas automáticas antes de cerrar el plan.
  - [ ] `cd Backend && npm test` pasa.
  - [ ] `cd Frontend && npm test && npm run lint && npm run build` terminan sin errores (el build también verifica los recorridos).
  - [ ] `cd Frontend && npm run test:e2e` (Playwright) pasa.
  - [ ] `Backend/scripts/prueba-punta-a-punta.js` termina sin errores contra `dev`.

---

## Registro de hallazgos

| Caso | Fecha | Ambiente | Rol | Resultado esperado | Resultado obtenido | Severidad | Ticket |
|------|-------|----------|-----|--------------------|--------------------|-----------|--------|
|      |       |          |     |                    |                    |           |        |
