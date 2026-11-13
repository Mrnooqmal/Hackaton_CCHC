# Actividad: trazabilidad y plan de respuesta

**Integrantes:** Alonso Cárdenas, Benjamín Pinto, Benjamín Sánchez, Adrean Torres
**Asignatura:** Seguridad y Protección de Datos, Taller Práctico
**Sistema:** Build & Serve — plataforma de gestión SST para la construcción (DS 44)
**Repositorio:** https://github.com/Mrnooqmal/Hackaton_CCHC (rama `pruebas`)
**Fecha:** 13 de noviembre de 2026

Las rutas de este documento son relativas a la raíz del repositorio. Todo lo que
se afirma acá está en el código y se puede comprobar en el archivo y la línea que
se cita.

---

## 0. Punto de partida

Build & Serve es una plataforma multiempresa: cada constructora administra sus
obras y su personal, y la plataforma trata datos de identificación, laborales y
de **salud ocupacional** (exámenes, aptitud, restricciones, accidentes). Está en
producción con datos reales desde octubre de 2026.

Los roles legales deciden casi todo lo que sigue: **cada constructora es la
responsable** del tratamiento de los datos de sus trabajadores y **Build & Serve
es encargada** (decisión D-15). Esa distinción no la cambia ningún acuerdo, y
determina quién notifica una brecha y quién responde ante la Agencia.

Esta actividad continúa dos decisiones anteriores: D-31 (registro de auditoría y
detección) y D-32 (plan de respuesta a incidentes), de la actividad de
consentimiento y derechos. Lo que se agregó ahora, y es lo que esta actividad
exigía de verdad, son dos cosas:

- **D-39.** Las lecturas de datos personales se auditan. Antes no dejaban rastro,
  y por eso un incidente no se podía reconstruir del todo.
- **D-38.** La plataforma notifica las brechas por mandato de la responsable, y
  los plazos se miden desde la primera señal y no desde que alguien declara el
  incidente.

Las dos nacieron del **punto 6**: el simulacro midió qué se podía reconstruir, no
salió bien, y lo que falló se corrigió. Esa es la parte de la que estamos más
conformes, y la contamos en ese orden más abajo.

---

## 1. Qué eventos se auditan y qué campos tiene cada registro

### 1.1 Catálogo cerrado

`lib/gobernanza/auditoria.js` define **37 operaciones en 9 categorías**. El
catálogo es cerrado: una operación que no está en él **no se puede registrar**,
lanza un error de programación (`construir`, línea 180). Eso evita que cada
módulo invente su propio nombre y que la auditoría termine siendo un registro de
texto libre imposible de consultar.

| Categoría | Cuántas | Qué cubre |
|---|---|---|
| `seguridad` | 4 | ingresos, ingresos fallidos, verificación de identidad y su fallo |
| `consentimiento` | 3 | otorgado, revocado, denegado |
| `derechos` | 11 | solicitud, verificación, prórroga, respuesta, exportación, rectificación, oposición, supresión |
| `datos` | 1 | modificación de una ficha |
| **`acceso`** | **3** | **lectura del directorio, de una ficha ajena y descarga de un documento firmado** |
| `administracion` | 2 | cambio de rol, cambio de los permisos de los roles |
| `contencion` | 5 | revocar sesiones, suspender y reactivar cuenta, revocar vales, preservar evidencia |
| `auditoria` | 2 | consulta de la auditoría, verificación de sellos |
| `alerta` | 6 | una por cada regla de detección, derivada automáticamente |

La categoría `alerta` no se escribe a mano: se deriva de las reglas
(`for (const r of deteccion.REGLAS) OPERACIONES['alerta.' + r.id] = ...`, línea
105). Si mañana se agrega una regla, su operación existe sin tocar el catálogo.

### 1.2 Campos de cada registro

Quince campos, todos en `construir` (líneas 176 a 205):

