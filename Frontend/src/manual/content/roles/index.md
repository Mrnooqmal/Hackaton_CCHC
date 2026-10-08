# Roles de usuario

Cada persona tiene un **rol**, que define qué puede ver y hacer en la plataforma. Hay **cinco
roles base**:

| Rol | Resumen |
| --- | --- |
| [Administrador](/roles/admin) | Configura la empresa y tiene acceso a todo. |
| [Prevencionista](/roles/prevencionista) | Opera el día a día del cumplimiento del DS 44 en la obra. |
| [Jefe de Obra](/roles/jefe-obra) | Dirige la obra: su equipo, sus documentos y su avance. |
| [Supervisor](/roles/supervisor) | Lidera una cuadrilla en terreno y dicta charlas. |
| [Trabajador](/roles/trabajador) | Firma lo que le corresponde, responde encuestas y reporta hallazgos. |

## Los permisos son configurables

Cada empresa puede **ajustar los permisos de cada rol** y crear roles nuevos desde
[Mi Empresa → Roles y permisos](/modulos/tenants#roles-y-permisos). La tabla de abajo muestra los
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

## Lo que cualquiera puede hacer

Sin permisos especiales, toda persona puede:

- **Firmar** lo que se le asigna, en [Mis firmas](/modulos/firmas).
- **Responder** las encuestas que se le asignan.
- **Reportar un hallazgo**.
- Ver sus **notificaciones** y su **Inicio**.

## La vista de empresa

**Obras** (el listado y *Nueva obra*), **Personas** de toda la empresa, **Mi Empresa**,
**Onboarding** y **Catálogos** están en la **vista de empresa**, y para entrar a ella se necesita
el permiso **Ver Mi Empresa**. Si un rol tiene, por ejemplo, *Crear obra* o *Gestionar catálogo
de EPP* pero no *Ver Mi Empresa*, no llegará a esas pantallas: el administrador debe darle
también ese permiso.

## Rol y cargo no son lo mismo

El **rol** define qué puede hacer la persona en la plataforma. El **cargo** es su oficio en obra
(carpintero, jornal, trazador…) y define qué le exige el DS 44 en su onboarding. Ver
[Personas](/modulos/personas).
