#!/usr/bin/env bash
# Borra los restos del proyecto anterior (HackatonBackend), y nada más.
#
#   bash infra/limpiar-hackatonbackend.sh              # ensayo: dice qué borraría
#   bash infra/limpiar-hackatonbackend.sh --ejecutar   # borra exactamente eso
#
# Qué hay (inventariado el 8 de noviembre de 2026):
#
#   Cuenta 772706200162 (perfil adrean_cchc), bucket de despliegue de Serverless:
#     serverless/hackatonbackendv2/ y serverless/hackatonbackendv2-testeo/, con
#     TODAS sus versiones y marcas de borrado (el bucket tiene versionado: borrar
#     solo lo vigente deja las versiones anteriores ocupando espacio).
#
#   Cuenta 789925699187 (perfil default), que también aloja OTROS proyectos
#   (gruposoy, soyfuncionario, soyhonorario, soytrabajador):
#     - en su bucket de Serverless, serverless/hackatonbackendv2-testeo/ y las
#       marcas de borrado de serverless/HackatonBackend/;
#     - el stack HackatonBackend-dev en DELETE_FAILED. Falló porque sus dos
#       buckets no estaban vacíos; hoy esos buckets ya no existen y no queda
#       ninguna función. Se borra conservando esos dos recursos (que no existen):
#       solo desaparece el registro del stack.
#
# Lo que impide borrar de más:
#   - cada perfil tiene que corresponder a su cuenta, o no se hace nada;
#   - los prefijos están escritos aquí, completos y con la barra final: ningún
#     otro prefijo del bucket entra;
#   - el stack se borra solo si sigue en DELETE_FAILED y sus únicos recursos
#     fallidos son esos dos buckets.
set -euo pipefail

EJECUTAR=false
[ "${1:-}" = "--ejecutar" ] && EJECUTAR=true
REGION=us-east-1

CUENTA_BAS=772706200162;  PERFIL_BAS=adrean_cchc
BUCKET_BAS=serverless-framework-deployments-us-east-1-e30a0f06-a273
PREFIJOS_BAS=("serverless/hackatonbackendv2/" "serverless/hackatonbackendv2-testeo/")

CUENTA_OTRA=789925699187; PERFIL_OTRA=default
BUCKET_OTRA=serverless-framework-deployments-us-east-1-7653a9c0-a5fa
PREFIJOS_OTRA=("serverless/hackatonbackendv2-testeo/" "serverless/HackatonBackend/")
STACK=HackatonBackend-dev
RETENER=(DocumentsBucket IncidentEvidenceBucket)

comprobar_cuenta() { # perfil cuenta
    local real
    real="$(AWS_PROFILE="$1" aws sts get-caller-identity --query Account --output text)"
    [ "$real" = "$2" ] || { echo "El perfil $1 es de la cuenta $real, no de $2. No se hace nada." >&2; exit 1; }
}

# Versiones y marcas de un prefijo, como JSON {Objects:[{Key,VersionId}]} en lotes de 1000.
listar() { # perfil bucket prefijo salida
    AWS_PROFILE="$1" aws s3api list-object-versions --bucket "$2" --prefix "$3" --output json > "$4"
}

resumen() { # archivo prefijo
    python3 - "$1" "$2" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); pre = sys.argv[2]
v = [x for x in d.get('Versions') or [] if x['Key'].startswith(pre)]
m = [x for x in d.get('DeleteMarkers') or [] if x['Key'].startswith(pre)]
mb = sum(x.get('Size', 0) for x in v) / 1048576
despliegues = sorted({'/'.join(x['Key'].split('/')[:4]) for x in v + m})
print(f"    {pre}: {len(v)} versiones ({mb:.1f} MB) y {len(m)} marcas de borrado, en {len(despliegues)} despliegues")
for dpl in despliegues: print(f"      {dpl}/")
PY
}

borrar() { # perfil bucket archivo prefijo
    python3 - "$3" "$4" > "$3.lotes" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); pre = sys.argv[2]
objs = [{'Key': x['Key'], 'VersionId': x['VersionId']} for x in (d.get('Versions') or []) + (d.get('DeleteMarkers') or []) if x['Key'].startswith(pre)]
for i in range(0, len(objs), 1000): print(json.dumps({'Objects': objs[i:i + 1000], 'Quiet': True}))
PY
    while IFS= read -r lote; do
        AWS_PROFILE="$1" aws s3api delete-objects --bucket "$2" --delete "$lote" --output json \
            | python3 -c 'import json,sys; e=json.load(sys.stdin).get("Errors") or []; print(f"      errores: {len(e)}") if e else None; sys.exit(1 if e else 0)'
    done < "$3.lotes"
}

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

