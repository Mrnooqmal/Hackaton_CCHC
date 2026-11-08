import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './css/index.css'
import App from './App.tsx'
import { purgarAlmacenOfflineAntiguo } from './services/purgaOffline'
import { retirarClavesAnteriores } from './utils/colaFirmas'

// Antes de montar nada: un equipo que usó el modo sin conexión anterior tiene
// PIN en claro guardados en IndexedDB, y puede no volver a cerrar sesión nunca.
purgarAlmacenOfflineAntiguo()
// Cola y vales sin empresa, de antes de separarlos (utils/colaFirmas).
retirarClavesAnteriores()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
