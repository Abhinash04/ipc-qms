import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],

    // Pin the email configuration for tests.
    //
    // `config/env.js` loads .env via dotenv, which does NOT overwrite variables
    // already present in process.env — so setting them here wins. Without this
    // the suite inherits whatever the developer last put in .env: switching
    // EMAIL_TRANSPORT=gmail to run the manual Gmail test (docs/EMAIL_MANUAL_TEST.md)
    // made the tests attempt real network sends and fail.
    //
    // Binding constraint: automated tests must never require real Gmail
    // credentials and must never perform a network send. This is what enforces it.
    env: {
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'mock',
      GMAIL_CLIENT_ID: '',
      GMAIL_CLIENT_SECRET: '',
      GMAIL_REFRESH_TOKEN: '',
      DATABASE_URL: '',
    },
  },
});
