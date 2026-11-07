# Estado actual de Build & Serve

**Actualizado: 6 de noviembre de 2026.** Este documento sirve para retomar el trabajo sin leer conversaciones anteriores. Si algo de lo que dice aquí no coincide con lo que ves en AWS o en git, gana lo que ves. Si lo compruebas, actualiza este documento.

El producto está en producción con datos reales. Ante la duda, prioriza la solidez.

---

## 1. Qué está desplegado

Todo vive en la cuenta AWS `772706200162`, región `us-east-1`. El perfil local es `adrean_cchc`; el perfil por defecto apunta a otra cuenta. La rama de trabajo es `pruebas`.

| Ambiente | Pieza | Dónde | Commit |
|---|---|---|---|
| **Prod** | Backend | Stack `BuildAndServe-prod`, API `https://92flgz68r1.execute-api.us-east-1.amazonaws.com` | `d750646` |
| **Prod** | Frontend | **https://buildandserve.cl** (`www` redirige a la raíz con 301). Distribución `E265RJ7EAYTXAX` (`d30jksx91fodea.cloudfront.net`, que se mantiene durante la transición), bucket `buildandserve-frontend` | `d750646` |
| **Dev** | Backend | Stack `BuildAndServe-dev`, API `https://n2waslgjca.execute-api.us-east-1.amazonaws.com` | `55a6605` |
| **Dev** | Frontend | **https://d3pve67iu4s0dd.cloudfront.net** (la URL de QA). Distribución `E2XMHI7KDD48MR`, bucket `buildandserve-frontend-dev` | `55a6605` |
| Ambos | Infra del frontend | Stack `BuildAndServe-frontend`: dos distribuciones, certificado, cabeceras, CSP y rol de publicación | `4b2db9e` |

**Dev: `55a6605` desde el 7 de noviembre de 2026**, backend y frontend con los scripts, y prueba de punta a punta 28 de 28 (incluye H-16, H-17, Actividades 4 y 5, resguardo del Expediente y D-34). Prod sigue en `d750646`.

**Cómo se verificó lo anterior (30 de octubre y 6 de noviembre de 2026).** Los scripts no dejan el commit escrito en AWS. El backend se identificó comparando el código del paquete de `personasModule` (`aws lambda get-function`) con el árbol `Backend/` de cada commit: prod coincide con `d750646` (paquete del 1 de octubre); dev, con `b7c3e88` (paquete del 15 de octubre a las 17:07, `UpdateStack` de Benjamin; `93b9a00` tiene el mismo código). El frontend, por la fecha de `index.html` en el bucket y por textos que solo existen desde ciertos commits: prod no tiene los de D-27 ni del footer nuevo; dev tiene los de `6aa53d1` y no los de `b3cb99c` (publicado por Benjamin el 23 de octubre, invalidación a las 10:33, 97 segundos después del commit: a confirmar que fue con el script).

**Estado de cada pieza:**

- **Dominio:** certificado de ACM para `buildandserve.cl` y `www`, validado por DNS en Cloudflare con la nube gris (sin proxy). El TLS mínimo en el dominio es 1.2. La URL de `cloudfront.net` de prod sigue respondiendo hasta que se despliegue D-34, que la redirige con 301 a `https://buildandserve.cl`.
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
- **Si una publicación del frontend termina sin la línea `Publicado …`, no se publicó.** Compruébalo mirando la fecha de `index.html` en el bucket, y repite la publicación.
- **Prueba de punta a punta:** `Backend/scripts/prueba-punta-a-punta.js`, desde `Backend/`:
  ```bash
  AWS_PROFILE=adrean_cchc node scripts/prueba-punta-a-punta.js --stage dev|prod
  ```
  Da de alta una empresa desechable con `crear-empresa.js`, con correos a `atorres@thecodecookers.cl`, verificado en SES. Recorre por la API, con el `Origin` del frontend del ambiente, el primer ingreso del administrador y el de una persona trabajadora: contraseña inicial, cambio, sesión nueva, PIN y enrolamiento enseguida. Comprueba además permisos, CORS, `no-store` y cierre de sesión. Al final borra todo lo de la empresa, pase lo que pase: busca por identificador en todas las tablas del ambiente y en los dos buckets, y termina bien solo si un recorrido completo da cero. Sale con código 0 solo si todo pasó **y** el borrado quedó confirmado. Una empresa que no se alcanzó a borrar queda anotada, y la próxima ejecución la borra primero. También borra toda empresa desechable con más de una hora. Para borrar una a mano: `--borrar <tenantId>` (solo acepta desechables).

