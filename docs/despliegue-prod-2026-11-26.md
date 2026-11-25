# Paso a prod del jueves 26 de noviembre de 2026

Prod corre hoy `05a93d0` (de `alertas-soporte`; `origin/main` está en ese commit). El jueves pasa a prod el commit de `pruebas` que se probó en dev el miércoles 25. Lo ejecuta Adrean, con `AWS_PROFILE=adrean_cchc`. Toma unas dos horas; conviene partir temprano, y nunca el 2 ni el 3 de diciembre (día hábil anterior a la visita y la visita).

En todo el documento, `H` es ese commit. Si algo no calza con lo esperado, se detiene y se decide antes de seguir.

## Qué cambia en prod

- Activación con los cuatro dígitos y vencimiento de 7 días, y «Reactivar acceso inicial» (D-41). Necesita la migración del paso 4.
- La API pasa a `https://api.buildandserve.cl` (dominio propio, certificado ya emitido). Necesita el CNAME del paso 5 antes de publicar el frontend.
- Lo que `pruebas` tenía y prod no: firmas y visor de documentos rediseñados, dictado por voz en incidentes (crea el bucket `buildandserve-dictados-prod`), auditoría de lecturas (D-39), validación del RUT de empresa en el alta, consentimiento de imagen, sin teléfono de la persona (paso 10), el 503 al copiar contraseñas entre empresas y la paginación del Scan.
- Ocultos: el panorama de la empresa, y la lectura en voz salvo que se acepte el miércoles.

## Miércoles 25: antes de dar el visto bueno

1. **Todo lo que va a prod está mezclado en `pruebas` y desplegado en dev**, y el equipo lo probó ahí (casos de activación, firma, firma sin señal y visor). Anota el commit:
   ```bash
   cd ~/repos/Hackaton_CCHC && git switch pruebas && git pull
   git rev-parse HEAD          # este es H, si es el que se desplegó en dev
   ```
   `desplegar-backend.sh` y `desplegar-frontend.sh` de dev imprimen el commit que desplegaron: tiene que ser este.
2. **La prueba de punta a punta de dev pasó completa** con `H`:
   ```bash
   cd ~/repos/Hackaton_CCHC/Backend && AWS_PROFILE=adrean_cchc node scripts/prueba-punta-a-punta.js --stage dev
   ```
3. **Comprobaciones de solo lectura en prod.** Cada una tiene que dar lo indicado:
   ```bash
   export AWS_PROFILE=adrean_cchc AWS_REGION=us-east-1
   aws cloudformation describe-stacks --stack-name BuildAndServe-prod --query 'Stacks[0].StackStatus' --output text
   #   UPDATE_COMPLETE (o CREATE_COMPLETE)
   aws sns get-topic-attributes --topic-arn "$(aws cloudformation describe-stack-resource --stack-name BuildAndServe-prod --logical-resource-id AlertasOperacionTopic --query StackResourceDetail.PhysicalResourceId --output text)" --query 'Attributes.SubscriptionsConfirmed' --output text
   #   1 (si es 0, las alarmas de prod no le llegan a nadie: volver a suscribir antes del jueves)
   aws s3api head-bucket --bucket buildandserve-dictados-prod
   #   error 404 (Not Found): el bucket no existe y el despliegue lo puede crear
   aws acm list-certificates --certificate-statuses ISSUED --query 'CertificateSummaryList[].CertificateArn' --output text | tr '\t' '\n' | while read a; do aws acm describe-certificate --certificate-arn "$a" --query 'Certificate.SubjectAlternativeNames' --output text | tr '\t' '\n' | grep -qx api.buildandserve.cl && echo "$a"; done
   #   un ARN (el certificado que cubre api.buildandserve.cl)
   ```

## Jueves 26

### 1. Avanzar `main` al commit probado

Desde `~/repos/Hackaton_CCHC`:
```bash
git fetch origin
H=<commit del miércoles>
git merge-base --is-ancestor "$H" origin/pruebas && echo "está en pruebas"
git push origin "$H:main"
git fetch origin && test "$(git rev-parse origin/main)" = "$H" && echo "main = H"
```
**Verificar:** el push entra sin `--force`. Si GitHub lo rechaza, `main` tiene algo que `pruebas` no tiene: se detiene.

