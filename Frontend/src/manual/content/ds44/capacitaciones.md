# Capacitaciones (Art. 16)

El DS 44, en línea con el **Artículo 16**, obliga a las empresas a **informar y
capacitar** oportuna y convenientemente a sus trabajadores sobre los riesgos de sus
labores, las medidas preventivas y los métodos de trabajo correctos. Toda capacitación
debe quedar **registrada y firmada**.

## Tipos de actividad formativa

Build & Serve gestiona estas actividades a través del módulo de
[Actividades](/modulos/actividades), con el campo `tipo`:

| Tipo | Código | Duración / Frecuencia | Descripción |
| --- | --- | --- | --- |
| Charla de 5 minutos | `CHARLA_5MIN` | Diaria | Charla preventiva breve antes de iniciar la jornada |
| Inducción | `INDUCCION` | Al ingreso | Inducción de seguridad para nuevos trabajadores |
| Capacitación SST | `CAPACITACION` | 8 horas (Art. 16) | Capacitación formal obligatoria sobre riesgos y prevención |
| Análisis de Riesgo del Trabajo | `ART` | Por tarea crítica | Identificación de riesgos antes de una actividad específica |

## Capacitación obligatoria de 8 horas

La capacitación formal del Art. 16 contempla un mínimo de **8 horas**. En la plataforma
queda como un documento `CAPACITACION_SST` con:

- **Relator**: persona que dicta la capacitación (`relatorId`).
- **Temario**: contenidos tratados.
- **Asistentes**: lista de trabajadores con su firma individual.
- **Firma del relator**: certifica que la capacitación se realizó.

## Flujo de registro y firma

```
1. Prevencionista programa la actividad (estado: programada)
        ↓
2. Se realiza la capacitación (estado: en_curso)
        ↓
3. Cada asistente firma su asistencia (PIN o presencial)
        ↓
4. El relator firma como responsable de la actividad
        ↓
5. La actividad queda completada con registro inmutable
```

## Firma cruzada del relator

Las capacitaciones (`CAPACITACION_SST`) y charlas (`CHARLA_5MIN`) usan **firma cruzada**:
no basta con la asistencia del trabajador, también se requiere la firma del relator que
valida que la actividad efectivamente se impartió. Esto refuerza la trazabilidad ante
fiscalización.

Ver el detalle del mecanismo en [Firmas](/modulos/firmas).

::: tip Certificados de asistencia
A partir del registro firmado, la plataforma puede generar constancias de asistencia
por trabajador, útiles para acreditar el cumplimiento del Art. 16 ante la mutualidad o
la Dirección del Trabajo.
:::
