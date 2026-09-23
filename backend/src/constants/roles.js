/**
 * Role names, mirrored deliberately from `frontend/src/constants/roles.js`.
 *
 * The two lists must stay identical: a session JWT carries a role string that
 * the frontend's RBAC tables (permissions.js, workflowRules.js) look up
 * directly.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  FRONT_OFFICE: 'FRONT_OFFICE',
  OFFICER_IN_CHARGE: 'OFFICER_IN_CHARGE',
  ASSIGNED_OFFICIAL: 'ASSIGNED_OFFICIAL',
  REVIEWER: 'REVIEWER',
};

/**
 * Who is taking an action — a separate axis from role, not a role of its own.
 *
 * The NIC mail agent acts as itself while holding no human's authority: it may
 * read and prepare, never send or delete. Encoding that as a role would let a
 * misconfigured role table hand the agent send rights; encoding it as an actor
 * type means the check cannot be reached at all — see constants/capabilities.js.
 */
export const ACTOR_TYPES = {
  HUMAN: 'human',
  AGENT: 'agent',
  SYSTEM: 'system',
};
