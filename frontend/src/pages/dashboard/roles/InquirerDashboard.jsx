import { useNavigate } from "react-router-dom";
import { Plus as PlusIcon } from "lucide-react";

import { BucketDashboard } from "@/components/dashboard/BucketDashboard";
import { RoleGate } from "@/components/common/RoleGate";
import { ROLES } from "@/constants/roles";
import { useRoutePaths } from "@/hooks/useRoutePaths";

export function InquirerDashboard({
  currentUser,
  queries,
  workflowSteps,
  reviews,
}) {
  const navigate = useNavigate();
  const paths = useRoutePaths();

  return (
    <BucketDashboard
      role={ROLES.INQUIRER}
      currentUser={currentUser}
      queries={queries}
      workflowSteps={workflowSteps}
      reviews={reviews}
      title="My Queries"
      purpose={
        <>
          Client Portal ·{" "}
          <span className="font-medium text-slate-500">{currentUser?.name}</span>
        </>
      }
      emptyTextFor={(bucket) =>
        bucket?.key === "total"
          ? "You haven't raised any queries yet."
          : `You have no ${bucket?.label?.toLowerCase() || "queries"} right now.`
      }
      actions={
        <RoleGate allow={[ROLES.INQUIRER]}>
          <button
            type="button"
            onClick={() => navigate(paths.COMPOSE)}
            className="flex items-center gap-2 text-[13px] font-semibold text-white bg-blue-600 border-none rounded-xl px-4 py-2.5 cursor-pointer shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
            New Query
          </button>
        </RoleGate>
      }
    />
  );
}
