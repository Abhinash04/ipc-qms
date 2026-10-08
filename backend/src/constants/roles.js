export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  FRONT_OFFICE: 'FRONT_OFFICE',
  OFFICER_IN_CHARGE: 'OFFICER_IN_CHARGE',
  ASSIGNED_OFFICIAL: 'ASSIGNED_OFFICIAL',
  REVIEWER: 'REVIEWER',
};

/** Where a self-registered account stands. Built-in accounts are always APPROVED. */
export const ACCOUNT_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DEACTIVATED: 'DEACTIVATED',
};

// Only a Super Admin may grant these.
export const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

export const ACTOR_TYPES = {
  HUMAN: 'human',
  AGENT: 'agent',
  SYSTEM: 'system',
};
