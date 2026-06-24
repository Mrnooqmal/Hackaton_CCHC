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
      { text: 'Inicio', link: '/' },
      { text: 'Guía de Inicio', link: '/guia-inicio/' },
      { text: 'DS44', link: '/ds44/' },
      { text: 'Módulos', link: '/modulos/' },
      { text: 'Roles', link: '/roles/' },
      { text: 'API', link: '/api/' },
      { text: 'Arquitectura', link: '/arquitectura/' },
    ],

    sidebar: {
      '/guia-inicio/': [
        {
          text: 'Guía de Inicio',
          items: [
            { text: '¿Qué es Build & Serve?', link: '/guia-inicio/' },
            { text: 'Instalación y configuración', link: '/guia-inicio/instalacion' },
            { text: 'Primeros pasos', link: '/guia-inicio/primeros-pasos' },
            { text: 'Onboarding de tenant', link: '/guia-inicio/onboarding' },
          ],
        },
      ],
      '/ds44/': [
        {
          text: 'DS44 & Normativa',
          items: [
            { text: '¿Qué es el DS 44?', link: '/ds44/' },
            { text: 'Documentos obligatorios', link: '/ds44/documentos-obligatorios' },
            { text: 'Fases de obra', link: '/ds44/fases-obra' },
            { text: 'Entrega de EPP', link: '/ds44/epp' },
            { text: 'Capacitaciones (Art.16)', link: '/ds44/capacitaciones' },
            { text: 'Firmas digitales y DS44', link: '/ds44/firmas-digitales' },
          ],
        },
      ],
      '/modulos/': [
        {
          text: 'Módulos',
          items: [
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
          ],
        },
      ],
      '/roles/': [
        {
          text: 'Roles de Usuario',
          items: [
            { text: 'Tabla comparativa', link: '/roles/' },
            { text: 'Admin', link: '/roles/admin' },
            { text: 'Prevencionista', link: '/roles/prevencionista' },
            { text: 'Jefe de Obra', link: '/roles/jefe-obra' },
            { text: 'Supervisor', link: '/roles/supervisor' },
            { text: 'Trabajador', link: '/roles/trabajador' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'Referencia API',
          items: [
            { text: 'Visión general', link: '/api/' },
            { text: 'Autenticación', link: '/api/autenticacion' },
            { text: 'Obras', link: '/api/obras' },
            { text: 'Documentos', link: '/api/documentos' },
            { text: 'Firmas', link: '/api/firmas' },
            { text: 'Incidentes', link: '/api/incidentes' },
            { text: 'Actividades', link: '/api/actividades' },
            { text: 'Personas', link: '/api/personas' },
          ],
        },
      ],
      '/arquitectura/': [
        {
          text: 'Arquitectura',
          items: [
            { text: 'Visión general', link: '/arquitectura/' },
            { text: 'Base de datos (DynamoDB)', link: '/arquitectura/base-de-datos' },
            { text: 'Multi-tenant', link: '/arquitectura/multi-tenant' },
          ],
        },
      ],
    },

    search: { provider: 'local' },

    footer: {
      message: 'Build & Serve · Hackathon CChC 2025 — Seguridad sin Papeleo',
      copyright: '© 2026 The Code Cookers · CCHC Chile',
    },

    lastUpdated: false,

    docFooter: {
      prev: 'Página anterior',
      next: 'Página siguiente',
    },

    outline: {
      label: 'En esta página',
    },

    returnToTopLabel: 'Volver arriba',
    sidebarMenuLabel: 'Menú',
    darkModeSwitchLabel: 'Tema',
  },
})
