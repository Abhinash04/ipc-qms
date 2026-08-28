import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ROLES } from "@/constants/roles";

import { FrontOfficeDashboard } from "./roles/FrontOfficeDashboard";
import { OICDashboard } from "./roles/OICDashboard";
import { AssignedOfficialDashboard } from "./roles/AssignedOfficialDashboard";
import { ReviewerDashboard } from "./roles/ReviewerDashboard";
import { InquirerDashboard } from "./roles/InquirerDashboard";

const DASHBOARD_FOR_ROLE = {
  [ROLES.FRONT_OFFICE]: FrontOfficeDashboard,
  [ROLES.OFFICER_IN_CHARGE]: OICDashboard,
  [ROLES.ASSIGNED_OFFICIAL]: AssignedOfficialDashboard,
  [ROLES.REVIEWER]: ReviewerDashboard,
  [ROLES.INQUIRER]: InquirerDashboard,
};

export function DashboardPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const auditEvents = useWorkflowStore((state) => state.auditEvents);
  const reviews = useWorkflowStore((state) => state.reviews);

  if (!currentUser) return null;

  // Admin and Super Admin fall through to the systemwide view.
  const Dashboard = DASHBOARD_FOR_ROLE[currentUser.role] || OICDashboard;

  return (
    <Dashboard
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      auditEvents={auditEvents}
      reviews={reviews}
    />
  );
}
