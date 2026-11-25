# Estado actual de Build & Serve

**Checkpoint del 15 de noviembre de 2026, al cerrar la sesión del paso a prod 2.** Este documento basta para retomar el trabajo sin leer conversaciones anteriores: léelo entero antes de tocar nada. Si algo de lo que dice aquí no coincide con lo que ves en AWS o en git, gana lo que ves. Si lo compruebas, actualiza este documento.

El producto está en producción con datos reales. Ante la duda, prioriza la solidez.

**Para empezar una sesión nueva:** lee las secciones 2 (reglas) y 4 (siguiente etapa, en orden), haz `git fetch` y revisa qué trajo `origin/pruebas` (sección 6), y corre las suites antes de cambiar nada (sección 3, «Pruebas locales»).

---

## 1. Qué está desplegado

Todo vive en la cuenta AWS `772706200162`, región `us-east-1`. El perfil local es `adrean_cchc`; el perfil por defecto apunta a otra cuenta (`789925699187`, con otros proyectos: no tocar). La rama de trabajo es `pruebas`.

| Ambiente | Pieza | Dónde | Commit |
|---|---|---|---|
| **Prod** | Backend | Stack `BuildAndServe-prod`, API `https://92flgz68r1.execute-api.us-east-1.amazonaws.com` | `05a93d0` (rama `alertas-soporte`) |
| **Prod** | Frontend | **https://buildandserve.cl** (`www` redirige a la raíz con 301). Distribución `E265RJ7EAYTXAX` (`d30jksx91fodea.cloudfront.net` redirige con 301 a `buildandserve.cl` desde D-34), bucket `buildandserve-frontend` | `5813205` |
| **Dev** | Backend | Stack `BuildAndServe-dev`, API `https://n2waslgjca.execute-api.us-east-1.amazonaws.com` | `alertas-soporte` (`70d8003`) |
| **Dev** | Frontend | **https://d3pve67iu4s0dd.cloudfront.net** (la URL de QA). Distribución `E2XMHI7KDD48MR`, bucket `buildandserve-frontend-dev` | `5813205` |
| Ambos | Infra del frontend | Stack `BuildAndServe-frontend`: dos distribuciones, certificado, cabeceras, CSP y rol de publicación | `14fa693` (no cambió después) |

**Backend de prod y dev en la rama `alertas-soporte` (20 de noviembre de 2026).** Sale de `5813205` y suma solo dos correcciones: las alarmas a `soporte@buildandserve.cl` (`e4e1b13`) y que una contraseña abra solo las empresas donde coincide, sin `reset-password` (`70d8003`, H-A y H-B); `05a93d0` agrega los casos a la prueba de punta a punta, que pasó en dev. Los mismos commits están en `pruebas` (`1d45aad`, `4174c7b`, `a452c52`). El frontend sigue en `5813205`: el cambio de frontend de `70d8003` solo quita código sin uso.

**Antes, prod y dev en `5813205` (paso a prod 2).** Trae todo lo acumulado desde `14fa693`: la firma sin conexión con vales y sobre con KMS (D-35, D-37) y PIN de 4 dígitos con un intento por sincronización y la alarma del ataque lento; la Ley 21.719 (aviso de privacidad, minimización 7.5, actividad de derechos D-36); uploads y surveys en una función cada uno; el límite de tasa de la API; los logs cifrados con la CMK; los recorridos guiados y el manual (rama `tours`, D-33); y las correcciones de la prueba en terreno del 11 de noviembre (un solo aviso sin señal, «No disponible sin conexión» en vez de ceros, «Enviando…» sin botón, alcance de encuestas por personas distintas, globo del recorrido sin tapar).

**Qué se verificó:**
- **Dev (13 de noviembre de 2026):** backend con el script, 454 recursos y 111 de 111 archivos del paquete idénticos al commit; frontend 113 de 113; prueba de punta a punta 64 de 64, con el borrado confirmado en 23 tablas y 2 buckets. Antes, en local: backend 1371 de 1371, frontend 110 de 110, Playwright 64 de 64, y 19 de 19 sabotajes atrapados.
- **Prod (desplegado por Adrean):** backend y frontend `5813205` con los scripts y prueba de punta a punta **65 de 65**. El stack de prod quedó en **454 recursos** (lo informó `desplegar-backend.sh`; venía de 470). **Todos los grupos de logs de prod con `kmsKeyId`**: el comando de abajo salió vacío.
  ```bash
  aws logs describe-log-groups --log-group-name-prefix /aws/lambda/BuildAndServe-prod --query "logGroups[?!kmsKeyId].logGroupName" --output text   # vacío
  ```
  **Por comprobar:** que CloudFormation haya borrado los grupos de logs de las 9 funciones viejas de uploads y surveys (en dev sí los borró). Este comando lista los grupos de prod sin función viva; tiene que salir vacío:
  ```bash
  for g in $(aws logs describe-log-groups --log-group-name-prefix /aws/lambda/BuildAndServe-prod- --query 'logGroups[].logGroupName' --output text); do
      aws lambda get-function --function-name "${g#/aws/lambda/}" >/dev/null 2>&1 || echo "$g"
  done
  ```

