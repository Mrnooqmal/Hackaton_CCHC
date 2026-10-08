# Mi Empresa

**Mi Empresa** es donde se configura la empresa: su identidad, quién la representa, sus roles y
permisos, sus cargos, el catálogo de EPP, la ficha de salud y la gestión de los datos personales.
Normalmente la usa el **Administrador**.

Cada empresa está **aislada**: sus obras, personas y documentos solo los ve ella.

Está en la **vista de empresa**: en el menú lateral, **Mi Empresa**. Arriba hay pestañas, y solo
verás las que tu rol permite.

![Mi Empresa con sus pestañas](/img/tenants/mi-empresa.png)

## Identidad

### Datos de la empresa

- **Razón social** — el nombre con el que la empresa aparece en la plataforma y en los
  documentos.
- **RUT** — se muestra pero **no se puede modificar**.
- **Representante legal** — elige a la persona. Es quien **aprueba el Programa de Trabajo
  Preventivo** (Art. 8) con su firma. **Sin designarlo, el programa no se puede aprobar.** Se
  guarda al elegirlo, y desde ese momento le llegan a firmar los programas de todas las obras.

### Logo y color

- **Logo** — reemplaza el nombre Build & Serve en la barra superior.
- **Color principal** — se aplica a botones, enlaces y elementos activos. Elige uno de los
  sugeridos o uno propio.

### Organizaciones sindicales

Los sindicatos de la empresa, con nombre y contacto. El DS 44 obliga a **remitirles el reglamento
interno**. Si en la empresa **no hay ninguno**, decláralo con **En la empresa no hay
organizaciones sindicales**: queda registrado con su fecha y el requisito deja de exigirlo.

### Sistema de Gestión de Seguridad y Salud en el Trabajo

Los cinco componentes que el **Art. 22** exige como contenido mínimo:

1. Política de Seguridad y Salud en el Trabajo.
2. Estructura organizacional para la gestión preventiva.
3. Diagnóstico, planificación y programación de la actividad preventiva.
4. Evaluación o auditoría periódica del desempeño.
5. Acciones de mejora continua o correctivas.

Algunos se acreditan subiendo un documento aquí mismo; los otros se acreditan en su módulo y
aquí solo se enlazan (**Ver**).

### Estructura preventiva y cumplimiento

Más abajo están la **Estructura preventiva** de la empresa (los órganos que le corresponden
según su dotación; los de cada obra se gestionan en la obra) y el **Cumplimiento del Formulario
Único de Fiscalización** de esos requisitos. Ver
[Estructura preventiva](/modulos/estructura-preventiva).

## Roles y permisos

Los **roles** definen qué puede hacer cada persona. La empresa parte con cinco roles base, y
aquí puedes ajustarlos o crear otros:

- **Añadir rol** — con nombre, descripción y permisos.
- **Permisos** — marca qué puede hacer cada rol. Están agrupados por módulo (Obras, Personas,
  Repositorio, Firma electrónica, Incidentes, Encuestas, Actividades, Mi Empresa). Algunos
  traen una nota que explica su alcance.
- **Eliminar rol** — junto a cada rol ves cuántas personas lo tienen. Si lo eliminas, tendrás
  que **reasignarlas** a otro rol. Los cinco **roles base** (marcados con un candado) no se
  eliminan: puedes renombrarlos y ajustar sus permisos.

Toca **Guardar cambios** al terminar.

> El rol **Administrador** tiene **acceso total** a todos los módulos y sus permisos no se
> editan. Así nadie deja a la empresa sin administrador por error.

![Roles y permisos](/img/tenants/roles.png)

Algunos permisos merecen cuidado, porque **por defecto solo los tiene el administrador**:

| Permiso | Por qué |
| --- | --- |
| **Restablecer PIN de firma** | Quien lo tiene puede dejar a cualquiera sin poder firmar. |
| **Habilitar la Ficha Básica de Salud** | Decide si se recolectan datos de salud de todo el personal. |
| **Derechos de los titulares** | Ve qué pidió cada persona sobre sus datos y decide sobre ellos. |
| **Aprobar y ejecutar supresiones** | Borra datos personales sin vuelta atrás. |

## Cargos

El catálogo de **cargos** de la empresa (carpintero, jornal, maestro albañil, trazador…). Cada
uno aparece como **Predefinido** (viene de fábrica), **Personalizado** (lo creó la empresa) o
**Heredado**, con cuántas personas lo tienen.

Lo que el DS 44 exige a cada cargo (su **kit de onboarding**) se edita en **Onboarding por
cargo**, el botón de esta pestaña. Ver [Onboarding por cargo](/modulos/onboarding-cargos).

## EPP

El catálogo de **elementos de protección personal** de la empresa. Las entregas de EPP solo
pueden incluir elementos de este catálogo.

1. Toca **Nuevo elemento**.
2. Escribe el **Nombre del elemento** y, si quieres, una descripción.
3. Sube los **respaldos obligatorios del DS 44**:
   - **Certificado de calidad o registro ISP**.
   - **Instructivo de uso y mantención** (uso, mantenimiento, reposición o recambio).

Puedes guardar un elemento sin sus respaldos, pero quedará marcado como **incompleto** en el
catálogo y en cada entrega que lo incluya.

## Ficha de salud

Activa o desactiva la **Ficha Básica de Salud**: un cuestionario de antecedentes de salud que
se envía a todo el personal (y a cada persona nueva) como una encuesta más. Las respuestas se
guardan cifradas y solo las ve quien tiene el permiso de vigilancia de la salud. Ver
[Encuestas](/modulos/encuestas#la-ficha-básica-de-salud).

El **Historial** muestra quién la habilitó o deshabilitó y cuándo. No se puede editar.

## Datos personales y Supresiones

Estas dos pestañas sirven para cumplir la **Ley 21.719** de protección de datos personales:
registrar y responder lo que una persona pide sobre sus datos, y borrar datos cuando
corresponde. Ver [Datos personales](/modulos/datos-personales).

## Preguntas frecuentes

**¿Por qué no puedo cambiar el RUT de la empresa?**
Identifica a la empresa y queda fijo desde el registro. Si hay un error, contacta al soporte.

**Cambié el color y el logo, pero no se ven.**
Recarga la página.

**¿Qué diferencia hay entre un rol y un cargo?**
El **rol** define los permisos en la plataforma. El **cargo** es el oficio en obra y define qué
le exige el DS 44.

**El programa preventivo de la obra dice "Designar".**
Falta el **representante legal**. Desígnalo en **Identidad**.

**¿Quién puede entrar a Mi Empresa?**
Quien tenga el permiso **Ver Mi Empresa**. Cada pestaña depende además de su propio permiso.
