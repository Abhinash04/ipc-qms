/**
 * Single source of truth for route path strings. Never hardcode paths in
 * components — import ROUTE_PATHS instead.
 */
export const ROUTE_PATHS = {
  LOGIN: '/login',

  DASHBOARD: '/dashboard',

  QUERIES: '/queries',
  QUERY_DETAIL: '/queries/:queryId',

  MY_WORK: '/my-work',

  ASSIGNMENTS: '/assignments',
  ASSIGNMENT_DETAIL: '/assignments/:queryId',

  DRAFTING: '/drafting',
  DRAFTING_DETAIL: '/drafting/:queryId',

  REVIEWS: '/reviews',
  REVIEW_DETAIL: '/reviews/:queryId',

  APPROVALS: '/approvals',
  APPROVAL_DETAIL: '/approvals/:queryId',

  DISPATCH: '/dispatch',
  DISPATCH_DETAIL: '/dispatch/:queryId',

  NOTIFICATIONS: '/notifications',

  ADMIN: '/admin',
  ADMIN_USERS: '/admin/users',
  ADMIN_ROLES: '/admin/roles',
  ADMIN_DIVISIONS: '/admin/divisions',
  ADMIN_WORKFLOWS: '/admin/workflows',
  ADMIN_CATEGORIES: '/admin/categories',

  REPORTS: '/reports',
};

/** Builds a concrete path from a `:param` template, e.g. buildPath(QUERY_DETAIL, { queryId: 'QRY-2026-00427' }). */
export function buildPath(template, params = {}) {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, value),
    template,
  );
}
