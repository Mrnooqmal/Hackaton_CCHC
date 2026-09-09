# DS 44/2024 - Catalogo de evidencia documental para Build & Serve

Documento de referencia para el ejercicio de fiscalizacion interna, adaptado al alcance real del software: **los documentos y registros que constituyen la evidencia** exigida por el DS 44/2024.

## Cambio de enfoque respecto a la revision normativa completa

El DS44 obliga a la entidad empleadora a muchas cosas que un software no ejecuta: entregar fisicamente un EPP, suspender una faena, otorgar facilidades al CPHS, trasladar a un trabajador de puesto. Auditar el sistema contra esas obligaciones no tiene sentido.

Lo que si esta integramente dentro del alcance del software es el **Art. 72**: registrar y respaldar de forma documental y fidedigna toda la informacion vinculada a la gestion de riesgos, y mantenerla a disposicion del fiscalizador y del Organismo Administrador, preferentemente en formato electronico.

Por lo tanto, la pregunta de esta revision no es "el sistema cumple el DS44", sino:

> Cuando llegue el fiscalizador con el FUF en la mano y pida el artefacto X, el sistema lo produce completo, firmado, fechado, vigente y exportable.

Todo lo que no sea un documento o registro exigible queda fuera de este catalogo por diseno.

## Estructura del catalogo

63 artefactos agrupados en tres familias, con identificador estable:

- **D-xx**: documentos rectores del SGSST (13)
- **P-xx**: procedimientos (11)
- **R-xx**: registros (39)

Cada artefacto declara:

- **Art.**: base normativa.
- **Aplica**: cuando es exigible y cuando no (tramo de dotacion o condicion).
- **Contenido minimo**: campos que el documento debe traer, sin los cuales la evidencia es rechazable.
- **Firma**: quien debe firmar o aprobar, por rol normativo.
- **Vigencia**: periodicidad de revision o vencimiento.
- **Gatillante**: evento que obliga a actualizarlo fuera de calendario.
- **Acredita FUF**: puntos del Formulario Unico de Fiscalizacion que este artefacto sustenta.
- **Sistema**: que debe existir en Build & Serve para generarlo y exportarlo.

## Criterio de aceptacion de la evidencia

Un artefacto se considera evidencia valida solo si cumple los seis atributos. Falta uno, la evidencia es rechazable en fiscalizacion.

1. **Identificable**: tipo de documento, obra o centro de trabajo, entidad empleadora, version.
2. **Fechado**: fecha de elaboracion, de aprobacion y de vigencia. Fecha generada por el sistema, no digitada.
3. **Firmado por el rol correcto**: el DS44 nombra actores especificos. Un administrador de sistema firmando como representante legal invalida el documento.
4. **Integro**: el contenido firmado no puede modificarse despues sin dejar traza. Hash al momento de firmar.
5. **Difundido con acuse** cuando la norma lo exige. Publicar no es difundir.
6. **Exportable**: descargable como PDF con su metadata, e incluible en el expediente consolidado por obra.

Estados de revision por artefacto: `COMPLETO` / `INCOMPLETO` / `NO EXPORTABLE` / `NO EXISTE` / `NO APLICA`.

`NO EXPORTABLE` es distinto de `INCOMPLETO` y a efectos de fiscalizacion equivale a no tenerlo.

---

## Familia D. Documentos rectores del SGSST

### D-01. Politica de Seguridad y Salud en el Trabajo
- **Art.**: 22 letra a
- **Aplica**: todas las entidades, incluido el SGSST simplificado del Art. 64
- **Contenido minimo**: compromiso de proteccion de la vida y salud, compromiso de cumplimiento normativo, participacion del CPHS y de las personas trabajadoras, compromiso de mejora continua
- **Firma**: representante legal o alta direccion
- **Vigencia**: sin plazo legal explicito, se revisa con el ciclo del SGSST
- **Gatillante**: cambio de representante legal, cambio estructural de la organizacion
- **Acredita FUF**: 1
- **Sistema**: documento versionado por empresa, con firma del rol Representante Legal y registro de difusion asociado (ver R-11)

### D-02. Matriz Legal aplicable
- **Art.**: no exigida de forma explicita. Se apoya en el diagnostico de aspectos legales del Art. 64.2
- **Aplica**: buena practica en todas. Sostiene la acreditacion del diagnostico legal
- **Contenido minimo**: normativa aplicable al rubro y al centro de trabajo, con estado de cumplimiento por cada requisito
- **Firma**: no exigida
- **Vigencia**: revision anual recomendada
- **Gatillante**: cambio normativo, nuevo rubro o centro de trabajo
- **Acredita FUF**: 1, apoya 7
- **Sistema**: catalogo de requisitos legales por rubro, con estado y evidencia vinculada. Es el andamio natural del dashboard de cumplimiento

### D-03. Definicion de la estructura organizacional preventiva
- **Art.**: 22 letra b, 23, 50, 65, 66
- **Aplica**: todas. El contenido cambia por tramo de dotacion
- **Contenido minimo**: numero de personas trabajadoras por empresa, faena, sucursal o agencia, y organos designados: Encargado de Gestion del Riesgo, Delegado de SST, CPHS o Departamento de Prevencion de Riesgos
- **Firma**: representante legal
- **Vigencia**: permanente, con recalculo ante cambios de dotacion
- **Gatillante**: la obra cruza los umbrales de 9, 25 o 100 personas trabajadoras
- **Acredita FUF**: 1, y determina la aplicabilidad de 7, 30, 39, 41, 47, 48
- **Sistema**: dotacion dinamica por obra, con recalculo automatico del tramo y de las exigencias derivadas. El tramo no puede ser un campo estatico configurado una vez

### D-04. MIPER, Matriz de Identificacion de Peligros y Evaluacion de Riesgos
- **Art.**: 7
- **Aplica**: todas
- **Contenido minimo**: por cada puesto de trabajo, a) identificacion de peligros, b) evaluacion de riesgos, c) magnitud o nivel de riesgo, d) medidas preventivas de control y de emergencia adicionales. Debe considerar agentes fisicos, quimicos y biologicos, riesgos ergonomicos y psicosociales, violencia y acoso en el trabajo, historico de AT, EP e incidentes, riesgos de traslado y trayecto, trabajadores especialmente sensibles y programas de vigilancia ocupacional, todo con enfoque de genero
- **Firma**: no exigida explicitamente, pero requiere autor identificable y difusion acreditada
- **Vigencia**: revision al menos anual
- **Gatillante**: cambio de condiciones de trabajo, accidente del trabajo, diagnostico de enfermedad profesional, situacion de riesgo grave e inminente
- **Acredita FUF**: 2, 3, 4, 5, 6, y sostiene 13 y 15
- **Sistema**: cobertura verificable del 100 por ciento de los puestos, catalogo cerrado de categorias de factores de riesgo, los cuatro campos minimos con validacion en backend, jerarquia de control del Art. 9 por medida, versionado con motivo de revision tipificado, y disparador desde el modulo de incidentes

