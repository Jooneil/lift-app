import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ padding: 16, color: '#0ff', fontFamily: 'system-ui, sans-serif' }}>OK</div>
  </StrictMode>,
)