| Campo | Para qué sirve en una investigación |
|---|---|
| `tenantId` + `sk` | clave: la empresa y el instante. `sk` es `EV#<fecha ISO>#<uuid>`, así que la partición queda **ordenada en el tiempo** sin un índice extra |
| `eventoId` | identificador único; es lo que permite deduplicar al evaluar las reglas |
| `en` | fecha y hora ISO |
| `categoria`, `operacion` | qué pasó, del catálogo cerrado |
| `resultado` | `exito`, `denegado` o `fallido`. Un acceso **denegado** es tan informativo como uno exitoso |
| `actorId`, `actorTipo`, `actorRol` | quién. El tipo puede ser `persona`, `cuenta`, `sistema` u `operador`: un intento de ingreso fallido no tiene sesión, así que el actor es la cuenta |
| `recurso` | sobre qué, como `{ tipo, id }` |
| `titulares` | **de quién eran los datos.** Es el campo que convierte un registro técnico en un informe de brecha |
| `origen` | IP y canal |
| `detalle` | lo acotado y saneado (ver 2.2) |
| `ttl` | vencimiento, derivado de la categoría (ver 3.2) |
| `sello` | HMAC del registro canónico (ver 3.3) |

El índice `actorId-en-index` ordena por actor y fecha. Esa es exactamente la
consulta de un incidente: *qué hizo esta cuenta entre tal hora y tal otra.*

---

## 2. El registro, sin guardar los datos

### 2.1 Qué se registra en cada lectura y escritura

Lo que se audita hoy, con su punto exacto en el código:

| Operación | Dónde se emite | Qué guarda |
|---|---|---|
| `auth.ingreso`, `auth.ingreso_fallido` | `handlers/auth/handler.js` | el ingreso fallido se identifica por el **HMAC del RUT**, nunca el RUT ni la contraseña probada |
| `datos.lectura_directorio` | `handlers/personas-module/handler.js` | cuántas personas y si el listado fue **completo o recortado** |
| `datos.lectura_ficha` | el mismo, por identificador y por RUT | el identificador del titular, y si fue por RUT |
| `datos.descarga_documento` | `handlers/documents/handler.js` | los firmantes cuyos RUT van en el anexo del PDF |
| `datos.modificacion` | `handlers/personas-module/handler.js` | qué campos cambiaron, no sus valores |
| `admin.cambio_rol`, `admin.roles_empresa` | `handlers/tenants-module`, `personas-module` | el rol nuevo |
| `derechos.*` (11) | `handlers/gobernanza/derechos.js`, `titular.js` | el flujo completo de una solicitud del titular |
| `contencion.*` (5) | `lib/gobernanza/contencion.js` | operador, motivo y alcance |
| `auditoria.consulta` | `handlers/gobernanza/auditoria.js` | **quien investiga también deja rastro**, con los filtros que usó |

Los accesos a **datos de salud** tienen su propio camino desde antes
(`lib/gobernanza/auditoriaSalud.js`, decisión D-18) y **no llevan TTL**: no
vencen.

### 2.2 Cómo se impide que entren datos personales

`sanear` (líneas 147 a 174) rechaza el registro completo —lanza— si el detalle
trae:

- **una clave con nombre prohibido:** `pass`, `contrase`, `pin`, `token`,
  `secret`, `llave`, `key`, `rut`, `correo`, `mail`, `telefono`, `nacimiento`,
  `direccion`, `salud`, `diagnost`, `respuesta`, `relato`, `descripcion`,
  `texto`, `valor`, `contenido`, `nombre`, `cifrad`;
- **un valor que parece un RUT** o **un correo**, aunque la clave se llame de
  otra forma;
- **un texto de más de 120 caracteres**, porque un campo largo es donde se cuela
  un relato con datos adentro.

Que **lance** en vez de limpiar en silencio es deliberado: un dato prohibido en
la auditoría es un error de programación, y tiene que verse en las pruebas, no en
una fiscalización.

