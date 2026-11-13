# Estado actual de Build & Serve

**Actualizado: 7 de noviembre de 2026.** Este documento sirve para retomar el trabajo sin leer conversaciones anteriores. Si algo de lo que dice aquí no coincide con lo que ves en AWS o en git, gana lo que ves. Si lo compruebas, actualiza este documento.

El producto está en producción con datos reales. Ante la duda, prioriza la solidez.

---

## 1. Qué está desplegado

Todo vive en la cuenta AWS `772706200162`, región `us-east-1`. El perfil local es `adrean_cchc`; el perfil por defecto apunta a otra cuenta. La rama de trabajo es `pruebas`.

| Ambiente | Pieza | Dónde | Commit |
|---|---|---|---|
| **Prod** | Backend | Stack `BuildAndServe-prod`, API `https://92flgz68r1.execute-api.us-east-1.amazonaws.com` | `14fa693` |
| **Prod** | Frontend | **https://buildandserve.cl** (`www` redirige a la raíz con 301). Distribución `E265RJ7EAYTXAX` (`d30jksx91fodea.cloudfront.net` redirige con 301 a `buildandserve.cl` desde D-34), bucket `buildandserve-frontend` | `14fa693` |
| **Dev** | Backend | Stack `BuildAndServe-dev`, API `https://n2waslgjca.execute-api.us-east-1.amazonaws.com` | `8dcaa25` |
| **Dev** | Frontend | **https://d3pve67iu4s0dd.cloudfront.net** (la URL de QA). Distribución `E2XMHI7KDD48MR`, bucket `buildandserve-frontend-dev` | `8dcaa25` |
| Ambos | Infra del frontend | Stack `BuildAndServe-frontend`: dos distribuciones, certificado, cabeceras, CSP y rol de publicación | `14fa693` |

**Prod: `14fa693` desde el 7 de noviembre de 2026** (backend, frontend e infra del frontend, con los scripts). Incluye todo lo acumulado: D-26, D-27, H-16, H-17, Actividades 4 y 5 (D-29 a D-32), el resguardo del Expediente y D-34. Prueba de punta a punta en prod: 29 de 29. Verificado después: el stack tiene 470 recursos, el TTL de la auditoría está `ENABLED`, la alarma `evento-sospechoso-prod` en `OK`, `d30jksx91fodea.cloudfront.net` responde 301 a `https://buildandserve.cl/` y la API no acepta ese origen.

**Dev desde el 11 de noviembre de 2026:** backend y frontend `8dcaa25`, `pruebas` con la rama `tours` mezclada (recorridos guiados y manual, D-33) sobre todo lo anterior. Verificado por los scripts, ya con la descarga reanudable: backend 111 de 111 archivos y frontend 113 de 113. Prueba de punta a punta 64 de 64; el borrado recorre ahora 23 tablas (se suma la de recorridos). Stack de dev en 454 recursos. Antes, backend y frontend `6fe165a`: el sobre con KMS (D-37), el PIN de vuelta a 4 con un PIN por sincronización y la alarma del ataque lento (D-35), y el aviso de firmas ya no queda tapado. Prueba de punta a punta 64 de 64. Stack de dev en 447 recursos. El script de despliegue se cortó en la verificación del paquete porque la descarga desde S3 iba muy lenta; se verificó a mano con descarga reanudable: mismo `CodeSha256` que la función y 108 de 108 archivos idénticos al commit. Antes, backend y frontend `8d95d6b` (prueba de punta a punta 60 de 60), con la minimización completa de la fila 7.5. Antes, `072d2ec`: la firma sin conexión completa con D-35, el aviso de privacidad, la minimización de personas y bandeja, el límite de tasa de las rutas públicas, uploads y surveys en una función cada uno y los logs con la CMK. Verificado después de desplegar: los 74 grupos de logs con `ClaveDatos`, los 9 grupos de las funciones viejas borrados por CloudFormation, stack en 444 recursos. Prueba de punta a punta 56 de 56.

