import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file rather than process.cwd(), so the suite finds the
// fixture however vitest was launched. fileURLToPath, not URL.pathname: the
// latter yields "/D:/…" on Windows and fs cannot open it.
const PASSWORDS_FIXTURE = fileURLToPath(new URL('./src/test/fixtures/passwords.json', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],

    env: {
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'mock',
      // Session signing. Test-only value: authConfig requires JWT_SECRET to be
      // at least 32 characters, and without it tokenService throws rather than
      // signing.
      JWT_SECRET: 'test-only-jwt-secret-never-used-outside-the-suite',
      /**
       * Per-account sign-in credentials, one distinct password each.
       *
       * QMS_ALLOW_SHARED_PASSWORD is pinned OFF and QMS_SEED_PASSWORD blank, so
       * the suite runs in the mode a deployment should: no single secret opens
       * more than one account. A test that wants the legacy shared mode turns
       * it on itself with vi.stubEnv.
       */
      QMS_PASSWORDS_FILE: PASSWORDS_FIXTURE,
      QMS_ALLOW_SHARED_PASSWORD: '',
      QMS_SEED_PASSWORD: '',
      // No test may reach the live Gemma endpoint. Blank short-circuits
      // gemmaService to its deterministic fallback before any fetch, the same
      // way EMAIL_TRANSPORT=mock keeps Gmail out of the suite.
      GEMMA_API_URL: '',
      DATABASE_URL: '',
      MAILBOX_SOURCE: 'auto',
      // No test may reach the real NICeMail mailbox. Blank credentials and
      // hosts mean an un-stubbed action fails at the config or authenticate
      // stage instead of opening a socket. The live path is `npm run
      // nic:verify`, which is not a test file.
      NIC_EMAIL: '',
      NIC_APP_PASSWORD: '',
      NIC_APP_PASSWORD_FILE: '',
      NIC_IMAP_HOST: '',
      NIC_SMTP_HOST: '',
      NIC_TEST_RECIPIENT: '',
      // Unroutable on purpose: an un-stubbed attach fails instantly instead of
      // hanging, or worse, reaching a real Chrome on the developer's machine.
      NIC_CDP_ENDPOINT: 'http://127.0.0.1:1',

      /**
       * The NICeMail browser mailbox, pinned OFF. Every key here that is not
       * pinned is read from the developer's own backend/.env, because env.js
       * loads it and dotenv only skips keys that are already set. Enabling the
       * feature locally therefore changed what the suite saw: with
       * NIC_BROWSER_MAILBOX=true in .env, config validation reported an extra
       * error and email.test.js failed on a machine where nothing was wrong.
       * Tests that exercise the feature switch it on themselves (vi.stubEnv).
       */
      NIC_BROWSER_MAILBOX: '',
      NIC_FRONT_OFFICE_NAME: '',
      NIC_BROWSER_TEST_RECIPIENT: '',
      NIC_BROWSER_TIMEOUT_MS: '',
      NIC_BROWSER_SYNC_TTL_MS: '',
      NIC_BROWSER_SYNC_MAX: '',
      NIC_BROWSER_ARTIFACT_DIR: '',
      NIC_WEBMAIL_URL_PATTERNS: '',
      NIC_WEBMAIL_TITLE_PATTERNS: '',
      NIC_WEBMAIL_APP_URL: '',
      // The outbound interlock, pinned to its safe default. A developer who has
      // enabled real outbound mail locally must not run the suite with the
      // two-key check switched off.
      NIC_ALLOW_OUTBOUND: '',
      NIC_ALLOW_INTERNAL_FORWARD: '',

      INQUIRER_NAME: 'Test Inquirer',
      INQUIRER_EMAIL: 'inquirer@test.invalid',
      FRONT_OFFICE_NAME: 'Test Front Officer',
      FRONT_OFFICE_EMAIL: 'front-office@test.invalid',
      OFFICER_IN_CHARGE_NAME: 'Test Officer',
      OFFICER_IN_CHARGE_EMAIL: 'officer@test.invalid',
      // Isolated from the real dev store; setup.js resets it between tests.
      ATTACHMENT_DIR: path.join(os.tmpdir(), 'qms-test-attachments'),
    },
  },
});
