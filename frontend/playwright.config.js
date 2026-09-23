import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(FRONTEND_ROOT, '../backend');

/**
 * Minimal `KEY=value` reader — enough for the two files below and nothing more.
 * Deliberately not a dotenv dependency: the frontend package has no reason to
 * grow one just so the test runner can read the backend's configuration.
 */
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

/**
 * The E2E backend settings.
 *
 * `ENV_FILE` is what the server reads them by: backend/src/config/env.js loads
 * that file before .env, and dotenv never overwrites a variable already set, so
 * .env.e2e wins on every key it declares while .env still supplies JWT_SECRET
 * and QMS_SEED_PASSWORD, which it deliberately omits.
 *
 * The values are also parsed here and passed through `webServer.env`, so the
 * runner knows the database name it is about to assert against without opening
 * the file twice.
 */
const backendEnv = readEnvFile(path.join(BACKEND_ROOT, '.env.e2e'));

/**
 * The suite signs in with the shared seed password. It is never hard-coded: it
 * comes from the environment, falling back to the backend's own .env — the same
 * file the server reads it from, and already a prerequisite for the server to
 * boot at all.
 */
if (!process.env.QMS_SEED_PASSWORD) {
  const seeded = readEnvFile(path.join(BACKEND_ROOT, '.env')).QMS_SEED_PASSWORD;
  if (seeded) process.env.QMS_SEED_PASSWORD = seeded;
}

export default defineConfig({
  testDir: './e2e',

  // The tests share one database (qms_e2e) and each starts by wiping it,
  // so they cannot overlap. One worker, no parallelism, and no retries — a
  // retry would re-run against state the first attempt already changed.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),

  // Generous: a cold Vite dev server compiles the whole route tree on the
  // first navigation, and one accept is a case write plus two mock sends.
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
      env: { ...backendEnv, ENV_FILE: '.env.e2e' },
      port: 5000,
      /**
       * Never reuse a backend this suite did not start — not even locally.
       *
       * `reuseExistingServer: true` adopts whatever is already on :5000,
       * including its database and its mail transport. That nearly happened
       * here: a backend left running from an earlier session was on that port
       * pointed at a real mailbox and the development database, so the suite
       * would have read live mail and written its test cases into real
       * data. Refusing to start is a two-second fix; the other
       * outcome is not visible until afterwards.
       */
      reuseExistingServer: false,
      timeout: 60_000,
      // stdout stays hidden: morgan logs every request and drowns the test
      // results. stderr is piped so a crash or a config rejection is visible.
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // `--strictPort` is load-bearing. The backend's CORS allows exactly ONE
      // origin (`cors({ origin: env.CLIENT_URL, credentials: true })` in
      // backend/src/app.js, CLIENT_URL=http://localhost:5173). Vite's default
      // is to hop to 5174 when 5173 is taken; Playwright would happily drive
      // that page, and every API call from it would then be blocked as a
      // cross-origin request with no session cookie. Failing to start is the
      // far better outcome.
      command: 'npm run dev -- --strictPort --port 5173',
      cwd: FRONTEND_ROOT,
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
