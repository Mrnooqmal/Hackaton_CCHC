# Firmas digitales y DS 44

El DS 44 exige que los registros de seguridad estén **firmados y disponibles** ante una
fiscalización. La plataforma reemplaza la firma en papel por una firma con PIN y guarda, por
cada acto firmado, una **evidencia verificable**: quién firmó, qué, cuándo y desde dónde.

::: warning Consulta legal pendiente
La **validez jurídica del PIN como firma electrónica** ante un fiscalizador del DS 44 está
siendo evaluada con la Dirección del Trabajo. La firma funciona y deja trazabilidad completa,
pero **por ahora no debe usarse como única prueba legal** hasta tener la respuesta oficial.
:::

## Formas de firmar

| Forma | ¿Cuándo se usa? |
| --- | --- |
| **PIN propio** | La persona firma desde su sesión, con su PIN de 4 dígitos. |
| **Firma asistida** | La persona firma en el equipo de un supervisor, escribiendo **su** PIN. |
| **Firma del relator** | El relator certifica que la capacitación se realizó, además de los asistentes. |

## Un registro que no se altera

Cada firma queda guardada como un registro que **no se modifica ni se borra**. Se conserva:

- **Quién firmó** (nombre y RUT).
- **Qué firmó** (el documento, la actividad o la encuesta).
- **Fecha y hora** exactas.
- **Desde dónde** se firmó.
- Una **huella del contenido firmado**, que permite demostrar que el documento no cambió
  después de la firma.
- Un **token de verificación** para comprobar su autenticidad.

## Cuando un documento cambia, se vuelve a firmar

Si se publica una **nueva versión** de un documento firmado (por ejemplo, la matriz de
riesgos o un procedimiento), las firmas de la versión anterior **quedan en el historial pero
dejan de valer para la nueva**: quienes la habían firmado deben firmarla otra vez. La
plataforma se los pide automáticamente. Ver [Documentos](/modulos/documentos#publicar-una-nueva-versión).

## Firmar requiere conexión

Por ahora, firmar requiere conexión a internet. Una firma que no llega al servidor no se da
por hecha.

## Quién firma según el documento

| Situación | Quién firma |
| --- | --- |
| Documento de la obra (matriz, procedimientos…) | Las personas a quienes se asigna |
| Programa de Trabajo Preventivo | El **representante legal** de la empresa |
| Reglamento Interno y Política SST | Cada persona, al recibirlos en su onboarding |
| Entrega de EPP | El trabajador, **después** de que un validador confirma la entrega |
| Capacitación | Cada asistente y el relator |
| Encuesta | Quien la responde |

## Estado de una firma

Una firma normalmente está **Válida**. Si su autenticidad se cuestiona, puede quedar como
**Disputada**, y si se invalida formalmente, como **Revocada**. En todos los casos el registro
original **se conserva**.

## Firmas con el PIN equivocado

Después de varios intentos fallidos, la firma de esa persona **se bloquea por un tiempo que
crece con cada nuevo error**. Así nadie puede probar PIN al azar hasta acertar.

## Preguntas frecuentes

**¿El PIN tiene validez legal?**
Está en evaluación (ver el aviso arriba). La firma funciona y deja trazabilidad completa, pero
por ahora no debe ser la única prueba legal.

**¿Puede alguien firmar por mí?**
No. La firma asistida solo presta el equipo: el PIN lo escribes tú, y nadie puede verlo.

**Una firma quedó como "disputada". ¿Se borró la original?**
No. El registro original se conserva siempre.
