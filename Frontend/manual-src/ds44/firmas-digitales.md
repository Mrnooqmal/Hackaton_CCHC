# Firmas digitales y DS 44

El DS 44 exige que los registros de seguridad estén **firmados y disponibles** ante una
fiscalización. La plataforma digitaliza la firma manteniendo, por cada acto firmado, una
**evidencia verificable**: quién firmó, cuándo y desde dónde.

::: warning Consulta legal pendiente
La **validez jurídica del PIN como firma electrónica** ante un fiscalizador del DS 44 está
siendo evaluada con la Dirección del Trabajo. La funcionalidad opera con normalidad y deja
trazabilidad completa, pero **por ahora no debe usarse como única prueba legal** hasta tener
la respuesta oficial.
:::

## Formas de firmar

La plataforma ofrece distintas formas de firmar según la situación:

| Forma | ¿Cuándo se usa? |
| --- | --- |
| **PIN** | Firma estándar: la persona confirma con su PIN personal de 4 dígitos. |
| **Offline** | Firma en terreno **sin conexión**, que se sincroniza al recuperar la red. |
| **Presencial** | Firma asistida ante un relator o supervisor presente. |

## Un registro que no se altera

Cada firma queda guardada como un **registro que no se modifica ni se elimina**. Por cada
firma se conserva, entre otros datos:

- **Quién firmó** (nombre y RUT).
- **Qué firmó** (el documento o la actividad).
- **Fecha y hora** exactas.
- **Desde dónde** se firmó.
- Un **código de verificación** que permite comprobar la autenticidad.

> 🔒 Esta combinación de **PIN + fecha/hora + verificación** es la evidencia que la
> plataforma conserva por cada firma, y es lo que da respaldo al cumplimiento.

## Firma sin conexión en terreno

Como muchas obras tienen mala señal, la firma puede capturarse **sin internet** y
sincronizarse después:

```
1. La persona firma en el celular o tablet, sin conexión
        ↓
2. La firma se guarda de forma segura en el dispositivo
        ↓
3. Al recuperar la señal, se sincroniza automáticamente con el sistema
```

Cómo usarlo en el día a día, en el módulo de [Firmas Digitales](/modulos/firmas).

## Quién firma según el documento

| Situación | Quién firma |
| --- | --- |
| Documento de obra (DS 44) | Prevencionista y/o Trabajador, según el documento |
| Entrega de EPP | Trabajador + Supervisor |
| Capacitación SST | Asistentes + Relator |
| Documento diario asignado | La persona asignada |

## Estado de una firma

Una firma normalmente está **Válida** (es la evidencia activa de cumplimiento). Si su
autenticidad se cuestiona, puede quedar marcada como **Disputada**, y si se invalida
formalmente, como **Anulada**. En todos los casos el registro original **se conserva**, para
no perder la trazabilidad que exige el DS 44.

## Preguntas frecuentes

**¿El PIN tiene validez legal?**
Su validez ante un fiscalizador está en evaluación (ver el aviso arriba). La firma funciona y
deja trazabilidad completa, pero por ahora no debe ser la única prueba legal.

**¿Puedo firmar sin internet?**
Sí. Usa la firma **offline**: se guarda en tu dispositivo y se sincroniza sola cuando vuelvas
a tener señal.

**Una firma quedó como "disputada". ¿Se borró la original?**
No. El registro original se conserva siempre. Los estados "disputada" o "anulada" solo dejan
constancia de la controversia, sin eliminar la evidencia.