**Cómo se verificó lo anterior (30 de octubre y 6 de noviembre de 2026).** Los scripts no dejan el commit escrito en AWS. El backend se identificó comparando el código del paquete de `personasModule` (`aws lambda get-function`) con el árbol `Backend/` de cada commit: prod coincide con `d750646` (paquete del 1 de octubre); dev, con `b7c3e88` (paquete del 15 de octubre a las 17:07, `UpdateStack` de Benjamin; `93b9a00` tiene el mismo código). El frontend, por la fecha de `index.html` en el bucket y por textos que solo existen desde ciertos commits: prod no tiene los de D-27 ni del footer nuevo; dev tiene los de `6aa53d1` y no los de `b3cb99c` (publicado por Benjamin el 23 de octubre, invalidación a las 10:33, 97 segundos después del commit: a confirmar que fue con el script).

**Estado de cada pieza:**

- **Dominio:** certificado de ACM para `buildandserve.cl` y `www`, validado por DNS en Cloudflare con la nube gris (sin proxy). El TLS mínimo en el dominio es 1.2. Desde el 7 de noviembre de 2026, `www` y `d30jksx91fodea.cloudfront.net` redirigen con 301 a `https://buildandserve.cl` con la misma ruta y consulta (D-34), y el CORS de prod acepta solo el dominio propio.
- **CSP:** **activa** en las dos distribuciones desde el 6 de noviembre de 2026 (infra de `4b2db9e`, desplegada a las 21:30 hora de Chile). Probada en dev y prod en el navegador sin errores de CSP en la consola; verificado con `curl` que `buildandserve.cl` y la URL de dev sirven `Content-Security-Policy` con la política completa y ya no la de solo reporte. Las violaciones se siguen reportando a `POST /csp/reporte` (métrica `CspViolaciones`). Volver a solo reporte: `CSP_MODO=solo-reporte infra/desplegar-infra-frontend.sh <commit>`. Un cambio al script en línea de `index.html` o de los informes exige desplegar primero la infra de ese commit: `desplegar-frontend.sh` se niega a publicar un build que la política activa no autoriza.
- **Correo:** sale de `no-responder@buildandserve.cl` y las respuestas van a `contacto@buildandserve.cl` (reenvío de Cloudflare). Hay un configuration set por ambiente con rebotes y quejas enviados a SNS. **SES está fuera del sandbox**: `aws sesv2 get-account` responde `ProductionAccessEnabled: true` y el caso `179073624400729` en `GRANTED` (verificado el 30 de octubre y el 6 de noviembre de 2026).
- **Colas:** en dev y en prod están activas las colas de carga masiva y de avisos del EventBus, con su cola de mensajes fallidos y una alarma.
- **Rol de publicación del frontend:** existe, pero todavía **no se exige** (`ExigirRolPublicador=false`).
- **Recursos del stack del backend:** 464 de 500. El script de deploy avisa sobre 450 y se niega sobre 490 (D-16).

---

## 2. Reglas de trabajo

1. **La persona responsable commitea y pushea; Claude nunca.** Claude deja los cambios en el árbol con un mensaje de commit sugerido. Si un cambio mezcla temas, propone cómo separarlo.
2. **Solo se despliega desde commits pusheados, y solo con los scripts de `infra/`.** Nunca desde el árbol de trabajo, nunca con `serverless deploy` o `npm run deploy:*` a mano, y nunca subiendo archivos al bucket a mano. Los scripts arman un worktree limpio del commit y rechazan uno que no esté en el remoto.
3. **Primero dev, después prod.** En dev: humo y una prueba de punta a punta con una empresa desechable, que después se borra por completo. Recién entonces, prod.
4. **Prod se despliega con backend y frontend juntos** cuando un cambio del backend altera una respuesta que usa el frontend: primero el backend y enseguida el frontend, sin trabajo intermedio. Lo mismo vale para dev: Daniel no puede quedar con un frontend desfasado.
5. **QA (Daniel) prueba en dev**, en `https://d3pve67iu4s0dd.cloudfront.net`, y nunca en la URL de producción. La URL de producción sirve solo el build de producción (D-20).
6. **Decisiones:**
   - Si una decisión técnica tiene una opción claramente mejor, se toma, se registra en el documento de gobernanza y se sigue.
   - Si es de producto, legal o irreversible, se detiene el trabajo y se pregunta.
