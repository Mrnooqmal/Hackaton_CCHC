# PoC EBCO — Uso, volumen y costo de infraestructura

Informe del uso real y del costo de operación de la plataforma durante la marcha blanca con EBCO S.A.

| | |
|---|---|
| **Empresa** | EBCO S.A |
| **Entorno** | Producción |

---

## 1. Resumen

| Pregunta | Respuesta |
|---|---|
| ¿Cuántas personas la usaron? | **29 dadas de alta, 27 accedieron al menos una vez, 25 firmaron documentos** |
| ¿Cuántos registros se generaron? | **784 registros operativos** (1.507 incluyendo notificaciones internas) |
| ¿En qué período? | **22 de junio → 3 de septiembre de 2026** (74 días, ~10 semanas) |
| ¿Cuánto cuesta operarla hoy? | **US$0,11 al mes** cuando solo está en uso · entre **US$3 y US$11 al mes** en meses con desarrollo activo. El 96% del gasto lo genera publicar versiones nuevas, no el uso de la plataforma. |

---

## 2. Personas

29 personas cargadas en una sola empresa y una sola obra (*Espacio Escondido Taihuén*).

| Métrica | Valor |
|---|---:|
| Personas dadas de alta | 29 |
| Con acceso web, contraseña y PIN configurado | 29 |
| **Que accedieron al menos una vez** | **27** |
| Que nunca accedieron | 2 |
| Que firmaron al menos un documento | 25 |
| Que crearon registros (perfil administrador/supervisor) | 4 |

### Por rol

| Rol | Personas |
|---|---:|
| Persona trabajadora | 26 |
| Supervisor | 2 |
| Administrador | 1 |

### Altas y accesos por mes

| Mes | Altas | Personas cuyo último acceso cae en el mes | Firmantes distintos |
|---|---:|---:|---:|
| junio 2026 | 16 | 0 | 2 |
| julio 2026 | 0 | 13 | 15 |
| agosto 2026 | 13 | 12 | **23** |
| septiembre 2026 | 0 | 2 | 0 |

### Distribución horaria del uso

Las 449 firmas no están repartidas en el día: se concentran en la charla de cinco minutos antes de entrar a la obra.

| Hora (Chile, UTC−4) | Firmas | |
|---|---:|---|
| 07:00 | 8 | `#` |
| **08:00** | **121** | `########################` |
| 09:00 | 16 | `###` |
| 10:00 | 58 | `###########` |
| 11:00 | 19 | `###` |
| 12:00 | 28 | `#####` |
| 13:00 | 21 | `####` |
| 14:00 | 1 | |
| 15:00 | 62 | `############` |
| 16:00 | 21 | `####` |
| 17:00 | 69 | `#############` |
| 18:00 | 11 | `##` |
| 23:00 | 14 | `##` (firmas hechas sin señal, que se sincronizan más tarde) |

- El **27% de todas las firmas ocurre entre las 08:00 y las 09:00**.
- Una ventana de 07:30 a 18:30 cubre el **97%** de la actividad.
- **Cero actividad en sábado y domingo** durante las 10 semanas.

---

## 3. Registros generados

**784 registros operativos**, más 723 notificaciones internas = **1.507 escrituras totales** atribuibles a EBCO.

### Por tabla y por mes

| Tabla | jun | jul | ago | sep | **Total** |
|---|---:|---:|---:|---:|---:|
| signatures (firmas) | 9 | 241 | 199 | — | **449** |
| documents | 116 | 9 | 101 | — | **226** |
| activities | 1 | 21 | 17 | — | **39** |
| personas | 16 | — | 13 | — | **29** |
| incidents | 1 | 11 | 10 | — | **22** |
| sugerencias | 7 | 5 | — | — | **12** |
| signature-requests | 4 | — | — | — | **4** |
| ausencias | — | — | 2 | — | **2** |
| obras | 1 | — | — | — | **1** |
| epp | — | — | — | — | **0** |
| estructura-preventiva | — | — | — | — | **0** |
| **Subtotal operativo** | **155** | **287** | **342** | **0** | **784** |
| inbox (notificaciones) | 125 | 326 | 272 | — | **723** |
| **Total** | **280** | **613** | **614** | **0** | **1.507** |

La fecha de corte es el campo `createdAt` de cada registro.

### Detalle cualitativo

