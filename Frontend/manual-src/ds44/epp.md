# Entrega de EPP

La entrega de **Elementos de Protección Personal (EPP)** es una obligación central del
DS 44: la empresa debe proporcionar los EPP adecuados al riesgo de cada cargo y dejar
**registro firmado** de su entrega y recepción.

## El acta de entrega de EPP

En Build & Serve, cada entrega genera un documento de tipo `ENTREGA_EPP`. El acta
incluye:

- **Trabajador receptor**: nombre, RUT, cargo.
- **Listado de EPP entregados**: tipo, cantidad, fecha de entrega.
- **Cargo y riesgo asociado**: qué EPP corresponde según la MIPPER del cargo.
- **Doble firma**: del **trabajador** (recepción conforme) y del **supervisor**
  (entrega y verificación de uso correcto).

## Flujo de entrega

```
1. Supervisor crea el acta ENTREGA_EPP para un trabajador
        ↓
2. Se asigna al trabajador → notificación en su bandeja de entrada
        ↓
3. El trabajador firma la recepción (PIN o presencial)
        ↓
4. El supervisor firma la entrega
        ↓
5. El acta queda en estado "completado" en SignaturesTable (inmutable)
```

## Matriz de EPP por cargo

El tipo de EPP a entregar se deriva de la **MIPPER** del cargo del trabajador. La
matriz de riesgos define, para cada cargo y actividad, qué protección es obligatoria.
De este modo la entrega de EPP queda alineada con la evaluación de riesgos y no es
arbitraria.

| Ejemplo de cargo | EPP típico (según MIPPER) |
| --- | --- |
| Maestro albañil | Casco, guantes, calzado de seguridad, lentes |
| Operador de excavadora | Casco, protección auditiva, chaleco reflectante |
| Trabajador en altura | Arnés, casco con barbiquejo, línea de vida |
| Soldador | Máscara de soldar, guantes de cuero, coleto, polainas |

> Los valores son ilustrativos; la matriz real se configura por cargo en cada obra a
> través de la [MIPPER](/ds44/documentos-obligatorios).

## Trazabilidad ante fiscalización

Cada acta firmada queda registrada con PIN, fecha/hora y código de verificación, lo
que permite demostrar ante un fiscalizador:

- **Qué** EPP se entregó.
- **A quién** y en qué fecha.
- **Quién** autorizó y verificó la entrega.

Consulta el detalle del registro de firmas en
[Firmas digitales y DS44](/ds44/firmas-digitales).
