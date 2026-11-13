# Plan de respuesta a incidentes de seguridad de datos personales

**Build & Serve. Versión 2, 13 de noviembre de 2026.** Decisiones D-32 y D-38 de
`docs/gobernanza-y-seguridad-de-datos.md`. La versión 1 (29 de octubre) dejaba la
notificación en manos de cada constructora; la 2 la asume la plataforma por
mandato, y fija un tope para declarar un incidente.

Este plan dice qué hacer cuando algo puede comprometer la confidencialidad, la integridad o la disponibilidad de los datos personales que trata la plataforma. Se apoya en lo que ya está construido: la auditoría con detección (D-31), el informe de brecha (D-19), los scripts de contención (`Backend/scripts/contencion.js`) y la recuperación a un punto en el tiempo de DynamoDB y el versionado de S3 (D-4, D-5).

---

## 0. Roles legales y marco aplicable

**Quién es quién.** Cada constructora es la **responsable** del tratamiento de los datos de sus trabajadores; Build & Serve (The Code Cookers) es **encargada** (D-15). En un incidente eso decide quién notifica a quién:

Esa distinción no cambia por acuerdo: la obligación de reportar del art. 14 sexies
es del responsable, y ningún contrato se la quita. Lo que sí se puede acordar, y
se acuerda, es **quién ejecuta materialmente la notificación**.

- La plataforma detecta, contiene, investiga, evalúa el riesgo y **notifica**: a
  la **Agencia de Protección de Datos Personales** y a los **titulares**, en
  nombre y representación de la constructora responsable, por **mandato expreso
  del contrato de encargo**.
- La constructora responsable sigue siendo la responsable ante la Agencia y ante
  sus trabajadores. Se le informa antes de notificar y conserva el derecho a
  objetar o a notificar ella misma; si objeta, se documenta su decisión y la
  plataforma deja constancia de haber recomendado lo contrario.
- **Por qué así.** Quien tiene los hechos técnicos es la plataforma: la auditoría,
  el informe de brecha y la línea de tiempo están acá. Esperar que cada
  constructora los interprete y redacte agrega días a un plazo que la ley llama
  "sin dilaciones indebidas", y en una brecha que cruza empresas produciría
  notificaciones distintas del mismo hecho. Notificar desde un solo lugar es más
  rápido, consistente y verificable. Es el mismo criterio por el que la
  plataforma, y no cada constructora, corre los scripts de contención.
- **El registro de brechas** que el art. 14 sexies exige al responsable lo lleva
  la plataforma por cada constructora (sección 7) y se le entrega cuando lo pida
  o cuando termine el encargo. Es el mismo deber, cumplido por quien tiene el
  dato.
- Si el incidente cruza empresas (una falla de la plataforma), cada constructora
  recibe solo lo suyo: el informe de brecha separa por empresa. A la Agencia se
  reporta el hecho una vez, identificando a cada responsable afectado.

**Normativa.**

| Norma | Qué exige | Plazo |
|---|---|---|
| Ley 19.628 modificada por la Ley 21.719 (vigente desde el 1 de diciembre de 2026), art. 14 sexies | El responsable reporta a la Agencia las vulneraciones de seguridad que generen un riesgo razonable para los derechos de los titulares, y lleva registro de ellas. Comunica a los titulares cuando la vulneración afecta datos sensibles, datos de menores de 14 años o datos de obligaciones económicas, financieras, bancarias o comerciales; si no se les puede ubicar, por un medio de difusión masiva. | "Por los medios más expeditos posibles y sin dilaciones indebidas". **La ley no fija horas**: las 72 horas son del reglamento europeo y no se aplican aquí. |
| Ley 21.663 (marco de ciberseguridad) y su reglamento de reporte de incidentes | Reporte al CSIRT Nacional (ANCI) de incidentes significativos. | Alerta temprana en 3 horas; segundo reporte en 72 horas (24 si afecta un servicio esencial); plan de acción en 7 días; informe final en 15 días. **Solo para instituciones que prestan servicios esenciales u operadores de importancia vital.** Build & Serve no está calificada como tal; si la ANCI calificara a la plataforma o a una constructora cliente, estos plazos pasan a aplicar y el plan se actualiza. |
| DS 44 y Ley 16.744 | No regulan brechas, pero los datos afectados (salud ocupacional, accidentes) son de los más sensibles del sistema. | |

