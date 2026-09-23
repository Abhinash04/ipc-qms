/* eslint-disable react-refresh/only-export-components -- test-only module, never served by the dev server */
import { SECTION } from '@/constants/routeSections';

export { MainLayout } from '@/layouts/MainLayout';
export { LoginPage } from '@/pages/auth/LoginPage';

import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { MailboxInboxPage } from '@/pages/frontOffice/MailboxInboxPage';
import { MailboxMessagePage } from '@/pages/frontOffice/MailboxMessagePage';
import { QueriesListPage } from '@/pages/queries/QueriesListPage';
import { QueryDetailPage } from '@/pages/queries/QueryDetailPage';
import { MyWorkPage } from '@/pages/myWork/MyWorkPage';
import { AssignmentsListPage } from '@/pages/assignments/AssignmentsListPage';
import { AssignmentDetailPage } from '@/pages/assignments/AssignmentDetailPage';
import { DraftingListPage } from '@/pages/drafting/DraftingListPage';
import { DraftingDetailPage } from '@/pages/drafting/DraftingDetailPage';
import { ReviewsListPage } from '@/pages/reviews/ReviewsListPage';
import { ReviewDetailPage } from '@/pages/reviews/ReviewDetailPage';
import { ApprovalsListPage } from '@/pages/approvals/ApprovalsListPage';
import { ApprovalDetailPage } from '@/pages/approvals/ApprovalDetailPage';
import { DispatchListPage } from '@/pages/dispatch/DispatchListPage';
import { DispatchDetailPage } from '@/pages/dispatch/DispatchDetailPage';
import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { ReportsPage } from '@/pages/reports/ReportsPage';
import { AdminOverviewPage } from '@/pages/admin/AdminOverviewPage';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { AdminRolesPage } from '@/pages/admin/AdminRolesPage';
import { AdminDivisionsPage } from '@/pages/admin/AdminDivisionsPage';
import { AdminWorkflowsPage } from '@/pages/admin/AdminWorkflowsPage';
import { AdminCategoriesPage } from '@/pages/admin/AdminCategoriesPage';
import { AdminActivityPage } from '@/pages/admin/AdminActivityPage';
import { AdminEmailActivityPage } from '@/pages/admin/AdminEmailActivityPage';
import { AdminAiActivityPage } from '@/pages/admin/AdminAiActivityPage';
import { AdminSettingsPage } from '@/pages/admin/AdminSettingsPage';

export const SECTION_ELEMENT = {
  [SECTION.DASHBOARD]: <DashboardPage />,
  [SECTION.INBOX]: <MailboxInboxPage />,
  [SECTION.INBOX_DETAIL]: <MailboxMessagePage />,
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