### 2. Preparar las dos carpetas

```bash
cd ~/repos/Hackaton_CCHC
git worktree add --detach ~/repos/despliegue-prod "$H"
git worktree add --detach ~/repos/vuelta-atras-prod 05a93d0
cd ~/repos/despliegue-prod/Backend && npm ci
```
Los scripts de despliegue se niegan a correr si no son los del commit que despliegan: los de `H` se corren desde `~/repos/despliegue-prod`, y los de la vuelta atrás desde `~/repos/vuelta-atras-prod`.

### 3. Backend

Desde `~/repos/despliegue-prod`:
```bash
export AWS_PROFILE=adrean_cchc AWS_REGION=us-east-1
infra/desplegar-backend.sh "$H" prod
```
**Verificar en la salida:**
- `== dominio de la API: api.buildandserve.cl con arn:aws:acm:…` al principio.
- La suite completa pasa (el script no despliega si falla una).
- El conteo de recursos queda bajo 500 (dev estaba en 466).
- `Desplegado <H> en prod (todas las funciones con el mismo paquete).`
- `== alarmas: 1 suscripción(es) confirmada(s)` (si entró la rama `feat/vigilar-suscriptores-alarmas`; si dice que no hay suscripciones, el backend ya quedó desplegado: se vuelve a suscribir la casilla y se sigue).
- `== Cloudflare: CNAME api -> d-….execute-api.us-east-1.amazonaws.com`: anota el destino.

**Si falla a mitad:** CloudFormation revierte solo y prod sigue en `05a93d0`; el frontend no se tocó. Revisa `aws cloudformation describe-stacks --stack-name BuildAndServe-prod` y los cuidados de `docs/estado-actual.md` (sección de despliegue) antes de reintentar.

### 4. Migración de la contraseña inicial (inmediatamente)

Hasta que corre, quien todavía no entra con los cuatro dígitos (fichas de D-13) no puede entrar. Desde `~/repos/despliegue-prod/Backend`:
```bash
node scripts/migrar-acceso-inicial.js --stage prod            # cuenta
node scripts/migrar-acceso-inicial.js --stage prod --aplicar
node scripts/migrar-acceso-inicial.js --stage prod            # tiene que decir «Por migrar: 0»
```
**Verificar:** las migradas coinciden con lo que contó la simulación, salvo las omitidas que el script detalla. Cada persona migrada recibe un aviso en su bandeja.

### 5. CNAME de la API en Cloudflare

Crea `api` → el destino del paso 3, **solo DNS (nube gris)**, como `dev` y `api-dev`.

**Verificar** (desde `~/repos/despliegue-prod`):
```bash
dig +short api.buildandserve.cl
#   el destino d-….execute-api.us-east-1.amazonaws.com y sus IP
curl -si -X OPTIONS https://api.buildandserve.cl/auth/login -H 'Origin: https://buildandserve.cl' -H 'Access-Control-Request-Method: POST' | grep -i '^access-control-allow-origin'
#   access-control-allow-origin: https://buildandserve.cl
curl -si -X OPTIONS https://api.buildandserve.cl/auth/login -H 'Origin: https://otro.ejemplo' -H 'Access-Control-Request-Method: POST' | grep -ci '^access-control-allow-origin'
#   0
```
No sigas al paso 6 hasta que las tres respondan así: el frontend nuevo llama a este dominio.

### 6. Infraestructura del frontend (CSP con la API nueva)

Desde `~/repos/despliegue-prod`:
```bash
infra/desplegar-infra-frontend.sh "$H"
```
**Verificar:**
- La CSP de prod que imprime incluye en `connect-src` tanto la URL `execute-api` de prod como `https://api.buildandserve.cl` (el frontend actual sigue funcionando y el nuevo también).
- Pasa la comprobación del `index.html` servido (los hashes de `05a93d0` y de `pruebas` son iguales).
- `== https://buildandserve.cl sirve la CSP activa` y lo mismo para `dev.buildandserve.cl`.
- La redirección 301 de la URL de CloudFront de prod.

