# Sistema de Gestión de Seguridad Laboral CCHC

Sistema integral de gestión de seguridad laboral desarrollado para la Cámara Chilena de la Construcción (CCHC). Plataforma web moderna que digitaliza y optimiza los procesos de seguridad en obras de construcción.


## Características Principales

- **Gestión de Incidentes y Accidentes**: Reporte, seguimiento y análisis estadístico de eventos de seguridad
- **Sistema de Firmas Digitales**: Firma electrónica de documentos 
- **Gestión Documental**: Almacenamiento y organización de documentos de seguridad
- **Encuestas y Evaluaciones**: Sistema de encuestas personalizables para trabajadores
- **Asistente IA**: Chatbot inteligente con AWS Bedrock para matrices de riesgo
- **Sistema de Mensajería**: Bandeja de entrada interna para comunicaciones
- **Gestión de Trabajadores**: Administración completa de personal y roles
- **Dashboard Analítico**: Visualización de KPIs y métricas de seguridad

## Arquitectura del Sistema

### Frontend
- **Framework**: React 18 con TypeScript
- **Routing**: React Router v6
- **Estilos**: CSS Variables + Diseño modular
- **Estado**: Context API para autenticación
- **Build**: Vite

### Backend
- **Framework**: Serverless Framework (AWS Lambda)
- **Runtime**: Node.js 18.x
- **Base de Datos**: AWS DynamoDB
- **Almacenamiento**: AWS S3
- **Notificaciones**: AWS SNS
- **IA**: AWS Bedrock (Claude 3 Sonnet)
- **Autenticación**: JWT + Bcrypt



## Módulos del Sistema

### 1. Módulo de Incidentes y Accidentes

**Ubicación**: `Frontend/src/pages/Incidents.tsx` | `Backend/handlers/incidents.js`

Sistema completo para la gestión de eventos de seguridad laboral.

#### Funcionalidades Principales:

**Reporte de Incidentes**
- Formulario detallado con clasificación (Hallazgo/Incidente)
- Tipos: Accidente, Incidente, Condición Subestándar
- Niveles de gravedad: Leve, Grave, Fatal
- Información del trabajador afectado (RUT, nombre, cargo, género)
- Etapa constructiva del evento
- Carga de evidencias fotográficas (múltiples archivos)
- Confirmación de veracidad del reporte

**Sistema de Notificaciones**
- Notificaciones automáticas a prevencionistas vía inbox
- Publicación en tópico SNS para integraciones externas
- Registro de autoría y timestamp

**Visualización y Análisis**
- **Vista Listado**: Tabla con filtros avanzados (tipo, estado, fechas)
- **Vista Estadísticas**: Dashboard analítico completo
  - KPIs: Tasa de accidentabilidad, días perdidos, siniestralidad
  - Gráfico de evolución temporal (líneas)
  - Distribución por clasificación (barras horizontales)
  - Distribución por gravedad (barras horizontales)
  - Calendario heatmap mensual con severidad por día
- Exportación de reportes (CSV y PDF)

**Detalle de Incidentes**
- Modal con información completa del evento
- Galería de evidencias con lightbox
- Información del trabajador y reportante
- Estado y seguimiento

#### Endpoints API:
```javascript
POST   /incidents              // Crear incidente
GET    /incidents              // Listar con filtros
GET    /incidents/{id}         // Obtener detalle
PUT    /incidents/{id}         // Actualizar
GET    /incidents/stats        // Estadísticas
GET    /incidents/analytics    // Datos para dashboard
POST   /incidents/quick-report // Reporte rápido vía QR
POST   /incidents/upload       // Subir evidencias
```

#### Tablas DynamoDB:
- **IncidentsTable**: Almacena todos los incidentes
  - PK: `incidentId`
  - GSI: `empresaId-fecha-index`
  - Atributos: tipo, gravedad, estado, trabajador, evidencias, etc.

---

### 2. Módulo de Firmas Digitales

**Ubicación**: `Frontend/src/pages/SignatureRequests.tsx` | `Backend/handlers/signature-requests.js`

