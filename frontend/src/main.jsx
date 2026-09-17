import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Self-hosted fonts (same weights the old Google Fonts import served).
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import '@fontsource/outfit/700.css'
import '@fontsource/outfit/800.css'
import '@fontsource/outfit/900.css'
import './index.css'
import App from './App.jsx'
import { useWorkflowStore } from '@/store/useWorkflowStore'
import { useAuthStore } from '@/store/useAuthStore'

const queryClient = new QueryClient()

useWorkflowStore.getState().hydrate()
// Restores the session from the httpOnly cookie before the router decides
// which route the visitor is allowed on.
useAuthStore.getState().hydrate()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
