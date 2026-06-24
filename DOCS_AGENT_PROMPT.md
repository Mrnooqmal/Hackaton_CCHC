# Prompt — Agente Documentación Build & Serve

> Instrucción completa para el agente Opus 4.8.  
> Ejecutar desde: `C:\Users\benja\Documents\GitHub\Hackaton_CCHC`

---

## ROL

Eres un agente experto en documentación técnica. Tu tarea es:

- **A)** Crear el sitio de documentación en `resources/` dentro del repositorio actual
- **B)** Integrar ese sitio con el footer de la app React ya existente

Trabaja únicamente dentro del repositorio `C:\Users\benja\Documents\GitHub\Hackaton_CCHC`. No crees repositorios ni directorios fuera de esa ruta.

---

## CONTEXTO DEL PROYECTO

Plataforma SaaS multi-tenant **"Build & Serve — Sistema de Gestión SST"** para digitalizar la seguridad laboral (SST) en obras de construcción chilenas, cumpliendo el **Supremo Decreto 44 (DS 44)**. Desarrollado por "The Code Cookers" para la Cámara Chilena de la Construcción (CCHC).

**Stack:**
- Frontend: React 19 + TypeScript + Vite + React Router v7
- Backend: Node.js + AWS Lambda (Serverless Framework) + itty-router
- Base de datos: AWS DynamoDB (11 tablas, PAY_PER_REQUEST)
- Storage: AWS S3
- Auth: JWT + Bcrypt + PIN-based digital signatures
- IA: AWS Bedrock (Claude 3 Sonnet) + Google Gemini

**5 roles de usuario:** `admin`, `jefe_obra`, `supervisor`, `prevencionista`, `trabajador`

**11 módulos:**

| # | Módulo | Descripción |
|---|--------|-------------|
| 1 | Dashboard | KPIs de seguridad laboral |
| 2 | Obras | Gestión de proyectos (ciclo Deming: plan/hacer/verificar/actuar) |
| 3 | Documentos DS44 | Documentos obligatorios por fase (obra / diario) |
| 4 | Firmas Digitales | PIN offline + presencial, audit trail inmutable |
| 5 | Incidentes | Reporte, clasificación (hallazgo/incidente), estadísticas KPI |
| 6 | Actividades | Charlas 5min, capacitaciones Art.16 (8hr), auditorías, MIPPER |
| 7 | Encuestas | Formularios con lógica condicional, asignación a personas |
| 8 | Asistente IA | Claude 3 Sonnet para matrices de riesgo y normativa |
| 9 | Personas | Identidad unificada (reemplaza Users + Workers separados) |
| 10 | Bandeja de Entrada | Mensajería interna + notificaciones automáticas |
| 11 | Tenants | Multi-tenant, planes starter / professional / enterprise |

**DS44 compliance implementado:**
- IRL (Informe de Riesgos Laborales)
- MIPER/MIPPER — matrices de riesgo por cargo
- Entrega EPP con firma de trabajador + supervisor
- Capacitaciones Art.16 (8 horas obligatorias)
- Investigación de incidentes con análisis de causa raíz
- Trazabilidad: PIN + IP + timestamp → `SignaturesTable` (inmutable)
- Fases de obra: `excavacion` → `obra_gruesa` → `terminaciones` → `entrega`

**DynamoDB — 11 tablas:**  
`TenantsTable`, `PersonasTable`, `ObrasTable`, `DocumentosTable`, `ActivitiesTable`, `IncidentsTable`, `SignaturesTable`, `SignatureRequestsTable`, `SurveysTable`, `InboxTable`, `SessionsTable`

**Consulta legal pendiente:** Validez jurídica del PIN como firma electrónica ante fiscalizador DS 44. No modificar `FirmaService` hasta tener respuesta de la Dirección del Trabajo. *(Acordado reunión CCHC 2026-06-10)*

---

## PARTE A — SITIO DE DOCUMENTACIÓN EN `resources/`

### 1. Inicializar VitePress

Ejecuta desde la raíz del repositorio:

```bash
npx vitepress@latest init resources
```

Cuando pregunte por configuración, elige:
- Site title: `Build & Serve — Manual de Uso`
- Site description: `Manual oficial de la plataforma de gestión SST para CCHC`
- Theme: `Default Theme`
- TypeScript: `Yes`

Luego instala dependencias:

```bash
cd resources && npm install
```

### 2. Configuración principal — `resources/.vitepress/config.ts`

