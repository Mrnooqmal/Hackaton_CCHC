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
| 2.1 | El PIN nunca se almacena en texto plano | **Implementado** | Solo se guarda el hash. `Backend/lib/credenciales.js` |
| 2.2 | El hash incorpora identificador personal y secreto de servidor | **Implementado** | Sal aleatoria por hash, `personaId` dentro de la sal y pimienta de servidor leída de SSM en ejecución. El `PIN_SALT` anterior **nunca estuvo declarado** y en AWS valía `undefined`: el secreto de servidor no existía. Ver D-7. |
| 2.3 | Verificación resistente a ataques de temporización | **Implementado** | `crypto.timingSafeEqual`. |
| 2.4 | El hash nunca se expone en la API | **Implementado** | Campo interno; la respuesta solo informa si hay PIN configurado. `Backend/lib/models/Persona.js` |
| 2.5 | Mensajes de error genéricos ante credencial inválida | **Implementado** | No revelan si falló el PIN, el estado de la persona u otro. |
| 2.6 | **Función de derivación con costo para el PIN** | **Implementado** | scrypt `N=2^15, r=8, p=1`; ~112 ms por verificación, medidos en la Lambda. Cada hash guarda su algoritmo y sus parámetros, y se actualiza solo al usarse. Ver D-7. |
| 2.7 | **Límite de intentos de PIN** | **Implementado** | Contador por persona, bloqueo progresivo (1/5/15/60 min), reseteo en el primer acierto. Ver D-9. |
| 2.8 | **Throttling a nivel de API** | **Pendiente** | Sin plan de uso ni límite de tasa configurado en `Backend/serverless.yml`. |
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
| 5.7 | **Cifrado a nivel de campo para RUT y datos de salud** | **Parcial** | Cifrado en dev y prod: Personas (`rut`, `vigilanciaSalud`, `restriccionLaboral`), Tenants (`rutEmpresa`), los sidecars de firmas/incidentes, los arreglos embebidos de documentos/actividades/solicitudes, y las respuestas de encuesta. **Pendiente:** dos copias en claro que genera `RegistroService` en `DocumentsTable` — el RUT del accidentado y de los entrevistados (informe Art. 71) y la aptitud laboral y protocolos de vigilancia por persona (registro AT/EP). Se resuelven junto con la huella de integridad, porque son justo los snapshots que se firman. Ver D-10. |
| 5.8 | Los índices de personas proyectan todos los atributos | **Implementado** | `personaId-index`, `email-index` y `tenantRutHmac-index` pasaron a `KEYS_ONLY`: el índice da la clave, la ficha se lee de la tabla. Ver D-6. |
| 5.9 | El RUT no viaja completo en la verificación pública de firmas | **Implementado** | `GET /signatures/verify/{token}` es público por diseño (un fiscalizador comprueba una firma sin cuenta), y devolvía nombre y **RUT completo**: el token se convertía en una consulta abierta de identidad. Ahora el RUT va parcial (`···.678-5`), que cumple igual la función de cotejo. |

### 2.6 Infraestructura y cifrado

| # | Punto | Estado | Evidencia o brecha |
|---|---|---|---|
| 6.1 | Cifrado en tránsito | **Implementado** | Todo el tráfico por HTTPS; API Gateway no admite HTTP plano. |
| 6.10 | Los buckets se gobiernan desde el stack | **Implementado** | Estaban **fuera** de CloudFormation, creados a mano: ningún despliegue podía comprobar ni corregir su configuración, y de ahí venían los dos hallazgos anteriores. Se incorporaron por `IMPORT` de CloudFormation —sin recrearlos ni tocar los 135 objetos de producción— con `DeletionPolicy: Retain`, que es la forma correcta de protegerlos de un `serverless remove`. |
| 6.11 | **Bloqueo de objetos (Object Lock)** | **Pendiente, requiere migración** | No se puede activar sobre un bucket existente. Ver D-5. |
| 6.2 | Cifrado en reposo declarado | **Parcial** | Verificado en AWS: los cuatro buckets cifran con `AES256` (clave gestionada por AWS), y ahora está **declarado** en `Backend/serverless.yml` en vez de depender del valor por defecto. Falta la clave propia (CMK): ver D-4, que explica por qué no se aplicó a ciegas. |
| 6.3 | Bloqueo explícito de acceso público a los buckets | **Implementado** | *Corrección de la versión anterior:* se declaraba **Pendiente** por ausencia en `serverless.yml`, pero en AWS ya estaba activo (las cuatro opciones en `true`). Lo que faltaba era la declaración, no la protección. Ahora está en el stack. |
| 6.4 | Restricción de orígenes CORS en almacenamiento | **Implementado** | Estaba en `AllowedOrigins: ['*']`, es decir cualquier página de internet podía hacerle peticiones al bucket desde el navegador de quien la visitara. Acotado al CloudFront de la aplicación (y `localhost` solo en dev), con métodos `GET`, `PUT` y `HEAD`. |
| 6.5 | Recuperación a un punto en el tiempo | **Implementado** | `PointInTimeRecoverySpecification` en **las 16 tablas**, dev y prod, verificado `ENABLED` contra AWS. Antes estaba deshabilitado en todas: un borrado no tenía ninguna vía de recuperación. |
| 6.6 | Política de retención de infraestructura | **Implementado** | `DeletionPolicy` y `UpdateReplacePolicy` configurados por ambiente. |
| 6.8 | Región de tratamiento de los datos | **Evaluada y postergada** | Ver decisión D-1. |
| 6.9 | Versionado de los buckets | **Implementado** | Habilitado en los cuatro buckets y declarado en el stack. Sustituye al punto 6.7, que lo reportaba pendiente. |

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
**Estado: pendiente de aplicar, con motivo**

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
**Estado: pendiente de decisión, ligado al vaciado**

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

**Pendiente asociado:** documentos y solicitudes de firma también llevan RUT en
el elemento listado (`asignaciones[]`, `solicitanteRut`, `trabajadores[]`) y
siguen en `ProjectionType: ALL` sin resolver — están en la lista de las cinco
tablas que tampoco caben en `INCLUDE` por volumen de atributos, no por mapas
anidados. Se retoma junto con el cifrado de campo del RUT, porque en ese
momento de todas formas se toca cómo se guarda y se busca el RUT.

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

### D-10. Cifrado de campo: RUT buscable por HMAC, sobre de cifrado para el resto
**Estado: casi completo. Implementado el 23 y 24 de septiembre de 2026 en Personas y Tenants, en los sidecars de firmas e incidentes, en los arreglos embebidos de documentos, actividades y solicitudes, y en encuestas, en dev y prod. Pendiente: las dos copias en claro que arma `RegistroService` (ver "Lo que D-10 todavía no cubre", al final de esta decisión).**

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

**Lo que D-10 todavía no cubre: las copias que arma `RegistroService`.** Al
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

---

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
