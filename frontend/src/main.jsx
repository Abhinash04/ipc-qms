import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
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
