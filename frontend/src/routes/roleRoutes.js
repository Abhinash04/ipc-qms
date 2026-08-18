import { ROLES } from '@/constants/roles';
import { sectionsForRole } from '@/constants/permissions';
import { sectionPath } from '@/constants/routePaths';

export const ROLE_ROUTES = Object.values(ROLES).flatMap((role) =>
  sectionsForRole(role).map((section) => ({
    role,
    section,
    path: sectionPath(role, section),
  })),
);
