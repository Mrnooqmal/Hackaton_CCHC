# Gobernanza y seguridad de datos personales

**Documento base para la elaboración del informe formal**
Sistema: Build & Serve — plataforma de gestión de cumplimiento DS 44/2024
Ámbito: datos personales, credenciales, integridad documental e infraestructura

---

## 1. Propósito y alcance

Este documento consolida el estado real de la plataforma en materia de gobernanza y
seguridad de datos, distinguiendo **lo que está implementado y verificado en el código**
de **lo que falta implementar**.

Está pensado como insumo para redactar el informe formal dirigido a la Dirección o a un
tercero evaluador. Por eso cada punto declara **dónde está la evidencia** en el repositorio:
ninguna afirmación de este documento debería poder caerse ante una revisión técnica.

**Qué NO cubre este documento:** la firma digital mediante PIN tiene su propio documento
descriptivo en [`docs/firma-digital-pines.md`](./firma-digital-pines.md). Acá se recogen
sus aspectos de seguridad y se agrega el análisis crítico que aquel no incluye.

### Convención de estado

| Marcador | Significado |
|---|---|
| **Implementado** | Existe en el código y fue verificado. Se puede afirmar ante un tercero. |
| **Parcial** | Existe el mecanismo pero le falta una pieza para ser suficiente. |
| **Pendiente** | No existe. No debe afirmarse como capacidad del sistema. |

---

## 2. Checklist consolidado

### 2.1 Aislamiento entre empresas (multi-tenant)

> **Corrección de la versión anterior de este documento.** Acá decía que el
> aislamiento estaba implementado y verificado, apoyándose en que la clave
> primaria de las tablas empieza por `TENANT#{tenantId}`. Ese diseño era correcto
> y no era suficiente: **la API no tenía autenticación**, el `tenantId` se leía de
> lo que mandaba el cliente y las lecturas por identificador (`GET /personas/{id}`,
> `/documents/{id}`, `/signatures/{id}`, `/activities/{id}`, `/incidents/{id}`,
> `/surveys/{id}`, `/obras/{id}`, `/tenants/{id}`) no comprobaban de qué empresa
> era el dato. Un particionamiento que nadie verifica no aísla nada. Lo que sigue
> es el estado tras el endurecimiento, y cada fila dice qué faltaba.

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 1.1 | Particionamiento de datos por empresa | **Implementado** | Clave primaria `TENANT#{tenantId}` en personas, documentos y firmas. `Backend/lib/services/PersonaService.js` |
| 1.2 | Toda ruta privada exige sesión | **Implementado** | Autorizador de API Gateway (`Backend/handlers/auth/authorizer.js`) más cierre por omisión en el handler (`conSesion` en `Backend/lib/auth/sesion.js`): una ruta nueva que olvide declarar el autorizador queda inutilizable, no abierta. `Backend/tests/rutas-autenticadas.test.js` falla la build si aparece una ruta pública fuera de la lista declarada. |
| 1.3 | La empresa sale de la sesión, nunca del cliente | **Implementado; verificado por una prueba estructural** | `tenantIdDeSesion(event)` y `conSesion`. *Corrección de la versión anterior:* esta fila decía "Implementado" con la revisión hecha módulo por módulo, y no estaba completo. Se escaparon `/signature-requests` (siete rutas sin `conSesion`: descifraba las solicitudes de la empresa nombrada en la consulta, devolvía el historial de firmas de cualquier persona y dejaba cancelar cualquier solicitud) y `/ausencias` (empresa y registrador del cuerpo o la consulta), entre otros (H-17). Ahora lo verifica `Backend/tests/identidad-desde-sesion.test.js`, que no tiene lista de módulos: invoca toda ruta autenticada sin sesión y exige el 401 de `conSesion` sin tocar AWS ni la red, y analiza el código de todos los handlers buscando lecturas de la empresa, de un actor o de una persona desde el cuerpo, la consulta o el path. La empresa y el actor no admiten excepción; una persona como objeto del acto sí, declarada con dónde se comprueba que sea de la empresa (404). |
| 1.4 | Las lecturas y escrituras por identificador comprueban pertenencia | **Implementado** | Personas, documentos, firmas, actividades, incidentes, encuestas, obras, estructura preventiva, empresa y archivos. Responden **404** y no 403: que un identificador exista en otra empresa tampoco se informa. `Backend/tests/aislamiento-tenant.test.js`, `aislamiento-tramo2.test.js`, `aislamiento-tramo3.test.js`, `uploads-pertenencia.test.js` |
| 1.5 | La configuración de la empresa solo la toca su empresa | **Implementado** | El módulo de empresa tomaba el `tenantId` del path sin compararlo con la sesión: cualquier usuario podía reescribir los **roles y permisos** de otra empresa, es decir su control de acceso completo. Era el peor hallazgo del recorrido. |
| 1.6 | Una persona solo firma dentro de su empresa | **Implementado** | Validación previa a aceptar la firma. `Backend/handlers/signatures/handler.js` |
| 1.7 | Los documentos de una obra no acreditan a otra | **Implementado** | `documentosDelAmbito()` en `Backend/lib/completitud.js`. Cubierto por pruebas. |
| 1.8 | Los actores de cada acto salen de la sesión | **Implementado** | Quién crea, publica, valida, asigna, firma, reporta o resuelve se toma del token. Venían en el cuerpo de la petición, así que escribir el identificador de otra persona bastaba para actuar a su nombre — y para saltarse el permiso, porque varias comprobaciones solo corrían *si* el cliente se identificaba. |

### 2.2 Credenciales y autenticación

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 2.1 | El PIN nunca se almacena en texto plano | **Implementado** | Solo se guarda el hash. `Backend/lib/credenciales.js` |
| 2.2 | El hash incorpora identificador personal y secreto de servidor | **Implementado** | Sal aleatoria por hash, `personaId` dentro de la sal y pimienta de servidor leída de SSM en ejecución. El `PIN_SALT` anterior **nunca estuvo declarado** y en AWS valía `undefined`: el secreto de servidor no existía. Ver D-7. |
| 2.3 | Verificación resistente a ataques de temporización | **Implementado** | `crypto.timingSafeEqual`. |
| 2.4 | El hash nunca se expone en la API | **Implementado** | Campo interno; la respuesta solo informa si hay PIN configurado. `Backend/lib/models/Persona.js` |
| 2.5 | Mensajes de error genéricos ante credencial inválida | **Implementado** | No revelan si falló el PIN, el estado de la persona u otro. |
| 2.6 | **Función de derivación con costo para el PIN** | **Implementado** | scrypt `N=2^15, r=8, p=1`; ~112 ms por verificación, medidos en la Lambda. Cada hash guarda su algoritmo y sus parámetros, y se actualiza solo al usarse. Ver D-7. |
| 2.7 | **Límite de intentos de PIN** | **Implementado** | Contador por persona, bloqueo progresivo (1/5/15/60 min), reseteo en el primer acierto. Ver D-9. |
| 2.7b | Restablecimiento de un PIN olvidado, con control dual | **Implementado** | Permiso propio y motivo obligatorio; quien restablece no puede asistir en el PIN nuevo; aviso en bandeja en la misma transacción y por correo; vales anulados; historial. `PersonaService.restablecerPin`, `Backend/tests/cambio-pin.test.js`. Ver D-9, "Restablecimiento". |
| 2.8 | **Throttling a nivel de API** | **Implementado** | Límite por omisión del stage (100 por segundo, ráfaga de 200) y límite propio y estricto en cada ruta pública: el alta de empresas y los reportes de CSP desde septiembre (`558923e`, en prod), y desde el 8 de noviembre de 2026 las de autenticación (ingreso 20/s, recuperar contraseña 2/s, restablecer y validar token 5/s, verificación pública de firmas 10/s). *Corrección:* esta fila decía "sin límite de tasa configurado". El límite es por ruta y por ambiente, no por IP (HTTP API no lo distingue y WAF no se asocia a HTTP API): frena una avalancha; al atacante paciente lo frenan el límite de intentos por cuenta y la detección (D-9, D-31). Un 429 o un 5xx no descartan las firmas sin conexión: quedan en la cola para reintentar. `Backend/tests/limite-tasa-api.test.js`. |
| 2.9 | El token de sesión se almacena hasheado | **Implementado** | Se guarda `sha256(token)` y se resuelve por índice. Antes se guardaba el token en claro: un volcado de la tabla de sesiones era suplantación inmediata de cualquier usuario. `Backend/lib/auth/sesion.js` |
| 2.10 | El PIN ya no se guarda en el dispositivo (modo sin conexión) | **Implementado** | Las firmas sin red se acreditan con un **vale de un solo uso** que la persona desbloquea con su PIN al inicio del turno, con red; el dispositivo guarda vales, no el PIN, y el servidor solo guarda el hash del vale. `Backend/lib/services/ValeFirmaService.js`, `Backend/tests/vale-firma.test.js`. Ver D-3 para las dos decisiones de diseño (vale vencido y equipo que pierde su identificador). |

### 2.3 Sesiones y recuperación de acceso

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 3.1 | Sesión con expiración explícita | **Implementado** | Seis horas. `Backend/handlers/auth/handler.js` |
| 3.2 | Eliminación automática de sesiones vencidas | **Implementado** | TTL nativo de DynamoDB: la sesión se borra sola, no queda residuo. |
| 3.3 | Tokens de recuperación con aleatoriedad criptográfica | **Implementado** | `crypto.randomBytes(32)`. |
| 3.4 | Tokens de recuperación almacenados hasheados | **Implementado** | `hashResetToken()` con SHA-256; nunca se guarda el token en claro. |
| 3.5 | El cambio de contraseña actúa sobre la sesión, no sobre el cuerpo | **Implementado** | `changePassword` tomaba el `personaId` del cuerpo: con la contraseña temporal de cualquiera —que el propio sistema devolvía al resetear— se le cambiaba la contraseña a otra persona. |
| 3.6 | El alta de empresas no es un endpoint | **Implementado** | Era pública, tras un código compartido que además estaba vacío en los dos ambientes. La ejecuta el operador con `Backend/scripts/crear-empresa.js`: autorización por IAM y trazabilidad en CloudTrail. |
| 3.7 | Cambiar la contraseña revoca las sesiones abiertas | **Implementado** | Al cambiarla, al restablecerla por correo y al restablecerla un administrador se revocan todas las sesiones de la persona, en todas sus empresas; el cambio con sesión emite una nueva. Antes no se revocaba ninguna: una sesión abierta con la contraseña inicial por quien conoce el RUT quedaba completa al cambiarla su dueña. `Backend/tests/cambio-password-sesiones.test.js`. Ver D-26. |

### 2.4 Integridad y trazabilidad documental

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 4.1 | Cada firma registra fecha, IP de origen y user-agent | **Implementado** | Verificado en `Backend/handlers/signatures/handler.js`. |
| 4.2 | El documento original nunca se modifica | **Implementado** | La evidencia de firmas se anexa; el archivo subido se preserva intacto. |
| 4.3 | Versionado inmutable con autoría y motivo | **Implementado** | Snapshot por versión con quién publicó, cuándo y por qué. `Backend/handlers/documents/handler.js` |
| 4.4 | Idempotencia: sin firmas duplicadas por reintento | **Implementado** | |
| 4.5 | Escrituras concurrentes atómicas por persona | **Implementado** | Firmas simultáneas de distintas personas no se pisan. |
| 4.6 | Serialización del estampado por documento | **Implementado** | Cola SQS FIFO con `MessageGroupId = documentId` y cola de mensajes fallidos. |
| 4.7 | Verificación independiente de una firma por token | **Implementado** | Sin exponer datos personales. |
| 4.8 | Constancia de difusión con origen declarado | **Implementado** | `Document.difusiones[]` distingue constancia automática de declarada. `Backend/lib/distribucion.js` |
| 4.9 | Hash de integridad del archivo almacenado | **Implementado** | Ver D-12. *Corrección:* esta fila seguía como pendiente después de implementarse. La huella se toma del archivo en S3 al registrarlo (`camposDeArchivo` en `Backend/lib/huellaArchivo.js`, usado por `Backend/handlers/documents/handler.js`), nunca del cuerpo. `Backend/tests/huella-archivo.test.js`. Está en el código desplegado en prod (`d750646`) y en dev. |
| 4.10 | Ninguna firma se registra sin PIN | **Implementado** | La estrategia `PRESENCIAL` de `FirmaService` valida siempre: omitir el PIN permitía firmar documentos, registros AT/EP e informes del Art. 71 a nombre de otra persona, y `sign-bulk` lo hacía sobre una lista entera. Firmar por un tercero exige ahora el permiso de firma asistida, con el PIN del firmante como prueba del consentimiento. |
| 4.11 | El PIN no se puede reemplazar por la espalda | **Implementado** | Quien sobreescribe un PIN puede firmar por esa persona. Si ya tiene PIN, solo ella lo cambia y probando el actual. |

### 2.5 Control de acceso y datos sensibles

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 5.1 | Permisos por rol con presets explícitos | **Implementado** | `Backend/lib/permissions.js`; el bypass de administrador es declarado, no implícito. |
| 5.2 | Resguardo de documentos de salud | **Implementado** | Vigilancia de la salud, exámenes ocupacionales, encuestas de salud, restricciones laborales y traslados por enfermedad. `Backend/lib/documentos-salud.js` |
| 5.2b | Resguardo de los **campos de salud de la ficha** | **Implementado** | *Corrección de la versión anterior:* el resguardo cubría los documentos, pero `Persona.toSafeFormat()` devolvía `vigilanciaSalud` y `restriccionLaboral` en **toda** respuesta que incluyera personas —el listado del personal, el equipo de la obra, la ficha—, así que el dato que el repositorio protegía viajaba igual por otra puerta. Ahora no viajan salvo para quien tiene `persona.vigilancia_salud` o para la propia persona, y escribirlos exige ese permiso. |
| 5.2c | El visor de archivos respeta el resguardo de salud | **Implementado** | Las URLs prefirmadas de `/uploads` se emiten solo si quien pide puede ver ese documento: sin esto, el visor era la puerta de atrás del filtro del repositorio. `Backend/handlers/uploads/handler.js` |
| 5.3 | La persona siempre accede a sus propios datos de salud | **Implementado** | Ocultarle su propio examen sería improcedente. |
| 5.4 | Falla cerrada ante solicitante no identificado | **Implementado** | Sin identificación se ocultan: el error es que falten documentos, nunca que se filtren datos de salud. Cubierto por pruebas. |
| 5.5 | Archivos servidos por URL prefirmada temporal | **Implementado** | No hay URL pública permanente sobre el almacenamiento. |
| 5.6 | Registro de auditoría de accesos a datos sensibles | **Implementado** | El acceso a datos de salud se audita desde D-18 (`Backend/lib/gobernanza/auditoriaSalud.js`, `Backend/tests/auditoria-salud.test.js`), y la auditoría general con detección de eventos sospechosos desde D-31 (`Backend/lib/gobernanza/auditoria.js`, `deteccion.js`). *Corrección:* esta fila decía que la auditoría general estaba sin desplegar; está en prod desde `14fa693` (verificado el 8 de noviembre de 2026). Ver H-5. |
| 5.7 | **Cifrado a nivel de campo para RUT y datos de salud** | **Implementado** | Personas (`rut`, `vigilanciaSalud`, `restriccionLaboral`), Tenants (`rutEmpresa`), los sidecars de firmas e incidentes, los arreglos embebidos de documentos, actividades y solicitudes, las respuestas de encuesta y el contenido firmado de los registros AT/EP y del Art. 71 (`snapshotCifrado`, sin la copia `contenido`, desde `9128bca`, 26 de septiembre). *Corrección:* esta fila seguía como parcial por esas dos copias, que ya no existen: verificado el 8 de noviembre de 2026 que en dev y prod no queda ningún registro con `snapshot` o `contenido` en claro (no hay registros de esos dos tipos generados antes del cambio). El HTML firmado que se guarda en S3 lleva el contenido completo, cifrado en reposo con la CMK del bucket de evidencia: no es cifrado de campo, y su acceso pasa por la URL prefirmada con el resguardo de salud (5.2c). Ver D-10. |
| 5.8 | Los índices de personas proyectan todos los atributos | **Implementado** | `personaId-index`, `email-index` y `tenantRutHmac-index` pasaron a `KEYS_ONLY`: el índice da la clave, la ficha se lee de la tabla. Ver D-6. |
| 5.9 | El RUT no viaja completo en la verificación pública de firmas | **Implementado** | `GET /signatures/verify/{token}` es público por diseño (un fiscalizador comprueba una firma sin cuenta), y devolvía nombre y **RUT completo**: el token se convertía en una consulta abierta de identidad. Ahora el RUT va parcial (`···.678-5`), que cumple igual la función de cotejo. |

### 2.6 Infraestructura y cifrado

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 6.1 | Cifrado en tránsito | **Implementado; la brecha se cierra con el dominio propio** | API: solo TLS 1.2 y 1.3, sin puerto 80. Frontend: CloudFront redirige HTTP a HTTPS y envía HSTS (un año). Buckets: todos rechazan accesos sin TLS. En `buildandserve.cl` el mínimo es TLS 1.2 (certificado propio de ACM, D-21). La URL de `cloudfront.net` acepta TLS 1.0 mientras dure la transición. |
| 6.10 | Los buckets se gobiernan desde el stack | **Implementado** | Estaban **fuera** de CloudFormation, creados a mano: ningún despliegue podía comprobar ni corregir su configuración, y de ahí venían los dos hallazgos anteriores. Se incorporaron por `IMPORT` de CloudFormation —sin recrearlos ni tocar los 135 objetos de producción— con `DeletionPolicy: Retain`, que es la forma correcta de protegerlos de un `serverless remove`. |
| 6.11 | **Bloqueo de objetos (Object Lock)** | **Implementado** | El bucket de evidencia de cada ambiente se creó con Object Lock en modo `GOVERNANCE` y retención por omisión de 5 años (`EvidenciaBucket` en `Backend/serverless.yml`); la aplicación extiende la retención de lo que debe seguir (D-15). *Corrección:* esta fila decía "pendiente, requiere migración" después de la migración a los buckets nuevos. Verificado contra AWS el 8 de noviembre de 2026: `Enabled`, `GOVERNANCE`, en dev y prod. Ver D-5. |
| 6.2 | Cifrado en reposo declarado | **Implementado** | Buckets de evidencia y trabajo con la CMK de su ambiente (D-4); el del frontend, con `AES256`. Tablas DynamoDB con la CMK (`SSESpecification`) desde el 28 de septiembre de 2026. Grupos de logs: con la CMK desde el 8 de noviembre de 2026, todos los del stack, puestos por el plugin `Backend/plugins/logs-cifrados.js` (Serverless no permite ponerle llave a los grupos que crea) y con permiso para CloudWatch Logs en la política de la llave, acotado a la cuenta y la región. Asociar la llave no reemplaza el grupo: lo anterior sigue legible hasta que vence por la retención. `Backend/tests/logs-cifrados.test.js`. Ver D-14. |
| 6.3 | Bloqueo explícito de acceso público a los buckets | **Implementado** | *Corrección de la versión anterior:* se declaraba **Pendiente** por ausencia en `serverless.yml`, pero en AWS ya estaba activo (las cuatro opciones en `true`). Lo que faltaba era la declaración, no la protección. Ahora está en el stack. |
| 6.4 | Restricción de orígenes CORS en almacenamiento | **Implementado** | Estaba en `AllowedOrigins: ['*']`, es decir cualquier página de internet podía hacerle peticiones al bucket desde el navegador de quien la visitara. Acotado al CloudFront de la aplicación (y `localhost` solo en dev), con métodos `GET`, `PUT` y `HEAD`. |
| 6.5 | Recuperación a un punto en el tiempo | **Implementado** | `PointInTimeRecoverySpecification` en **todas las tablas**, dev y prod: 22 por ambiente, verificadas `ENABLED` contra AWS el 6 de noviembre de 2026 (eran 16 cuando se activó). Antes estaba deshabilitado en todas: un borrado no tenía ninguna vía de recuperación. |
| 6.6 | Política de retención de infraestructura | **Implementado** | `DeletionPolicy` y `UpdateReplacePolicy` configurados por ambiente. |
| 6.8 | Región de tratamiento de los datos | **Evaluada y postergada** | Ver decisión D-1. |
| 6.9 | Versionado de los buckets | **Implementado** | Habilitado en los cuatro buckets y declarado en el stack. Sustituye al punto 6.7, que lo reportaba pendiente. |
| 6.12 | Cabeceras de seguridad del frontend | **Implementado; CSP activa** | HSTS, `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` y `Referrer-Policy`, declarados en `infra/frontend.yml`. La CSP de scripts pasó a **activa** el 6 de noviembre de 2026 en las dos distribuciones (infra de `4b2db9e`), después de un mes en solo reporte sin violaciones de la aplicación; probada en dev y prod. `CspModo` permite volver a solo reporte desde el mismo commit; los hashes salen de `infra/hashes-csp.js`, y `desplegar-frontend.sh` se niega a publicar un build cuyos scripts en línea la política activa no autoriza (con la CSP activa, ese build dejaría la aplicación en blanco). `Backend/tests/csp-activa.test.js`. Ver D-14. |
| 6.13 | Las respuestas de la API no se cachean | **Implementado** | `Cache-Control: no-store` en toda respuesta; una prueba invoca cada función HTTP y lo comprueba. |
| 6.14 | HTML armado con texto de usuario | **Implementado** | Un solo escapado por lado y una prueba que falla si aparece un sumidero de HTML nuevo. Ver H-13. |
| 6.15 | Token de sesión fuera del alcance de un script | **Postergado** | Vive en `localStorage`. Moverlo a una cookie `httpOnly` exige dominio propio y protección CSRF. Ver D-14. |

