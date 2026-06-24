# Módulo: Firmas Digitales

**Ubicación:** `Frontend/src/components/SignaturePad.tsx` · `Backend/handlers/signatures/` · `lib/services/FirmaService`

Sistema de firma electrónica que opera en línea y en terreno (offline), con registro
inmutable de cada acto firmado.

::: warning Consulta legal pendiente
La validez jurídica del PIN como firma electrónica ante un fiscalizador del DS 44 está
siendo evaluada con la Dirección del Trabajo (acuerdo reunión CCHC 2026-06-10). **No
usar como única prueba legal** hasta tener respuesta oficial. La implementación actual
de `FirmaService` (PIN + token + IP + timestamp en `SignaturesTable`) **no debe
modificarse** hasta entonces. Ver [Firmas digitales y DS44](/ds44/firmas-digitales).
:::

## Estrategias de firma

`FirmaService` usa un patrón de estrategia con cuatro métodos:

| Estrategia | Código | Cuándo se usa |
| --- | --- | --- |
| PIN | `PIN` | Firma estándar con PIN personal |
| Offline | `OFFLINE` | Firma en terreno sin conexión |
| Presencial | `PRESENCIAL` | Firma asistida ante relator/supervisor |
| Biométrica | `BIOMETRIC` | Reservada (stub) — no implementada |

## Documento de obra vs. documento diario

| Aspecto | Documento de obra | Documento diario |
| --- | --- | --- |
| Origen | Precreado por fase (DS 44) | Creado y asignado a personas |
| Firma | Según el documento | Firma individual del asignado |
| Notificación | No se asigna individualmente | Genera mensaje en bandeja de entrada |
| Estado | Cumplimiento por fase | pendiente → firmado |

## Flujo de firma estándar (documento diario)

```
1. Prevencionista asigna el documento a una persona
        ↓
2. EventBus emite "document.assigned" → notificación en InboxTable
        ↓
3. La persona abre el documento y firma con su PIN
        ↓
4. FirmaService valida el PIN (pinHash) y registra la firma
        ↓
5. Registro inmutable en SignaturesTable (PIN + IP + timestamp)
        ↓
6. El estado de la asignación cambia a "firmado"
```

## Firma presencial del relator

En actividades como `CAPACITACION_SST` y `CHARLA_5MIN`, además de la firma de los
asistentes se requiere la **firma cruzada del relator**, que certifica que la actividad
se impartió efectivamente. Esto se registra con `tipoFirma: relator`.

## Firma offline en terreno

```
1. La persona firma en tablet/móvil sin conexión (SignaturePad)
        ↓
2. La firma se guarda cifrada (AES) en IndexedDB (cola local)
        ↓
3. Validación de identidad offline con hash de RUT + PIN temporal
        ↓
4. Al recuperar conexión: sincronización por lotes con reintentos exponenciales
        ↓
5. Resolución de conflictos por timestamp del servidor
        ↓
6. Registro definitivo en SignaturesTable
```

La app funciona como **PWA** con caché de recursos críticos, y muestra alertas visuales
sobre firmas pendientes de sincronizar.

## Registro inmutable (SignaturesTable)

```
signatureId / personaId / personaRut
tipoFirma         trabajador | relator | supervisor
referenciaId      Documento o actividad firmada
fecha / horario / timestamp
ipAddress
metodoValidacion  PIN | OFFLINE | PRESENCIAL | BIOMETRIC
estado            valida | disputada | anulada
```

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/signatures` | Registrar firma |
| `GET` | `/signatures/{id}` | Obtener firma |
| `POST` | `/signatures/offline-buffer` | Registrar firma capturada sin red |
| `GET` | `/signatures/offline-queue` | Consultar cola pendiente |
| `POST` | `/signatures/offline-sync` | Sincronizar lote |
| `DELETE` | `/signatures/offline-queue/{id}` | Limpiar elemento procesado |

Ver detalle en [API · Firmas](/api/firmas).
