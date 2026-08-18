import { Button } from '@/components/ui/button';
import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import { RefreshCwIcon } from 'lucide-react';

export function MailboxIngestButton() {
  const { running, error, lastResult, ingestNow } = useMailboxIngestion();

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-status-red-fg">Mailbox unreachable</span>}
      {!error && lastResult && (
        <span className="text-sm text-muted-foreground">
          {lastResult.created.length > 0
            ? `${lastResult.created.length} new case${lastResult.created.length > 1 ? 's' : ''} registered`
            : 'No new mail'}
          {lastResult.skipped.length > 0 && ` · ${lastResult.skipped.length} already registered`}
          {lastResult.acknowledged?.length > 0 &&
            ` · ${lastResult.acknowledged.length} acknowledged`}
        </span>
      )}
      <Button variant="outline" onClick={ingestNow} disabled={running}>
        <RefreshCwIcon aria-hidden="true" />
        {running ? 'Checking…' : 'Check IPC mailbox'}
      </Button>
    </div>
  );
}
