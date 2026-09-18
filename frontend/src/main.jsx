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
import { useAuthStore } from '@/store/useAuthStore'

const queryClient = new QueryClient()

// Restores the session from the httpOnly cookie before the router decides
// which route the visitor is allowed on.
//
// The workflow store is deliberately NOT hydrated here. /queries requires a
// session, so hydrating at module load raced ahead of the cookie check and
// every call 401'd on a first visit — the store then fell back to the local
// seed, marked itself hydrated, and never reloaded, so a user who signed in
// afterwards worked against seed data while the real cases sat in Mongo.
// App.jsx hydrates it once the session is known.
useAuthStore.getState().hydrate()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