El campo `base: '/manual/'` es **crítico**: permite que el build de VitePress se sirva desde `/manual/` dentro de la misma app React en producción.

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/manual/',
  title: 'Build & Serve — Manual de Uso',
  description: 'Manual oficial de la plataforma SST para construcción · CCHC Chile',
  lang: 'es-CL',

  themeConfig: {
    logo: '/logo-bs.svg',
    siteTitle: 'Build & Serve Docs',

    nav: [
      { text: 'Inicio', link: '/manual/' },
      { text: 'Guía de Inicio', link: '/manual/guia-inicio/' },
      { text: 'DS44', link: '/manual/ds44/' },
      { text: 'Módulos', link: '/manual/modulos/' },
      { text: 'API', link: '/manual/api/' },
    ],

    sidebar: {
      '/guia-inicio/': [
        { text: 'Guía de Inicio', items: [
          { text: '¿Qué es Build & Serve?', link: '/guia-inicio/' },
          { text: 'Instalación y configuración', link: '/guia-inicio/instalacion' },
          { text: 'Primeros pasos', link: '/guia-inicio/primeros-pasos' },
          { text: 'Onboarding de tenant', link: '/guia-inicio/onboarding' },
        ]},
      ],
      '/ds44/': [
        { text: 'DS44 & Normativa', items: [
          { text: '¿Qué es el DS 44?', link: '/ds44/' },
          { text: 'Documentos obligatorios', link: '/ds44/documentos-obligatorios' },
          { text: 'Fases de obra', link: '/ds44/fases-obra' },
          { text: 'Entrega de EPP', link: '/ds44/epp' },
          { text: 'Capacitaciones (Art.16)', link: '/ds44/capacitaciones' },
          { text: 'Firmas digitales y DS44', link: '/ds44/firmas-digitales' },
        ]},
      ],
      '/modulos/': [
        { text: 'Módulos', items: [
          { text: 'Resumen de módulos', link: '/modulos/' },
          { text: 'Dashboard', link: '/modulos/dashboard' },
          { text: 'Obras', link: '/modulos/obras' },
          { text: 'Documentos', link: '/modulos/documentos' },
          { text: 'Firmas Digitales', link: '/modulos/firmas' },
          { text: 'Incidentes', link: '/modulos/incidentes' },
          { text: 'Actividades', link: '/modulos/actividades' },
          { text: 'Encuestas', link: '/modulos/encuestas' },
          { text: 'Asistente IA', link: '/modulos/asistente-ia' },
          { text: 'Personas', link: '/modulos/personas' },
          { text: 'Bandeja de Entrada', link: '/modulos/bandeja-entrada' },
          { text: 'Tenants', link: '/modulos/tenants' },
        ]},
      ],
      '/roles/': [
        { text: 'Roles de Usuario', items: [
          { text: 'Tabla comparativa', link: '/roles/' },
          { text: 'Admin', link: '/roles/admin' },
          { text: 'Prevencionista', link: '/roles/prevencionista' },
          { text: 'Jefe de Obra', link: '/roles/jefe-obra' },
          { text: 'Supervisor', link: '/roles/supervisor' },
          { text: 'Trabajador', link: '/roles/trabajador' },
        ]},
      ],
      '/api/': [
        { text: 'Referencia API', items: [
          { text: 'Visión general', link: '/api/' },
          { text: 'Autenticación', link: '/api/autenticacion' },
          { text: 'Obras', link: '/api/obras' },
          { text: 'Documentos', link: '/api/documentos' },
          { text: 'Firmas', link: '/api/firmas' },
          { text: 'Incidentes', link: '/api/incidentes' },
          { text: 'Actividades', link: '/api/actividades' },
          { text: 'Personas', link: '/api/personas' },
        ]},
      ],
      '/arquitectura/': [
        { text: 'Arquitectura', items: [
          { text: 'Visión general', link: '/arquitectura/' },
          { text: 'Base de datos (DynamoDB)', link: '/arquitectura/base-de-datos' },
          { text: 'Multi-tenant', link: '/arquitectura/multi-tenant' },
        ]},
      ],
    },

    search: { provider: 'local' },

    footer: {
      message: 'Build & Serve · Hackathon CChC 2025 — Seguridad sin Papeleo',
      copyright: '© 2026 The Code Cookers · CCHC Chile',
    },

    editLink: undefined,
    lastUpdated: false,
  },
})
```

### 3. Scripts en `resources/package.json`

Asegúrate de que existan estos scripts:

```json
{
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview",
    "build:to-app": "vitepress build && xcopy /E /I /Y .vitepress\\dist ..\\Frontend\\public\\manual"
  }
}
```

### 4. Estructura de archivos a crear

Crea **todos** estos archivos con contenido real (cero placeholders):

```
resources/
├── index.md
├── guia-inicio/
│   ├── index.md
│   ├── instalacion.md
│   ├── primeros-pasos.md
│   └── onboarding.md
├── ds44/
│   ├── index.md
│   ├── documentos-obligatorios.md
│   ├── fases-obra.md
│   ├── epp.md
│   ├── capacitaciones.md
│   └── firmas-digitales.md
├── modulos/
│   ├── index.md
│   ├── dashboard.md
│   ├── obras.md
│   ├── documentos.md
│   ├── firmas.md
│   ├── incidentes.md
│   ├── actividades.md
│   ├── encuestas.md
│   ├── asistente-ia.md
│   ├── personas.md
│   ├── bandeja-entrada.md
│   └── tenants.md
├── roles/
│   ├── index.md
│   ├── admin.md
│   ├── prevencionista.md
│   ├── jefe-obra.md
│   ├── supervisor.md
│   └── trabajador.md
├── api/
│   ├── index.md
│   ├── autenticacion.md
│   ├── obras.md
│   ├── documentos.md
│   ├── firmas.md
│   ├── incidentes.md
│   ├── actividades.md
│   └── personas.md
└── arquitectura/
    ├── index.md
    ├── base-de-datos.md
    └── multi-tenant.md
