export const IDENTITY_ROLES = {
  FRONT_OFFICE: 'FRONT_OFFICE',
  OFFICER_IN_CHARGE: 'OFFICER_IN_CHARGE',
};

const DEFAULTS = {
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

  return {
    role,
    name: process.env[`${role}_NAME`] || defaults.name,
    email: (process.env[`${role}_EMAIL`] || defaults.email).trim(),
  };
}

export function identityForRole(role) {
  return DEFAULTS[role] ? readIdentity(role) : null;
}

export function allIdentities() {
  return Object.values(IDENTITY_ROLES).map(readIdentity);
}

export function formatSender(identity) {
  if (!identity) return '';
  return identity.name ? `${identity.name} <${identity.email}>` : identity.email;
}

export function publicDirectory() {
  return allIdentities().map(({ role, name, email }) => ({ role, name, email }));
}