comprobar_cuenta "$PERFIL_BAS" "$CUENTA_BAS"
comprobar_cuenta "$PERFIL_OTRA" "$CUENTA_OTRA"

echo "== Cuenta $CUENTA_BAS ($PERFIL_BAS), s3://$BUCKET_BAS"
for p in "${PREFIJOS_BAS[@]}"; do
    f="$TMP/bas-$(echo "$p" | tr '/' '_').json"; listar "$PERFIL_BAS" "$BUCKET_BAS" "$p" "$f"; resumen "$f" "$p"
done

echo "== Cuenta $CUENTA_OTRA ($PERFIL_OTRA), s3://$BUCKET_OTRA"
for p in "${PREFIJOS_OTRA[@]}"; do
    f="$TMP/otra-$(echo "$p" | tr '/' '_').json"; listar "$PERFIL_OTRA" "$BUCKET_OTRA" "$p" "$f"; resumen "$f" "$p"
done

echo "== Cuenta $CUENTA_OTRA, stack $STACK"
estado="$(AWS_PROFILE="$PERFIL_OTRA" aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query 'Stacks[0].StackStatus' --output text)"
fallidos="$(AWS_PROFILE="$PERFIL_OTRA" aws cloudformation list-stack-resources --stack-name "$STACK" --region "$REGION" \
    --query "StackResourceSummaries[?ResourceStatus=='DELETE_FAILED'].LogicalResourceId" --output text | tr '\t' '\n' | sort | tr '\n' ' ')"
vivos=0
for b in hackatonbackend-documents-v24-dev "hackatonbackend-incident-evidence-dev-$CUENTA_OTRA"; do
    AWS_PROFILE="$PERFIL_OTRA" aws s3api head-bucket --bucket "$b" >/dev/null 2>&1 && vivos=$((vivos + 1))
done
funciones="$(AWS_PROFILE="$PERFIL_OTRA" aws lambda list-functions --region "$REGION" --query "length(Functions[?starts_with(FunctionName,'$STACK')])" --output text)"
echo "    estado: $estado; recursos fallidos: $fallidos; sus buckets vivos: $vivos; funciones vivas: $funciones"
esperados="$(printf '%s\n' "${RETENER[@]}" | sort | tr '\n' ' ')"
if [ "$estado" != "DELETE_FAILED" ] || [ "$fallidos" != "$esperados" ] || [ "$vivos" -ne 0 ] || [ "$funciones" -ne 0 ]; then
    echo "    El stack no está como se inventarió: no se toca." >&2; STACK_OK=false
else
    echo "    Se borra el registro del stack, conservando ${RETENER[*]} (ya no existen)."; STACK_OK=true
fi

if ! $EJECUTAR; then
    echo; echo "Ensayo: no se borró nada. Para borrar exactamente esto: bash infra/limpiar-hackatonbackend.sh --ejecutar"
    exit 0
fi

echo; echo "== Borrando"
for p in "${PREFIJOS_BAS[@]}"; do borrar "$PERFIL_BAS" "$BUCKET_BAS" "$TMP/bas-$(echo "$p" | tr '/' '_').json" "$p"; echo "    $BUCKET_BAS/$p"; done
for p in "${PREFIJOS_OTRA[@]}"; do borrar "$PERFIL_OTRA" "$BUCKET_OTRA" "$TMP/otra-$(echo "$p" | tr '/' '_').json" "$p"; echo "    $BUCKET_OTRA/$p"; done
if $STACK_OK; then
    AWS_PROFILE="$PERFIL_OTRA" aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION" --retain-resources "${RETENER[@]}"
    AWS_PROFILE="$PERFIL_OTRA" aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION"
    echo "    stack $STACK borrado"
fi

echo "== Verificación"
for p in "${PREFIJOS_BAS[@]}"; do
    n="$(AWS_PROFILE="$PERFIL_BAS" aws s3api list-object-versions --bucket "$BUCKET_BAS" --prefix "$p" --query 'length([Versions[], DeleteMarkers[]][])' --output text)"
    echo "    $BUCKET_BAS/$p: $n"
done
for p in "${PREFIJOS_OTRA[@]}"; do
    n="$(AWS_PROFILE="$PERFIL_OTRA" aws s3api list-object-versions --bucket "$BUCKET_OTRA" --prefix "$p" --query 'length([Versions[], DeleteMarkers[]][])' --output text)"
    echo "    $BUCKET_OTRA/$p: $n"
done
