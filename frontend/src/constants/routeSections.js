import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.mjs';
import MailPlus from 'lucide-react/dist/esm/icons/mail-plus.mjs';
import Inbox from 'lucide-react/dist/esm/icons/inbox.mjs';
import Mail from 'lucide-react/dist/esm/icons/mail.mjs';
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.mjs';
import UserCheck from 'lucide-react/dist/esm/icons/user-check.mjs';
import PenLine from 'lucide-react/dist/esm/icons/pen-line.mjs';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.mjs';
import Stamp from 'lucide-react/dist/esm/icons/stamp.mjs';
import Send from 'lucide-react/dist/esm/icons/send.mjs';
import Bell from 'lucide-react/dist/esm/icons/bell.mjs';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.mjs';
import Settings from 'lucide-react/dist/esm/icons/settings.mjs';
import Users from 'lucide-react/dist/esm/icons/users.mjs';
import Shield from 'lucide-react/dist/esm/icons/shield.mjs';
import Building2 from 'lucide-react/dist/esm/icons/building-2.mjs';
import Workflow from 'lucide-react/dist/esm/icons/workflow.mjs';
import Tag from 'lucide-react/dist/esm/icons/tag.mjs';

export const SECTION = {
  DASHBOARD: 'DASHBOARD',
  COMPOSE: 'COMPOSE',
  INBOX: 'INBOX',
  QUERIES: 'QUERIES',
  QUERY_DETAIL: 'QUERY_DETAIL',
  MY_WORK: 'MY_WORK',
  ASSIGNMENTS: 'ASSIGNMENTS',
  ASSIGNMENT_DETAIL: 'ASSIGNMENT_DETAIL',
  DRAFTING: 'DRAFTING',
  DRAFTING_DETAIL: 'DRAFTING_DETAIL',
  REVIEWS: 'REVIEWS',
  REVIEW_DETAIL: 'REVIEW_DETAIL',
  APPROVALS: 'APPROVALS',
  APPROVAL_DETAIL: 'APPROVAL_DETAIL',
  DISPATCH: 'DISPATCH',
  DISPATCH_DETAIL: 'DISPATCH_DETAIL',
  NOTIFICATIONS: 'NOTIFICATIONS',
  REPORTS: 'REPORTS',
  ADMINISTRATION: 'ADMINISTRATION',
  USERS: 'USERS',
  ROLES_DIRECTORY: 'ROLES_DIRECTORY',
  DIVISIONS: 'DIVISIONS',
  WORKFLOWS: 'WORKFLOWS',
  CATEGORIES: 'CATEGORIES',
};

export const SECTIONS = {
  [SECTION.DASHBOARD]: { segment: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, nav: true },
  [SECTION.COMPOSE]: { segment: 'compose', label: 'Raise Enquiry', icon: MailPlus, nav: true },
  [SECTION.INBOX]: { segment: 'inbox', label: 'IPC Mailbox', icon: Mail, nav: true },
  [SECTION.QUERIES]: { segment: 'queries', label: 'Queries', icon: Inbox, nav: true },
  [SECTION.QUERY_DETAIL]: { segment: 'queries/:queryId' },
  [SECTION.MY_WORK]: { segment: 'my-work', label: 'My Work', icon: ListChecks, nav: true },
  [SECTION.ASSIGNMENTS]: { segment: 'assignments', label: 'Assignments', icon: UserCheck, nav: true },
  [SECTION.ASSIGNMENT_DETAIL]: { segment: 'assignments/:queryId' },
  [SECTION.DRAFTING]: { segment: 'drafting', label: 'Drafting', icon: PenLine, nav: true },
  [SECTION.DRAFTING_DETAIL]: { segment: 'drafting/:queryId' },
  [SECTION.REVIEWS]: { segment: 'reviews', label: 'Reviews', icon: ClipboardCheck, nav: true },
  [SECTION.REVIEW_DETAIL]: { segment: 'reviews/:queryId' },
  [SECTION.APPROVALS]: { segment: 'approvals', label: 'Approvals', icon: Stamp, nav: true },
  [SECTION.APPROVAL_DETAIL]: { segment: 'approvals/:queryId' },
  [SECTION.DISPATCH]: { segment: 'dispatch', label: 'Dispatch', icon: Send, nav: true },
  [SECTION.DISPATCH_DETAIL]: { segment: 'dispatch/:queryId' },
  [SECTION.NOTIFICATIONS]: { segment: 'notifications', label: 'Notifications', icon: Bell, nav: true },
  [SECTION.REPORTS]: { segment: 'reports', label: 'Reports', icon: BarChart3, nav: true },
  [SECTION.ADMINISTRATION]: { segment: 'administration', label: 'Administration', icon: Settings, nav: true },
  [SECTION.USERS]: { segment: 'users', label: 'Users', icon: Users },
  [SECTION.ROLES_DIRECTORY]: { segment: 'roles', label: 'Roles', icon: Shield },
  [SECTION.DIVISIONS]: { segment: 'divisions', label: 'Divisions', icon: Building2 },
  [SECTION.WORKFLOWS]: { segment: 'workflows', label: 'Workflows', icon: Workflow },
  [SECTION.CATEGORIES]: { segment: 'categories', label: 'Categories', icon: Tag },
};

export const SECTION_ORDER = Object.keys(SECTIONS);
