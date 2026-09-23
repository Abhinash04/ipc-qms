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

function toneClassFor(tone) {
  if (tone === 'warn') return 'text-amber-800';
  if (tone === 'good') return 'text-emerald-800';
  return 'text-slate-800';
}

function Row({ label, value, tone = 'neutral', hint }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-bold text-slate-700">{label}</p>
        {hint && <p className="m-0 mt-0.5 text-[11.5px] text-slate-400">{hint}</p>}
      </div>
      <p className={`m-0 shrink-0 text-right text-[13px] font-black ${toneClassFor(tone)}`}>
        {value}
      </p>
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

function ServicePanel({ health }) {
  return (
    <Panel title="Service" icon={CheckCircle2}>
      <Row
        label="API status"
        value={health?.status || 'unreachable'}
        tone={health ? 'good' : 'warn'}
      />
      <Row label="Service" value={health?.service || '—'} />
    </Panel>
  );
}

function AuditPanel({ audit }) {
  const failures = audit?.byResult?.failure ?? 0;
  const denied = audit?.byResult?.denied ?? 0;

  return (
    <Panel title="Audit trail" icon={ShieldCheck}>
      <Row
        label="Storage"
        value={audit?.backend || 'unknown'}
        tone={audit?.durable ? 'good' : 'warn'}
        hint={
          audit?.durable ? 'Persisted to MongoDB' : 'In-memory — records are lost on restart'
        }
      />
      <Row label="Events recorded" value={audit?.total ?? 0} />
      <Row label="Failures" value={failures} tone={failures ? 'warn' : 'neutral'} />
      <Row label="Denied requests" value={denied} tone={denied ? 'warn' : 'neutral'} />
    </Panel>
  );
}

/**
 * Two channels, reported separately, because they are independent.
 *
 * EMAIL_TRANSPORT carries mail for cases that did not arrive in the NICeMail
 * mailbox. A case that did is answered by the browser agent from that account
 * whatever the transport says — so a deployment can read `mock` here and still
 * be sending real mail from a .gov.in address.
 *
 * This panel used to decide "real or not" by comparing the transport to
 * 'gmail'. Once Gmail was removed that comparison could never be true, and the
 * page told an administrator "Nothing leaves this machine" while NICeMail was
 * sending live correspondence. The rule is now inverted: `mock` is the single
 * case that delivers nothing, and an unrecognised transport is assumed to send
 * rather than assumed to be safe.
 */
const TRANSPORT_HINT = {
  mock: 'Delivers nothing — messages are kept in the local mailbox',
  nic: 'Real mail leaves this machine — NICeMail SMTP',
};

function EmailPanel({ config }) {
  const transport = config?.transport || null;
  const transportSends = Boolean(transport) && transport !== 'mock';
  const agentOn = Boolean(config?.nicBrowserMailbox);

  return (
    <Panel title="Email" icon={CheckCircle2}>
      <Row
        label="Transport"
        value={transport || '—'}
        tone={transportSends ? 'warn' : 'neutral'}
        hint={
          transport
            ? TRANSPORT_HINT[transport] || 'Unrecognised transport — assume real mail leaves this machine'
            : 'Not reported by the server'
        }
      />
      <Row
        label="NICeMail browser agent"
        value={agentOn ? 'enabled' : 'disabled'}
        tone={agentOn ? 'warn' : 'neutral'}
        hint={
          agentOn
            ? 'Cases from the NICeMail mailbox are sent from that account, whatever the transport above says'
            : 'No case is sent through NICeMail'
        }
      />
      {agentOn && (
        <Row
          label="Outbound interlock"
          value={config?.outboundAllowed ? 'open' : 'closed'}
          tone={config?.outboundAllowed ? 'warn' : 'good'}
          hint={
            config?.outboundAllowed
              ? 'NIC_ALLOW_OUTBOUND=true — NICeMail sends may reach any recipient'
              : 'NICeMail sends are confined to the configured test recipient'
          }
        />
      )}
      <Row label="Query recipient" value={config?.ipcQueryEmail || '—'} />
      {(config?.participants || []).map((participant) => (
        <Row
          key={participant.role}
          label={participant.name}
          value={participant.role}
          hint={participant.email}
        />
      ))}
    </Panel>
  );
}

/**
 * Kept honest deliberately: an administrator reads this to know what the
 * system does NOT do. The first two entries described the server as it was
 * before case-level scoping existed, and understating what is enforced is the
 * same kind of error as overstating it.
 */
const KNOWN_LIMITATIONS = [
  {
    label: 'Case authorization',
    value: 'enforced on reads',
    hint: 'An attachment can only be read by someone party to its case; an upload can still name another case',
  },
  {
    label: 'Workflow enforcement',
    value: 'partly server-side',
    hint: 'Final approval and dispatch check the stored state; other transitions are checked for the role, not the state they came from',
  },
  {
    label: 'Session revocation',
    value: 'not supported',
    hint: 'Logout clears the cookie; a copied token remains valid until it expires',
  },
];

function LimitationsPanel() {
  return (
    <Panel title="Known limitations" icon={AlertTriangle}>
      {KNOWN_LIMITATIONS.map((limitation) => (
        <Row
          key={limitation.label}
          label={limitation.label}
          value={limitation.value}
          tone="warn"
          hint={limitation.hint}
        />
      ))}
    </Panel>
  );
}

function SettingsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-3xl" />
      ))}
    </div>
  );
}

export function AdminSettingsPage() {
  const paths = useRoutePaths();

  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });
  const config = useQuery({ queryKey: ['emailConfig'], queryFn: fetchEmailConfig, retry: false });
  const summary = useQuery({
    queryKey: ['audit', 'summary'],
    queryFn: () => fetchAuditSummary(),
    retry: false,
  });

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
        <SettingsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ServicePanel health={health.data} />
          <AuditPanel audit={summary.data?.overall} />
          <EmailPanel config={config.data} />
          <LimitationsPanel />
        </div>
      )}
    </div>
  );
}
