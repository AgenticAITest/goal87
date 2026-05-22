import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Remove splash after its fade-out animation finishes (2s delay + 0.5s fade = 2.5s)
const splash = document.getElementById('splash')
if (splash) {
  splash.addEventListener('animationend', () => splash.remove(), { once: true })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
