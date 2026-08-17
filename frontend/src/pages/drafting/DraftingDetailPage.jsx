import { Breadcrumb } from '@/components/common/Breadcrumb';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { MOCK_QUERY } from '@/constants/mockQuery';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function DraftingDetailPage() {
  const query = MOCK_QUERY;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD },
          { label: 'Drafting', path: ROUTE_PATHS.DRAFTING },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Response draft</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <Textarea value={query.currentDraft} readOnly rows={12} className="resize-none" />
              <div className="flex gap-2">
                <Button disabled>Save revision</Button>
                <Button variant="secondary" disabled>
                  Submit for review
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Editing isn't wired up yet — the AI-generated starting draft (v1) is shown read-only.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Version history</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {query.responseVersions.map((v) => (
                <div key={v.version} className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                  <div>
                    <p className="font-medium text-foreground">{v.version}</p>
                    <p className="text-xs text-muted-foreground">{v.label}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
