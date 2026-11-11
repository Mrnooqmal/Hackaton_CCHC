#!/usr/bin/env bash
# Regla de ciclo de vida del bucket de despliegue de Serverless (cuenta
# 772706200162). El bucket lo crea Serverless y no está en ningún stack, por eso
# la regla se aplica con este script.
#
# El bucket tiene versionado: cuando Serverless limpia un despliegue viejo solo
# deja una marca de borrado, y los artefactos siguen ocupando espacio como
# versiones anteriores. La regla borra esas versiones 30 días después de quedar
# reemplazadas, y las marcas que ya no tapan nada. Lo vigente no lo toca: los
# despliegues que `serverless rollback` puede usar siguen ahí.
#
# Solo cubre serverless/BuildAndServe/. Los restos de hackatonbackend los borra
# infra/limpiar-hackatonbackend.sh, con su ensayo.
set -euo pipefail
export AWS_PROFILE=adrean_cchc
BUCKET=serverless-framework-deployments-us-east-1-e30a0f06-a273
CUENTA=772706200162
real="$(aws sts get-caller-identity --query Account --output text)"
[ "$real" = "$CUENTA" ] || { echo "El perfil es de la cuenta $real, no de $CUENTA. No se hace nada." >&2; exit 1; }

# put-bucket-lifecycle-configuration reemplaza TODA la configuración: si hay una
# regla que no es esta, se detiene.
otras="$(aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --query "Rules[?ID!='buildandserve-versiones-viejas'].ID" --output text 2>/dev/null || true)"
[ -z "$otras" ] || [ "$otras" = "None" ] || { echo "El bucket tiene otras reglas ($otras). No se toca." >&2; exit 1; }

aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "buildandserve-versiones-viejas",
    "Status": "Enabled",
    "Filter": { "Prefix": "serverless/BuildAndServe/" },
    "NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
    "Expiration": { "ExpiredObjectDeleteMarker": true },
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
  }]
}'
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --output json
