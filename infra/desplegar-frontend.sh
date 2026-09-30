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
    DOMINIO="$(salida "$STACK_FRONTEND" DominioDistribucion)"
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

echo "== subida a s3://$BUCKET e invalidación de $DISTRIBUCION"
aws s3 sync dist "s3://$BUCKET" --delete --only-show-errors
ID="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUCION" --paths '/*' --query Invalidation.Id --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUCION" --id "$ID"

echo "== verificación archivo por archivo contra https://$DOMINIO"
total=0; distintos=0
while IFS= read -r f; do
    total=$((total + 1))
    if ! curl -fsS "https://$DOMINIO/$f" | cmp -s - "dist/$f"; then
        distintos=$((distintos + 1)); echo "DISTINTO: $f"
    fi
done < <(cd dist && find . -type f | sed 's|^\./||')
echo "archivos: $total, distintos: $distintos"
[ "$distintos" -eq 0 ] || exit 1
echo "Publicado $SHA ($AMBIENTE) en https://$DOMINIO"
