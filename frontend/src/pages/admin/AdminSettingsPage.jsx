import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAuditSummary } from '@/services/api/adminService';
import { fetchEmailConfig } from '@/services/api/mailboxService';
import { fetchHealth } from '@/services/api/healthService';
import { useRoutePaths } from '@/hooks/useRoutePaths';

/**
 * System settings — Super Admin only, by virtue of SECTION.ADMIN_SETTINGS
 * being absent from ADMIN_CONSOLE while SUPER_ADMIN receives every section.
 *
 * Read-only on purpose. Everything shown is reported by the server about its
 * own configuration; nothing here is editable yet, and inventing a control
 * that writes nowhere would be worse than showing the truth.
 */

function Row({ label, value, tone = 'neutral', hint }) {
  const toneClass =
    tone === 'warn' ? 'text-amber-800' : tone === 'good' ? 'text-emerald-800' : 'text-slate-800';

  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-bold text-slate-700">{label}</p>
        {hint && <p className="m-0 mt-0.5 text-[11.5px] text-slate-400">{hint}</p>}
      </div>
      <p className={`m-0 shrink-0 text-right text-[13px] font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

function Panel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-heading text-[16px] font-black text-slate-900">
        <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AdminSettingsPage() {
  const paths = useRoutePaths();

  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });
  const config = useQuery({ queryKey: ['emailConfig'], queryFn: fetchEmailConfig, retry: false });
  const summary = useQuery({ queryKey: ['audit', 'summary'], queryFn: () => fetchAuditSummary(), retry: false });

  const audit = summary.data?.overall;
  const loading = health.isLoading || config.isLoading || summary.isLoading;

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Administration', path: paths.ADMINISTRATION },
          { label: 'System Settings' },
        ]}
      />
      <PageHeader
        title="System Settings"
        purpose="Configuration reported by the server. Read-only."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11.5px] font-black text-violet-700">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Super Admin
          </span>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Service" icon={CheckCircle2}>
            <Row label="API status" value={health.data?.status || 'unreachable'} tone={health.data ? 'good' : 'warn'} />
            <Row label="Service" value={health.data?.service || '—'} />
          </Panel>

          <Panel title="Audit trail" icon={ShieldCheck}>
            <Row
              label="Storage"
              value={audit?.backend || 'unknown'}
              tone={audit?.durable ? 'good' : 'warn'}
              hint={audit?.durable ? 'Persisted to MongoDB' : 'In-memory — records are lost on restart'}
            />
            <Row label="Events recorded" value={audit?.total ?? 0} />
            <Row label="Failures" value={audit?.byResult?.failure ?? 0} tone={audit?.byResult?.failure ? 'warn' : 'neutral'} />
            <Row label="Denied requests" value={audit?.byResult?.denied ?? 0} tone={audit?.byResult?.denied ? 'warn' : 'neutral'} />
          </Panel>

          <Panel title="Email" icon={CheckCircle2}>
            <Row
              label="Transport"
              value={config.data?.transport || '—'}
              tone={config.data?.transport === 'gmail' ? 'warn' : 'neutral'}
              hint={config.data?.transport === 'gmail' ? 'Real mail leaves this machine' : 'Nothing leaves this machine'}
            />
            <Row label="Query recipient" value={config.data?.ipcQueryEmail || '—'} />
            {(config.data?.participants || []).map((participant) => (
              <Row
                key={participant.role}
                label={participant.name}
                value={participant.canSendReal ? 'can send' : 'mock only'}
                tone={participant.canSendReal ? 'good' : 'neutral'}
                hint={participant.email}
              />
            ))}
          </Panel>

          <Panel title="Known limitations" icon={AlertTriangle}>
            <Row
              label="Case authorization"
              value="role-level only"
              tone="warn"
              hint="Any signed-in user can read any attachment by id — Query Case ownership is not yet server-side"
            />
            <Row
              label="Query case storage"
              value="browser"
              tone="warn"
              hint="Cases live in each browser's IndexedDB, so case counts are per-device"
            />
            <Row
              label="Session revocation"
              value="not supported"
              tone="warn"
              hint="Logout clears the cookie; a copied token remains valid until it expires"
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
