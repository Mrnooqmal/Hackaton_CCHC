# Arquitectura — Visión general

Build & Serve es una aplicación **serverless multi-tenant** desplegada sobre AWS. Esta
sección documenta el modelo de datos, el aislamiento entre clientes y la estructura de
almacenamiento.

## Diagrama de alto nivel

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────────┐
│   Frontend  │      │ API Gateway  │      │   AWS Lambda        │
│ React + Vite│ ───▶ │   (REST)     │ ───▶ │ Handlers (itty)     │
│  CloudFront │      │              │      │ lib/services        │
└─────────────┘      └──────────────┘      └──────────┬──────────┘
                                                       │
              ┌────────────────────────────────────────┼───────────────────────┐
              ▼                    ▼                     ▼                        ▼
        ┌───────────┐       ┌───────────┐        ┌───────────┐           ┌───────────┐
        │ DynamoDB  │       │    S3     │        │    SNS    │           │  Bedrock  │
        │ 11 tablas │       │ documentos│        │  notif.   │           │ Claude 3  │
        └───────────┘       │ evidencias│        └───────────┘           │  + Gemini │
                            └───────────┘                                └───────────┘
```

## Stack tecnológico

| Capa | Tecnología |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router v7 |
| API | AWS Lambda + API Gateway, itty-router |
| Cómputo | Node.js 18.x, Serverless Framework 4.x |
| Base de datos | AWS DynamoDB (PAY_PER_REQUEST) |
| Almacenamiento | AWS S3 |
| Notificaciones | AWS SNS + bandeja interna (DynamoDB) |
| Correo | AWS SES |
| IA | AWS Bedrock (Claude 3 Sonnet) + Google Gemini |
| Autenticación | JWT + Bcrypt + PIN |
| CDN | CloudFront |

## Patrones de diseño

- **Aislamiento por tenant**: `tenantId` desde el JWT, nunca del body.
- **Identidad unificada**: una sola entidad `Persona` (antes Users + Workers).
- **Estrategia de firma**: `FirmaService` con métodos PIN / OFFLINE / PRESENCIAL / BIOMETRIC.
- **Event Bus**: eventos asíncronos (`document.assigned`, `incident.created`) hacia la
  bandeja de entrada.
- **Control de acceso por rol**: validado en `lib/permissions.js`.
- **Ciclo de Deming**: las obras se gestionan por fases normativas (PDCA).

## Secciones

- [Base de datos (DynamoDB)](/arquitectura/base-de-datos) — las 11 tablas, keys y GSIs.
- [Multi-tenant](/arquitectura/multi-tenant) — aislamiento y jerarquía de entidades.