### D-05. Autoevaluacion del Organismo Administrador
- **Art.**: 64 inc. 1
- **Aplica**: solo entidades de hasta 25 personas trabajadoras. Sobre ese tramo, NO APLICA
- **Contenido minimo**: identificacion y evaluacion de condiciones ambientales, psicosociales y ergonomicas, y del cumplimiento normativo, con el instrumento del OAL
- **Firma**: responsable designado de la entidad
- **Vigencia**: segun instrumento del OAL, al menos anual
- **Gatillante**: cambio de condiciones de trabajo
- **Acredita FUF**: 7
- **Sistema**: carga o registro del resultado de la autoevaluacion, condicionado al tramo. No debe exigirse a obras sobre 25 trabajadores

### D-06. Programa de Trabajo Preventivo (PTP)
- **Art.**: 8
- **Aplica**: todas
- **Contenido minimo**: a) medidas preventivas y correctivas derivadas de la MIPER, b) plazos de implementacion, c) responsables, d) actividades de promocion sobre alcohol y drogas, e) difusion de estilo de vida y alimentacion saludables, f) actividades de prevencion en conduccion de vehiculos motorizados cuando corresponda, g) fechas de modificaciones y de aprobacion
- **Firma**: representante legal
- **Vigencia**: se actualiza junto con la MIPER
- **Gatillante**: confeccion o actualizacion de la MIPER, con plazo de **30 dias corridos**
- **Acredita FUF**: 8, 9, 10, 11
- **Sistema**: relacion explicita con la version de MIPER que lo origina, calculo del plazo de 30 dias corridos con alerta, tipos de actividad propios para las letras d), e) y f), y estado de aprobacion firmado por el rol Representante Legal

### D-07. Reglamento Interno de Higiene y Seguridad (RIHS o RIOHS)
- **Art.**: 56 a 61
- **Aplica**: todas. RIHS para 1 a 9 trabajadores, RIOHS para 10 o mas. El de Higiene y Seguridad puede quedar subsumido en el Reglamento Interno de Orden, Higiene y Seguridad
- **Contenido minimo**: preambulo, disposiciones generales, obligaciones de las personas trabajadoras, prohibiciones y sanciones. Incluye materias de acoso sexual, laboral y violencia (Art. 58 letra j)
- **Firma**: representante legal
- **Vigencia**: revision con periodicidad no inferior a 1 ano
- **Gatillante**: cambio normativo, resultado de la revision anual
- **Acredita FUF**: 49, 52
- **Sistema**: documento versionado con fecha de entrada en vigencia, comprobante de ingreso al sitio web de la Direccion del Trabajo, y registros vinculados R-16, R-17 y R-18

### D-08. Mapa de riesgos
- **Art.**: 62
- **Aplica**: todas, por lugar de trabajo o dependencia
- **Contenido minimo**: dibujo o esquema del lugar de trabajo con indicacion de los principales riesgos existentes, coherente con la MIPER
- **Firma**: no exigida
- **Vigencia**: se actualiza con la MIPER
- **Gatillante**: actualizacion de la MIPER, cambio de layout de la obra
- **Acredita FUF**: 53
- **Sistema**: documento asociado a la obra o centro, con version, fecha y vinculo a la version de MIPER de la que deriva. La actualizacion de la MIPER debe gatillar revision del mapa

### D-09. Evaluacion anual del cumplimiento del PTP
- **Art.**: 14, 52
- **Aplica**: todas
- **Contenido minimo**: periodo evaluado, porcentaje de medidas ejecutadas, evaluacion de la eficacia de las acciones programadas, desviaciones e incumplimientos detectados con sus causas, y medidas de mejora continua dispuestas
- **Firma**: responsable de la gestion preventiva y representante legal
- **Vigencia**: al menos anual
- **Gatillante**: cierre del periodo evaluado
- **Acredita FUF**: 20
- **Sistema**: entidad propia que consuma las seis fuentes de evidencia de la fase CHECK (cumplimiento del PTP, indicadores de siniestralidad, resultados de vigilancia, investigaciones, actas del CPHS, prescripciones pendientes) y que genere medidas correctivas trazables. Es la bisagra entre CHECK y ACT: una desviacion registrada que no genera medida rompe la cadena

### D-10. Informe anual de gestion preventiva
- **Art.**: 52.15 inc. final
- **Aplica**: solo entidades con Departamento de Prevencion de Riesgos, es decir mas de 100 personas trabajadoras. Bajo ese tramo, NO APLICA
- **Contenido minimo**: gestion preventiva del periodo, estadisticas, cumplimiento del programa
- **Firma**: experto en prevencion a cargo del Departamento
- **Vigencia**: anual
- **Gatillante**: cierre del ano
- **Acredita FUF**: 43
- **Sistema**: generacion por el rol Experto en Prevencion, con acceso de lectura para CPHS, trabajadores y representantes, y log de ese acceso

### D-11. Programa de vigilancia ambiental
- **Art.**: 67 inc. 1 y 3
- **Aplica**: lugares de trabajo con exposicion a agentes o factores de riesgo que gatillen protocolo
- **Contenido minimo**: agentes o factores identificados, protocolo MINSAL aplicable, mediciones programadas y realizadas
- **Firma**: no exigida, requiere constancia de solicitud al OAL
- **Vigencia**: segun protocolo
- **Gatillante**: identificacion de un nuevo factor en la MIPER
- **Acredita FUF**: 54
- **Sistema**: relacion entre factores de la MIPER y protocolos MINSAL aplicables, con estado de incorporacion. El protocolo psicosocial (CEAL-SM/SUSESO, RE 1.448/2022) es universal y debe estar siempre activo sin diagnostico previo. Los condicionales (TMERT-EESS, PREXOR, PLANESI, MMC, radiacion UV, hipobaria, temperaturas extremas, plaguicidas) se activan solo si el factor existe

### D-12. Programa de vigilancia de la salud
- **Art.**: 67 inc. 1, 3 y 5
- **Aplica**: si hay personas trabajadoras expuestas
- **Contenido minimo**: nomina de personas expuestas, protocolo aplicable, examenes programados y realizados
- **Firma**: no exigida, requiere constancia de solicitud de incorporacion al OAL
- **Vigencia**: segun protocolo
- **Gatillante**: nuevo trabajador expuesto, cambio de puesto
- **Acredita FUF**: 55
- **Sistema**: nomina derivada de la MIPER por puesto, estado de vigilancia por trabajador, y control de acceso reforzado por tratarse de datos de salud