**Pruebas:** `tests/auditoria-general.test.js` ("el detalle rechaza contraseñas,
tokens, RUT, correos, valores y textos largos"; "un ingreso fallido se registra
por el HMAC del RUT, nunca el RUT ni la contraseña probada") y
`tests/auditoria-lecturas.test.js` ("el registro de una lectura no lleva el RUT ni
el correo de nadie").

### 2.3 Una decisión que vale explicar: qué se guarda de un listado

Cuando alguien lista el personal, el registro guarda **cuántas personas** y el
alcance, pero **no los identificadores uno por uno**. El alcance es "el personal
de esta empresa", y el informe de brecha lo resuelve desde el `tenantId` y la
fecha. Guardar cientos de identificadores en cada listado abultaría el registro
sin decir nada nuevo.

En cambio, abrir **una ficha** sí guarda el identificador de esa persona: ahí la
precisión importa y el volumen no es problema. Y leer la **propia** ficha no se
registra: no es un acceso de un tercero, y registrarlo llenaría la auditoría de
ruido justo donde hay que buscar los accesos ajenos.

---

## 3. Protección de los registros

### 3.1 Acceso restringido

| Capa | Cómo |
|---|---|
| **Permiso de aplicación** | `empresa.auditoria`, que por omisión **solo tiene el administrador** (`lib/permissions.js`). Se puede delegar, por ejemplo a quien responde por la seguridad de la información |
| **Aislamiento entre empresas** | la consulta filtra por el `tenantId` **de la sesión**, nunca por uno que venga en la petición |
| **La consulta se audita** | cada consulta escribe `auditoria.consulta` **en modo estricto**: si ese registro no se puede escribir, la auditoría **no se muestra** (503). Quien mira el registro de los demás queda registrado, o no mira |
| **IAM: solo agregar y leer** | el rol de las funciones tiene sobre la tabla `[dynamodb:Query, dynamodb:PutItem]` (`serverless.yml:293`). **No hay `UpdateItem` ni `DeleteItem`**, y eso incluye al rol de supresión. La garantía está en el permiso, no en la disciplina del código |

**Pruebas:** `tests/auditoria-general.test.js` ("ningún rol puede actualizar ni
borrar registros de auditoría"; "consultar la auditoría exige permiso, y el
intento queda registrado"; "si la consulta no se puede registrar, no se muestra
la auditoría") y `tests/gobernanza-permisos.test.js`.

### 3.2 Plazo de conservación

Por categoría, con TTL de DynamoDB y configurable por variable de entorno:

| Categoría | Plazo | Por qué |
|---|---|---|
| `seguridad` | 1 año | sirve para investigar un incidente reciente |
| `acceso` | 1 año | igual: responde quién leyó qué |
| `alerta` | 2 años | una alerta es el inicio de una historia que puede volver |
| el resto (`derechos`, `datos`, `consentimiento`, `contencion`, `administracion`) | 5 años | acredita **cómo se trataron** los datos de una persona; es el mismo plazo de la evidencia (D-2) |
| accesos a salud (D-18) | **sin TTL** | no vencen |

La categoría `acceso` se creó aparte de `datos` justamente por esto: si una
lectura del directorio durara cinco años, cada listado multiplicaría el
almacenamiento sin aportar nada que el plan de incidentes use.

### 3.3 Integridad: el sello

Cada registro lleva un **HMAC** de su forma canónica, con una llave que las
funciones usan pero que no está en la tabla. Al consultar, el servidor verifica
cada sello y responde `integro`, `alterado` o `sin_sello`, más un resumen.

Para qué sirve: el IAM impide borrar y modificar **desde la aplicación**, pero
alguien con acceso a la consola de AWS podría editar la tabla. El sello hace que
esa edición se vea. Un registro `ALTERADO` es, por sí mismo, un **incidente
confirmado** en el plan (sección 2.1).

Además: `DeletionPolicy: Retain` y `UpdateReplacePolicy: Retain` (la tabla
sobrevive a que se borre el stack) y **recuperación a un punto en el tiempo**
activada.

**Prueba:** "el sello delata una alteración hecha sin la llave".

---

## 4. Alertas de acceso anómalo

Seis reglas en `lib/gobernanza/deteccion.js`. La actividad pedía al menos tres;
las seis son propias de este sistema y no de un catálogo genérico.

| Regla | Qué la dispara | Ventana | Umbral | Severidad | Acción automática |
|---|---|---|---|---|---|
| `fuerza_bruta_cuenta` | ingresos fallidos contra la misma cuenta | 15 min | 5 | alta | — |
| `verificacion_reiterada` | contraseña incorrecta al **confirmar identidad** para exportar o rectificar | 15 min | 3 | alta | **cierra todas las sesiones de la cuenta** |
| `exportacion_reiterada` | exportación de datos por sobre el límite diario | 24 h | 1 | media | — |
| `acceso_masivo_salud` | datos de salud de muchas personas **distintas** | 60 min | 30 | alta | — |
| `lectura_masiva_fichas` | la ficha de muchas personas **distintas** | 60 min | 30 | alta | — |
| `escalamiento_privilegios` | se otorga el rol de administrador o se cambian los permisos de los roles | 60 min | 1 | media | — |

Cuatro decisiones de diseño que vale defender:

**La segunda regla contiene sola.** Tres contraseñas incorrectas al confirmar
identidad no es alguien que olvidó su clave: es el patrón de una **sesión robada**
intentando adivinarla para exportar datos. Cerrar las sesiones no molesta a la
persona legítima, que vuelve a entrar con su contraseña, y sí detiene a quien solo
tenía la sesión.

**Las dos reglas masivas cuentan titulares, no peticiones.** Abrir diez veces la
misma ficha no alerta; abrir treinta fichas distintas sí. La diferencia es
exactamente la que separa gestionar un equipo de recorrer un padrón.

**El escalamiento alerta sin umbral.** Otorgar el rol de administrador una sola
vez ya es un evento que alguien debe mirar.

**Una alerta por ventana.** Si ya hay una alerta de la misma regla y el mismo
actor dentro de la ventana, no se repite: una cuenta bajo ataque produce una
alerta, no doscientas (`evaluar`, líneas 112 a 130).

Cada alerta queda **en la misma auditoría** (`alerta.<regla>`), avisa en la bandeja
de quien tiene `empresa.auditoria` en la empresa afectada y emite la métrica
`EventoSospechoso` con su alarma de CloudWatch.

---

## 5. Plan de respuesta a incidentes

El plan completo es `docs/plan-respuesta-incidentes.md` (versión 2, 317 líneas).
Acá va lo que la actividad pide: criterios, responsables, fases y contenido de la
notificación.

### 5.1 Criterios y niveles

Tres niveles, para no tratar igual una contraseña olvidada y una filtración:

- **Alerta:** una regla cruzó su umbral, o alguien reportó algo.
- **Evento sospechoso:** revisada la auditoría, no hay explicación legítima, pero
  no se ha comprobado acceso a datos.
- **Incidente confirmado:** hay evidencia de destrucción, pérdida, alteración,
  comunicación o acceso no autorizado, o de credenciales comprometidas.

La gravedad se evalúa por los datos y el alcance: **alta** si hubo salud, RUT en
claro, credenciales o llaves, o más de 50 titulares, o si la integridad de la
evidencia del DS 44 quedó comprometida.

### 5.2 Responsables

| Función | Responsable | Suplente |
|---|---|---|
| Coordinación del incidente y seguridad | Adrean Torres | Benjamín Sánchez |
| Desarrollo (análisis, erradicación) | Benjamín Sánchez | Alonso Cárdenas |
| Administración del sistema (AWS) | Adrean Torres (perfil operador) | Benjamín Pinto |
| Comunicación | Benjamín Pinto | Alonso Cárdenas |
| Verificación | Daniel (QA) | |
| Evaluación de riesgo y decisión de notificar | Adrean Torres | Benjamín Sánchez |
| Contraparte en la constructora | su administración o su delegado | |

La decisión de notificar está en el equipo y no en la constructora **a propósito**:
necesita los hechos técnicos (auditoría, informe de brecha, línea de tiempo) y el
criterio para leerlos. Un jefe de obra no puede evaluar si una lectura masiva de
fichas significó acceso efectivo a datos sensibles. Dejar la decisión donde está
el dato acorta el plazo y evita que el mismo hecho se notifique de dos formas
distintas.

Ninguna acción irreversible la ejecuta una sola persona: la supresión exige dos
(D-17) y la notificación a la Agencia también —quien firma y quien revisa—.

### 5.3 Fases

1. **Preparación.** Responsables, canales (alarma automática, correo, teléfono),
   herramientas y un simulacro trimestral.
2. **Detección y análisis.** Las reglas, los tres niveles, la evaluación de
   alcance con `informe-brecha.js`.
3. **Contención.** `scripts/contencion.js`: preservar evidencia con su huella,
   cerrar sesiones, suspender la cuenta, revocar los vales de firma. Exigen
   operador y motivo, y quedan en la auditoría.
4. **Erradicación y recuperación.** Corregir, verificar en dev, desplegar,
   restaurar desde la recuperación a un punto en el tiempo si hizo falta.
5. **Notificación.** Ver 5.4.
6. **Lecciones aprendidas.** A los 10 días hábiles, con causa raíz, línea de
   tiempo contra los plazos, medidas, y **una prueba nueva que falle si la falla
   vuelve**.
7. **Registro y cierre.** `INC-AAAA-NNN`, condiciones explícitas para cerrar.

### 5.4 Quién notifica, y los plazos

**La plataforma notifica**, a la Agencia y a los titulares, **en nombre y
representación** de la constructora responsable, por mandato expreso del contrato
de encargo (D-38).

Lo que ese mandato **no** mueve: la obligación de reportar del art. 14 sexies es
del responsable, y ningún contrato se la quita. Lo que se delega es el **acto
material** de notificar, que sí se puede delegar. La constructora recibe el
informe y el borrador antes, puede objetar o notificar ella misma, y su decisión
queda documentada. **Si no responde dentro del plazo, se notifica igual:** el
silencio de la responsable no suspende el plazo de la ley.

**Plazos internos**, medidos **desde la primera señal** y no desde que alguien
declara el incidente:

| Hito | Plazo |
|---|---|
| Clasificar una alerta de severidad alta | 1 hora hábil |
| Declarar o descartar un incidente de gravedad alta | **24 horas corridas; pasado el tope, se declara confirmado** |
| Contener un incidente confirmado | el mismo día |
| Informar a la constructora | 24 horas desde la confirmación |
| Notificar a la Agencia y a los titulares | **72 horas corridas desde la primera señal** |
| Informe de lecciones aprendidas | 10 días hábiles desde el cierre |

**Por qué estos plazos.** La Ley 21.719 no fija horas: exige notificar "por los
medios más expeditos posibles y sin dilaciones indebidas". Fijar plazos propios no
inventa una obligación, **demuestra diligencia**, que es lo que la responsabilidad
proactiva exige poder acreditar. Las 72 horas se eligen porque son la referencia
del reglamento europeo, que es con lo que la Agencia —nueva y sin
jurisprudencia— va a juzgar si una demora fue indebida; llegar antes de ese
número sin estar obligado deja al responsable en la mejor posición posible.

**Por qué desde la primera señal.** La versión 1 del plan medía todo desde la
confirmación, y la confirmación la declara el coordinador: un incidente que
tardaba una semana en declararse **cumplía el plan** y era, igual, una dilación
indebida. El tope de 24 horas para declarar o descartar cierra ese hueco.

Las 72 horas de la **Ley 21.663** (ciberseguridad) no aplican: son para servicios
esenciales u operadores de importancia vital, y Build & Serve no está calificada
como tal. Si la ANCI calificara a la plataforma o a una constructora, el plan se
actualiza.

### 5.5 Contenido de la notificación

Siete puntos, que se arman con el informe de brecha —que trae categorías y
conteos, no datos—:

1. descripción clara de lo ocurrido;
2. fecha de detección y, si se conoce, el período en que ocurrió;
3. tipos de datos afectados y número aproximado de titulares;
4. posibles consecuencias para los titulares;
5. medidas de contención y mitigación adoptadas;
6. recomendaciones concretas (cambiar la contraseña, desconfiar de quien pida el
   PIN por teléfono);
7. canal de contacto.

El plan incluye una **plantilla para los titulares en lenguaje claro**, porque una
notificación que nadie entiende no cumple su propósito aunque cumpla el plazo.

El **registro de brechas** que el art. 14 sexies exige al responsable lo lleva la
plataforma por cada constructora, y se le entrega cuando lo pida o al terminar el
encargo: es su deber, cumplido por quien tiene el dato.

---

## 6. Simulacro: ¿los registros permiten reconstruir lo ocurrido?

Esta es la parte que cambió el resultado de la actividad, así que la contamos como
ocurrió y no como nos habría gustado.

### 6.1 La herramienta

`scripts/simulacro-incidente.js` ejecuta un incidente de **cuenta comprometida**
de punta a punta y, sobre todo, **contrasta lo que hizo contra lo que quedó
registrado**. No explota ninguna falla: entra con una contraseña que el operador
le da. Es un generador de rastro conocido.

Corre **solo en dev** (sale con código 2 en cualquier otro ambiente: genera
ingresos fallidos y cambia un rol, y en producción eso contamina la auditoría
real y dispara alertas verdaderas). Revierte el escalamiento de rol al terminar y
avisa si no pudo.

Las cinco fases: reconocimiento (ingresos fallidos) → acceso → exfiltración
(directorio, fichas, repositorio) → escalamiento (rol de administrador) →
**reconstrucción**.

### 6.2 Primera corrida: 5 de 8

Corrido el 13 de noviembre de 2026 en dev, contra una empresa de ejemplo con 6
obras, 31 personas y 79 documentos:

| Acción del incidente | ¿Reconstruible? |
|---|---|
| 6 ingresos fallidos | sí — `auth.ingreso_fallido` |
| Alerta de fuerza bruta | sí — disparó al quinto, sola |
| Ingreso con éxito | sí — `auth.ingreso`, con actor |
| **Listar el directorio (31 personas)** | **NO — no se auditaba** |
| **Leer 3 fichas individuales** | **NO — no se auditaba** |
| **Listar el repositorio (79 documentos)** | **NO — no se auditaba** |
| Otorgar el rol de administrador | sí — `admin.cambio_rol` + `datos.modificacion` |
| Alerta de escalamiento | sí — disparó siempre, sin umbral |

Los 12 registros de la ventana verificaron su sello: **12 íntegros, 0 alterados**.

**El diagnóstico.** El catálogo no tenía **ninguna** operación de lectura. Solo
los accesos a datos de salud dejaban rastro, por el camino aparte de D-18. Una
cuenta robada podía llevarse el directorio completo con RUT, correo y fecha de
nacimiento, y la auditoría solo decía que había iniciado sesión. El propio
informe de brecha lo admitía: lo confirmado eran los accesos a salud y el resto
era *"una cota superior"* de lo que esa cuenta **podía** leer.

### 6.3 Lo que se corrigió (D-39)

Se auditan las tres lecturas que importan —el directorio, la ficha ajena y la
descarga de un documento firmado— con las decisiones de la sección 2.3, más la
regla `lectura_masiva_fichas`, que antes no era posible porque no existía el
evento que detectar.

Dos criterios que se fijaron con pruebas, para que no se pierdan:

**Registrar una lectura no puede impedirla.** Para los datos de salud la regla es
la opuesta: lo que no se puede registrar no se entrega (503, D-18). Aplicar eso al
listado del personal dejaría la aplicación inutilizable por un problema de la
auditoría, en pantallas que se usan en terreno. Así que la lectura sigue aunque el
registro falle, y la falla queda en la métrica. Hay una prueba que fija **cada uno
de los dos criterios**, para que no se uniformen por descuido.

**La escritura se espera.** Al implementarlo se escribió primero como "lanzar y
seguir", y una prueba lo atrapó: cuando el handler responde, Lambda puede congelar
la ejecución antes de que la escritura llegue, y el registro **se pierde en
silencio**. Una auditoría que pierde registros al azar es peor que no tenerla,
porque se confía en ella.

### 6.4 Verificación de la reconstrucción

`tests/auditoria-lecturas.test.js` incluye la contraparte automatizada del
simulacro: recorre el padrón, abre dos fichas (una por identificador y otra por
RUT), consulta la auditoría **por el endpoint real** y verifica que

- aparezcan todas las operaciones del recorrido;
- se sepa **de quién** eran los datos (los titulares);
- la secuencia venga **ordenada en el tiempo**, para poder narrarla;
- todos los registros sean del mismo actor;
- **ningún sello esté alterado**.

Son 14 pruebas, y las 13 que protegen una garantía se comprobaron saboteando lo
que protegen: se rompe el control, se verifica que la prueba falla y se restaura.
Dos de los sabotajes **escaparon** la primera vez y los dos eran sabotajes
débiles —no rompían de verdad la garantía—; al rehacerlos bien, las pruebas
fallaron. De paso, uno de ellos reveló que la búsqueda por RUT no tenía prueba
propia, y se le agregó.

### 6.5 Lo que sigue siendo cota superior

**Actividades, incidentes y obras se leen sin registro.** De una cuenta
comprometida se puede decir qué **podía** ver de esos módulos, no qué vio. Se
decidió no auditarlos ahora: no llevan datos identificatorios de terceros como el
directorio y la ficha, y auditar toda lectura costaría una escritura por petición.
Queda declarado, acá y en el plan, en vez de dar por completa una reconstrucción
que no lo está.

---

## 7. Estado, y lo que queda fuera del código

### 7.1 Verificación

| | |
|---|---|
| Pruebas del backend | **1.407, todas pasan** (`npm test` en `Backend/`) |
| Pruebas nuevas de esta actividad | 14, verificadas por sabotaje |
| Frontend | `tsc -b` limpio; el panel de auditoría muestra la categoría y las operaciones nuevas |
| Simulacro | corre en dev y produce la tabla de la sección 6.2 |

### 7.2 Pendientes honestos

1. **Desplegar.** La auditoría de lecturas está en el repositorio y **no en
   ningún ambiente**. El simulacro contra dev seguirá dando 5 de 8 hasta que se
   despliegue; las pruebas demuestran la instrumentación, pero la corrida en vivo
   es la evidencia definitiva y la repetiremos después del despliegue.
2. **La cláusula de mandato en el contrato de encargo.** Sin ella, la plataforma
   puede informar y redactar, pero no firmar la notificación por la responsable.
3. **Validación legal de los plazos y los responsables** (fila 7.4 del
   checklist). Los plazos de este plan son compromisos propios y están
   fundamentados; que sean los adecuados para cada constructora lo confirma un
   abogado, no el equipo.
4. **Auditoría de lecturas en los módulos restantes**, si se decide que la cota
   superior no alcanza.

Los tres primeros no son código y por eso están acá: nos parece más sólido
declarar el límite entre lo que resuelve el sistema y lo que resuelve un contrato,
que presentar una certeza que no tenemos.

---

## Anexo. Dónde mirar cada cosa

| Qué | Archivo |
|---|---|
| Catálogo, campos, sello, retención, consulta | `Backend/lib/gobernanza/auditoria.js` |
| Reglas de detección | `Backend/lib/gobernanza/deteccion.js` |
| Accesos a datos de salud (D-18) | `Backend/lib/gobernanza/auditoriaSalud.js` |
| Informe de brecha | `Backend/lib/gobernanza/brecha.js`, `Backend/scripts/informe-brecha.js` |
| Contención | `Backend/lib/gobernanza/contencion.js`, `Backend/scripts/contencion.js` |
| Consulta de la auditoría | `Backend/handlers/gobernanza/auditoria.js` |
| Lecturas instrumentadas | `Backend/handlers/personas-module/handler.js`, `Backend/handlers/documents/handler.js` |
| Simulacro | `Backend/scripts/simulacro-incidente.js` |
| Pruebas | `Backend/tests/auditoria-general.test.js`, `auditoria-salud.test.js`, `auditoria-lecturas.test.js`, `gobernanza-permisos.test.js` |
| Plan de respuesta | `docs/plan-respuesta-incidentes.md` |
| Decisiones D-18, D-31, D-32, D-38, D-39 | `docs/gobernanza-y-seguridad-de-datos.md` |
| Protecciones de la tabla (IAM, Retain, PITR, TTL) | `Backend/serverless.yml` |
