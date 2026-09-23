import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

// The backend's own user directory, imported rather than copied: it is the
// authority for ids, emails and roles (see the header of that file), and a
// second list here would be one more thing to drift.
import { USERS } from '../../../backend/src/constants/users.js';
import { ROLES } from '../../../backend/src/constants/roles.js';

/** The API is not behind the Vite dev server — it answers on its own origin. */
export const API_BASE = 'http://localhost:5000/api/v1';

function userForRole(role) {
  const user = USERS.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`No seeded user holds the role ${role}`);
  return user;
}

/** Bhumika Makker (USR-0002) — the Front Officer whose inbox this is. */
export const FRONT_OFFICE_USER = userForRole(ROLES.FRONT_OFFICE);

/** System Administrator (USR-0008) — POST /mailbox/receive is SUPER_ADMIN only. */
export const SUPER_ADMIN_USER = userForRole(ROLES.SUPER_ADMIN);

/** Jatin Rawat (USR-0003) — assigns the case, and grants final approval. */
export const OFFICER_IN_CHARGE_USER = userForRole(ROLES.OFFICER_IN_CHARGE);

/** Neha Singh (USR-0004) — the first Assigned Official in the directory. */
export const ASSIGNED_OFFICIAL_USER = userForRole(ROLES.ASSIGNED_OFFICIAL);

/**
 * Amit Mehta (USR-0005) — the first Reviewer.
 *
 * The lifecycle suite adds *this* person as the review level and then signs in
 * as them, because `approveReview` refuses a decision from anyone but the user
 * the current step is assigned to (assertOwnsStep in useWorkflowStore.js).
 */
export const REVIEWER_USER = userForRole(ROLES.REVIEWER);

/**
 * One account's sign-in password, from the file the server authenticates
 * against.
 *
 * Every account has its own, so there is nothing to share and no single secret
 * that opens the suite. playwright.config.js resolves QMS_PASSWORDS_FILE to an
 * absolute path and publishes it to this process as well as to the server, so
 * both halves read the same fixture and cannot disagree.
 *
 * It used to be one QMS_SEED_PASSWORD read out of the developer's own
 * backend/.env, which only worked because NODE_ENV is development here — the
 * one mode where an unset QMS_ALLOW_SHARED_PASSWORD still lets a single secret
 * open every account.
 */
let passwordsCache = null;

function passwords() {
  if (passwordsCache) return passwordsCache;

  const file = (process.env.QMS_PASSWORDS_FILE || '').trim();
  if (!file) {
    throw new Error(
      'QMS_PASSWORDS_FILE is not set. playwright.config.js sets it — run the suite ' +
        'with `npm run test:e2e` rather than invoking a spec directly.',
    );
  }
  passwordsCache = JSON.parse(readFileSync(file, 'utf8'));
  return passwordsCache;
}

export function passwordFor(user) {
  const password = passwords()[user.id];
  if (!password) {
    throw new Error(`No password for ${user.id} (${user.email}) in ${process.env.QMS_PASSWORDS_FILE}`);
  }
  return password;
}

/** The seeded account that signs in with this address. */
function userForEmail(email) {
  const user = USERS.find((candidate) => candidate.email.toLowerCase() === String(email).toLowerCase());
  if (!user) throw new Error(`No seeded user has the address ${email}`);
  return user;
}

/**
 * Sign an APIRequestContext in as a seeded account.
 *
 * Uses POST /api/v1/auth/dev-login (backend/src/routes/authRoutes.js), which is
 * password-less and 404s unless NODE_ENV=development — hence that setting in
 * backend/.env.e2e. The session arrives as an httpOnly cookie, which the
 * request context stores and replays on every later call it makes.
 */
export async function devSignIn(request, email) {
  const response = await request.post(`${API_BASE}/auth/dev-login`, { data: { email } });
  expect(
    response.ok(),
    `dev-login for ${email} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()).user;
}

/**
 * Put one inbound message in the Front Office mailbox.
 *
 * `to` is deliberately omitted: the controller defaults it to the configured
 * Front Office address, which is the same address GET /mailbox/messages lists
 * by default. Naming one here would only risk the two disagreeing.
 *
 * Requires a SUPER_ADMIN session — see mailboxRoutes.js.
 *
 * @returns the stored message, including the `mailboxMessageId` the UI keys on.
 */
export async function injectInboundMessage(request, { from, subject, body }) {
  const response = await request.post(`${API_BASE}/mailbox/receive`, {
    data: { from, subject, body },
  });
  expect(
    response.ok(),
    `mailbox/receive failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return response.json();
}

/**
 * Accept a message straight through the API, bypassing the UI.
 *
 * Only used to re-accept a message the browser has already accepted — the
 * duplicate case. FRONT_OFFICE and SUPER_ADMIN may both call it.
 */
export async function acceptViaApi(request, mailboxMessageId, message = {}) {
  const response = await request.post(
    `${API_BASE}/mailbox/messages/${encodeURIComponent(mailboxMessageId)}/accept`,
    { data: message },
  );
  expect(
    response.ok(),
    `accept for ${mailboxMessageId} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return response.json();
}

/**
 * Sign in through the real login form, as a person would.
 *
 * Not dev-login: this is the browser half of the test, and the session cookie
 * has to be set on the page's own context for the app to use it.
 */
export async function signInThroughUi(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(passwordFor(userForEmail(email)));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // roleHome(FRONT_OFFICE) — /<role slug>/dashboard. Landing on it is the
  // signal that the cookie was set and the auth store believes the session.
  await page.waitForURL(/\/[a-z-]+\/dashboard$/, { timeout: 30_000 });
}

/**
 * Hand the browser to the next role in the workflow.
 *
 * The cookie is dropped first, and that is load-bearing rather than tidiness.
 * `LoginPage` renders `<Navigate to={roleHome(currentUser.role)}>` the moment
 * `/auth/me` answers, so visiting /login while the previous role's session is
 * still live redirects straight to *their* dashboard — which matches the URL
 * `signInThroughUi` waits for. The sign-in would report success and the page
 * would still be the outgoing user, with every later click made as the wrong
 * person. Clearing the cookie makes /auth/me answer 401 and the form appear.
 */
export async function signInAs(page, email) {
  await page.context().clearCookies();
  await signInThroughUi(page, email);
}
