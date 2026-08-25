import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { ROLES } from "@/constants/roles";

import { FrontOfficeDashboard } from "./roles/FrontOfficeDashboard";
import { OICDashboard } from "./roles/OICDashboard";
import { AssignedOfficialDashboard } from "./roles/AssignedOfficialDashboard";
import { ReviewerDashboard } from "./roles/ReviewerDashboard";
import { InquirerDashboard } from "./roles/InquirerDashboard";

export function DashboardPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const auditEvents = useWorkflowStore((state) => state.auditEvents);

  if (!currentUser) return null;

  switch (currentUser.role) {
    case ROLES.FRONT_OFFICE:
      return (
        <FrontOfficeDashboard
          currentUser={currentUser}
          queries={queries}
          auditEvents={auditEvents}
        />
      );
    case ROLES.OFFICER_IN_CHARGE:
      return (
        <OICDashboard
          currentUser={currentUser}
          queries={queries}
          auditEvents={auditEvents}
        />
      );
    case ROLES.ASSIGNED_OFFICIAL:
      return (
        <AssignedOfficialDashboard
          currentUser={currentUser}
          queries={queries}
          workflowSteps={workflowSteps}
          auditEvents={auditEvents}
        />
      );
    case ROLES.REVIEWER:
      return (
        <ReviewerDashboard
          currentUser={currentUser}
          queries={queries}
          workflowSteps={workflowSteps}
          auditEvents={auditEvents}
        />
      );
    case ROLES.INQUIRER:
      return <InquirerDashboard currentUser={currentUser} queries={queries} />;
    default:
      return (
        <OICDashboard
          currentUser={currentUser}
          queries={queries}
          auditEvents={auditEvents}
        />
      );
  }
}
