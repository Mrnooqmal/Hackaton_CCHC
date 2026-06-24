# Instalación y configuración

Build & Serve se compone de dos proyectos: **Backend** (serverless, AWS) y **Frontend**
(React + Vite). Esta guía cubre la instalación local y el despliegue.

## Prerrequisitos

- Node.js 18.x o superior
- AWS CLI configurado
- Cuenta AWS activa
- Serverless Framework instalado globalmente (`npm i -g serverless`)

## Backend

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

# O usar el npm script
npm run deploy
```

### Variables de entorno (Backend)

```ini
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
TENANTS_TABLE=hackaton-tenants-dev
PERSONAS_TABLE=hackaton-personas-dev
OBRAS_TABLE=hackaton-obras-dev
DOCUMENTS_TABLE=hackaton-documents-dev
INCIDENTS_TABLE=hackaton-incidents-dev
INBOX_TABLE=hackaton-inbox-dev
SIGNATURES_TABLE=hackaton-signatures-dev
DOCUMENTS_BUCKET=hackaton-documents-dev
JWT_SECRET=tu-secreto-super-seguro
GEMINI_API_KEY=tu-api-key
```

### Desarrollo local del backend

```bash
# Serverless Offline (puerto 3001)
npm run dev
```

## Frontend

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

### Variables de entorno (Frontend)

```ini
VITE_API_URL=https://tu-api-gateway.execute-api.us-east-1.amazonaws.com/dev
VITE_INCIDENT_EVIDENCE_BASE_URL=https://tu-bucket.s3.amazonaws.com
```

## Manual de uso (este sitio)

La documentación que estás leyendo vive en `Frontend/manual-src/` y se construye con VitePress.

```bash
# Navegar al directorio del manual
cd Frontend/manual-src

# Instalar dependencias
npm install

# Desarrollo local
npm run dev

# Build
npm run build

# Integrar el manual en la app React (lo copia a Frontend/public/manual)
npm run build:to-app
```

::: tip Integración con el footer
El manual se sirve bajo la ruta `/manual/`. El footer de la app React enlaza a esta
ruta desde "Ver manual de uso". Tras ejecutar `npm run build:to-app`, el manual queda
disponible en producción dentro de la misma aplicación.
:::
