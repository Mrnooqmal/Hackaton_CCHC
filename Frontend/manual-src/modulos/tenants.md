# Módulo: Tenants

**Ubicación:** `Backend/handlers/tenants-module/` · `lib/models/Tenant`

Un **tenant** es una empresa cliente del SaaS. El sistema es multi-tenant: cada empresa
opera de forma aislada, con sus propias obras, personas y configuración. Este módulo
gestiona el registro, los planes y la personalización de cada empresa.

## Aislamiento multi-tenant

Toda tabla operacional incluye `tenantId`. El `tenantId` se extrae **siempre del JWT**,
nunca del body del request, lo que previene fugas de datos entre clientes. Ver
[Arquitectura · Multi-tenant](/arquitectura/multi-tenant).

## Estructura (TenantsTable)

```
tenantId        UUID
slug            URL-friendly, único global
nombre          Razón social
rutEmpresa / email / telefono
plan            starter | professional | enterprise
tamano          micro | pequena | mediana | grande
cantidadTrabajadores
estado          setup | activo | suspendido
adminPersonaId  ID de la persona administradora

settings        Configuración técnica
  maxWorkers
  dataRetentionDays
  twoFactorEnabled
  modulosActivos   [documentos, actividades, encuestas, incidentes, ia]

reglas          Reglas de negocio SST
  fasesObligatorias   Fases del DS 44 que aplican
  limiteObras
  requiereFirmaPin

preferencias    Personalización UI
  timezone / idioma / formatoFecha
  colorPrimario / colorSecundario / logoUrl
```

## Planes

| Plan | Orientado a | Características típicas |
| --- | --- | --- |
| starter | Empresas pequeñas | Módulos básicos, límite de obras y trabajadores |
| professional | Empresas medianas | Más obras, Asistente IA, reportería avanzada |
| enterprise | Grandes constructoras | Sin límites prácticos, personalización completa |

El campo `settings.modulosActivos` permite **vender por módulos**: habilitar o
deshabilitar funcionalidades según el plan contratado.

## Personalización

El tenant puede personalizar la apariencia (color primario/secundario, logo) y
preferencias regionales (`timezone: America/Santiago`, `idioma: es`,
`formatoFecha: DD/MM/YYYY`).

## Reglas de negocio

`reglas.fasesObligatorias` define qué fases del DS 44 aplican a las obras del tenant.
Al crear una obra, se preconfiguran los documentos obligatorios de esas fases. Ver
[Fases de obra](/ds44/fases-obra).

## Onboarding

```
1. POST /tenants/setup (nombre, rutEmpresa, cantidadTrabajadores, datos admin)
        ↓
2. Se crea el tenant en estado "setup"
        ↓
3. Se calcula "tamano" según cantidadTrabajadores
        ↓
4. Se crea la Persona admin (rol admin, tieneAccesoWeb=true, password temporal)
        ↓
5. Se actualiza tenant.adminPersonaId
        ↓
6. estado del tenant pasa a "activo"
        ↓
7. Se notifica al admin con sus credenciales
```

> El `tenant-0` está reservado para el superadmin con acceso cross-tenant.

Ver el paso a paso en [Onboarding de tenant](/guia-inicio/onboarding).

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/tenants/setup` | Registrar nuevo tenant |
| `GET` | `/tenants/{id}` | Obtener tenant |
| `PUT` | `/tenants/{id}/settings` | Actualizar configuración |