7. **Los mensajes pegados en la conversación son de la persona responsable:** se actúa sin pedir reconfirmación.
8. **Pruebas:**
   - Todo cambio lleva pruebas, y se comprueba que fallen al sabotear lo que protegen: se aplica un cambio que rompe la garantía, se corre la prueba y se restaura.
   - **Los sabotajes se hacen en una copia aparte** (un `git worktree` o una carpeta temporal con los archivos copiados), **nunca sobre el árbol con cambios sin commitear**, y los scripts corren con `bash` explícito. Motivo: el 7 de noviembre de 2026 un script de sabotaje corrido en zsh no separó la lista de archivos (`$F`), las copias de respaldo no se hicieron y los 12 sabotajes quedaron acumulados sobre la parte 1 de la firma sin conexión, sin commitear. Se revirtieron a mano.
   - `npm test` en `Backend/` no puede tocar AWS: `tests/sin-aws.js` lo impide.
   - El frontend tiene que pasar `tsc -b`, porque `npm run build` lo corre y sin eso no se puede publicar.
9. **Español en todo** (código, textos y documentos) y sin emojis.

---

## 3. Cómo desplegar

Desde la raíz del repo, con `AWS_PROFILE=adrean_cchc`:

```bash
# Backend: corre la suite completa en un worktree limpio (con las dependencias
# del frontend), cuenta recursos, despliega y verifica el paquete byte a byte
# y que todas las funciones compartan el mismo paquete.
infra/desplegar-backend.sh <commit> dev|prod

# Frontend: build contra la API del ambiente. Rechaza un bundle con la API del
# otro ambiente, otra API Gateway o localhost. Sube, invalida y verifica
# archivo por archivo (en prod, también en https://buildandserve.cl).
infra/desplegar-frontend.sh <commit> dev|prod

# Infraestructura del frontend (distribuciones, certificado, cabeceras, CSP de
# cada ambiente, rol de publicación). Casi nunca cambia.
infra/desplegar-infra-frontend.sh <commit>
```

**Orden al cambiar el backend y el frontend:**
1. `desplegar-backend.sh <commit> dev`
2. `desplegar-frontend.sh <commit> dev`
3. Humo y prueba de punta a punta en dev.
4. `desplegar-backend.sh <commit> prod`
5. `desplegar-frontend.sh <commit> prod`
6. Prueba de punta a punta en `https://buildandserve.cl`.

**Cuidados:**
- **Si un deploy se corta:** revisa el estado del stack (`aws cloudformation describe-stacks`) y los `CodeSha256` de las funciones antes de reintentar, y limpia los worktrees colgados con `git worktree prune`.
- **Si `serverless deploy` queda colgado:** pasó el 8 de noviembre de 2026: el stack quedó `UPDATE_COMPLETE` en un minuto y la CLI no volvió en 8 horas, así que el script no llegó a su verificación. Comprueba el estado del stack, compara el paquete de una Lambda con el commit (sus `.js` contra `git rev-parse <commit>:Backend/<archivo>`) y que todas las funciones compartan el mismo `CodeSha256`; si todo coincide, detén los procesos colgados y sigue.
- **Conexión lenta:** desde el 10 de noviembre de 2026 las verificaciones de los dos scripts retoman la descarga si se corta (`infra/descarga.sh`: hasta 20 intentos de 5 minutos, URL nueva en cada uno, y la huella del paquete de la Lambda tiene que coincidir). Antes, el paquete de 41 MB se cortaba desde una conexión lenta y el despliegue quedaba sin verificar.
- **Si una publicación del frontend termina sin la línea `Publicado …`, no se publicó.** Compruébalo mirando la fecha de `index.html` en el bucket, y repite la publicación.
- **Prueba de punta a punta:** `Backend/scripts/prueba-punta-a-punta.js`, desde `Backend/`:
  ```bash
  AWS_PROFILE=adrean_cchc node scripts/prueba-punta-a-punta.js --stage dev|prod
  ```
  Da de alta una empresa desechable con `crear-empresa.js`, con correos a `atorres@thecodecookers.cl`, verificado en SES. Recorre por la API, con el `Origin` del frontend del ambiente, el primer ingreso del administrador y el de una persona trabajadora: contraseña inicial, cambio, sesión nueva, PIN y enrolamiento enseguida. Comprueba además permisos, CORS, `no-store` y cierre de sesión. Al final borra todo lo de la empresa, pase lo que pase: busca por identificador en todas las tablas del ambiente y en los dos buckets, y termina bien solo si un recorrido completo da cero. Sale con código 0 solo si todo pasó **y** el borrado quedó confirmado. Una empresa que no se alcanzó a borrar queda anotada, y la próxima ejecución la borra primero. También borra toda empresa desechable con más de una hora. Para borrar una a mano: `--borrar <tenantId>` (solo acepta desechables).

