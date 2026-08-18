import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test/setup.js'],

    env: {
      NODE_ENV: 'test',
      EMAIL_TRANSPORT: 'mock',
      GMAIL_CLIENT_ID: '',
      GMAIL_CLIENT_SECRET: '',
      GMAIL_REFRESH_TOKEN_INQUIRER: '',
      GMAIL_REFRESH_TOKEN_FRONT_OFFICE: '',
      GMAIL_REFRESH_TOKEN_OFFICER_IN_CHARGE: '',
      DATABASE_URL: '',
      MAILBOX_SOURCE: 'auto',
      INQUIRER_NAME: 'Test Inquirer',
      INQUIRER_EMAIL: 'inquirer@test.invalid',
      FRONT_OFFICE_NAME: 'Test Front Officer',
      FRONT_OFFICE_EMAIL: 'front-office@test.invalid',
      OFFICER_IN_CHARGE_NAME: 'Test Officer',
      OFFICER_IN_CHARGE_EMAIL: 'officer@test.invalid',
      ASSIGNED_OFFICIAL_NAME: 'Test Assigned Official',
      ASSIGNED_OFFICIAL_EMAIL: 'assigned-official@test.invalid',
      GMAIL_REFRESH_TOKEN_ASSIGNED_OFFICIAL: '',
    },
  },
});
