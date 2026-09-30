#!/usr/bin/env bash
# Despliega el backend de UN COMMIT PUSHEADO a un ambiente, solo si pasan TODAS
# las pruebas, y verifica que la Lambda corra exactamente ese commit.
#
#   infra/desplegar-backend.sh <commit> <dev|prod>
#
# Reglas del proyecto que este script hace cumplir, en vez de confiar en que
# alguien se acuerde:
#   - solo commits pusheados, nunca el árbol de trabajo: arma un worktree limpio;
#   - las pruebas completas corren en ese worktree, con las dependencias del
#     frontend instaladas (varias pruebas de seguridad cargan código del
#     frontend y se niegan a saltarse sin él). Si falla una, no se despliega.
#     El 28 de septiembre de 2026 se desplegó a dev con 3 pruebas fallando
#     porque el comando siguió de largo: esto existe para que no se repita;
#   - después del deploy, compara archivo por archivo el paquete de la Lambda
#     contra el commit, y exige que todas las funciones compartan ese paquete.
#
# Requiere AWS_PROFILE con acceso a la cuenta del proyecto.
set -euo pipefail

COMMIT="${1:?uso: infra/desplegar-backend.sh <commit> <dev|prod>}"
STAGE="${2:?uso: infra/desplegar-backend.sh <commit> <dev|prod>}"
[[ "$STAGE" == "dev" || "$STAGE" == "prod" ]] || { echo "Ambiente inválido: $STAGE" >&2; exit 1; }
export AWS_REGION="${AWS_REGION:-us-east-1}"

RAIZ="$(git rev-parse --show-toplevel)"
git -C "$RAIZ" fetch --quiet origin
SHA="$(git -C "$RAIZ" rev-parse --verify "$COMMIT^{commit}")"
git -C "$RAIZ" branch -r --contains "$SHA" | grep -q . || {
    echo "El commit $SHA no está en ninguna rama remota: solo se despliegan commits pusheados." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'git -C "$RAIZ" worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
git -C "$RAIZ" worktree add --detach --quiet "$TMP/wt" "$SHA"

echo "== $SHA: dependencias (frontend y backend)"
(cd "$TMP/wt/Frontend" && npm ci --no-audit --no-fund --silent)
(cd "$TMP/wt/Backend" && npm ci --no-audit --no-fund --silent)

echo "== pruebas completas"
if ! (cd "$TMP/wt/Backend" && npm test > "$TMP/pruebas.log" 2>&1); then
    grep -E '^ℹ (tests|pass|fail)|^✖' "$TMP/pruebas.log" | head -30 >&2
    echo "Pruebas fallidas: NO se despliega $SHA a $STAGE." >&2
    exit 1
fi
grep -E '^ℹ (tests|pass|fail)' "$TMP/pruebas.log"
if grep -q 'LLAMADAS REALES A AWS' "$TMP/pruebas.log"; then
    echo "Una prueba llamó a AWS de verdad: NO se despliega." >&2; exit 1
fi

echo "== recursos de CloudFormation (máximo 500 por stack)"
(cd "$TMP/wt/Backend" && serverless package --stage "$STAGE" --package "$TMP/paquete-cf" > "$TMP/package.log" 2>&1) || {
    tail -20 "$TMP/package.log" >&2; echo "No se pudo empaquetar." >&2; exit 1; }
RECURSOS="$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['Resources']))" "$TMP/paquete-cf/cloudformation-template-update-stack.json")"
echo "recursos: $RECURSOS"
if [ "$RECURSOS" -gt 490 ]; then echo "Demasiado cerca del límite de 500: CloudFormation lo rechazaría. Ver D-16." >&2; exit 1; fi
[ "$RECURSOS" -gt 450 ] && echo "AVISO: quedan menos de 50 recursos de margen (ver D-16)."

echo "== serverless deploy --stage $STAGE"
(cd "$TMP/wt/Backend" && serverless deploy --stage "$STAGE" > "$TMP/deploy.log" 2>&1) || {
    grep -v '^\s*at ' "$TMP/deploy.log" | tail -15 >&2; echo "El deploy falló." >&2; exit 1; }

echo "== verificación del paquete desplegado"
FN="BuildAndServe-$STAGE-personasModule"
curl -fsS -o "$TMP/paquete.zip" "$(aws lambda get-function --function-name "$FN" --query Code.Location --output text)"
mkdir -p "$TMP/paquete" && (cd "$TMP/paquete" && unzip -q ../paquete.zip)
total=0; distintos=0
while IFS= read -r f; do
    total=$((total + 1))
    cmp -s "$TMP/wt/Backend/$f" "$TMP/paquete/$f" || { distintos=$((distintos + 1)); echo "DISTINTO: $f"; }
done < <(cd "$TMP/wt/Backend" && git ls-files handlers lib)
echo "archivos: $total, distintos: $distintos"
[ "$distintos" -eq 0 ] || exit 1
paquetes="$(aws lambda list-functions --query "Functions[?starts_with(FunctionName,'BuildAndServe-$STAGE-')].CodeSha256" --output text | tr '\t' '\n' | sort -u | wc -l)"
[ "$paquetes" -eq 1 ] || { echo "Las funciones de $STAGE no comparten un mismo paquete ($paquetes distintos)." >&2; exit 1; }
echo "Desplegado $SHA en $STAGE (todas las funciones con el mismo paquete)."
