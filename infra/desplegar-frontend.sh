#!/usr/bin/env bash
# Publica el frontend de UN COMMIT PUSHEADO en CloudFront, y verifica que se
# sirva exactamente lo construido.
#
#   infra/desplegar-frontend.sh <commit>
#
# Regla del proyecto: se despliega solo desde commits pusheados, nunca desde el
# árbol de trabajo. Por eso el script no usa el árbol: arma un worktree limpio
# del commit, instala con `npm ci` y construye ahí. La URL de la API sale del
# stack del backend (salida HttpApiUrl), no de un .env local: si falta, el build
# caería a localhost:3001 sin avisar.
#
# Requiere AWS_PROFILE con acceso a la cuenta del proyecto.
set -euo pipefail

COMMIT="${1:?uso: infra/desplegar-frontend.sh <commit>}"
STACK_BACKEND="${STACK_BACKEND:-BuildAndServe-prod}"
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
BUCKET="$(salida "$STACK_FRONTEND" Bucket)"
DISTRIBUCION="$(salida "$STACK_FRONTEND" DistribucionId)"
DOMINIO="$(salida "$STACK_FRONTEND" DominioDistribucion)"
for v in API_URL BUCKET DISTRIBUCION DOMINIO; do
    [ -n "${!v}" ] && [ "${!v}" != "None" ] || { echo "Falta $v en las salidas de los stacks." >&2; exit 1; }
done

TMP="$(mktemp -d)"
trap 'git -C "$RAIZ" worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
git -C "$RAIZ" worktree add --detach --quiet "$TMP/wt" "$SHA"
cd "$TMP/wt/Frontend"

echo "== $SHA: npm ci y build contra $API_URL"
npm ci --no-audit --no-fund --silent
VITE_API_URL="$API_URL" npm run build --silent >/dev/null

# El bundle tiene que apuntar a esta API y a ninguna otra.
grep -rq "$API_URL" dist || { echo "El build no contiene $API_URL." >&2; exit 1; }
if grep -rqE 'localhost:3001|n2waslgjca' dist && [ "$STACK_BACKEND" = "BuildAndServe-prod" ]; then
    echo "El build de producción contiene una URL de dev o de localhost." >&2; exit 1
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
echo "Publicado $SHA en https://$DOMINIO"
