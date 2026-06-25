<script setup lang="ts">
import { computed } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'

const { theme, page, site } = useData()
const route = useRoute()

type Crumb = { text: string; link: string | null }

// Quita el `base` del sitio (/manual/) y las extensiones para comparar rutas.
function normalize(p: string): string {
  let path = p || '/'
  const base = site.value.base || '/'
  if (base !== '/' && path.startsWith(base)) {
    path = '/' + path.slice(base.length)
  }
  path = path.replace(/index\.html$/, '').replace(/\.html$/, '')
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path || '/'
}

const crumbs = computed<Crumb[]>(() => {
  const path = normalize(route.path)
  if (path === '/') return []

  const sidebar = (theme.value.sidebar || {}) as Record<string, any[]>
  let group: any[] | null = null
  for (const key of Object.keys(sidebar)) {
    if (path.startsWith(normalize(key))) {
      group = sidebar[key]
      break
    }
  }

  const trail: Crumb[] = [{ text: 'Inicio', link: '/' }]

  if (Array.isArray(group)) {
    for (const section of group) {
      const items = section.items || []
      const rootLink: string | undefined = items[0]?.link
      const current = items.find((it: any) => normalize(it.link) === path)
      if (current) {
        const isRoot = rootLink ? normalize(rootLink) === path : false
        if (isRoot) {
          trail.push({ text: section.text || current.text, link: null })
        } else {
          if (section.text && rootLink) trail.push({ text: section.text, link: rootLink })
          trail.push({ text: current.text, link: null })
        }
        break
      }
    }
  }

  // Respaldo: si no se encontró en la navegación, usa el título de la página.
  if (trail.length === 1 && page.value.title) {
    trail.push({ text: page.value.title, link: null })
  }

  return trail
})
</script>

<template>
  <nav v-if="crumbs.length > 1" class="bs-breadcrumb" aria-label="Migas de pan">
    <template v-for="(c, i) in crumbs" :key="i">
      <a v-if="c.link" :href="withBase(c.link)" class="bs-breadcrumb__link">{{ c.text }}</a>
      <span v-else class="bs-breadcrumb__current" aria-current="page">{{ c.text }}</span>
      <span v-if="i < crumbs.length - 1" class="bs-breadcrumb__sep" aria-hidden="true">›</span>
    </template>
  </nav>
</template>