### D-13. Plan de gestion, reduccion y respuesta ante emergencias, catastrofes o desastres
- **Art.**: 19
- **Aplica**: todas, uno o mas planes segun lugares de trabajo
- **Contenido minimo**: eventos internos y externos conocidos, probables y previsibles, mecanismos de actuacion, procedimiento de evacuacion y traslado de personas afectadas
- **Firma**: representante legal
- **Vigencia**: revision periodica, con prueba de ensayo al menos anual
- **Gatillante**: situacion de riesgo grave, cambio de condiciones de la obra
- **Acredita FUF**: 27, y sostiene el contenido de 22 letra e y 24 letra f
- **Sistema**: documento por obra, con procedimientos derivados vinculados (P-06) y registro de ensayo anual (R-35)

---

## Familia P. Procedimientos exigidos

Todos los procedimientos comparten el mismo criterio: documento tipificado, versionado, con fecha de aprobacion, vigente y difundido a quienes deben aplicarlo. Se listan con lo especifico de cada uno.

### P-01. Trabajo seguro en maquinas, equipos y herramientas motrices
- **Art.**: 10
- **Aplica**: si existen maquinas, equipos o herramientas motrices
- **Contenido minimo**: procedimiento de trabajo seguro, programa preventivo de operacion y mantenimiento
- **Acredita FUF**: 12 letra c
- **Sistema**: entidad Maquina o Equipo con manual y ficha tecnica adjuntos, procedimiento asociado y vinculo al registro R-15

### P-02. Utilizacion de agentes fisicos, quimicos y biologicos
- **Art.**: 2 N°14 letra c
- **Aplica**: si se manipulan agentes de esa naturaleza
- **Contenido minimo**: caracteristicas de los productos y sustancias, condiciones de uso y manipulacion segura
- **Acredita FUF**: sostiene 22 letra d
- **Sistema**: catalogo de sustancias con hoja de datos de seguridad adjunta, vinculado al contenido del acta IRL

### P-03. Utilizacion, mantenimiento, reposicion o recambio de EPP
- **Art.**: 13 inc. 2
- **Aplica**: si hay EPP
- **Contenido minimo**: criterios de utilizacion, mantenimiento, reposicion y recambio
- **Acredita FUF**: 17
- **Sistema**: procedimiento vinculado a la logica de reposicion del modulo de EPP

### P-04. Procedimientos derivados del plan de emergencias
- **Art.**: 19
- **Aplica**: todas, derivan de D-13
- **Contenido minimo**: procedimientos especificos por tipo de emergencia identificada
- **Acredita FUF**: 27
- **Sistema**: relacion jerarquica con D-13, para que un plan sin procedimientos derivados se detecte como incompleto

### P-05. Actuacion ante riesgo grave o inminente
- **Art.**: 18
- **Aplica**: todas
- **Contenido minimo**: informacion inmediata a los afectados, medidas de eliminacion o atenuacion, suspension de faenas, evacuacion, aviso a la Inspeccion del Trabajo
- **Acredita FUF**: 26
- **Sistema**: procedimiento vinculado al tipo de evento Riesgo Grave e Inminente del modulo de incidentes, que produce el registro R-36

### P-06. Evacuacion y traslado de personas afectadas
- **Art.**: 19
- **Aplica**: todas
- **Contenido minimo**: rutas, responsables, mecanismos de traslado
- **Acredita FUF**: sostiene 22 letra e
- **Sistema**: contenido reutilizable por la plantilla del acta IRL

### P-07. Investigacion de accidentes con metodologia de arbol de causas
- **Art.**: 71
- **Aplica**: todas
- **Contenido minimo**: metodologia indicada por el Organismo Administrador, enfoque de genero, participacion de trabajadores o sus representantes
- **Acredita FUF**: 59, y sostiene 38 letras c y d
- **Sistema**: metodologia declarada en el modulo de investigacion. Si se usa apoyo de IA, deben quedar registradas la metodologia aplicada y la autoria humana de la conclusion. El fiscalizador evalua el informe, no el modelo

### P-08. Gestion de cambios en procesos, tecnologias, materiales o estructura
- **Art.**: 12
- **Aplica**: todas
- **Contenido minimo**: criterios para evaluar el cambio, actualizar la MIPER, informar riesgos y consultar a los representantes
- **Acredita FUF**: sostiene 21 letra b y 25
- **Sistema**: el cambio debe disparar nuevo IRL, revision de MIPER y consulta. Sin ese encadenamiento el procedimiento es papel muerto

### P-09. Coordinacion y cooperacion entre entidades empleadoras
- **Art.**: 20
- **Aplica**: cuando distintas entidades comparten un lugar fisico comun. En construccion es la regla, no la excepcion
- **Contenido minimo**: mecanismos de informacion mutua de riesgos, coordinacion de medidas, planes de emergencia conjuntos
- **Acredita FUF**: 29
- **Sistema**: el modelo debe soportar varias entidades empleadoras sobre una misma obra (mandante, contratistas, subcontratistas, independientes) y compartir evidencia entre ellas sin romper el aislamiento multi tenant. Es el punto de arquitectura mas exigente del catalogo

### P-10. Consulta y participacion de las personas trabajadoras
- **Art.**: 17, 37, 71
- **Aplica**: todas, con el organo que corresponda al tramo
- **Contenido minimo**: materias sujetas a consulta, oportunidad, destinatarios y forma de registro
- **Acredita FUF**: 25
- **Sistema**: produce el registro R-19

### P-11. Traslado de puesto de trabajo
- **Art.**: 69
- **Aplica**: si hay enfermedad profesional diagnosticada
- **Contenido minimo**: criterios de traslado a puesto sin exposicion al riesgo de origen, sin detrimento de remuneraciones
- **Acredita FUF**: 57
- **Sistema**: produce el registro R-28, con validacion cruzada de que el puesto de destino no tenga en su MIPER el riesgo de origen
---

## Familia R. Registros

Los registros son la evidencia de que algo ocurrio. A diferencia de los documentos rectores, se generan de forma continua y son los que mas se piden en fiscalizacion, porque son los mas faciles de contrastar con la realidad.

### R.1 Organizacion preventiva

### R-01. Acta de constitucion del CPHS y comprobante de registro en la Direccion del Trabajo
- **Art.**: 23, 36
- **Aplica**: mas de 25 personas trabajadoras en la empresa, faena, sucursal o agencia
- **Contenido minimo**: fecha de eleccion de los representantes, integrantes titulares y suplentes por representacion, acta de constitucion, comprobante de registro en el sitio web de la DT
- **Vigencia**: por mandato del comite
- **Plazo critico**: registro dentro de **15 dias habiles** desde la fecha de eleccion
- **Acredita FUF**: 30, 32
- **Sistema**: campos de fecha de eleccion y de registro DT, calculo de 15 dias habiles con calendario de feriados chilenos, y adjunto del comprobante. El registro en la DT se considera tambien ingresado en la SEREMI de Salud

