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

const queryClient = new QueryClient()

// Load the workflow domain from IndexedDB (seeding it on first run) before the
// app paints. Kicked off at module scope rather than in an effect so it runs
// exactly once, including under StrictMode's double-invoke in development.
useWorkflowStore.getState().hydrate()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
