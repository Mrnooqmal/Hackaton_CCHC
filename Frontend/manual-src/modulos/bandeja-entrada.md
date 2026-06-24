# Módulo: Bandeja de Entrada

**Ubicación:** `Frontend/src/pages/Inbox.tsx` · `Backend/handlers/inbox-module/`

Sistema de mensajería interna y notificaciones. Centraliza las comunicaciones entre
personas y las alertas automáticas que generan otros módulos.

## Gestión de mensajes

- Envío de mensajes individuales o grupales.
- Tipos de mensaje: **Normal**, **Alerta**, **Urgente**.
- Adjuntar archivos.
- Marcar como leído / no leído.
- Archivar mensajes.

## Notificaciones automáticas

La bandeja es el destino de los eventos que emiten otros módulos a través del
`EventBus`:

| Evento | Origen | Resultado |
| --- | --- | --- |
| `document.assigned` | [Documentos](/modulos/documentos) | Notificación de documento por firmar |
| `incident.created` | [Incidentes](/modulos/incidentes) | Alerta al prevencionista |

Además ofrece:

- Notificaciones push en tiempo real.
- Contador de mensajes no leídos.
- Alertas destacadas para mensajes urgentes.

## Estructura (InboxTable)

```
recipientId   personaId del destinatario (PK)
messageId     ID del mensaje (SK)
senderId      personaId del remitente
tenantId      FK
tipo          normal | alerta | urgente
asunto / cuerpo / adjuntos
leido         BOOL
archivado     BOOL
createdAt
```

La PK es `recipientId` (la persona destinataria), lo que permite consultar de forma
eficiente la bandeja de cada persona. Un GSI por `senderId` permite ver lo enviado.

## Endpoints relacionados

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/inbox/send` | Enviar mensaje |
| `GET` | `/inbox` | Obtener mensajes |
| `PUT` | `/inbox/{id}/read` | Marcar como leído |
| `PUT` | `/inbox/{id}/archive` | Archivar |
| `DELETE` | `/inbox/{id}` | Eliminar |
