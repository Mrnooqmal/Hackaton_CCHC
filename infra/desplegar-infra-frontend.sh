#!/usr/bin/env bash
# Aplica infra/frontend.yml (bucket, OAC, cabeceras, distribución) desde UN
# COMMIT PUSHEADO, y arma la CSP en modo solo reporte con lo que el commit sirve.
#
#   infra/desplegar-infra-frontend.sh <commit>
#
# Esto cambia la infraestructura, no publica el frontend: para eso está
# infra/desplegar-frontend.sh. Van separados porque la distribución tarda de 5 a
# 10 minutos en aplicar un cambio y casi nunca cambia.
#
# ── La CSP ───────────────────────────────────────────────────────────────────
# Se arma acá y no a mano porque depende de dos cosas que cambian:
#   - la URL de la API (salida HttpApiUrl del stack del backend), que también es
#     la ruta de los reportes;
#   - los hashes de los scripts en línea: el de index.html (del build del commit)
#     y el que dispara la impresión en los informes (utils/informesHtml.ts), que
#     se abren como `blob:` y heredan esta política.
# Se envía como Content-Security-Policy-Report-Only: el navegador no bloquea
# nada, solo reporta a POST /csp/reporte. Pasarla a activa es cambiar el nombre
# de la cabecera, cuando pasen unos días sin violaciones legítimas.
set -euo pipefail

COMMIT="${1:?uso: infra/desplegar-infra-frontend.sh <commit>}"
STACK_BACKEND="${STACK_BACKEND:-BuildAndServe-prod}"
STACK_FRONTEND="${STACK_FRONTEND:-BuildAndServe-frontend}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

RAIZ="$(git rev-parse --show-toplevel)"
git -C "$RAIZ" fetch --quiet origin
SHA="$(git -C "$RAIZ" rev-parse --verify "$COMMIT^{commit}")"
git -C "$RAIZ" branch -r --contains "$SHA" | grep -q . || {
    echo "El commit $SHA no está en ninguna rama remota: solo se despliegan commits pusheados." >&2; exit 1; }

API_URL="$(aws cloudformation describe-stacks --stack-name "$STACK_BACKEND" --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text)"
[ -n "$API_URL" ] && [ "$API_URL" != "None" ] || { echo "Falta HttpApiUrl en $STACK_BACKEND." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'git -C "$RAIZ" worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
git -C "$RAIZ" worktree add --detach --quiet "$TMP/wt" "$SHA"
cd "$TMP/wt/Frontend"
npm ci --no-audit --no-fund --silent
VITE_API_URL="$API_URL" npm run build --silent >/dev/null

# Hashes de los scripts en línea: los del index.html construido y el de los informes.
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

S3='https://*.s3.amazonaws.com https://*.s3.us-east-1.amazonaws.com'
REPORTE="$API_URL/csp/reporte"
CSP="default-src 'self'; script-src 'self' $HASHES; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: $S3; media-src 'self' data: blob: $S3; connect-src 'self' $API_URL $S3 https://nominatim.openstreetmap.org; frame-src 'self' blob: $S3; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri $REPORTE; report-to csp"

echo "== CSP (solo reporte):"
echo "$CSP" | tr ';' '\n' | sed 's/^ */   /'

aws cloudformation deploy \
    --stack-name "$STACK_FRONTEND" \
    --template-file "$TMP/wt/infra/frontend.yml" \
    --parameter-overrides "CspSoloReporte=$CSP" "ReportingEndpoints=csp=\"$REPORTE\"" \
    --no-fail-on-empty-changeset

DOMINIO="$(aws cloudformation describe-stacks --stack-name "$STACK_FRONTEND" --query "Stacks[0].Outputs[?OutputKey=='DominioDistribucion'].OutputValue" --output text)"
echo "== cabeceras que sirve https://$DOMINIO"
curl -sI "https://$DOMINIO/" | grep -iE 'strict-transport|x-content-type|x-frame|content-security|referrer|reporting-endpoints'
