import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'

// Sirve el manual de uso (VitePress, copiado a public/manual) durante `npm run dev`.
// El dev server de Vite no resuelve el index.html de un directorio y deja que el
// fallback SPA de React intercepte rutas como /manual/ o /manual/ds44/. Este
// middleware resuelve esos directorios a su index.html ANTES del fallback.
// En producción (vite build) no hace falta: el host estático ya resuelve /manual/.
function serveManualDev(): PluginOption {
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  }

  return {
    name: 'serve-manual-dev',
    apply: 'serve',
    configureServer(server) {
      const publicDir = server.config.publicDir
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/manual')) return next()

        const urlPath = decodeURIComponent(req.url.split('?')[0])
        let filePath = path.join(publicDir, urlPath)

        // Si es un archivo real (assets, css, js…), que lo sirva Vite.
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return next()

        // Directorio o ruta sin extensión → resolver a index.html.
        const indexPath = path.join(filePath, 'index.html')
        if (fs.existsSync(indexPath)) filePath = indexPath
        else return next()

        const ext = path.extname(filePath)
        res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    serveManualDev(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.svg', 'pwa-192x192.svg', 'pwa-512x512.svg'],
      manifest: {
        name: 'Build & Serve',
        short_name: 'B&S',
        description: 'Aplicación para trabajadores de construcción',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // El manual es un sitio independiente dentro de /manual: que el service
        // worker no lo intercepte con el fallback SPA de la app React.
        globIgnores: ['**/manual/**'],
        navigateFallbackDenylist: [/^\/manual/]
      }
    })
  ],
})