```

### 5. Página de inicio — `resources/index.md`

Usa el layout `home` de VitePress con cards estilo Atlassian Confluence:

```md
---
layout: home

hero:
  name: "Build & Serve"
  text: "Manual de Uso Oficial"
  tagline: "Plataforma de gestión SST para obras de construcción · CCHC Chile"
  actions:
    - theme: brand
      text: Guía de Inicio →
      link: /guia-inicio/
    - theme: alt
      text: Ver módulos
      link: /modulos/

features:
  - icon: 🚀
    title: Guía de Inicio
    details: Instalación, configuración y onboarding de un nuevo tenant en la plataforma.
    link: /guia-inicio/
  - icon: 📋
    title: DS44 & Normativa
    details: Cumplimiento del Supremo Decreto 44. Documentos obligatorios, fases y firmas.
    link: /ds44/
  - icon: 🧩
    title: Módulos
    details: Documentación completa de los 11 módulos de la plataforma.
    link: /modulos/
  - icon: 👥
    title: Roles de Usuario
    details: Qué puede hacer cada rol. Tabla comparativa de permisos por módulo.
    link: /roles/
  - icon: 🔌
    title: Referencia API
    details: Endpoints REST, autenticación JWT y ejemplos de request/response.
    link: /api/
  - icon: 🏗️
    title: Arquitectura
    details: DynamoDB schema, aislamiento multi-tenant y estructura S3.
    link: /arquitectura/
---
```

### 6. Contenido mínimo requerido por sección

#### `ds44/index.md`
- Qué es el DS 44, cuándo entró en vigor en Chile
- Qué obligaciones impone a empresas constructoras
- Cómo Build & Serve automatiza el cumplimiento
- Tabla: código DS44 → módulo que lo gestiona en la plataforma

#### `ds44/documentos-obligatorios.md`
Tabla completa de todos los tipos:

| Código | Nombre | Fase | Quién firma | Obligatorio |
|--------|--------|------|-------------|-------------|

Tipos a documentar: `IRL`, `POLITICA_SSO`, `REGLAMENTO_INTERNO`, `PROCEDIMIENTO_TRABAJO`, `ENTREGA_EPP`, `ENCUESTA_SALUD`, `CAPACITACION_SST`, `MAPA_RIESGOS`, `MIPPER`

#### `ds44/firmas-digitales.md`
- Las 4 estrategias: `PIN`, `OFFLINE`, `PRESENCIAL`, `BIOMETRIC` (stub pendiente)
- Flujo offline: IndexedDB → AES encryption → sync retry al reconectar
- Registro inmutable en `SignaturesTable` (PIN + IP + timestamp)
- Bloque de advertencia:

```
::: warning Consulta legal pendiente
La validez jurídica del PIN como firma electrónica ante un fiscalizador del
DS 44 está siendo evaluada con la Dirección del Trabajo (acuerdo reunión
CCHC 2026-06-10). No utilizar como única prueba legal hasta obtener
respuesta oficial. La implementación actual (PIN + token + IP + timestamp
en SignaturesTable) no debe modificarse hasta entonces.
:::
```

#### `modulos/obras.md`
- Qué es una obra en el sistema
- Ciclo Deming (plan/hacer/verificar/actuar): normativo, no físico
- Fases físicas: `excavacion`, `obra_gruesa`, `terminaciones`, `entrega`
- Cómo avanzar de fase: verificación de documentos obligatorios completados
- `fasesConfig`: documentos DS44 precreados automáticamente al crear la obra

#### `modulos/firmas.md`
- Diferencia entre documento de obra (DS44 obligatorio) vs documento diario (asignado a personas)
- Flujo completo: asignación → notificación inbox → firma PIN → `SignaturesTable`
- Firma presencial del relator en actividades (`CAPACITACION_SST`, `CHARLA_5MIN`)
- Firma offline: tablet sin internet → IndexedDB → sync automático al reconectar
- Misma advertencia legal del bloque `:::warning` de `ds44/firmas-digitales.md`

#### `modulos/incidentes.md`
- Tipos: hallazgo (acción/condición), incidente, accidente, condición subestándar
- Campos del formulario: trabajador (RUT, cargo, género), gravedad, etapa constructiva
- Flujo de notificaciones: EventBus → `InboxTable` → prevencionista
- KPIs del dashboard: tasa accidentabilidad, días perdidos, siniestralidad
- Niveles de gravedad: `leve`, `grave`, `fatal`
- Exportación CSV y PDF

#### `modulos/personas.md`
- Por qué Persona unifica Users + Workers en un solo registro con `personaId`
- Campos clave: `rol`, `pinHash`, `tieneAccesoWeb`, `obraIds`, `habilitado`
- Enrolamiento: firma de enrolamiento + activación de PIN
- Diferencia entre persona con acceso web (`passwordHash`) vs solo firma (`pinHash`)

#### `roles/index.md`
Tabla comparativa completa:

| Módulo | Admin | Prevencionista | Jefe Obra | Supervisor | Trabajador |
|--------|-------|----------------|-----------|------------|------------|

Usar `✓` (acceso completo), `👁` (solo lectura) y `✗` (sin acceso) para cada combinación.

#### `arquitectura/base-de-datos.md`
Las 11 tablas DynamoDB con:
- Nombre, propósito
- Partition Key y Sort Key
- GSIs disponibles
- Jerarquía de entidades:

```
Tenant
  └── Obra
        ├── Documentos
        ├── Actividades
        └── Incidentes
  └── Persona
        ├── Firmas
        └── Asignaciones