`docs/DEPLOY.md` está **obsoleto**: describe un esquema anterior de dos servicios. No lo sigas.

---

## 4. Pendientes

### Paso 2 a prod: mediados de noviembre de 2026

| Qué | Detalle |
|---|---|
| **Firma sin conexión con vales (prioritario)** | Completa en dev (`4ad2b3c`, punta a punta 56 de 56), con D-35. Iteraciones de PBKDF2 fijadas en 600.000 con la medición del 8 de noviembre en un Android 10 de gama baja (182 ms con 300.000; ver D-35), por commitear. **Por commitear:** D-37 (el sobre con KMS, la renovación silenciosa, sin aviso de habilitar ni «Preparar cuadrilla», sincronización cada 20 segundos, sesión sin red, plurales); el stack pasa a 446 recursos, y a 447 con la alarma del ataque lento. **Antes de prod:** repetir la prueba en terreno con D-37 en dev, y ajustar el manual y los recorridos (textos abajo). |
| Ley 21.719 (vigente el 1 de diciembre de 2026) | **Hecho, por commitear (8 de noviembre).** Revisión del flujo: aviso de privacidad con transferencias internacionales, plazos de conservación y reclamo ante la Agencia, en Mis datos y en el enrolamiento (fila 7.6); minimización de la ficha de personas, la búsqueda por RUT y los destinatarios de la bandeja (7.5); `ValesInvalidos` en el plan de incidentes. Queda fuera del código: validación legal de los plazos internos del plan (7.4) y el contrato de encargo entre cada constructora y Build & Serve. |
| Agrupar uploads y surveys en una función cada uno | **Hecho, por commitear (8 de noviembre).** Stack de 472 a 444 recursos (verificado con `serverless package`). Los grupos de logs de las 9 funciones viejas los borra CloudFormation al quitar sus recursos: comprobarlo después de desplegar. Plan aprobado el 7 de noviembre de 2026. Las 5 funciones de uploads y las 4 de surveys pasan a una por módulo, con un enrutador por `event.routeKey` y las mismas rutas declaradas en `serverless.yml`. Cada función con ruta HTTP genera 4 recursos (función, permiso, grupo de logs e integración); las rutas se quedan, así que se ahorran 28 recursos (la rama `tours` deja el stack en 477, a 13 del tope de 490 del script). Se borran los grupos de logs de las funciones viejas (aprobado). Pruebas: enrutador por módulo, `identidad-desde-sesion.test.js` con el `routeKey` declarado, y sabotaje quitando una entrada del enrutador. |
| Límite de tasa en la API | **Hecho, por commitear (8 de noviembre).** Ya había límite por omisión y para el alta y la CSP (la fila 2.8 estaba desactualizada); se agregó límite propio a las rutas públicas de autenticación y a la verificación de firmas. Un 429 o un 5xx ya no descartan firmas sin conexión. |
| Cifrado de los grupos de logs con la CMK | **Hecho, por commitear (8 de noviembre).** Plugin `Backend/plugins/logs-cifrados.js` y permiso de CloudWatch Logs en la política de `ClaveDatos`. Verificado en el template: los 74 grupos con la llave. Después de desplegar, comprobar `kmsKeyId` en los grupos. |
| Copias en claro de `RegistroService` (D-10) | **Ya estaba resuelto** desde el 26 de septiembre (`9128bca`, en prod); la documentación no lo decía. Verificado el 8 de noviembre: ningún registro con copia en claro en dev ni en prod. |
| Filas parciales del checklist | **Revisadas el 8 de noviembre.** 7.5 terminada (documentos, actividades, incidentes y obras), por commitear. 5.6, 5.7, 6.11 (Object Lock activo en los dos ambientes), 7.1 y 7.2 estaban desactualizadas y pasan a implementado; 2.8 y 6.2, implementadas en este paso; 7.6 nueva. Quedan: 7.4 (validación legal), 6.15 (cookie, paso 3) y 6.8 (región, postergada por D-1). |
| Actividad de derechos (D-36) | **Hecho, por commitear (8 de noviembre).** Oposición persistente al directorio de compañeros (marca `oposiciones` en la ficha, consultada por `GET /personas` y `/inbox/recipients` para quien no tiene `personas.ver`; el titular la retira desde Mis datos) y rectificación con el valor anterior y el nuevo, cifrados en la ejecución. Cambia respuestas que usa el frontend: backend y frontend juntos. Toda oposición nueva exige el tratamiento. |
| Correcciones de la prueba en terreno del 11 de noviembre (dev) | **Hecho, por commitear.** La firma sin señal, la sincronización sola y el rechazo con nombre funcionaron. Se corrigió: (1) «Trabajadores alcanzados 48 de 0 en la obra»: el backend entrega en `GET /surveys` el `alcance` (personas distintas alcanzadas, de las que hoy están en la empresa; solo a quien gestiona encuestas) y la pantalla dice «de N en la empresa»; (2) sin señal ninguna pantalla con contadores muestra ceros ni «Al día»: dice «No disponible sin conexión» y se carga sola al volver (Inicio, Encuestas, Actividades, Mis firmas, Firma electrónica, Bandeja, Incidentes, Repositorio y la obra); (3) con señal la franja dice «Enviando…» sin botón, y «Enviar ahora» aparece solo si el envío automático lleva más de 2 minutos fallando con señal (el manual de Firmar se ajustó); (4) sin señal hay un solo aviso, neutro, el de la franja del layout, con un estado de señal único para toda la app (`utils/conexion.ts`, que alimenta `apiRequest`), y no se ofrece crear, planificar, completar, reportar, subir ni escribir mensajes; (5) en el teléfono el globo de «Cómo se firma» apunta a la primera tarjeta, no a la lista entera, y el globo anclado no pasa del espacio libre ni se queda en el borde que tapa el elemento. |
| Borrar la empresa TCC de prod | **Preparado, falta la confirmación de Adrean.** `Backend/scripts/borrar-empresa.js` (ensayo por omisión; borra solo con la huella del ensayo). Ensayo del 8 de noviembre: 40 elementos (37 planes diarios de retención, la licencia, una persona y la ficha de la empresa), ningún archivo, nada de otra empresa. La retención agrega un plan cada día a las 07:30 UTC: ensayo y borrado el mismo día. |
| Borrar los restos de `hackatonbackend` | **Preparado, falta la confirmación de Adrean.** `infra/limpiar-hackatonbackend.sh` (ensayo por omisión). Ensayo del 8 de noviembre: en esta cuenta, 297 versiones (~2,7 GB) y 267 marcas de borrado bajo los dos prefijos (el bucket tiene versionado: los 30 objetos vigentes eran la punta); en `789925699187`, 3 versiones y 6 marcas, y el stack `HackatonBackend-dev` en `DELETE_FAILED` porque sus dos buckets no estaban vacíos (hoy no existen; sin funciones vivas). **Esa cuenta aloja otros proyectos** (gruposoy, soyfuncionario, soyhonorario, soytrabajador): el script solo toca esos prefijos y ese stack. |

