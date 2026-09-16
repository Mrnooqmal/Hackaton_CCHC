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
| 1.3 | La empresa sale de la sesión, nunca del cliente | **Implementado** | `tenantIdDeSesion(event)`. Antes era `query.tenantId \|\| authorizer.claims`, **en ese orden**: el valor del llamante ganaba. |
| 1.4 | Las lecturas y escrituras por identificador comprueban pertenencia | **Implementado** | Personas, documentos, firmas, actividades, incidentes, encuestas, obras, estructura preventiva, empresa y archivos. Responden **404** y no 403: que un identificador exista en otra empresa tampoco se informa. `Backend/tests/aislamiento-tenant.test.js`, `aislamiento-tramo2.test.js`, `aislamiento-tramo3.test.js`, `uploads-pertenencia.test.js` |
| 1.5 | La configuración de la empresa solo la toca su empresa | **Implementado** | El módulo de empresa tomaba el `tenantId` del path sin compararlo con la sesión: cualquier usuario podía reescribir los **roles y permisos** de otra empresa, es decir su control de acceso completo. Era el peor hallazgo del recorrido. |
| 1.6 | Una persona solo firma dentro de su empresa | **Implementado** | Validación previa a aceptar la firma. `Backend/handlers/signatures/handler.js` |
| 1.7 | Los documentos de una obra no acreditan a otra | **Implementado** | `documentosDelAmbito()` en `Backend/lib/completitud.js`. Cubierto por pruebas. |
| 1.8 | Los actores de cada acto salen de la sesión | **Implementado** | Quién crea, publica, valida, asigna, firma, reporta o resuelve se toma del token. Venían en el cuerpo de la petición, así que escribir el identificador de otra persona bastaba para actuar a su nombre — y para saltarse el permiso, porque varias comprobaciones solo corrían *si* el cliente se identificaba. |

### 2.2 Credenciales y autenticación

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 2.1 | El PIN nunca se almacena en texto plano | **Implementado** | Solo se guarda el hash. `Backend/lib/utils/validation.js` |
| 2.2 | El hash incorpora identificador personal y secreto de servidor | **Implementado** | `hashPin(pin, personaId)` con `PIN_SALT` desde variable de entorno. Dos personas con el mismo PIN obtienen hashes distintos. |
| 2.3 | Verificación resistente a ataques de temporización | **Implementado** | `crypto.timingSafeEqual`. |
| 2.4 | El hash nunca se expone en la API | **Implementado** | Campo interno; la respuesta solo informa si hay PIN configurado. `Backend/lib/models/Persona.js` |
| 2.5 | Mensajes de error genéricos ante credencial inválida | **Implementado** | No revelan si falló el PIN, el estado de la persona u otro. |
| 2.6 | **Función de derivación con costo para el PIN** | **Pendiente** | Usa SHA-256 simple. Ver hallazgo crítico H-1. |
| 2.7 | **Límite de intentos de PIN** | **Pendiente** | No existe bloqueo por intentos fallidos. Ver hallazgo crítico H-2. |
| 2.8 | **Throttling a nivel de API** | **Pendiente** | Sin plan de uso ni límite de tasa configurado en `Backend/serverless.yml`. |
| 2.9 | El token de sesión se almacena hasheado | **Implementado** | Se guarda `sha256(token)` y se resuelve por índice. Antes se guardaba el token en claro: un volcado de la tabla de sesiones era suplantación inmediata de cualquier usuario. `Backend/lib/auth/sesion.js` |
| 2.10 | **El PIN viaja y se guarda en claro en el modo sin conexión** | **Pendiente** | Las firmas tomadas sin red se guardan en `localStorage` con el PIN **en texto plano**, porque el servidor lo necesita para validarlas al sincronizar. Es el hallazgo abierto más grave. Mitigación aplicada: el cierre de sesión borra esas firmas pendientes del dispositivo (`Frontend/src/context/AuthContext.tsx`). Corrección de fondo: reemplazar el PIN por un token de un solo uso emitido por el servidor. Ver H-8. |

