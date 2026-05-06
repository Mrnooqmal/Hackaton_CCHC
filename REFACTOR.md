# Estado del Refactor (Hackaton CCHC)

## 1. Lo que hemos hecho hasta ahora (Completado)

### Backend
- **Modularización de Handlers:** Se mudaron los handlers de la raíz a sus propias carpetas dedicadas (ej. `handlers/personas-module`, `handlers/signatures`, `handlers/incidents-module`).
- **Reparación de Imports:** Se sanearon problemas críticos de rutas relativas (`require()`) de dependencias que se rompieron tras la migración (ej. corrigiendo las llamadas a `notifications/handler` y `signature-requests/handler` desde otros módulos).
- **Separación Estructural:** Capa de lógica de negocio y clientes separados exitosamente en la carpeta `lib/` (`utils`, `clients`, `services`, `events`).

### Frontend
- **Desacoplamiento del Monolito API (`client.ts`):** Extraímos todas las interfaces, tipos y llamadas HTTP del gigantesco `client.ts` hacia archivos focalizados por dominio:
  - `auth.api.ts`, `personas.api.ts`, `users.api.ts`, `workers.api.ts`
  - `signatures.api.ts`, `documents.api.ts`, `signatureRequests.api.ts`
  - `activities.api.ts`, `surveys.api.ts`, `incidents.api.ts`, `uploads.api.ts`
  - `ai.api.ts`, `inbox.api.ts`, `tenants.api.ts`, `obras.api.ts`
- **Soporte de Trabajo en Paralelo:** Se incorporaron cambios hechos en remoto sin conflictos (bulk uploads de base64, y soporte multi-obra mediante `empresaId/obraId`).
- **Limpieza del Wrapper:** `client.ts` quedó dedicado únicamente a inyectar interceptores de red (añadir JWT token y Tenant ID autogenerados) y hacer el `export *` principal.

---

## 2. Lo que falta por hacer en el Frontend (Pendiente)

### A. Actualizar Rutas de Importación en Pages y Components
Muchas pantallas (como `Activities.tsx`, `Incidents.tsx`, `AIAssistant.tsx`, `Dashboard.tsx`, etc.) aún importan las llamadas desde el puente legacy:
`import { activitiesApi } from '../api/client';`
Deben migrarse nativamente a:
`import { activitiesApi } from '../api/activities.api';`
Esto bajará el tamaño de los bundles de webpack/vite y mejorará el Tree Shaking.

### B. Refactorizar Servicios y Store
- Toca revisar servicios y stores globales (como `src/services/offlineStore.ts`) para ver que los mapeos de data local concuerden con los tipos recién re-extraídos.
- Validar las sincronizaciones local-remoto en la PWA/Store usando los nuevos domain APIs.

### C. Modularización de Vistas
- Las páginas muy grandes que manejen demasiada lógica de fetch directa deben empezar a emplear los nuevos módulos de forma compartimentada.
- Verificación exhaustiva tipo a tipo para prevenir mismatches en tiempo de compilación.

### D. Testing Integrado
Poner a correr el Frontend y realizar las peticiones HTTP al Backend en Serverless para confirmar que el ruteo modificado en `serverless.yml` empareja sin fallos con las nuevas peticiones originadas desde los múltiples archivos `.api.ts`. 

