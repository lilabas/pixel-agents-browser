import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { connectWebSocket } from './wsClient.js'
import './index.css'
import { AppLayout } from './components/AppLayout.js'

connectWebSocket()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLayout />
  </StrictMode>,
)
