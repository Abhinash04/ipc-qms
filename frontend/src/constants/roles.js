/**
 * Role hierarchy for RBAC. Hierarchy (see docs/srs/03-stakeholders-and-roles.md)
 * does NOT imply a higher role can perform every workflow action — permissions
 * are explicit, see permissions.js.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  FRONT_OFFICE: 'FRONT_OFFICE',
  OFFICER_IN_CHARGE: 'OFFICER_IN_CHARGE',
  ASSIGNED_OFFICIAL: 'ASSIGNED_OFFICIAL',
  REVIEWER: 'REVIEWER',
  // Not part of the internal role hierarchy — external party who submitted the
  // query. Included so the mock user dataset (spec: dummy users) is complete.
  INQUIRER: 'INQUIRER',
};

export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.ADMIN]: 'Admin',
  [ROLES.FRONT_OFFICE]: 'Front Office',
  [ROLES.OFFICER_IN_CHARGE]: 'Officer-in-Charge',
  [ROLES.ASSIGNED_OFFICIAL]: 'Assigned Official',
  [ROLES.REVIEWER]: 'Reviewer',
  [ROLES.INQUIRER]: 'Inquirer',
};