**Historia anterior (resumida).** Prod estuvo en `14fa693` del 7 al ~14 de noviembre (punta a punta 29 de 29, 470 recursos). Dev pasó por `072d2ec`, `8d95d6b`, `6fe165a` y `8dcaa25` entre el 8 y el 11 de noviembre.

**Cómo saber qué commit hay en AWS.** Los scripts no dejan el commit escrito en AWS: para el backend se compara el paquete de una Lambda (`aws lambda get-function`) con el árbol `Backend/` del commit; para el frontend, el script de publicación verifica archivo por archivo contra la URL del ambiente.

**Estado de cada pieza:**

- **Dominio:** certificado de ACM para `buildandserve.cl` y `www`, validado por DNS en Cloudflare con la nube gris (sin proxy). El TLS mínimo en el dominio es 1.2. Desde el 7 de noviembre de 2026, `www` y `d30jksx91fodea.cloudfront.net` redirigen con 301 a `https://buildandserve.cl` con la misma ruta y consulta (D-34), y el CORS de prod acepta solo el dominio propio.
- **CSP:** **activa** en las dos distribuciones desde el 6 de noviembre de 2026 (infra de `4b2db9e`, desplegada a las 21:30 hora de Chile). Probada en dev y prod en el navegador sin errores de CSP en la consola; verificado con `curl` que `buildandserve.cl` y la URL de dev sirven `Content-Security-Policy` con la política completa y ya no la de solo reporte. Las violaciones se siguen reportando a `POST /csp/reporte` (métrica `CspViolaciones`). Volver a solo reporte: `CSP_MODO=solo-reporte infra/desplegar-infra-frontend.sh <commit>`. Un cambio al script en línea de `index.html` o de los informes exige desplegar primero la infra de ese commit: `desplegar-frontend.sh` se niega a publicar un build que la política activa no autoriza.
- **Correo:** sale de `no-responder@buildandserve.cl` y las respuestas van a `contacto@buildandserve.cl` (reenvío de Cloudflare). Hay un configuration set por ambiente con rebotes y quejas enviados a SNS. **SES está fuera del sandbox**: `aws sesv2 get-account` responde `ProductionAccessEnabled: true` y el caso `179073624400729` en `GRANTED` (verificado el 30 de octubre y el 6 de noviembre de 2026).
- **Alarmas:** las 6 alarmas de cada ambiente avisan al tópico `BuildAndServe-alertas-operacion-<stage>`, suscrito por correo a `soporte@buildandserve.cl` (fija en `serverless.yml`). Las dos suscripciones quedaron confirmadas el 20 de noviembre de 2026 (`SubscriptionsConfirmed` 1, `SubscriptionsPending` 0). **`ConfirmationWasAuthenticated` quedó en `false` en las dos:** Zoho abrió el enlace de confirmación antes que la CLI, así que cualquiera que reciba un correo de alarma puede dar de baja la suscripción sin credenciales. **Regla: nunca tocar el enlace «unsubscribe» de un correo de alarma**, ni reenviar esos correos a quien no corresponda. Si la suscripción se cae, CloudFormation no lo nota (sigue en `CREATE_COMPLETE`): verifícalo con
  ```bash
  aws sns get-topic-attributes --topic-arn arn:aws:sns:us-east-1:772706200162:BuildAndServe-alertas-operacion-prod --query 'Attributes.[SubscriptionsConfirmed,SubscriptionsPending]' --output text   # 1 0
  ```
- **Colas:** en dev y en prod están activas las colas de carga masiva y de avisos del EventBus, con su cola de mensajes fallidos y una alarma.
- **Rol de publicación del frontend:** existe, pero todavía **no se exige** (`ExigirRolPublicador=false`): los scripts avisan «publicando con tus credenciales (sin MFA)».
- **Recursos del stack del backend:** 454 de 500, en dev y en prod. El script de deploy avisa sobre 450 y se niega sobre 490 (D-16): hoy siempre avisa. Antes de sumar funciones con ruta HTTP (4 recursos cada una), agrupar en módulos como uploads y surveys.