Sistema de firma electrónica de documentos.

#### Funcionalidades:

**Creación de Solicitudes**
- Selección de trabajadores destinatarios
- Carga de documento PDF
- Configuración de fecha límite
- Descripción y contexto del documento

**Proceso de Firma**
- Timestamp automático
- Validación de identidad (RUT)


**Gestión de Solicitudes**
- Estados: Pendiente, Firmado, Rechazado, Expirado
- Filtros por estado

**Visualización**
- Lista de solicitudes enviadas/recibidas
- Detalle de firmas recolectadas
- Descarga de documentos firmados
- Historial de acciones

#### Endpoints API:
```javascript
POST   /signature-requests           // Crear solicitud
GET    /signature-requests           // Listar solicitudes
GET    /signature-requests/{id}      // Obtener detalle
POST   /signature-requests/{id}/sign // Firmar documento
PUT    /signature-requests/{id}      // Actualizar estado
DELETE /signature-requests/{id}      // Eliminar
```

---

### 3. Módulo de Documentos

**Ubicación**: `Frontend/src/pages/Documents.tsx` | `Backend/handlers/documents.js`

Gestión centralizada de documentos de seguridad.

#### Funcionalidades:

**Gestión de Documentos**
- Carga de archivos (PDF, Word, Excel, imágenes)
- Categorización por tipo
- Etiquetas personalizadas
- Búsqueda y filtros avanzados


**Compartir y Permisos**
- Compartir con trabajadores específicos
- Control de acceso por rol

#### Endpoints API:
```javascript
POST   /documents        // Subir documento
GET    /documents        // Listar documentos
GET    /documents/{id}   // Obtener documento
PUT    /documents/{id}   // Actualizar metadatos
DELETE /documents/{id}   // Eliminar documento
```

---

### 4.Módulo de Encuestas

**Ubicación**: `Frontend/src/pages/Surveys.tsx` | `Backend/handlers/surveys.js`

Sistema de encuestas y evaluaciones para trabajadores.

#### Funcionalidades:

**Creación de Encuestas**
- Constructor de preguntas drag-and-drop
- Tipos de pregunta:
  - Opción múltiple
  - Texto libre
  - Escala numérica
  - Sí/No
- Lógica condicional (skip logic)

**Distribución**
- Asignación a trabajadores específicos
- Asignación por rol o área
- Programación de envío


#### Endpoints API:
```javascript
POST   /surveys              // Crear encuesta
GET    /surveys              // Listar encuestas
GET    /surveys/{id}         // Obtener encuesta
POST   /surveys/{id}/respond // Responder encuesta
GET    /surveys/{id}/results // Obtener resultados
```

---

### 5.Módulo de Asistente IA

**Ubicación**: `Frontend/src/pages/AIAssistant.tsx` | `Backend/handlers/ai-assistant.js`

Chatbot inteligente con AWS Bedrock para consultas de seguridad.

#### Funcionalidades:

**Conversación Inteligente**
- Modelo: Claude 3 Sonnet (Anthropic)
- Contexto de seguridad laboral chilena
- Respuestas basadas en normativa vigente
- Sugerencias contextuales

**Capacidades**
- Consultas sobre normativa de seguridad
- Procedimientos de emergencia
- Interpretación de regulaciones
- Recomendaciones de EPP
- Análisis de riesgos

#### Endpoints API:
```javascript
POST   /ai-assistant/chat     // Enviar mensaje
```
---

### 6.Módulo de Bandeja de Entrada

**Ubicación**: `Frontend/src/pages/Inbox.tsx` | `Backend/handlers/inbox.js`

Sistema de mensajería interna para comunicaciones.

#### Funcionalidades:

**Gestión de Mensajes**
- Envío de mensajes individuales o grupales
- Tipos de mensaje: Normal, Alerta, Urgente
- Adjuntar archivos
- Marcar como leído/no leído
- Archivar mensajes


**Notificaciones**
- Notificaciones push en tiempo real
- Contador de mensajes no leídos
- Alertas de mensajes urgentes
- Integración con notificaciones de incidentes

