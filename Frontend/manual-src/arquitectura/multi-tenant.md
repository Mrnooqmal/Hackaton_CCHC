# Arquitectura Multi-tenant

Build & Serve es un **SaaS multi-tenant**: múltiples empresas (tenants) usan la misma
infraestructura, pero sus datos están completamente aislados entre sí.

## Principio de aislamiento

Toda tabla operacional incluye `tenantId`, ya sea como atributo o como parte de la
Partition Key. **Nunca** se realiza un Scan sin filtro de tenant.

```
PersonasTable    PK = TENANT#{tenantId}   ← aislamiento en la propia key
ObrasTable       PK = TENANT#{tenantId}
DocumentosTable  PK = TENANT#{tenantId}
ActivitiesTable  tenantId como atributo + GSI tenantId-index
```

## Fuente del tenantId

::: danger Regla crítica de seguridad
El `tenantId` se extrae **siempre del JWT**, nunca del body del request. Esto previene
que un cliente acceda a datos de otro tenant manipulando los parámetros enviados.
:::

```
1. La persona inicia sesión → el JWT incluye su tenantId
        ↓
2. Cada request envía el JWT en Authorization: Bearer
        ↓
3. El Lambda decodifica el JWT y obtiene el tenantId
        ↓
4. Todas las queries se filtran por ese tenantId
        ↓
5. El body del request NUNCA es fuente de tenantId
```

## GSIs cross-tenant controlados

Algunos índices son cross-tenant por diseño, pero el Lambda valida la coincidencia:

| GSI | Uso | Validación |
| --- | --- | --- |
| `personaId-index` | Lookup directo de persona (verificación de firmas, login por token) | El Lambda confirma el tenant |
| `email-index` | Login (el email puede existir en varios tenants) | Se valida que el tenantId del JWT coincida |

## El superadmin (tenant-0)

El `tenant-0` está reservado para el **superadmin**, con acceso cross-tenant para
soporte y administración de la plataforma. Es la única excepción al aislamiento estricto.

## Jerarquía de entidades

```
Tenant (empresa cliente)
  ├── Obra ──┬── Documentos
  │          ├── Actividades
  │          └── Incidentes
  └── Persona ──┬── Firmas
                └── Asignaciones
```

- Un **tenant** tiene muchas obras y muchas personas.
- Una **obra** agrupa documentos, actividades e incidentes.
- Una **persona** puede estar asignada a varias obras (`obraIds`) y genera firmas y
  asignaciones.

## Personalización por tenant

Cada tenant configura su propia experiencia:

- **Módulos activos** (`settings.modulosActivos`): venta por módulos.
- **Reglas SST** (`reglas.fasesObligatorias`): qué fases del DS 44 aplican.
- **Preferencias UI**: colores, logo, timezone, idioma, formato de fecha.

Ver [Tenants](/modulos/tenants) y [Base de datos](/arquitectura/base-de-datos).
