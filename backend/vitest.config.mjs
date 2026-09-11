import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],

    env: {
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'mock',
      // Session signing and the seeded sign-in password. Test-only values:
      // authConfig requires JWT_SECRET to be at least 32 characters, and
      // without them tokenService throws rather than signing.
      JWT_SECRET: 'test-only-jwt-secret-never-used-outside-the-suite',
      QMS_SEED_PASSWORD: 'test-seed-password',
      // No test may reach the live Gemma endpoint. Blank short-circuits
      // gemmaService to its deterministic fallback before any fetch, the same
      // way EMAIL_TRANSPORT=mock keeps Gmail out of the suite.
      GEMMA_API_URL: '',
      GMAIL_CLIENT_ID: '',
      GMAIL_CLIENT_SECRET: '',
      GMAIL_REFRESH_TOKEN_INQUIRER: '',
      GMAIL_REFRESH_TOKEN_FRONT_OFFICE: '',
      GMAIL_REFRESH_TOKEN_OFFICER_IN_CHARGE: '',
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
