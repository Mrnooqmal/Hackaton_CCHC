# API · Autenticación

La autenticación se basa en **JWT (JSON Web Token)**. El cliente obtiene un token al
iniciar sesión y lo envía en cada request posterior.

## Flujo JWT

```
1. POST /auth/login con email + password
        ↓
2. El backend valida credenciales (bcrypt) y genera un JWT
        ↓
3. El JWT incluye personaId, tenantId y rol
        ↓
4. El cliente guarda el token y lo envía como Bearer en cada request
        ↓
5. Cada Lambda valida el token y extrae tenantId del JWT (nunca del body)
```

::: tip Aislamiento de tenant
El `tenantId` se obtiene exclusivamente del JWT. Esto previene que un cliente acceda a
datos de otro tenant manipulando el body del request. Ver
[Multi-tenant](/arquitectura/multi-tenant).
:::

## Endpoints

### POST /auth/login

Inicia sesión y devuelve el token.

**Request**

```json
{
  "email": "admin@constructora.cl",
  "password": "********"
}
```

**Response `200`**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "persona": {
      "personaId": "a1b2c3d4-...",
      "tenantId": "t-9876-...",
      "nombre": "María",
      "apellido": "González",
      "rol": "admin"
    }
  }
}
```

### POST /auth/logout

Cierra la sesión actual (invalida la sesión en `SessionsTable`).

**Headers:** `Authorization: Bearer <token>`

**Response `200`**

```json
{ "success": true, "message": "Sesión cerrada" }
```

### POST /auth/change-password

Cambia la contraseña de la persona autenticada.

**Request**

```json
{
  "currentPassword": "********",
  "newPassword": "********"
}
```

### POST /auth/forgot-password

Inicia el flujo de recuperación de contraseña (envía correo vía AWS SES).

**Request**

```json
{ "email": "usuario@constructora.cl" }
```

### GET /auth/validate-token

Valida que el token siga vigente. Útil para mantener la sesión en el frontend.

**Headers:** `Authorization: Bearer <token>`

**Response `200`**

```json
{ "success": true, "data": { "valid": true } }
```

## Estructura del token

El payload del JWT incluye al menos:

```json
{
  "personaId": "a1b2c3d4-...",
  "tenantId": "t-9876-...",
  "rol": "admin",
  "iat": 1750000000,
  "exp": 1750086400
}
```

Las sesiones se almacenan en `SessionsTable` con **TTL** de DynamoDB para expiración
automática.
