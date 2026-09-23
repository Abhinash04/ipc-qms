import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Latin subsets that render above the fold; preloading them makes the font
// available at first paint, eliminating the web-font layout shift Lighthouse
// traced on the dashboards. Deliberately not every weight/subset.
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadKeyFonts()],
  resolve: {
    alias: {
      // Tests drive pages synchronously after render, so vitest resolves the
      // eager twin of the lazy production route table. Must sit before '@'.
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

    /**
     * Vitest defaults to 5 s, and several tests here sit right on it.
     *
     * The heavy ones mount the entire route tree in jsdom, hydrate the store and
     * then drive a multi-step modal — `transferQuery` and `pullbackQuery` cost
     * ~2.7 s each on an idle machine. Vitest runs files concurrently across
     * worker threads, so under contention they crossed 5 s and failed, and WHICH
     * one failed depended on how the files happened to be scheduled. Adding or
     * removing an unrelated test file was enough to change the answer, which made
     * the suite look intermittently broken when nothing was.
     *
     * A per-test override would have been whack-a-mole: the boundary is
     * arbitrary, and the next slow page test would land on it too. Nothing is
     * weakened — no assertion changes, and a test that genuinely hangs still
     * fails, four times slower to notice.
     */
    testTimeout: 20_000,
  },
})
