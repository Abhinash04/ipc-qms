import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Mirrors frontend/eslint.config.js, minus the React plugins, which have
 * nothing to lint here. The backend is ESM ("type": "module") and runs on Node,
 * so the source globals are Node's; the test files additionally get Vitest's.
 */
export default defineConfig([
  globalIgnores(['node_modules', 'coverage']),
  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // `const { _id, ...rest } = doc` is how a field is dropped from an object.
      // The binding is the mechanism, not dead code.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/test/**/*.js', 'vitest.config.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
  {
    /**
     * The browser agent is two languages in one directory: most of it runs on
     * Node, and the functions it hands to `session.evaluate` are serialised and
     * run inside the NICeMail tab, where `document` and `location` are exactly
     * as defined as `process` is here.
     */
    files: ['src/services/email/nic/browser/*.js', 'src/scripts/nicBrowserDiscover.js', 'src/scripts/nicBrowserCalibrate.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
]);
