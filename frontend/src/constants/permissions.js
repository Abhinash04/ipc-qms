import { ROLES } from './roles';
import { SECTION, SECTIONS } from './routeSections';

export const ROLE_SLUG = {
  [ROLES.SUPER_ADMIN]: 'super-admin',
  [ROLES.ADMIN]: 'admin',
  [ROLES.FRONT_OFFICE]: 'front-officer',
  [ROLES.OFFICER_IN_CHARGE]: 'officer-in-charge',
  [ROLES.ASSIGNED_OFFICIAL]: 'assigned-official',
  [ROLES.REVIEWER]: 'reviewer',
  [ROLES.INQUIRER]: 'inquirer',
};

const ADMIN_CONSOLE = [
  SECTION.ADMINISTRATION,
  SECTION.USERS,
  SECTION.ROLES_DIRECTORY,
  SECTION.DIVISIONS,
  SECTION.WORKFLOWS,
  SECTION.CATEGORIES,
];

export const ROLE_SECTIONS = {
  [ROLES.INQUIRER]: [SECTION.DASHBOARD, SECTION.COMPOSE, SECTION.QUERY_DETAIL],

  [ROLES.FRONT_OFFICE]: [
    SECTION.DASHBOARD,
    SECTION.INBOX,
    SECTION.QUERIES,
    SECTION.QUERY_DETAIL,
    SECTION.DISPATCH,
    SECTION.DISPATCH_DETAIL,
    SECTION.NOTIFICATIONS,
  ],

  [ROLES.OFFICER_IN_CHARGE]: [
    SECTION.DASHBOARD,
    SECTION.QUERIES,
    SECTION.QUERY_DETAIL,
    SECTION.ASSIGNMENTS,
    SECTION.ASSIGNMENT_DETAIL,
    SECTION.APPROVALS,
    SECTION.APPROVAL_DETAIL,
    SECTION.NOTIFICATIONS,
    SECTION.REPORTS,
  ],

  [ROLES.ASSIGNED_OFFICIAL]: [
    SECTION.DASHBOARD,
    SECTION.QUERIES,
    SECTION.QUERY_DETAIL,
    SECTION.MY_WORK,
    SECTION.DRAFTING,
    SECTION.DRAFTING_DETAIL,
    SECTION.NOTIFICATIONS,
  ],

  [ROLES.REVIEWER]: [
    SECTION.DASHBOARD,
    SECTION.QUERIES,
    SECTION.QUERY_DETAIL,
    SECTION.MY_WORK,
    SECTION.REVIEWS,
    SECTION.REVIEW_DETAIL,
    SECTION.NOTIFICATIONS,
  ],

  [ROLES.ADMIN]: [
    SECTION.DASHBOARD,
    SECTION.QUERIES,
    SECTION.QUERY_DETAIL,
    SECTION.NOTIFICATIONS,
    SECTION.REPORTS,
    ...ADMIN_CONSOLE,
  ],

  [ROLES.SUPER_ADMIN]: Object.keys(SECTIONS),
};

export function sectionsForRole(role) {
  return ROLE_SECTIONS[role] || [];
}

export function roleHasSection(role, section) {
  return sectionsForRole(role).includes(section);
}

export function isRouteAllowedForRole(role, pathname) {
  const slug = ROLE_SLUG[role];
  if (!slug) return false;

  const prefix = `/${slug}/`;
  if (!pathname.startsWith(prefix)) return false;

  const rest = pathname.slice(prefix.length).replace(/\/+$/, '');
  return sectionsForRole(role).some((section) =>
    segmentMatches(SECTIONS[section].segment, rest),
  );
}

function segmentMatches(template, actual) {
  const templateParts = template.split('/');
  const actualParts = actual.split('/');
  if (templateParts.length !== actualParts.length) return false;

  return templateParts.every((part, index) =>
    part.startsWith(':') ? actualParts[index] !== '' : part === actualParts[index],
  );
}