### 2.7 Gobernanza del dato personal

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 7.1 | **Política de retención de datos personales** | **Implementado** | Proceso diario (`retencionDiaria`) que calcula por empresa qué venció y qué se conserva, guarda el plan y extiende el Object Lock de la evidencia que debe seguir. La supresión de lo vencido se ejecuta con un lote propuesto desde ese plan, aprobado por una persona y ejecutado por otra (`handlers/gobernanza/lotes.js`, pestaña Supresiones de Mi Empresa, `RolSupresion` como único rol que borra). *Corrección:* esta fila decía "pendiente: ejecutar la supresión" después de D-17. En prod desde `14fa693` (verificado el 8 de noviembre de 2026). `Backend/tests/lotes-supresion.test.js`, `retencion-proceso.test.js`. Ver D-15 y D-17. |
| 7.2 | **Mecanismo de supresión a solicitud del titular** | **Implementado** | Solicitudes con canal de origen y fecha de recepción inmutable, verificación de identidad, bloqueo temporal real, prórroga solo a tiempo, respuesta con fundamento, avisos de plazo e historial que solo crece (D-15, D-30); el titular las presenta en Mis datos y privacidad y la empresa las gestiona en la pestaña Solicitudes de titulares. Una supresión acogida se ejecuta con un lote de dos personas (D-17). *Corrección:* esta fila decía "pendiente: pantalla y ejecución". En prod desde `14fa693`. `Backend/tests/derechos-*.test.js`, `lotes-supresion.test.js`. |
| 7.3 | **Registro de tratamientos** | **Implementado** | Generado desde el inventario de datos (`lib/gobernanza/inventario.js`), que también recorre el proceso de retención: no pueden divergir. Una prueba falla si una tabla nueva no está clasificada. Ver D-15. |
| 7.4 | **Procedimiento de notificación de brechas** | **Parcial: falta solo la validación legal** | Hay con qué responder qué se expuso, de quién y de qué empresas (`scripts/informe-brecha.js`, D-19), apoyado en la auditoría de salud (D-18) y la general (D-31). El protocolo existe desde D-32 (`docs/plan-respuesta-incidentes.md`): quién decide (la constructora responsable), plazos internos, plantillas para la Agencia y los titulares, contención con scripts. Falta que un abogado valide los plazos internos y los responsables: no se puede cerrar desde el código. |
| 7.5 | Minimización en las respuestas de la API | **Implementado** | Revisión del 8 de noviembre de 2026 con un mismo criterio: de OTRAS personas, quien no gestiona recibe solo lo necesario para elegir o contar; la propia, completa. **Personas:** el listado se recorta sin `personas.ver` (H-16); `GET /personas/{id}` y `/by-rut/{rut}` entregaban la ficha completa a cualquier sesión, y por RUT servía para averiguar a quién pertenece: ahora la ajena exige `personas.detalle` o `personas.ver` (sin permiso, lo del listado; por RUT, el 404 de uno inexistente), y validar un RUT exige crear o ver personas. **Bandeja:** los destinatarios llevaban el correo de todo el personal; ahora nombre, rol y cargo. **Documentos:** un trabajador recibía el RUT y la IP de todos los firmantes de cada documento, también en las versiones archivadas; sin `repositorio.ver` ni `personas.detalle`, de los demás solo el identificador y el estado. **Actividades:** el RUT de todos los asistentes y del relator; sin `actividades.crear` ni `personas.detalle`, de los demás el identificador. **Incidentes:** cualquier sesión leía todos, con afectado, relato, gravedad, RUT y lesiones; sin `incidentes.historial`, cada persona lee solo lo que reportó (la pantalla ya lo escondía; la API no). **Obras:** el expediente, el consolidado CHECK y las medidas correctivas exigen `obras.detalle`. El PDF firmado sigue llevando el RUT de cada firmante: es el documento legal. `Backend/tests/listado-personas.test.js`, `destinatarios-bandeja.test.js`, `minimizacion-respuestas.test.js` y la prueba de punta a punta. |
| 7.6 | **Deber de información al titular** | **Implementado** | Aviso de privacidad generado desde el inventario de datos (`lib/gobernanza/aviso.js`): responsable y encargados, **transferencias internacionales** (AWS en Estados Unidos; Google solo con el consentimiento del dictado), categorías, finalidades, bases, plazos de conservación, lo que queda en el equipo para firmar sin señal, derechos, plazos de respuesta y el **reclamo ante la Agencia**. Se muestra en Mis datos y privacidad y en el enrolamiento propio y asistido, que es cuando se recogen los datos. *Hallazgo de la revisión del 8 de noviembre de 2026:* hasta entonces el titular veía las bases y los consentimientos, pero no que sus datos se alojan en Estados Unidos, cuánto se conservan ni que puede reclamar ante la Agencia. `Backend/tests/aviso-privacidad.test.js`. |

---

## 3. Decisiones tomadas

Las decisiones de esta sección se registran con su fundamento y su fecha. Una
decisión evaluada y postergada **no es lo mismo** que un punto omitido: lo que se
sabe y no se hizo tiene que poder distinguirse de lo que no se miró.

### D-1. Región de tratamiento: se mantiene us-east-1, de forma provisional
**Estado: evaluada y postergada — 15 de septiembre de 2026**

Toda la infraestructura (DynamoDB, S3, Lambda) está en **us-east-1**, Norte de
Virginia. Los datos personales de trabajadores chilenos —RUT, domicilio, datos de
salud ocupacional— se tratan, por lo tanto, fuera de Chile.

**Por qué se evaluó.** La Ley 21.719 no prohíbe la transferencia internacional,
pero la somete a condiciones, y la pregunta la hará el primer cliente
institucional que revise el servicio. Cambiar de región después es una migración
con ventana de indisponibilidad: conviene decidirlo con intención y no por
inercia.

**Por qué se posterga.** Hay una consulta pendiente a la CChC sobre si existe una
exigencia de localización para los datos del gremio. La respuesta cambia la
decisión: si la hay, corresponde migrar a `sa-east-1` (São Paulo) o esperar la
disponibilidad de una región chilena; si no la hay, se mantiene us-east-1 por
costo y latencia hacia el resto de los servicios.

**Consecuencia mientras tanto.** El informe formal debe declarar la región
explícitamente en vez de omitirla, y decir que la decisión está tomada en
provisorio, a la espera de esa respuesta. Lo que no se puede es no mencionarlo.

### D-2. Retención de la evidencia: cinco años desde el término del vínculo
**Estado: decidida — 15 de septiembre de 2026. Implementación pendiente.**

**El plazo.** La evidencia de cumplimiento de una persona se conserva **cinco años
contados desde el término de su vínculo laboral**, por la prescripción de las
acciones laborales y previsionales en la normativa chilena. Es el plazo durante el
cual la empresa puede ser requerida a probar que cumplió.

**El problema que hace falta entender antes de implementar.** Son **dos relojes
distintos**, y confundirlos deja evidencia sin protección:

- El bloqueo de objetos de S3 (*Object Lock*) cuenta desde que **se sube** el
  objeto.
- La obligación legal cuenta desde que **termina el vínculo** de la persona.

Un acta firmada hoy por alguien que sigue trabajando cinco años más debe
conservarse **diez** en total: cinco hasta que su vínculo termina, más los cinco
del plazo. Un Object Lock de cinco años desde la carga la habría dejado
desprotegida justo cuando empieza a correr el plazo que importa.

**El diseño, por eso, es doble:**

1. **Object Lock en modo gobernanza** (no cumplimiento), con un piso de **cinco
   años desde la carga**. Protege contra el borrado accidental y el malicioso
   ordinario. Se elige gobernanza y no cumplimiento a propósito: el modo
   cumplimiento no lo puede levantar **nadie**, ni la cuenta raíz, ni ante una
   orden judicial de supresión, ni ante un error de carga masiva. Es un candado
   sin llave, y un candado sin llave es un riesgo, no una garantía.
2. **Retención calculada en la aplicación** sobre `Persona.fechaTerminoVinculo`,
   que extiende la protección cuando el plazo real supera lo que queda del Object
   Lock. Es la que gobierna: el bloqueo de S3 es el piso, no el criterio.

**Lo que ya está.** El reloj existe: `Persona.fechaTerminoVinculo` se escribe en el
servidor cuando la persona pasa a `inactivo` o `desvinculado`, conserva la primera
fecha si el estado cambia dos veces, y se limpia si el vínculo se reanuda
(`Backend/lib/models/Persona.js`, `Backend/lib/services/PersonaService.js`). Antes
solo existía la fecha de la desvinculación formal: a quien se marcaba inactivo sin
más no le quedaba ninguna fecha desde la cual contar, y sin fecha no hay retención
que calcular.

**Lo que falta.** Habilitar versionado y Object Lock en los buckets (hoy ni
siquiera hay versionado, punto 6.7), y el proceso periódico que evalúa el plazo
real por persona y solo entonces permite la supresión.

**Consecuencia que debe quedar escrita (G-3).** *La obligación de conservación le
gana a la solicitud de supresión del titular mientras el plazo no venza.* Un
trabajador puede pedir que se supriman sus datos; lo que constituye **evidencia de
cumplimiento** —firmas, actas, entregas de EPP, capacitaciones, exámenes exigidos
por el DS 44— no se suprime hasta que vence el plazo, porque la empresa responde
por ella ante la autoridad. Lo suprimible es lo que **no** constituye evidencia:
preferencias, foto de perfil, teléfono de contacto, datos de contacto de
emergencia, y cualquier dato recogido para comodidad del uso y no para acreditar
cumplimiento. Esa frontera —evidencia frente a conveniencia— es la que hay que
sostener ante el titular y ante la agencia, y por eso queda escrita acá y no en la
cabeza de quien responda la solicitud.

### D-3. Firma sin conexión: vale de un solo uso
**Estado: decidida e implementada — 16 de septiembre de 2026**

El PIN dejó de guardarse en el dispositivo. La persona lo teclea una vez, con red,
y recibe vales de un solo uso que el equipo guarda en su lugar. Dos preguntas
había que responder antes de implementarlo, y ambas quedaron resueltas en el
código:

**¿Qué pasa con una firma cuyo vale venció antes de poder sincronizar?** Un turno
se alarga, o el equipo no ve red en dos días. La firma **se registra igual**, con
una marca (`requiereRevision`) que impide que cuente como cumplimiento hasta que
alguien con responsabilidad sobre las firmas la confirme. Descartarla sería
destruir evidencia de un acto que ocurrió y castigar al trabajador por una falla
de red; darla por buena sin más sería fingir que la cadena de prueba es la misma.
El acta registra las cuatro fechas que permiten juzgarla: cuándo se emitió el
vale, cuándo venció, cuándo se firmó en terreno (según el reloj del equipo, dato
declarado) y cuándo entró al sistema. Pasados 30 días del vencimiento ya no entra:
en algún punto la cadena es demasiado débil.

**¿Y si el equipo pierde su identificador?** Un navegador de terreno lo regenera
al limpiar datos o cambiar de perfil. Por eso el identificador del equipo es
**traza y no condición**: se guarda para el acta y no se compara al validar. Un
identificador nuevo nunca invalida un vale. Y si lo que se perdió fue el
almacenamiento entero —que es el caso real, porque los vales viven ahí—, el
problema no es un vale rechazado sino un equipo sin vales: se resuelve volviendo a
pedirlos con red, y la interfaz avisa cuando quedan pocos mientras todavía hay
señal.

### D-4. Clave propia (CMK) para el cifrado en reposo
**Estado: aplicada en tablas y buckets de datos, dev y prod; los logs siguen sin
llave propia. Verificado contra AWS el 6 de noviembre de 2026:** las 22 tablas de
cada ambiente usan `SSEType: KMS` con la llave `Clave de los datos de Build &
Serve (<ambiente>)`, administrada por la cuenta (`KeyManager: CUSTOMER`); los
cuatro buckets de evidencia y trabajo, `aws:kms` con esa misma llave. Ninguno de
los 161 grupos de logs `/aws/lambda/BuildAndServe-*` tiene llave propia (D-14).
Lo que sigue es el texto original, de cuando estaba pendiente.

Los buckets cifran con `AES256` (clave gestionada por AWS) y eso ya está
declarado en el stack. La clave propia (KMS) no se aplicó junto con el resto por
tres razones que conviene tener a la vista antes de decidir:

1. **No re-cifra lo que ya existe.** Cambiar el cifrado por defecto solo afecta a
   los objetos nuevos: quedaría una mezcla de 135 objetos con AES256 y los
   siguientes con CMK. Con el vaciado de datos que está planificado, la CMK sale
   limpia desde el primer objeto.
2. **Toca el camino de lectura.** El rol de las funciones y el worker de estampado
   necesitan permiso `kms:Decrypt`; si falta, las descargas y el estampado fallan.
   Es verificable, pero no es un cambio de una línea.
3. **Lo que protege.** La CMK no protege contra el robo del bucket —AES256 ya
   cifra— sino que permite revocar el acceso a los datos cortando la clave, y deja
   el uso de la clave en CloudTrail. Es control y auditoría, no confidencialidad
   adicional frente a un tercero externo.

### D-5. Bloqueo de objetos (Object Lock): requiere bucket nuevo
**Estado: resuelto. Los buckets de evidencia de dev y prod se crearon nuevos, con Object Lock en `GOVERNANCE` y retención por omisión de 5 años (verificado contra AWS el 8 de noviembre de 2026). Lo que sigue es el análisis con que se decidió.**

Object Lock **solo se puede habilitar al crear el bucket**. Los actuales no lo
tienen, así que la política de retención decidida en D-2 exige migrar a buckets
nuevos. Lo que implica, con los números reales de producción:

| | Repositorio | Evidencia |
|---|---|---|
| Objetos | 112 | 23 |
| Tamaño | 159,4 MB | 71,6 MB |

- **La copia es trivial**: `aws s3 sync` a ese volumen tarda menos de un minuto.
- **La base de datos NO se migra**: lo que se guarda en DynamoDB son *claves* de
  objeto, no URLs con el nombre del bucket. Cambia una variable de entorno y un
  despliegue.
- **La ventana de riesgo** es lo que haya entre la copia y el cambio de variable:
  un archivo subido en ese lapso quedaría solo en el bucket viejo. Se cierra con
  una segunda pasada de `sync` después del cambio.
- **Lo irreversible**: con Object Lock en modo gobernanza, los objetos no se
  pueden borrar durante el plazo salvo con un permiso explícito de excepción. Es
  el comportamiento buscado, pero conviene entrar con las bases limpias.

Por eso la recomendación es hacerlo **junto con el vaciado**, no antes: migrar
ahora significa copiar datos que igual se van a descartar, y entrar a un bucket
con bloqueo llevando objetos de prueba que después no se podrán borrar con
facilidad.

### D-6. Reproyección de los índices de personas
**Estado: implementado.** Nota tardía: esta decisión quedó marcada "pendiente" en el documento mucho después de haberse hecho — se corrige acá al escribir D-10, que retoma exactamente esta reproyección para el RUT.

Los tres índices de `PersonasTable` se declararon con `ProjectionType: ALL`. La
proyección de un índice **no se puede modificar**: hay que borrarlo y recrearlo.

Lo que cuesta no es el volumen —la tabla de producción tiene 38 personas y 72 KB,
así que el relleno del índice es instantáneo— sino dos cosas:

1. **Una ventana sin ese índice.** Mientras se recrea, toda consulta que lo use
   falla. `tenantRut-index` y `email-index` son los que resuelven el **login**, y
   `personaId-index` lo usa el autorizador en cada request: la ventana es de
   minutos, pero es indisponibilidad real, no degradación.
2. **Cambios de código en cinco puntos.** Hoy el login lee el hash de la
   contraseña *desde el índice*, porque busca por RUT o correo sin conocer la
   clave primaria. Con una proyección acotada hay que leer la clave en el índice y
   la ficha en la tabla, en dos pasos: `PersonaService.getById`, `getByRut`,
   `getByEmail`, `auth.findPersonaByRut` y el flujo de restablecimiento de
   contraseña, que además necesita campos que ni siquiera salen en la ficha
   pública (`resetTokenHash`).

El costo de esperar es que los datos sensibles siguen triplicados en el
almacenamiento. El costo de hacerlo ahora es esa ventana de login más el cambio de
código, con datos reales de por medio. **Con las bases vacías, ambos desaparecen**:
no hay relleno que esperar ni sesión que interrumpir, y el cambio de código se
prueba sin riesgo de dejar a alguien fuera del sistema.

### D-7. Hasheo de credenciales: scrypt, con el algoritmo guardado junto al hash
**Estado: implementado el 18 de septiembre de 2026, en dev y prod**

**Función y costo.** scrypt con `N=2^15, r=8, p=1`: 32 MB de memoria por intento,
que es el mínimo que recomienda OWASP para scrypt. Se eligió por encima de un
costo mayor porque el PIN se verifica en cada firma, y por encima de uno menor
porque bajar de ahí deja el sistema por debajo de la recomendación pública que un
tercero evaluador va a mirar.

**Medición, no estimación** (Lambda `authLogin`, x86_64, us-east-1; mediana de
cinco llamadas en caliente, tomadas del `REPORT` de CloudWatch):

| Escenario | 1024 MB | 1769 MB |
|---|---|---|
| Ingreso sin verificación (RUT inexistente) | 11–36 ms | — |
| Ingreso con una verificación (contraseña incorrecta) | 204–230 ms | 124–144 ms |
| **La verificación sola (scrypt)** | **~195 ms** | **~112 ms** |
| Emisión de vale, que verifica el PIN | — | 137–144 ms |
| Ingreso exitoso completo (con sesión y escrituras) | — | 160–215 ms |
| Memoria máxima usada por la función | 105 → 142 MB | 142 MB |

**Por qué 1769 MB en las funciones que verifican credenciales.** Ahí es donde
Lambda entrega un vCPU completo, y scrypt es de un solo hilo: el límite no es la
memoria asignada sino la fracción de CPU. Como se factura por GB-ms, el cambio
cuesta casi lo mismo —214 GB-ms contra 225, un 5% más— y devuelve un 40% menos de
espera. Se aplicó a `authLogin`, `authChangePassword`, `authResetPassword`,
`valesEmitir`, `createSignature` y `processOfflineBatch`.

**El algoritmo viaja con el hash.** Formato `$scrypt$ln=15,r=8,p=1,pv=1$sal$derivada`.
Hoy no hay migración que hacer, pero la próxima vez que haya que subir el costo sí
la va a haber, y sin esta marca no habría forma de distinguir un hash de otro sin
adivinar por el largo. Con ella, `verificar` devuelve `obsoleto: true` y el hash se
reemplaza en el ingreso, que es el único momento en que el secreto en claro está
disponible. Lo guardado con SHA-256 se sigue verificando y se reemplaza igual: la
migración termina sola, sin pedirle nada a nadie.

**La pimienta.** Ninguna función de costo salva a un PIN de cuatro dígitos: a
112 ms por intento, las 10.000 combinaciones contra un hash robado toman menos de
veinte minutos. Lo que sí lo salva es que el atacante no tenga todo lo necesario.
La pimienta es una llave de 256 bits que vive en SSM como `SecureString` cifrado
con la CMK del sistema, **no en la tabla**, y se lee en ejecución, no al desplegar:
resolverla en `serverless.yml` la dejaría escrita en claro dentro de la plantilla
de CloudFormation, que queda guardada y la puede leer cualquiera con permiso sobre
el stack. Un secreto que viaja en la plantilla no es un secreto.

Se versiona (`pv`) para que rotarla no invalide lo anterior. Y si un despliegue se
encuentra con una versión de pimienta que no conoce, **falla**: no responde
"credencial incorrecta", que sería exactamente la degradación insegura que se
acaba de sacar del sistema, aplicada al peor lugar posible.

**Lo que NO cambió, a propósito.** Los tokens de sesión, los de recuperación de
contraseña y los vales se siguen guardando con SHA-256 de una pasada. Ahí es lo
correcto: son valores aleatorios de 32 bytes generados por el servidor, sin espacio
de búsqueda que recorrer. Una función de costo sobre ellos solo agregaría latencia
a cada request.

**Pendiente asociado:** H-2 (límite de intentos) es ahora la defensa que falta.

### D-8. Dato sensible fuera del elemento que copian los índices
**Estado: implementado el 19 de septiembre de 2026, en dev y prod**

Al reproyectar los índices de listado apareció un límite que no tiene vuelta:
`INCLUDE` en DynamoDB admite 20 atributos como máximo, y además solo proyecta
atributos de PRIMER NIVEL — no se puede incluir `trabajador.nombre` y dejar
fuera `trabajador.rut`, el mapa va entero o no va. En incidentes y firmas el
dato sensible vive dentro de esos mapas, así que `INCLUDE` no era una opción
para sacarlo del índice: o se proyectaba el RUT igual, o no cabía la tabla.

