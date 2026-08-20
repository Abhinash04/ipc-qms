import env from './env.js';

export const IDENTITY_ROLES = {
  INQUIRER: 'INQUIRER',
  FRONT_OFFICE: 'FRONT_OFFICE',
  OFFICER_IN_CHARGE: 'OFFICER_IN_CHARGE',
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