### 2.3 Sesiones y recuperación de acceso

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 3.1 | Sesión con expiración explícita | **Implementado** | Seis horas. `Backend/handlers/auth/handler.js` |
| 3.2 | Eliminación automática de sesiones vencidas | **Implementado** | TTL nativo de DynamoDB: la sesión se borra sola, no queda residuo. |
| 3.3 | Tokens de recuperación con aleatoriedad criptográfica | **Implementado** | `crypto.randomBytes(32)`. |
| 3.4 | Tokens de recuperación almacenados hasheados | **Implementado** | `hashResetToken()` con SHA-256; nunca se guarda el token en claro. |
| 3.5 | El cambio de contraseña actúa sobre la sesión, no sobre el cuerpo | **Implementado** | `changePassword` tomaba el `personaId` del cuerpo: con la contraseña temporal de cualquiera —que el propio sistema devolvía al resetear— se le cambiaba la contraseña a otra persona. |
| 3.6 | El alta de empresas no es un endpoint | **Implementado** | Era pública, tras un código compartido que además estaba vacío en los dos ambientes. La ejecuta el operador con `Backend/scripts/crear-empresa.js`: autorización por IAM y trazabilidad en CloudTrail. |

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
| 4.9 | **Hash de integridad del archivo almacenado** | **Pendiente** | No se calcula huella del archivo al subirlo, así que no se puede demostrar que el binario no fue alterado en el almacenamiento. |
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
| 5.6 | **Registro de auditoría de accesos a datos sensibles** | **Pendiente** | Se audita quién firma, no quién consulta una ficha de vigilancia. Ver hallazgo H-5. |
| 5.7 | **Cifrado a nivel de campo para RUT y datos de salud** | **Pendiente** | Quien acceda a la tabla los lee en claro. |
| 5.8 | **Los índices de personas proyectan todos los atributos** | **Pendiente** | `personaId-index`, `email-index` y `tenantRut-index` están declarados con `ProjectionType: ALL` (`Backend/serverless.yml`), así que cada índice contiene una **copia completa** de la ficha: hash del PIN, hash de la contraseña, RUT y campos de salud incluidos. Tres copias más de los datos sensibles, con la misma superficie de exposición que la tabla y sin que ningún consumidor necesite esos campos. Corrección: proyectar solo las claves y los atributos que cada índice usa realmente. Requiere recrear los índices, así que se planifica con ventana. |
| 5.9 | El RUT no viaja completo en la verificación pública de firmas | **Implementado** | `GET /signatures/verify/{token}` es público por diseño (un fiscalizador comprueba una firma sin cuenta), y devolvía nombre y **RUT completo**: el token se convertía en una consulta abierta de identidad. Ahora el RUT va parcial (`···.678-5`), que cumple igual la función de cotejo. |

### 2.6 Infraestructura y cifrado

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 6.1 | Cifrado en tránsito | **Implementado** | Todo el tráfico por HTTPS; API Gateway no admite HTTP plano. |
| 6.2 | **Cifrado en reposo declarado** | **Parcial** | AWS cifra S3 y DynamoDB por defecto con clave gestionada por AWS, pero **no está declarado en `Backend/serverless.yml`** ni se usa clave propia (KMS). No queda constancia de la decisión. |
| 6.3 | **Bloqueo explícito de acceso público a los buckets** | **Pendiente** | Sin `PublicAccessBlockConfiguration` en `Backend/serverless.yml`. |
| 6.4 | **Restricción de orígenes CORS en almacenamiento** | **Pendiente** | `AllowedOrigins: ['*']` en ambos buckets. |
| 6.5 | **Recuperación a un punto en el tiempo** | **Pendiente** | Sin `PointInTimeRecoverySpecification` en ninguna tabla: no hay restauración ante borrado o corrupción. |
| 6.6 | Política de retención de infraestructura | **Implementado** | `DeletionPolicy` y `UpdateReplacePolicy` configurados por ambiente. |
| 6.7 | **Versionado de los buckets** | **Pendiente** | Verificado en AWS: `buildandserve-repository-prod` y `buildandserve-evidence-prod` **no tienen versionado**. Un borrado o una sobreescritura son irreversibles, y es la base sobre la que se apoya el bloqueo de objetos de la política de retención (punto 7.1). |
| 6.8 | Región de tratamiento de los datos | **Evaluada y postergada** | Ver decisión D-1. |