**La solución:** el dato sensible se guarda en un elemento APARTE de la misma
tabla, con clave derivada (`<id>#traza`) y **sin `tenantId` ni ningún otro
atributo de clave de índice**. Un índice global de DynamoDB solo indexa los
elementos que tienen su atributo de clave, así que ese elemento aparte no
aparece en NINGÚN índice — propiedad de "índice disperso" usada a propósito, no
un efecto colateral.

En **incidentes**, `trabajador` (nombre, RUT, género, cargo) y `reporteFlash`
(que lleva `afectados[]` con RUT) salieron del elemento listado; queda
`trabajadorNombre` de primer nivel para la tabla en pantalla. En **firmas**,
salieron el RUT, la IP y el agente de usuario; queda el nombre para el anexo.

**El costo, medido y no estimado:** prod tenía cero incidentes y cero firmas
fuera del enrolamiento de prueba del administrador. La migración fue un script
que no tenía nada que migrar — la última vez que ese cambio de modelo sale
gratis, porque los dos son registros con valor probatorio y en unos meses
migrar filas ya escritas es una conversación distinta.

**Lo que cuesta en cada lectura:** una escritura más al crear, una lectura más
al abrir el detalle (`lib/traza-sensible.js`, función `conTraza`). Si esa
lectura falla, el detalle se abre igual y sin la parte sensible, con marcador
medible (`lib/degradacion.js`) — un incidente que no se puede abrir es peor que
uno incompleto. Quien lee para LISTAR nunca une las dos partes; ahí está la
ganancia: ningún listado paga ese costo y ningún índice contiene el dato.

**Pendiente asociado (cerrado por D-23):** documentos y solicitudes de firma
también llevan RUT en el elemento listado (`asignaciones[]`, `solicitanteRut`,
`trabajadores[]`) y sus índices siguen en `ProjectionType: ALL`. Con el cifrado
de campo del RUT, el índice solo copia texto cifrado; D-23 decide dejarlos así.

**Ubicación:** `Backend/lib/traza-sensible.js`, `Backend/handlers/incidents-module/incidents.repository.js`, `Backend/handlers/signatures/handler.js`, `Backend/lib/services/FirmaService.js`

### D-9. Límite de intentos de PIN: contador por persona, bloqueo progresivo
**Estado: implementado el 22 de septiembre de 2026, en dev y prod**

Con D-7 (scrypt) cada intento de PIN ya cuesta ~112 ms de CPU del servidor, pero
eso solo hace lenta la fuerza bruta, no la impide: recorrer los 10.000 PIN de
cuatro dígitos seguía siendo cuestión de minutos de tráfico visible, y nadie
está mirando ese tráfico todavía. Faltaba un tope real.

**Por qué el contador es por persona, y no por sesión ni por IP.** Los cuatro
lugares donde se verifica un PIN (vales, firma directa, cambio de PIN,
enrolamiento) exigen sesión, y actuar sobre el PIN de OTRA persona exige además
el permiso de firma asistida. El atacante más probable no es un desconocido
—eso ya lo detiene el autorizador— sino alguien con sesión válida probando el
PIN de una persona puntual de su cuadrilla, o una sesión robada. La persona
atacada es siempre la misma aunque la sesión cambie, y en terreno la IP no
discrimina nada: sale toda por la misma NAT de la obra.

**La progresión**, deliberadamente generosa antes del primer bloqueo — es un
teclado numérico usado con guantes o bajo lluvia:

| Fallo consecutivo | Bloqueo |
|---|---|
| 1–4 | nada, solo cuenta |
| 5 | 1 minuto |
| 10 | 5 minutos |
| 15 | 15 minutos |
| 20 y cada 5 en adelante | 60 minutos (tope) |

El contador se resetea a cero en el primer PIN correcto. Agotar el espacio
completo bajo esta progresión —2.000 ciclos de 5 intentos, casi todos pagando
el tope de 60 min— toma semanas, no minutos.

**Mientras está bloqueada:** un intento se rechaza sin correr scrypt y sin
tocar el contador ni el bloqueo. Incrementar durante el bloqueo dejaría que
alguien alargue el castigo de otra persona a pura fuerza de peticiones vacías.

**Hacia afuera, el bloqueo SÍ se comunica** — distinto del login o la
recuperación de contraseña. Ahí la ambigüedad protege contra enumerar cuentas
que no se sabe si existen; acá quien prueba el PIN ya sabe que la persona
existe (la eligió de su propia cuadrilla, o es la suya), así que decir
"inténtalo de nuevo en N minutos" no filtra nada nuevo y sí es información
operativa legítima para quien solo se equivocó.

**El marcador es una métrica separada de `FallosDependencia`, a propósito:**
esa alarma dispara con un solo evento porque un fallo de dependencia nunca es
esperable; un bloqueo de PIN sí lo es (alguien se equivoca un mal día), así que
comparten el mecanismo (EMF, sin filtro por log group) pero no la alarma. La de
bloqueos (`BuildAndServe/PinBloqueado`) dispara a partir de 5 bloqueos en 5
minutos, agregado a nivel de empresa/stage — verificado end-to-end en dev con
seis intentos reales contra el endpoint (4 fallos sin castigo, bloqueo al 5º
con el mensaje correcto, rechazo sin gastar scrypt durante la ventana, PIN
correcto aceptado y contador en cero al vencer, métrica materializada en
CloudWatch).

**Ubicación:** `Backend/lib/limitePin.js`, enganchado en `handlers/vales/handler.js`, `handlers/signatures/handler.js`, `lib/services/PersonaService.js` (`setPin`, `completarEnrolamiento`) y `lib/services/FirmaService.js`.

**Corrección al cierre original:** el primer despliegue (22 de septiembre) cubrió
cuatro puntos y se dio por cerrado. Al armar el inventario para el cifrado de
campo apareció un quinto camino: `FirmaService.crear`, con su propia validación
de PIN sin pasar por el límite, usado por documentos (firma individual y
asistida), actividades, encuestas y los registros AT/EP e informe del Art. 71 —
más tráfico real de firma que los cuatro puntos ya cubiertos juntos. Se corrigió
en el punto de encuentro (`crear()` mismo, no en cada llamador) el mismo día,
desplegado y verificado con una prueba que ejercita `FirmaService.crear`
directamente.

**Segunda corrección (26 de septiembre de 2026): el cambio de PIN.** El
servicio (`PersonaService.setPin`) verificaba el PIN actual solo "si el cliente
lo envía": omitirlo cambiaba el PIN sin prueba y sin pasar por el límite. La
ruta sí lo exigía, así que no había un camino explotable por la API, pero era la
única defensa; y la escritura no estaba condicionada, de modo que entre que la
ruta leía "no tiene PIN" y el servicio escribía, un PIN recién creado se podía
sobrescribir sin conocerlo. La regla completa pasó al servicio —el único punto
por donde pasa todo cambio de PIN—: con PIN, solo la propia persona lo cambia,
probando el actual por el límite de intentos; sin PIN, lo configura ella o quien
puede enrolar; y la escritura procede solo si el PIN guardado sigue siendo el
verificado (o si sigue sin haber uno). Otra persona no cambia un PIN existente
ni sabiéndolo, y en ese caso ni siquiera se consulta el PIN, para que no sirva
de oráculo.

**Tercera corrección (27 de septiembre de 2026): el primer PIN.** La escritura
condicionada de la segunda corrección tenía un error propio, y llegó a dev y
prod con `58845ba`: la condición "sigue sin haber PIN" era
`attribute_not_exists(pinHash)`, pero `crear` guarda `pinHash: null`, y para
DynamoDB un NULL es un atributo presente. Resultado: **ninguna persona nueva
podía configurar su primer PIN** (409, "el PIN cambió mientras se procesaba").
Al detectarlo había 15 fichas así en dev y 1 en prod, y ninguna sin el
atributo. Las pruebas estaban en verde porque el doble de DynamoDB resolvía la
condición con `!ficha.pinHash`, que trata `null` como ausente. La condición
ahora es `attribute_not_exists(pinHash) OR pinHash = :nulo`, y los dobles de
PIN y de vales pasaron a evaluar condiciones con la semántica de DynamoDB
(`Backend/tests/expresiones-dynamo.js`): contra el código desplegado, el doble
nuevo reproduce el fallo. Se revisaron las demás condiciones
`attribute_not_exists` sobre atributos que no son clave: licencias y vales ya
contemplaban el NULL, y `fichaSaludHabilitada` se guarda siempre como booleano.

**Restablecimiento de un PIN olvidado (27 de septiembre de 2026).** Hasta ahora
no había salida para quien lo olvida. Ahora una persona con el permiso
`persona.restablecer_pin` (solo el administrador por defecto) lo borra,
indicando un motivo, para que se configure uno nuevo. Las reglas:

- **Dos personas distintas.** Quien restablece no puede asistir en la
  configuración del PIN nuevo; lo hace la propia persona desde su cuenta, o en
  terreno otra persona con permiso de enrolar. Restablecer y asistir son las dos
  mitades de poner un PIN que la persona no eligió sola; si las pudiera hacer
  una sola, esa persona se quedaría con la credencial de otra. Lo exige
  `PersonaService.setPin`, contra el restablecimiento vigente, con la escritura
  condicionada a que siga siendo el mismo.
- **No hay restablecimiento sin aviso.** Quitar el PIN y dejar el aviso en la
  bandeja de la persona son una sola transacción de DynamoDB: o pasan las dos o
  ninguna. La persona afectada es la única que puede notar que no lo pidió. Si
  tiene correo, también se le escribe; SES no entra en la transacción, así que
  es mejor esfuerzo, pero si falla queda medido (`registrarFallo`) y se le dice
  a quien restableció que avise por otro medio.
- **Quien asiste nunca conoce el valor.** En el asistido, el PIN lo escribe el
  trabajador en el equipo; la pantalla no tiene botón "Mostrar" y no guarda el
  PIN más allá de confirmarlo. Lo mismo vale ahora para el enrolamiento asistido
  y la firma asistida, que sí tenían el botón.
- **Los vales se anulan.** Se desbloquearon con el PIN anterior. La revocación
  (`ValeFirmaService.revocarDePersona`, que no tenía llamadores) se tragaba los
  errores y marcaba los vales como usados; ahora pagina, filtra por empresa,
  informa por separado los que no pudo anular, y registra `revocadoEn` en vez de
  `usedAt`, con una condición que la excluye mutuamente del consumo.
- **Queda todo registrado.** `pinRestablecido` mientras está pendiente, y
  `pinHistorial` para siempre: cada restablecimiento, configuración y cambio,
  con quién, cuándo, el motivo y si fue asistido. Nunca el PIN ni su hash.

El cambio del propio PIN desde Configuración tampoco funcionaba: llamaba a
`setPin` sin el PIN actual, que la ruta exigía desde antes. Ahora lo pide.

### D-10. Cifrado de campo: RUT buscable por HMAC, sobre de cifrado para el resto
**Estado: completo. Implementado el 23 y 24 de septiembre de 2026 en Personas y Tenants, en los sidecars de firmas e incidentes, en los arreglos embebidos de documentos, actividades y solicitudes, y en encuestas, en dev y prod. Las dos copias en claro que armaba `RegistroService` se resolvieron el 26 de septiembre (`9128bca`, con D-11): el contenido firmado se guarda cifrado y una sola vez. Verificado el 8 de noviembre de 2026 que no queda ninguna copia antigua en dev ni en prod.**

**El principio que ordena todo el diseño:** solo dos entidades se BUSCAN por
RUT —personas (dentro de su empresa, y global para el login multi-empresa) y
empresas (unicidad al dar de alta)—. En todos los demás lugares el RUT es una
copia de referencia que se muestra, nunca se filtra por ella. Eso decide dónde
va HMAC (dos tablas) y dónde va cifrado de sobre puro (todo lo demás).

**Los dos mecanismos** (`Backend/lib/cifradoCampo.js`):

- `hmacRut()` — HMAC-SHA256 determinista, con una llave propia en SSM
  (`SecureString` cifrada con la CMK del sistema, separada de
  `CREDENCIAL_PEPPER`: son secretos de propósito distinto y no se rotan
  juntos). El RUT se normaliza antes de calcular el HMAC para que el formato de
  entrada no cambie el resultado.
- `cifrarSobre()`/`cifrarConLlaveDatos()` — cifrado de sobre real:
  `kms:GenerateDataKey` contra la CMK del sistema, AES-256-GCM local con la
  llave de datos, que viaja envuelta (nunca en claro). Aleatorio a propósito:
  dos cifrados del mismo valor dan resultados distintos, porque ahí no hace
  falta buscar.

**La llave de datos es por EMPRESA, no por persona ni por valor**
(`Backend/lib/llaveTenant.js`), y esta es la pieza que casi se decide mal.
El diseño natural —una llave nueva por cada RUT— tiene el radio de exposición
más chico posible, pero rompe cualquier operación que toque a MUCHA gente a la
vez: listar el plantel de una empresa, o que el expediente de cumplimiento
cuente cuántas personas están en vigilancia de salud, pasan por cada persona
del tenant en una sola llamada. Con una llave por valor eso son N llamadas a
KMS por pantalla. La solución —ya usada para las respuestas de encuesta— es una
llave de datos por empresa, generada una vez (escritura condicionada para que
dos altas simultáneas en un tenant nuevo no generen dos llaves) y reutilizada:
listar 200 personas pasa a costar 2 llamadas a KMS por invocación —una para el
RUT, una para salud, llaves independientes—, no 400. El radio de exposición si
una llave se compromete es una empresa entera, que es el mismo radio que ya
existe hoy si alguien lee esa partición de la tabla sin cifrado: no es peor que
el statu quo, es mejor.

**Personas — `rut`.** Reemplazado por `rutCifrado` (sobre, llave del tenant) +
`rutHmac` (determinista). El índice `tenantRut-index` pasó a
`tenantRutHmac-index`, sigue `KEYS_ONLY`: la búsqueda resuelve la clave por
HMAC y lee la ficha completa de la tabla, mismo patrón de dos pasos que ya
usaba `fichaDesdeClave`. `getByRutGlobal`/`getAllByRutGlobal` (la búsqueda
cruzada de empresas que usa el login) filtran por `rutHmac = :h OR rut = :rut`
a propósito: encuentran tanto las fichas ya migradas como las que aún no,
porque el login no puede depender de que la migración ya haya corrido.

**Personas — `vigilanciaSalud`/`restriccionLaboral`.** Mismo mecanismo, llave
de tenant separada de la del RUT (secretos de radio de exposición distinto).
`restriccionLaboral` se cifra con `cifrarConLlaveDatosSiempre`, no con la
variante que trata `null` como "nada que cifrar": `null` ("sin restricción") es
un valor legítimo del negocio, y condicionar el cifrado al contenido sería el
mismo patrón de falla silenciosa que ya se cerró en las respuestas de encuesta
(ver más abajo).

**Tenants — `rutEmpresa`.** `rutEmpresaCifrado` + `rutEmpresaHmac`, sobre
propio (sin llave compartida: no hay un "listar todas las empresas" en un
camino caliente — `TenantService.listAll()` la usa un job programado, no una
pantalla). De paso, `getByRutEmpresa` dejó de ser un `Scan` de la tabla entera
comparando en memoria y pasó a `rutEmpresaHmac-index`, una consulta indexada.

**Tenants — `reglas.representanteLegal.rut`.** Documentado como
`rutCifrado` en el modelo, sin escritor todavía: nada en el sistema designa un
representante legal hoy, así que en la práctica sigue siendo `null` en todo
tenant real. Se deja la forma correcta escrita para cuando exista esa función,
en vez de retrofitear otra vez.

**"Leer y reparar", sin script de migración batch** (aprobado explícitamente:
con una sola fila real en cada tabla, es más simple). El código lee las dos
formas —RUT en claro si la ficha no se migró, cifrado si sí— y solo ESCRIBE el
formato nuevo. Las pocas filas de prueba que ya existían en dev y prod se
repararon a mano con `Backend/scripts/reparar-cifrado-legado.js`, que no es un
script de migración de producción: es la reparación puntual de esos datos de
prueba, para no dejarlos en un formato que el sistema ya no escribe.

**Un hallazgo aparte, encontrado al trazar cada lectura de RUT:**
`handlers/auth/handler.js` tenía su PROPIO `Scan` sobre `tenantRut-index`
(`findPersonaByRut`, usado por la recuperación de contraseña) por fuera de
`PersonaService` — un tercer camino independiente, después del de
`PersonaService` y el que ya se había corregido en `FirmaService`. Se corrigió
en el mismo cambio. Lo atrapó la prueba de proyección de índices, no una
revisión manual: es exactamente para lo que esa prueba existe.

**Verificado en producción**, no solo en dev: login por RUT contra el registro
real ya migrado, listado de personal con el RUT correctamente descifrado, alta
de una persona nueva contra KMS real con verificación directa en la tabla (sin
`rut` en claro, `rutCifrado` y `rutHmac` presentes, `vigilanciaSalud` en null
con su sobre cifrado al lado). 553 pruebas en verde, incluidas 22 nuevas
específicas de este cambio.

El 401 de login se verificó además como rechazo de contraseña real, no solo
como "no dio 500": la ficha real de prueba pasa el filtro de candidatas
(`tieneAccesoWeb` + `passwordHash` presente) antes de que `credenciales.verificar`
corra, así que el 401 corresponde a una verificación de contraseña efectiva
—comprobado por lectura directa de la ficha, no por diferencia de tiempos, que
resultó contaminada por el caché de la pimienta por contenedor de
`lib/credenciales.js`—.

**Y después, un login exitoso completo, sin usar ninguna contraseña real.** Se
creó en prod una cuenta desechable (RUT libre verificado por la búsqueda global
por HMAC, rol `trabajador`, correo en `.invalid` para que ningún mensaje pueda
salir, contraseña aleatoria nunca impresa) y se ejercitó el camino completo por
la API HTTP real: `POST /auth/login` → 200 con token (la búsqueda por HMAC
encontró la ficha y el scrypt validó la contraseña), `GET /auth/me` con ese
token → 200, misma persona y misma empresa, `POST /auth/logout` → 200. En la
tabla, la ficha tenía `rutCifrado` y `rutHmac` y ningún `rut` en claro. Al
final se borraron la persona y la sesión, y se verificó que el RUT ya no
aparecía en prod. Así quedó probado el camino de éxito del login sobre el
esquema cifrado, no solo el de rechazo.

**Sidecars de firmas e incidentes (D-8), cerrado el 24 de septiembre de
2026.** El elemento aparte se guarda como un solo sobre (`cifrado`, vía
`cifrarSobre`) en vez de campo por campo: el RUT, la IP y el agente de usuario
de una traza siempre se leen juntos al abrir el detalle, nunca por separado,
así que un sobre por elemento cuesta la misma llamada a KMS que cifrar cada
campo aparte, pero es más simple. Sin llave de tenant compartida —a diferencia
del RUT de personas— porque no hay un "listar todas las trazas" en ningún
camino caliente: cada detalle abre exactamente una traza. `conTraza` lee y
repara: una traza vieja sin `cifrado` se sigue leyendo en claro, porque a
diferencia de una ficha de persona una traza no tiene un "próximo guardado"
natural que la migre sola —se escribe una sola vez—, así que la reparación de
las pocas filas de prueba existentes se hizo a mano con el mismo script.
Verificado en vivo en dev y prod: escritura y lectura de una traza de prueba
contra KMS real, sin el RUT en claro en ningún punto de la tabla. Prod no
tenía ninguna traza legada que reparar (dev sí: una firma y dos incidentes de
prueba, reparados).

**Arreglos embebidos en documentos, actividades y solicitudes, cerrado el 24 de
septiembre de 2026.** `asignaciones[].rut`, `firmas[].rut`, `firmas[].ip`,
`asistentes[].rut`, `firmaRelator.rut`, `trabajadores[].rut` y
`solicitanteRut`.

A diferencia de los sidecars, acá el dato NO se puede mover a un elemento
aparte: no es traza de auditoría, es el contenido que las pantallas dibujan, y
unir dos elementos en cada listado sería justo lo que D-8 evita. Se queda donde
está, cifrado. Y a diferencia de los sidecars, la llave **sí** es la compartida
del tenant (`PROPOSITOS.RUT_PERSONAS`, la misma del RUT de personas: mismo tipo
de dato, mismo radio de exposición): `documents.list()`, `activities.list()` y
`signature-requests.list()` devuelven el elemento COMPLETO de cada registro de
la empresa —decenas de documentos con decenas de asignaciones cada uno—, así
que un sobre por valor habría costado cientos de llamadas a KMS por pantalla.
Con la llave del tenant es una por invocación, y está cubierta por una prueba
que la mide (25 documentos, una sola búsqueda de llave).

**Lo que el inventario encontró, y es el verdadero hallazgo de esta pieza.**
Antes de tocar nada se rastreó cada escritor y cada lector de esos campos en
todo el backend, no solo en los archivos obvios. `asignaciones[].rut` no tenía
un escritor: tenía **cuatro** (`documents.assign`, `EppService.crearEntrega`,
`personas-module.buildAssignment` y la reescritura de
`syncPlantillasToWorkers`), cada uno con su propia copia de `rut: persona.rut`.
`firmas[]` tenía **tres**. Es el mismo patrón que ya había mordido con
`workerNombre` y con `firmas[].ip`, y la causa es siempre la misma: nada falla
cuando un escritor queda atrás, solo deja de cifrarse en silencio. Por eso el
cambio no fue solo cifrar: cada campo quedó con **una sola puerta de entrada**
(`construirAsignacion` y `toDocumentFirmaFormat` en
`Backend/lib/arregloSensible.js`), y hay una prueba estructural que falla si
aparece un escritor nuevo que no pase por ahí. De paso se borraron dos
funciones muertas que eran copias paralelas listas para volver a divergir
(`FirmaService.toAsistenteFormat` y `personas-module.createSignatureRequest`),
y el segundo escritor manual de `firmas[]` en `signatures/handler.js` pasó a
usar el constructor compartido.

