import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_MONGO_URL } from './e2e/helpers/db.js';

const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(FRONTEND_ROOT, '../backend');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}
const E2E_ENV_FILE = path.join(BACKEND_ROOT, '.env.e2e');
if (!fs.existsSync(E2E_ENV_FILE)) {
  throw new Error(
    `The e2e backend settings are missing: ${E2E_ENV_FILE}. Without them the backend would load backend/.env and its database.`,
  );
}
const backendEnv = readEnvFile(E2E_ENV_FILE);
if (backendEnv.DATABASE_URL !== E2E_MONGO_URL) {
  throw new Error(
    `backend/.env.e2e must set DATABASE_URL to exactly ${E2E_MONGO_URL}; the suite wipes that database between specs.`,
  );
}
const PASSWORDS_FIXTURE = path.join(BACKEND_ROOT, 'src', 'test', 'fixtures', 'passwords.json');
if (!fs.existsSync(PASSWORDS_FIXTURE)) {
  throw new Error(`The e2e credential fixture is missing: ${PASSWORDS_FIXTURE}`);
}
process.env.QMS_PASSWORDS_FILE = PASSWORDS_FIXTURE;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm start',
      cwd: BACKEND_ROOT,
      env: { ...backendEnv, ENV_FILE: '.env.e2e', QMS_PASSWORDS_FILE: PASSWORDS_FIXTURE },
      port: 5000,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -- --strictPort --port 5173',
      cwd: FRONTEND_ROOT,
      env: { ...process.env, VITE_API_BASE_URL: 'http://localhost:5000/api/v1' },
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
