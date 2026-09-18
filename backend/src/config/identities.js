import env from './env.js';

export const IDENTITY_ROLES = {
  INQUIRER: 'INQUIRER',
  FRONT_OFFICE: 'FRONT_OFFICE',
  OFFICER_IN_CHARGE: 'OFFICER_IN_CHARGE',
};

/**
 * Placeholders, not people.
 *
 * These used to be three named individuals' real Gmail addresses, which meant a
 * deployment that forgot to set `<ROLE>_EMAIL` mailed private accounts from a
 * government system — and put personal data in the repository. `@example.com`
 * is reserved by RFC 2606 and cannot receive mail, so a missing variable now
 * fails visibly instead of quietly reaching the wrong person.
 */
const DEFAULTS = {
  [IDENTITY_ROLES.INQUIRER]: {
    name: 'Inquirer (unconfigured)',
    email: 'inquirer-unconfigured@example.com',
  },
  [IDENTITY_ROLES.FRONT_OFFICE]: {
    name: 'Front Officer (unconfigured)',
    email: 'front-office-unconfigured@example.com',
  },
  [IDENTITY_ROLES.OFFICER_IN_CHARGE]: {
    name: 'Officer-in-Charge (unconfigured)',
    email: 'officer-in-charge-unconfigured@example.com',
  },
};

function readIdentity(role) {
  const defaults = DEFAULTS[role];
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
