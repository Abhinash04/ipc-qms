import { WORKFLOW_STATE } from "@/constants/statusEnums";

const LIFECYCLE = [
  WORKFLOW_STATE.RECEIVED,
  WORKFLOW_STATE.FRONT_OFFICE_VERIFICATION,
  WORKFLOW_STATE.PENDING_ASSIGNMENT,
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.UNDER_REVIEW,
  WORKFLOW_STATE.PENDING_FINAL_APPROVAL,
  WORKFLOW_STATE.APPROVED,
  WORKFLOW_STATE.READY_FOR_DISPATCH,
  WORKFLOW_STATE.DISPATCHED,
  WORKFLOW_STATE.CLOSED,
];

const OFF_PATH = {
  [WORKFLOW_STATE.RETURNED_FOR_REVISION]: WORKFLOW_STATE.DRAFTING,
  [WORKFLOW_STATE.TRANSFERRED]: WORKFLOW_STATE.ASSIGNED,
  [WORKFLOW_STATE.PULLED_BACK]: WORKFLOW_STATE.PENDING_ASSIGNMENT,
  [WORKFLOW_STATE.ON_HOLD]: null,
  [WORKFLOW_STATE.CANCELLED]: null,
};

function readable(state) {
  return String(state || "Unknown")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function lifecycleProgress(state) {
  const steps = LIFECYCLE.length;
  const anchor = state in OFF_PATH ? OFF_PATH[state] : state;
  const index = LIFECYCLE.indexOf(anchor);

  if (index < 0) {
    return { step: 0, steps, fraction: 0, label: readable(state), tone: "bg-slate-400" };
  }

  const step = index + 1;
  const fraction = step / steps;
  let tone = "bg-primary";
  if (state === WORKFLOW_STATE.RETURNED_FOR_REVISION) tone = "bg-rose-500";
  else if (fraction === 1) tone = "bg-emerald-500";
  else if (fraction < 0.35) tone = "bg-amber-500";

  return { step, steps, fraction, label: readable(state), tone };
}

/**
 * How many of `queries` sit at each workflow state, in lifecycle order
 * (off-path states follow the stage they return to). Empty stages are left
 * out.
 */
export function stageBreakdown(queries = []) {
  const counts = new Map();
  for (const query of queries) {
    const state = query.workflowState || "UNKNOWN";
    counts.set(state, (counts.get(state) || 0) + 1);
  }

  const rank = (state) => {
    const anchor = state in OFF_PATH ? OFF_PATH[state] : state;
    const index = LIFECYCLE.indexOf(anchor);
    return index < 0 ? LIFECYCLE.length + 1 : index + (anchor === state ? 0 : 0.5);
  };

  return [...counts.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([state, value]) => ({ label: readable(state), value }));
}
