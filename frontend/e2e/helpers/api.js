import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { USERS } from '../../../backend/src/constants/users.js';
import { ROLES } from '../../../backend/src/constants/roles.js';

export const API_BASE = 'http://localhost:5000/api/v1';

function userForRole(role) {
  const user = USERS.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`No seeded user holds the role ${role}`);
  return user;
}
export const FRONT_OFFICE_USER = userForRole(ROLES.FRONT_OFFICE);
export const SUPER_ADMIN_USER = userForRole(ROLES.SUPER_ADMIN);
export const OFFICER_IN_CHARGE_USER = userForRole(ROLES.OFFICER_IN_CHARGE);
export const ASSIGNED_OFFICIAL_USER = userForRole(ROLES.ASSIGNED_OFFICIAL);
export const REVIEWER_USER = userForRole(ROLES.REVIEWER);
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

function userForEmail(email) {
  const user = USERS.find((candidate) => candidate.email.toLowerCase() === String(email).toLowerCase());
  if (!user) throw new Error(`No seeded user has the address ${email}`);
  return user;
}

export async function devSignIn(request, email) {
  const response = await request.post(`${API_BASE}/auth/dev-login`, { data: { email } });
  expect(
    response.ok(),
    `dev-login for ${email} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return (await response.json()).user;
}

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

export async function signInThroughUi(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(passwordFor(userForEmail(email)));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/[a-z-]+\/dashboard$/, { timeout: 30_000 });
}
export async function signInAs(page, email) {
  await page.context().clearCookies();
  await signInThroughUi(page, email);
}