---

## 2. Reglas de trabajo

1. **La persona responsable commitea y pushea; Claude nunca.** Claude deja los cambios en el árbol con un mensaje de commit sugerido. Si un cambio mezcla temas, propone cómo separarlo.
2. **Solo se despliega desde commits pusheados, y solo con los scripts de `infra/`. Dev, solo desde `pruebas`; prod, solo desde `main` y con el commit que se probó en dev** (`docs/flujo-de-trabajo.md`, desde el 22 de noviembre de 2026; los scripts lo exigen con `infra/rama-del-ambiente.sh`). Nunca desde el árbol de trabajo, nunca con `serverless deploy` o `npm run deploy:*` a mano, y nunca subiendo archivos al bucket a mano. Los scripts arman un worktree limpio del commit y rechazan uno que no esté en el remoto.
3. **Primero dev, después prod.** En dev: humo y una prueba de punta a punta con una empresa desechable, que después se borra por completo. Recién entonces, prod.
4. **Prod se despliega con backend y frontend juntos** cuando un cambio del backend altera una respuesta que usa el frontend: primero el backend y enseguida el frontend, sin trabajo intermedio. Lo mismo vale para dev: Daniel no puede quedar con un frontend desfasado.
5. **Las pruebas manuales se hacen en dev**, las hace el equipo (Daniel ya no hace QA desde el 20 de noviembre de 2026), en `https://dev.buildandserve.cl` (desde el 22 de noviembre de 2026; la URL de CloudFront de dev redirige ahí con 301), y nunca en la URL de producción. Los casos de la sesión en cookie están en `docs/pruebas-manuales-sesion.md`. La URL de producción sirve solo el build de producción (D-20).
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
10. **En prod, Claude no ejecuta nada sin que lo pida Adrean en ese momento.** Prepara los comandos en orden con el commit real y Adrean los corre. Los borrados en prod (empresas, restos de proyectos viejos) van siempre con ensayo primero y se ejecutan solo con la confirmación de Adrean después de ver el ensayo. Cuando el pedido es de solo lectura, no se escribe en AWS.
11. **La cuenta `789925699187` aloja otros proyectos** (gruposoy, soyfuncionario, soyhonorario, soytrabajador): ahí solo se toca lo de HackatonBackend.
12. **Nunca `npx` con un paquete que no esté en el `package.json`.** Se usan los binarios de `node_modules/.bin`; si falta una herramienta, se avisa en vez de descargarla.
13. **Informes cortos y en español** al terminar cada pedido; si algo no se verificó, se dice.

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

**Pruebas locales:**
```bash
(cd Backend && npm test)        # ~1377 pruebas; incluye la lógica TS del frontend (tests/cargar-ts.js)
(cd Frontend && npm test)       # ~110; dos de ellas hacen un build de prod (~35 s cada una)
(cd Frontend && ./node_modules/.bin/tsc -b && npm run build)
# Playwright (navegador real, API simulada). `Frontend/.env` apunta a la API real de dev:
# sin esta variable todas las pruebas caen en la pantalla de ingreso.
(cd Frontend && VITE_API_URL=http://localhost:3001 npm run test:e2e)   # ~64
```
Si falta Playwright en `Frontend/node_modules`, `npm ci` en `Frontend/` lo instala (está en el `package.json`).

`docs/DEPLOY.md` está **obsoleto**: describe un esquema anterior de dos servicios. No lo sigas.

---

## 4. Pendientes

### Abierto de esta sesión