### 7. Frontend

Desde `~/repos/despliegue-prod`:
```bash
infra/desplegar-frontend.sh "$H" prod
```
**Verificar:** `== <H>: npm ci y build contra https://api.buildandserve.cl` y la línea `Publicado …` al final. Sin esa línea, no se publicó.

### 8. Humo a mano (5 minutos), en `https://buildandserve.cl`

- Entrar con una cuenta real de administrador; sin errores de CSP en la consola del navegador.
- Personas → Activar accesos: carga, y con una obra elegida aparece «Reactivar acceso inicial».
- Mis firmas y el visor de un documento abren.
- En el teléfono: la app instalada se actualiza al abrirla (puede pedir recargar una vez).

### 9. Prueba de punta a punta en prod

Desde `~/repos/despliegue-prod/Backend`:
```bash
node scripts/prueba-punta-a-punta.js --stage prod
```
**Verificar:** todas las comprobaciones pasan y termina con el borrado de la empresa desechable confirmado (código de salida 0). Si deja una empresa a medias, `--borrar <tenantId>` la limpia.

### 10. Quitar el teléfono de las fichas (al final del día)

Es irreversible: se corre solo cuando ya está decidido que no hay vuelta atrás. Desde `~/repos/despliegue-prod/Backend`:
```bash
node scripts/quitar-telefono.js --stage prod            # cuenta
node scripts/quitar-telefono.js --stage prod --aplicar
```

### 11. Cierre

```bash
cd ~/repos/Hackaton_CCHC
git tag prod-2026-11-26 "$H" && git push origin prod-2026-11-26
git worktree remove ~/repos/despliegue-prod
```
- `docs/estado-actual.md`: prod en `H`, con los resultados de la prueba de punta a punta y el conteo de recursos (por pull request).
- Avisar al equipo: prod salió de `main`; `alertas-soporte` queda cerrada (no se borra todavía).
- La carpeta `~/repos/vuelta-atras-prod` se borra pasada una semana sin problemas.

## Cómo volver atrás

**Cuándo:** si en prod no se puede entrar, firmar o sincronizar firmas sin señal, o la prueba de punta a punta falla en algo de eso, y no hay un arreglo claro en una hora. Para lo demás se arregla hacia adelante (rama, pull request, dev y `main`).

**En este orden**, desde `~/repos/vuelta-atras-prod` (los scripts de `05a93d0`):

1. **Frontend primero:**
   ```bash
   infra/desplegar-frontend.sh 05a93d0 prod
   ```
   El frontend de `05a93d0` se construye contra la URL `execute-api` de prod, que sigue funcionando, y la CSP nueva la permite: no hay que tocar la infraestructura del frontend.
2. **Backend después:**
   ```bash
   infra/desplegar-backend.sh 05a93d0 prod
   ```
   - Borra el dominio `api.buildandserve.cl` del API: quita después el CNAME `api` de Cloudflare.
   - Borra el bucket de dictados; si tiene audios, el borrado falla y el bucket queda huérfano (como pasó en dev el 22 de noviembre). El stack igual queda `UPDATE_COMPLETE`, y el bucket se vacía solo en un día. Antes de volver a desplegar `H`, hay que vaciarlo y borrarlo.
3. **Los datos:**
   - La migración de la contraseña inicial no se deshace y no hace falta: `05a93d0` deja entrar con los cuatro dígitos sin mirar el vencimiento (D-13).
   - El teléfono (paso 10) no se puede recuperar: por eso va al final.
4. `main` se queda en `H`. Lo que corre en prod se anota en `docs/estado-actual.md`, y el arreglo sigue el camino normal antes de volver a intentar.

**Si solo falla un paso intermedio:**
- Paso 4: la migración es idempotente; se vuelve a correr.
- Paso 5 (DNS): no publiques el frontend. El backend nuevo funciona con el frontend actual mientras tanto.
- Paso 6: el frontend actual no depende de esta CSP; se puede reintentar, o seguir con `CSP_MODO=solo-reporte` y revisarlo después.
- Paso 7: repetir la publicación; si no se puede, volver atrás el frontend como en el paso 1 de arriba.
