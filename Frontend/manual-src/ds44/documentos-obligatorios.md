# Documentos obligatorios DS 44

El DS 44 exige que cada obra mantenga un conjunto de documentos vigentes y firmados.
Build & Serve los **precrea automáticamente** al crear una obra, según las fases
configuradas para el tenant (`tenant.reglas.fasesObligatorias`). Cada documento queda
clasificado, asignado a una fase y con su flujo de firma definido.

## Catálogo de documentos

| Código | Nombre | Fase típica | Quién firma | Obligatorio |
| --- | --- | --- | --- | --- |
| `IRL` | Informe de Riesgos Laborales | Todas | Prevencionista + Trabajador | ✅ |
| `POLITICA_SSO` | Política de Seguridad y Salud Ocupacional | Excavación (inicio) | Admin / Jefe de Obra | ✅ |
| `REGLAMENTO_INTERNO` | Reglamento Interno de Orden, Higiene y Seguridad | Excavación (inicio) | Trabajador (recepción) | ✅ |
| `PROCEDIMIENTO_TRABAJO` | Procedimiento de Trabajo Seguro | Obra gruesa | Supervisor + Trabajador | ✅ |
| `ENTREGA_EPP` | Acta de Entrega de EPP | Todas | Trabajador + Supervisor | ✅ |
| `ENCUESTA_SALUD` | Encuesta / Declaración de Salud | Excavación (ingreso) | Trabajador | ✅ |
| `CAPACITACION_SST` | Registro de Capacitación SST (Art. 16) | Todas | Relator + Asistentes | ✅ |
| `MAPA_RIESGOS` | Mapa de Riesgos de la obra | Obra gruesa | Prevencionista | ✅ |
| `MIPPER` | Matriz de Identificación de Peligros y Evaluación de Riesgos | Todas (por cargo) | Prevencionista | ✅ |

> Los códigos corresponden al campo `tipoDS44` de la tabla `DocumentosTable`. Consulta
> [Base de datos](/arquitectura/base-de-datos) para el esquema completo.

## Clasificación: documentos de obra vs. diarios

Cada documento tiene un campo `clasificacion` que determina su comportamiento:

### Documentos de obra (`clasificacion: "obra"`)

- Son los **obligatorios por fase** según el DS 44.
- Se **precrean** al crear la obra, basándose en `fasesConfig`.
- Accesibles desde la **zona central de documentos** de la obra.
- Su cumplimiento se agrega por fase (porcentaje completado).
- No se asignan individualmente: son documentos de referencia que deben existir y
  estar firmados para cumplir la normativa.

### Documentos de uso diario (`clasificacion: "diario"`)

- Se **crean y asignan** a personas específicas según necesidad.
- Al asignarse, el `EventBus` emite `document.assigned` y genera una notificación en la
  bandeja de entrada de cada persona.
- Aparecen como **pendientes** en el dashboard del trabajador.
- Requieren **firma individual** (PIN o presencial).
- Tienen fecha límite opcional; si vencen, su estado pasa a `vencido`.

## Estado de cumplimiento

Cada documento avanza por los siguientes estados:

```
borrador → activo → completado
                  ↘ vencido (si pasa la fecha límite sin firmar)
```

El cumplimiento de una fase se calcula como el porcentaje de documentos obligatorios
de esa fase que se encuentran en estado `completado`. Al intentar
[avanzar de fase](/ds44/fases-obra), la plataforma verifica que la fase anterior esté
completa.

::: tip Generación asistida
La matriz `MIPPER` puede generarse con ayuda del [Asistente IA](/modulos/asistente-ia),
que propone peligros, riesgos y medidas de control por cargo a partir de la normativa
vigente. El prevencionista revisa, ajusta y firma el resultado.
:::
