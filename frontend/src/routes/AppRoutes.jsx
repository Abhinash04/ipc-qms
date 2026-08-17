import { Routes, Route, Navigate } from 'react-router-dom';

import { MainLayout } from '@/layouts/MainLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ROUTE_PATHS } from '@/constants/routePaths';

import { LoginPage } from '@/pages/auth/LoginPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={ROUTE_PATHS.DASHBOARD} replace />} />

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
        <Route path={ROUTE_PATHS.DASHBOARD} element={<DashboardPage />} />

        <Route path={ROUTE_PATHS.QUERIES} element={<QueriesListPage />} />
        <Route path={ROUTE_PATHS.QUERY_DETAIL} element={<QueryDetailPage />} />

        <Route path={ROUTE_PATHS.MY_WORK} element={<MyWorkPage />} />

        <Route path={ROUTE_PATHS.ASSIGNMENTS} element={<AssignmentsListPage />} />
        <Route path={ROUTE_PATHS.ASSIGNMENT_DETAIL} element={<AssignmentDetailPage />} />

        <Route path={ROUTE_PATHS.DRAFTING} element={<DraftingListPage />} />
        <Route path={ROUTE_PATHS.DRAFTING_DETAIL} element={<DraftingDetailPage />} />

        <Route path={ROUTE_PATHS.REVIEWS} element={<ReviewsListPage />} />
        <Route path={ROUTE_PATHS.REVIEW_DETAIL} element={<ReviewDetailPage />} />

        <Route path={ROUTE_PATHS.APPROVALS} element={<ApprovalsListPage />} />
        <Route path={ROUTE_PATHS.APPROVAL_DETAIL} element={<ApprovalDetailPage />} />

        <Route path={ROUTE_PATHS.DISPATCH} element={<DispatchListPage />} />
        <Route path={ROUTE_PATHS.DISPATCH_DETAIL} element={<DispatchDetailPage />} />

        <Route path={ROUTE_PATHS.NOTIFICATIONS} element={<NotificationsPage />} />
        <Route path={ROUTE_PATHS.REPORTS} element={<ReportsPage />} />

        <Route path={ROUTE_PATHS.ADMIN} element={<AdminOverviewPage />} />
        <Route path={ROUTE_PATHS.ADMIN_USERS} element={<AdminUsersPage />} />
        <Route path={ROUTE_PATHS.ADMIN_ROLES} element={<AdminRolesPage />} />
        <Route path={ROUTE_PATHS.ADMIN_DIVISIONS} element={<AdminDivisionsPage />} />
        <Route path={ROUTE_PATHS.ADMIN_WORKFLOWS} element={<AdminWorkflowsPage />} />
        <Route path={ROUTE_PATHS.ADMIN_CATEGORIES} element={<AdminCategoriesPage />} />
      </Route>
    </Routes>
  );
}