### 2.7 Gobernanza del dato personal

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 7.1 | **Política de retención de datos personales** | **Decidida, implementación pendiente** | Plazo y diseño definidos en la decisión D-2. El dato que faltaba para poder calcularla —la fecha de término del vínculo laboral— ya se registra: `Persona.fechaTerminoVinculo`. Falta el bloqueo de objetos en S3 y el proceso que aplica el plazo. |
| 7.2 | **Mecanismo de supresión a solicitud del titular** | **Pendiente** | No existe. Exigible con la Ley 21.719. Su alcance está acotado por D-2: la obligación de conservación le gana a la supresión mientras el plazo no venza. |
| 7.3 | **Registro de tratamientos** | **Pendiente** | No hay inventario documentado de qué datos personales se tratan, con qué finalidad y por cuánto tiempo. |
| 7.4 | **Procedimiento de notificación de brechas** | **Pendiente** | No hay protocolo definido. |
| 7.5 | Minimización en las respuestas de la API | **Parcial** | El hash del PIN nunca sale, pero no hay una revisión sistemática de qué campos personales viajan en cada respuesta. |

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

---

## 4. Hallazgos priorizados

### H-1. El PIN usa SHA-256 sin función de derivación con costo
**Severidad: alta**

El PIN es de cuatro dígitos: 10.000 combinaciones posibles. SHA-256 está diseñado para ser
rápido, de modo que quien obtuviera la base de datos **y** el secreto del servidor podría
recorrer el espacio completo en segundos y recuperar el PIN de todas las personas.

**Corrección:** migrar a `scrypt`, `bcrypt` o PBKDF2 con costo configurado. Es migrable de
forma progresiva: se re-hashea en el siguiente ingreso exitoso de cada persona, sin pedirle
nada al usuario ni invalidar los PIN existentes.

**Ubicación:** `Backend/lib/utils/validation.js`

### H-2. No hay límite de intentos de PIN
**Severidad: alta**

Nada impide probar las 10.000 combinaciones contra el endpoint de firma. Combinado con H-1,
convierte al PIN en una credencial débil frente a un atacante con acceso a la API.

**Corrección:** contador de intentos fallidos por persona con bloqueo temporal progresivo, y
plan de uso con límite de tasa en API Gateway.

### H-3. Sin recuperación a un punto en el tiempo
**Severidad: media**

Un borrado accidental o una corrupción de datos no tienen vuelta atrás. Para un sistema cuyo
valor es la evidencia de cumplimiento ante fiscalización, la pérdida de datos es la falla más
costosa posible.

**Corrección:** habilitar `PointInTimeRecoverySpecification` en las tablas con datos de
cumplimiento y datos personales.

### H-4. Cifrado en reposo y exposición del almacenamiento no declarados
**Severidad: media**

Los buckets no bloquean explícitamente el acceso público, aceptan cualquier origen CORS, y ni
buckets ni tablas declaran su configuración de cifrado. Aunque AWS cifra por defecto, ante un
tercero evaluador **lo que no está declarado no se puede acreditar**.

**Corrección:** `PublicAccessBlockConfiguration` con las cuatro opciones activas, `AllowedOrigins`
acotado a los dominios de la aplicación, y `BucketEncryption` / `SSESpecification` explícitos,
idealmente con clave gestionada por el cliente.

### H-5. No se audita el acceso a datos sensibles
**Severidad: media**

El resguardo de documentos de salud impide el acceso indebido, pero no deja rastro de los
accesos legítimos. Para datos sensibles, el registro de acceso es lo que permite **detectar** un
uso indebido por parte de quien sí tiene permiso.

**Corrección:** registrar consulta y descarga de documentos de salud con persona, fecha y
documento, con retención acotada.

### H-6. Sin gobernanza del ciclo de vida del dato personal
**Severidad: media, con plazo normativo**

No hay política de retención, ni mecanismo de supresión a solicitud, ni registro de
tratamientos, ni protocolo de notificación de brechas.

**Contexto normativo:** la Ley 21.719 sobre protección de datos personales entra en vigencia en
**diciembre de 2026** y hace exigibles estos cuatro elementos, con régimen sancionatorio
asociado y una agencia con potestad fiscalizadora.

### H-7. Sin huella de integridad del archivo almacenado
**Severidad: baja**

El sistema preserva el documento original y registra quién lo firmó, pero no calcula una huella
del binario al subirlo. No se puede demostrar criptográficamente que el archivo servido hoy es
idéntico al que se subió.

**Corrección:** calcular SHA-256 del archivo al confirmar la carga y guardarlo junto al
documento; verificarlo al descargar.

### H-8. El PIN se guarda en claro en el dispositivo (modo sin conexión)
**Severidad: alta — es el hallazgo abierto más grave**

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

**Corrección de fondo:** que el modo sin conexión no use el PIN, sino un token de
un solo uso emitido por el servidor. El diseño se acuerda antes de implementarlo.

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
