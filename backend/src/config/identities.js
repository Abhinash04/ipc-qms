import env from './env.js';

export const IDENTITY_ROLES = {
  INQUIRER: 'INQUIRER',
  FRONT_OFFICE: 'FRONT_OFFICE',
  OFFICER_IN_CHARGE: 'OFFICER_IN_CHARGE',
  ASSIGNED_OFFICIAL: 'ASSIGNED_OFFICIAL',
};

const DEFAULTS = {
  [IDENTITY_ROLES.INQUIRER]: {
    name: 'Abhinash Pritiraj',
    email: 'abhinash.pritiraj@gmail.com',
  },
  [IDENTITY_ROLES.FRONT_OFFICE]: {
    name: 'Bhumika Makker',
    email: 'bhoomikamakker@gmail.com',
  },
  [IDENTITY_ROLES.OFFICER_IN_CHARGE]: {
    name: 'Jatin Rawat',
    email: 'rawatjatin436@gmail.com',
  },
  // NOT the same person as the Officer-in-Charge above, despite the near
  // identical name. Different human, different account, different role.
  // The email address is what tells them apart — never the display name.
  [IDENTITY_ROLES.ASSIGNED_OFFICIAL]: {
    name: 'Rawat Jatin',
    email: 'jatinrawat55361@gmail.com',
  },
};

function readIdentity(role) {
  const defaults = DEFAULTS[role];

  // Each role reads only its own token. There is no shared or fallback token:
  // one refresh token authenticates one Gmail account, so a role that has none
  // falls back to the mock transport rather than borrowing another identity.
  const refreshToken = process.env[`GMAIL_REFRESH_TOKEN_${role}`] || '';

  return {
    role,
    name: process.env[`${role}_NAME`] || defaults.name,
    email: (process.env[`${role}_EMAIL`] || defaults.email).trim(),
    refreshToken,
    canSendReal: Boolean(refreshToken && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET),
  };
}

export function identityForRole(role) {
  return DEFAULTS[role] ? readIdentity(role) : null;
}

export function allIdentities() {
  return Object.values(IDENTITY_ROLES).map(readIdentity);
}

/**
 * Resolve an identity from the acting user's address.
 *
 * Prefer this over `identityForRole`, because a role can hold more than one
 * person: ASSIGNED_OFFICIAL covers both the real Rawat Jatin and the mock Neha
 * Singh. Resolving by role alone would send Neha's mail from Rawat's Gmail
 * account — the QMS would record one sender and the recipient would see another.
 *
 * A user with no configured identity returns null, which routes them to the
 * mock transport rather than borrowing someone else's credentials.
 */
export function identityForEmail(email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;
  return allIdentities().find((identity) => identity.email.toLowerCase() === wanted) || null;
}

export function formatSender(identity) {
  if (!identity) return '';
  return identity.name ? `${identity.name} <${identity.email}>` : identity.email;
}

export function publicDirectory() {
  return allIdentities().map(({ role, name, email, canSendReal }) => ({
    role,
    name,
    email,
    canSendReal,
  }));
}