```

Diagrama ASCII de estructura S3:

```
hackaton-documents-{stage}/
  tenants/
    {tenantId}/
      config/
        logo.webp
      obras/
        {obraId}/
          fase-excavacion/
          fase-obra-gruesa/
      personas/
        {personaId}/
          firma-enrolamiento.png
      evidencias/
        {incidentId}/
```

#### `api/autenticacion.md`
- Flujo completo JWT: login → token → Bearer header en cada request
- Endpoints con ejemplo de request/response JSON:
  - `POST /auth/login`
  - `POST /auth/logout`
  - `POST /auth/change-password`
  - `POST /auth/forgot-password`
  - `GET /auth/validate-token`
- Nota importante: `tenantId` siempre se extrae del JWT, nunca del body del request

---

## PARTE B — ACTUALIZAR EL FOOTER DE REACT

**Archivo:** `Frontend/src/components/Footer.tsx`  
**Línea 51** — cambiar solo el atributo `href`:

**Antes:**
```tsx
<a href="#manual" className="ft-col-link ft-col-link--cta">
  Ver manual de uso →
</a>
```

**Después:**
```tsx
<a href="/manual/" target="_blank" rel="noopener noreferrer" className="ft-col-link ft-col-link--cta">
  Ver manual de uso →
</a>
```

No modificar ninguna otra línea del archivo.

---

## ORDEN DE EJECUCIÓN

1. Inicializar VitePress en `resources/`
2. Escribir `resources/.vitepress/config.ts` (con `base: '/manual/'`)
3. Escribir `resources/index.md` (página de inicio con features cards)
4. Escribir todas las páginas de `ds44/` — **prioridad máxima**
5. Escribir todas las páginas de `modulos/`
6. Escribir todas las páginas de `roles/`
7. Escribir todas las páginas de `api/`
8. Escribir todas las páginas de `arquitectura/`
9. Escribir todas las páginas de `guia-inicio/`
10. Modificar `Frontend/src/components/Footer.tsx` (solo `href="#manual"` → `href="/manual/"`)
11. Verificar que `npm run dev` funciona desde `resources/`
12. Reportar: URL local del manual, total de páginas creadas, y comando para integrar en producción

---

## REGLAS

- Todo el contenido en **español** (chileno, formal pero accesible)
- **Cero placeholders** — contenido real basado en el contexto dado
- Tablas y bloques de código donde corresponda
- La advertencia legal del PIN debe aparecer con bloque `::: warning` en `ds44/firmas-digitales.md` y `modulos/firmas.md`
- No crear archivos fuera de la estructura pedida
- No modificar ningún archivo del Frontend salvo la línea 51 de `Footer.tsx`
- Todo el trabajo queda dentro del repositorio `C:\Users\benja\Documents\GitHub\Hackaton_CCHC`
