#!/usr/bin/env bash
# Publica el frontend de UN COMMIT PUSHEADO en CloudFront, y verifica que se
# sirva exactamente lo construido.
#
#   infra/desplegar-frontend.sh <commit> <dev|prod>
#
# Cada ambiente tiene su distribución: prod sirve a los usuarios y dev a QA. Un
# build se publica solo en la distribución de su ambiente y solo si apunta a la
# API de ese ambiente y a ninguna otra (D-20): la URL de producción no puede
# servir un build que hable con dev, ni al revés.
#
# Regla del proyecto: se despliega solo desde commits pusheados, nunca desde el
# árbol de trabajo. Por eso el script no usa el árbol: arma un worktree limpio
# del commit, instala con `npm ci` y construye ahí. La URL de la API sale del
# stack del backend (salida HttpApiUrl), no de un .env local: si falta, el build
# caería a localhost:3001 sin avisar.
#
# Requiere AWS_PROFILE con acceso a la cuenta del proyecto.
set -euo pipefail
source "$(dirname "$0")/descarga.sh"

COMMIT="${1:?uso: infra/desplegar-frontend.sh <commit> <dev|prod>}"
AMBIENTE="${2:?uso: infra/desplegar-frontend.sh <commit> <dev|prod>}"
case "$AMBIENTE" in
    prod) SUFIJO=""; OTRO=dev ;;
    dev)  SUFIJO="Dev"; OTRO=prod ;;
    *) echo "Ambiente desconocido: $AMBIENTE (dev o prod)." >&2; exit 1 ;;
esac
STACK_BACKEND="BuildAndServe-$AMBIENTE"
STACK_FRONTEND="${STACK_FRONTEND:-BuildAndServe-frontend}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

RAIZ="$(git rev-parse --show-toplevel)"
git -C "$RAIZ" fetch --quiet origin
SHA="$(git -C "$RAIZ" rev-parse --verify "$COMMIT^{commit}")"
if ! git -C "$RAIZ" branch -r --contains "$SHA" | grep -q .; then
    echo "El commit $SHA no está en ninguna rama remota: solo se despliegan commits pusheados." >&2
    exit 1
fi

salida() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }
API_URL="$(salida "$STACK_BACKEND" HttpApiUrl)"
API_OTRO="$(salida "BuildAndServe-$OTRO" HttpApiUrl)"
if [ "$AMBIENTE" = prod ]; then
    BUCKET="$(salida "$STACK_FRONTEND" Bucket)"
    DISTRIBUCION="$(salida "$STACK_FRONTEND" DistribucionId)"
    # Se verifica en el dominio propio: la URL de CloudFront de producción
    # redirige todo a https://buildandserve.cl desde D-34.
    DOMINIO=buildandserve.cl
else
    BUCKET="$(salida "$STACK_FRONTEND" BucketDev)"
    DISTRIBUCION="$(salida "$STACK_FRONTEND" DistribucionDevId)"
    DOMINIO="$(salida "$STACK_FRONTEND" DominioDistribucionDev)"
fi
for v in API_URL API_OTRO BUCKET DISTRIBUCION DOMINIO; do
    [ -n "${!v}" ] && [ "${!v}" != "None" ] || { echo "Falta $v en las salidas de los stacks." >&2; exit 1; }
done

TMP="$(mktemp -d)"
trap 'git -C "$RAIZ" worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
git -C "$RAIZ" worktree add --detach --quiet "$TMP/wt" "$SHA"
cd "$TMP/wt/Frontend"

echo "== $SHA: npm ci y build contra $API_URL"
npm ci --no-audit --no-fund --silent
VITE_API_URL="$API_URL" npm run build --silent >/dev/null

# El bundle tiene que apuntar a esta API y a ninguna otra: ni la del otro
# ambiente, ni otra API Gateway cualquiera, ni localhost.
grep -rq "$API_URL" dist || { echo "El build no contiene $API_URL." >&2; exit 1; }
if grep -rqF "$API_OTRO" dist; then
    echo "El build para $AMBIENTE contiene la API de $OTRO ($API_OTRO)." >&2; exit 1
fi
APIS="$(grep -rhoE 'https://[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com' dist | sort -u)"
if [ "$APIS" != "$API_URL" ]; then
    echo "El build apunta a APIs distintas de $API_URL:" >&2; echo "$APIS" >&2; exit 1
fi
if grep -rqE 'localhost:[0-9]+' dist; then
    echo "El build contiene una URL de localhost." >&2; exit 1
