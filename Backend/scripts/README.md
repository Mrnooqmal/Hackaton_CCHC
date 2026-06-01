# Scripts de migracion

Scripts operativos de migracion de datos. Todos siguen el patron
`--dry-run` (default) / `--apply` y son idempotentes salvo que se indique.

## migrate-to-personas.js
Migracion historica: une `Users` + `Workers` legacy en `Personas`.
```
node scripts/migrate-to-personas.js --stage dev [--dry-run]
```

## migrate-workerId-to-personaId.js
Normaliza referencias embebidas: copia `workerId -> personaId` en
`asignaciones`, `firmas`, `asistentes`, `trabajadores` y `afectado` de las
tablas Documents, SignatureRequests, Activities e Incidents. No borra
`workerId` (se retira en una limpieza posterior).
```
STAGE=dev node scripts/migrate-workerId-to-personaId.js --dry-run
STAGE=dev node scripts/migrate-workerId-to-personaId.js --apply
```

> ADVERTENCIA: NO ejecutar `--apply` en produccion sin backup previo de las
> tablas afectadas (habilitar Point-in-Time Recovery o exportar a S3 antes).
> Ejecutar siempre primero en `dev` y validar con `--dry-run`.

Nombres de tabla: se leen de las variables de entorno
(`DOCUMENTS_TABLE`, `SIGNATURE_REQUESTS_TABLE`, `ACTIVITIES_TABLE`,
`INCIDENTS_TABLE`); si no estan, se construyen como
`${SERVICE_NAME:-hackatonbackendv2}-<tabla>-${STAGE:-dev}`.
