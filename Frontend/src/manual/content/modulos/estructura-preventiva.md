# Estructura preventiva

El DS 44 exige que, según cuántas personas trabajan, exista un **órgano preventivo**: un comité
paritario, un delegado, un departamento de prevención o un encargado. Este módulo registra esos
órganos, sus integrantes, sus documentos y sus reuniones.

## Qué órgano corresponde

| Órgano | Cuándo es obligatorio | Dónde se gestiona |
| --- | --- | --- |
| **Delegado de Seguridad y Salud en el Trabajo** | Entre 10 y 25 personas en el lugar de trabajo | En la obra |
| **Comité Paritario de Higiene y Seguridad** | Más de 25 personas en el lugar de trabajo | En la obra (o en la empresa) |
| **Encargado en materia de Gestión del Riesgo** | Empresas de hasta 100 personas | En la empresa |
| **Departamento de Prevención de Riesgos** | Empresas de más de 100 personas | En la empresa |

La plataforma lo calcula sola con la **dotación**: la de cada obra para el comité y el delegado,
y la de la empresa para el departamento y el encargado. Los órganos que no son obligatorios se
pueden constituir igual, como voluntarios.

## Dónde está

- **En la obra**: **Detalle de obra → Cumplimiento DS 44 → Planificar → Estructura preventiva**.
- **En la empresa**: **Mi Empresa → Identidad → Estructura preventiva**.

Cada órgano aparece con su estado: **Obligatorio · pendiente** si falta constituirlo, **No
obligatorio**, o **Mandato vencido** si ya pasó su período.

## Constituir un órgano

Constituir y administrar órganos requiere los permisos **Crear obra** o **Ver Mi Empresa** (por
defecto, Administrador y Jefe de Obra).

Para llegar, en la obra entra a **Detalle de obra**, abre la pestaña **Cumplimiento DS 44**, elige
la fase **Planificar** y, en **Módulos de Planificar**, toca **Estructura preventiva**:

![Módulo Estructura preventiva en la fase Planificar de la obra](/img/estructura/acceso.png)

Se abre el panel con los órganos de la obra. Toca **Constituir** en el que corresponde (si no es
obligatorio, el botón dice **Constituir de todas formas**; si el mandato venció, **Renovar**):

![Panel de estructura preventiva con el botón para constituir](/img/estructura/constituir.png)

Se abre el formulario, en tres pasos:

![Formulario para constituir el órgano, paso Datos](/img/estructura/formulario.png)


1. **Datos** — la **fecha de elección de los representantes**, la **fecha de constitución**
   (ninguna puede ser futura) y el **término del mandato**.
   En el comité paritario, el mandato dura **2 años** desde la elección (Art. 23): la plataforma
   lo calcula, y solo se puede acortar, nunca extender.
2. **Integrantes** — para cada persona: su **estamento** (*Entidad empleadora*, designado, o
   *Personas trabajadoras*, electo), su **calidad** (*Titular* o *Suplente*) y su **cargo**
   (*Presidente*, *Secretario* o *Integrante*). La plataforma te avisa si falta corregir algo de
   la composición.
3. **Documentos** — según el órgano: acta de elección, designación de la entidad empleadora,
   acta de constitución, comprobante de registro en la Dirección del Trabajo, registro Seremi del
   experto, designación del encargado o capacitación del organismo administrador.


> La plataforma **no verifica** que las personas cumplan los requisitos legales del cargo ni que
> la designación sea válida: eso es responsabilidad de la empresa. Aquí se registra quién
> integra el órgano.

## La ficha del órgano

Al abrir un órgano ves su **estado**, origen, fechas de elección y constitución, la dotación al
constituirlo, sus **integrantes** y sus **documentos**. Si ya no corresponde, puedes
**Disolver** el órgano.

### Reuniones del comité paritario

Las **reuniones ordinarias son mensuales** (Art. 39) y se programan solas al constituir el
comité.

- **Registrar acta** — para cada reunión realizada, la **fecha efectiva** y el **acta de la
  reunión**. **Sin el acta adjunta, la reunión no se puede dar por realizada.**
- **Convocar extraordinaria** — con su **causal**. Las extraordinarias no cuentan para la
  periodicidad mensual.

El comité tiene además su **programa de trabajo**: uno por período, con las funciones del Art.
47 como contenido de referencia.

## Avisos

La plataforma avisa en las [Notificaciones](/modulos/bandeja-entrada) de los responsables cuando:

- Falta **constituir** un órgano obligatorio.
- Falta el **comprobante de registro del comité en la Dirección del Trabajo** (el plazo legal es
  de 15 días hábiles desde la elección; el aviso llega antes).
- Se acerca o venció el plazo del **curso de orientación en prevención** de los integrantes
  electos (primer semestre del mandato).
- Una **reunión ordinaria** del mes quedó **sin acta**.
- El **programa de trabajo** del comité vence este mes.

## Preguntas frecuentes

**Mi obra tiene 8 personas. ¿Por qué no me pide comité ni delegado?**
Porque con menos de 10 personas el DS 44 no exige un órgano en la obra. Esos requisitos
aparecen como **No aplica** y no bajan el porcentaje de cumplimiento.

**¿Cómo cuenta la plataforma a las personas de la obra?**
Con el equipo asignado a la obra en [Personas](/modulos/personas#el-equipo-de-una-obra), salvo
que la obra tenga una dotación declarada, que se ve en **Detalle de obra → Resumen**. Mantén el
equipo al día para que el cálculo sea correcto.

**¿Los integrantes del comité firman distinto?**
No. Pero como representantes de los trabajadores, reciben aviso cuando se publica una nueva
versión de la matriz de riesgos, del programa preventivo o del reglamento.