### R-02. Actas de reuniones del CPHS
- **Art.**: 39 inc. 1, 2 y 4, 42 inc. 1
- **Aplica**: si existe CPHS
- **Contenido minimo**: tipo de reunion (ordinaria o extraordinaria), causal en las extraordinarias (peticion conjunta de miembros, accidente fatal o grave, riesgo grave e inminente), materias tratadas, acuerdos, y plazo de cumplimiento cuando se adoptan medidas preventivas
- **Vigencia**: mensual para las ordinarias
- **Gatillante**: accidente del trabajo fatal o grave, riesgo grave e inminente
- **Acredita FUF**: 34, 35
- **Sistema**: los acuerdos deben ser entidades con plazo y responsable, no texto libre dentro del acta. Solo asi se demuestra el seguimiento del plazo. Disparador automatico de reunion extraordinaria desde el modulo de incidentes

### R-03. Comunicacion escrita de los acuerdos del CPHS a la entidad empleadora
- **Art.**: 42 inc. 2
- **Aplica**: si existe CPHS
- **Contenido minimo**: acuerdos comunicados, fecha, receptor
- **Acredita FUF**: 36
- **Sistema**: accion de comunicacion con acuse por parte de la entidad empleadora, distinta de la publicacion del acta

### R-04. Entrega de documentacion preventiva al CPHS
- **Art.**: 46 inc. 3
- **Aplica**: si existe CPHS
- **Contenido minimo**: documentos entregados o puestos a disposicion, fecha, receptor
- **Acredita FUF**: 37
- **Sistema**: rol CPHS con lectura sobre el repositorio preventivo de la obra **y log de acceso o entrega**. Un permiso concedido sin log no acredita entrega

### R-05. Acta de eleccion del Delegado de Seguridad y Salud en el Trabajo
- **Art.**: 66
- **Aplica**: 10 a 25 personas trabajadoras
- **Contenido minimo**: acta de asamblea, fecha, asistentes, resultado de la eleccion
- **Vigencia**: 2 anos
- **Acredita FUF**: 39, 40
- **Sistema**: control de vencimiento a 2 anos con alerta de nueva eleccion

### R-06. Certificados de capacitacion de los integrantes del CPHS
- **Art.**: 32
- **Aplica**: si existe CPHS
- **Contenido minimo**: curso de orientacion en prevencion de riesgos, realizado dentro del primer semestre del mandato, y curso de 20 horas para al menos un representante de la empresa y uno de los trabajadores
- **Plazo critico**: primer semestre del mandato
- **Acredita FUF**: 31
- **Sistema**: control de plazo de 6 meses desde la fecha de eleccion, por integrante, con alerta

### R-07. Designacion y certificado de capacitacion del Encargado de Gestion del Riesgo
- **Art.**: 65 inc. 1
- **Aplica**: entidades de hasta 100 personas trabajadoras que hayan designado encargado
- **Contenido minimo**: designacion vigente y certificado de capacitacion emitido por el Organismo Administrador de la Ley 16.744
- **Acredita FUF**: 48
- **Sistema**: rol con adjunto de certificado del OAL y control de vigencia

### R-08. Designacion del experto e inscripcion en la SEREMI de Salud
- **Art.**: 50, 55 inc. 2
- **Aplica**: mas de 100 personas trabajadoras
- **Contenido minimo**: designacion, categoria del experto, numero de registro en la SEREMI de Salud, adjunto de la inscripcion
- **Acredita FUF**: 41
- **Sistema**: control de vigencia de la inscripcion

### R-09. Registro de asistencia del encargado del Departamento de Prevencion
- **Art.**: 54, 55 inc. 1 y 3
- **Aplica**: si existe Departamento de Prevencion de Riesgos
- **Contenido minimo**: tiempo de atencion exigido calculado segun numero de personas trabajadoras y cotizacion generica, y asistencia efectiva contrastable
- **Acredita FUF**: 44, 45
- **Sistema**: calculo del tiempo minimo almacenado y comparado automaticamente contra la asistencia real, con alerta por deficit. Si el calculo esta ausente o hardcodeado, el registro no acredita nada

### R-10. Registro de actividades y funciones del CPHS
- **Art.**: 47, 37
- **Aplica**: si existe CPHS
- **Contenido minimo**: evidencia del ejercicio de las funciones minimas, en especial la decision sobre negligencia inexcusable (Art. 47 letra d, concordante con Art. 70 Ley 16.744) y el informe a la entidad empleadora ante riesgo grave e inminente (letra g)
- **Acredita FUF**: 38, y de forma indirecta 33
- **Sistema**: campo explicito de decision sobre negligencia inexcusable en el modulo de investigacion, y via de reporte del CPHS a la entidad empleadora con acuse

### R.2 Informacion y difusion

### R-11. Difusion y firma de recepcion de la Politica de SST
- **Art.**: 22
- **Aplica**: todas
- **Contenido minimo**: destinatarios, fecha, medio, firma de recepcion
- **Acredita FUF**: 1
- **Sistema**: registro por trabajador con firma

### R-12. Registro de difusion de la MIPER
- **Art.**: 7 inc. 9
- **Aplica**: todas
- **Contenido minimo**: constancia de disponibilidad en el lugar de trabajo, y difusion a personas trabajadoras, comite paritario, delegado de SST, **dirigentes sindicales** y toda la linea de mando, con fecha y acuse
- **Acredita FUF**: 4
- **Sistema**: destinatarios por rol. El rol dirigente sindical es el que mas se omite en el modelo de datos y es un destinatario nombrado expresamente por la norma

### R-13. Registro de difusion del PTP y remision al CPHS
- **Art.**: 8 inc. 3
- **Aplica**: todas. La remision al CPHS solo si existe
- **Contenido minimo**: fecha, medio (aviso visible o correo electronico), destinatarios, y constancia separada de remision de un ejemplar al Comite Paritario
- **Acredita FUF**: 11
- **Sistema**: dos acciones distintas, difusion y remision, no una sola

