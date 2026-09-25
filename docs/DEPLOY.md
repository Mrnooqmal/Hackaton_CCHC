# Deploy del backend — LEER ANTES DE DEPLOYAR

Hay **dos backends** (dos "services" de Serverless). El `stage` es `dev` en ambos;
lo que cambia es el **nombre del service**, y ese nombre decide **a qué base de datos apunta**.

| Backend | Service | Para qué | Datos |
|---------|---------|----------|-------|
| **Desarrollo** | `hackatonbackendv2` | Trabajo diario, up-to-date con `pruebas` | De prueba, descartables |
| **Producción (EBCO)** | `hackatonbackendv2-testeo` | Prueba en vivo con EBCO | **REALES — NO se pueden perder** |

> ⚠️ **Producción (`-testeo`) la deployan solo las personas a cargo, y solo cuando hay
> suficientes cambios validados.** Tiene datos reales de EBCO + un tenant interno de bugs.

## Cómo deployar (NO editar la línea `service:` a mano)

```bash
cd Backend

npm run deploy:dev      # → hackatonbackendv2  (desarrollo, seguro)
npm run deploy:testeo   # → hackatonbackendv2-testeo (PRODUCCIÓN EBCO)
```

- `serverless deploy` a secas también va a **dev** (es el default seguro).
- Solo `deploy:testeo` toca producción, y hay que escribirlo a propósito.

## Verificar a cuál vas a deployar (antes de correr)

```bash
npm run print:dev       # debe decir: service: hackatonbackendv2
npm run print:testeo    # debe decir: service: hackatonbackendv2-testeo
```

## Frontend: tiene que apuntar al backend correcto

El front elige backend con `VITE_API_URL` en `Frontend/.env`:

- Desarrollo → `https://teyhaynzc8.execute-api.us-east-1.amazonaws.com`
- Producción (testeo) → `https://jxlyl6z3dk.execute-api.us-east-1.amazonaws.com`

La demo en vivo (CloudFront `d30jksx91fodea`) debe buildearse apuntando a **testeo**.

## Cómo funciona por dentro

En `serverless.yml`:
```yaml
service: ${env:SLS_SERVICE, 'hackatonbackendv2'}
```
El default es dev. `deploy:testeo` setea `SLS_SERVICE=hackatonbackendv2-testeo` (vía `cross-env`,
funciona en Windows/Mac/Linux). Nada más cambia → los nombres de tabla quedan idénticos.

## Protección de datos (ya aplicada)
- Las 12 tablas DynamoDB + 2 buckets S3 tienen `DeletionPolicy`/`UpdateReplacePolicy`
  **condicional**: `Retain` en producción (`-testeo`), `Delete` en dev. Así un
  `serverless remove` o un reemplazo de stack **no borra los datos reales de EBCO**.
  (No protege de borrados a nivel app — para eso, activar PITR.)

## Pendiente recomendado
- Activar **PITR** (point-in-time recovery) en las tablas de producción (restaurar ante borrados por la app).
