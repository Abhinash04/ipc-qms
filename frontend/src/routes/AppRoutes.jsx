import { Routes, Route, Navigate } from 'react-router-dom';

import { MainLayout } from '@/layouts/MainLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { SECTION } from '@/constants/routeSections';
import { ROUTE_PATHS, roleHome } from '@/constants/routePaths';
import { ROLE_ROUTES } from '@/routes/roleRoutes';
import { useAuthStore } from '@/store/useAuthStore';

import { LoginPage } from '@/pages/auth/LoginPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { ComposeEnquiryPage } from '@/pages/inquirer/ComposeEnquiryPage';
import { MailboxInboxPage } from '@/pages/frontOffice/MailboxInboxPage';
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

const SECTION_ELEMENT = {
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
};

export function AppRoutes() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const home = currentUser ? roleHome(currentUser.role) : ROUTE_PATHS.LOGIN;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />

      <Route element={<AuthLayout />}>
        <Route path={ROUTE_PATHS.LOGIN} element={<LoginPage />} />
      </Route>

      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        {ROLE_ROUTES.map(({ path, section }) => (
          <Route key={path} path={path} element={SECTION_ELEMENT[section]} />
        ))}
      </Route>
    </Routes>
  );
}