| | |
|---|---|
| **Obras** | 1 — Espacio Escondido Taihuén |
| **Documentos** | 226, todos en estado activo (Política SST, MIPER, Mapa de Riesgos, Matriz Legal, Plan de Emergencias, RIHS, IRL, Trabajos en Altura, entre otros) |
| **Firmas** | 449, ≈2 por documento |
| **Actividades** | 39 — 35 charlas de 5 minutos + 4 capacitaciones |
| **Incidentes** | 22 — 20 condiciones subestándar + 2 incidentes |
| **Sugerencias / tickets** | 12 — 5 defectos, 6 mejoras, 1 consulta normativa |

### Distribución semanal

```
22-jun  ████████████████  280   ← alta de la empresa + carga documental inicial
29-jun  ████               71
06-jul  ███████████       196
13-jul  █████             100
20-jul  ████               76
27-jul  █████████         170
03-ago  ███                53
10-ago  ██████████████████ 319  ← alta de 13 personas + su documentación
17-ago  ██████            121
24-ago  █████             104
31-ago  █                  17
```

---

## 4. Período

| Hito | Fecha |
|---|---|
| Creación de la empresa en la plataforma | **2026-06-22** |
| Primer registro operativo | 2026-06-22 |
| Segunda ola de altas (13 personas) | 2026-08-11 |
| Último registro creado | **2026-08-31** |
| Último ingreso de un usuario | **2026-09-03** (cuenta administradora) |
| **Duración total** | **74 días · ~10 semanas** |

---

## 5. Módulos de apoyo (14)

La plataforma tiene 29 módulos. Quince cubren directamente exigencias del DS 44 —empresas, obras, personas, documentos, firmas, actividades, incidentes, estructura preventiva, EPP, ausencias, encuestas de salud, avance de cumplimiento, solicitudes de firma, bandeja de mensajes y acceso—. Los **14 restantes son módulos de apoyo**: no responden a una exigencia por sí mismos, sino que hacen posible que los otros funcionen.

| # | Módulo | Para qué sirve | Uso durante la marcha blanca |
|---|---|---|---|
| 1 | **Permisos y roles** | Define qué puede ver y hacer cada persona según su cargo | 12 permisos activos en la cuenta administradora |
| 2 | **Estampado de PDF** | Inserta la firma en el documento que se descarga | 449 documentos estampados |
| 3 | **Subida y almacenamiento** | Permite cargar y descargar documentos y fotos de forma segura | 242 MB almacenados |
| 4 | **Prescripciones** | Registra las prescripciones de organismos fiscalizadores | Sin uso |
| 5 | **Cargos e incorporación** | Catálogo de cargos y flujo de ingreso de una persona nueva | 8 cargos usados |
| 6 | **Notificaciones por correo** | Envía los avisos por email | 70 destinatarios en el período |
| 7 | **Notificaciones por SMS** | Envía los avisos por mensaje de texto | Activo, US$0,52 acumulado |
| 8 | **Sugerencias** | Canal de comentarios disponible en cada pantalla | **12 reportes de EBCO** |
| 9 | **Transcripción por voz** | Permite dictar una actividad en terreno en vez de escribirla | Disponible |
| 10 | **Alertas automáticas** | Avisa por convocados sin firmar, estructura preventiva y documentos por revisar | ~1.500 revisiones al mes |
| 11 | **Comunicación entre módulos** | Coordina internamente las acciones que dependen unas de otras | Transversal |
| 12 | **Manual de usuario** | Documentación de uso dentro de la propia plataforma | Disponible |
| 13 | **Registro y programa preventivo** | Genera el Registro de Actividad Preventiva y el Programa de Trabajo Preventivo | En uso |
| 14 | **Panel y configuración** | Tablero de avance, preferencias y datos de la empresa | Uso diario del administrador |

---

## 6. Costo mensual de infraestructura

### 6.1 Alcance

Este cálculo cubre **los servicios que construyen y sirven la plataforma** (*build and serve*).

| Servicio | Qué aporta |
|---|---|
| **AWS Config** | Servicio de auditoría: anota cada modificación hecha a la plataforma. Su costo lo generan las publicaciones de versiones nuevas. |
| **S3** | Artefactos de despliegue, documentos, evidencias y frontend |
| **API Gateway** | Entrada HTTP de la API |
| **Lambda** | Ejecución de las ~70 funciones |
| **DynamoDB** | Las 15 tablas de datos |
| **CloudFront** | Entrega del frontend |
| **SQS** | Cola de estampado de PDF firmados |
| **SNS y End User Messaging** | Notificaciones y SMS |
| **SES** | Correos transaccionales |
| **KMS** | Cifrado |
| **CloudWatch** | Logs y métricas |
| **IVA 19%** | Proporcional a lo anterior |

El almacenamiento de archivos se calculó a partir del volumen real ocupado por la plataforma, medido mes a mes:

