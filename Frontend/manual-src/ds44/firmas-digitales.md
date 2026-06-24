# Firmas digitales y DS 44

El DS 44 exige que los registros de SST estén **firmados y disponibles** ante
fiscalización. Build & Serve digitaliza la firma manteniendo una cadena de evidencia
verificable para cada acto firmado.

::: warning Consulta legal pendiente
La **validez jurídica del PIN como firma electrónica** ante un fiscalizador del DS 44
está siendo evaluada con la Dirección del Trabajo y el proveedor de firma certificada
(acuerdo reunión CCHC 2026-06-10). La funcionalidad opera con normalidad, pero **no
debe usarse como única prueba legal** hasta obtener respuesta oficial.

La implementación actual (`FirmaService`: PIN + token + IP + timestamp en
`SignaturesTable`) **no debe modificarse** hasta entonces. Aplica a firmas de
documentos, firma asistida, firma cruzada de relator (`CAPACITACION_SST`) y validación
de entregas de EPP.
:::

## Estrategias de firma

`FirmaService` implementa un patrón de estrategia con cuatro métodos de validación
(`metodoValidacion`):

| Estrategia | Código | Uso |
| --- | --- | --- |
| PIN | `PIN` | Firma estándar con PIN personal de la persona |
| Offline | `OFFLINE` | Firma en terreno sin conexión, sincronizada después |
| Presencial | `PRESENCIAL` | Firma asistida ante un relator o supervisor presente |
| Biométrica | `BIOMETRIC` | Reservada (stub) — no implementada aún |

## Registro inmutable

Cada firma genera un registro en `SignaturesTable` que **no se modifica ni elimina**.
Los campos clave de evidencia son:

```
signatureId      Identificador único de la firma
personaId        Quién firmó
personaRut       RUT del firmante
tipoFirma        trabajador | relator | supervisor
referenciaId     Documento o actividad firmada
referenciaTipo   Tipo de la referencia
fecha / horario / timestamp   Marca temporal
ipAddress        IP desde la que se firmó
metodoValidacion PIN | OFFLINE | PRESENCIAL | BIOMETRIC
estado           valida | disputada | anulada
```

Esta tríada **PIN + IP + timestamp** constituye la evidencia mínima que la plataforma
conserva por cada firma.

## Firma offline en terreno

Las obras suelen tener conectividad limitada. El flujo offline garantiza que la firma
se capture igual y se sincronice al recuperar la red:

```
1. La persona firma en tablet/móvil sin conexión
        ↓
2. La firma se guarda cifrada (AES) en IndexedDB (cola local)
        ↓
3. Al recuperar conexión, se sincroniza por lotes con reintentos exponenciales
        ↓
4. Resolución de conflictos por timestamp del servidor
        ↓
5. Registro definitivo en SignaturesTable
```

Detalles operativos del módulo en [Firmas Digitales](/modulos/firmas).

## Tipos de firma según el documento

| Contexto | Quién firma | Tipo |
| --- | --- | --- |
| Documento de obra (DS 44) | Prevencionista / Trabajador | Según documento |
| Entrega de EPP | Trabajador + Supervisor | `trabajador`, `supervisor` |
| Capacitación SST | Asistentes + Relator | `trabajador`, `relator` |
| Documento diario asignado | Persona asignada | `trabajador` |

## Estados de una firma

```
valida ──▶ disputada (si se cuestiona su autenticidad)
       └─▶ anulada   (si se invalida formalmente)
```

Una firma `valida` es la evidencia activa de cumplimiento. Los estados `disputada` y
`anulada` permiten gestionar controversias sin borrar el registro original, preservando
la trazabilidad exigida por el DS 44.