### R-14. Acta de Informacion de Riesgos Laborales (IRL, ex ODI)
- **Art.**: 15 inc. 1 y 3, 19 inc. 1
- **Aplica**: todas, por trabajador
- **Contenido minimo**: a) caracteristicas minimas del lugar de trabajo donde se ejecutaran las labores, b) riesgos a los que podria estar expuesto y medidas preventivas, incluidos los derivados de emergencias, catastrofes y desastres, c) procedimientos de trabajo seguro, d) caracteristicas de los productos y sustancias que manipulara, e) riesgos de emergencias, catastrofes o desastres del plan de gestion, mecanismos de actuacion y procedimiento de evacuacion y traslado
- **Firma**: persona trabajadora
- **Plazo critico**: **previa al inicio de las labores**
- **Gatillante**: nuevo proceso productivo, cambio de tecnologias, materiales o sustancias
- **Acredita FUF**: 21, 22
- **Sistema**: comparacion entre fecha de firma del IRL y fecha de inicio de labores, con bloqueo o alerta si el IRL es posterior. La plantilla debe generarse desde datos reales (MIPER del puesto, procedimientos vigentes, plan de emergencia de la obra), no desde texto estatico, y el PDF firmado debe conservar el contenido exacto de la version vigente al momento de la firma

### R-15. Informacion de riesgos por uso de maquinas, equipos y elementos de trabajo
- **Art.**: 10 inc. 1 y 2
- **Aplica**: si existen maquinas, equipos o herramientas
- **Contenido minimo**: informacion sobre riesgos y manejo adecuado y seguro, contenido sustancial de manuales cuando existan, instrucciones y fichas tecnicas, y capacitacion sobre el uso correcto y seguro
- **Firma**: persona trabajadora
- **Acredita FUF**: 12 letras a, b y d
- **Sistema**: relacion trabajador a equipo, no solo obra a equipo

### R-16. Envio del Reglamento Interno para observaciones
- **Art.**: 57 inc. 2
- **Aplica**: todas, con destinatarios segun existan
- **Contenido minimo**: constancia de envio a personas trabajadoras, Comite Paritario o Delegado de SST, y organizaciones sindicales
- **Plazo critico**: **30 dias de anticipacion** a la entrada en vigencia
- **Acredita FUF**: 50
- **Sistema**: fecha de entrada en vigencia y fecha de remision, con validacion de la diferencia. Verificar que exista la entidad organizacion sindical en el modelo

### R-17. Acta de revision del Reglamento Interno
- **Art.**: 57 inc. 5
- **Aplica**: todas
- **Contenido minimo**: fecha, participantes (Departamento de Prevencion o CPHS o Delegado de SST, y organizaciones sindicales), resultado de la revision
- **Vigencia**: periodicidad no inferior a 1 ano
- **Acredita FUF**: 51
- **Sistema**: control de vencimiento anual con alerta y registro de participantes segun tramo

### R-18. Registro de recepcion del Reglamento Interno
- **Art.**: 56 inc. 1
- **Aplica**: todas, por trabajador
- **Contenido minimo**: entrega gratuita, fecha, firma de recepcion, version entregada
- **Acredita FUF**: 49
- **Sistema**: la version entregada debe quedar congelada en el registro, no ser un enlace a la version vigente

### R-19. Registro de consulta y participacion
- **Art.**: 17 inc. 1, 37 inc. 2 numeral 4, 71 inc. 1
- **Aplica**: todas
- **Contenido minimo**: materia consultada (MIPER, PTP, Reglamento Interno, cambios en procesos de trabajo), fecha, participantes, respuesta u observaciones recibidas, y participacion en la investigacion de causas de AT o EP
- **Acredita FUF**: 25
- **Sistema**: entidad Consulta vinculable a los artefactos consultados y al modulo de investigacion

### R.3 Capacitacion

### R-20. Registro de capacitacion en prevencion de riesgos laborales
- **Art.**: 16 inc. 1
- **Aplica**: todas, 100 por ciento del personal
- **Contenido minimo**: duracion **minima 8 horas**, preferentemente dentro de la jornada, enfoque de genero, metodologia que procure adecuado aprendizaje, y temario que aborde a) factores de riesgo del lugar, b) efectos en la salud por exposicion a factores causantes de EP, c) medidas preventivas de control, d) prestaciones medicas y economicas a las que tiene derecho la persona trabajadora, e) establecimiento asistencial del OAL al que concurrir, f) plan de gestion de emergencias de la entidad, g) senaletica, h) prevencion de riesgos de incendio. Asistentes, relatores y evaluacion
- **Firma**: asistencia firmada por el trabajador
- **Vigencia**: periodicidad definida en el PTP, **sin exceder 2 anos**
- **Acredita FUF**: 23, 24
- **Sistema**: validacion de duracion minima como valor numerico, checklist de las ocho letras del temario, campo de enfoque de genero y de metodologia, control de vencimiento a 2 anos por trabajador. Las letras d) y e) son las mas omitidas en implementaciones centradas solo en riesgos operativos

### R-21. Registro de capacitacion en uso y mantencion de EPP
- **Art.**: 13 inc. 3 y 4
- **Aplica**: si hay EPP
- **Contenido minimo**: duracion **minima 1 hora** por EPP, contenidos sobre partes que componen el elemento, colocacion, limitaciones de uso, limpieza, almacenamiento y prueba de chequeo diario. El registro debe considerar a) actividades teoricas y practicas, b) asistentes, c) relatores, d) resultados de las evaluaciones de aprendizaje, e) actividades de reforzamiento
- **Firma**: asistencia firmada por el trabajador
- **Acredita FUF**: 18, 19
- **Sistema**: los campos de resultado de evaluacion de aprendizaje y de actividades de reforzamiento son los que suelen faltar. Deben ser campos del modelo, no observaciones libres

### R.4 Elementos de proteccion personal

### R-22. Registro de entrega de EPP
- **Art.**: 13 inc. 1
- **Aplica**: si hay riesgo residual que requiera EPP
- **Contenido minimo**: trabajador, EPP entregado, cantidad, fecha, firma de recepcion, y constancia de entrega libre de costo
- **Acredita FUF**: 14, 15
- **Sistema**: cada EPP entregado debe estar vinculado a la fila de MIPER o al peligro que cubre. Sin ese vinculo no se puede acreditar que el EPP es adecuado al riesgo, y el punto 15 queda incompleto aunque exista el registro de entrega

### R-23. Catalogo de EPP con certificacion de calidad
- **Art.**: 13 inc. 2
- **Aplica**: si hay EPP
- **Contenido minimo**: por modelo de EPP, certificacion de calidad vigente o registro en el Instituto de Salud Publica, con adjunto y fecha de vigencia
- **Acredita FUF**: 16
- **Sistema**: alerta por certificacion vencida. Un EPP entregado con certificacion vencida es un incumplimiento visible en la traza

### R.5 Vigilancia ambiental y de la salud

