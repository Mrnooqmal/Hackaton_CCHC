#!/usr/bin/env bash
# Aplica infra/frontend.yml (bucket, OAC, cabeceras, distribución) desde UN
# COMMIT PUSHEADO, y arma la CSP de cada distribución (prod y dev) con lo que el
# commit sirve.
#
#   infra/desplegar-infra-frontend.sh <commit>
#   CSP_MODO=solo-reporte infra/desplegar-infra-frontend.sh <commit>   # volver atrás
#
# Esto cambia la infraestructura, no publica el frontend: para eso está
# infra/desplegar-frontend.sh. Van separados porque la distribución tarda de 5 a
# 10 minutos en aplicar un cambio y casi nunca cambia.
#
# ── La CSP ───────────────────────────────────────────────────────────────────
# Se arma acá y no a mano porque depende de dos cosas que cambian:
#   - la URL de la API de cada ambiente (salida HttpApiUrl de BuildAndServe-prod
#     y BuildAndServe-dev), que también es la ruta de los reportes;
#   - los hashes de los scripts en línea: el de index.html (del build del commit)
#     y el que dispara la impresión en los informes (utils/informesHtml.ts), que
#     se abren como `blob:` y heredan esta política.
# Los hashes los calcula infra/hashes-csp.js, el mismo que usa
# desplegar-frontend.sh para negarse a publicar un build que la política no
# autoriza.
#
# ── Modo activo ──────────────────────────────────────────────────────────────
# Por omisión la política es ACTIVA (Content-Security-Policy): el navegador
# bloquea lo que no autoriza. Se activó después de un mes en solo reporte sin
# violaciones de la aplicación (ver docs/estado-actual.md). Las violaciones se
# siguen reportando a POST /csp/reporte. CSP_MODO=solo-reporte la devuelve a
# Content-Security-Policy-Report-Only, desde el mismo commit.
#
# Con la política activa, una política armada con otros hashes que los del
# frontend publicado lo deja en blanco. Por eso, antes de desplegar en modo
# activo, se comprueba que el index.html que sirve hoy cada distribución pase la
# política nueva, y después, que cada dominio sirva la cabecera activa.
set -euo pipefail

COMMIT="${1:?uso: infra/desplegar-infra-frontend.sh <commit>}"
CSP_MODO="${CSP_MODO:-activa}"
[[ "$CSP_MODO" == "activa" || "$CSP_MODO" == "solo-reporte" ]] || { echo "CSP_MODO inválido: $CSP_MODO (activa o solo-reporte)." >&2; exit 1; }
STACK_FRONTEND="${STACK_FRONTEND:-BuildAndServe-frontend}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

RAIZ="$(git rev-parse --show-toplevel)"
git -C "$RAIZ" fetch --quiet origin
SHA="$(git -C "$RAIZ" rev-parse --verify "$COMMIT^{commit}")"
git -C "$RAIZ" branch -r --contains "$SHA" | grep -q . || {
    echo "El commit $SHA no está en ninguna rama remota: solo se despliegan commits pusheados." >&2; exit 1; }

salida() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }
API_PROD="$(salida BuildAndServe-prod HttpApiUrl)"
API_DEV="$(salida BuildAndServe-dev HttpApiUrl)"
for v in API_PROD API_DEV; do
    [ -n "${!v}" ] && [ "${!v}" != "None" ] || { echo "Falta HttpApiUrl ($v)." >&2; exit 1; }
done

# Dominio de producción (D-21): el certificado EMITIDO de ACM que cubre la raíz
# y www. Si todavía no está emitido, la distribución sigue solo en cloudfront.net.
DOMINIO_PROD=buildandserve.cl
CERT=""
for arn in $(aws acm list-certificates --certificate-statuses ISSUED --query "CertificateSummaryList[?DomainName=='$DOMINIO_PROD'].CertificateArn" --output text); do
    if aws acm describe-certificate --certificate-arn "$arn" --query 'Certificate.SubjectAlternativeNames' --output text | tr '\t' '\n' | grep -qx "www.$DOMINIO_PROD"; then
        CERT="$arn"; break
    fi
done
if [ -n "$CERT" ]; then echo "== dominio: $DOMINIO_PROD y www con $CERT"
else echo "== AVISO: no hay certificado emitido para $DOMINIO_PROD y www; la distribución de producción queda sin dominio propio." >&2; fi

# Dónde se mira lo que sirve cada distribución. En producción, el dominio propio:
# la URL de CloudFront redirige todo a él desde D-34.
dominio_de() {
    if [ "$1" = DominioDistribucion ] && [ -n "$CERT" ]; then echo "$DOMINIO_PROD"; else salida "$STACK_FRONTEND" "$1"; fi
}

TMP="$(mktemp -d)"
trap 'git -C "$RAIZ" worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
git -C "$RAIZ" worktree add --detach --quiet "$TMP/wt" "$SHA"
cd "$TMP/wt/Frontend"
npm ci --no-audit --no-fund --silent

