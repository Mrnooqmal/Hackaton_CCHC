# DS 44/2024 - Hitos documentales de Build & Serve

Catalogo de auditoria acotado a los artefactos que constituyen evidencia
exhibible en fiscalizacion. Reemplaza cualquier version anterior.

## Criterio de inclusion

Solo entran dos cosas:

1. Los nodos marcados con el simbolo DOCUMENTO (rectangulo de base ondulada,
   ANSI/ISO 5807) en los flujogramas SGSST del proyecto. Son siete: cinco en
   PLAN, uno en DO, uno en CHECK. En ACT no hay ninguno.
2. La evidencia a nivel de persona que se exhibe en terreno: informacion de
   riesgos, capacitaciones, entrega de EPP y charlas diarias.

Quedan FUERA por decision de alcance: procedimientos, subprocesos operativos,
actas de organos (CPHS, delegado), actas de simulacro, informes de
investigacion y registros de medidas prescritas. Son pasos del proceso o
insumos que ayudan a generar un documento, no el documento que se exhibe.

## Alcance del sistema

Build & Serve es gestion documental y de evidencia. No valida el contenido de
un documento cargado ni verifica investiduras de roles. Lo que sube el usuario
es responsabilidad del usuario. La pregunta de la auditoria es una sola: cuando
el fiscalizador pida el artefacto, el sistema lo entrega.

## Criterio de soporte

Un artefacto esta SOPORTADO si el sistema permite, para el:

1. Tipificarlo: existe el tipo y es seleccionable en la interfaz.
2. Asociarlo al nivel correcto: empresa, obra, persona o evento.
3. Cargarlo con su metadata (fecha, version, vigencia).
4. Firmarlo o acusar recepcion donde la norma exige firma o difusion. No
   importa el rol del firmante, importa que la firma quede registrada.
5. Recuperarlo y descargarlo.

Estados: SOPORTADO, PARCIAL, NO SOPORTADO, NO APLICA. En PARCIAL se indican
los numeros de criterio faltantes.

---

## Documentos del flujograma

### DOC-01. Politica de Seguridad y Salud en el Trabajo
- Fase: PLAN
- Art.: 22 letra a
- Aplica: todas
- Firma: representante legal
- Difusion: si, a todas las personas trabajadoras con acuse
- Gatillante: cambio de representante legal o cambio estructural
- Acredita FUF: 1

### DOC-02. Matriz Legal aplicable
- Fase: PLAN
- Art.: 64.2 (diagnostico de aspectos legales)
- Aplica: todas
- Firma: no exigida
- Difusion: no
- Gatillante: cambio normativo, nuevo rubro o centro de trabajo
- Acredita FUF: apoya 1

### DOC-03. MIPER
- Fase: PLAN
- Art.: 7
- Aplica: todas, por obra o centro de trabajo
- Firma: no exigida, requiere autor identificable
- Difusion: si, a trabajadores, CPHS, delegado, dirigentes sindicales y linea
  de mando
- Vigencia: revision al menos anual
- Gatillante: cambio de condiciones de trabajo, accidente del trabajo,
  enfermedad profesional, riesgo grave e inminente
- Acredita FUF: 2, 3, 4, 5, 6

### DOC-04. Mapa de riesgos
- Fase: PLAN
- Art.: 62
- Aplica: todas, por lugar de trabajo
- Firma: no exigida
- Difusion: publicado en sitios visibles
- Gatillante: actualizacion de la MIPER
- Acredita FUF: 53

### DOC-05. Reglamento Interno (RIHS o RIOHS)
- Fase: PLAN
- Art.: 56 a 61
- Aplica: todas. RIHS de 1 a 9 trabajadores, RIOHS de 10 o mas
- Firma: representante legal
- Difusion: entrega gratuita con registro de recepcion por trabajador
- Vigencia: revision no inferior a 1 ano
- Metadata critica: comprobante de ingreso al sitio web de la Direccion del
  Trabajo, fecha de entrada en vigencia
- Acredita FUF: 49, 52

### DOC-06. Registro de accidentes del trabajo, enfermedades profesionales e
incidentes peligrosos
- Fase: DO
- Art.: 72, 73, 75
- Aplica: todas
- Firma: no exigida
- Contenido estructurado: el sistema lo genera, no lo carga el usuario. Cada
  evento con fecha, lugar, relato y sexo de la persona afectada
- Acredita FUF: 46, 47

### DOC-07. Informe anual de gestion preventiva
- Fase: CHECK
- Art.: 52.15 inc. final
- Aplica: solo sobre 100 personas trabajadoras. Bajo ese tramo, NO APLICA
- Firma: experto a cargo del Departamento de Prevencion
- Difusion: acceso de lectura para CPHS, trabajadores y representantes
- Vigencia: anual
- Acredita FUF: 43

---

## Evidencia a nivel de persona

### EV-01. Acta de Informacion de Riesgos Laborales (IRL, ex ODI)
- Fase: DO
- Art.: 15
- Aplica: todas, por trabajador
- Firma: la persona trabajadora
- Plazo critico: la firma debe ser ANTERIOR a la fecha de inicio de labores
- Gatillante: nuevo proceso, cambio de tecnologia, materiales o sustancias
- Acredita FUF: 21, 22

### EV-02. Registro de capacitacion en prevencion de riesgos
- Fase: DO
- Art.: 16
- Aplica: todas, por trabajador
- Firma: asistencia firmada
- Metadata critica: duracion minima 8 horas, periodicidad segun el programa
  sin exceder 2 anos
- Acredita FUF: 23, 24

### EV-03. Registro de capacitacion en uso y mantencion de EPP
- Fase: DO
- Art.: 13 inc. 3 y 4
- Aplica: si hay EPP, por trabajador
- Firma: asistencia firmada
- Metadata critica: duracion minima 1 hora por EPP
- Acredita FUF: 18, 19

### EV-04. Registro de entrega de EPP
- Fase: DO
- Art.: 13 inc. 1 y 2
- Aplica: si hay EPP, por trabajador
- Firma: firma de recepcion del trabajador
- Metadata critica: entrega libre de costo, certificacion de calidad o
  registro ISP del modelo entregado
- Acredita FUF: 14, 15, 16

### EV-05. Registro de charlas diarias o analisis de riesgo de la tarea
- Fase: DO
- Art.: no exigido nominalmente por el DS44. Se apoya en el Art. 15 inc. 1,
  informacion de riesgos oportuna y ante cambios, y en el programa de trabajo
  preventivo
- Aplica: practica estandar en construccion, exigible en terreno
- Firma: asistencia firmada por los participantes
- Metadata critica: fecha, obra, tema tratado, asistentes
- Acredita FUF: apoya 21

---

## Nota sobre DOC-06

Es el unico artefacto del catalogo que el sistema GENERA en vez de custodiar.
Los otros once son documentos o registros que se cargan o se producen a partir
de datos que el usuario ingresa. Para DOC-06 el contenido si se audita campo
por campo.

## Nota sobre la fase ACT

No genera documentos propios. Se acredita mediante el versionado de DOC-03
(MIPER) y DOC-05 (Reglamento Interno), con motivo de actualizacion registrado.
Se audita como parte del criterio 3 de esos dos artefactos, no como artefacto
separado.