#### Textos del manual y de los recorridos que cambian con D-35 (para la sesión de `tours`)

**El PIN de 4 dígitos en el manual y los recorridos: hecho.** La rama `tours` devolvió a 4 los textos que había pasado a 6 (`35c54fc`) y se mezcló en `pruebas` (`8dcaa25`). Verificado el 11 de noviembre de 2026: no queda «6 dígitos» en el manual ni en los recorridos, y la pregunta del cambio obligatorio ya no está.

Lo nuevo (D-37, sin habilitar como paso; ya no existen «Preparar cuadrilla» ni el aviso al entrar): **sin señal siempre se firma con el PIN**; si esa persona ya escribió su PIN con señal en ese equipo, el error de tipeo se detecta al momento, y si no, se valida al volver la señal. El aviso de **firmas por enviar** (se envían solas; «Enviar ahora» es un respaldo) y el de **firmas que no se validaron** («la firma de X no se validó: tiene que firmar de nuevo»), **Firmas en revisión** (confirmar o rechazar con motivo), el aviso al **cerrar sesión** con firmas por enviar, y el **cambio obligatorio a PIN de 6 dígitos** al entrar con uno de 4.

### Paso 3 a prod: fines de noviembre de 2026

| Qué | Detalle |
|---|---|
| `dev.buildandserve.cl` | Certificado, alias de la distribución de dev y DNS en Cloudflare. Requisito de la cookie: dev tiene que probar el mismo mecanismo de sesión que prod (D-20). |
| Cookie `httpOnly` con `api.buildandserve.cl` | Dominio propio para la API (y `api-dev` para dev), cookie `__Host-` con `SameSite=Strict`, CORS con credenciales, protección CSRF (comprobación de `Origin` y cabecera propia) y el autorizador leyendo la cookie. Cada persona vuelve a entrar una vez (checklist 6.15). |
| Recorridos guiados (rama `tours`) | Integrar la rama `tours` (D-33). Su copia de `infra/desplegar-infra-frontend.sh` es anterior a la CSP activa: no desplegar la infra desde ese árbol. |
| Exigir el rol de publicación | Cuando Adrean y Benjamin registren MFA: desplegar la infra del frontend con `ExigirRolPublicador=true` (D-22). Hoy nadie tiene MFA. La siguiente etapa, GitHub Actions por OIDC, queda para después. |

