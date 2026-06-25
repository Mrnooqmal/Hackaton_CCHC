import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import Breadcrumb from './Breadcrumb.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    // Inserta las migas de pan justo antes del contenido del documento
    // (arriba a la izquierda, sobre el título de cada página).
    return h(DefaultTheme.Layout, null, {
      'doc-before': () => h(Breadcrumb),
    })
  },
}
