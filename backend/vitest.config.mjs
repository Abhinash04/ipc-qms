import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      JWT_SECRET: 'test-only-jwt-secret-never-used-outside-the-suite',
      QMS_PASSWORDS_FILE: PASSWORDS_FIXTURE,
      QMS_ALLOW_SHARED_PASSWORD: '',
      QMS_SEED_PASSWORD: '',
      GEMMA_API_URL: '',
      DATABASE_URL: '',
      MAILBOX_SOURCE: 'auto',
      NIC_EMAIL: '',
      NIC_APP_PASSWORD: '',
      NIC_APP_PASSWORD_FILE: '',
      NIC_IMAP_HOST: '',
      NIC_SMTP_HOST: '',
      NIC_TEST_RECIPIENT: '',
      NIC_CDP_ENDPOINT: 'http://127.0.0.1:1',

      NIC_BROWSER_MAILBOX: '',
      NIC_BROWSER_VIEWER: '',
      NIC_FRONT_OFFICE_NAME: '',
      NIC_BROWSER_TEST_RECIPIENT: '',
      NIC_BROWSER_TIMEOUT_MS: '',
      NIC_BROWSER_SYNC_TTL_MS: '',
      NIC_BROWSER_SYNC_MAX: '',
      NIC_BROWSER_ARTIFACT_DIR: '',
      NIC_WEBMAIL_URL_PATTERNS: '',
      NIC_WEBMAIL_TITLE_PATTERNS: '',
      NIC_WEBMAIL_APP_URL: '',
      NIC_ALLOW_OUTBOUND: '',
      NIC_ALLOW_INTERNAL_FORWARD: '',

      FRONT_OFFICE_NAME: 'Test Front Officer',
      FRONT_OFFICE_EMAIL: 'front-office@test.invalid',
      OFFICER_IN_CHARGE_NAME: 'Test Officer',
      OFFICER_IN_CHARGE_EMAIL: 'officer@test.invalid',
      ATTACHMENT_DIR: path.join(os.tmpdir(), 'qms-test-attachments'),
    },
  },
});