`docs/DEPLOY.md` está **obsoleto**: describe un esquema anterior de dos servicios. No lo sigas.

---

## 4. Pendientes

| Cuándo | Qué | Detalle |
|---|---|---|
| **Próximo despliegue** | Lo que no está en prod | Verificado el 6 de noviembre de 2026: H-16 y H-17 no están desplegados en ningún ambiente; tampoco la Actividad 5 (`57c5a9b`, D-29 a D-32). D-27 y la pantalla nueva de contraseña (`d2cecfd`) están en dev y no en prod. Prod sigue en `d750646`. |
| **Próximo despliegue (backend prod e infra del frontend)** | D-34: quitar la URL de CloudFront de prod | **Preparado en el árbol, sin desplegar.** Decidido el 6 de noviembre de 2026 sin medir el tráfico: en prod solo existen las dos empresas del equipo y no hay clientes, así que se corta antes de la marcha blanca. `corsOrigins.prod` queda solo con `https://buildandserve.cl` (es también el CORS de los buckets de prod), y la función de CloudFront que ya redirigía `www` redirige también `d30jksx91fodea.cloudfront.net` con 301, con la misma ruta y consulta (no agrega recursos al stack). Orden: primero `desplegar-infra-frontend.sh` (redirección; al final comprueba el 301), después el backend (CORS). **El backend de prod no lleva solo el CORS:** prod está en `d750646`, así que desplegarlo arrastra todo lo pendiente (H-16, H-17, Actividades 4 y 5). Va primero en dev con su prueba de punta a punta, y backend con frontend juntos (reglas 3 y 4), y la prueba de punta a punta en prod, que ahora comprueba que la API rechaza ese origen. **Service worker:** quien instaló la app desde `d30jksx91fodea.cloudfront.net` la sigue abriendo desde caché en ese origen (la navegación la responde el service worker sin pasar por la red), y el service worker no se actualiza porque su `sw.js` responde 301. Esa copia ya no puede hablar con la API. Solución: borrar los datos del sitio de ese origen y reinstalar desde `https://buildandserve.cl`. Hoy solo afecta al equipo. |
| Hecho el 6 de noviembre de 2026 | CSP a modo activo | Desplegada y probada en dev y prod (ver sección 1). |
| **Cuando Adrean y Benjamin registren MFA** | Exigir el rol de publicación | Desplegar la infra del frontend con `ExigirRolPublicador=true`: los buckets pasan a aceptar escrituras solo del rol y se niega invalidar a las personas. Hoy nadie tiene MFA, y activarlo antes dejaría a nadie en condiciones de publicar (D-22). La siguiente etapa, GitHub Actions por OIDC, queda para después. |
| Sin fecha | Timeout de la función de lotes de supresión | `gobernanzaLotes` tiene un timeout de 300 s, pero HTTP API corta a los 30 s: un lote grande se ejecuta, pero quien lo lanza recibe un error. Candidato a pasar a la cola (D-17, D-24). |
| Sin fecha | H-15, decisión de producto | El Registro AT/EP y la investigación de accidentes traen datos de salud sin el resguardo de los documentos de salud. |
| Sin fecha | Protocolo de notificación de brechas (checklist 7.4) | Ya existe con qué responder qué se expuso (D-19). Falta decidir quién notifica, en qué plazos y por qué canal: decisión legal. |

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
