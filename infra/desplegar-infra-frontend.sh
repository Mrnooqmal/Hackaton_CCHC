#!/usr/bin/env bash
# Aplica infra/frontend.yml (bucket, OAC, cabeceras, distribución) desde UN
# COMMIT PUSHEADO, y arma la CSP en modo solo reporte de cada distribución (prod
# y dev) con lo que el commit sirve.
#
#   infra/desplegar-infra-frontend.sh <commit>
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
# Se envía como Content-Security-Policy-Report-Only: el navegador no bloquea
# nada, solo reporta a POST /csp/reporte. Pasarla a activa es cambiar el nombre
# de la cabecera, cuando pasen unos días sin violaciones legítimas.
set -euo pipefail

COMMIT="${1:?uso: infra/desplegar-infra-frontend.sh <commit>}"
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
    HASHES="$(python3 - <<'PY'
import re, hashlib, base64
def h(x): return "'sha256-" + base64.b64encode(hashlib.sha256(x.encode()).digest()).decode() + "'"
idx = open('dist/index.html', encoding='utf-8').read()
en_linea = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', idx, re.S)
informes = open('src/utils/informesHtml.ts', encoding='utf-8').read()
en_linea += re.findall(r'<script>(.*?)</script>', informes)
print(' '.join(sorted({h(x) for x in en_linea})))
PY
)"
    [ -n "$HASHES" ] || { echo "No se encontraron scripts en línea: revisar antes de publicar una CSP." >&2; exit 1; }
    local S3='https://*.s3.amazonaws.com https://*.s3.us-east-1.amazonaws.com'
    echo "default-src 'self'; script-src 'self' $HASHES; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: $S3; media-src 'self' data: blob: $S3; connect-src 'self' $API_URL $S3 https://nominatim.openstreetmap.org; frame-src 'self' blob: $S3; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri $API_URL/csp/reporte; report-to csp"
}
CSP="$(csp_para "$API_PROD")"
CSP_DEV="$(csp_para "$API_DEV")"

for par in "prod:$CSP" "dev:$CSP_DEV"; do
    echo "== CSP ${par%%:*} (solo reporte):"
    echo "${par#*:}" | tr ';' '\n' | sed 's/^ */   /'
done

aws cloudformation deploy \
    --stack-name "$STACK_FRONTEND" \
    --template-file "$TMP/wt/infra/frontend.yml" \
    --parameter-overrides "CertificadoProd=$CERT" "CspSoloReporte=$CSP" "ReportingEndpoints=csp=\"$API_PROD/csp/reporte\"" \
        "CspSoloReporteDev=$CSP_DEV" "ReportingEndpointsDev=csp=\"$API_DEV/csp/reporte\"" \
    --no-fail-on-empty-changeset

for par in DominioDistribucion DominioDistribucionDev; do
    DOMINIO="$(salida "$STACK_FRONTEND" "$par")"
    echo "== cabeceras que sirve https://$DOMINIO"
    curl -sI "https://$DOMINIO/" | grep -iE 'strict-transport|x-content-type|x-frame|content-security|referrer|reporting-endpoints' || true
done