#### Endpoints API:
```javascript
POST   /inbox/send        // Enviar mensaje
GET    /inbox             // Obtener mensajes
PUT    /inbox/{id}/read   // Marcar como leído
PUT    /inbox/{id}/archive // Archivar
DELETE /inbox/{id}        // Eliminar
GET    /inbox/recipients  // Obtener destinatarios
```

---

### 7.Módulo de Gestión de Trabajadores

**Ubicación**: `Frontend/src/pages/Workers.tsx` | `Backend/handlers/workers.js`

Administración completa del personal de obra.

#### Funcionalidades:

**Registro de Trabajadores**
- Datos personales (RUT, nombre, contacto)
- Información laboral (cargo, área, contrato)
- Documentación (certificados, licencias)
- Fotografía de perfil
- Datos de emergencia

**Control de Acceso**
- Generación de credenciales
- Registro de asistencia

**Reportes**
- Nómina actualizada
- Exportación de datos

#### Endpoints API:
```javascript
POST   /workers        // Registrar trabajador
GET    /workers        // Listar trabajadores
GET    /workers/{id}   // Obtener trabajador
PUT    /workers/{id}   // Actualizar datos
DELETE /workers/{id}   // Eliminar trabajador
```

---

### 8.Módulo de Gestión de Usuarios

**Ubicación**: `Frontend/src/pages/UserManagement.tsx` | `Backend/handlers/users.js`

Administración de usuarios del sistema y control de acceso.

#### Funcionalidades:

**Gestión de Usuarios**
- Crear usuarios con diferentes roles
- Roles disponibles:
  - Administrador
  - Prevencionista
  - Trabajador
- Activar/desactivar usuarios



#### Endpoints API:
```javascript
POST   /auth/register      // Registrar usuario
POST   /auth/login         // Iniciar sesión
POST   /auth/logout        // Cerrar sesión
PUT    /users/{id}         // Actualizar usuario
GET    /users              // Listar usuarios
DELETE /users/{id}         // Eliminar usuario
POST   /users/change-password // Cambiar contraseña
```

---

### 9.Módulo de Dashboard

**Ubicación**: `Frontend/src/pages/Dashboard.tsx`

Panel principal con métricas y KPIs de seguridad.

#### Funcionalidades:

**Indicadores Clave**
- Días sin accidentes
- Trabajadores activos
- Total de documentos
- Actividades completadas

---

### 10.Módulo de Actividades

**Ubicación**: `Frontend/src/pages/Activities.tsx` | `Backend/handlers/activities.js`

Registro de actividades y charlas de seguridad.

#### Funcionalidades:

**Charlas de Seguridad**
- Programación de charlas
- Registro de asistencia
- Temas tratados

**Inspecciones**
- Checklist de inspección
- Registro fotográfico
- Hallazgos y observaciones
- Acciones correctivas
- Seguimiento de cierre

**Capacitaciones**
- Calendario de capacitaciones
- Inscripción de participantes
- Certificados de asistencia
- Material didáctico
- Evaluaciones

---

## Tecnologías Utilizadas

### Frontend
```json
{
  "react": "^18.2.0",
  "react-router-dom": "^6.x",
  "typescript": "^5.x",
  "vite": "^5.x",
  "react-icons": "^4.x"
}
```

### Backend
```json
{
  "serverless": "^3.x",
  "@aws-sdk/client-dynamodb": "^3.x",
  "@aws-sdk/client-s3": "^3.x",
  "@aws-sdk/client-sns": "^3.x",
  "@aws-sdk/client-bedrock-runtime": "^3.x",
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.x",
  "uuid": "^9.x"
}
```

### AWS Services
- **Lambda**: Funciones serverless
- **DynamoDB**: Base de datos NoSQL
- **S3**: Almacenamiento de archivos
- **CloudFront**: CDN para frontend
- **API Gateway**: API REST
- **SNS**: Notificaciones
- **Bedrock**: IA generativa
- **IAM**: Gestión de permisos