**Una falla propia, que vale anotar porque la suite no la vio.** Con el cifrado
puesto y las pruebas de biblioteca en verde, SEIS respuestas de la API seguían
devolviendo el sobre `{c, iv, tag}` donde la pantalla esperaba un RUT: al
cifrar se revisó dónde se GUARDA el dato y no dónde se DEVUELVE. No lo detectó
ninguna prueba sino una llamada real contra dev. Se corrigieron las seis y se
agregó la prueba de respuesta que faltaba — cifrar un campo tiene dos fallas
simétricas, el escritor que no cifra y el lector que no descifra, y ninguna de
las dos levanta un error.

**La reparación del legado es obligatoria acá, no opcional.** En Personas
"leer y reparar" alcanzaba porque toda ficha se vuelve a guardar. Un documento
que nadie toca puede quedarse años con el RUT en claro, y los snapshots de
`versiones[]` (`firmasArchivadas`, `asignacionesArchivadas`) no se reescriben
NUNCA: arrastrarían el RUT viejo para siempre. Por eso
`reparar-cifrado-legado.js` los recorre explícitamente, snapshots incluidos.
`scripts/migrate-workerId-to-personaId.js` no necesitó cambios: normaliza con
spread, así que el sobre pasa intacto.

**Encuestas, cerrado el 24 de septiembre de 2026.** `recipients[].rut`,
`recipients[].responses[]` y `audience.ruts`.

Las respuestas se cifran **siempre**, con `cifrarConLlaveDatosSiempre`: incluso
`[]` produce un sobre. Condicionarlo a que haya contenido —o a que la encuesta
esté marcada como "de salud"— sería el mismo patrón de falla silenciosa de
`restriccionLaboral`. El argumento concreto: el día que alguien conteste una
pregunta abierta de una encuesta de clima con un diagnóstico médico, nadie va a
volver a revisar si esa encuesta tenía la categoría correcta.

**Dos llaves, no una.** El RUT usa la llave de identificación de la empresa
(`RUT_PERSONAS`, la misma de los demás arreglos embebidos) y las respuestas la
de salud (`SALUD`, la misma de `vigilanciaSalud`). Son secretos de radio de
exposición distinto y ya estaban separados para las personas; no había razón
para juntarlos acá. Hay una prueba que comprueba que se piden las dos.

**`audience.ruts` se reemplazó por el conteo (`audience.totalRuts`).** Guardaba en
claro los RUT usados para definir la audiencia, una copia redundante de lo que
ya está en `recipients[]`. Una primera versión los cifró uno a uno para no
cambiarle la forma al cliente; se descartó, porque un dato cifrado que nadie
descifra nunca no se protege, solo se conserva. La pantalla solo usaba el largo
(`ruts.length` → "N trabajador(es)"), así que ahora se guarda el número y se
borra la lista. De paso sale del índice: `audience` está en el `INCLUDE` de
`tenantId-index`, así que esos RUT viajaban también ahí.

**La Ficha Básica de Salud pasó a ser una por empresa.** Era un registro único y
global (`surveyId: 'default-health-survey'`, `tenantId: 'default'`): la única
excepción a la partición por empresa en todo el sistema, y en el módulo de
salud. Al revisarla apareció que además **estaba muerta**: ningún tenant se
llama `'default'`, así que ni el listado (que consulta `tenantId-index` con la
empresa de la sesión) ni el detalle (que exige `encuesta.tenantId ===
sesion.tenantId`) la alcanzaban nunca. `ensureDefaultHealthSurvey` mantenía un
registro que nadie podía ver. Ahora el id es `default-health-survey#<tenantId>`,
cada empresa tiene la suya, y la función exige el tenant: el `= 'default'` por
defecto del parámetro era el origen del problema, porque cualquier llamador que
lo olvidara escribía donde escribían todos. **Y la enciende la empresa, no una pantalla.** Una
primera versión la creaba sola la primera vez que alguien abría Encuestas —
recolectar datos de salud de todo el plantel como efecto secundario de abrir una
pantalla—. Ahora está apagada por defecto y se enciende en Mi Empresa → Ficha de
salud, con un permiso propio (`empresa.ficha_salud`; por defecto solo el
administrador, delegable): decidir que se recolectan datos de salud no es lo
mismo que cambiar el logo ni que editar roles. La decisión queda registrada:
`fichaSaludHistorial` guarda cada encendido y apagado con la persona, su nombre
tal como era en ese momento y la hora, y **solo crece**. Para que ese registro
valga como prueba: vive en atributos propios de la empresa y no dentro de
`settings` ni `reglas` (el PUT genérico reemplaza esos objetos con lo que mande
el cliente y habría podido borrarlo o falsificarlo); se escribe por una ruta
propia (`PUT /tenants/{id}/ficha-salud`) que toma quién y cuándo de la sesión y
nunca del cuerpo; y el cambio de estado y el evento van en la misma escritura
condicionada con `list_append`, así que no hay ventana en que cambie el estado
sin quedar registrado. Pedir el estado que ya tiene no agrega nada: el registro
guarda decisiones, no clics. Apagarla no borra la ficha ni sus respuestas; solo
deja de crearse y de sincronizarse. Verificado en un navegador contra dev, con
una empresa desechable (creada y borrada para no ensuciar el registro de una
empresa real), en escritorio y en ancho de teléfono. La migración costó cero porque estaba vacía — con fichas reales habría
sido mover datos médicos cruzados entre empresas. Se eliminó además
`assignWorkerToHealthSurvey`, sin llamadores, que era la vía por la que una
persona de cualquier empresa habría terminado en ese registro compartido.

**Un bug propio, encontrado al hacer esto: pedir una llave fabricaba empresas.**
`llaveDeTenant` creaba la llave de datos con un `UpdateCommand`, que en DynamoDB
es un *upsert*: si la empresa no existía, la creaba con solo las llaves
adentro. La versión anterior de `ensureDefaultHealthSurvey` pedía las llaves
del tenant `'default'`, y así apareció `TENANT#default` en dev — una fila sin
`tenantId` que `TenantService.listAll()` (usado por un job programado) levanta
como si fuera una empresa, y que el propio script de reparación intentó
"reparar". Se corrigió en la causa, no en los llamadores: `llaveDeTenant` falla
con `TENANT_INEXISTENTE` si la empresa no existe, y la escritura va condicionada
a `attribute_exists(PK)` para cubrir la carrera en que la empresa se borra entre
la lectura y la creación. Hay pruebas de los dos casos. En prod la fila nunca
llegó a existir; en dev hubo que borrarla dos veces, porque dev tiene uso real
continuo y el código viejo la volvió a crear antes de que llegara el
despliegue. Los cuatro dobles de la tabla de empresas que había en las pruebas
—todos modelaban el caso imposible— se reemplazaron por uno solo, fiel a la
tabla (`tests/doble-tabla-tenants.js`).

**El script de reparación ya no escribe en ensayo.** Pedía las llaves antes de
mirar `--confirmar`, y pedir una llave la crea si la empresa todavía no tiene
una. Ahora el ensayo cuenta con una llave desechable, detecta los registros
huérfanos (de empresas que no existen) con una lectura, y los informa sin
tocarlos en los dos modos. Verificado en dev comparando la tabla de empresas
antes y después del ensayo: idéntica.

**Lo que el listado NO paga.** `surveys.list()` se sirve desde
`tenantId-index`, que a propósito ya no proyecta `recipients` (corrección
anterior de esta misma serie). Como ahí no viaja ni el RUT ni las respuestas,
el listado no descifra nada ni va a buscar llaves — se comprueba en tiempo de
ejecución en vez de asumirlo, para que si la proyección cambiara algún día el
código descifre en lugar de devolverle sobres a la pantalla.

**Lo que D-10 no cubría hasta el 26 de septiembre: las copias que arma `RegistroService`** (resuelto en `9128bca`; se conserva el análisis). Al
evaluar si documentos podía quedarse con el índice en `ALL` apareció que la
exposición no estaba resuelta ahí. Dos registros que genera
`RegistroService` guardan en `DocumentsTable`, en claro y dos veces cada uno (el
objeto `snapshot` y el texto `contenido`), datos que D-10 sí cifró en su
origen:

- **Informe de investigación (Art. 71):** `afectado.rut` y `entrevistados[].rut`,
  junto con el nombre, el relato del accidente, la gravedad, si fue fatal y los
  días perdidos. Es el RUT que D-8 sacó de `IncidentsTable` y D-10 cifró en su
  elemento aparte, copiado otra vez en claro al generar el informe —
  probablemente el RUT más sensible del sistema, porque va atado a una lesión.
- **Registro AT/EP:** `vigilanciaSalud.personas[]` con nombre, protocolos de
  vigilancia y aptitud laboral de cada persona. Es `vigilanciaSalud` de Personas,
  cifrado con la llave de salud, descifrado por `PersonaService` y vuelto a
  escribir en claro.

Es el patrón de los dos escritores otra vez, ahora entre tablas: el dato se
protege donde nace y se re-materializa en claro donde se consume. Las dos
copias están en el índice `tenantId-index` de documentos, que proyecta `ALL`.
No se corrigieron acá a propósito: esos `snapshot` son exactamente lo que se
firma con su huella, así que cifrarlos cambia cómo se verifica la integridad
(descifrar y volver a calcular). Al revisarlo apareció que esa huella no cubría
el contenido (H-9, corregido en D-11), y el cifrado se hace sobre esa base.

**Ubicación:** `Backend/lib/cifradoCampo.js`, `Backend/lib/llaveTenant.js`, `Backend/lib/arregloSensible.js`, `Backend/lib/traza-sensible.js`, `Backend/lib/models/Persona.js`, `Backend/lib/models/Tenant.js`, `Backend/lib/services/PersonaService.js`, `Backend/lib/services/TenantService.js`, `Backend/lib/services/FirmaService.js`, `Backend/lib/services/EppService.js`, `Backend/handlers/auth/handler.js`, `Backend/handlers/documents/handler.js`, `Backend/handlers/activities/handler.js`, `Backend/handlers/signature-requests/handler.js`, `Backend/handlers/personas-module/handler.js`, `Backend/handlers/surveys/handler.js`, `Backend/lib/health/healthSurvey.js`, `Backend/scripts/reparar-cifrado-legado.js`, `Frontend/src/pages/Surveys.tsx`, `Frontend/src/api/surveys.api.ts`

### D-11. Huella de integridad del contenido firmado: canónica, versionada, sobre el claro
**Estado: implementado el 25 de septiembre de 2026. Corrige H-9.**

Los informes que genera `RegistroService` —el registro AT/EP (Arts. 71-72) y el
informe de investigación (Art. 71)— se firman sobre un `snapshot` de su
contenido, y la firma lleva una huella de ese snapshot. La huella anterior no
cubría el contenido: ver H-9.

**Las tres reglas** (`Backend/lib/huella.js`):

1. **Se calcula sobre el contenido en claro, nunca sobre el cifrado.** Si se
   calculara sobre el cifrado, rotar la llave —que vuelve a cifrar con otro
   sobre— invalidaría la huella de todo documento ya firmado, y la evidencia
   dejaría de poder probarse. Orden al firmar: armar el contenido → huella →
   recién después cifrar para guardar. Al verificar: descifrar → huella →
   comparar. La rotación no afecta: el sobre guarda su propia llave de datos
   envuelta y el id de la llave, y KMS conserva el material anterior al rotar.
2. **Forma canónica de verdad** (`json-canonico-v1`): claves ordenadas en todos
   los niveles, sin listas de permitidos; lo que JSON perdería en silencio
   (`NaN`, `Infinity`, instancias no planas) se rechaza en vez de ignorarse.
   Pasar el contenido por JSON —que es lo que hace el cifrado al guardar y
   leer— no cambia la huella.
3. **Versionada:** se guarda `{ alg, canon, valor }`, no solo el valor.
   `verificarHuella` usa la regla con que se firmó, y ante una regla
   desconocida lanza en vez de devolver `false`: "no sé verificar esto" y "esto
   fue alterado" son afirmaciones distintas.

**Que la huella en claro no exponga el contenido:** el snapshot incluye campos
de alta entropía (el id del documento y la hora de generación), así que no se
puede recuperar su contenido probando valores. Con un RUT solo sí se podría, y
por eso ahí se usa HMAC con llave y no un hash.

**La prueba que lo impide volver a pasar** (`tests/huella-integridad.test.js`)
no prueba "unos campos que uno recuerda": recorre el contenido y altera cada
hoja, una por una, exigiendo que la huella cambie. Para el informe del Art. 71
recorre la salida del constructor real (`construirSnapshotInvestigacion`, que se
extrajo como función pura para esto), así que un campo que se agregue mañana
queda cubierto sin tocar la prueba. Con la huella anterior, **61 de sus 85
casos fallan**, cada uno nombrando el campo que la firma no protegía.

**Barrido del mismo patrón en el resto del código.** El único `JSON.stringify`
con un arreglo como segundo argumento era este. Las otras huellas hechas a mano
se revisaron una por una: la de estampados (`almacenamiento.claveEstampado`) es
una clave de caché sobre el archivo original y los tokens de las firmas, no una
prueba de integridad, y es correcta para eso; los vales, las sesiones, las
licencias y el restablecimiento de contraseña hashean secretos aleatorios de
alta entropía; `hashLegado` en credenciales solo verifica el formato viejo
para reemplazarlo. Dos notas: el "checksum" del token de firma
(`generateSignatureToken`) no lo verifica nadie —la autenticidad viene de
encontrar el token en la base— y usa `PIN_SALT`, que puede estar ausente; y
`scripts/seed-tenant.js` escribe personas directamente con el RUT en claro y
una contraseña `sha256(pass + personaId)` que el login no acepta, por fuera de
`PersonaService`.

**Sigue abierto H-7** (huella del archivo subido, no del contenido firmado).

**Ubicación:** `Backend/lib/huella.js`, `Backend/lib/services/RegistroService.js`, `Backend/tests/huella-integridad.test.js`

### D-12. Huella de integridad del archivo guardado (H-7), sin un segundo cálculo
**Estado: implementado el 26 de septiembre de 2026. Corrige H-7.**

**La fuente es la huella que S3 ya verificó.** El navegador calcula el SHA-256
del archivo, el servidor lo firma dentro de la URL prefirmada y S3 lo comprueba
contra los bytes al recibir el `PUT` (si no coincide, `BadDigest`). Lo que queda
en el objeto (`ChecksumSHA256`) es una huella ya verificada, y el servidor la
LEE con `HeadObject` (`lib/huellaArchivo.js`): no la recalcula y no la acepta
del cliente, que podría mandar cualquier cosa. Lo que escribe el propio
servidor —los HTML de los informes del Art. 71— se sube pidiendo `SHA256` a S3
(el SDK usaba CRC32 por defecto, comprobado en dev) y la huella sale de la
respuesta del `PUT`: una sola huella de archivo en todo el sistema.

**Se guarda en el documento cuando el documento recibe su archivo**
(`archivoHuella: { alg, valor, versionId }`), y una versión archivada conserva
la suya en `versiones[]`. La confirmación de subida la devuelve, pero solo como
dato informativo: la confirmación no sabe a qué documento pertenece el archivo,
y si la huella viajara del cliente al documento sería falsificable. Siete
lugares le asignan su archivo a un documento (crear, actualizar, nueva versión,
nueva versión corporativa, las copias de onboarding y su sincronización, y los
informes); todos pasan por `camposDeArchivo`, y hay una prueba estructural que
falla si una escritura de `s3Key` no escribe también `archivoHuella`.

**Se verifica al entregar.** Antes de firmar una URL de descarga —individual o
en lote— y antes de estampar el anexo de firmas sobre el original, la huella que
S3 tiene hoy para el objeto tiene que ser la registrada. Si no coincide, o el
objeto registrado ya no está, no se entrega (409) y queda medido
(`integridad.archivo`): en los buckets con versiones una escritura nueva sobre
la misma clave no borra la anterior, pero pasa a ser la que se sirve. Un
documento sin huella registrada (anterior a esto) se entrega informando
`integridad: 'sin-huella'`, sin afirmar nada. Lo que no pertenece a un documento
(evidencia de incidentes, logos, perfil) no tiene huella registrada contra qué
comparar.

**De paso:** `confirmUpload` "verificaba que el archivo existe" con
`GetObject`, que abría la descarga del archivo completo y dejaba el cuerpo sin
leer; ahora es `HeadObject`.

**Ubicación:** `Backend/lib/huellaArchivo.js`, `Backend/handlers/uploads/handler.js`, `Backend/handlers/documents/handler.js`, `Backend/handlers/personas-module/handler.js`, `Backend/lib/services/RegistroService.js`, `Backend/tests/huella-archivo.test.js`

---

### D-13. Contraseña inicial con los cuatro primeros dígitos del RUT: riesgo aceptado
**Estado: decidido el 27 de septiembre de 2026. Riesgo aceptado, no pendiente.**

La contraseña inicial de toda persona con acceso web son los cuatro primeros
dígitos de su RUT, con o sin correo, y se le pide cambiarla en el primer
ingreso. Se mantiene así por comodidad en terreno: mucha gente no tiene correo,
y la contraseña se le dice en persona al registrarla, sin depender de un canal
que no existe.

**Riesgo aceptado.** Hasta su primer ingreso, la cuenta queda protegida por un
dato que no es secreto: el RUT figura en contratos, planillas y documentos de la
obra. Quien lo conozca puede entrar antes que la persona, fijar una contraseña
propia y quedarse con la cuenta. El límite de intentos no lo detiene, porque no
hay nada que adivinar. Con correo el riesgo es el mismo (la contraseña es
igual); sin correo, además, la persona no recibe ningún aviso de que alguien
entró.

**Lo que acota el riesgo hoy:** la contraseña se marca como temporal y se exige
cambiarla al entrar, y firmar exige además el PIN, que se configura aparte y
nunca deriva del RUT. Para una persona trabajadora, la cuenta tomada sirve para
ver lo que tiene asignado. **No acota el rol:** el alta manual y la carga masiva
pueden crear jefes de obra, prevencionistas o supervisores, y un administrador
puede crear a otro administrador; todos reciben la misma contraseña inicial, y
con ella los permisos de su rol hasta que la cambien. Solo el primer
administrador, que crea el alta de empresa, elige su contraseña.

**Se revisa si** aparece un caso de cuenta tomada antes del primer ingreso, o si
se decide tratar distinto la contraseña inicial de los roles con permisos de
gestión.

### D-14. Diagnóstico de cifrado por capa y lo que se corrigió
**Estado: diagnóstico del 27 de septiembre de 2026, verificado contra AWS y el código. Correcciones del 28 de septiembre.**

Cada punto con su estado al diagnosticar, el riesgo concreto y lo que se hizo.

**En reposo**

| Punto | Estado encontrado | Riesgo concreto | Resolución |
|---|---|---|---|
| Tablas DynamoDB | Las 17 tablas de cada ambiente con la llave propiedad de AWS; sin `SSESpecification`. | Sin control de la llave: no se puede auditar su uso ni revocarla. Acotado: RUT, salud y snapshots ya iban cifrados por campo con la CMK (D-10). | `SSESpecification` con `ClaveDatos` en todas, definida una vez (`custom.cifradoTablas`). Es un cambio en caliente, sin reemplazar tablas. |
| Grupos de logs | Con la CMK desde el 8 de noviembre de 2026 (plugin `logs-cifrados`); retención de 14 días en dev y 90 en prod. | Bajo desde H-11: los logs llevan identificadores, no datos personales. | Hecho. Lo escrito antes de asociar la llave sigue sin ella hasta que vence por la retención. |
| Buckets S3 | Evidencia y trabajo con la CMK; frontend con `AES256`; acceso público bloqueado en todos. | Ninguno relevante. | Sin cambios. |

**En tránsito**

| Punto | Estado encontrado | Riesgo concreto | Resolución |
|---|---|---|---|
| HTTP a HTTPS en CloudFront | Redirige con 301. | Sin HSTS, la primera visita por `http://` se puede interceptar (por ejemplo, en la red de una obra). | HSTS de un año, sin `preload`. |
| TLS mínimo en CloudFront | Acepta TLS 1.0, verificado con un handshake real. | Bajo: los navegadores actuales ya no negocian 1.0 ni 1.1. | Pendiente del dominio propio: con el certificado por defecto de `cloudfront.net` no se puede subir el mínimo. |
| API | Solo TLS 1.2 y 1.3; sin puerto 80. | Ninguno. | Sin cambios. |
| Buckets sin TLS | Ninguno rechazaba accesos sin TLS. | Una URL firmada editada a `http://` funcionaba y el archivo viajaba en claro. | Deny de `aws:SecureTransport` en evidencia y trabajo (en el stack) y en el del frontend (a mano, porque no está en el stack). Queda sin él el bucket de despliegues de Serverless, que solo guarda el código. |

**En el cliente**