| Mes | Archivos almacenados |
|---|---:|
| mayo | 0,649 GB |
| junio | 1,644 GB |
| julio | 2,236 GB |
| agosto | 2,379 GB |

### 6.2 Costo de la plataforma por mes y servicio (USD, sin IVA)

| Servicio | may | jun | jul | ago | sep (parcial) | **Promedio** |
|---|---:|---:|---:|---:|---:|---:|
| **AWS Config** | 2.8320 | 14.3580 | 4.2300 | 0.0090 | 4.0890 | **6.1990** |
| End User Messaging (SMS) | — | 0.3107 | 0.2071 | — | — | **0.1726** |
| Amazon S3 | 0.0017 | 0.0234 | 0.0476 | 0.0538 | 0.0202 | **0.0416** |
| API Gateway | 0.0133 | 0.0631 | 0.0276 | 0.0117 | 0.0164 | **0.0341** |
| DynamoDB | 0.0021 | 0.0196 | 0.0101 | 0.0136 | 0.0065 | **0.0144** |
| SES | — | 0.0066 | 0.0008 | 0.0001 | 0.0003 | **0.0025** |
| KMS | 0.0002 | 0.0006 | 0.0007 | 0.0006 | 0.0000 | **0.0006** |
| CloudWatch | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | **0.0000** |
| Lambda | — | — | — | — | — | **0.0000** |
| CloudFront | — | — | — | — | — | **0.0000** |
| SQS | — | — | — | — | — | **0.0000** |
| SNS | — | — | — | — | — | **0.0000** |
| **Subtotal neto** | **2.8493** | **14.7820** | **4.5239** | **0.0888** | **4.1324** | **6.4649** |
| IVA 19% | 0.5414 | 2.8086 | 0.8595 | 0.0169 | 0.7852 | **1.2283** |
| **TOTAL** | **3.3907** | **17.5906** | **5.3834** | **0.1057** | **4.9176** | **7.6932** |

**Participación de cada servicio en el promedio mensual:**

| Servicio | % del costo |
|---|---:|
| AWS Config | **95,9%** |
| SMS | 2,7% |
| S3 | 0,6% |
| API Gateway | 0,5% |
| DynamoDB | 0,2% |
| SES + KMS + CloudWatch | 0,05% |
| Lambda, CloudFront, SQS, SNS | 0% |

### 6.3 Servicios que no generan cobro

Estos servicios tienen un volumen de uso gratuito mensual que la plataforma no alcanza a consumir. Medición de agosto, el mes de mayor uso:

| Servicio | Para qué se usa | Consumo | Límite gratuito | Uso del límite |
|---|---|---|---:|
| **Lambda** | Ejecuta la lógica de la aplicación | 12.570 ejecuciones | 1 millón al mes | 1,3% |
| **CloudFront** | Entrega la página web a los usuarios | 1.842 visitas · 1,45 GB | 10 millones · 1 TB | 0,02% |
| **SQS** | Gestiona la firma de los PDF | 569.009 operaciones | 1 millón al mes | 57% |
| **SNS** | Envía los SMS | 295 envíos | 1 millón al mes | 0,03% |
| **Base de datos** | Guarda toda la información | 1,44 MB en 15 tablas | 25 GB | 0,006% |
| **CloudWatch** | Registra la actividad del sistema | 32 MB | 5 GB | 0,6% |

Consumo a lo largo del período:

| Métrica | may | jun | jul | ago | sep (parcial) |
|---|---:|---:|---:|---:|---:|
| Ejecuciones de la aplicación | 9.649 | 51.023 | 23.980 | 12.570 | 15.191 |
| Llamadas a la API | 13.324 | 63.138 | 27.618 | 11.650 | 16.411 |
| Lecturas de la base de datos | 9.132 | 44.678 | 45.750 | 80.798 | 42.965 |
| Escrituras en la base de datos | 1.493 | 22.398 | 7.044 | 5.551 | 1.814 |
| Operaciones de firma de PDF | 0 | 0 | 147.743 | 534.763 | 177.542 |
| Visitas a la página web | 237 | 4.665 | 2.856 | 1.835 | 304 |

### 6.4 El servicio que concentra el 96% del costo

**AWS Config** es un servicio de auditoría: anota cada modificación que se hace a la plataforma y cobra **US$0,003 por anotación**.

Cada vez que se publica una nueva versión del sistema, se actualizan unos 90 componentes a la vez —la lógica de la aplicación, las tablas de datos, los permisos— y cada uno genera su propia anotación. De ahí que publicar una versión cueste entre US$1 y US$3.

