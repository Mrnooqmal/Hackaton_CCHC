# Módulo: Personas

**Ubicación:** `Frontend/src/pages/` · `Backend/handlers/personas-module/` · `lib/models/Persona`

La entidad **Persona** unifica en un solo registro lo que antes eran dos tablas
separadas (Users y Workers). Toda persona del sistema —admin, prevencionista,
supervisor, jefe de obra o trabajador— es un único registro con un único `personaId`.

## Por qué identidad unificada

Antes existían `userId` (acceso web) y `workerId` (trabajador en terreno) por separado,
lo que obligaba a sincronizar manualmente y duplicaba el hash del PIN. La unificación
resuelve esto:

- **Un solo ID** (`personaId`).
- **Un solo hash de PIN** (`pinHash`), generado una vez.
- Sin sincronización manual entre tablas.

## Estructura

```
personaId        UUID (reemplaza userId y workerId)
tenantId         FK al tenant
rut              RUT chileno formateado
nombre / apellido / email / telefono
rol              admin | prevencionista | supervisor | trabajador
permisos         Derivados del rol
cargo            Cargo laboral
obraIds          Lista de obras asignadas
tieneAccesoWeb   BOOL — si puede hacer login en la plataforma
passwordHash     Solo si tieneAccesoWeb = true
pinHash          Hash del PIN para firma digital
pinCreatedAt     Timestamp
habilitado       true cuando completó enrolamiento
firmaEnrolamiento  Datos de la firma de enrolamiento
estado           pendiente | activo | inactivo
```

## Acceso web vs. firma en terreno

| Caso | `tieneAccesoWeb` | `passwordHash` | `pinHash` |
| --- | --- | --- | --- |
| Admin / Prevencionista | `true` | ✅ | ✅ |
| Trabajador con app | `true` | ✅ | ✅ |
| Trabajador solo terreno | `false` | ✗ | ✅ |

Una persona puede **no tener acceso web** pero sí tener PIN para firmar documentos en
terreno. Esto cubre a trabajadores que solo firman desde el dispositivo del supervisor.

## Enrolamiento

```
1. Se crea la persona (estado: pendiente)
        ↓
2. La persona completa su firma de enrolamiento (firmaEnrolamiento)
        ↓
3. Se activa su PIN (pinHash + pinCreatedAt)
        ↓
4. habilitado = true, estado = activo
```

## Roles y permisos

| Rol | Alcance |
| --- | --- |
| admin | Gestión completa del tenant |
| prevencionista | Crear actividades, asignar documentos, ver reportes |
| supervisor | Firmar como relator, ver trabajadores de su obra |
| jefe_obra | Gestión operativa de la obra |
| trabajador | Ver documentos asignados, firmar, registrar asistencia |

Detalle completo en [Roles de Usuario](/roles/).

## Asignación a obras

`obraIds` es una lista: una persona puede estar asignada a **múltiples obras**
simultáneamente. El contexto de obra activa se gestiona en el frontend con `ObraContext`.

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/personas` | Crear persona |
| `GET` | `/personas` | Listar personas del tenant |
| `GET` | `/personas/{id}` | Detalle |
| `PUT` | `/personas/{id}` | Actualizar |
| `POST` | `/personas/{id}/change-password` | Cambiar contraseña |

Ver detalle en [API · Personas](/api/personas).
