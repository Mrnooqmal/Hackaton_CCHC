# Referencia API

La API de Build & Serve es una **API REST** servida sobre AWS Lambda + API Gateway,
enrutada con `itty-router`. Esta sección documenta los endpoints principales por dominio.

## URL base

```
https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
```

En desarrollo local con Serverless Offline:

```
http://localhost:3001
```

## Autenticación

Todas las rutas (salvo login y recuperación de contraseña) requieren un **token JWT**
en el header:

```
Authorization: Bearer <token>
```

El `tenantId` se extrae **siempre del JWT**, nunca del body. Ver
[Autenticación](/api/autenticacion).

## Formato de respuesta

Las respuestas siguen un formato consistente:

```json
{
  "success": true,
  "data": { },
  "message": "Operación exitosa"
}
```

En caso de error:

```json
{
  "success": false,
  "error": "Descripción del error",
  "code": "ERROR_CODE"
}
```

## Dominios de la API

| Dominio | Documentación |
| --- | --- |
| Autenticación | [Ver](/api/autenticacion) |
| Obras | [Ver](/api/obras) |
| Documentos | [Ver](/api/documentos) |
| Firmas | [Ver](/api/firmas) |
| Incidentes | [Ver](/api/incidentes) |
| Actividades | [Ver](/api/actividades) |
| Personas | [Ver](/api/personas) |

## Códigos HTTP

| Código | Significado |
| --- | --- |
| `200` | OK |
| `201` | Creado |
| `400` | Solicitud inválida |
| `401` | No autenticado (token ausente o inválido) |
| `403` | Sin permisos para la acción |
| `404` | Recurso no encontrado |
| `500` | Error interno |
