# Onboarding de tenant

El onboarding es el proceso de registrar una nueva empresa (tenant) en la plataforma.
Crea el tenant, su administrador inicial y deja todo listo para operar.

## Flujo de onboarding

```
1. POST /tenants/setup
   (nombre, rutEmpresa, cantidadTrabajadores, email y nombre del admin)
        ↓
2. Se crea el registro en TenantsTable con estado "setup"
        ↓
3. Se calcula "tamano" según cantidadTrabajadores
        ↓
4. Se crea la Persona admin en PersonasTable
   (rol "admin", tieneAccesoWeb=true, password temporal)
        ↓
5. Se actualiza tenant.adminPersonaId
        ↓
6. El estado del tenant pasa a "activo"
        ↓
7. Se notifica al admin con sus credenciales (email vía SES o respuesta directa)
```

## Datos requeridos

```json
{
  "nombre": "Constructora Ejemplo S.A.",
  "rutEmpresa": "76.123.456-7",
  "cantidadTrabajadores": 120,
  "admin": {
    "nombre": "María González",
    "email": "maria.gonzalez@constructora.cl"
  }
}
```

## Cálculo del tamaño

El campo `tamano` se deriva automáticamente de `cantidadTrabajadores` y condiciona
límites y comportamiento del backend:

| Tamaño | Rango aproximado de trabajadores |
| --- | --- |
| micro | hasta ~10 |
| pequena | ~11 a 50 |
| mediana | ~51 a 200 |
| grande | más de ~200 |

## Estados del tenant

```
setup → activo → suspendido
```

- **setup**: registro creado, pendiente de completar.
- **activo**: operativo, el admin puede iniciar sesión.
- **suspendido**: acceso bloqueado (por ejemplo, por impago).

## Después del onboarding

Una vez activo el tenant, el admin debe:

1. Cambiar su contraseña temporal.
2. Configurar módulos activos, reglas SST y personalización.
3. Crear la primera obra y registrar personas.

Continúa en [Primeros pasos](/guia-inicio/primeros-pasos).

::: info Superadmin
El `tenant-0` está reservado para el superadmin de la plataforma, con acceso
cross-tenant para soporte. No se crea mediante este flujo. Ver
[Multi-tenant](/arquitectura/multi-tenant).
:::
