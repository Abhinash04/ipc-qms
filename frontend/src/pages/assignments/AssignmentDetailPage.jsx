import { useState } from 'react';
import SparklesIcon from 'lucide-react/dist/esm/icons/sparkles.mjs';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useQueryCase } from '@/hooks/useQueryCase';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { WORKFLOW_ACTION } from '@/constants/workflowRules';
import { AI_ASSIGNMENT_RECOMMENDATION } from '@/constants/mockDomain';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { ROUTE_PATHS } from '@/constants/routePaths';

const ELIGIBLE_ASSIGNEES = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);

export function AssignmentDetailPage() {
  const { queryId, query, currentUser, assignee, can } = useQueryCase();
  const assignQuery = useWorkflowStore((state) => state.assignQuery);
  const [override, setOverride] = useState('');

  if (!query) return <EmptyState title="Query not found" />;

  const recommended = findUserById(AI_ASSIGNMENT_RECOMMENDATION.recommendedUserId);
  const canAssign = can(WORKFLOW_ACTION.ASSIGN);

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD },
          { label: 'Assignments', path: ROUTE_PATHS.ASSIGNMENTS },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <Card>
        <CardHeader className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 text-status-indigo-fg" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">AI assignment recommendation</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Recommended official</p>
              <p className="text-base font-semibold text-foreground">{recommended?.name}</p>
            </div>
            <Badge variant="status-indigo" className="text-sm">
              {AI_ASSIGNMENT_RECOMMENDATION.matchPercent}% match
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            {AI_ASSIGNMENT_RECOMMENDATION.reason} Considered:{' '}
            {AI_ASSIGNMENT_RECOMMENDATION.factors.join(', ').toLowerCase()}.
          </p>

          {assignee && (
            <p className="rounded-md border border-status-green-line bg-status-green-bg px-3 py-2 text-sm text-status-green-fg">
              Assigned to {assignee.name}
              {query.assignmentDecision &&
                (query.assignmentDecision.acceptedAiRecommendation
                  ? ' — AI recommendation accepted.'
                  : ' — AI recommendation overridden by the OIC.')}
            </p>
          )}

          {canAssign ? (
            <div className="space-y-3 pt-1">
              <Button onClick={() => assignQuery(queryId, recommended.id, currentUser)}>
                Accept recommendation — assign {recommended?.name}
              </Button>

              <div className="space-y-1.5 border-t border-border pt-3">
                <Label htmlFor="override-assignee">Or override and choose another official</Label>
                <div className="flex gap-2">
                  <Select id="override-assignee" value={override} onValueChange={setOverride}>
                    <SelectTrigger className="w-64">
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
                  <Button
                    variant="secondary"
                    disabled={!override}
                    onClick={() => assignQuery(queryId, override, currentUser)}
                  >
                    Assign
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  AI recommends; the Officer-in-Charge always decides. An override is recorded as an
                  ASSIGNMENT_OVERRIDDEN audit event.
                </p>
              </div>
            </div>
          ) : (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {assignee
                ? 'This query has already been assigned.'
                : 'Assignment is available to the Officer-in-Charge once the query reaches PENDING_ASSIGNMENT.'}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
