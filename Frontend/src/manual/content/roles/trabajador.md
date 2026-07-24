# Rol: Trabajador

El **trabajador** es la persona en terreno. Su interacción con la plataforma se centra
en firmar lo que se le asigna y registrar su asistencia a actividades.

## Responsabilidades

- Firmar los documentos que se le asignan (recepción de reglamento, EPP, etc.).
- Asistir y firmar charlas y capacitaciones.
- Reportar condiciones inseguras (hallazgos).
- Responder encuestas y declaraciones de salud.

## Permisos

| Módulo | Acceso |
| --- | --- |
| Dashboard | 👁 Sus pendientes y actividades |
| Obras | ✗ Sin acceso |
| Documentos | 👁 Los asignados a él |
| Firmas | ✓ Firma de lo que le corresponde |
| Incidentes | 👁 Reportar hallazgos |
| Actividades | 👁 Asistir y firmar |
| Encuestas | 👁 Responder las asignadas |
| Asistente IA | ✗ Sin acceso |
| Personas | ✗ Sin acceso |
| Bandeja de Entrada | ✓ Recibir notificaciones |
| Tenants | ✗ Sin acceso |

## Acceso web opcional

No todos los trabajadores tienen acceso web. Según `tieneAccesoWeb`:

- **Con acceso web**: inicia sesión, ve sus pendientes y firma desde su dispositivo.
- **Sin acceso web**: no tiene `passwordHash`, pero sí `pinHash` para firmar en el
  dispositivo del supervisor en terreno.

Ver detalle en [Personas](/modulos/personas).

## Firma con PIN

El trabajador firma con su **PIN personal**. La firma queda registrada de forma
inmutable con PIN + IP + timestamp. Puede firmar también **sin conexión**, sincronizando
después. Ver [Firmas](/modulos/firmas).

::: warning
La validez del PIN como firma electrónica está en consulta legal. Ver
[Firmas digitales y DS44](/ds44/firmas-digitales).
:::