| Qué | Estado |
|---|---|
| Borrar los restos de `hackatonbackend` | **Se cortó a mitad de camino el 15 de noviembre; el script ya está corregido, por commitear.** `--ejecutar` borró completo `serverless/hackatonbackendv2/` en `serverless-framework-deployments-us-east-1-e30a0f06-a273` (cuenta `772706200162`) y se detuvo con un `JSONDecodeError`: con `"Quiet": true` y sin errores, `delete-objects` responde vacío y el script lo leía como JSON. Lo que queda (contado en solo lectura el 15 de noviembre): en `772706200162`, `serverless/hackatonbackendv2-testeo/` con 36 versiones (367 MB) y 21 marcas; en `789925699187`, `serverless/hackatonbackendv2-testeo/` con 3 versiones (29 MB) y `serverless/HackatonBackend/` con 6 marcas; el stack `HackatonBackend-dev` sigue en `DELETE_FAILED` con solo `DocumentsBucket` e `IncidentEvidenceBucket` fallidos. El script nuevo lee vacío como `{}`, se detiene con el detalle si un lote trae errores, verifica con el mismo conteo y sale con error si queda algo; se puede repetir. Prueba: `Backend/tests/limpiar-hackatonbackend.test.js` (con un `aws` simulado; 6 sabotajes atrapados, entre ellos la versión que falló). **Lo corre Adrean** después de commitear: `bash infra/limpiar-hackatonbackend.sh` (ensayo) y luego `--ejecutar`. |

| **Activación con los cuatro dígitos y vencimiento (D-41), para el jueves 26** | Decidido el 22 de noviembre de 2026; reemplaza la activación una por una de D-40, que sigue disponible. En la rama `feat/activacion-cuatro-digitos`, por pull request a `pruebas` (revisa Benja Pinto el martes 24). **Al pasar a prod, justo después del backend:** `node scripts/migrar-acceso-inicial.js --stage prod` (cuenta) y después con `--aplicar`; hasta correrla, las fichas de D-13 no entran. En dev, la misma migración deja con los cuatro dígitos a las pendientes de D-40. |
| Chequeo de suscriptores de las alarmas | **Hecho el 24 de noviembre de 2026** (rama `feat/vigilar-suscriptores-alarmas`), sin recursos nuevos en el stack. (1) Todos los días a las 13:00 UTC, la función que ya existía `checkEstructuraAlerts` lee `SubscriptionsConfirmed` del tópico de su ambiente (`lib/vigilanciaAlertas.js`, con permiso `sns:GetTopicAttributes` solo sobre ese tópico); si es 0, escribe por SES directo a `soporte@buildandserve.cl` con el tópico y los comandos para volver a suscribir. Un fallo del chequeo no detiene los avisos de estructura. (2) `desplegar-backend.sh` termina con error, después de desplegar, si el tópico quedó sin suscripciones confirmadas. Lo que no cubre: si la casilla está suprimida en SES, el aviso tampoco llega (queda en el log de la función). Pendiente aparte: volver a confirmar las dos suscripciones con `--authenticate-on-unsubscribe true`, para que el enlace «unsubscribe» de un correo deje de servir sin credenciales. |
| **Dev vuelve a correr `pruebas` (cambio de plan del 22 de noviembre)** | Adrean decidió primero que dev corriera `sesion-cookie` hasta la visita del 3 de diciembre, y el mismo 22 de noviembre lo cambió: el equipo tiene que seguir desplegando en dev esta semana, así que dev corre `pruebas` y prod sigue saliendo de `alertas-soporte`. Los dominios, los scripts, `--solo-dev` y la paginación del Scan (b4d5a2b, e647107, f0a5f1a, 60e7ffb) llegaron a `pruebas` con cherry-pick; 60e7ffb chocó con 33644fb, que ya paginaba el Scan, y quedó la versión de 60e7ffb más las pruebas de la ficha sin RUT de 33644fb. El bucket `buildandserve-dictados-dev` quedó huérfano por un despliegue de `sesion-cookie` (18:16) después de uno de `pruebas` (17:50); antes de volver a desplegar `pruebas` en dev se vacía y se borra, para que el stack lo cree de nuevo. La cookie se termina en `sesion-cookie` y llega a `pruebas` con cherry-pick, no con rebase. |
| **Credenciales de AWS por persona (después de la visita del 3)** | Hoy todos despliegan con la misma clave del usuario IAM `Adrean` (`AKIA3H2H…`): el 22 de noviembre, CloudTrail mostró despliegues a dev desde dos IP con esa clave, y no se puede saber quién hizo cada uno. Un usuario IAM o acceso por SSO (IAM Identity Center) por persona, con su MFA, y rotar la clave actual. Va junto con el 5 de la «Siguiente etapa» (`ExigirRolPublicador`). |
| **Panorama de la empresa y lectura en voz, ocultos para la visita** | Decidido por Adrean el 22 de noviembre de 2026. `Frontend/src/config/funciones.ts` (`panoramaEmpresa` y `lecturaEnVoz` en `false`): en modo empresa el inicio vuelve a ser el de antes de be173d6 y «Gestionar la empresa» lleva a `/mi-empresa`; la lectura en voz (99c3d3c) no muestra el botón Escuchar ni el reproductor, y el manual de firmas ya no la menciona. El backend de las dos sigue desplegado. **El panorama** se oculta porque sin señal solo muestra el error. **La lectura en voz** se vuelve a encender si el equipo la prueba en dev el miércoles 25 y se acepta: `lecturaEnVoz: true` y devolver el párrafo de **Escuchar documento** a `manual/content/terreno/firmar.md` (lo exige `tests/funciones-ocultas.test.js`). |
| «The Code Cookers» (`462b6bc5`) | Segunda empresa en prod, creada el 17 de septiembre de 2026, con su administrador en `pendiente` y sin enrolar. No se toca hasta después de la visita: se decide junto con TCC. |
| **Protección de `main` y `pruebas` en el repositorio nuevo** | Esta semana el proyecto se cambia a un repositorio nuevo; la protección se configura ahí, no en el actual. En `main` y `pruebas`: no se borran y no aceptan push forzado; `pruebas` exige pull request con una aprobación de otra persona, que se pierde con cada commit nuevo y con el último push; `main` solo la actualiza quien publica en prod (con `git push origin <commit-probado>:main`, que solo avanza). Si el repositorio nuevo es privado en una cuenta personal, las reglas de rama piden un plan de pago. Las pruebas automáticas obligatorias (GitHub Actions) quedan para después de la visita. |