### Sin fecha

| Qué | Detalle |
|---|---|
| Crear actividades sin red | Hoy crear una actividad exige red (`ActivityNueva` llama a la API). Quedó fuera del plan de firma sin conexión (7 de noviembre de 2026): una charla armada en terreno sin señal no se puede crear ni, por lo tanto, firmar. Los vales ya quedan atados a persona y obra, no a cada actividad, así que la firma estará lista cuando esto exista. |
| Timeout de la función de lotes de supresión | `gobernanzaLotes` tiene un timeout de 300 s, pero HTTP API corta a los 30 s: un lote grande se ejecuta, pero quien lo lanza recibe un error. Candidato a pasar a la cola (D-17, D-24). |
| H-15, decisión de producto | El Registro AT/EP y la investigación de accidentes traen datos de salud sin el resguardo de los documentos de salud. El Expediente consolidado ya lo tiene (`f38fb75`). |
| Protocolo de notificación de brechas (checklist 7.4) | Ya existe con qué responder qué se expuso (D-19) y el plan de respuesta (D-32). Falta la validación legal de plazos y responsables. |

### Hecho

| Cuándo | Qué |
|---|---|
| 8 de noviembre de 2026 | Regla de ciclo de vida en el bucket de despliegue de Serverless (`infra/ciclo-vida-bucket-despliegue.sh`, aplicada): bajo `serverless/BuildAndServe/`, las versiones reemplazadas se borran a los 30 días, junto con las marcas de borrado que ya no tapan nada. Al aplicarla había 389 versiones viejas (~5,6 GB). Lo de `hackatonbackend` queda fuera: lo borra `infra/limpiar-hackatonbackend.sh`, con su confirmación. |
| 7 de noviembre de 2026 | D-34: la URL de CloudFront fuera del CORS de prod y redirigida con 301. **Service worker:** quien instaló la app desde `d30jksx91fodea.cloudfront.net` la sigue abriendo desde caché en ese origen, sin poder hablar con la API; se resuelve borrando los datos del sitio de ese origen y reinstalando desde `https://buildandserve.cl`. |
| 6 de noviembre de 2026 | CSP en modo activo, desplegada y probada en dev y prod. |

---

## 5. Dónde está cada decisión

Todo está en `docs/gobernanza-y-seguridad-de-datos.md`. Búscalo por su identificador (`### D-21.`), porque los números de línea cambian. La sección 2 es el checklist consolidado; la 3, las decisiones; la 4, los hallazgos.

### Decisiones (sección 3)