| Mes | Anotaciones | Costo | Días en que se publicó una versión |
|---|---:|---:|---:|
| mayo (desde el día 12) | 944 | $2.83 | 4 |
| junio | 4.786 | $14.36 | 19 |
| julio | 1.410 | $4.23 | 6 |
| **agosto** | **3** | **$0.01** | **0** |
| septiembre (11 días) | 1.363 | $4.09 | 4 |
| **Total** | **8.506** | **$25.52** | **33** |

Agosto lo demuestra con claridad: un mes entero de uso real —342 registros, 199 firmas, 23 personas firmando— sin publicar ninguna versión nueva, costó **US$0,01**. La diferencia entre $0,01 y $14 no la produce el uso de la plataforma, la produce la frecuencia con que se publican versiones nuevas.

Días de mayor gasto:

| Fecha | Anotaciones | Costo | |
|---|---:|---:|---|
| 2026-06-14 | 971 | $2.91 | |
| 2026-06-21 | 661 | $1.98 | |
| 2026-06-15 | 607 | $1.82 | |
| 2026-06-22 | 553 | $1.66 | día del alta de EBCO |
| 2026-07-22 | 383 | $1.15 | |
| 2026-09-07 | 402 | $1.21 | |
| 2026-09-09 | 360 | $1.08 | |
| 2026-09-06 | 357 | $1.07 | |

### 6.5 Almacenamiento de archivos

| Contenedor | Tamaño | Archivos | Qué guarda |
|---|---:|---:|---|
| Versiones publicadas del sistema | **2,77 GB** | 546 | Cada versión que se ha publicado |
| Documentos de producción | 167,2 MB | 112 | **Documentos reales de EBCO** |
| Evidencias de producción | 75,1 MB | 23 | **Fotos de incidentes de EBCO** |
| Documentos de pruebas | 15,2 MB | 88 | Datos descartables |
| Sitio web | 5,9 MB | 45 | La página que ven los usuarios |
| Evidencias de pruebas | 1,1 MB | 2 | Datos descartables |
| **Total plataforma** | **~3,04 GB** | **816** | |

**El 91% del almacenamiento corresponde al historial de versiones publicadas, no a información de clientes.** Los documentos y fotos reales de EBCO suman 242 MB ≈ US$0,006 al mes.

Ese historial crece sin parar —0,15 GB en abril, 0,60 en mayo, 1,45 en junio, 2,01 en julio, 2,13 en agosto— porque las versiones antiguas nunca se borran automáticamente.

### 6.6 Base de datos

Las 15 tablas de datos se pagan por uso y suman **1,44 MB**, muy por debajo de los 25 GB que AWS entrega sin cobro.

| Tabla | Registros | Tamaño |
|---|---:|---:|
| Mensajes | 752 | 433,9 KB |
| Firmas | 457 | 307,3 KB |
| Documentos | 239 | 355,1 KB |
| Actividades | 87 | 154,3 KB |
| Personas | 38 | 72,1 KB |
| Incidentes | 22 | 25,1 KB |
| Sugerencias | 16 | 6,2 KB |
| Solicitudes de firma | 6 | 8,6 KB |
| Obras | 4 | 4,7 KB |
| Empresas | 3 | 70,7 KB |
| Ausencias | 2 | 1,0 KB |
| Encuestas | 1 | 1,2 KB |
| EPP | 0 | 0 |
| Estructura preventiva | 0 | 0 |
| Sesiones | 0 | 0 |

---

## 7. Los tres escenarios

Costos de infraestructura AWS de la plataforma. Todos los valores en USD mensuales **con IVA incluido**.

### Escenario A — Operar

Mantener la plataforma en funcionamiento, disponible para EBCO y para incorporar nuevas empresas.

| Concepto | Operación estable | Con desarrollo activo |
|---|---:|---:|
| Auditoría de cambios (publicar versiones) | 0.009 | 2.600 – 9.100 |
| Almacenamiento de archivos | 0.054 | 0.054 |
| Entrada de la aplicación | 0.012 | 0.017 |
| Base de datos | 0.014 | 0.014 |
| SMS y correo | 0.000 – 0.310 | 0.000 – 0.310 |
| Cifrado y registro de actividad | 0.001 | 0.001 |
| Ejecución, sitio web, colas y avisos | 0.000 | 0.000 |
| Subtotal neto | 0.090 | 2.690 – 9.500 |
| IVA 19% | 0.017 | 0.511 – 1.805 |
| **TOTAL MENSUAL** | **US$0,11** | **US$3,20 – 11,30** |

Referencias de contraste: el mes más barato observado fue agosto con **US$0,11**; la proyección de AWS para septiembre completo es **US$11,27**; y la cifra intermedia de los tres meses completos es **US$5,38**.