---

## Instalación y Configuración

### Prerrequisitos
- Node.js 18.x o superior
- AWS CLI configurado
- Cuenta AWS activa
- Serverless Framework instalado globalmente

### Backend

```bash
# Navegar al directorio backend
cd Backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales AWS

# Desplegar a AWS
serverless deploy

# O usar npm script
npm run deploy
```

### Frontend

```bash
# Navegar al directorio frontend
cd Frontend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con la URL de tu API

# Desarrollo local
npm run dev

# Build para producción
npm run build

# Desplegar a S3
aws s3 sync dist/ s3://tu-bucket-frontend --delete
```

### Variables de Entorno

**Backend (.env)**
```env
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
USERS_TABLE=hackaton-users-dev
INCIDENTS_TABLE=hackaton-incidents-dev
INBOX_TABLE=hackaton-inbox-dev
DOCUMENTS_TABLE=hackaton-documents-dev
INCIDENT_EVIDENCE_BUCKET=hackaton-evidence-dev
JWT_SECRET=tu-secreto-super-seguro
```

**Frontend (.env)**
```env
VITE_API_URL=https://tu-api-gateway.execute-api.us-east-1.amazonaws.com/dev
VITE_INCIDENT_EVIDENCE_BASE_URL=https://tu-bucket.s3.amazonaws.com
```

---

## 📁 Estructura del Proyecto

```
Hackaton_CCHC/
├── Backend/
│   ├── handlers/
│   │   ├── incidents.js           # Gestión de incidentes
│   │   ├── signature-requests.js  # Firmas digitales
│   │   ├── documents.js           # Documentos
│   │   ├── surveys.js             # Encuestas
│   │   ├── ai-assistant.js        # Asistente IA
│   │   ├── inbox.js               # Mensajería
│   │   ├── workers.js             # Trabajadores
│   │   ├── users.js               # Usuarios
│   │   ├── activities.js          # Actividades
│   │   └── auth.js                # Autenticación
│   ├── serverless.yml             # Configuración Serverless
│   └── package.json
│
├── Frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Incidents.tsx      # Módulo de incidentes
│   │   │   ├── SignatureRequests.tsx
│   │   │   ├── Documents.tsx
│   │   │   ├── Surveys.tsx
│   │   │   ├── AIAssistant.tsx
│   │   │   ├── Inbox.tsx
│   │   │   ├── Workers.tsx
│   │   │   ├── UserManagement.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   └── Login.tsx
│   │   ├── components/
│   │   │   └── Header.tsx
│   │   ├── context/
│   │   │   └── AuthContext.tsx
│   │   ├── api/
│   │   │   └── client.ts          # Cliente API
│   │   └── App.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
└── README.md
```

---


## Modelo de Datos

### Incident
```typescript
{
  incidentId: string;
  empresaId: string;
  tipo: 'accidente' | 'incidente' | 'condicion_subestandar';
  clasificacion: 'hallazgo' | 'incidente';
  tipoHallazgo?: 'accion' | 'condicion';
  etapaConstructiva?: string;
  centroTrabajo: string;
  trabajador: {
    nombre: string;
    rut: string;
    cargo?: string;
    genero?: string;
  };
  fecha: string;
  hora: string;
  gravedad: 'leve' | 'grave' | 'fatal';
  descripcion: string;
  diasPerdidos: number;
  evidencias: string[];
  estado: 'reportado' | 'en_investigacion' | 'cerrado';
  reportadoPor: string;
  createdAt: string;
  updatedAt: string;
}
```

### User
```typescript
{
  userId: string;
  empresaId: string;
  nombre: string;
  apellido: string;
  email: string;
  password: string; // hashed
  rol: 'admin' | 'prevencionista' | 'supervisor' | 'trabajador';
  cargo?: string;
  estado: 'activo' | 'inactivo';
  createdAt: string;
  lastLogin?: string;
}
```

### Equipo de Desarrollo
- **Frontend**: React + TypeScript
- **Backend**: Serverless + AWS
