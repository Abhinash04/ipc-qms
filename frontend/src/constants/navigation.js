import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.mjs';
import Inbox from 'lucide-react/dist/esm/icons/inbox.mjs';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.mjs';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.mjs';
import PenLine from 'lucide-react/dist/esm/icons/pen-line.mjs';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.mjs';
import Stamp from 'lucide-react/dist/esm/icons/stamp.mjs';
import Send from 'lucide-react/dist/esm/icons/send.mjs';
import Bell from 'lucide-react/dist/esm/icons/bell.mjs';
import Settings from 'lucide-react/dist/esm/icons/settings.mjs';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.mjs';

import { ROLES } from './roles';
import { ROUTE_PATHS } from './routePaths';

export const NAV_ITEMS = [
  { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD, icon: LayoutDashboard, roles: Object.values(ROLES) },
  { label: 'Queries', path: ROUTE_PATHS.QUERIES, icon: Inbox, roles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER] },
  { label: 'My Work', path: ROUTE_PATHS.MY_WORK, icon: ListChecks, roles: [ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER, ROLES.SUPER_ADMIN] },
  { label: 'Assignments', path: ROUTE_PATHS.ASSIGNMENTS, icon: UserCheck, roles: [ROLES.OFFICER_IN_CHARGE, ROLES.SUPER_ADMIN] },
  { label: 'Drafting', path: ROUTE_PATHS.DRAFTING, icon: PenLine, roles: [ROLES.ASSIGNED_OFFICIAL, ROLES.SUPER_ADMIN] },
  { label: 'Reviews', path: ROUTE_PATHS.REVIEWS, icon: ClipboardCheck, roles: [ROLES.REVIEWER, ROLES.SUPER_ADMIN] },
  { label: 'Approvals', path: ROUTE_PATHS.APPROVALS, icon: Stamp, roles: [ROLES.OFFICER_IN_CHARGE, ROLES.SUPER_ADMIN] },
  { label: 'Dispatch', path: ROUTE_PATHS.DISPATCH, icon: Send, roles: [ROLES.FRONT_OFFICE, ROLES.SUPER_ADMIN] },
  { label: 'Notifications', path: ROUTE_PATHS.NOTIFICATIONS, icon: Bell, roles: Object.values(ROLES) },
  { label: 'Reports', path: ROUTE_PATHS.REPORTS, icon: BarChart3, roles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.OFFICER_IN_CHARGE] },
  { label: 'Admin', path: ROUTE_PATHS.ADMIN, icon: Settings, roles: [ROLES.SUPER_ADMIN, ROLES.ADMIN] },
];
