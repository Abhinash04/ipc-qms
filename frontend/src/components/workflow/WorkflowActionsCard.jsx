import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LockIcon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">Available actions</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          For {currentUser?.name} — actions change with the query's stage.
        </p>
      </CardHeader>
      <CardBody className="space-y-2">
        <ActionError message={error} onDismiss={clearError} />

        {isClosed && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This query is closed. Its full audit history remains available below.
          </p>
        )}

        {can(WORKFLOW_ACTION.VERIFY) && (
          <Button className="w-full" onClick={() => run(() => verifyQuery(queryId, currentUser))}>
            Verify query details
          </Button>
        )}

        {can(WORKFLOW_ACTION.FORWARD) && (
          <Button className="w-full" onClick={() => run(() => forwardToOic(queryId, currentUser))}>
            Forward to Officer-in-Charge
          </Button>
        )}

        {links.map((link) => (
          <Link key={link.path} to={buildPath(link.path, { queryId })} className="block">
            <Button variant="secondary" className="w-full">
              {link.label}
            </Button>
          </Link>
        ))}

        {!isClosed &&
          !can(WORKFLOW_ACTION.VERIFY) &&
          !can(WORKFLOW_ACTION.FORWARD) &&
          links.length === 0 && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              No actions available to you at this stage. Switch user in the header to act as the
              role this query is waiting on.
            </p>
          )}

        <div className="space-y-2 border-t border-border pt-3">
          {[WORKFLOW_ACTION.TRANSFER, WORKFLOW_ACTION.PULLBACK].map((action) => (
            <div key={action}>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => setShowClarification(showClarification === action ? null : action)}
              >
                <LockIcon className="h-4 w-4" aria-hidden="true" />
                {CLARIFICATION_REQUIRED_ACTIONS[action].label}
              </Button>
              {showClarification === action && (
                <div className="mt-1 rounded-md border border-status-amber-line bg-status-amber-bg px-3 py-2 text-xs text-status-amber-fg">
                  <p className="font-medium">Client clarification required before this can be enabled:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {CLARIFICATION_REQUIRED_ACTIONS[action].openQuestions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                  <p className="mt-1">See docs/srs/14-open-questions-and-client-clarifications.md</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
