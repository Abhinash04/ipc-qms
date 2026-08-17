import SparklesIcon from 'lucide-react/dist/esm/icons/sparkles.mjs';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MOCK_QUERY } from '@/constants/mockQuery';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function AssignmentDetailPage() {
  const query = MOCK_QUERY;

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
              <p className="text-base font-semibold text-foreground">{query.currentAssignee?.name}</p>
            </div>
            <Badge variant="status-indigo" className="text-sm">
              92% match
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Strong historical and subject-matter relevance — based on query category, subject, prior
            assignments, current workload, and division (see docs/srs/07-ai-requirements.md).
          </p>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row">
            <Button className="sm:w-auto" disabled>
              Accept recommendation
            </Button>
            <Button variant="secondary" className="sm:w-auto" disabled>
              Choose different official
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Assignment isn't implemented yet — the OIC always makes the final decision; AI only recommends.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
