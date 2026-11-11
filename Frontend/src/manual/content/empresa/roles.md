# Roles y permisos

Cada persona tiene un **rol**, que define qué puede ver y hacer en la plataforma. Los roles los asigna la empresa: la plataforma no verifica quién es realmente prevencionista o supervisor, solo aplica los permisos del rol asignado.

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

## Los permisos son configurables

Cada empresa puede **ajustar los permisos de cada rol** y crear roles nuevos desde
[Mi Empresa → Roles y permisos](#roles-y-permisos). La tabla de abajo muestra los
permisos **por defecto**; lo que cada persona puede hacer en tu empresa depende de su
configuración.

| Permiso | Admin | Prevencionista | Jefe de Obra | Supervisor | Trabajador |
| --- | :-: | :-: | :-: | :-: | :-: |
| **Obras** | | | | | |
| Ver obras | Sí | Sí | Sí | Sí |  |
| Crear obra | Sí |  | Sí |  |  |
| Ver detalle | Sí | Sí | Sí | Sí |  |
| Asignar trabajadores | Sí |  | Sí | Sí |  |
| Subir documentos de fase | Sí | Sí | Sí |  |  |
| Firma asistida | Sí | Sí | Sí | Sí |  |
| Gestionar cargos y kits | Sí |  | Sí |  |  |
| **Personas** | | | | | |
| Ver personas | Sí | Sí | Sí | Sí |  |
| Añadir personas | Sí |  | Sí |  |  |
| Ver detalle | Sí | Sí | Sí | Sí |  |
| Exportar reporte | Sí |  | Sí |  |  |
| Actualizar onboarding | Sí | Sí | Sí |  |  |
| Registrar entregas de EPP | Sí | Sí | Sí |  |  |
| Editar vigilancia de salud | Sí | Sí | Sí |  |  |
| Desvincular persona | Sí |  | Sí |  |  |
| Restablecer PIN de firma | Sí |  |  |  |  |
| **Repositorio** | | | | | |
| Ver archivos | Sí | Sí | Sí | Sí |  |
| Subir documento | Sí | Sí | Sí |  |  |
| **Firma electrónica** | | | | | |
| Crear solicitud de firma | Sí | Sí | Sí | Sí |  |
| **Incidentes** | | | | | |
| Ver estadísticas | Sí | Sí | Sí | Sí |  |
| Ver historial | Sí | Sí | Sí | Sí |  |
| Reportar incidente | Sí | Sí | Sí | Sí |  |
| Calificar accidente | Sí | Sí | Sí |  |  |
| **Encuestas** | | | | | |
| Crear encuesta | Sí | Sí | Sí |  |  |
| **Actividades** | | | | | |
| Ver actividades | Sí | Sí | Sí | Sí | Sí |
| Crear actividad | Sí | Sí | Sí | Sí |  |
| Planificar el mes | Sí | Sí | Sí |  |  |
| **Mi Empresa** | | | | | |
| Ver Mi Empresa | Sí |  |  |  |  |
| Gestionar roles y permisos | Sí |  |  |  |  |
| Gestionar cargos | Sí |  |  |  |  |
| Gestionar catálogo de EPP | Sí | Sí | Sí |  |  |
| Configurar identidad | Sí |  |  |  |  |
| Habilitar la Ficha Básica de Salud | Sí |  |  |  |  |
| Derechos de los titulares | Sí |  |  |  |  |
| Aprobar y ejecutar supresiones | Sí |  |  |  |  |

## La vista de empresa

**Obras** (el listado y *Nueva obra*), **Personas** de toda la empresa, **Mi Empresa**,
**Onboarding** y **Catálogos** están en la **vista de empresa**, y para entrar a ella se necesita
el permiso **Ver Mi Empresa**. Si un rol tiene, por ejemplo, *Crear obra* o *Gestionar catálogo
de EPP* pero no *Ver Mi Empresa*, no llegará a esas pantallas: el administrador debe darle
también ese permiso.

## Rol y cargo no son lo mismo

El **rol** define qué puede hacer la persona en la plataforma. El **cargo** es su oficio en obra
(carpintero, jornal, trazador…) y define qué le exige el DS 44 en su onboarding. Ver
[Personas](/empresa/personas).