**Plazos internos** (compromisos de este plan, más exigentes que la ley porque la
ley no fija uno):

| Hito | Plazo interno |
|---|---|
| Clasificar una alerta de severidad alta | 1 hora hábil desde el aviso de CloudWatch o de la bandeja |
| **Declarar o descartar un incidente de gravedad alta** | **24 horas corridas desde la primera señal.** Pasado ese tope sin poder descartarlo, se declara confirmado |
| Contener un incidente confirmado | En el mismo día de su confirmación |
| Informar a la constructora responsable | 24 horas desde la confirmación |
| Notificar a la Agencia y a los titulares, cuando corresponda | 72 horas corridas desde la primera señal |
| Informe de lecciones aprendidas | 10 días hábiles desde el cierre |

**Por qué estos plazos, y por qué se miden desde la primera señal.**

La ley no da un número: da un estándar ("sin dilaciones indebidas"). Fijar plazos
propios no inventa una obligación, demuestra diligencia, que es justo lo que la
responsabilidad proactiva exige poder acreditar. Y los tres primeros hitos son
más exigentes que cualquier norma comparable.

El reloj corre **desde la primera señal**, no desde que alguien declara el
incidente. En la versión 1 todos los plazos partían de la confirmación, y la
confirmación la declara el coordinador: un incidente que tarda una semana en
declararse cumplía el plan y, aun así, era una dilación indebida. El tope de 24
horas para declarar o descartar cierra ese hueco; el de 72 horas desde la primera
señal acota la cadena completa.

Las 72 horas no las exige la Ley 21.719. Se eligen porque son el plazo del
reglamento europeo, que es la referencia que la Agencia tiene más a mano para
juzgar si una demora fue indebida, y porque llegar antes de ese número sin estar
obligado deja al responsable en la mejor posición posible. Si la Agencia fija
plazos por reglamento, este plan se actualiza a lo que diga.

Los plazos "hábiles" son solo los dos que admiten espera: clasificar una alerta y
escribir las lecciones. Contener y notificar van en horas corridas, porque un
incidente no espera al lunes.

> Pendiente de validación legal: el **mandato para notificar en nombre de la
> responsable** y el compromiso de 24 horas tienen que quedar escritos en el
> contrato de encargo con cada constructora. Sin esa cláusula, la plataforma puede
> informar y redactar, pero no firmar la notificación por ella.

---

## 1. Preparación

### 1.1 Responsables

| Función | Responsable | Suplente | Qué hace |
|---|---|---|---|
| Coordinación del incidente y seguridad | Adrean Torres | Benjamín Sánchez | Declara el incidente, conduce las fases, decide escalar y cerrar. |
| Desarrollo (análisis, erradicación) | Benjamín Sánchez | Alonso Cárdenas | Encuentra la causa en el código o la configuración y la corrige. |
| Administración del sistema (AWS) | Adrean Torres (perfil operador) | Benjamín Pinto | Ejecuta la contención, preserva evidencia, restaura respaldos, rota llaves. |
| Comunicación | Benjamín Pinto | Alonso Cárdenas | Único canal hacia las constructoras; redacta con ellas las notificaciones. |
| Verificación | Daniel (QA) | | Prueba en dev la corrección antes de restablecer. |
| Evaluación de riesgo y decisión de notificar | Adrean Torres (coordinador) | Benjamín Sánchez | Decide si hay riesgo razonable para los titulares y, con el mandato del contrato, firma la notificación a la Agencia y a los titulares en nombre de la constructora. |
| Contraparte en la constructora | Su administración o su delegado de protección de datos | | Recibe el informe antes de notificar. Puede objetar o notificar ella misma; su decisión queda documentada. |

