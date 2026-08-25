import { useState } from 'react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';

const ELIGIBLE_ASSIGNEES = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);

export function AssignmentDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, currentUser, assignee, can } = useQueryCase();
  const { run, error, clearError } = useWorkflowAction();
  const assignQuery = useWorkflowStore((state) => state.assignQuery);
  const [override, setOverride] = useState('');

  if (!query) return <EmptyState title="Query not found" />;

  const canAssign = can(WORKFLOW_ACTION.ASSIGN);

  const handleAssignToOfficial = (officialId) => {
    run(() => assignQuery(queryId, officialId, currentUser));
  };

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Assignments', path: paths.ASSIGNMENTS },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <ActionError message={error} onDismiss={clearError} />

      {assignee && (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20">
          <CardBody className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Official Assigned
              </p>
              <p className="text-base font-bold text-foreground mt-0.5">
                {assignee.name} ({assignee.email})
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {query.assignmentDecision?.acceptedAiRecommendation
                ? 'AI Recommendation accepted by OIC'
                : 'Selected & assigned by Officer-in-Charge'}
            </p>
          </CardBody>
        </Card>
      )}

      <AiRecommendationCard
        query={query}
        currentAssigneeId={query.currentAssigneeId}
        onAssign={canAssign ? handleAssignToOfficial : null}
      />

      {canAssign && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-foreground">Or Manual Assignment</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-60">
                <Label htmlFor="override-assignee" className="text-xs text-muted-foreground mb-1 block">
                  Choose from full directory
                </Label>
                <Select id="override-assignee" value={override} onValueChange={setOverride}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an official" />
                  </SelectTrigger>
                  <SelectContent>
                    {ELIGIBLE_ASSIGNEES.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name} — {ROLE_LABELS[user.role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                variant="secondary"
                disabled={!override}
                onClick={() => handleAssignToOfficial(override)}
                className="mt-5"
              >
                Assign Selected Official
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
