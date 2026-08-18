import { QueryTable } from '@/components/workflow/QueryTable';
import { MailboxIngestButton } from '@/components/workflow/MailboxIngestButton';
import { useRoutePaths } from '@/hooks/useRoutePaths';

export function QueriesListPage() {
  const paths = useRoutePaths();
  return (
    <QueryTable
      title="Queries"
      purpose="All registered queries across the organization."
      breadcrumbItems={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Queries' }]}
      detailPath={paths.QUERY_DETAIL}
      actions={<MailboxIngestButton />}
      emptyMessage="No queries yet. A case is created when an email is ingested from the IPC mailbox."
    />
  );
}