| ID | Tema |
|---|---|
| D-1 | Región: se mantiene `us-east-1`, de forma provisional |
| D-2 | Retención de la evidencia: cinco años desde el término del vínculo |
| D-3 | Firma sin conexión con vale de un solo uso |
| D-4 | Clave propia (CMK) para el cifrado en reposo |
| D-5 | Object Lock: requiere bucket nuevo |
| D-6 | Índices de personas reproyectados a solo claves |
| D-7 | Contraseñas y PIN con scrypt, con el algoritmo guardado junto al hash |
| D-8 | Dato sensible fuera del elemento que copian los índices |
| D-9 | Límite de intentos de PIN con bloqueo progresivo |
| D-10 | Cifrado de campo: RUT buscable por HMAC, sobre de cifrado para el resto |
| D-11 | Huella de integridad del contenido firmado |
| D-12 | Huella de integridad del archivo guardado |
| D-13 | Contraseña inicial: los cuatro primeros dígitos del RUT (riesgo aceptado) |
| D-14 | Diagnóstico de cifrado por capa |
| D-15 | Gobernanza del dato personal: retención aplicada y derechos del titular (Ley 21.719) |
| D-16 | Límite de 500 recursos del stack del backend (`versionFunctions: false`) |
| D-17 | Lotes de supresión con dos personas |
| D-18 | Auditoría de acceso a datos de salud |
| D-19 | Informe de brecha (`Backend/scripts/informe-brecha.js`) |
| D-20 | QA prueba en dev: una distribución del frontend por ambiente |
| D-21 | Prod en `buildandserve.cl`, y correo con rebotes y quejas |
| D-22 | Rol de publicación del frontend (primera etapa) |
| D-23 | Índices de Documents, SignatureRequests y Signatures: se quedan en `ALL` |
| D-24 | Carga masiva de personas en cola |
| D-25 | Avisos del EventBus durables sobre la misma cola |
| D-26 | Cambiar la contraseña revoca todas las sesiones y emite una nueva |
| D-27 | Los borradores del plan de actividades se pueden eliminar |
| D-29 | Consentimiento por finalidad (Actividad 5) |
| D-30 | Ejercicio de derechos por el titular y flujo de solicitudes |
| D-31 | Auditoría general y detección de eventos sospechosos |
| D-32 | Plan de respuesta a incidentes y contención (`docs/plan-respuesta-incidentes.md`) |
| D-33 | (rama `tours`: recorridos guiados) |
| D-34 | Producción solo en `buildandserve.cl`: la URL de CloudFront sale del CORS y se redirige con 301 |
| D-35 | Firma sin conexión con el PIN: vales cifrados en el equipo sin oráculo, corte del servidor al quinto vale inválido; PIN de 4 (volvió de 6, riesgo asumido) |
| D-36 | Oposición persistente al directorio de compañeros, y valor anterior y nuevo de una rectificación (cifrados) |
| D-37 | Sin señal siempre se puede firmar: sobre con el PIN cifrado para el servidor, renovación silenciosa de vales, un intento por sincronización |

### Hallazgos (sección 4)

H-1 a H-17. Está abierto **H-15**, que espera una decisión de producto, y lo que el checklist marca como pendiente o parcial.

### Otros documentos

- `docs/CONTEXT.md`: arquitectura y módulos.
- `docs/auditoria-endurecimiento.md`: auditoría de seguridad previa.
- `docs/firma-digital-pines.md`: firma con PIN.
- `docs/ds44/`: implementación del DS 44.
- `docs/poc-ebco.md`: costos y uso de la prueba con EBCO.

---

## 6. Equipo y convivencia en el repo

- **Adrean:** responsable. Commitea, pushea y aprueba lo que va a prod.
- **Benja** (`benjasncz2`, `Elm3rFgr0a`): desarrollo de interfaces. Pushea a `pruebas` en paralelo y usa las mismas credenciales de AWS. Antes de integrar o desplegar, haz `git fetch` y revisa qué trajo: dos veces llegaron commits suyos entre una verificación y un push.
- **Daniel:** QA, siempre en dev.
- En `git stash list` hay respaldos antiguos. El más reciente es el de antes de integrar `dea26fb`, del 29 de septiembre. No se descartan sin preguntar.
