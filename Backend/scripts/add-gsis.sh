#!/bin/bash
REGION="us-east-1"

wait_for_table() {
    local TABLE=$1
    echo "  Esperando que $TABLE esté ACTIVE..."
    while true; do
        STATUS=$(aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" --query "Table.TableStatus" --output text 2>/dev/null)
        GSI_CREATING=$(aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" --query "Table.GlobalSecondaryIndexes[?IndexStatus=='CREATING'].IndexName" --output text 2>/dev/null)
        if [ "$STATUS" = "ACTIVE" ] && [ -z "$GSI_CREATING" -o "$GSI_CREATING" = "None" ]; then
            echo "  ✅ $TABLE ACTIVE"
            return 0
        fi
        echo "    Status: $STATUS, GSI creating: $GSI_CREATING"
        sleep 10
    done
}

add_gsi() {
    local TABLE=$1
    local GSI_NAME=$2
    local PK_NAME=$3
    local PK_TYPE=$4
    local SK_NAME=$5
    local SK_TYPE=$6

    echo ""
    echo "📌 Agregando GSI '$GSI_NAME' a '$TABLE'..."

    # Check if GSI already exists
    EXISTING=$(aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" --query "Table.GlobalSecondaryIndexes[?IndexName=='$GSI_NAME'].IndexName" --output text 2>/dev/null)
    if [ "$EXISTING" = "$GSI_NAME" ]; then
        echo "  ⏭️  GSI '$GSI_NAME' ya existe, saltando."
        return 0
    fi

    if [ -z "$SK_NAME" ]; then
        aws dynamodb update-table \
            --table-name "$TABLE" \
            --region "$REGION" \
            --attribute-definitions "AttributeName=$PK_NAME,AttributeType=$PK_TYPE" \
            --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"$GSI_NAME\",\"KeySchema\":[{\"AttributeName\":\"$PK_NAME\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}}]" \
            --output text > /dev/null 2>&1
    else
        aws dynamodb update-table \
            --table-name "$TABLE" \
            --region "$REGION" \
            --attribute-definitions "AttributeName=$PK_NAME,AttributeType=$PK_TYPE" "AttributeName=$SK_NAME,AttributeType=$SK_TYPE" \
            --global-secondary-index-updates "[{\"Create\":{\"IndexName\":\"$GSI_NAME\",\"KeySchema\":[{\"AttributeName\":\"$PK_NAME\",\"KeyType\":\"HASH\"},{\"AttributeName\":\"$SK_NAME\",\"KeyType\":\"RANGE\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}}]" \
            --output text > /dev/null 2>&1
    fi

    if [ $? -eq 0 ]; then
        echo "  ⏳ Creando..."
        wait_for_table "$TABLE"
    else
        echo "  ⚠️  Error al crear GSI"
    fi
}

echo "=== Creando GSIs en tablas existentes ==="

# Documents
add_gsi "HackatonBackend-documents-dev" "tenantId-index" "tenantId" "S"
add_gsi "HackatonBackend-documents-dev" "obraId-index" "obraId" "S"

# Activities
add_gsi "HackatonBackend-activities-dev" "tenantId-index" "tenantId" "S"

# Incidents
add_gsi "HackatonBackend-incidents-dev" "tenantId-fecha-index" "tenantId" "S" "fecha" "S"

# Signatures
add_gsi "HackatonBackend-signatures-dev" "tenantId-index" "tenantId" "S"
add_gsi "HackatonBackend-signatures-dev" "personaId-index" "personaId" "S"

# Signature Requests
add_gsi "HackatonBackend-signature-requests-dev" "tenantId-index" "tenantId" "S"

# Surveys
add_gsi "HackatonBackend-surveys-dev" "tenantId-index" "tenantId" "S"

echo ""
echo "✅ TODOS LOS GSIs CREADOS!"