**Por qué el equipo y no la constructora.** La decisión necesita dos cosas que no
están en la constructora: los hechos técnicos (auditoría, informe de brecha,
línea de tiempo) y el criterio para leerlos. Un jefe de obra no puede evaluar si
una lectura masiva de fichas significó acceso efectivo a datos sensibles. Dejar
la decisión donde está el dato acorta el plazo y evita que el mismo hecho se
notifique de dos formas distintas. Lo que no se mueve es la responsabilidad: la
constructora sigue respondiendo ante la Agencia, y por eso se le informa antes y
puede objetar.

**Dos personas para notificar.** Como la supresión (D-17), una notificación a la
Agencia no la decide una sola persona: el coordinador la firma y quien está en
comunicación la revisa. Se registra quién hizo cada cosa.

Los nombres son la propuesta del equipo y se confirman al inicio de cada trimestre. Nadie ejecuta solo una acción irreversible: la supresión sigue exigiendo dos personas (D-17).

### 1.2 Canales para reportar

- **Automáticos:** la alarma `EventoSospechoso` (y `FallosDependencia`, `PinBloqueado`, `ValesInvalidos`) avisa por correo al tópico `AlertasOperacionTopic`; las alertas de la auditoría llegan además a la bandeja de quien tiene `empresa.auditoria` en la constructora afectada. `ValesInvalidos` (D-35) significa que se anularon los vales sin conexión de una persona por cinco vales inexistentes: puede ser alguien probando PIN con una copia del almacenamiento de un equipo de terreno. Filtrar los logs por `VALES_INVALIDOS` (empresa y persona), preguntar a la constructora qué equipo se perdió o cambió de manos, y tratarlo como posible exposición de ese equipo: revocar las sesiones abiertas en él y, si la persona lo pide, restablecer su PIN.
- **Personas:** cualquier persona (trabajador, constructora, equipo) reporta a `contacto@buildandserve.cl` con el asunto "Incidente de seguridad". Las constructoras tienen además el teléfono del coordinador.
- Lo que se reporta queda como evento en el registro de incidentes (sección 7) aunque resulte no ser incidente.

### 1.3 Recursos técnicos

| Recurso | Para qué | Dónde |
|---|---|---|
| Auditoría sellada y consultable | Reconstruir quién hizo qué | Mi Empresa, pestaña Auditoría; `AuditoriaAccesosTable` |
| Detección automática | Fuerza bruta, verificación reiterada, exportación masiva, acceso masivo a salud, escalamiento de privilegios | `Backend/lib/gobernanza/deteccion.js` |
| Contención | Preservar evidencia, revocar sesiones, suspender y reactivar cuentas, revocar vales de firma | `Backend/scripts/contencion.js` |
| Alcance de la brecha | Qué datos y de quién | `Backend/scripts/informe-brecha.js` (D-19) |
| Recuperación | Restaurar tablas y archivos | Recuperación a un punto en el tiempo de DynamoDB (35 días) y versionado de S3 |
| Despliegue limpio | Volver a un commit sano | `infra/desplegar-backend.sh`, `infra/desplegar-frontend.sh` |
| Rotación de secretos | Pimienta de credenciales y llave HMAC con versión | Parámetros de SSM con `_V` (D-7, D-10) |

### 1.4 Procedimientos previos

- Una vez por trimestre, un simulacro en dev con una empresa desechable: cuenta comprometida de punta a punta (detección, contención con los scripts, informe de brecha, borrador de notificación).
- Revisar que la suscripción de la alarma esté confirmada y que el correo de contacto llegue.

---

## 2. Detección y análisis