| Punto | Estado encontrado | Riesgo concreto | Resolución |
|---|---|---|---|
| Token de sesión | En `localStorage` como `auth_token`; se borra al cerrar sesión. | Cualquier XSS lo lee: H-13 lo hizo concreto. | Cerrado el XSS y agregadas cabeceras. La cookie `httpOnly` queda para cuando exista el dominio propio. |
| Service worker | Precachea solo archivos estáticos y la navegación a `index.html`; ninguna respuesta de la API (verificado en el `sw.js` generado). | Ninguno en el SW. En `localStorage` quedan los vales y las firmas pendientes (nombre y respuestas de encuesta) hasta sincronizar o cerrar sesión: aceptado en D-3. | Sin cambios. |
| `Cache-Control` en la API | Ausente en todas las respuestas. | El JSON con datos personales podía quedar en el caché de disco de un equipo compartido. | `no-store` en toda respuesta. |
| CSP y cabeceras del frontend | Ninguna. | Nada acotaba un XSS, y la app se podía meter en un iframe ajeno (clickjacking sobre la firma). | `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` y `Referrer-Policy`. La CSP de scripts va después, primero en modo solo reporte: hay que permitir el script en línea de `index.html`, Google Fonts, Nominatim, S3 y la API. |

**El frontend, en código (28 de septiembre de 2026).** La distribución, su
política de cabeceras, el OAC, el bucket del frontend y su política estaban
creados a mano. Se incorporaron por `IMPORT` a un stack propio,
`BuildAndServe-frontend` (`infra/frontend.yml`), sin recrear nada y con
`DeletionPolicy: Retain`; la detección de drift dio `IN_SYNC` al importar. Los
dos cambios que se habían hecho a mano (cabeceras y deny sin TLS) quedaron en la
plantilla. Se aplica con `infra/desplegar-infra-frontend.sh <commit>` y se
publica con `infra/desplegar-frontend.sh <commit>`; los dos rechazan un commit
que no esté pusheado y construyen en un worktree limpio.

**CSP en modo solo reporte.** `Content-Security-Policy-Report-Only`, armada por
`infra/desplegar-infra-frontend.sh` con la URL de la API y los hashes de los
scripts en línea (el de `index.html` y el que imprime los informes, que se abren
como `blob:` y heredan la política). Los reportes llegan a `POST /csp/reporte`,
una ruta pública con cuerpo máximo de 8 KB, 20 violaciones por envío y límite de
tasa propio (10 de ráfaga, 5 por segundo). Registra solo los campos útiles de
cada violación, **sin la consulta ni el fragmento de ninguna URL** (ahí viajan
los tokens de restablecer contraseña y de la licencia de alta), sin la muestra
del script (puede traer datos de la página) y sin user-agent. Cada violación deja
la métrica `CspViolaciones` por directiva. Pasa a activa (renombrar la cabecera a
`Content-Security-Policy`) cuando pasen unos días sin violaciones legítimas.

### D-15. Gobernanza del dato personal: retención aplicada y derechos del titular
**Estado: decidido el 28 de septiembre de 2026. Implementado: inventario, registro de tratamientos, proceso de retención y, desde el 29 de septiembre, solicitudes del titular con bloqueo temporal, prórroga, respuesta, avisos e historial; la ejecución por lotes de dos personas (D-17) y las pantallas (D-30) cierran lo que quedaba. En prod desde `14fa693`. Desde el 8 de noviembre de 2026, el aviso de privacidad (deber de información) se genera desde este mismo inventario (`lib/gobernanza/aviso.js`).**

**Roles.** Cada constructora es la **responsable** del tratamiento de los datos
de sus trabajadores; la plataforma es **encargada**. Por eso el canal por el que
un titular ejerce sus derechos lo define cada constructora, y el sistema le da la
herramienta para registrar la solicitud y su canal de origen.

**Decisiones.**

1. **Plazo**: 5 años desde el término del vínculo (D-2).
2. **Registros grupales** (actas, actividades, documentos con varios firmantes):
   se conservan completos hasta que vence el plazo del último involucrado.
3. **Al vencer**: los incidentes se anonimizan (se conserva el hecho para los
   indicadores de accidentabilidad); el resto se suprime, incluida la traza
   sensible aparte (`<id>#traza`) de firmas e incidentes.
4. **Ejecución** con aprobación de dos personas distintas: el proceso propone un
   lote, una persona lo aprueba y otra lo ejecuta. Suprimir no tiene vuelta
   atrás.
5. **Retención legal**: una marca en la persona o en la empresa (fiscalización o
   juicio abierto) suspende todo vencimiento mientras esté puesta.
6. **Ante la duda, se conserva**: un registro que menciona a alguien que no se
   puede identificar, o un archivo que ningún registro menciona, se conserva y se
   informa para revisión.

**Derechos del titular (Ley 21.719), a implementar.**

- **Solicitud**: se registra quién la pide, qué derecho ejerce (acceso,
  rectificación, supresión, oposición, portabilidad), cuándo y por qué canal (el
  que defina la constructora).
- **Bloqueo temporal**: al pedir rectificación, supresión u oposición, los datos
  de la persona quedan bloqueados para tratamiento dentro de **2 días hábiles**,
  sin borrarlos, hasta que se resuelva.
- **Plazo de respuesta**: 30 días corridos, prorrogable una vez por otros 30 si
  la prórroga se comunica antes de que venza el primero. Pendiente de
  confirmación legal, por eso es **configurable, no fijo en el código**. Con
  alerta cuando el plazo esté por vencer.
- **Supresión a solicitud**: lo de conveniencia se suprime al resolver; la
  evidencia queda con tratamiento limitado y supresión programada al vencer su
  plazo. La respuesta al titular dice qué se suprimió, qué se conserva, hasta
  cuándo y con qué fundamento.
- **Copias de respaldo**: la recuperación a un punto en el tiempo conserva hasta
  35 días; la respuesta lo informa.

**Lo implementado.**

- **Inventario** (`Backend/lib/gobernanza/inventario.js`): cada tabla con datos
  de personas, qué guarda, para qué, su clase (evidencia, conveniencia,
  operacional), cómo se vincula a la persona, qué archivos referencia y qué pasa
  al vencer. Una prueba exige que toda tabla de `serverless.yml` esté
  clasificada y que sus claves sean las reales.
- **Registro de tratamientos**: se genera desde el inventario
  (`node Backend/scripts/registro-tratamientos.js`); ver abajo.
- **Cálculo de retención** (`Backend/lib/gobernanza/retencion.js`), funciones
  puras con las seis reglas de arriba, probadas caso por caso y con sabotajes.
- **Proceso diario** (`retencionDiaria`, 04:30 hora de Chile): calcula el plan
  por empresa, lo guarda en la tabla de gobernanza **sin datos personales**
  (solo identificadores y claves, porque el plan es la prueba de lo que se hizo
  y sobrevive a la supresión) y **extiende** el Object Lock de la evidencia cuyo
  bloqueo vence en menos de 180 días y debe seguir guardada. No suprime nada.
  Corre con un **rol propio y mínimo** (`RolGobernanza`): lee todas las tablas,
  escribe solo en la de gobernanza y en S3 solo puede listar, leer y extender
  bloqueos, sin bypass ni borrado. El rol compartido de las demás funciones no
  puede tocar bloqueos.

**Derechos del titular: lo implementado (29 de septiembre de 2026).**

- **API** (`/gobernanza/solicitudes`, permiso propio `empresa.derechos_titulares`,
  solo el administrador por defecto): registrar, listar con plazo vigente,
  detalle con historial, prórroga y respuesta.
- **La fecha de recepción** la ingresa quien registra (el plazo parte cuando
  llega la solicitud, no cuando se ingresa), no puede ser futura, y ninguna
  actualización la toca: todas las actualizaciones están en un catálogo que una
  prueba revisa. El evento del historial, que nadie puede editar, guarda la
  fecha original.
- **La prórroga** se registra una sola vez y solo si se comunicó antes de que
  venza el primer plazo. La regla se revisa al leer y se repite en la
  escritura: si el plazo vence entre una cosa y otra, no procede.
- **Bloqueo temporal real**, aplicado al registrar (en la misma escritura) para
  rectificación, supresión y oposición:

  | Uso | ¿Incluye a quien está bloqueado? | Por qué |
  |---|---|---|
  | Listados de personas, obras, convocatorias, encuestas, avisos | No | Es tratamiento nuevo |
  | Registrar una firma | No: se rechaza | Es tratamiento nuevo |
  | Detección de RUT duplicados en la carga masiva | Sí | Evita crear una segunda ficha; no trata sus datos |
  | Informes para la autoridad (Registro AT/EP, expediente) | Sí | Obligación legal |
  | Dotación para la obligación de tener comité | Sí | Es un hecho legal; la persona sigue trabajando |

  Una respuesta levanta el bloqueo, salvo una supresión acogida, que lo
  mantiene hasta que se ejecute. Con dos solicitudes abiertas, responder una no
  desbloquea: el bloqueo sigue por la otra.
- **Historial que solo crece**: tabla aparte, `GobernanzaHistorialTable`, donde
  ningún rol puede actualizar ni borrar (solo agregar y leer), con
  `DeletionPolicy: Retain` en todo ambiente. Una prueba falla si algún permiso
  IAM le da más. Cada operación escribe la solicitud, el bloqueo y sus eventos
  en una sola transacción: no queda una solicitud sin su registro ni un "bloqueo
  aplicado" que no se aplicó.
- **Avisos** diarios (09:00 de Chile) a quienes tienen el permiso: plazo por
  vencer, plazo vencido, último momento para prorrogar y bloqueo pendiente. Una
  vez por día y tipo, y cada aviso queda en el historial.
- **Plazos configurables** por variable de entorno (`GOBERNANZA_PLAZO_RESPUESTA_DIAS`,
  `GOBERNANZA_PRORROGA_DIAS`, `GOBERNANZA_BLOQUEO_DIAS_HABILES`,
  `GOBERNANZA_ALERTA_DIAS_ANTES`), con 30, 30, 2 y 5 por omisión, pendientes de
  la confirmación legal. Los días hábiles excluyen fines de semana y no feriados:
  el plazo calculado llega antes que el real.

**Registro de tratamientos** (generado desde el inventario):

| Categoría | Datos | Finalidad | Clase | Plazo | Al vencer |
|---|---|---|---|---|---|
| Ficha de la persona | RUT (cifrado), nombre, fecha de nacimiento, correo, teléfono, foto, cargo, asignaciones a obras, nivel escolar, cursos, contacto de emergencia, vigilancia de salud y restricción laboral (cifradas), credenciales (hash), historial del PIN, enrolamiento. Suprimibles a solicitud sin esperar el plazo: fotoPerfil, telefono, contactoEmergencia, preferencias, nivelEscolar. | Identificar a la persona trabajadora, asignarla a obras, acreditar su onboarding DS 44 y permitirle firmar. | evidencia | 5 años desde el término del vínculo | Se suprime |
| Documentos, asignaciones y firmas | Documentos de onboarding, procedimientos, entregas de EPP; a quién se asignaron, quién firmó (nombre, RUT e IP cifrados), difusiones, versiones anteriores con sus firmas. | Acreditar la entrega, difusión y firma de la documentación exigida por el DS 44. | evidencia | 5 años desde el término del vínculo | Se conserva completo hasta que vence el plazo del último involucrado; después se suprime |
| Registro de firmas | Quién firmó qué, cuándo, con qué método (PIN o vale), desde qué IP (cifrada), y los documentos firmados. | Prueba de la firma electrónica simple ante la autoridad. | evidencia | 5 años desde el término del vínculo | Se suprime |
| Solicitudes de firma | Solicitante y trabajadores convocados (nombre, cargo, RUT cifrado), estado de cada firma. | Convocar y seguir las firmas de un documento o actividad. | evidencia | 5 años desde el término del vínculo | Se conserva completo hasta que vence el plazo del último involucrado; después se suprime |
| Actividades preventivas y asistencia | Relator, responsables y asistentes (nombre, cargo, RUT cifrado, firma, atrasos), planificación y evaluación. | Acreditar capacitaciones, charlas y actividades del programa preventivo. | evidencia | 5 años desde el término del vínculo | Se conserva completo hasta que vence el plazo del último involucrado; después se suprime |
| Incidentes, accidentes y hallazgos | Persona afectada (cifrada), quién reporta e investiga, descripción, gravedad, días perdidos, medidas y evidencia. | Registro de AT/EP e incidentes peligrosos (Arts. 71 a 73) e indicadores de accidentabilidad. | evidencia | 5 años desde el término del vínculo | Se anonimiza (se conserva el hecho para los indicadores) |
| Encuestas y ficha de salud | Destinatarios (nombre, cargo, RUT cifrado) y sus respuestas cifradas, incluida la ficha básica de salud. | Encuestas del programa preventivo y la ficha básica de salud que habilita cada empresa. | evidencia | 5 años desde el término del vínculo | Se conserva completo hasta que vence el plazo del último involucrado; después se suprime |
| Ausencias | Permisos, licencias médicas, faltas y vacaciones, con fechas y observación. | Justificar la inasistencia a actividades exigidas. | evidencia | 5 años desde el término del vínculo | Se suprime |
| Estructura preventiva (comités, delegados) | Integrantes de cada órgano (nombre, estamento, cargo, acreditación) y sus reuniones. | Acreditar la constitución y funcionamiento del Comité Paritario y demás órganos. | evidencia | 5 años desde el término del vínculo | Se conserva completo hasta que vence el plazo del último involucrado; después se suprime |
| Bandeja de mensajes | Avisos y mensajes enviados y recibidos por la persona. | Comunicación dentro de la plataforma. | conveniencia | Hasta que la persona pida suprimirlo, o con la ficha | Se suprime |
| Sugerencias | Nombre de quien sugiere y el texto de la sugerencia. | Mejorar la plataforma. | conveniencia | Hasta que la persona pida suprimirlo, o con la ficha | Se suprime |
| Sesiones | Hash del token de sesión, persona, empresa y vencimiento. | Mantener la sesión iniciada. | operacional | Mientras sirve (horas o días) | Vence solo (uso o fecha de expiración) |
| Vales de firma sin conexión | Hash del vale, persona, equipo de emisión y de uso. | Firmar sin conexión sin guardar el PIN en el equipo. | operacional | Mientras sirve (horas o días) | Vence solo (uso o fecha de expiración) |
| Licencias de alta de empresa | Correo del futuro administrador y datos prellenados de la empresa. | Dar de alta una empresa con un enlace de un solo uso. | operacional | Mientras sirve (horas o días) | Vence solo (uso o fecha de expiración) |
| Empresa | Datos de la empresa; su representante legal (nombre y RUT) y el administrador. | Configurar la empresa en la plataforma. | evidencia | 5 años desde el término del vínculo | No vence por personas (es de la empresa) |
| Obras | Datos de la obra; sin datos personales salvo referencias a responsables. | Gestionar las obras y su cumplimiento. | evidencia | 5 años desde el término del vínculo | No vence por personas (es de la empresa) |
| Catálogo de EPP | Catálogo de elementos de protección; sin datos personales (las entregas son documentos). | Definir los EPP que entrega la empresa. | evidencia | 5 años desde el término del vínculo | No vence por personas (es de la empresa) |

### D-16. Límite de 500 recursos del stack del backend
**Estado: decidido el 29 de septiembre de 2026 (decisión técnica).**

Al agregar los derechos del titular, la plantilla del backend llegó a 512
recursos y CloudFormation la rechazó (máximo 500 por stack); el ambiente no
cambió, porque la plantilla se rechaza completa antes de aplicar nada. 77 de
esos recursos eran `AWS::Lambda::Version`, una por función, que Serverless crea
en cada deploy y que nada usa: no hay alias, ni concurrencia aprovisionada, ni
ARN calificados referenciados, y `serverless rollback` vuelve a un artefacto de
S3. Se desactivó el versionado (`versionFunctions: false`): 435 recursos. Las
versiones tenían `DeletionPolicy: Retain`, así que sacarlas del stack no borró
ninguna.

**Margen:** 65 recursos. Cada función HTTP nueva cuesta de 4 a 6 (función, log
group, permiso, integración, rutas). `infra/desplegar-backend.sh` empaqueta y
cuenta antes de desplegar: avisa sobre 450 y se niega sobre 490. Cuando haga
falta más, la salida es agrupar rutas por módulo (una función con un router,
como ya hacen personas, obras e inbox) antes que partir el stack.

### D-17. Lotes de supresión: se aprueba y se ejecuta exactamente un contenido, con dos personas
**Estado: implementado el 29 de septiembre de 2026 (en el árbol).**

Es la única forma de borrar datos personales en el sistema.

- **Qué se aprueba**: el contenido exacto del lote —cada operación sobre una
  tabla (qué ítem, suprimir, anonimizar o quitar qué campos, y su traza
  sensible) y cada versión de cada archivo, con su `versionId`— y su huella
  canónica (`lib/huella.js`). Quien aprueba envía la huella de lo que vio.
- **Se ejecuta exactamente lo aprobado**: al aprobar y otra vez al ejecutar, el
  contenido se recalcula desde los datos actuales; si la huella cambió, el lote
  queda **desactualizado** y hay que proponerlo y aprobarlo de nuevo. Además se
  verifica que el contenido **guardado** siga teniendo su huella: otros roles
  pueden actualizar la tabla de gobernanza, y un contenido alterado con la
  huella original no se aprueba ni se ejecuta.
- **Dos personas**: quien aprueba no puede ejecutar (en las reglas y en la
  condición de la escritura). Proponer no cuenta: el lote de plazos vencidos lo
  propone quien lo pide, sobre el plan del sistema.
- **Permiso propio** (`empresa.supresion_datos`, solo el administrador por
  defecto), aparte del de derechos de los titulares: registrar solicitudes no es
  lo mismo que borrar sin vuelta atrás. *Decisión técnica.*
- **Rol propio** (`RolSupresion`): el único del sistema que puede borrar ítems de
  las tablas con datos de personas y versiones de S3 con bypass de la
  retención, y solo lo usa la función de lotes. Una prueba falla si el bypass o
  el borrado de versiones aparece en otro rol.
- **Qué suprime una solicitud acogida**: solo lo de conveniencia (campos de la
  ficha con contenido real —no los valores por defecto—, bandeja y
  sugerencias). La evidencia espera su plazo (D-2).
- **Tamaño**: hasta 400 operaciones por lote (un ítem de DynamoDB tiene 400 KB).
  Uno mayor se rechaza pidiendo dividirlo; los volúmenes actuales están muy por
  debajo.
- **Límite conocido**: si la función se corta a mitad de una ejecución, el lote
  queda en `ejecutando`. Las operaciones son idempotentes (borrar lo que ya no
  está no falla), pero hoy la reanudación es manual.

### D-18. Auditoría de acceso a datos de salud
**Estado: implementado el 29 de septiembre de 2026 (en el árbol).**

Queda registro de quién consultó o descargó datos de salud de **otra** persona:
ficha de vigilancia y restricción laboral, documentos de salud (y sus archivos),
respuestas de la ficha básica de salud, y los documentos que traen salud de
varias personas (Registro AT/EP, investigación de accidente). Se guarda quién,
cuándo, desde qué IP y navegador, por qué ruta, de qué titulares y qué
documentos; **nunca el contenido**, y de los archivos solo la huella de su
clave (la clave puede llevar el nombre de la persona).

- Un evento por petición (`AsyncLocalStorage`): un listado de 80 fichas es un
  registro, no 80.
- **Sin registro no hay acceso** (*decisión técnica*): si el registro no se
  puede escribir, la respuesta con salud no sale y se devuelve 503, medido con
  `registrarFallo`. Para datos de salud, poder demostrar quién accedió pesa más
  que la disponibilidad.
- **No se registra el acceso a los propios datos**: es el derecho de acceso del
  titular, y `/auth/me` en cada carga de página lo inundaría.
- Un punto que entrega salud fuera de un handler auditado lanza un error: se ve
  en las pruebas, no en una fiscalización.
- `AuditoriaAccesosTable`: solo agregar y leer para todos los roles, `Retain`
  siempre, con índice por actor y fecha (lo usa el informe de brecha, D-19).

### D-19. Informe de brecha
**Estado: implementado el 29 de septiembre de 2026 (en el árbol).**

Ante un incidente, `scripts/informe-brecha.js` responde qué datos, de qué
personas y de qué empresas quedaron expuestos. La lógica es pura
(`lib/gobernanza/brecha.js`) y se apoya en el mismo inventario que la retención
y el registro de tratamientos: una tabla nueva sin clasificar ya hace fallar las
pruebas, así que tampoco puede faltar en el informe. Solo lee.

Tres alcances, combinables:

- **Cuenta comprometida** (`--actor`, `--desde`, `--hasta`): la salud a la que
  accedió en la ventana sale **confirmada** de la auditoría (D-18); lo demás que
  podía leer en su empresa se informa como **cota superior**, y el informe lo
  dice, porque las lecturas que no son de salud no se auditan.
- **Tabla expuesta** (`--tabla`, opcionalmente `--empresa`): todo lo que tiene,
  por empresa y persona, con la marca de salud del inventario (`contieneSalud`).
- **Archivos expuestos** (`--prefijo`): los archivos y de quién son, según los
  registros que los mencionan. Esas tablas se cargan como contexto y **no** se
  cuentan como expuestas; un archivo sin registro que lo mencione aparece como
  tal, no se omite.