### R-24. Solicitud de incorporacion a programas de vigilancia
- **Art.**: 67 inc. 5
- **Aplica**: si hay factores o personas expuestas
- **Contenido minimo**: solicitud al Organismo Administrador por cada protocolo aplicable, con fecha y respuesta
- **Acredita FUF**: 54, 55
- **Sistema**: la obligacion de solicitar es de la entidad empleadora y se fiscaliza aunque el OAL no haya respondido. Debe registrarse la solicitud, no solo el resultado

### R-25. Nomina de personas expuestas y estado de vigilancia
- **Art.**: 67
- **Aplica**: si hay personas expuestas
- **Contenido minimo**: trabajador, agente o factor de exposicion, protocolo aplicable, estado en el programa
- **Acredita FUF**: 55
- **Sistema**: nomina derivada automaticamente de la MIPER por puesto, no mantenida a mano

### R-26. Mediciones ambientales y resultados de examenes ocupacionales
- **Art.**: 67, 68
- **Aplica**: si hay programas de vigilancia activos
- **Contenido minimo**: mediciones con fecha y resultado, resultados de examenes ocupacionales
- **Acredita FUF**: 54, 55
- **Sistema**: control de acceso reforzado y log de acceso sobre datos de salud, por la nota de confidencialidad del Art. 73

### R-27. Registro de citacion, autorizacion y asistencia a examenes de control
- **Art.**: 68
- **Aplica**: si hay citaciones del OAL
- **Contenido minimo**: citacion, autorizacion de la entidad empleadora, asistencia, y constancia de que el tiempo empleado se considera trabajado para todos los efectos legales
- **Acredita FUF**: 56
- **Sistema**: punto de alto riesgo de omision en implementaciones que solo guardan el resultado del examen y no la citacion ni la autorizacion

### R-28. Registro de traslado de puesto por enfermedad profesional
- **Art.**: 69
- **Aplica**: si hay EP diagnosticada
- **Contenido minimo**: prescripcion del Organismo Administrador, puesto de origen y de destino, fecha, y constancia de que no hay detrimento de remuneraciones
- **Acredita FUF**: 57
- **Sistema**: validacion cruzada de que el puesto de destino no tenga en su MIPER el riesgo que dio origen a la enfermedad. Esa validacion es lo que convierte el registro en evidencia solida

### R.6 Siniestralidad, investigacion e indicadores

### R-29. Registro de incidentes o sucesos peligrosos
- **Art.**: 73
- **Aplica**: todas
- **Contenido minimo**: evento, fecha, lugar, descripcion, personas involucradas, con desagregacion por sexo
- **Acredita FUF**: 46 letra a
- **Sistema**: tipificacion segun la definicion del Art. 2 N°7 (incendios, explosiones, derrumbes, caidas de andamios y maquinas elevadoras, cortocircuitos, fallos en sistemas de presion y analogos que impidan el desarrollo normal de las actividades)

### R-30. Registro de accidentes del trabajo, de trayecto y enfermedades profesionales
- **Art.**: 73, 75
- **Aplica**: todas
- **Contenido minimo**: todos los eventos, con sexo, lugar y relato. En entidades sin Departamento de Prevencion, este registro y la tasa anual de accidentabilidad son la exigencia completa
- **Acredita FUF**: 46 letra b, 47
- **Sistema**: campo sexo obligatorio, y clasificacion de accidente del trabajo, de trayecto y enfermedad profesional como categorias separadas

### R-31. Informes de investigacion de accidentes y enfermedades profesionales
- **Art.**: 71
- **Aplica**: si hay AT o EP
- **Contenido minimo**: metodologia indicada por el OAL, enfoque de genero, participacion de trabajadores o representantes, causas raiz, medidas correctivas, y decision sobre negligencia inexcusable cuando la investiga el CPHS
- **Acredita FUF**: 59, 38 letras c y d
- **Sistema**: las medidas correctivas generadas deben alimentar el PTP y gatillar revision de la MIPER. Si el informe cierra sin generar medida, la cadena esta rota

### R-32. Indicadores de siniestralidad con Departamento de Prevencion
- **Art.**: 73, 74
- **Aplica**: mas de 100 personas trabajadoras
- **Contenido minimo**: tasa de accidentabilidad, tasa **mensual** de frecuencia, tasa **semestral** de gravedad, desagregadas por sexo
- **Acredita FUF**: 46 letra d y e
- **Sistema**: en las tasas de frecuencia y gravedad se incluyen los lesionados cuya ausencia al trabajo haya sido igual o superior a una jornada laboral. Verificar ese filtro en el codigo del calculo

### R-33. Indicadores de siniestralidad sin Departamento de Prevencion
- **Art.**: 75
- **Aplica**: hasta 100 personas trabajadoras
- **Contenido minimo**: tasa **anual** de accidentabilidad por accidentes del trabajo
- **Acredita FUF**: 47
- **Sistema**: el conjunto de indicadores debe cambiar segun tramo. No exigir frecuencia mensual ni gravedad semestral a empresas sin Departamento de Prevencion, y si exigir la tasa anual de accidentabilidad a todas

### R-34. Registro de personas trabajadoras en vigilancia de la salud
- **Art.**: 73
- **Aplica**: si existe Departamento de Prevencion
- **Contenido minimo**: nomina con desagregacion por sexo, resguardando la informacion sensible o confidencial
- **Acredita FUF**: 46 letra c
- **Sistema**: se apoya en R-25, pero con el resguardo de confidencialidad exigido por la nota del Art. 73

### R.7 Emergencias

### R-35. Acta de prueba de ensayo del plan de emergencias
- **Art.**: 19 inc. 1
- **Aplica**: todas
- **Contenido minimo**: fecha, plan ensayado, participantes, resultados y observaciones
- **Vigencia**: al menos 1 vez al ano
- **Acredita FUF**: 28
- **Sistema**: vinculo obligatorio al plan que se ensaya (D-13). Sin ese vinculo la evidencia queda huerfana y no acredita cual plan fue probado

### R-36. Registro de actuacion ante riesgo grave e inminente
- **Art.**: 18 inc. 1
- **Aplica**: si ocurre el evento
- **Contenido minimo**: deteccion del riesgo, informacion inmediata a los trabajadores afectados, medidas adoptadas para eliminarlo o atenuarlo, suspension de faenas y evacuacion cuando el riesgo no se pueda eliminar, y aviso a la Inspeccion del Trabajo
- **Acredita FUF**: 26
- **Sistema**: la inmediatez se acredita con la diferencia entre el timestamp de deteccion y el de notificacion. Ambos deben ser generados por el sistema, no digitados

### R.8 Coordinacion en faena compartida

