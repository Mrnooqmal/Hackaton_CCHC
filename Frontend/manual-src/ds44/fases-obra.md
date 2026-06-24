# Fases de obra

Build & Serve maneja **dos dimensiones de fases** que conviene no confundir:

1. **Fase física** de construcción — el avance real de la obra.
2. **Ciclo normativo (Deming / PDCA)** — la lógica de gestión preventiva del DS 44.

## Fases físicas

El campo `etapaActual` de la tabla `ObrasTable` registra la etapa física actual:

| Etapa | Código | Descripción |
| --- | --- | --- |
| Excavación | `excavacion` | Movimiento de tierras, fundaciones, inicio de faena |
| Obra gruesa | `obra_gruesa` | Estructura, hormigón, albañilería |
| Terminaciones | `terminaciones` | Instalaciones, revestimientos, acabados |
| Entrega | `entrega` | Cierre, recepción y entrega de la obra |

Cada fase tiene asociado un conjunto de **documentos obligatorios** en el campo
`fasesConfig`, que se prellenan al crear la obra:

```
fasesConfig:
  excavacion:     [IRL, POLITICA_SSO, REGLAMENTO_INTERNO, ENCUESTA_SALUD, ...]
  obra_gruesa:    [PROCEDIMIENTO_TRABAJO, ENTREGA_EPP, MAPA_RIESGOS, ...]
  terminaciones:  [PROCEDIMIENTO_TRABAJO, ENTREGA_EPP, ...]
  entrega:        [CAPACITACION_SST, ...]
```

## Avance de fase con verificación

Al cambiar `etapaActual`, la plataforma puede **verificar automáticamente** si todos
los documentos obligatorios de la fase anterior se encuentran firmados
(estado `completado`). Esto evita avanzar en la obra dejando brechas de cumplimiento
documental.

```
┌──────────────┐   verifica    ┌──────────────┐   verifica    ┌────────────────┐
│  Excavación  │ ───────────▶ │  Obra gruesa │ ───────────▶ │  Terminaciones │ ──▶ Entrega
└──────────────┘  docs OK ✓   └──────────────┘  docs OK ✓   └────────────────┘
```

## El ciclo de Deming (PDCA)

Independiente de la etapa física, el DS 44 exige un ciclo continuo de mejora. La
plataforma lo modela así:

| Etapa PDCA | En la plataforma |
| --- | --- |
| **Planificar** | Definir MIPPER, política SSO, procedimientos y documentos por fase |
| **Hacer** | Ejecutar capacitaciones, entregar EPP, registrar actividades |
| **Verificar** | Auditorías, inspecciones, seguimiento de KPIs e incidentes |
| **Actuar** | Acciones correctivas, actualización de matrices y procedimientos |

Una obra avanza simultáneamente en su fase física (qué se está construyendo) y en su
ciclo de gestión (cómo se gestiona la prevención). Ambas quedan trazadas en el módulo
de [Obras](/modulos/obras).

::: info Configuración por tenant
Qué fases aplican a una obra depende de `tenant.reglas.fasesObligatorias`. Un tenant
puede personalizar qué etapas exige y qué documentos son obligatorios en cada una.
Ver [Tenants](/modulos/tenants).
:::
