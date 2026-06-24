# Módulo: Obras

**Ubicación:** `Frontend/src/pages/` · `Backend/handlers/obras-module/` · `lib/services/ObraService`

Una **obra** es un proyecto de construcción gestionado por un tenant. Es la entidad
central que agrupa documentos, actividades, incidentes y personas asignadas.

## Qué es una obra en el sistema

Cada obra (`ObrasTable`) registra:

```
obraId        Identificador único
tenantId      Empresa propietaria
nombre        Nombre de la obra
codigo        Código interno opcional
direccion / comuna / region   Ubicación física
etapaActual   excavacion | obra_gruesa | terminaciones | entrega
mandante      Empresa mandante
estado        activa | pausada | finalizada
fasesConfig   Mapa de fases con sus documentos obligatorios
```

Un tenant puede tener **múltiples obras activas** simultáneamente. La consulta de obras
usa `PK = TENANT#{tenantId}`, por lo que se listan con Query (nunca Scan).

## Ciclo de Deming vs. etapa física

La obra avanza en dos dimensiones paralelas:

- **Etapa física** (`etapaActual`): qué se está construyendo.
- **Ciclo normativo (PDCA)**: cómo se gestiona la prevención (Planificar, Hacer,
  Verificar, Actuar).

El ciclo de Deming es **normativo, no físico**: una obra en etapa de `obra_gruesa`
sigue ejecutando continuamente el ciclo de mejora. Ver [Fases de obra](/ds44/fases-obra).

## Creación de una obra

```
1. Admin / Prevencionista crea la obra (POST /obras)
        ↓
2. El sistema lee tenant.reglas.fasesObligatorias
        ↓
3. Se precrean los documentos obligatorios de cada fase (fasesConfig)
        ↓
4. El prevencionista sube los archivos a cada documento
        ↓
5. La obra queda lista para asignar personas y registrar actividades
```

## Avance de fase

Al cambiar `etapaActual`, la plataforma verifica si la fase anterior tiene todos sus
documentos obligatorios en estado `completado`. Esto previene avanzar dejando brechas
de cumplimiento.

```
Excavación ──▶ Obra gruesa ──▶ Terminaciones ──▶ Entrega
   (verifica docs obligatorios completos en cada transición)
```

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/obras` | Crear obra (precrea documentos) |
| `GET` | `/obras` | Listar obras del tenant |
| `GET` | `/obras/{id}` | Detalle de una obra |
| `PUT` | `/obras/{id}` | Actualizar obra |
| `POST` | `/obras/{id}/phase-advance` | Avanzar de fase con verificación |

Ver detalle en [API · Obras](/api/obras).
