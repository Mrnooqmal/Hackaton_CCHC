# Fases de obra

En la plataforma, una obra avanza en **dos dimensiones** que conviene no confundir:

1. **Etapa física** de construcción — el avance real de lo que se está construyendo.
2. **Ciclo de gestión preventiva** — cómo se gestiona la seguridad, según el DS 44.

## Etapas físicas

La obra pasa por cuatro etapas físicas, en orden:

| Etapa | ¿Qué ocurre? |
| --- | --- |
| **Excavación** | Movimiento de tierras, fundaciones, inicio de faena. |
| **Obra gruesa** | Estructura, hormigón, albañilería. |
| **Terminaciones** | Instalaciones, revestimientos, acabados. |
| **Entrega** | Cierre, recepción y entrega de la obra. |

Cada etapa tiene asociado un conjunto de **documentos obligatorios** que la plataforma
prepara automáticamente al crear la obra.

## Avance de etapa con verificación

Antes de avanzar de una etapa a la siguiente, la plataforma **verifica que los documentos
obligatorios de la etapa actual estén firmados**. Esto evita avanzar dejando vacíos de
cumplimiento.

```
┌──────────────┐   verifica    ┌──────────────┐   verifica    ┌────────────────┐
│  Excavación  │ ───────────▶ │  Obra gruesa │ ───────────▶ │  Terminaciones │ ──▶ Entrega
└──────────────┘  docs OK ✓   └──────────────┘  docs OK ✓   └────────────────┘
```

## El ciclo de mejora continua (Planificar–Hacer–Verificar–Actuar)

Además de la etapa física, el DS 44 exige un **ciclo continuo de mejora**. La plataforma lo
organiza en cuatro fases que verás en la pestaña **DS44 — Cumplimiento** de cada obra:

| Fase | ¿Qué haces en la plataforma? |
| --- | --- |
| **Planificar** | Cargar la matriz de riesgos, la política, los procedimientos y los documentos base. |
| **Hacer** | Ejecutar capacitaciones, entregar EPP y registrar las actividades. |
| **Verificar** | Auditar, inspeccionar y dar seguimiento a indicadores e incidentes. |
| **Actuar** | Aplicar medidas correctivas y actualizar matrices y procedimientos. |

Una obra avanza **a la vez** en su etapa física (qué se construye) y en su ciclo de gestión
(cómo se gestiona la prevención). Ambas quedan registradas en el módulo de
[Obras](/modulos/obras).

::: info Configuración por empresa
Qué etapas y documentos aplican a una obra puede variar según la configuración de tu empresa.
Cada empresa puede personalizar qué se exige en cada etapa. Ver [Mi Empresa](/modulos/tenants).
:::

## Preguntas frecuentes

**¿La etapa física y el ciclo de mejora son lo mismo?**
No. La **etapa física** es el avance constructivo (excavación, obra gruesa…). El **ciclo de
mejora** (Planificar–Hacer–Verificar–Actuar) es cómo se gestiona la seguridad. Una obra
avanza en ambas dimensiones a la vez.

**¿Por qué no me deja avanzar de etapa?**
Porque faltan documentos obligatorios firmados en la etapa actual. Complétalos en la pestaña
**DS44 — Cumplimiento** de la obra y vuelve a intentar.

**¿Puedo volver a una etapa anterior?**
El avance de etapa está pensado para ir hacia adelante a medida que progresa la obra. Si
necesitas corregir algo, contacta a un administrador.
