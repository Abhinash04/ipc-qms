import MailIcon from 'lucide-react/dist/esm/icons/mail.mjs';
import PaperclipIcon from 'lucide-react/dist/esm/icons/paperclip.mjs';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { CaseSummaryBar } from '@/components/workflow/CaseSummaryBar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MOCK_QUERY } from '@/constants/mockQuery';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function DispatchDetailPage() {
  const query = MOCK_QUERY;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD },
          { label: 'Dispatch', path: ROUTE_PATHS.DISPATCH },
          { label: query.queryId },
        ]}
      />

      <CaseSummaryBar query={query} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Final response preview</h2>
            </CardHeader>
            <CardBody>
              <pre className="rounded-md border border-border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap text-foreground">
                {query.currentDraft}
              </pre>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">Attachments</h2>
            </CardHeader>
            <CardBody>
              {query.attachments.length === 0 ? (
                <EmptyState icon={PaperclipIcon} title="No attachments" />
              ) : (
                <ul className="space-y-2">
                  {query.attachments.map((att) => (
                    <li key={att.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                      <PaperclipIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="flex-1 text-foreground">{att.name}</span>
                      <span className="text-xs text-muted-foreground">{att.sizeKb} KB</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="flex items-center gap-2">
              <MailIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Recipient</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Inquirer</p>
                <p className="font-medium text-foreground">{query.inquirer.name}</p>
                <p className="text-sm text-muted-foreground">{query.inquirer.email}</p>
              </div>
              <Button className="w-full" disabled>
                Send response
              </Button>
              <p className="text-xs text-muted-foreground">
                Dispatch isn't wired up yet — sending will close the query once implemented.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