### 2.1 Criterios

| Señal | Cómo se detecta | Nivel inicial |
|---|---|---|
| 5 ingresos fallidos en 15 minutos contra una cuenta | Regla `fuerza_bruta_cuenta` | Alerta (alta) |
| 3 contraseñas incorrectas en 15 minutos al confirmar identidad en el autoservicio | Regla `verificacion_reiterada`; cierra las sesiones de la cuenta | Alerta (alta), contenida |
| Exportaciones de datos sobre el límite diario | Regla `exportacion_reiterada` | Alerta (media) |
| Una cuenta ve datos de salud de 30 personas o más en una hora | Regla `acceso_masivo_salud` | Alerta (alta) |
| Una cuenta abre la ficha de 30 personas distintas o más en una hora | Regla `lectura_masiva_fichas` | Alerta (alta) |
| Se otorga el rol de administrador o se cambian los permisos de los roles | Regla `escalamiento_privilegios` | Alerta (media) |
| Un registro de auditoría no calza con su sello | Pantalla de auditoría ("ALTERADO") o `preservar` | Incidente confirmado: alguien escribió en la tabla fuera del sistema |
| Modificaciones que nadie reconoce | Auditoría de `datos.modificacion` y `admin.*` | Evento sospechoso |
| Credenciales o llaves expuestas (repositorio, chat, equipo perdido) | Reporte de personas, CloudTrail | Incidente confirmado |
| Caída de una dependencia o datos inaccesibles | `FallosDependencia`, monitoreo | Evento sospechoso de disponibilidad |

### 2.2 Tres niveles

- **Alerta:** una regla cruzó su umbral o alguien reportó algo. Puede ser una persona que olvidó su contraseña.
- **Evento sospechoso:** después de revisar la auditoría, no hay una explicación legítima, pero tampoco se ha comprobado acceso a datos.
- **Incidente confirmado:** hay evidencia de destrucción, pérdida, alteración, comunicación o acceso no autorizado a datos personales, o de credenciales comprometidas. Lo declara el coordinador.

### 2.3 Evaluación de alcance, gravedad e impacto

1. Ventana y actor: `Auditoría` filtrada por fecha y actor; `informe-brecha.js --actor --desde --hasta`.
2. Qué datos: el informe separa por empresa y marca si hubo salud (`contieneSalud`).
   Desde el 13 de noviembre de 2026 también quedan registradas las lecturas de
   datos personales que importan: el listado del personal
   (`datos.lectura_directorio`, con cuántas personas y si fue el listado completo
   o el recortado), la ficha de otra persona (`datos.lectura_ficha`, con su
   identificador) y la descarga de un documento firmado
   (`datos.descarga_documento`, con sus firmantes). Lo que sigue siendo cota
   superior es el resto: actividades, incidentes y obras se leen sin registro, y
   de ellas solo se puede decir qué **podía** ver esa cuenta.
3. Gravedad:

| Gravedad | Criterio |
|---|---|
| Alta | Datos de salud, RUT en claro, credenciales o llaves; más de 50 titulares; o integridad de evidencia del DS 44 comprometida |
| Media | Datos de contacto o laborales de un grupo acotado; sin salud |
| Baja | Un titular, sin datos sensibles, contenido de inmediato |

### 2.4 Criterios para escalar

- De alerta a evento sospechoso: el coordinador no encuentra explicación legítima en una hora hábil.
- De evento sospechoso a incidente: hay evidencia de acceso o alteración, o un sello alterado, o credenciales expuestas.
- **Tope para decidir:** un evento sospechoso de gravedad alta que a las 24 horas
  corridas de la primera señal no se pudo descartar **se declara incidente
  confirmado**. No queda a criterio de nadie seguir investigando sin declarar: el
  plazo de la ley corre desde que se supo, no desde que se admitió.
- Un incidente de gravedad alta se informa a la constructora responsable aunque falten detalles, y se completa después.