Decisiones técnicas:

- Lo corre la plataforma, como encargada: una brecha puede cruzar empresas, y
  el informe separa lo de cada una para que cada responsable reciba lo suyo.
- El informe trae **solo identificadores** (empresa, persona, documento) y
  categorías; nunca nombres, RUT (ni su HMAC), correos ni teléfonos. Quien lo
  lee, con acceso, resuelve nombres si la notificación lo exige. Así el informe
  se puede circular sin volverse una segunda brecha.

### D-20. QA prueba en dev: una distribución del frontend por ambiente
**Estado: desplegado el 29 de septiembre de 2026. QA prueba en
`https://d3pve67iu4s0dd.cloudfront.net`; producción volvió a servir su propio
build el 30 de septiembre a las 02:34 UTC, y desde entonces la CSP no registró
violaciones.**

**Qué pasó.** El 29 de septiembre de 2026, a las 17:45 UTC, se publicó en la URL
de producción (`d30jksx91fodea.cloudfront.net`) un build del frontend que
apuntaba a la API de dev. Fue intencional: producción había quedado sin datos y
QA necesitaba usuarios con qué probar. No hubo exposición de datos: dev no
tiene datos reales y la API de producción no se tocó. Pero durante esas horas
la URL de producción no servía producción, y se publicó a mano, sin
`infra/desplegar-frontend.sh`, que lo habría rechazado. Se detectó por la CSP
en modo solo reporte: 683 violaciones `connect-src`, todas contra la API de dev,
desde un minuto después de la publicación.

**Por qué pasó.** Había una sola distribución, la de producción: QA no tenía una
URL propia contra dev, y la única forma de darle una era usar la de producción.
Y nada impedía publicar a mano: cualquier credencial con acceso a la cuenta
puede escribir en el bucket e invalidar la distribución.

**Qué se decidió.**

- Dos distribuciones en `infra/frontend.yml`: la de producción y una de dev
  (bucket, política de cabeceras y CSP propios), para QA.
- `infra/desplegar-frontend.sh <commit> <dev|prod>` publica un build solo en la
  distribución de su ambiente, y se niega si el bundle contiene la API del otro
  ambiente, cualquier otra API Gateway o `localhost`.
- El backend de dev acepta el frontend de dev (CORS y enlaces de los correos),
  leyendo su dominio de la salida del stack del frontend. La URL de producción
  sigue aceptada en dev solo durante el traspaso de QA; se quita cuando
  producción vuelve a servir su build.
- Producción vuelve a `8eb344d`, el build que corresponde a su backend, **después**
  de que QA tenga su URL, para no dejarlo sin dónde probar. Se confirma con la
  métrica `CspViolaciones` en cero.
- Pendiente: que publicar a mano no sea posible. Un rol de despliegue que sea
  el único con escritura en los buckets del frontend y permiso de invalidar
  (propuesto, sin implementar).

### D-21. Producción en buildandserve.cl, y correo con rebotes y quejas
**Estado: en producción desde el 30 de septiembre de 2026 (backend y frontend
de `64adc40`). Verificado: prueba de punta a punta en `https://buildandserve.cl`
con una empresa desechable borrada después; rebotes y quejas de punta a punta
con el simulador de SES; recorrido en Chrome de las pantallas principales con
sesión, sin violaciones de CSP. La salida de SES del sandbox, que figuraba pendiente,
está concedida: `aws sesv2 get-account` responde `ProductionAccessEnabled: true`
y el caso `179073624400729` en `GRANTED` (verificado el 30 de octubre y el 6 de
noviembre de 2026).**

**Dominio.** La distribución de producción sirve `buildandserve.cl` con un
certificado de ACM (us-east-1) para la raíz y `www`, validado por DNS en
Cloudflare. Los registros van **sin proxy de Cloudflare** (nube gris): el TLS lo
termina CloudFront con su certificado, y un proxy delante rompería las
cabeceras y la CSP que ya controla CloudFront. `www` redirige a la raíz (301,
con ruta y consulta) con una CloudFront Function: una sola URL canónica para los
enlaces de los correos y el CORS. Con certificado propio, el TLS mínimo sube a
**1.2** (`TLSv1.2_2021`), lo que cierra la brecha de D-14. La URL de
CloudFront sigue sirviendo y aceptada por el backend durante la transición; D-34
la cierra.

**Correo.** Todo envío pasa por `lib/correo.js` (una prueba falla si otro
archivo usa SES):

- remitente `no-responder@buildandserve.cl` (dominio verificado con DKIM, MAIL
  FROM `mail.buildandserve.cl` y DMARC); respuestas a `contacto@buildandserve.cl`,
  que reenvía Cloudflare;
- conjunto de configuración por ambiente: rebotes, quejas y rechazos van a un
  tópico de SNS al que solo publica SES de esta cuenta y desde ese conjunto;
- `handlers/correo/eventos.js` marca la dirección ante un **rebote permanente**,
  una **queja** o un **rechazo**; un rebote transitorio no marca (casilla llena:
  dejarla fuera privaría a alguien de su restablecimiento de contraseña);
- antes de cada envío se consulta la marca; a una dirección marcada no se le
  escribe (`DIRECCION_SUPRIMIDA`). Además está activa la lista de supresión de
  la cuenta de SES (rebotes y quejas).

Decisiones técnicas:

- La marca se guarda por **HMAC** de la dirección (minúsculas, con prefijo de
  dominio distinto del del RUT), nunca la dirección: la tabla responde "¿está
  suprimida esta?" y no sirve para listar correos. Tampoco van a los logs
  (solo motivo y dominio).
- La marca **vence a los dos años** (TTL): las casillas se reciclan, y si
  vuelve a rebotar se marca de nuevo. Cada evento renueva el plazo.
- Solo la función de eventos escribe en la tabla (rol propio); el rol
  compartido solo la lee.
- El tópico no lleva cifrado propio: SES no puede publicar en un tópico
  cifrado con la llave administrada de SNS, y SNS no guarda el mensaje.

### D-22. Rol de publicación del frontend
**Estado: primera etapa aprobada e implementada el 29 de septiembre de 2026 (en
el árbol). La negación se activa cuando los publicadores registren MFA.**

Publicar el frontend (escribir en sus buckets e invalidar sus distribuciones)
queda en manos de un rol, `BuildAndServe-publicador-frontend`:

- lo asumen solo las personas designadas (hoy Adrean y Benjamin), **con MFA**;
- `infra/desplegar-frontend.sh` lo asume **después** de sus verificaciones
  (commit pusheado, build limpio, API del ambiente), con el commit en el nombre
  de la sesión: CloudTrail dice qué se publicó y quién;
- con `ExigirRolPublicador=true`, la política de cada bucket niega escribir o
  borrar a cualquier otro principal, y una política administrada niega a las
  personas invalidar las distribuciones (CloudFront no tiene políticas de
  recurso).

Por qué en dos pasos: al implementarlo, ningún usuario tenía MFA. Activar la
negación ese día habría dejado a nadie en condiciones de publicar. Hasta
activarla, el script publica con las credenciales propias y lo avisa.

Límite conocido: un administrador puede cambiar la política del bucket; queda en
CloudTrail, pero no se impide. La siguiente etapa, GitHub Actions por OIDC como
único que asume el rol, cierra también la publicación a mano desde un equipo.

### D-23. Índices de Documents, SignatureRequests y Signatures: se quedan en ALL
**Estado: decidido el 30 de septiembre de 2026 (decisión técnica). Tema cerrado.**

Los cinco índices de esas tres tablas (`tenantId-index` en las tres, más
`requestId-index` y `personaId-index` en Signatures) proyectan `ALL`. A
diferencia de las personas (D-6), no se reproyectan:

- **Lo sensible ya viaja cifrado.** El RUT y la IP de quien firma, de quien
  tiene asignado un documento y de los trabajadores convocados se guardan con
  cifrado de campo (D-10, `lib/arregloSensible.js`); la traza sensible vive
  aparte (D-8). El índice copia ese texto cifrado, que sin la llave de datos no
  dice nada. El nombre queda en claro, igual que en cada pantalla que lo lista. En las personas, en cambio, el índice copiaba
  hashes de credenciales y salud en claro dentro del ítem.
- **Un índice no es una copia gobernada aparte.** DynamoDB propaga al índice
  cada actualización y cada borrado de la tabla: la retención, la supresión por
  lotes (D-17) y el bloqueo actúan sobre la tabla y el índice los sigue. No
  quedan copias huérfanas, como sí quedarían en un respaldo o una exportación.
- **No amplía quién puede leer.** Mismo cifrado (la CMK de datos) y todo rol con
  acceso al índice tiene acceso a la tabla. `KEYS_ONLY` no le quitaría la
  lectura a nadie.
- **Lo que costaría:** cada listado pasaría a leer el índice y después la tabla
  por lotes (el doble de lecturas y más latencia en las pantallas más usadas),
  más una ventana sin índice al recrearlo y cambios en cada ruta de listado, sin
  reducir la exposición.

**Cuándo se revisa:** si un rol llega a leer un índice de estas tablas sin
poder leer la tabla, o si se agrega a estos ítems un dato sensible en claro.
Lo primero lo vigila `tests/indices-documentos.test.js`, que falla si pasa; lo
segundo, el inventario (`lib/gobernanza/inventario.js`), que describe qué datos
lleva cada tabla y se revisa con cada tabla o campo nuevo.

### D-24. Carga masiva de personas en cola
**Estado: implementado el 30 de septiembre de 2026 (en el árbol). Diseño
aprobado antes; aquí se registra lo que se construyó.**

Confirmar la carga ya no crea personas en la petición: crea una **carga** y la
encola, un mensaje por fila (`lib/cargas.js`, `handlers/cola/trabajador.js`).
Validar sigue siendo sincrónico y no escribe nada. La pantalla consulta el
avance en `GET /personas/cargas/{id}` y se puede cerrar sin perder nada.

- **Idempotencia por carga y RUT.** El `personaId` sale de ese par y la ficha
  se escribe con condición. Antes de crear se busca la ficha por su clave con
  lectura consistente. Un reintento de SQS no crea a nadie dos veces.
- **Cada fila se cuenta una vez.** El paso a `creada` o `fallida`, los
  contadores de la carga y el conteo de trabajadores de la empresa van en una
  transacción condicionada a que la fila siga `procesando`. Una fila la
  procesa un trabajador a la vez, con un arriendo que vence.
- **Sin todo-o-nada.** Cada fila es su unidad. Las que fallan quedan con su
  número de fila y su motivo. Las inválidas y las duplicadas no se
  reintentan, porque se corrigen en la planilla. Las que fallaron por algo
  transitorio se reintentan con un botón que re-encola solo esas.
- **Fase 2 (supervisores) al terminar**, detectada con el contador y lectura
  consistente; su cierre está condicionado a que no queden filas pendientes.
- **Lo que revienta repetidamente** queda como fila fallida al cuarto intento
  (antes de la cola de mensajes fallidos, que está al sexto y tiene alarma).
  Si la persona ya existe y lo que falla es su onboarding, la fila cuenta como
  creada con un aviso, porque la persona sí está en el sistema.
- **Límite de 1.000 filas por carga.**
- **Datos personales.** La fila guarda solo los campos de la plantilla. Al
  crearse, se le quitan los datos y el RUT en claro (quedan en la ficha).
  Todo vence a los 30 días (TTL). Tabla clasificada en el inventario.
- **Se retiró `POST /personas/carga-masiva`** (flujo directo sin asistente):
  nadie lo llamaba, no validaba antes de crear y corría entero en la petición.

Hallazgo al hacerlo: el doble de DynamoDB de las pruebas no ordenaba las
consultas por la clave de rango. Al corregirlo apareció que el historial de
gobernanza mostraba el bloqueo antes que la solicitud que lo causó (dos eventos
del mismo instante se ordenaban por su tipo). La clave del historial pasa a
llevar el contador antes que el tipo. No había eventos guardados en dev ni en
prod, así que no hubo que migrar nada.

### D-25. Avisos del EventBus durables sobre la misma cola
**Estado: implementado el 30 de septiembre de 2026 (en el árbol).**

La razón es **durabilidad**, no velocidad: notificar a la línea de mando y a
los representantes es parte de acreditar que se informó (Art. 7 inc. 9, Art. 57
inc. 2), y un aviso que fallaba se perdía en silencio.

- `emit` encola el evento con un `eventoId` y la petición responde. Si no se
  puede encolar, se despacha en la petición como antes y queda un marcador
  medible (`evento.encolar`).
- El trabajador despacha en modo estricto: un suscriptor que falla hace fallar
  el mensaje y SQS lo reintenta. Los suscriptores dejaron de tragarse sus
  errores.
- **Sin duplicados en el reintento.** Cada aviso de la bandeja tiene un id
  derivado de `(eventoId, suscriptor)` y se escribe con condición: el
  reintento completa a quien faltó y no repite a quien ya lo tenía. La
  constancia de difusión queda una sola vez por evento.
- **Sin "avisado a nadie".** Si no se puede leer la línea de mando o los
  representantes, el evento falla y se reintenta (una prueba cubre cada caso). Antes se resolvía como "sin
  destinatarios" y la difusión quedaba registrada como hecha. El nombre de la
  obra sí puede faltar: es cosmético.
- Al sexto intento el mensaje va a la cola de mensajes fallidos, que tiene
  alarma. Un aviso ahí es una notificación que no llegó.
- En pruebas y en local (sin cola) todo sigue corriendo en la petición.

### D-26. Cambiar la contraseña revoca todas las sesiones y emite una nueva
**Estado: en dev y prod desde el 1 de octubre de 2026 (`d750646`; el índice,
`8b072e9`, se desplegó antes). Reproducido en dev antes de corregir; verificado
con la prueba de punta a punta en los dos ambientes (26 de 26).**

**El síntoma.** Tras cambiar la contraseña inicial, crear el PIN respondía
"Debes cambiar tu contraseña inicial". El autorizador cachea su respuesta 60
segundos por token, y el cambio no emitía token nuevo: durante ese minuto el
autorizador seguía diciendo `credencialProvisional=true`, y el enrolamiento,
que llega segundos después, caía siempre en esa ventana. En dev, con el mismo
token y sin tocar el cliente: 403 a los 2 s del cambio, 200 a los 69 s. El
frontend no era la causa.

**Lo que había detrás.** Cambiar la contraseña no revocaba ninguna sesión. Con
la contraseña inicial de D-13, quien conoce un RUT puede entrar antes que su
dueña y dejar abierta esa sesión provisional. Cuando ella cambiaba la
contraseña, la sesión ajena dejaba de ser provisional y quedaba completa por
seis horas. Pasaba lo mismo con el restablecimiento por correo y por un
administrador.

**Qué se decidió.**

- Cambiar la contraseña, restablecerla por correo y restablecerla un
  administrador **revocan todas las sesiones de la persona** (`activa=false`,
  con `revocadaEn`). También las de sus fichas en otras empresas, porque
  `propagarPassword` les cambia la contraseña.
- El cambio con sesión responde con **una sesión nueva** (token, `sessionId`,
  vencimiento y usuario), y el frontend la adopta en el acto. Se revoca antes de
  emitirla: al revés, se revocaría también la nueva.
- Si no se pueden revocar, el cambio responde 503 y no entrega sesión nueva:
  informar que todo salió bien con las sesiones anteriores vivas es justo lo que
  esto cierra. Queda medido como `auth.revocarSesiones`.
- Para encontrar las sesiones, la tabla tiene un índice nuevo,
  `personaId-index`, que proyecta solo claves (como en D-6).
- No se bajó el caché del autorizador. Sigue siendo de 60 s, y una sesión
  revocada puede seguir respondiendo hasta ese minuto, igual que un cierre de
  sesión. En la práctica, lo que pueda haber quedado cacheado para la sesión
  provisional solo sirve para cambiar la contraseña, y eso exige conocer la
  nueva.

**Despliegue.** El índice va en un commit propio que se despliega primero.
Mientras DynamoDB llena un índice nuevo, no se lo puede consultar, y si el
código llegara en el mismo despliegue, un cambio de contraseña en esa ventana
respondería 503. El backend y el frontend van juntos (regla 4). Con el frontend
anterior, el token viejo queda revocado y la persona vuelve a la pantalla de
ingreso.

### D-27. Los borradores del plan de actividades se pueden eliminar
**Estado: implementado el 12 de octubre de 2026. En dev, no en prod (verificado el
30 de octubre de 2026): el backend de dev corre `b7c3e88` y el frontend `6aa53d1`,
que contienen `ccf181f`; prod sigue en `d750646`.**

**El pedido.** Planificar el mes crea borradores de actividades (`estado:
'borrador'`) que a veces no se van a realizar. No había forma de quitarlos.

**Qué se decidió.**

- `DELETE /activities/{id}` borra el registro, pero **solo si es un borrador**:
  sin asistentes, sin firma del relator y sin respaldo cargado (evaluación o
  duración). Cualquier otra actividad responde 409. La tabla de retención trata
  las actividades como evidencia por cinco años (D-2); un borrador sin firmas no
  acredita nada ni avisó a nadie, así que no es evidencia, y una actividad
  programada, realizada o cancelada nunca se borra por esta vía.
- Se borra de verdad, no se marca cancelada. Cancelarlo dejaba una tarjeta
  tachada en el calendario por algo que nunca ocurrió. Como consecuencia, volver
  a planificar el mes sobre esa fecha crea el borrador de nuevo, porque la
  idempotencia del plan mira las actividades que existen; el manual lo advierte.
- El borrado lleva condición en DynamoDB (sigue en borrador, sin asistentes, sin
  firma del relator y de la misma empresa): si alguien lo programó o firmó entre
  la lectura y el borrado, se rechaza con 409 en vez de borrarlo. El plan guarda
  los borradores con `firmaRelator: null` y `asistentes: []`, y en DynamoDB un
  atributo nulo existe: la condición acepta el atributo ausente **o** de tipo
  NULL. La primera versión usaba solo `attribute_not_exists` y rechazaba todo
  borrador real; el doble de pruebas ahora evalúa la condición como DynamoDB.
- Autoriza la misma regla que editar la actividad: su relator o responsables, o
  quien tiene `actividades.crear`, tomado de la sesión.

**Despliegue.** Es una ruta nueva que usa el frontend: backend y frontend van
juntos (regla 4). Con el backend anterior, el botón responde un error y no borra
nada.

**Pruebas.** `Backend/tests/activities-handler.test.js`, casos `DELETE`. Se
comprobó que fallan al quitar cada chequeo (estado, firmas, respaldo,
autorización, empresa, sesión, la condición del borrado y su manejo).

### D-29. Consentimiento por finalidad (Actividad 5)
**Estado: implementado el 29 de octubre de 2026 (en el árbol). D-28 queda reservada para la minimización de la Actividad 4.**

- Solo tres tratamientos dependen del consentimiento: la **Ficha Básica de Salud**, la **foto de perfil** y el **dictado por voz con IA** (el audio sale a Google, fuera de Chile). El resto tiene otra base (obligación legal del DS 44 y la Ley 16.744, contrato de trabajo) y se informa al titular sin preguntarle: un consentimiento que no se puede negar no es libre (`lib/gobernanza/consentimiento.js`, `BASES_SIN_CONSENTIMIENTO`).
- Registro por persona y finalidad en la tabla de gobernanza (`CONSENT#<persona>#<finalidad>`): estado, versión del texto, `otorgadoEl`, `revocadoEl`, canal. Cada cambio deja un evento en el historial que solo crece (`CONS#...`). La ficha lleva una copia mínima (`consentimientos`, conjunto de `finalidad@versión`) escrita en la **misma transacción**, para decidir sin lecturas extra.
- Los textos están versionados en el código; la vigencia exige la versión actual. Aceptar un texto que ya no es el vigente se rechaza.
- Revocar no pide contraseña. Efectos: la ficha de salud no se puede responder y sus respuestas dejan de mostrarse a terceros (quedan retenidas); la foto deja de salir en toda respuesta y no se puede subir otra; el dictado devuelve 403 antes de enviar el audio. La supresión de lo ya entregado va por solicitud y lote de dos personas, que ahora incluye las respuestas de la ficha de salud (`quitar_respuestas`).
- **Menores:** no hay titulares menores de 18. El DS N° 1 de 2021 del Ministerio del Trabajo prohíbe a menores de 18 el trabajo en faenas de construcción (art. 2 y art. 4, letra A, N° 31). El alta y la rectificación rechazan una fecha de nacimiento de un menor (`problemaEdadMinima`), y el consentimiento también.
- **Decisión para la persona responsable:** las respuestas de la Ficha Básica de Salud anteriores a este módulo no tienen constancia de consentimiento y quedan retenidas (no se muestran a terceros) hasta que cada persona lo otorgue. Lo mismo las fotos de perfil existentes.

### D-30. Ejercicio de derechos por el titular y flujo de solicitudes (Actividad 5)
**Estado: implementado el 29 de octubre de 2026 (en el árbol).**

