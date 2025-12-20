import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './css/index.css'
import App from './App.tsx'
import ParticlesBackground from './components/ParticlesBackground'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ParticlesBackground />
    <App />
  </StrictMode>,
)
