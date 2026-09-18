import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The Playwright runner and its helpers execute in Node, not in the page:
    // they read `process.env`, start the two servers and talk to MongoDB
    // directly. Under browser globals alone every `process` reference is an
    // undefined variable.
    files: ['playwright.config.js', 'e2e/**/*.js'],
    languageOptions: { globals: globals.node },
  },
])