---

## 3. Contención

Orden, y por qué: **primero preservar, después contener**. Revocar sesiones o suspender una cuenta cambia el estado del sistema; la copia de la auditoría con su huella es lo que después permite explicar qué pasó.

```bash
cd Backend
# 1. Preservar evidencia (copia de la auditoría con SHA-256, permisos 600)
node scripts/contencion.js --stage prod --operador <usuario-iam> --motivo "INC-2026-001 ..." preservar --empresa <tenantId> --desde <ISO> --hasta <ISO>
# 2a. Cerrar sesiones (la persona legítima vuelve a entrar con su contraseña)
node scripts/contencion.js --stage prod --operador <usuario-iam> --motivo "..." revocar-sesiones --empresa <tenantId> --persona <personaId>
# 2b. O suspender la cuenta (niega cada petición, cierra sesiones y revoca vales de firma)
node scripts/contencion.js --stage prod --operador <usuario-iam> --motivo "..." suspender --empresa <tenantId> --persona <personaId>
# 3. Alcance
node scripts/informe-brecha.js --stage prod --actor <personaId> --desde <ISO> --hasta <ISO>
```

Otras medidas según el caso:

- **Restringir permisos:** quitar el permiso afectado del rol en Mi Empresa (queda auditado como `admin.roles_empresa`).
- **Aislar un componente:** desactivar la ruta afectada desplegando un commit que la responda con 503, o quitar la integración (por ejemplo, el dictado por voz) mientras se investiga.
- **Credenciales expuestas:** rotar la pimienta o la llave HMAC con una versión nueva (D-7, D-10) y forzar cambio de contraseña.

**Cuidar la evidencia:** no borrar logs ni registros (la auditoría no se puede borrar y la tabla es `Retain`), no restaurar sobre la tabla afectada (se restaura a una tabla nueva), anotar cada comando ejecutado en el registro del incidente. Las acciones de contención quedan en la auditoría con el operador que las ejecutó.

---

## 4. Erradicación y recuperación

1. **Causa:** desarrollo encuentra la falla (código, configuración, permiso de IAM, credencial filtrada) con la auditoría preservada y los logs de CloudWatch.
2. **Corrección:** cambio con su prueba que falla al sabotear el control (regla del repositorio), en un commit pusheado.
3. **Recuperación de datos:** si hubo alteración o pérdida, restaurar a un punto en el tiempo **en una tabla nueva**, comparar y copiar solo lo afectado; para archivos, la versión anterior de S3.
4. **Comprobaciones antes de restablecer:**
   - la suite completa pasa (`npm test`) y el frontend compila (`tsc -b`);
   - la corrección se desplegó en dev y QA la verificó, con la prueba de punta a punta;
   - la auditoría de la ventana no muestra registros alterados (`preservar` informa la integridad);
   - las credenciales comprometidas se rotaron y las cuentas afectadas cambiaron contraseña;
   - después, despliegue en prod con los scripts de `infra/` y reactivación de cuentas (`contencion.js reactivar`).

---

## 5. Notificación y comunicación

**Quién evalúa y quién firma:** el coordinador del incidente, con comunicación,
evalúa el riesgo y firma la notificación en nombre de la constructora
responsable, con el mandato del contrato de encargo. Dos personas: quien firma y
quien revisa.

**Qué pasa antes de notificar:** se informa a la constructora con el informe de
brecha y el borrador. Si objeta, se detiene y se documenta su decisión y la
recomendación contraria de la plataforma. **Si no responde dentro del plazo, se
notifica igual**: el silencio de la responsable no suspende el plazo de la ley, y
el riesgo para los titulares no espera una respuesta de correo.

**Cuándo notificar:**