**Ahorros posibles sin cambiar nada del servicio:**

| Acción | Ahorro mensual | Esfuerzo |
|---|---:|---|
| Reducir el detalle de la auditoría de cambios, o pasarla a revisión diaria en vez de continua | hasta US$9 | Ajuste de configuración de la cuenta |
| Borrar automáticamente las versiones publicadas con más de 30 días | US$0,06 | Ajuste puntual |
| Limitar a 30 días el registro histórico de actividad del sistema | preventivo | Ajuste puntual |
| Ajustar la frecuencia de revisión de la cola de firma de PDF | preventivo | Ajuste puntual |

Aplicando los dos primeros, **operar con desarrollo activo baja a ~US$1,50 al mes**, y la operación estable a **US$0,04**.

### Escenario B — Pausa

Conservar toda la información y las direcciones web funcionando, sin usuarios activos ni versiones nuevas. La plataforma queda lista para retomarse en minutos.

| Concepto | Costo |
|---|---:|
| Almacenamiento de archivos (2,38 GB) | 0.054 |
| Base de datos (1,44 MB) | 0.000 (sin cobro) |
| Tareas automáticas (~1.500 revisiones al mes) | 0.000 (sin cobro) |
| Consultas de esas tareas a la base de datos | 0.001 |
| Direcciones web activas sin visitas | 0.000 |
| Auditoría de cambios (no hay cambios) | 0.000 |
| Subtotal neto | 0.055 |
| IVA 19% | 0.010 |
| **TOTAL MENSUAL** | **US$0,07** |

**Acciones para entrar en pausa:**
1. Apagar las tres tareas automáticas de alertas.
2. Borrar el historial de versiones publicadas → baja a **US$0,02 al mes**.
3. No publicar versiones nuevas: cada publicación reactiva el costo de auditoría.

**Con pausa y limpieza: US$0,02 al mes (~$19 CLP).** Salir de la pausa no tiene costo de reactivación.

### Escenario C — Apagar

Dar de baja la plataforma, guardando una copia completa de toda la información de EBCO.

| Concepto | Costo |
|---|---:|
| Guardar la copia de respaldo (243 MB: documentos, fotos y datos) en almacenamiento de archivo profundo | 0.0003 |
| Todo lo demás | 0.000 |
| **TOTAL MENSUAL** | **< US$0,01** |

**Costo único de ejecución: ~US$4.** Desmontar la plataforma implica dar de baja unos 70 componentes, y ese desmontaje queda registrado y se cobra una sola vez.

**Pasos del apagado:**

| # | Paso |
|---|---|
| 1 | Exportar toda la información de las 15 tablas de datos (1,44 MB) |
| 2 | Descargar los documentos y las fotos de incidentes (242 MB) |
| 3 | Verificar que la copia esté completa y se pueda abrir |
| 4 | Guardar la copia en almacenamiento de archivo de largo plazo |
| 5 | Desmontar el entorno de desarrollo |
| 6 | Desmontar el entorno de producción |
| 7 | Eliminar los datos y archivos que quedan guardados por seguridad |
| 8 | Dar de baja las dos direcciones web públicas |

**Dos puntos importantes antes de ejecutarlo:**

- **El paso 3 es bloqueante.** Mientras no esté verificada la copia de respaldo, no se avanza al paso 5. Los pasos 7 y 8 son irreversibles.
- **Desmontar la plataforma no borra los datos por sí solo.** Están configurados a propósito para sobrevivir a un desmontaje accidental, de modo que la información de EBCO no se pierda por error. Eliminarlos es una decisión aparte y deliberada, posterior a validar el respaldo.

### Comparación

| Escenario | Costo mensual | Información | Tiempo para retomar |
|---|---:|---|---|
| A. Operar — con desarrollo activo | US$3,20 – 11,30 | Disponibles | — |
| A. Operar — estable, sin versiones nuevas | US$0,11 | Disponibles | — |
| **A. Operar — estable y optimizado** | **US$0,04** | Disponibles | — |
| **B. Pausa** (con limpieza) | **US$0,02** | Disponibles e intactos | Inmediata |
| **C. Apagar** | **< US$0,01** | Solo en la copia de respaldo | Días |

La diferencia entre operar de forma estable, pausar y apagar es de **centavos de dólar al mes**. El único costo relevante es la frecuencia con que se publican versiones nuevas: **el 96% del gasto promedio corresponde a la auditoría de esas publicaciones**. El costo real de esta plataforma no está en la infraestructura, sino en el tiempo de las personas que la mantienen.
