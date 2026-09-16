import { lazy } from 'react';
import { SECTION } from '@/constants/routeSections';

/**
 * Production page-loading strategy: every page (and the authenticated shell)
 * is a lazy route chunk, so the login page never downloads the app shell and
 * one role never downloads another role's pages.
 *
 * Vitest swaps this module for `routeElements.eager.jsx` (see vite.config.js)
 * because the suites drive pages synchronously after render.
 */
const lazyPage = (loader, name) =>
  lazy(() => loader().then((module) => ({ default: module[name] })));

export const MainLayout = lazyPage(() => import('@/layouts/MainLayout'), 'MainLayout');
export const LoginPage = lazyPage(() => import('@/pages/auth/LoginPage'), 'LoginPage');

const DashboardPage = lazyPage(() => import('@/pages/dashboard/DashboardPage'), 'DashboardPage');
const ComposeEnquiryPage = lazyPage(() => import('@/pages/inquirer/ComposeEnquiryPage'), 'ComposeEnquiryPage');
const MailboxInboxPage = lazyPage(() => import('@/pages/frontOffice/MailboxInboxPage'), 'MailboxInboxPage');
const QueriesListPage = lazyPage(() => import('@/pages/queries/QueriesListPage'), 'QueriesListPage');
const QueryDetailPage = lazyPage(() => import('@/pages/queries/QueryDetailPage'), 'QueryDetailPage');
const MyWorkPage = lazyPage(() => import('@/pages/myWork/MyWorkPage'), 'MyWorkPage');
const AssignmentsListPage = lazyPage(() => import('@/pages/assignments/AssignmentsListPage'), 'AssignmentsListPage');
const AssignmentDetailPage = lazyPage(() => import('@/pages/assignments/AssignmentDetailPage'), 'AssignmentDetailPage');
const DraftingListPage = lazyPage(() => import('@/pages/drafting/DraftingListPage'), 'DraftingListPage');
const DraftingDetailPage = lazyPage(() => import('@/pages/drafting/DraftingDetailPage'), 'DraftingDetailPage');
const ReviewsListPage = lazyPage(() => import('@/pages/reviews/ReviewsListPage'), 'ReviewsListPage');
const ReviewDetailPage = lazyPage(() => import('@/pages/reviews/ReviewDetailPage'), 'ReviewDetailPage');
const ApprovalsListPage = lazyPage(() => import('@/pages/approvals/ApprovalsListPage'), 'ApprovalsListPage');
const ApprovalDetailPage = lazyPage(() => import('@/pages/approvals/ApprovalDetailPage'), 'ApprovalDetailPage');
const DispatchListPage = lazyPage(() => import('@/pages/dispatch/DispatchListPage'), 'DispatchListPage');
const DispatchDetailPage = lazyPage(() => import('@/pages/dispatch/DispatchDetailPage'), 'DispatchDetailPage');
const NotificationsPage = lazyPage(() => import('@/pages/notifications/NotificationsPage'), 'NotificationsPage');
const ReportsPage = lazyPage(() => import('@/pages/reports/ReportsPage'), 'ReportsPage');
const AdminOverviewPage = lazyPage(() => import('@/pages/admin/AdminOverviewPage'), 'AdminOverviewPage');
const AdminUsersPage = lazyPage(() => import('@/pages/admin/AdminUsersPage'), 'AdminUsersPage');
const AdminRolesPage = lazyPage(() => import('@/pages/admin/AdminRolesPage'), 'AdminRolesPage');
const AdminDivisionsPage = lazyPage(() => import('@/pages/admin/AdminDivisionsPage'), 'AdminDivisionsPage');
const AdminWorkflowsPage = lazyPage(() => import('@/pages/admin/AdminWorkflowsPage'), 'AdminWorkflowsPage');
const AdminCategoriesPage = lazyPage(() => import('@/pages/admin/AdminCategoriesPage'), 'AdminCategoriesPage');
const AdminActivityPage = lazyPage(() => import('@/pages/admin/AdminActivityPage'), 'AdminActivityPage');
const AdminEmailActivityPage = lazyPage(() => import('@/pages/admin/AdminEmailActivityPage'), 'AdminEmailActivityPage');
const AdminAiActivityPage = lazyPage(() => import('@/pages/admin/AdminAiActivityPage'), 'AdminAiActivityPage');
const AdminSettingsPage = lazyPage(() => import('@/pages/admin/AdminSettingsPage'), 'AdminSettingsPage');

export const SECTION_ELEMENT = {
  [SECTION.DASHBOARD]: <DashboardPage />,
  [SECTION.COMPOSE]: <ComposeEnquiryPage />,
  [SECTION.INBOX]: <MailboxInboxPage />,
  [SECTION.QUERIES]: <QueriesListPage />,
  [SECTION.QUERY_DETAIL]: <QueryDetailPage />,
  [SECTION.MY_WORK]: <MyWorkPage />,
  [SECTION.ASSIGNMENTS]: <AssignmentsListPage />,
  [SECTION.ASSIGNMENT_DETAIL]: <AssignmentDetailPage />,
  [SECTION.DRAFTING]: <DraftingListPage />,
  [SECTION.DRAFTING_DETAIL]: <DraftingDetailPage />,
  [SECTION.REVIEWS]: <ReviewsListPage />,
  [SECTION.REVIEW_DETAIL]: <ReviewDetailPage />,
  [SECTION.APPROVALS]: <ApprovalsListPage />,
  [SECTION.APPROVAL_DETAIL]: <ApprovalDetailPage />,
  [SECTION.DISPATCH]: <DispatchListPage />,
  [SECTION.DISPATCH_DETAIL]: <DispatchDetailPage />,
  [SECTION.NOTIFICATIONS]: <NotificationsPage />,
  [SECTION.REPORTS]: <ReportsPage />,
  [SECTION.ADMINISTRATION]: <AdminOverviewPage />,
  [SECTION.USERS]: <AdminUsersPage />,
  [SECTION.ROLES_DIRECTORY]: <AdminRolesPage />,
  [SECTION.DIVISIONS]: <AdminDivisionsPage />,
  [SECTION.WORKFLOWS]: <AdminWorkflowsPage />,
  [SECTION.CATEGORIES]: <AdminCategoriesPage />,
  [SECTION.ADMIN_ACTIVITY]: <AdminActivityPage />,
  [SECTION.ADMIN_EMAIL]: <AdminEmailActivityPage />,
  [SECTION.ADMIN_AI]: <AdminAiActivityPage />,
  [SECTION.ADMIN_SETTINGS]: <AdminSettingsPage />,
};
