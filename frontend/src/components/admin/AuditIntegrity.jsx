import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileText, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';

import { downloadAuditReport, verifyAuditChain } from '@/services/api/adminService';
import { notify } from '@/services/notify';
import { cn } from '@/utils/cn';

const nf = new Intl.NumberFormat();

/**
 * Result of re-computing the audit hash chain on the server: green when every
 * chained event is intact, red with the first broken position otherwise.
 */
export function ChainIntegrityBadge() {
  const check = useQuery({
    queryKey: ['audit', 'verify'],
    queryFn: async () => (await verifyAuditChain()) ?? null,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const report = check.data;
  let tone = 'bg-slate-100 text-slate-600';
  let Icon = ShieldQuestion;
  let label = 'Checking audit chain…';
  let title = 'Re-computing every chained event on the server';

  if (check.isError) {
    label = 'Chain check unavailable';
    title = 'The audit API could not be reached';
  } else if (report) {
    const extras = [
      report.legacy ? `${nf.format(report.legacy)} legacy event(s) recorded before chaining` : null,
      report.unpersisted ? `${nf.format(report.unpersisted)} event(s) not yet persisted` : null,
    ].filter(Boolean);

    if (report.ok) {
      tone = 'bg-emerald-50 text-emerald-700';
      Icon = ShieldCheck;
      label = `Chain verified · ${nf.format(report.checked)} events`;
      title = ['Every chained event is intact and in order.', ...extras].join(' ');
    } else {
      tone = 'bg-rose-50 text-rose-700';
      Icon = ShieldAlert;
      label = `Break detected at #${report.firstBreak?.seq}`;
      title = [report.firstBreak?.detail, `${report.breaks?.length ?? 1} problem(s) found.`, ...extras]
        .filter(Boolean)
        .join(' ');
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        role="status"
        title={title}
        className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold', tone)}
      >
        {check.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        {label}
      </span>
      <button
        type="button"
        onClick={() => check.refetch()}
        disabled={check.isFetching}
        aria-label="Re-check the audit chain"
        title="Re-check the audit chain"
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-primary disabled:opacity-50"
      >
        <RefreshCw className={cn('h-4 w-4', check.isFetching && 'animate-spin')} />
      </button>
    </span>
  );
}

const exportLabel = { csv: 'Export CSV', pdf: 'Export PDF' };

/** Downloads the audit trail for the current filters, as CSV or PDF. */
export function AuditExportButtons({ filters }) {
  const [busy, setBusy] = useState(null);

  const run = async (format) => {
    setBusy(format);
    try {
      const report = await downloadAuditReport(format, filters);
      notify.success(
        `Exported ${nf.format(report.rows)} audit event${report.rows === 1 ? '' : 's'}`,
        [
          report.digest ? `Content SHA-256 ${report.digest.slice(0, 16)}…` : null,
          report.truncated ? 'Truncated — narrow the filters for a complete report.' : null,
          report.chainVerified ? null : 'Chain verification did not pass; see the report cover.',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch {
      notify.error('Export failed', 'The audit report could not be generated.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      {['csv', 'pdf'].map((format) => {
        const Icon = format === 'csv' ? FileDown : FileText;
        return (
          <button
            key={format}
            type="button"
            onClick={() => run(format)}
            disabled={Boolean(busy)}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[12.5px] font-semibold text-ink-soft transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === format ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
            {exportLabel[format]}
          </button>
        );
      })}
    </span>
  );
}