# Una CSP por ambiente: cada distribución autoriza solo la API de su backend, y
# los hashes salen del build hecho contra esa API.
csp_para() {
    local API_URL="$1"
    VITE_API_URL="$API_URL" npm run build --silent >/dev/null
    # Hashes de los scripts en línea: los del index.html construido y el de los informes.
    local HASHES
    HASHES="$(node "$TMP/wt/infra/hashes-csp.js" dist/index.html src/utils/informesHtml.ts)"
    [ -n "$HASHES" ] || { echo "No se encontraron scripts en línea: revisar antes de publicar una CSP." >&2; exit 1; }
    local S3='https://*.s3.amazonaws.com https://*.s3.us-east-1.amazonaws.com'
    echo "default-src 'self'; script-src 'self' $HASHES; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: $S3; media-src 'self' data: blob: $S3; connect-src 'self' $API_URL $S3 https://nominatim.openstreetmap.org; frame-src 'self' blob: $S3; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri $API_URL/csp/reporte; report-to csp"
}
CSP="$(csp_para "$API_PROD")"
CSP_DEV="$(csp_para "$API_DEV")"

for par in "prod:$CSP" "dev:$CSP_DEV"; do
    echo "== CSP ${par%%:*} ($CSP_MODO):"
    echo "${par#*:}" | tr ';' '\n' | sed 's/^ */   /'
done

# Antes de activar: el frontend que sirve HOY cada distribución tiene que pasar
# la política nueva. Puede ser de otro commit que el de esta infra.
if [ "$CSP_MODO" = activa ]; then
    for par in "DominioDistribucion:$CSP" "DominioDistribucionDev:$CSP_DEV"; do
        DOMINIO="$(dominio_de "${par%%:*}")"
        curl -fsS "https://$DOMINIO/index.html" -o "$TMP/servido.html" \
            || { echo "No se pudo leer el index.html de https://$DOMINIO." >&2; exit 1; }
        node "$TMP/wt/infra/hashes-csp.js" --verificar "${par#*:}" "$TMP/servido.html" src/utils/informesHtml.ts \
            || { echo "El frontend que sirve https://$DOMINIO no pasa la política nueva: publica antes un frontend de este commit, o despliega con CSP_MODO=solo-reporte." >&2; exit 1; }
    done
fi

aws cloudformation deploy \
    --stack-name "$STACK_FRONTEND" \
    --template-file "$TMP/wt/infra/frontend.yml" \
    --parameter-overrides "CertificadoProd=$CERT" "Csp=$CSP" "CspModo=$CSP_MODO" "ReportingEndpoints=csp=\"$API_PROD/csp/reporte\"" \
        "CspDev=$CSP_DEV" "ReportingEndpointsDev=csp=\"$API_DEV/csp/reporte\"" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset

for par in DominioDistribucion DominioDistribucionDev; do
    DOMINIO="$(dominio_de "$par")"
    echo "== cabeceras que sirve https://$DOMINIO"
    curl -sI "https://$DOMINIO/" | grep -iE 'strict-transport|x-content-type|x-frame|content-security|referrer|reporting-endpoints' || true
    # La cabecera que manda es la que llega, no la plantilla. CloudFront tarda en
    # propagar: se reintenta unos minutos.
    if [ "$CSP_MODO" = activa ]; then
        for intento in $(seq 1 20); do
            CABECERAS="$(curl -sI "https://$DOMINIO/?verificacion-csp=$intento")"
            if echo "$CABECERAS" | grep -qiE '^content-security-policy:.*script-src' \
                && ! echo "$CABECERAS" | grep -qi '^content-security-policy-report-only:'; then
                echo "== https://$DOMINIO sirve la CSP activa"; continue 2
            fi
            sleep 30
        done
        echo "https://$DOMINIO no sirve la CSP activa después de 10 minutos." >&2; exit 1
    fi
done

# D-34: la URL de CloudFront de producción redirige con 301 a la raíz del dominio,
# con la misma ruta y consulta. Se comprueba lo que llega, con reintentos mientras
# CloudFront propaga la función. Los parámetros se comparan sin importar el orden
# (infra/misma-url.js): CloudFront no lo conserva al recorrer la consulta.
if [ -n "$CERT" ]; then
    CF_PROD="$(salida "$STACK_FRONTEND" DominioDistribucion)"
    ESPERADO="https://$DOMINIO_PROD/verificacion/redireccion?a=1&b=dos"
    for intento in $(seq 1 20); do
        RESPUESTA="$(curl -sI "https://$CF_PROD/verificacion/redireccion?a=1&b=dos" | tr -d '\r')"
        LOCATION="$(echo "$RESPUESTA" | sed -n 's/^[Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]: *//p' | head -1)"
        if echo "$RESPUESTA" | head -1 | grep -q ' 301' \
            && node "$TMP/wt/infra/misma-url.js" "$ESPERADO" "$LOCATION"; then
            echo "== https://$CF_PROD redirige con 301 a https://$DOMINIO_PROD"; break
        fi
        [ "$intento" -eq 20 ] && { echo "https://$CF_PROD no redirige a https://$DOMINIO_PROD después de 10 minutos." >&2; exit 1; }
        sleep 30
    done
fi