### Siguiente etapa, en este orden

| # | Qué | Detalle |
|---|---|---|
| 1 | **Sesión en cookie segura con `api.buildandserve.cl`** | Dominio propio para la API (y `api-dev.buildandserve.cl` para dev), cookie `__Host-` `httpOnly` con `SameSite=Strict`, CORS con credenciales, protección CSRF (comprobación de `Origin` y cabecera propia) y el autorizador leyendo la cookie. Cada persona vuelve a entrar una vez (checklist 6.15). Cuidar la sesión sin red: hoy `sesionLocal.ts` guarda una copia del usuario y el cierre automático pregunta al servidor antes de cerrar; con cookie, la sesión no puede caerse por falta de señal. Requiere el 2 para probarse en dev con el mismo mecanismo que prod (D-20). |
| 2 | **Subdominio `dev.buildandserve.cl`** | Certificado, alias de la distribución de dev y DNS en Cloudflare (nube gris, como prod). Las pruebas manuales pasan a esa URL; actualizar la regla 5 y el CORS de dev. Conviene hacerlo antes o junto con el 1. |
| 3 | **«Olvidé mi PIN» con aviso al administrador** | Hoy solo el administrador puede restablecer un PIN (Personas → la persona → Restablecer PIN, con motivo de al menos 10 caracteres). Falta que la persona lo pida desde su sesión y que llegue un aviso al administrador (bandeja y correo). Decisión de producto pendiente: quién puede restablecer y si el pedido expira. |
| 4 | **«Crear PIN» sin recargar tras restablecer** | Después de un restablecimiento, la persona tiene que recargar la página para que aparezca «Crear PIN de firma» en Configuración (pasó con el admin de dev que tenía PIN de 6 dígitos). El estado del PIN tiene que refrescarse solo (al volver a la pantalla o con el aviso del restablecimiento). |
| 5 | **`ExigirRolPublicador` con MFA** | Cuando Adrean y Benjamin registren MFA: desplegar la infra del frontend con `ExigirRolPublicador=true` (D-22). Hoy nadie tiene MFA. GitHub Actions por OIDC queda para después. |
| 6 | **Borrar la empresa TCC de prod** | **Detenido hasta confirmar quién entró el 13 de noviembre.** El ensayo del 13 de noviembre (16:35 UTC) dio 50 elementos (huella `6fe261bcf3ceacd6`): 42 planes diarios de retención, la licencia, una persona y la ficha de la empresa, como antes, más **3 eventos de acceso de ese mismo día (11:25, 16:14 y 16:14 UTC) y 2 sesiones**, que el 8 de noviembre no estaban. Si TCC está en uso, no se borra. Si se confirma que se borra: ensayo y borrado juntos, el mismo día, porque la huella cambia con cada plan diario (07:30 UTC) y con cada acceso: `(cd Backend && node scripts/borrar-empresa.js --stage prod --empresa a5ffc38d-44b7-47f0-bb15-58f37f9f2b4c --nombre "TCC")` y luego lo mismo con `--ejecutar <huella del ensayo recién hecho>`. Lo corre Adrean. |
| 7 | **Revisión legal** | Plazos internos del plan de respuesta a incidentes (checklist 7.4, `docs/plan-respuesta-incidentes.md`, D-32) y el contrato de encargo entre cada constructora y Build & Serve (Ley 21.719, vigente el 1 de diciembre de 2026). No es código: lo gestiona Adrean con quien corresponda. |
| 8 | **Lo que queda abierto del checklist** (`docs/gobernanza-y-seguridad-de-datos.md`, sección 2) | 6.15 (cookie: es el 1); 7.4 (validación legal: es el 7); 6.8 (región, postergada por D-1); **H-15**, decisión de producto: el Registro AT/EP y la investigación de accidentes traen datos de salud sin el resguardo de los documentos de salud (el Expediente consolidado ya lo tiene, `f38fb75`). Revisar la sección 2 completa al empezar: lo demás quedó implementado o desactualizado y corregido el 8 de noviembre. |

