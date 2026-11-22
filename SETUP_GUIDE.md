# Guía de Configuración e Instalación del Proyecto

Este documento detalla los pasos necesarios para configurar y ejecutar el proyecto (Backend y Frontend).

## Prerrequisitos

1.  **Node.js**: Asegúrate de tener Node.js instalado (Versión 18.x o superior recomendada).
2.  **AWS CLI** (Opcional pero recomendado): Para configurar tus credenciales de AWS fácilmente.

## 1. Configuración de Credenciales AWS

Para que el Backend funcione (incluso localmente con `serverless-offline`), necesitas configurar tus credenciales de AWS.

### Opción A: Usando AWS CLI (Recomendado)
Si tienes AWS CLI instalado, ejecuta:
```bash
aws configure
```
Ingresa tu `AWS Access Key ID` y `AWS Secret Access Key`.

### Opción B: Manualmente
Crea un archivo llamado `credentials` dentro de la carpeta `.aws` en tu directorio de usuario.

*   **Linux/Mac**: `~/.aws/credentials`
*   **Windows**: `C:\Users\TU_USUARIO\.aws\credentials`

Contenido del archivo:
```ini
[default]
aws_access_key_id = TU_ACCESS_KEY
aws_secret_access_key = TU_SECRET_KEY
```

> **Nota**: Si no tienes una cuenta AWS, necesitarás una para obtener estas claves. El proyecto usa servicios como DynamoDB, S3 y SES.

---

## 2. Configuración del Backend

El backend utiliza **Serverless Framework**.

1.  Navega a la carpeta del backend:
    ```bash
    cd Backend
    ```

2.  Instala las dependencias:
    ```bash
    npm install
    ```
    *Esto instalará `serverless`, `serverless-offline` y todas las librerías necesarias.*

3.  (Opcional) Variables de Entorno:
    El archivo `serverless.yml` ya está configurado para desarrollo local (`stage: dev`).
    *   `IS_OFFLINE`: Se configura automáticamente al correr en local.
    *   No es obligatorio crear un archivo `.env` para correr localmente, a menos que quieras anular valores específicos.

4.  Correr el Backend localmente:
    ```bash
    npm run dev
    ```
    Esto iniciará el servidor en `http://localhost:3001`.

5.  (Alternativa) Probar tu código del backend contra los recursos reales de `dev`, sin desplegar:
    `npm run dev` no sirve contra AWS (usa LocalStack y no resuelve la llave KMS ni las colas), y
    desplegar a `dev` pisa el trabajo de quien más lo use. `npm run local` ejecuta los handlers de
    tu árbol de trabajo en `http://localhost:3001`, con las variables de entorno de las Lambdas ya
    desplegadas en `dev` (tablas, buckets, llave KMS, colas). Las rutas salen del `serverless.yml`
    de tu rama.

    PowerShell (Windows):
    ```powershell
    cd Backend
    $env:AWS_PROFILE = "cchc"
    npm.cmd run local
    ```
    WSL / Linux / macOS:
    ```bash
    cd Backend
    AWS_PROFILE=cchc npm run local
    ```
    Requiere el AWS CLI con sesión iniciada en la cuenta de `dev`. Opciones: `--puerto 3001`,
    `--recargar` (vuelve a cargar `handlers/` y `lib/` en cada petición; sin ella, reinicia el
    servidor al cambiar código). Solo acepta `dev` y escucha únicamente en `127.0.0.1`.

    El frontend local **no necesita `VITE_API_URL`**: su valor por defecto ya es
    `http://localhost:3001`.

    > **Avisos.** Usa las tablas, buckets y colas REALES de `dev`: lo que crees queda en `dev` y lo
    > ven los demás. Los trabajos en segundo plano (colas) los procesa la Lambda desplegada en
    > `dev`, no este código; los disparadores programados no corren.

---

## 3. Configuración del Frontend

El frontend utiliza **Vite** + **React**.

1.  Navega a la carpeta del frontend:
    ```bash
    cd Frontend
    ```

2.  Instala las dependencias:
    ```bash
    npm install
    ```

3.  Variables de Entorno (.env):
    El frontend busca variables que empiecen con `VITE_`.
    
    Crea un archivo `.env` en la carpeta `Frontend` si necesitas cambiar los valores por defecto. Si no lo creas, se usarán estos valores por defecto (configurados en el código):

    *   `VITE_API_URL`: `http://localhost:3001`
    *   `VITE_INCIDENT_EVIDENCE_BASE_URL`: `` (vacío)

    **Contenido de ejemplo para `.env` (opcional para local):**
    ```env
    VITE_API_URL=http://localhost:3001
    VITE_INCIDENT_EVIDENCE_BASE_URL=https://tu-bucket-s3.s3.amazonaws.com
    ```

4.  Correr el Frontend:
    ```bash
    npm run dev
    ```
    Esto iniciará la aplicación (usualmente en `http://localhost:5173`).

---

## Resumen de Comandos para Iniciar

**Terminal 1 (Backend):**
```bash
cd Backend
npm install
npm run dev
```

**Terminal 2 (Frontend):**
```bash
cd Frontend
npm install
npm run dev
```
