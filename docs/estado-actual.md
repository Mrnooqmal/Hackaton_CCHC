# Estado actual de Build & Serve

**Actualizado: 30 de septiembre de 2026.** Este documento sirve para retomar el trabajo sin leer conversaciones anteriores. Si algo de lo que dice aquí no coincide con lo que ves en AWS o en git, gana lo que ves. Si lo compruebas, actualiza este documento.

El producto está en producción con datos reales. Ante la duda, prioriza la solidez.

---

## 1. Qué está desplegado

Todo vive en la cuenta AWS `772706200162`, región `us-east-1`. El perfil local es `adrean_cchc`; el perfil por defecto apunta a otra cuenta. La rama de trabajo es `pruebas`.

| Ambiente | Pieza | Dónde | Commit |
|---|---|---|---|
| **Prod** | Backend | Stack `BuildAndServe-prod`, API `https://92flgz68r1.execute-api.us-east-1.amazonaws.com` | `88e5944` |
| **Prod** | Frontend | **https://buildandserve.cl** (`www` redirige a la raíz con 301). Distribución `E265RJ7EAYTXAX` (`d30jksx91fodea.cloudfront.net`, que se mantiene durante la transición), bucket `buildandserve-frontend` | `88e5944` |
| **Dev** | Backend | Stack `BuildAndServe-dev`, API `https://n2waslgjca.execute-api.us-east-1.amazonaws.com` | `88e5944` |
| **Dev** | Frontend | **https://d3pve67iu4s0dd.cloudfront.net** (la URL de QA). Distribución `E2XMHI7KDD48MR`, bucket `buildandserve-frontend-dev` | `88e5944` |
| Ambos | Infra del frontend | Stack `BuildAndServe-frontend`: dos distribuciones, certificado, cabeceras, CSP y rol de publicación | `64adc40` |

**Estado de cada pieza:**

- **Dominio:** certificado de ACM para `buildandserve.cl` y `www`, validado por DNS en Cloudflare con la nube gris (sin proxy). El TLS mínimo en el dominio es 1.2. La URL de `cloudfront.net` sigue aceptando TLS 1.0 mientras dure la transición.
- **CSP:** en **modo solo reporte** en las dos distribuciones. En prod no registra violaciones desde la publicación del 30 de septiembre, a las 02:34 UTC. Los reportes llegan a `POST /csp/reporte` (métrica `CspViolaciones` en CloudWatch).
- **Correo:** sale de `no-responder@buildandserve.cl` y las respuestas van a `contacto@buildandserve.cl` (reenvío de Cloudflare). Hay un configuration set por ambiente con rebotes y quejas enviados a SNS. **SES sigue en sandbox** (ver pendientes).
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
- **Las pruebas de punta a punta no están en el repo.** Se escribieron como scripts de sesión y se pierden al reiniciar. Hacen esto:
  1. Dan de alta una empresa desechable con `scripts/crear-empresa.js`, con correo a `atorres@thecodecookers.cl`, que está verificado en SES.
  2. Entran con la contraseña inicial y la cambian.
  3. Ejercitan el flujo por la API, con el `Origin` del frontend del ambiente.
  4. Borran todo lo de la empresa en todas las tablas del ambiente y en los dos buckets, y vuelven a escanear para confirmar que no queda nada.
  Conviene versionarlas en `Backend/scripts/` (pendiente de decidir).

`docs/DEPLOY.md` está **obsoleto**: describe un esquema anterior de dos servicios. No lo sigas.

---

## 4. Pendientes

| Cuándo | Qué | Detalle |
|---|---|---|
| **Lunes 5 de octubre de 2026** | Quitar la URL de CloudFront del CORS de prod | Antes, revisar en los logs que no llegue tráfico con `Origin: https://d30jksx91fodea.cloudfront.net`. Si no llega, quitarla de `custom.corsOrigins.prod` en `Backend/serverless.yml` y desplegar prod. Actualizar D-21. |
| **Lunes 5 de octubre de 2026** | CSP a modo activo | Solo si la métrica `CspViolaciones` de prod sigue en cero. El cambio va en `infra/frontend.yml` e `infra/desplegar-infra-frontend.sh`, y consiste en que la cabecera pase de `Content-Security-Policy-Report-Only` a `Content-Security-Policy` en las dos distribuciones. Se despliega con `desplegar-infra-frontend.sh` desde un commit pusheado. Si aparecen violaciones legítimas, se corrigen antes. |
| **Cuando Adrean y Benjamin registren MFA** | Exigir el rol de publicación | Desplegar la infra del frontend con `ExigirRolPublicador=true`: los buckets pasan a aceptar escrituras solo del rol y se niega invalidar a las personas. Hoy nadie tiene MFA, y activarlo antes dejaría a nadie en condiciones de publicar (D-22). La siguiente etapa, GitHub Actions por OIDC, queda para después. |
| **Urgente** | **SES: la salida del sandbox figura DENEGADA** | Al 30 de septiembre, `aws sesv2 get-account` responde `ReviewDetails.Status = DENIED`, caso `179073624400729`, con tipo de correo `TRANSACTIONAL`, sitio `https://buildandserve.cl` y la descripción de uso **vacía**. Hay que revisar el caso en el Support Center y volver a pedirlo con la descripción completa: correos transaccionales, rebotes y quejas por SNS y supresión automática. Mientras siga en sandbox, prod solo envía correos a direcciones verificadas: los de bienvenida y restablecimiento no le llegan a nadie más. |
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

### Hallazgos (sección 4)

H-1 a H-15. Están abiertos **H-15**, que espera una decisión de producto, y lo que el checklist marca como pendiente o parcial.

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