### Sin fecha

| Qué | Detalle |
|---|---|
| Crear actividades sin red | Hoy crear una actividad exige red (`ActivityNueva` llama a la API). Quedó fuera del plan de firma sin conexión (7 de noviembre de 2026): una charla armada en terreno sin señal no se puede crear ni, por lo tanto, firmar. Los vales ya quedan atados a persona y obra, no a cada actividad, así que la firma estará lista cuando esto exista. |
| Timeout de la función de lotes de supresión | `gobernanzaLotes` tiene un timeout de 300 s, pero HTTP API corta a los 30 s: un lote grande se ejecuta, pero quien lo lanza recibe un error. Candidato a pasar a la cola (D-17, D-24). |
| Diseño móvil | Adrean lo verá aparte (lo dijo al pedir las correcciones del 11 de noviembre): no rediseñar pantallas sin que lo pida. |
| Formularios que siguen diciendo «Sin conexión» | `SurveyResponder` mantiene su nota propia al responder sin señal (la ficha de salud exige señal): es una nota del formulario, no un aviso apilado. Revisar si Adrean la quiere así. |

### Hecho

| Cuándo | Qué |
|---|---|
| 20 de noviembre de 2026 | **Alarmas con destinatario y acceso entre empresas cerrado**: backend `alertas-soporte` en dev (`70d8003`) y prod (`05a93d0`), punta a punta en dev OK. Las alarmas no le avisaban a nadie desde ~21 de septiembre (la suscripción nunca se confirmó y SNS la borró a los 3 días). H-A y H-B: ese día prod tenía 2 fichas y ningún RUT en dos empresas. La verificación pendiente de prod (grupos de logs de las 9 funciones viejas) salió vacía. |
| ~14 de noviembre de 2026 | **Paso a prod 2**: backend y frontend `5813205`, punta a punta 65 de 65 (Adrean). |
| 13 de noviembre de 2026 | Correcciones de la prueba en terreno del 11 de noviembre, en dev (`5813205`): un solo aviso sin señal, neutro, con un estado de señal único (`utils/conexion.ts`); «No disponible sin conexión» en vez de ceros o «Al día» (Inicio, Encuestas, Actividades, Mis firmas, Firma electrónica, Bandeja, Incidentes, Repositorio y la obra); sin señal no se ofrece lo que necesita conexión; «Enviando…» sin botón y «Enviar ahora» solo tras 2 minutos fallando con señal; `alcance` de encuestas por personas distintas; el globo de «Cómo se firma» sin tapar. |
| 11 de noviembre de 2026 | PIN de 4 dígitos en el manual y los recorridos (la rama `tours` mezclada en `pruebas`, `8dcaa25`). |
| 10 de noviembre de 2026 | Verificación de los despliegues con descarga reanudable (`infra/descarga.sh`). |
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
| D-40 | Las cuentas nuevas se activan en terreno con una contraseña temporal de 2 horas, o con un enlace de 72 horas; reemplaza D-13. Modificada por D-41 |
| D-41 | La contraseña inicial vuelve a los cuatro dígitos del RUT con vencimiento de 7 días, y «Reactivar acceso inicial» por ficha y por obra; riesgo aceptado |

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
- **Pruebas manuales:** las hace el equipo, siempre en dev. Daniel ya no hace QA desde el 20 de noviembre de 2026.
- En `git stash list` hay respaldos antiguos. El más reciente es el de antes de integrar `dea26fb`, del 29 de septiembre. No se descartan sin preguntar.
