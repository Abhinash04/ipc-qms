import { useState } from 'react';
import { BadgeCheck, UserCheck, UserPlus, Users } from 'lucide-react';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseCard } from '@/components/common/CaseCard';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { ROLE_LABELS } from '@/constants/roles';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { useWorkflowAction } from '@/hooks/useWorkflowAction';
import { ActionError } from '@/components/workflow/ActionError';
import { AiRecommendationCard } from '@/components/ai/AiRecommendationCard';
import { useAssignableOfficials } from '@/hooks/useAssignableOfficials';

export function AssignmentDetailPage() {
  const paths = useRoutePaths();
  const { queryId, query, currentUser, assignee, can, resolving } = useQueryCase();
  const { run, error, clearError } = useWorkflowAction();
  const assignQuery = useWorkflowStore((state) => state.assignQuery);
  const [override, setOverride] = useState('');
  const eligibleAssignees = useAssignableOfficials();

  if (!query) return <EmptyState title={resolving ? 'Loading case…' : 'Query not found'} />;

  const canAssign = can(WORKFLOW_ACTION.ASSIGN);

  const handleAssignToOfficial = (officialId, ranking) => {
    run(() => assignQuery(queryId, officialId, currentUser, ranking));
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
        <CaseCard
          banner
          art={[UserCheck, BadgeCheck]}
          icon={BadgeCheck}
          title="Official Assigned"
          meta={
            query.assignmentDecision?.acceptedAiRecommendation
              ? 'AI Recommendation accepted by OIC'
              : 'Selected & assigned by Officer-in-Charge'
          }
        >
          <p className="m-0 text-base font-bold text-foreground">
            {assignee.name} ({assignee.email})
          </p>
        </CaseCard>
      )}

      <AiRecommendationCard
        query={query}
        currentAssigneeId={query.currentAssigneeId}
        onAssign={canAssign ? handleAssignToOfficial : null}
      />

      {canAssign && (
        <CaseCard
          tone="action"
          banner
          art={[Users, UserPlus, UserCheck]}
          icon={UserPlus}
          title="Or Manual Assignment"
          bodyClassName="space-y-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-60">
              <Label htmlFor="override-assignee" className="text-xs text-muted-foreground mb-1 block">
                Choose from full directory
              </Label>
              <Select value={override} onValueChange={setOverride}>
                <SelectTrigger id="override-assignee">
                  <SelectValue placeholder="Select an official" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleAssignees.map((user) => (
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
        </CaseCard>
      )}
    </div>
  );
}
