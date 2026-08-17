import { ROLES } from './roles';
import { ROUTE_PATHS } from './routePaths';

/**
 * Role -> allowed route-prefix map. A route is accessible to a role if the
 * current path starts with one of its listed prefixes. This is a frontend
 * display gate only — real authorization must be enforced by the backend
 * once it exists.
 */
export const ROLE_ROUTE_PREFIXES = {
  [ROLES.SUPER_ADMIN]: [
    ROUTE_PATHS.DASHBOARD,
    ROUTE_PATHS.QUERIES,
    ROUTE_PATHS.MY_WORK,
    ROUTE_PATHS.ASSIGNMENTS,
    ROUTE_PATHS.DRAFTING,
    ROUTE_PATHS.REVIEWS,
    ROUTE_PATHS.APPROVALS,
    ROUTE_PATHS.DISPATCH,
    ROUTE_PATHS.NOTIFICATIONS,
    ROUTE_PATHS.ADMIN,
    ROUTE_PATHS.REPORTS,
  ],
  [ROLES.ADMIN]: [
    ROUTE_PATHS.DASHBOARD,
    ROUTE_PATHS.QUERIES,
    ROUTE_PATHS.NOTIFICATIONS,
    ROUTE_PATHS.ADMIN,
    ROUTE_PATHS.REPORTS,
  ],
  [ROLES.FRONT_OFFICE]: [
    ROUTE_PATHS.DASHBOARD,
    ROUTE_PATHS.QUERIES,
    ROUTE_PATHS.DISPATCH,
    ROUTE_PATHS.NOTIFICATIONS,
  ],
  [ROLES.OFFICER_IN_CHARGE]: [
    ROUTE_PATHS.DASHBOARD,
    ROUTE_PATHS.QUERIES,
    ROUTE_PATHS.ASSIGNMENTS,
    ROUTE_PATHS.APPROVALS,
    ROUTE_PATHS.NOTIFICATIONS,
    ROUTE_PATHS.REPORTS,
  ],
  [ROLES.ASSIGNED_OFFICIAL]: [
    ROUTE_PATHS.DASHBOARD,
    ROUTE_PATHS.QUERIES,
    ROUTE_PATHS.MY_WORK,
    ROUTE_PATHS.DRAFTING,
    ROUTE_PATHS.NOTIFICATIONS,
  ],
  [ROLES.REVIEWER]: [
    ROUTE_PATHS.DASHBOARD,
    ROUTE_PATHS.QUERIES,
    ROUTE_PATHS.MY_WORK,
    ROUTE_PATHS.REVIEWS,
    ROUTE_PATHS.NOTIFICATIONS,
  ],
  [ROLES.INQUIRER]: [],
};

export function isRouteAllowedForRole(role, pathname) {
  const prefixes = ROLE_ROUTE_PREFIXES[role] || [];
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}
