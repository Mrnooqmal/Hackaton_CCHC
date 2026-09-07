# Documentos obligatorios DS 44

El DS 44 exige que cada obra mantenga un conjunto de documentos **vigentes y firmados**.
La plataforma los **prepara automáticamente** al crear una obra, según las características que
marcaste. Cada documento queda asociado a su etapa y con su flujo de firma definido, listo
para que subas el archivo y recojas las firmas.

## Catálogo de documentos

Estos son los documentos obligatorios que la plataforma gestiona:

| Documento | ¿Para qué sirve? | ¿Cuándo? | Quién firma |
| --- | --- | --- | --- |
| **Informe de Riesgos Laborales (IRL)** | Informa al trabajador de los riesgos de su labor | Todas las etapas | Prevencionista + Trabajador |
| **Política de Seguridad y Salud Ocupacional** | Declara el compromiso de la empresa con la seguridad | Al inicio | Administrador / Jefe de Obra |
| **Reglamento Interno de Orden, Higiene y Seguridad** | Normas internas de la empresa | Al inicio | Trabajador (recepción) |
| **Procedimiento de Trabajo Seguro** | Cómo realizar una tarea de forma segura | Durante la ejecución | Supervisor + Trabajador |
| **Acta de Entrega de EPP** | Constancia de entrega de elementos de protección personal | Todas las etapas | Trabajador + Supervisor |
| **Encuesta / Declaración de Salud** | Información de salud del trabajador al ingresar | Al ingreso | Trabajador |
| **Registro de Capacitación SST (Art. 16)** | Evidencia de capacitaciones realizadas | Todas las etapas | Relator + Asistentes |
| **Mapa de Riesgos de la obra** | Identifica los riesgos por zona de la obra | Durante la ejecución | Prevencionista |
| **Matriz de Riesgos (MIPER / MIPPER)** | Identifica peligros y evalúa riesgos por cargo | Todas (por cargo) | Prevencionista |
| **Programa de Trabajo Preventivo** | Medidas preventivas y correctivas que salen de la MIPER, con plazos y responsables | Dentro de 30 días desde la MIPER | Representante Legal |

> No tienes que recordar esta lista de memoria: al crear la obra, estos documentos
> aparecen solos en la pestaña **DS44 — Cumplimiento** de la obra, esperando que los completes.

## La MIPER y el Programa de Trabajo van juntos

Estos dos documentos están enlazados por el DS 44, y la plataforma te avisa si se
desalinean:

- **Al reemplazar el archivo de la MIPER se publica una versión nueva.** Se te pide
  el motivo del cambio, la versión anterior queda guardada en el historial, se avisa
  a la línea de mando y **las firmas anteriores dejan de valer**: quien la había
  firmado debe firmarla de nuevo.
- **A partir de esa fecha corren 30 días** para actualizar el Programa de Trabajo
  Preventivo. La fila del programa te muestra cuántos días quedan, y avisa en rojo
  si el plazo se pasó.
- **El Programa lo aprueba el representante legal.** Se designa una sola vez en
  *Mi Empresa → Identidad*, y la aprobación se registra cuando esa persona firma
  el documento. Sin designarlo, el programa no puede quedar aprobado.

> Cualquiera de los documentos de la obra guarda quién subió cada versión y cuándo:
> ábrelo desde el menú **⋮ → Historial de cambios**.

## Dos tipos de documentos

La plataforma maneja dos clases de documentos, según cómo se usan:

### Documentos base de la obra

- Son los **obligatorios** que exige el DS 44 para la obra.
- Se **preparan solos** al crear la obra.
- Deben existir y estar firmados para cumplir la normativa.
- Su avance se mide como un **porcentaje completado** por etapa.

### Documentos de uso diario

- Se **crean y asignan** a personas específicas según se necesite.
- Al asignarlos, la persona recibe un aviso en su [Bandeja de Entrada](/modulos/bandeja-entrada)
  y le aparecen como **pendiente** en su [Dashboard](/modulos/dashboard).
- Requieren **firma individual** (con PIN o presencial).
- Pueden tener **fecha límite**; si vence sin firmar, quedan marcados como vencidos.

## Estado de cada documento

Un documento avanza así:

```
Borrador  →  Activo  →  Completado
                    ↘  Vencido (si pasa la fecha límite sin firmar)
```

El cumplimiento de una etapa se calcula según cuántos documentos obligatorios están
**completados**. Al intentar [avanzar de fase](/ds44/fases-obra), la plataforma verifica que
la etapa anterior esté completa.

::: tip Quién la elabora
La **matriz de riesgos** la elabora el prevencionista: identifica peligros, riesgos y
medidas de control por cargo, y firma el resultado.
:::

## Preguntas frecuentes

**¿Tengo que crear estos documentos uno por uno?**
No. Se preparan automáticamente al crear la obra. Tú solo subes el archivo de cada uno y
recoges las firmas.

**¿Qué pasa si me falta uno de estos documentos?**
La obra mostrará una alerta de **DS44 pendientes** y no podrás avanzar de etapa hasta
completarlo. Así te aseguras de no dejar vacíos de cumplimiento.

**¿Cuál es la diferencia entre un documento base y uno diario?**
Los **base** son los obligatorios de la obra y se preparan solos. Los **diarios** los creas y
asignas tú a personas concretas según la necesidad del día a día.

**¿Un documento puede vencer?**
Sí, los documentos de uso diario pueden tener fecha límite. Si vence sin firmar, quedan
marcados como vencidos y deberás regularizarlos.
