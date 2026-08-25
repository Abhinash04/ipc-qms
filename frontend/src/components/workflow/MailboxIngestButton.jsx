import { useMailboxIngestion } from '@/hooks/useMailboxIngestion';
import { RefreshCw } from 'lucide-react';

export function MailboxIngestButton() {
  const { running, error, lastResult, ingestNow } = useMailboxIngestion();

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs font-semibold text-rose-600">Mailbox unreachable</span>}
      {!error && lastResult && (
        <span className="text-xs font-medium text-slate-500">
          {lastResult.created.length > 0
            ? `${lastResult.created.length} new case${lastResult.created.length > 1 ? 's' : ''} registered`
            : 'No new mail'}
          {lastResult.skipped.length > 0 && ` · ${lastResult.skipped.length} already registered`}
          {lastResult.acknowledged.length > 0 &&
            ` · ${lastResult.acknowledged.length} acknowledged`}
          {lastResult.forwarded.length > 0 && ` · ${lastResult.forwarded.length} forwarded`}
        </span>
      )}
      <button
        type="button"
        onClick={ingestNow}
        disabled={running}
        className="flex items-center gap-2 rounded-2xl border border-purple-200/80 bg-purple-50/80 px-4 py-2.5 text-[13px] font-bold text-slate-800 hover:bg-purple-100 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 text-slate-700 ${running ? 'animate-spin' : ''}`} />
        {running ? 'Checking…' : 'Check IPC mailbox'}
      </button>
    </div>
  );
}