### R-37. Registro de coordinacion e informacion mutua entre entidades empleadoras
- **Art.**: 20 inc. 1
- **Aplica**: si hay lugar de trabajo compartido por mas de una entidad empleadora, o al menos una entidad y personas trabajadoras independientes
- **Contenido minimo**: entidades participantes, riesgos informados mutuamente, medidas coordinadas, planes de emergencia conjuntos, actas con fecha y firmantes
- **Acredita FUF**: 29
- **Sistema**: evidencia compartida entre tenants distintos, con control de que cada entidad vea lo que le corresponde. Es el requisito de arquitectura mas dificil del catalogo y el mas probable en una obra de construccion

### R.9 Prescripciones y fiscalizacion

### R-38. Registro de medidas prescritas y su implementacion
- **Art.**: 70, 77
- **Aplica**: todas
- **Contenido minimo**: origen de la medida (SEREMI de Salud, Direccion del Trabajo, Organismo Administrador, Departamento de Prevencion, CPHS), medida prescrita, plazo, responsable, estado y evidencia de cierre
- **Acredita FUF**: 58
- **Sistema**: es fuente de evidencia de la fase CHECK y entrada de la fase ACT. Una prescripcion pendiente y vencida debe ser visible en el dashboard, porque es lo primero que un fiscalizador revisa en una segunda visita

### R.10 Registro maestro

### R-39. Expediente de evidencia preventiva exportable
- **Art.**: 72 inc. 1
- **Aplica**: todas
- **Contenido minimo**: la totalidad de los artefactos anteriores que apliquen a la obra y al periodo, con su metadata de version, fecha, firmantes e integridad
- **Acredita FUF**: 60, y de forma indirecta todos los demas
- **Sistema**: exportacion de un paquete por obra y por periodo, con indice, integridad verificable (hash, sello de tiempo, cadena de firma con PIN), inmutabilidad de lo firmado y retencion. Un documento que puede editarse despues de firmado sin dejar traza rompe el caracter fidedigno y compromete este registro y, por arrastre, todo el expediente
---

## Matriz inversa: punto del FUF y artefacto que lo acredita

Esta tabla se usa el dia de la fiscalizacion. El fiscalizador pregunta por un punto, y aqui esta el artefacto exacto que hay que mostrar.

| FUF | Que se pregunta | Artefacto que lo acredita |
|---|---|---|
| 1 | Existencia del SGSST con contenido minimo | D-01, D-02, D-03, R-11 |
| 2 | Existencia de la MIPER con cobertura total | D-04 |
| 3 | Alcance de factores de riesgo en la MIPER | D-04 |
| 4 | Disponibilidad y difusion de la MIPER | D-04, R-12 |
| 5 | Contenido minimo de la MIPER | D-04 |
| 6 | Fecha y revision de la MIPER | D-04 |
| 7 | Autoevaluacion en entidades de hasta 25 | D-05 |
| 8 | PTP dentro de 30 dias corridos desde la MIPER | D-06 |
| 9 | PTP escrito y aprobado | D-06 |
| 10 | Contenido minimo del PTP | D-06 |
| 11 | Difusion del PTP y remision al CPHS | D-06, R-13 |
| 12 | Maquinas, equipos y elementos de trabajo | P-01, R-15 |
| 13 | Prelacion de medidas de control | D-04, D-06 |
| 14 | Entrega gratuita de EPP | R-22 |
| 15 | Adecuacion del EPP al riesgo | R-22 vinculado a D-04 |
| 16 | Certificacion de los EPP | R-23 |
| 17 | Procedimiento de gestion de EPP | P-03 |
| 18 | Capacitacion en uso y mantencion de EPP | R-21 |
| 19 | Registro de capacitaciones en EPP | R-21 |
| 20 | Evaluacion anual del cumplimiento del PTP | D-09 |
| 21 | Oportunidad de la informacion de riesgos | R-14 |
| 22 | Contenido minimo de la informacion de riesgos | R-14, apoyado en P-02, P-06, D-13 |
| 23 | Ejecucion de la capacitacion en prevencion | R-20 |
| 24 | Contenidos minimos de la capacitacion | R-20 |
| 25 | Consulta y participacion de representantes | P-10, R-19 |
| 26 | Actuacion ante riesgo grave e inminente | P-05, R-36 |
| 27 | Existencia del plan de emergencias | D-13, P-04 |
| 28 | Prueba de ensayo anual | R-35 |
| 29 | Coordinacion en faena compartida | P-09, R-37 |
| 30 | Constitucion del CPHS | D-03, R-01 |
| 31 | Curso de orientacion de integrantes del CPHS | R-06 |
| 32 | Registro del acta en la Direccion del Trabajo | R-01 |
| 33 | Facilidades para el funcionamiento del CPHS | Sin artefacto propio. Evidencia indirecta: R-02, R-04, R-10 |
| 34 | Reuniones del CPHS | R-02 |
| 35 | Actas de reuniones del CPHS | R-02 |
| 36 | Comunicacion escrita de acuerdos | R-03 |
| 37 | Entrega de documentacion al CPHS | R-04 |
| 38 | Funciones minimas del CPHS | R-10, R-31 |
| 39 | Delegado de Seguridad y Salud en el Trabajo | D-03, R-05 |
| 40 | Eleccion del Delegado cada 2 anos | R-05 |
| 41 | Departamento de Prevencion con experto inscrito | R-08 |
| 42 | Medios y personal del Departamento | Sin artefacto propio. Evidencia indirecta: D-03, R-09 |
| 43 | Cumplimiento de funciones del Departamento | D-10, R-09 |
| 44 | Categoria y tiempo de dedicacion del encargado | R-09 |
| 45 | Registro de asistencia del encargado | R-09 |
| 46 | Registros que mantiene el Departamento | R-29, R-30, R-34, R-32 |
| 47 | Indicadores en entidades sin Departamento | R-30, R-33 |
| 48 | Encargado de Gestion del Riesgo capacitado | R-07 |
| 49 | Reglamento Interno vigente, entregado e ingresado | D-07, R-18 |
| 50 | Remision previa del Reglamento Interno | R-16 |
| 51 | Revision periodica del Reglamento Interno | R-17 |
| 52 | Contenido minimo del Reglamento Interno | D-07 |
| 53 | Mapas de riesgos visibles | D-08 |
| 54 | Programa de vigilancia ambiental | D-11, R-24, R-26 |
| 55 | Programa de vigilancia de la salud | D-12, R-24, R-25, R-26 |
| 56 | Autorizacion para asistir a examenes | R-27 |
| 57 | Traslado de puesto por enfermedad profesional | P-11, R-28 |
| 58 | Implementacion de medidas prescritas | R-38 |
| 59 | Investigacion con enfoque de genero | P-07, R-31 |
| 60 | Registro documental fidedigno | R-39 |

