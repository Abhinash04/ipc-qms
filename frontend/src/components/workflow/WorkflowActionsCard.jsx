import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, ShieldAlert, ArrowRight, Zap } from 'lucide-react';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION, CLARIFICATION_REQUIRED_ACTIONS } from '@/constants/workflowRules';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { buildPath } from '@/constants/routePaths';
import { SECTION } from '@/constants/routeSections';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';

const ACTION_SECTIONS = {
  [WORKFLOW_ACTION.ASSIGN]: SECTION.ASSIGNMENT_DETAIL,
  [WORKFLOW_ACTION.GENERATE_AI_DRAFT]: SECTION.DRAFTING_DETAIL,
  [WORKFLOW_ACTION.SAVE_DRAFT]: SECTION.DRAFTING_DETAIL,
  [WORKFLOW_ACTION.SUBMIT_FOR_REVIEW]: SECTION.DRAFTING_DETAIL,
  [WORKFLOW_ACTION.APPROVE_REVIEW]: SECTION.REVIEW_DETAIL,
  [WORKFLOW_ACTION.REQUEST_REVISION]: SECTION.REVIEW_DETAIL,
  [WORKFLOW_ACTION.FINAL_APPROVE]: SECTION.APPROVAL_DETAIL,
  [WORKFLOW_ACTION.DISPATCH]: SECTION.DISPATCH_DETAIL,
};

const ACTION_LABELS = {
  [WORKFLOW_ACTION.ASSIGN]: 'Assign query',
  [WORKFLOW_ACTION.GENERATE_AI_DRAFT]: 'Start drafting',
  [WORKFLOW_ACTION.SUBMIT_FOR_REVIEW]: 'Continue drafting',
  [WORKFLOW_ACTION.APPROVE_REVIEW]: 'Review draft',
  [WORKFLOW_ACTION.FINAL_APPROVE]: 'Final approval',
  [WORKFLOW_ACTION.DISPATCH]: 'Dispatch response',
};

export function WorkflowActionsCard() {
  const { queryId, query, currentUser, can } = useQueryCase();
  const paths = useRoutePaths();
  const { run, error, clearError } = useWorkflowAction();
  const verifyQuery = useWorkflowStore((state) => state.verifyQuery);
  const forwardToOic = useWorkflowStore((state) => state.forwardToOic);
  const [showClarification, setShowClarification] = useState(null);

  if (!query) return null;

  const availableLinks = Object.entries(ACTION_SECTIONS)
    .filter(([action, section]) => can(action) && ACTION_LABELS[action] && paths[section])
    .map(([action, section]) => ({
      action,
      path: paths[section],
      label: ACTION_LABELS[action],
    }));

  const seen = new Set();
  const links = availableLinks.filter((l) => {
    if (seen.has(l.path)) return false;
    seen.add(l.path);
    return true;
  });

  const isClosed = query.workflowState === WORKFLOW_STATE.CLOSED;

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm select-none space-y-5">
      <div>
        <h2 className="font-heading text-[18px] font-black text-slate-900 m-0">
          Available actions
        </h2>
        <p className="text-[12.5px] font-medium text-slate-400 m-0 mt-1">
          For <span className="font-bold text-slate-700">{currentUser?.name}</span> — actions change with the query&apos;s stage.
        </p>
      </div>

      <div className="space-y-3">
        <ActionError message={error} onDismiss={clearError} />

        {isClosed && (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[13px] font-medium text-slate-500 leading-relaxed m-0">
            This query is closed. Its full audit history remains available below.
          </p>
        )}

        {can(WORKFLOW_ACTION.VERIFY) && (
          <button
            type="button"
            onClick={() => run(() => verifyQuery(queryId, currentUser))}
            className="w-full py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[14px] shadow-md shadow-blue-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <Zap className="h-4 w-4" />
            <span>Verify query details</span>
          </button>
        )}

        {can(WORKFLOW_ACTION.FORWARD) && (
          <button
            type="button"
            onClick={() => run(() => forwardToOic(queryId, currentUser))}
            className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[14px] shadow-md shadow-indigo-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <ArrowRight className="h-4 w-4" />
            <span>Forward to Officer-in-Charge</span>
          </button>
        )}

        {links.map((link) => (
          <Link key={link.path} to={buildPath(link.path, { queryId })} className="block">
            <button
              type="button"
              className="w-full py-3.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-[14px] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>{link.label}</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
            </button>
          </Link>
        ))}

        {!isClosed &&
          !can(WORKFLOW_ACTION.VERIFY) &&
          !can(WORKFLOW_ACTION.FORWARD) &&
          links.length === 0 && (
            <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 text-[13px] font-medium text-slate-500 leading-relaxed">
              No actions available to you at this stage. Switch user in the header to act as the role this query is waiting on.
            </div>
          )}

        {/* Transfer / Pullback Section */}
        <div className="space-y-2 pt-3 border-t border-slate-100">
          {[WORKFLOW_ACTION.TRANSFER, WORKFLOW_ACTION.PULLBACK].map((action) => (
            <div key={action}>
              <button
                type="button"
                onClick={() => setShowClarification(showClarification === action ? null : action)}
                className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-[13.5px] border border-slate-200/60 transition-all cursor-pointer"
              >
                <Lock className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{CLARIFICATION_REQUIRED_ACTIONS[action].label}</span>
              </button>
              {showClarification === action && (
                <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50/90 p-3.5 text-[12px] font-medium text-amber-900 space-y-1.5">
                  <p className="font-bold text-[12.5px] text-amber-950">Client clarification required before this can be enabled:</p>
                  <ul className="list-disc space-y-1 pl-4 text-amber-900/90">
                    {CLARIFICATION_REQUIRED_ACTIONS[action].openQuestions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