fi

# Con la CSP activa, un script en línea que la política no autoriza no corre: un
# index.html con un script nuevo, publicado sin redesplegar la infra, dejaría la
# aplicación en blanco. Se comprueba contra la política de ESTA distribución.
parametro() { aws cloudformation describe-stacks --stack-name "$STACK_FRONTEND" --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue" --output text; }
CSP_MODO="$(parametro CspModo)"
POLITICA="$(parametro "Csp$SUFIJO")"
if [ "$CSP_MODO" = activa ]; then
    node "$TMP/wt/infra/hashes-csp.js" --verificar "$POLITICA" dist/index.html src/utils/informesHtml.ts || {
        echo "La CSP activa de $AMBIENTE no autoriza los scripts en línea de este build: despliega antes la infra de este commit (infra/desplegar-infra-frontend.sh $SHA)." >&2
        exit 1; }
    echo "== los scripts en línea del build están en la CSP activa de $AMBIENTE"
elif [ -n "$POLITICA" ] && [ "$POLITICA" != "None" ] \
    && ! node "$TMP/wt/infra/hashes-csp.js" --verificar "$POLITICA" dist/index.html src/utils/informesHtml.ts 2>/dev/null; then
    echo "== AVISO: la CSP (solo reporte) de $AMBIENTE no autoriza los scripts en línea de este build: el navegador lo va a reportar." >&2
fi

# Publicar lo hace el rol de publicación (D-22), asumido recién ahora, después
# de todas las verificaciones: con MFA, y con el commit en el nombre de la
# sesión para que CloudTrail diga qué se publicó. El código MFA se pide por
# terminal o viene en MFA_CODIGO.
ROL="$(salida "$STACK_FRONTEND" RolPublicador)"
EXIGE="$(salida "$STACK_FRONTEND" ExigeRolPublicador)"
MFA="$(aws iam list-mfa-devices --query 'MFADevices[0].SerialNumber' --output text 2>/dev/null || true)"
if [ -n "$MFA" ] && [ "$MFA" != "None" ] && [ -n "$ROL" ] && [ "$ROL" != "None" ]; then
    CODIGO="${MFA_CODIGO:-}"
    [ -n "$CODIGO" ] || read -rp "Código MFA de $MFA: " CODIGO </dev/tty
    read -r AK SK ST < <(aws sts assume-role --role-arn "$ROL" --role-session-name "publicar-$AMBIENTE-${SHA:0:12}" \
        --serial-number "$MFA" --token-code "$CODIGO" --duration-seconds 3600 \
        --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)
    [ -n "${ST:-}" ] || { echo "No se pudo asumir $ROL." >&2; exit 1; }
    export AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_SESSION_TOKEN="$ST"
    unset AWS_PROFILE
    echo "== publicando como $(aws sts get-caller-identity --query Arn --output text)"
elif [ "$EXIGE" = "true" ]; then
    echo "Solo el rol de publicación puede publicar, y tu usuario no tiene MFA: registra un dispositivo MFA." >&2; exit 1
else
    echo "== AVISO: publicando con tus credenciales (sin MFA; el rol de publicación aún no se exige)." >&2
fi

echo "== subida a s3://$BUCKET e invalidación de $DISTRIBUCION"
aws s3 sync dist "s3://$BUCKET" --delete --only-show-errors
ID="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUCION" --paths '/*' --query Invalidation.Id --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUCION" --id "$ID"

echo "== verificación archivo por archivo contra https://$DOMINIO"
total=0; distintos=0
# Cada archivo se descarga con reanudación (infra/descarga.sh) y se compara con
# el del build: un corte de la conexión ya no deja la publicación sin verificar.
mkdir -p "$TMP/publicado"
while IFS= read -r f; do
    total=$((total + 1))
    rm -f "$TMP/publicado/archivo"
    if ! descargar_reanudable "$TMP/publicado/archivo" "$(stat -c %s "dist/$f")" echo "https://$DOMINIO/$f" \
        || ! cmp -s "$TMP/publicado/archivo" "dist/$f"; then
        distintos=$((distintos + 1)); echo "DISTINTO: $f"
    fi
done < <(cd dist && find . -type f | sed 's|^\./||')
echo "archivos: $total, distintos: $distintos"
[ "$distintos" -eq 0 ] || exit 1
echo "Publicado $SHA ($AMBIENTE) en https://$DOMINIO"
