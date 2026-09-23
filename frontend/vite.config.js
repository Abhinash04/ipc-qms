import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
const PRELOAD_FONTS = [
  /inter-latin-400-normal/,
  /inter-latin-500-normal/,
  /inter-latin-600-normal/,
  /inter-latin-700-normal/,
  /outfit-latin-700-normal/,
  /outfit-latin-900-normal/,
]

function preloadKeyFonts() {
  return {
    name: 'preload-key-fonts',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const tags = Object.keys(ctx.bundle)
          .filter((file) => file.endsWith('.woff2') && PRELOAD_FONTS.some((re) => re.test(file)))
          .map((file) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${file}` },
            injectTo: 'head',
          }))
        return { html, tags }
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadKeyFonts()],
  resolve: {
    alias: {
      ...(globalThis.process?.env?.VITEST
        ? {
            '@/routes/routeElements': fileURLToPath(
              new URL('./src/routes/routeElements.eager.jsx', import.meta.url),
            ),
          }
        : {}),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    testTimeout: 20_000,
  },
})