| A quién | Cuándo |
|---|---|
| Constructora responsable | Siempre que el incidente esté confirmado y afecte datos de sus trabajadores. 24 horas desde la confirmación, y antes de notificar a la Agencia. |
| Agencia de Protección de Datos Personales | Cuando haya riesgo razonable para los derechos y libertades de los titulares. Sin dilaciones indebidas, y a más tardar 72 horas desde la primera señal. La firma la plataforma por mandato. |
| Titulares | Cuando haya datos sensibles (en este sistema: salud ocupacional, ficha de salud, licencias, lesiones de accidentes). Sin menores de 14 años en el sistema (no hay titulares menores de edad). También por mandato. |
| CSIRT Nacional (ANCI) | Solo si la plataforma o la constructora están calificadas por la Ley 21.663. |
| Otras partes | La CChC como socio del piloto, si el incidente afecta a varias constructoras; proveedores (AWS, Google) si la causa está en su servicio. |

**Contenido mínimo de la notificación** (se arma con el informe de brecha, que trae categorías y conteos, no datos):

1. Descripción clara de lo ocurrido.
2. Fecha de detección y, si se conoce, el período en que ocurrió.
3. Tipos de datos personales potencialmente afectados y número aproximado de titulares.
4. Posibles consecuencias o riesgos para los titulares.
5. Medidas de contención y mitigación adoptadas.
6. Recomendaciones para reducir el riesgo (por ejemplo, cambiar la contraseña, desconfiar de llamados que pidan el PIN).
7. Canal de contacto: `contacto@buildandserve.cl` y el contacto que designe la constructora.

**Plantilla para los titulares** (lenguaje claro):

> El [fecha] detectamos que [qué pasó, en una frase]. Entre el [inicio] y el [fin], [quién] pudo acceder a [qué datos tuyos]. Esto podría [riesgo concreto]. Ya [medidas]. Te recomendamos [acciones]. Si tienes dudas, escríbenos a [contacto]. Te avisaremos si sabemos algo más.

---

## 6. Lecciones aprendidas

Dentro de 10 días hábiles desde el cierre, una reunión sin culpables y un informe que registre:

- causa raíz y cómo se llegó a ella;
- línea de tiempo (detección, contención, notificaciones, cierre) contra los plazos de este plan;
- medidas correctivas (lo que se arregló) y preventivas (lo que evita que se repita);
- mejoras a los controles, a las reglas de detección (umbrales, reglas nuevas) y a este plan;
- una prueba nueva que falle si la falla vuelve.

---

## 7. Registro y cierre

**Registro de incidentes.** La ley exige llevar registro de las vulneraciones, se notifiquen o no. Cada caso tiene un identificador `INC-AAAA-NNN`, que se usa como `--motivo` en los scripts, y registra: fecha de detección y de cada fase, nivel y gravedad, empresas y conteos afectados (sin datos personales), decisiones de notificar o no con su fundamento, y la huella de la evidencia preservada.

El registro es **el del responsable**: el art. 14 sexies se lo exige a cada
constructora, y la plataforma lo lleva por ella, igual que notifica por ella. De
ahí tres consecuencias prácticas:

- Cada constructora puede pedir en cualquier momento el extracto de lo que le
  concierne, y se le entrega completo al terminar el encargo. Un registro que la
  responsable no puede obtener no le sirve para acreditar nada.
- Los casos que resultaron no ser incidentes quedan igual: lo que acredita
  diligencia es haber mirado, no solo haber acertado.
- Se conserva aunque la empresa se dé de baja de la plataforma: es la prueba de
  cómo se trató el incidente, y desaparecería justo cuando podría hacer falta.

**Condiciones para cerrar un caso:**

- la causa está erradicada y desplegada en prod;
- las cuentas afectadas están reactivadas o desvinculadas;
- las notificaciones que correspondían se hicieron, o está documentado por qué no;
- el informe de lecciones aprendidas está escrito y sus medidas tienen responsable y fecha.

Un caso que resulta no ser incidente se cierra con esa conclusión y queda igual en el registro.