Solo dos puntos de los 60 carecen de artefacto documental propio: el 33 y el 42, ambos referidos a facilidades y recursos que la entidad otorga. Se acreditan de forma indirecta con la regularidad de las actas, las entregas y la dotacion registrada. Todo el resto del FUF es documentable, y por lo tanto esta dentro del alcance del sistema.

---

## Expediente de fiscalizacion exportable

Estructura sugerida del paquete que el sistema debe generar por obra y por periodo. Es la materializacion del Art. 72 y la respuesta directa al FUF 60.

```
Expediente_DS44_<empresa>_<obra>_<periodo>/
  00_Indice.pdf                  indice con estado de cada artefacto y hash
  01_Documentos_rectores/        D-01 a D-13
  02_Procedimientos/             P-01 a P-11
  03_Organizacion_preventiva/    R-01 a R-10
  04_Informacion_y_difusion/     R-11 a R-19
  05_Capacitacion/               R-20, R-21
  06_EPP/                        R-22, R-23
  07_Vigilancia/                 R-24 a R-28
  08_Siniestralidad/             R-29 a R-34
  09_Emergencias/                R-35, R-36
  10_Coordinacion_faena/         R-37
  11_Prescripciones/             R-38
  12_Metadata/                   manifiesto de integridad y cadena de firmas
```

Reglas del expediente:

- El indice declara, por cada artefacto, si esta COMPLETO, INCOMPLETO o NO APLICA, con la justificacion normativa del NO APLICA. Un expediente que oculta lo faltante es peor que uno incompleto.
- Cada PDF lleva su metadata visible: version, fecha de aprobacion, firmantes y hash.
- Los artefactos que no aplican por tramo de dotacion no se incluyen como carpetas vacias, se declaran en el indice.
- El manifiesto de integridad permite al fiscalizador verificar que nada fue alterado despues de la firma.

---

## Prompt para la revision con Claude Code

```
Contexto: sistema Build & Serve, plataforma multi tenant de cumplimiento del DS 44/2024
(Chile) para empresas constructoras. Modelo jerarquico: empresa, obra, trabajadores,
documentos, capacitaciones, actividades, asignaciones, hallazgos e incidentes, firma
digital con PIN.

Adjunto DS44_Catalogo_Evidencia.md, que define 63 artefactos documentales exigidos por
el DS 44/2024 (13 documentos rectores, 11 procedimientos, 39 registros), cada uno con su
articulo, aplicabilidad por tramo, contenido minimo, firmante, vigencia, evento gatillante
y los puntos del Formulario Unico de Fiscalizacion que acredita.

Tarea: auditar si el sistema puede PRODUCIR cada artefacto como evidencia valida.

No auditamos si la empresa cumple la norma. Auditamos si el software genera, resguarda
y exporta la evidencia. Por cada artefacto del catalogo:

1. Localiza en el codigo la entidad, migracion, servicio, endpoint y vista que lo generan.
   Cita ruta de archivo y linea.
2. Verifica el contenido minimo: cada campo declarado en el catalogo debe existir en el
   modelo y ser obligatorio donde la norma lo exige. Un campo opcional que la norma
   declara minimo es un hallazgo.
3. Verifica los seis atributos de evidencia valida: identificable, fechado, firmado por
   el rol normativo correcto, integro (hash, inmutabilidad post firma), difundido con
   acuse cuando corresponde, y exportable.
4. Verifica los plazos y periodicidades declarados, en backend y no solo en el formulario.
5. Verifica la aplicabilidad por tramo de dotacion donde el artefacto la declara.
6. Asigna estado: COMPLETO, INCOMPLETO, NO EXPORTABLE, NO EXISTE o NO APLICA.
7. Si no es COMPLETO, describe la brecha exacta y propone el cambio minimo de codigo.

Reglas:
- No asumas cumplimiento por el nombre de una clase, tabla o carpeta. Abre el archivo.
- NO EXPORTABLE equivale a no tenerlo. No lo suavices a INCOMPLETO.
- Un campo de fecha digitado por el usuario donde la norma exige inmediatez o
  anterioridad no acredita nada. Debe ser generado por el sistema.
- Revisa con atencion especial: el plazo de 30 dias corridos de D-06, los 15 dias habiles
  de R-01, la anterioridad del IRL respecto del inicio de labores en R-14, los 30 dias de
  anticipacion de R-16, la duracion minima de 8 horas en R-20 y de 1 hora en R-21, la
  desagregacion por sexo en R-29 a R-34, y la inmutabilidad post firma en R-39.

Entregable: tabla con columnas artefacto, articulo, modulo, entidad, endpoint, estado,
brecha y accion propuesta, seguida del detalle por artefacto.

Empieza por la familia D (documentos rectores, D-01 a D-13) y espera confirmacion antes
de continuar con P y R.
```

Recomendacion de uso: tres pasadas separadas, una por familia. La familia R es la mas larga y conviene subdividirla en los diez subgrupos (R.1 a R.10), porque son modulos distintos del sistema y mezclarlos hace que el modelo generalice.

---

## Orden de prioridad para el ejercicio

Priorizado por probabilidad de que el fiscalizador lo pida y por facilidad de objetivar el incumplimiento:

1. **R-39** expediente exportable. Si falla, arrastra todo lo demas.
2. **D-04 y D-06** MIPER y PTP, con el plazo de 30 dias corridos entre ambos. Es aritmetica verificable en un minuto.
3. **R-14** acta IRL. Una firma posterior al inicio de labores es un incumplimiento evidente en la traza de fechas.
4. **R-20 y R-21** capacitaciones. Duracion minima y periodicidad son numeros, no criterios.
5. **R-01** acta del CPHS y los 15 dias habiles. Fecha contra fecha.
6. **R-22 y R-23** EPP, entrega vinculada al riesgo y certificacion vigente.
7. **R-29 a R-34** indicadores, con el conjunto correcto segun tramo y desagregacion por sexo.
8. **R-37** coordinacion en faena compartida. En construccion aplica casi siempre y es el mas debil en sistemas multi tenant.

---

## Alcance y limitaciones

Este catalogo cubre la evidencia documental exigida por el DS 44/2024. Quedan deliberadamente fuera las obligaciones materiales que el software no ejecuta y que solo se acreditan de forma indirecta (FUF 33 y 42), y los procesos externos al DS44 como la evaluacion anual de la cotizacion adicional diferenciada del DS 67/1999.

El documento es una consolidacion tecnica para guiar una revision interna de software. No sustituye el criterio del experto en prevencion de riesgos del proyecto ni una asesoria legal formal. Las decisiones sobre aplicabilidad y suficiencia de evidencia deben validarse con el experto y, cuando corresponda, con el Organismo Administrador.