- **Autoservicio** (`/gobernanza/mis-datos`, `handlers/gobernanza/titular.js`, pantalla "Mis datos y privacidad"): descargar una copia (portabilidad), pedir rectificación, supresión, oposición o bloqueo, y ver el estado. Lo sensible exige volver a escribir la contraseña; tres errores en 15 minutos cierran las sesiones de la cuenta.
- **Exportación** en JSON con esquema declarado (`buildandserve.datos-titular` v1), armada por lista blanca: nada de terceros (de cada registro compartido sale solo lo del titular) ni interno (hashes, HMAC, sobres, IP, sesiones). Hasta 3 por día; la cuarta se rechaza y alerta. Sin registro en la auditoría no se entrega.
- **Flujo y etapas:** recibida, verificada (en evaluación), respondida, cerrada. La etapa se calcula de lo registrado (`etapaDe`). Acoger exige identidad verificada; se registra el método (sesión y contraseña, cédula en persona, correo registrado u otro), nunca el número de documento.
- **Rectificación:** campos de identidad (nombre, apellidos, RUT, fecha de nacimiento), validados (RUT, edad mínima, caracteres). Los valores propuestos viajan cifrados y se borran de la solicitud al responder; se aplican en la misma transacción que la respuesta. Un RUT nuevo actualiza el vínculo `afectadoRutHmac` de los incidentes. Lo firmado (actas, documentos) no se reescribe: es la prueba de lo que se firmó. Desde el 8 de noviembre de 2026 la ejecución guarda además el valor anterior y el nuevo de cada campo, cifrados (D-36).
- **Canal de la empresa:** la solicitud que llega por carta o correo se registra como antes y ahora puede verificarse y, si es de acceso, exportarse desde el panel.

### D-31. Auditoría general y detección de eventos sospechosos (Actividad 5)
**Estado: implementado el 29 de octubre de 2026 (en el árbol).**

- `lib/gobernanza/auditoria.js` registra en `AuditoriaAccesosTable` (la de D-18) un catálogo cerrado de operaciones: ingresos y fallidos, verificaciones de identidad, consentimientos, solicitudes, exportaciones, rectificaciones, supresiones, cambios de fichas, roles y permisos, contención, alertas y la consulta de la propia auditoría.
- Atributos: identificador, fecha, categoría, operación, resultado, actor (personaId, `rut:<hmac>` sin sesión, operador), recurso, titulares, IP y canal, detalle acotado, TTL y **sello HMAC**. `sanear` rechaza contraseñas, tokens, RUT, correos, nombres, valores y textos largos.
- Protección: IAM de solo agregar y leer para todos los roles (incluido `RolSupresion`, que ahora escribe aquí), `Retain`, recuperación a un punto en el tiempo, y el sello que delata una alteración hecha sin la llave.
- Conservación por TTL: seguridad 1 año, alertas 2, operaciones sobre datos 5 (configurable). Los registros de acceso a salud de D-18 no llevan TTL.
- Consulta: permiso nuevo `empresa.auditoria` (solo administrador por defecto), pestaña Auditoría en Mi Empresa; cada consulta queda registrada de forma estricta.
- Detección (`lib/gobernanza/deteccion.js`): fuerza bruta contra una cuenta, contraseña reiterada al confirmar identidad (cierra sesiones), exportación sobre el límite, acceso masivo a salud y escalamiento de privilegios. Cada alerta queda en la auditoría, avisa en la bandeja y emite la métrica `EventoSospechoso` con su alarma.

### D-32. Plan de respuesta a incidentes y contención (Actividad 5)
**Estado: plan escrito y scripts implementados el 29 de octubre de 2026. Cierra el punto 7.4 del checklist salvo la validación legal de plazos y responsables.**

- `docs/plan-respuesta-incidentes.md`: fases, responsables, criterios, escalamiento, notificación y cierre. La Ley 21.719 no fija horas para notificar ("sin dilaciones indebidas"); los plazos internos son compromisos del plan. La Ley 21.663 solo aplica si la plataforma o una constructora son calificadas como servicio esencial u operador de importancia vital.
- `Backend/scripts/contencion.js` (lógica en `lib/gobernanza/contencion.js`): preservar evidencia con huella, revocar sesiones, suspender y reactivar cuentas, revocar vales de firma. Exigen operador y motivo, y quedan en la auditoría.

### D-34. Producción solo en buildandserve.cl: la URL de CloudFront sale del CORS y se redirige
**Estado: decidido el 6 de noviembre de 2026; en producción desde el 7 de noviembre
(`14fa693`). Verificado: `d30jksx91fodea.cloudfront.net` responde 301 a
`https://buildandserve.cl/`, la API de prod no acepta ese origen (preflight sin
`Access-Control-Allow-Origin`) y la prueba de punta a punta de prod lo comprueba.
D-33 la usa la rama `tours` (recorridos guiados).**

**Qué se decidió.** La URL de CloudFront de producción
(`https://d30jksx91fodea.cloudfront.net`) deja de ser un origen de la aplicación:

- sale de `corsOrigins.prod` en `Backend/serverless.yml`, que es el CORS de la API
  y de los buckets de prod: queda solo `https://buildandserve.cl`;
- la función de CloudFront que redirigía `www` (`RedireccionWww`) redirige
  también ese host con 301 a `https://buildandserve.cl`, con la misma ruta y
  consulta. Va en la misma función porque una distribución admite una sola
  función por evento, y conserva nombre e identificador para no reemplazarla
  estando asociada. No agrega recursos al stack del frontend.

Las dos cosas van juntas: sin la redirección, una página servida en ese host
cargaría y no podría hablar con la API.

**Por qué sin medir.** El pendiente decía medir antes el tráfico con ese
`Origin`. No se puede con los registros actuales: la API de prod no tiene
registro de acceso (y el de HTTP API no permite registrar `Origin`), ningún
handler registra esa cabecera, y la distribución no tiene registro de
CloudFront. Medir exigía activar uno de esos registros y esperar. Se decidió no
hacerlo: en prod solo existen las dos empresas del equipo y no hay clientes
reales, así que se corta antes de la marcha blanca, cuando no afecta a nadie de
afuera.

**Lo que queda, conocido.** El service worker de la app responde las
navegaciones con el `index.html` del precaché. Quien la instaló desde la URL de
CloudFront la sigue abriendo desde caché en ese origen, y su service worker no
se actualiza, porque `sw.js` responde 301 y los navegadores no aceptan un script
de service worker redirigido. Esa copia ya no puede hablar con la API. Se
resuelve borrando los datos del sitio de ese origen y reinstalando desde
`https://buildandserve.cl`; hoy solo afecta al equipo.

**Verificación.** `Backend/tests/dominio-unico-prod.test.js` ejecuta la función
de CloudFront con eventos reales (los dos hosts redirigidos, ruta y consulta con
valores vacíos, repetidos y con espacios, host en mayúsculas; el dominio propio
y otros hosts pasan), y fija el CORS de prod, que los scripts verifiquen prod en
el dominio propio y que ningún código use la URL de CloudFront. Al desplegar,
`desplegar-infra-frontend.sh` comprueba el 301, y la prueba de punta a punta en
prod, que la API rechaza ese origen. Los scripts de despliegue verificaban prod
en la URL de CloudFront: con la redirección habrían fallado en cada archivo, y
ahora verifican en `buildandserve.cl`. El enlace de las licencias, cuando falta
`FRONTEND_URL`, también pasó al dominio propio.

### D-35. Firma sin conexión con el PIN: vales cifrados en el equipo, sin oráculo, y PIN de 6 dígitos
**Estado: decidido el 8 de noviembre de 2026; en dev, pendiente de prod.
Iteraciones de PBKDF2 fijadas en 600.000 con la medición del mismo día (ver
"Medición").**

**Qué se decidió.** Sin red, la firma solo se toma con el PIN del trabajador,
también en la firma asistida:

- al habilitar la firma sin conexión (con red, cuando el servidor ya comprobó el
  PIN), el equipo guarda los vales cifrados con una llave derivada de ese PIN:
  PBKDF2-HMAC-SHA256 (600.000 iteraciones, guardadas con cada emisión) y
  AES-CTR **sin etiqueta**, con sal nueva por emisión y contador distinto por
  vale. Se cifran los 32 bytes crudos del vale, no su texto hex
  (`Frontend/src/utils/valesCifrados.ts`);
- un solo byte derivado de la llave dice si el PIN tecleado es plausible:
  descarta 255 de cada 256 PIN equivocados. Cinco PIN equivocados seguidos en el
  equipo borran los vales de esa persona (`colaFirmas.tomarVale`);
- el servidor cuenta los vales inexistentes presentados a nombre de una persona
  de la empresa y, al quinto, anula sus vales vigentes, registra
  `VALES_INVALIDOS` y dispara la alarma `vales-invalidos` (umbral 1). El contador
  vuelve a cero solo al emitir vales nuevos, que exige el PIN con red
  (`ValeFirmaService.registrarInvalido`);
- el PIN de firma pasa de 4 a 6 dígitos. Para firmar y pedir vales solo se
  acepta uno de 6; uno de 4 solo sirve para cambiarlo y, fuera de eso, ni se
  compara con el guardado ni cuenta como intento (409 `PIN_DEBE_CAMBIAR`). Quien
  entra con uno de 4 pasa por el cambio de PIN antes de seguir (`pinLargo` en la
  ficha; `pinDebeCambiar` en la sesión).

**Por qué sin etiqueta.** Con AES-GCM, quien copie el almacenamiento del equipo
prueba los PIN fuera de la app y la etiqueta le confirma el correcto: el PIN,
que sirve con red para cualquier firma, quedaría expuesto. Con 600.000
iteraciones, una RTX 4090 (hashcat, ~8,8·10⁹ iteraciones de PBKDF2-SHA256 por
segundo) recorre los 10.000 PIN de 4 dígitos en menos de un segundo, y el millón
de 6 dígitos en ~70 s; un notebook de 8 núcleos, en ~5 minutos y ~8 horas. Sin
etiqueta y con un byte, la copia solo reduce los candidatos: ~39 con 4 dígitos y
~3.900 con 6, que hay que confirmar contra el servidor, que corta al quinto.
Probabilidad de acertar antes del corte: 13% con 4 dígitos, **0,13% con 6**. Por
eso los 6 dígitos: sin el corte del servidor no cambiarían casi nada; con él,
son los que llevan el 13% al 0,13%.

**Medición (8 de noviembre de 2026).** Con `/medicion-pin` en dev, en un
Android 10 de gama baja (8 núcleos, 4 GB, Chrome 156), cinco derivaciones de
300.000 iteraciones tardaron 194, 182, 181, 183 y 178 ms: mediana de 182 ms. La
página proponía 830.000 para llegar a 500 ms en ese equipo. Se fijaron
**600.000** (~365 ms ahí): ese teléfono no es de los más débiles que habrá en
obra, y con 600.000 uno el doble de lento no pasa de ~750 ms por firma sin
señal. La protección principal es el corte del servidor al quinto vale
inválido; las iteraciones solo encarecen descartar PIN con una copia del
almacenamiento. Decidido por Adrean. Las iteraciones viajan con cada emisión,
así que subirlas no invalida vales ya guardados.

**Costos aceptados.**
- 1 de cada 256 PIN equivocados pasa el byte de comprobación: esa firma se guarda
  con un vale que no existe, el servidor la rechaza al sincronizar y se avisa en
  la app con el nombre de la persona hasta que alguien lo vea («tiene que firmar
  de nuevo»), y cuenta para el corte del servidor.
- Cualquier sesión de la empresa puede anular los vales de un compañero mandando
  cinco vales inventados a su nombre. No gana ninguna firma, queda registrado y
  dispara la alarma; la persona se vuelve a habilitar con señal.
- El contador de 5 intentos del equipo vive en el mismo almacenamiento: frena a
  quien prueba PIN dentro de la app, no a quien copió el almacenamiento (a ese lo
  frena el servidor).
- Sin WebCrypto (fuera de https) no se habilita la firma sin conexión: nunca se
  vuelve a guardar un vale en claro.

**Riesgo que queda.** Quien copie el almacenamiento de un equipo y además tenga
una sesión de la empresa tiene un 0,13% de confirmar el PIN de una persona antes
de que se anulen sus vales, y la alarma avisa al primer corte. Quien conoce el
PIN firma, con o sin esto.

**Verificación.** `Backend/tests/vales-cifrados.test.js` (WebCrypto real de Node:
PIN bueno y malo, quinto intento, sin oráculo, qué queda guardado, sal e IV,
vales en claro de antes), `vales-invalidos.test.js` (corte del servidor, métrica y
alarma), `pin-seis-digitos.test.js` y `pin-pantallas.test.js` (formato, PIN de 4
solo para cambiarlo, 409 en todas las rutas, cambio obligatorio), y la prueba de
punta a punta (PIN de 4 rechazado al crearlo y al pedir vales; cinco vales
inválidos anulan los de la persona).

