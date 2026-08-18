import { ROLES } from './roles';
import { SECTIONS } from './routeSections';
import { ROLE_SLUG, sectionsForRole } from './permissions';

export const ROUTE_PATHS = {
  LOGIN: '/login',
};

export { ROLE_SLUG };

export function sectionPath(role, section) {
  const slug = ROLE_SLUG[role];
  if (!slug) return ROUTE_PATHS.LOGIN;
  return `/${slug}/${SECTIONS[section].segment}`;
}

function buildPathsForRole(role) {
  const paths = {};
  for (const section of sectionsForRole(role)) {
    paths[section] = sectionPath(role, section);
  }
  return Object.freeze(paths);
}

export const PATHS_BY_ROLE = Object.freeze(
  Object.fromEntries(Object.values(ROLES).map((role) => [role, buildPathsForRole(role)])),
);

export const NO_PATHS = Object.freeze({});

export function pathsForRole(role) {
  return PATHS_BY_ROLE[role] || NO_PATHS;
}

export function roleHome(role) {
  return PATHS_BY_ROLE[role]?.DASHBOARD || ROUTE_PATHS.LOGIN;
}

export function buildPath(template, params = {}) {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, value),
    template,
  );
}