### D-36. Oposición persistente al directorio de compañeros, y registro del valor anterior y nuevo de una rectificación
**Estado: decidido el 8 de noviembre de 2026 (actividad "Mecanismos técnicos
para el ejercicio de derechos"); en el árbol, por commitear. El tratamiento
oponible lo eligió Benjamin.**

**Qué faltaba.** Contra la checklist de la actividad, dos puntos quedaban cortos:
una oposición acogida levantaba el bloqueo temporal y no dejaba nada, así que el
tratamiento seguía haciéndose; y la rectificación registraba qué campos cambiaron,
quién y cuándo, pero no el valor anterior ni el nuevo.

**Oposición.**
- Los tratamientos oponibles están en `TRATAMIENTOS_OPONIBLES`
  (`Backend/lib/gobernanza/derechos.js`, espejo del tipo en
  `Frontend/src/api/gobernanza.api.ts`). Son los que no descansan en una
  obligación legal, en el contrato ni en el consentimiento: lo que depende del
  consentimiento se retira revocándolo.
- Hoy hay uno: **`directorio_companeros`**, aparecer ante compañeros sin
  `personas.ver` en `GET /personas` y en `/inbox/recipients`. Su base es el
  interés legítimo de coordinar la obra. Quien tiene `personas.ver` lo sigue
  viendo: gestionar al personal sí es contrato y obligación legal. Se eligió
  porque es el único tratamiento del sistema con esa base. Los correos son todos
  transaccionales o de seguridad (credenciales, recuperación, PIN restablecido).
- Toda oposición nueva indica su tratamiento, por los dos canales. Sin él se
  rechaza, antes de pedir la contraseña en el autoservicio.
- Acogida, la respuesta escribe en la misma transacción `oposiciones` en la ficha
  (conjunto) y la ejecución en la solicitud, con su evento en el historial. El
  bloqueo temporal se levanta como antes: la marca toma su lugar.
- Rechazada, no deja marca. Una oposición registrada antes de este cambio, sin
  tratamiento, se puede responder, pero no marca nada (el panel lo advierte).
- El titular la retira desde Mis datos (`POST /gobernanza/mis-datos/oposiciones/{tratamiento}`).
  Basta la sesión, como al otorgar un consentimiento: amplía el tratamiento solo
  por su decisión y no entrega datos. Queda en la auditoría
  (`derechos.oposicion_retirada`).
- Se informa en el aviso de privacidad (derechos y bases), en "Mis datos" y en
  la copia de los datos (`solicitudes.oposicionesVigentes`).

**Rectificación.**
- La ejecución guarda `valoresCifrados`: un sobre con `{ campo, anterior, nuevo }`
  por campo, calculado contra la ficha actual al aplicar. Quién y cuándo van en
  claro en la misma ejecución.
- El valor anterior no se trata: ningún listado ni pantalla lo lee. Solo el
  detalle de la solicitud lo descifra, para quien tiene
  `empresa.derechos_titulares`, y cada apertura queda en la auditoría
  (`derechos.rectificacion_consultada`). El listado, la respuesta y la vista del
  titular no llevan el sobre.
- Antes no se guardaba el valor anterior, para que el dato inexacto dejara de
  tratarse. La clase pide poder demostrar qué se corrigió. Guardarlo cifrado y
  sin uso cumple las dos cosas.
- Conservación: la misma de la solicitud, que es la prueba de cumplimiento. Las
  tablas de gobernanza siguen sin clase de retención (`TABLAS_DE_GOBERNANZA` en
  el inventario). Queda pendiente definirla.

**Verificación.** `Backend/tests/oposicion-rectificacion.test.js`: oposición sin
tratamiento, de punta a punta con el directorio y la bandeja, rechazada, retirada
por el titular y no por otro, en la copia de los datos, y rectificación con valores
cifrados, detalle auditado y sin el sobre en el listado. Además,
`derechos-titular.test.js` (reglas puras). Los 13 sabotajes se detectaron.

## 4. Hallazgos priorizados

### H-1. El PIN usaba SHA-256 sin función de derivación con costo
**Severidad: alta — RESUELTO el 18 de septiembre de 2026 (ver D-7)**

El PIN es de cuatro dígitos: 10.000 combinaciones posibles. SHA-256 está diseñado para ser
rápido, de modo que quien obtuviera la base de datos **y** el secreto del servidor podría
recorrer el espacio completo en segundos y recuperar el PIN de todas las personas.

Al implementar la corrección apareció algo peor que lo descrito: **el secreto del
servidor no existía**. `PIN_SALT` se leía del entorno pero nunca estuvo declarada
en `serverless.yml`, así que en AWS valía `undefined` y el hash era SHA-256 de un
texto enteramente predecible. La condición "quien obtuviera la base de datos **y**
el secreto" era en realidad "quien obtuviera la base de datos".

**Corregido:** scrypt con sal por hash y pimienta de servidor en SSM
(`Backend/lib/credenciales.js`). La migración de lo ya guardado es progresiva: se
re-hashea en el siguiente ingreso exitoso de cada persona, sin pedirle nada a
nadie y sin invalidar ninguna credencial existente.

**Ubicación:** `Backend/lib/credenciales.js`, `Backend/lib/utils/validation.js`

### H-2. No hay límite de intentos de PIN
**Severidad: alta — RESUELTO el 22 de septiembre de 2026 (ver D-9)**

Nada impide probar las 10.000 combinaciones contra el endpoint de firma.

Con H-1 resuelto este hallazgo **cambia de forma pero no se cierra, y pasa a ser el
que manda**: la función de costo encarece cada intento (unos 112 ms de CPU del
servidor, no del atacante) y la pimienta hace inútil un volcado de la tabla, pero
contra la API en línea siguen sin existir ni contador de intentos ni bloqueo. A
112 ms por intento y con concurrencia, las 10.000 combinaciones de un PIN conocido
siguen siendo alcanzables; lo que antes costaba segundos ahora cuesta horas de
tráfico visible, que es mejor, pero no es un límite.

**Corregido:** contador de intentos fallidos por persona (no por sesión ni por
IP: la sesión que ataca puede cambiar, la persona atacada es siempre la misma, y
en terreno la IP no discrimina nada porque sale toda por la misma NAT de la
obra). Bloqueo progresivo — 1, 5, 15 y 60 minutos, tope en el cuarto nivel — con
reseteo en el primer PIN correcto. Cubre los cuatro lugares donde se verifica un
PIN: vales, firma directa, cambio de PIN y enrolamiento.

A diferencia del login o la recuperación de contraseña, el bloqueo **sí se
comunica** hacia afuera: quien lo prueba ya sabe que la persona existe, así que
la ambigüedad no protege nada acá y sí es información operativa legítima para
quien solo se equivocó.

**Ubicación:** `Backend/lib/limitePin.js`

### H-3. Sin recuperación a un punto en el tiempo
**Severidad: media — RESUELTO (ver 6.5). Verificado el 6 de noviembre de 2026: las
22 tablas de dev y las 22 de prod responden `PointInTimeRecoveryStatus: ENABLED`.**

Un borrado accidental o una corrupción de datos no tienen vuelta atrás. Para un sistema cuyo
valor es la evidencia de cumplimiento ante fiscalización, la pérdida de datos es la falla más
costosa posible.

**Corrección:** habilitar `PointInTimeRecoverySpecification` en las tablas con datos de
cumplimiento y datos personales.

### H-4. Cifrado en reposo y exposición del almacenamiento no declarados
**Severidad: media — RESUELTO salvo los logs (ver 6.2, 6.3, 6.4 y D-4).
Verificado el 6 de noviembre de 2026: tablas y buckets de datos con la CMK de su
ambiente; los cuatro buckets con las cuatro opciones de bloqueo público en `true`
y versionado `Enabled`. Los grupos de logs no tienen llave propia.**

Los buckets no bloquean explícitamente el acceso público, aceptan cualquier origen CORS, y ni
buckets ni tablas declaran su configuración de cifrado. Aunque AWS cifra por defecto, ante un
tercero evaluador **lo que no está declarado no se puede acreditar**.

**Corrección:** `PublicAccessBlockConfiguration` con las cuatro opciones activas, `AllowedOrigins`
acotado a los dominios de la aplicación, y `BucketEncryption` / `SSESpecification` explícitos,
idealmente con clave gestionada por el cliente.

### H-5. No se audita el acceso a datos sensibles
**Severidad: media — PARCIAL. Resuelto para datos de salud (D-18), en dev y prod.
La auditoría general (D-31) está en el árbol, sin desplegar (verificado el 6 de
noviembre de 2026). Ver 5.6.**

El resguardo de documentos de salud impide el acceso indebido, pero no deja rastro de los
accesos legítimos. Para datos sensibles, el registro de acceso es lo que permite **detectar** un
uso indebido por parte de quien sí tiene permiso.

**Corrección:** registrar consulta y descarga de documentos de salud con persona, fecha y
documento, con retención acotada.

### H-6. Sin gobernanza del ciclo de vida del dato personal
**Severidad: media, con plazo normativo — PARCIAL (ver 7.1 a 7.4). Verificado el 6
de noviembre de 2026: en prod existen `retencionDiaria` (31 ejecuciones en los
últimos 30 días, ninguna con error), `gobernanzaDerechos`, `alertasDerechos` y
`gobernanzaLotes`. No se comprobó si se ejecutó alguna supresión.**

No hay política de retención, ni mecanismo de supresión a solicitud, ni registro de
tratamientos, ni protocolo de notificación de brechas.

**Contexto normativo:** la Ley 21.719 sobre protección de datos personales entra en vigencia en
**diciembre de 2026** y hace exigibles estos cuatro elementos, con régimen sancionatorio
asociado y una agencia con potestad fiscalizadora.

### H-7. Sin huella de integridad del archivo almacenado
**Severidad: baja — RESUELTO el 26 de septiembre de 2026 (ver D-12)**

El sistema preserva el documento original y registra quién lo firmó, pero no calcula una huella
del binario al subirlo. No se puede demostrar criptográficamente que el archivo servido hoy es
idéntico al que se subió.

**Corrección:** calcular SHA-256 del archivo al confirmar la carga y guardarlo junto al
documento; verificarlo al descargar.

### H-9. La huella de los informes firmados no cubría su contenido
**Severidad: alta — RESUELTO el 25 de septiembre de 2026 (ver D-11)**

`RegistroService.hashSnapshot` hacía `JSON.stringify(snapshot,
Object.keys(snapshot).sort())` para "ordenar las claves". Un arreglo como
segundo argumento de `JSON.stringify` no ordena: es una lista de propiedades
permitidas, aplicada en todos los niveles. En el informe de investigación del
Art. 71 lo que se firmaba era `"afectado":{}`, `"accidente":{}`,
`"causasRaiz":[{}]`: se podía cambiar al trabajador accidentado, la gravedad,
marcarlo como fatal, borrar los días perdidos o reescribir la causa raíz, y la
huella quedaba idéntica. Un documento que parecía inalterable no lo era. Se
detectó al diseñar el cifrado de esos snapshots, antes de que se firmara
ninguno (0 informes en dev y en prod).

### H-10. El descifrado aceptaba etiquetas de autenticación truncadas
**Severidad: media — RESUELTO el 26 de septiembre de 2026**

`cifradoCampo` descifraba AES-256-GCM sin fijar `authTagLength`, y en ese caso
Node acepta etiquetas desde 32 bits. En GCM un prefijo de la etiqueta correcta
también verifica: se comprobó que la etiqueta REAL de un sobre, recortada a 32
bits, descifraba sin error. Una etiqueta de 32 bits se forja probando del orden
de 2^32 variantes, así que el sobre dejaba de probar que el contenido no fue
alterado. Ahora se fija `authTagLength: 16` al cifrar y al descifrar, y además
se rechaza cualquier etiqueta de otro largo antes de llegar a Node. La prueba
usa la etiqueta real recortada, en cada largo de 4 a 15 bytes, porque ese era
exactamente el caso que pasaba.

### H-11. Datos personales en los logs de CloudWatch
**Severidad: media — RESUELTO el 26 de septiembre de 2026**

`IncidentsRepository.create` y `update` escribían en CloudWatch la carga
completa con `JSON.stringify(data)`: el RUT, el nombre y el género del
trabajador y el relato del accidente, en claro — por fuera del cifrado que
protege esos mismos datos en la tabla. Revisando el resto aparecieron el nombre
del prevencionista notificado, el nombre del archivo de evidencia (que suele
llevar el de la persona), el cuerpo completo de las respuestas del buzón y las
direcciones de correo en las notificaciones. Ahora se registran identificadores
(y las claves de los campos que cambian, nunca sus valores); los correos van
enmascarados. Hay una prueba de comportamiento que captura todo lo que se
loguea al crear y actualizar un incidente, y un control que falla si otro log
vuelve a serializar una entidad. En los grupos de log de dev había 2 volcados
con RUT y nombres; se borraron sus dos streams (CloudWatch no borra eventos
sueltos; se fueron 408 eventos de depuración de dev con ellos). En prod no
había ninguno.

**Nota aparte:** `IncidentsRepository` crea sus propios clientes de DynamoDB,
S3 y SNS en vez de usar los compartidos de `lib/clients`: otro camino propio por
fuera de los servicios centrales, sin consecuencia de seguridad hoy.

### H-12. No se podía registrar a nadie sin correo
**Severidad: alta — RESUELTO el 27 de septiembre de 2026 (en el árbol, sin desplegar)**

La contraseña inicial son los cuatro primeros dígitos del RUT precisamente
porque en terreno mucha gente no tiene correo. Pero `PersonaService.crear`
escribía `email: ''`, `email` es la clave de `email-index`, y DynamoDB
rechaza la escritura completa si una clave de índice viene vacía: el alta
manual y la carga masiva fallaban para cualquiera sin correo. Las 18 personas
de dev y prod tienen correo; la primera carga masiva real habría fallado. Y
aunque se hubiera podido crear, la contraseña inicial solo se generaba si había
correo, así que esa persona no habría podido entrar.

Ahora sin correo no se escribe el atributo (la persona queda fuera del índice),
borrar el correo al editar lo quita en vez de dejarlo vacío, y la contraseña
inicial se genera con o sin correo. Quien registra la recibe en pantalla para
decírsela en persona.

Que esa contraseña inicial derive del RUT es un riesgo aceptado, no un
pendiente: ver D-13.

**Recuperación de contraseña sin correo:** la respuesta es la misma para todos
(no revela si el RUT existe ni si tiene correo), no se envía nada ni se guarda
un token. La única salida es que un administrador restablezca la contraseña;
la respuesta genérica ahora lo dice.

**Mismo error en otra tabla:** se revisaron todas las claves de índice de las
17 tablas. La única otra era `POST /signatures/enroll`, que escribía
`requestId: null` (clave de `requestId-index`) y por eso fallaba siempre. Esa
ruta además registraba una firma de enrolamiento "válida" **sin verificar el
PIN**; corregir el `null` la habría vuelto un camino para crear firmas sin PIN.
El frontend no la usaba: se retiró (responde 410). El enrolamiento es
`POST /personas/{id}/enrolamiento`, que sí verifica el PIN.

Las pruebas usan un doble de DynamoDB con los esquemas reales de
`serverless.yml` (`Backend/tests/doble-dynamo-tablas.js`) que rechaza, como
DynamoDB, una clave de índice vacía o de otro tipo.

### H-13. XSS almacenado en los informes imprimibles: robo del token de sesión
**Severidad: alta — RESUELTO el 28 de septiembre de 2026 (en el árbol, sin desplegar)**

El Registro AT/EP de la obra y la impresión del listado de incidentes armaban
HTML en el navegador interpolando sin escapar la descripción de un hallazgo, el
centro de trabajo y el nombre del trabajador. Ese HTML se abría como URL `blob:`
o con `document.write` en una pestaña nueva, y en los dos casos corría con el
origen de la aplicación: un script ahí adentro podía leer el `auth_token` de
`localStorage`. Cualquier sesión puede reportar un hallazgo con descripción
libre, así que bastaba escribir un `<script>` en la descripción y esperar a que
un prevencionista generara el registro o imprimiera. Se confirmó en el código;
no se ejecutó contra un ambiente real.

Se trató como categoría, barriendo frontend y backend:

- **Un solo escapado por lado**: `Backend/lib/escaparHtml.js` y su gemelo
  `Frontend/src/utils/escaparHtml.ts`. Una prueba verifica que den lo mismo.
  Había cuatro copias en el backend, tres sin la comilla simple.
- **Frontend**: las dos plantillas pasaron a funciones puras en
  `utils/informesHtml.ts`, con todo dato escapado, y un único sumidero
  (`abrirHtmlEnPestana`) que también usa el export del FUF. El `document.write`
  de la pestaña de espera se reemplazó por texto.
- **Backend**: los informes que se guardan en S3 como evidencia ya escapaban,
  salvo dos conteos (sin riesgo real hoy, escapados igual); el export del FUF
  tenía dos campos sin escapar; y los correos de SES (bienvenida,
  recuperación, licencia de alta y sugerencias) interpolaban nombre, empresa,
  enlaces y mensaje sin escapar, lo que permitía phishing con el nombre de la
  plataforma.
- **La prueba** (`Backend/tests/html-sin-escapar.test.js`): falla si aparece
  un sumidero de HTML (innerHTML, document.write, dangerouslySetInnerHTML, Blob
  `text/html`…) fuera de la lista revisada, o un escapado propio. Además
  ejecuta cada plantilla, del frontend y del backend, incluidos los correos, con
  un hallazgo que trae `<script>` y `<img onerror>`, y exige que el HTML tenga
  exactamente las mismas etiquetas que con texto normal. Se verificó rompiendo
  cada protección.

### H-14. RUT en claro fuera del cifrado de campo, e incidentes sin vínculo con la persona afectada
**Severidad: media — RESUELTO el 28 de septiembre de 2026 (en el árbol; migración de datos pendiente del deploy)**

Al armar el inventario aparecieron dos cosas:

- **RUT en claro.** `incidents.realizadoPor.rut` lo mandaba el navegador y el
  backend lo guardaba tal cual, por fuera del cifrado de campo (D-10), y la
  pantalla de detalle lo mostraba. Además quedaba un RUT en claro en
  `tenants.reglas.representanteLegal.rut` de una ficha anterior a la corrección
  del representante. En dev había 2 y 1; en prod, ninguno (todavía sin datos).
  El backend ya no lo guarda, el frontend ya no lo manda ni lo muestra, y
  `Backend/scripts/migrar-gobernanza-2026-09.js` quita los que quedaron.
- **Incidentes sin vínculo.** Un incidente no guardaba el `personaId` de la
  persona afectada, solo su nombre, y el RUT cifrado en la traza. La retención y
  la supresión no tenían cómo encontrar los incidentes de alguien sin descifrar
  todos. Ahora se guarda `afectadoRutHmac`, el mismo HMAC con que se busca a la
  persona en su ficha, y la migración lo calcula para los existentes.

### H-15. El Registro AT/EP y la investigación de accidentes traen salud sin el resguardo de los documentos de salud
**Severidad: media — ABIERTO (decisión de producto pendiente)**

El Registro AT/EP guardado como evidencia lista, por persona en vigilancia, sus
protocolos y su aptitud laboral; el informe de investigación describe las
lesiones del accidente. Ninguno de los dos tipos está entre los documentos de
salud (`lib/documentos-salud.js`), así que los ve y descarga cualquiera con
acceso a los documentos de la empresa, sin el permiso de vigilancia que exigen
los exámenes. Desde el 29 de septiembre de 2026 su lectura y descarga quedan en
la auditoría (D-18), pero quién debe poder verlos es una decisión de producto:
restringirlos al permiso de vigilancia, o sacar del registro el detalle por
persona y dejar solo los conteos.

### H-16. Cualquier sesión lista todo el personal de su empresa
**Severidad: media — RESUELTO el 1 de octubre de 2026, sin desplegar (verificado
el 6 de noviembre de 2026: no está en ningún ambiente). Encontrado el 30 de
septiembre por la prueba de punta a punta, en dev.**

**Resolución.** El listado no se corta, se recorta: sin `personas.ver`, `GET
/personas` devuelve de cada persona solo identificador, nombre, apellidos y
cargo; con el permiso, la ficha completa (`Backend/tests/listado-personas.test.js`).
Se revisaron las pantallas que usan el listado. Los roles sin `personas.ver`
(`trabajador`, `colaborador`) alcanzan cinco: el reporte de incidentes, el
listado de incidentes, encuestas, actividades y solicitudes de firma. Las tres
del medio y la última usan la lista solo en funciones que exigen permisos que
traen `personas.ver`. Actividades usa nombre, cargo e identificador. El reporte
de incidentes usaba el RUT en dos lugares: el trabajador accidentado, que es
del formulario de incidente y exige `incidentes.reportar` (todos los roles con
ese permiso tienen `personas.ver`), y el afectado de un hallazgo por acción
insegura, que sí lo reporta una trabajadora. Ese afectado ahora se guarda con su
identificador, que el backend comprueba que sea de la empresa (404), y sin RUT
cuando quien reporta no ve fichas. Un rol propio de una empresa con
`obras.detalle` y sin `personas.ver` verá el equipo de la obra con nombre y cargo,
sin RUT: es lo coherente con no tener ese permiso.

**Lo que decía al encontrarlo:**

`GET /personas` solo exige sesión: no pide `personas.ver`. Una persona con rol
`trabajador`, recién enrolada, recibe la lista completa del personal de su
empresa con RUT, correo y fecha de nacimiento de cada una. Los datos de salud no
viajan (5.2b), y el aislamiento entre empresas se mantiene. Aun así, es
bastante más de lo que una trabajadora necesita (checklist 7.5).

No se corrigió en el acto porque unas quince pantallas usan ese listado,
algunas de uso posible en terreno (por ejemplo, el reporte de incidentes).
Exigir el permiso sin revisarlas puede dejar a una trabajadora sin poder
reportar. Hay que decidir qué necesita ver cada rol: probablemente un listado
mínimo (nombre y cargo) para elegir personas, y la ficha completa solo con
`personas.ver`. Cuando se decida, la prueba de punta a punta agrega la
comprobación (hoy verifica solo que la trabajadora no puede dar de alta).

### H-17. Rutas que tomaban la empresa o el actor del cliente, fuera de la revisión por módulos
**Severidad: alta — RESUELTO el 1 de octubre de 2026, sin desplegar (verificado el
6 de noviembre de 2026: no está en ningún ambiente). Encontrado por la sesión de
product tours (las dos primeras) y por la prueba estructural (el resto). La
comprobación de sesión de `/ai/transcribe` llegó a `HEAD` con la Actividad 5
(`57c5a9b`), junto con el consentimiento para el dictado.**

- **`/signature-requests`**: ninguna de sus siete rutas llamaba a `conSesion`.
  `GET` tomaba la empresa de la consulta y descifraba sus solicitudes; `get`
  comparaba la empresa solo si el cliente la mandaba; `create` tomaba el
  solicitante (y con él el permiso y la empresa) del cuerpo; `pending/{id}` sin
  empresa recorría la tabla de todas; `history/{id}` devolvía las firmas de
  cualquier persona de cualquier empresa; `cancel` cancelaba cualquier
  solicitud. Ahora: empresa y solicitante de la sesión; `firmas.crear` para
  crear, cancelar y ver estadísticas; sin él, solo las solicitudes propias;
  pendientes e historial de uno mismo o con `personas.detalle`, y de la empresa
  (404).
- **`/ausencias`**: empresa del cuerpo o la consulta y `registradoPor` del
  cuerpo, sin `conSesion`. Se leían, escribían y borraban ausencias de otra
  empresa, con su motivo ("Licencia médica"). Ahora: empresa y registrador de la
  sesión, obra y persona de la empresa (404), y el permiso de convocar
  actividades (`actividades.crear`), que es para lo que se registran.
- **`/ai/transcribe`**: sin `conSesion`; una sesión con la contraseña inicial
  usaba Gemini, que tiene costo.
- **`/personas/validate`**: corría sin `conSesion` (su comentario la daba por
  pública, pero la ruta tiene autorizador); con la contraseña inicial se
  consultaba si un RUT existe.
- **Gobernanza de hallazgos**: `verificadoPor` y `fechaVerificacion` se
  aceptaban del cuerpo salvo al cerrar; el responsable no se comprobaba.
- **Actividades**: el aviso de creación salía con `createdBy` igual al relator
  del cuerpo; relator, responsables y asistentes no se comprobaban contra la
  empresa, y la asistencia firmada con firma asistida no comprobaba la empresa
  de quien firmaba.
- **Documentos**: el relator no se comprobaba; firmar por una persona de otra
  empresa respondía 403 "no pertenece a tu organización", que confirma que el id
  existe. Ahora 404.

La pertenencia nueva pasa por `lib/auth/pertenencia.js`. Las pruebas:
`identidad-desde-sesion.test.js` (estructural), `rutas-identidad-sesion.test.js`,
`incidentes-identidad.test.js` y `activities-handler.test.js`; cada una falla con
el código anterior.

### H-8. El PIN se guardaba en claro en el dispositivo (modo sin conexión)
**Severidad: alta — RESUELTO el 16 de septiembre de 2026 (ver D-3)**

Cuando no hay red, la firma se guarda en `localStorage` junto con el **PIN en texto
plano** (`Frontend/src/hooks/useOfflineSignature.ts`), porque al sincronizar el
servidor necesita el PIN para validarla. En un dispositivo compartido de terreno
—que es el caso normal— cualquiera que lo tome puede leer los PIN de quienes
firmaron, y con un PIN se firma a nombre de esa persona.

Durante la auditoría se encontró además un comentario en el código que afirmaba
que el PIN se guardaba hasheado. No era cierto, y un comentario falso es peor que
ninguno: describe una protección que nadie fue a verificar. Ya se corrigió.

**Mitigaciones aplicadas** (no resuelven el fondo):
- El cierre de sesión borra las firmas pendientes del dispositivo. Tiene un costo
  deliberado: si quedaban firmas sin sincronizar, se pierden.
- Se eliminó el almacén `cachedWorkers` de IndexedDB, que guardaba en el
  dispositivo el **hash del PIN** de cada trabajador para una "validación sin
  conexión" que nunca se implementó: era una copia de credenciales sin nadie que
  la usara. La subida de versión del esquema lo borra en los dispositivos que ya
  lo tengan.

**Corrección aplicada:** el modo sin conexión ya no usa el PIN sino un vale de un
solo uso emitido por el servidor (D-3). Lo que queda en el dispositivo es una
credencial acotada a una firma, a una persona y a un turno; lo que quedaba antes
era la credencial permanente de firma de esa persona.

---

## 5. Cómo presentar el estado actual

La plataforma es **sólida en trazabilidad e integridad**, que es precisamente lo que el
DS 44 exige y donde está concentrado el trabajo: quién firmó qué, cuándo, desde dónde, sobre
qué versión del documento, y con qué constancia de difusión. Eso se puede afirmar y sostener.

Sobre el **control de acceso** corresponde ser más preciso de lo que era la versión anterior de
este documento. Hasta el endurecimiento de septiembre de 2026 la API **no tenía
autenticación**: el aislamiento entre empresas estaba diseñado en las claves de las
tablas pero no lo verificaba nadie, la empresa se leía de lo que mandaba el
cliente y los actores de cada acto —quién firma, quién publica, quién valida—
venían en el cuerpo de la petición. Eso ya está cerrado, módulo por módulo y con
pruebas que lo fijan (sección 2.1), y es un hecho que conviene declarar en vez de
omitir: un informe que dijera que el sistema siempre aisló sería falso, y un
tercero que lea el historial del repositorio lo va a ver.

La deuda restante está en tres frentes:

1. **Protección criptográfica de la credencial** (H-1, H-2, H-8). Es el punto más débil del
   sistema. H-8 —el PIN en claro en el dispositivo cuando no hay red— es el que hoy tiene
   mayor exposición real.
2. **Resguardo de la infraestructura** (H-3, 6.7): sin versionado en los buckets y sin
   recuperación a un punto en el tiempo en las tablas, un borrado es definitivo. Es además
   el prerrequisito de la política de retención decidida en D-2.
3. **Gobernanza del dato personal** (H-5, H-6). No es materia del DS 44 sino de la Ley 21.719,
   y tiene fecha: diciembre de 2026. La retención ya está decidida (D-2); falta implementarla
   y resolver los otros tres elementos.

---

## 6. Verificación

Las afirmaciones de este documento se obtuvieron leyendo el código de la rama de trabajo, no de
documentación previa. Los puntos marcados como **Pendiente** en la sección de infraestructura se
verificaron por ausencia:

```bash
# No devuelven resultados: la configuración no existe
grep -n "PublicAccessBlockConfiguration" Backend/serverless.yml
grep -n "PointInTimeRecoverySpecification" Backend/serverless.yml
grep -n "BucketEncryption\|SSESpecification" Backend/serverless.yml

# Confirman lo implementado
grep -n "timingSafeEqual" Backend/lib/utils/validation.js
grep -n "sourceIp\|user-agent" Backend/handlers/signatures/handler.js
node --test Backend/tests/documentos-salud.test.js
```

Lo verificado **contra AWS**, no contra el código (a septiembre de 2026):

```bash
# Recuperación a un punto en el tiempo: DISABLED en las tablas de producción
aws dynamodb describe-continuous-backups --table-name BuildAndServe-personas-prod \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus'

# Versionado de los buckets: sin configurar
aws s3api get-bucket-versioning --bucket buildandserve-repository-prod

# Proyección de los índices de personas: ALL (copia completa, con hashes y salud)
grep -n "ProjectionType" Backend/serverless.yml
```

El aislamiento entre empresas está fijado por pruebas que fallan si alguien lo
reabre:

```bash
node --test Backend/tests/rutas-autenticadas.test.js   # ninguna ruta sin sesión fuera de la lista declarada
node --test Backend/tests/aislamiento-tenant.test.js   # personas, documentos, firmas
node --test Backend/tests/aislamiento-tramo2.test.js   # obras, estructura preventiva, empresa
node --test Backend/tests/aislamiento-tramo3.test.js   # actividades, incidentes, encuestas, inbox
node --test Backend/tests/uploads-pertenencia.test.js  # archivos y URLs prefirmadas
```
