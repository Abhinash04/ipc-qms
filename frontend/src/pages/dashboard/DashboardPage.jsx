import { Link, useNavigate } from 'react-router-dom';
import { InboxIcon, PenLineIcon, ClipboardCheckIcon, CheckCircle2Icon, PlusIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROLE_LABELS, ROLES } from '@/constants/roles';
import { RoleGate } from '@/components/common/RoleGate';
import { findUserById } from '@/constants/mockUsers';
import { findDivisionById } from '@/constants/mockDivisions';
import { WORKFLOW_STATE, AUDIT_EVENT, AUDIT_EVENT_LABELS } from '@/constants/statusEnums';
import { buildPath } from '@/constants/routePaths';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

/**
 * Trends come from the audit trail, which stamps every transition with `at`.
 * Nothing here is a placeholder: if a period has no activity the tile shows no
 * trend line rather than an invented one.
 */
function since(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function countSince(auditEvents, event, from) {
  return auditEvents.filter((e) => e.event === event && new Date(e.at) >= from).length;
}

/** "Just now" / "38 min ago" / "2h ago" / "Yesterday" / a date. */
function relativeTime(iso) {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return then.toLocaleDateString();
}

/** Newest first. The audit trail is appended in order, so this reverses it. */
function newestFirst(events) {
  return [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
}

/**
 * Closure rate for a window: of the queries that arrived in it, how many are
 * closed now. `null` when nothing arrived — a window with no queries has no
 * rate, and showing 0% would imply failure where there was simply no work.
 */
function closureRate(auditEvents, closedQueryIds, from, to = new Date()) {
  const received = auditEvents.filter(
    (e) => e.event === AUDIT_EVENT.QUERY_RECEIVED && new Date(e.at) >= from && new Date(e.at) < to,
  );
  if (received.length === 0) return null;
  const closed = received.filter((e) => closedQueryIds.has(e.queryId)).length;
  return { percent: Math.round((closed / received.length) * 100), received: received.length, closed };
}

const ROW_COLORS = [
  { bg: '#fff9f9', hover: '#fff1f2' },
  { bg: '#fffdf5', hover: '#fffbeb' },
  { bg: '#f7fff9', hover: '#f0fdf4' },
];

export function DashboardPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const auditEvents = useWorkflowStore((state) => state.auditEvents);

  const navigate = useNavigate();

  /**
   * What this user is allowed to see on the dashboard.
   *
   * An Inquirer is deliberately denied /queries — they are outside IPC and must
   * not read the internal caseload — so every cross-query panel below is built
   * from this list, not from `queries`. Matching prefers the user id and falls
   * back to the address, because an enquiry from an unknown sender has no id.
   */
  const visibleQueries =
    currentUser?.role === ROLES.INQUIRER
      ? queries.filter(
          (q) =>
            (q.inquirer?.id && q.inquirer.id === currentUser.id) ||
            (!q.inquirer?.id &&
              q.inquirer?.email?.toLowerCase() === currentUser.email?.toLowerCase()),
        )
      : queries;

  const visibleIds = new Set(visibleQueries.map((q) => q.queryId));
  const visibleAudit = auditEvents.filter((e) => visibleIds.has(e.queryId));

  const mine = queries.filter((q) => q.currentAssigneeId === currentUser?.id);
  const awaitingMyReview = queries.filter((q) => {
    if (q.workflowState !== WORKFLOW_STATE.UNDER_REVIEW) return false;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  const assignedThisWeek = countSince(visibleAudit, AUDIT_EVENT.QUERY_ASSIGNED, since(7));
  const closedThisMonth = countSince(visibleAudit, AUDIT_EVENT.QUERY_CLOSED, since(30));
  const receivedThisWeek = countSince(visibleAudit, AUDIT_EVENT.QUERY_RECEIVED, since(7));

  const kpis = [
    {
      label: 'Assigned to you',
      value: mine.length,
      delta: assignedThisWeek ? `+${assignedThisWeek} assigned this week` : null,
      up: assignedThisWeek > 0 ? true : null,
      cardBg: '#eff6ff',
      cardBorder: '#bfdbfe',
      iconBg: '#dbeafe',
      iconColor: '#2563eb',
      accentBar: '#3b82f6',
      numColor: '#1e40af',
      icon: InboxIcon,
    },
    {
      label: 'In drafting',
      value: queries.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length,
      delta: receivedThisWeek ? `+${receivedThisWeek} received this week` : null,
      up: null,
      cardBg: '#fffbeb',
      cardBorder: '#fde68a',
      iconBg: '#fef3c7',
      iconColor: '#d97706',
      accentBar: '#f59e0b',
      numColor: '#92400e',
      icon: PenLineIcon,
    },
    {
      label: 'Awaiting review',
      value: awaitingMyReview.length,
      delta: awaitingMyReview.length ? `${awaitingMyReview.length} awaiting your decision` : null,
      up: null,
      cardBg: '#fff1f2',
      cardBorder: '#fecdd3',
      iconBg: '#ffe4e6',
      iconColor: '#e11d48',
      accentBar: '#f43f5e',
      numColor: '#9f1239',
      icon: ClipboardCheckIcon,
    },
    {
      label: 'Closed',
      value: queries.filter((q) => q.workflowState === WORKFLOW_STATE.CLOSED).length,
      delta: closedThisMonth ? `+${closedThisMonth} closed in 30 days` : null,
      up: closedThisMonth > 0 ? true : null,
      cardBg: '#f0fdf4',
      cardBorder: '#bbf7d0',
      iconBg: '#dcfce7',
      iconColor: '#16a34a',
      accentBar: '#22c55e',
      numColor: '#14532d',
      icon: CheckCircle2Icon,
    },
  ];

  const closedQueryIds = new Set(
    visibleQueries.filter((q) => q.workflowState === WORKFLOW_STATE.CLOSED).map((q) => q.queryId),
  );

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const rates = [
    { label: 'This month', color: '#4f46e5', rate: closureRate(visibleAudit, closedQueryIds, startOfMonth) },
    { label: 'This week', color: '#f59e0b', rate: closureRate(visibleAudit, closedQueryIds, since(7)) },
    { label: 'Last week', color: '#10b981', rate: closureRate(visibleAudit, closedQueryIds, since(14), since(7)) },
  ];

  const totals = [
    { v: closedQueryIds.size, l: 'Closed', c: '#16a34a', bg: '#f0fdf4' },
    { v: visibleQueries.filter((q) => q.workflowState !== WORKFLOW_STATE.CLOSED).length, l: 'Active', c: '#4f46e5', bg: '#eef2ff' },
    { v: visibleQueries.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length, l: 'Drafts', c: '#d97706', bg: '#fffbeb' },
  ];

  // Closures, newest first, resolved back to the query they belong to.
  const recentlyClosed = newestFirst(visibleAudit.filter((e) => e.event === AUDIT_EVENT.QUERY_CLOSED))
    .slice(0, 3)
    .map((event) => {
      const query = visibleQueries.find((q) => q.queryId === event.queryId);
      const assignee = query?.currentAssigneeId ? findUserById(query.currentAssigneeId) : null;
      return {
        queryId: event.queryId,
        subject: query?.subject || '(no subject)',
        closedAt: event.at,
        division: findDivisionById(assignee?.divisionId)?.name || 'Unassigned',
      };
    });

  const activity = newestFirst(visibleAudit).slice(0, 5);

  const myQueue = queries.filter((q) => {
    if (q.currentAssigneeId === currentUser?.id) return true;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  return (
    <div>
      <PageHeader
        title="Dashboard"
        purpose={
          <>
            Role-specific overview · <span className="text-status-gray-fg font-medium">{currentUser?.name} ({ROLE_LABELS[currentUser?.role]})</span>
          </>
        }
        actions={
          // Only the Inquirer raises enquiries. The button had no onClick at
          // all before, so it was inert for every role including theirs.
          <RoleGate allow={[ROLES.INQUIRER]}>
            <button
              type="button"
              onClick={() => navigate(paths.COMPOSE)}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-primary border-none rounded-[9px] px-4 py-2 cursor-pointer shadow-[0_2px_8px_rgba(79,70,229,0.35)] hover:bg-primary-hover transition-colors"
            >
              <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
              New Query
            </button>
          </RoleGate>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3.5 mb-5 sm:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile
            key={kpi.label}
            total={queries.length}
            {...kpi}
          />
        ))}
      </div>

      {/* Waiting + Resolution */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_296px] gap-3.5 mb-3.5">
        {/* Waiting on you */}
        <div className="bg-white rounded-[13px] border border-border overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="p-[15px_20px] bg-[linear-gradient(90deg,#f5f3ff,#eef2ff)] border-b border-[#e0e7ff] flex justify-between items-center">
            <div>
              <h2 className="font-heading text-[15px] font-bold text-[#1e1b4b] m-0">Waiting on you</h2>
              <p className="m-[2px_0_0] text-[12px] text-[#818cf8]">Queries requiring your action</p>
            </div>
            <span className="text-[11.5px] font-bold text-primary bg-[#ede9fe] rounded-[20px] px-2.75 py-0.75 border border-[#ddd6fe]">
              {myQueue.length} open
            </span>
          </div>

          {myQueue.length === 0 ? (
            <div className="p-4 bg-white">
              <EmptyState
                icon={InboxIcon}
                title="Nothing waiting on you"
                description="Switch user in the header to act as the role this query is currently with."
              />
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="grid grid-cols-[68px_1fr_130px_90px] gap-2 p-[8px_20px] bg-[#fafafa] border-b border-accent">
                {['ID', 'Title', 'Status', 'Priority'].map(h => (
                  <span key={h} className="text-[10px] font-bold text-[#cbd5e1] tracking-[0.09em] uppercase">{h}</span>
                ))}
              </div>

              {/* Rows */}
              <div>
                {myQueue.map((query, i) => {
                  const colors = ROW_COLORS[i % ROW_COLORS.length];
                  return (
                    <Link
                      key={query.queryId}
                      to={buildPath(paths.QUERY_DETAIL, { queryId: query.queryId })}
                      className="group grid grid-cols-[68px_1fr_130px_90px] gap-2 p-[13px_20px] items-center cursor-pointer transition-colors"
                      style={{
                        background: colors.bg,
                        borderBottom: i < myQueue.length - 1 ? '1px solid #f1f5f9' : 'none',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = colors.hover}
                      onMouseLeave={(e) => e.currentTarget.style.background = colors.bg}
                    >
                      <span className="text-[11.5px] font-bold text-primary group-hover:underline">{query.queryId}</span>
                      <span className="text-[13px] text-[#374151] leading-[1.4] truncate group-hover:underline">{query.subject}</span>
                      <div className="flex shrink-0">
                        <StatusBadge type="workflow" value={query.workflowState} />
                      </div>
                      <div className="flex shrink-0">
                        <StatusBadge type="priority" value={query.priority} />
                      </div>
                    </Link>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Resolution rate — closure rate per window, from the audit trail */}
        <div className="bg-white rounded-[13px] border border-border p-[18px_20px] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <h3 className="font-heading text-[15px] font-bold text-card-foreground m-[0_0_3px]">Resolution rate</h3>
          <p className="text-[12px] text-muted-foreground m-[0_0_18px]">Share of enquiries received in each period that are now closed</p>
          {rates.map(({ label, color, rate }) => (
            <div key={label} className="mb-3.5">
              <div className="flex justify-between mb-1.25">
                <span className="text-[12px] text-status-gray-fg">{label}</span>
                {/* No enquiries in a window means no rate — 0% would read as failure. */}
                <span className="text-[12px] font-bold text-[#374151]">
                  {rate ? `${rate.percent}%` : 'No data'}
                </span>
              </div>
              <div className="h-1.75 rounded-full bg-accent overflow-hidden">
                {rate && (
                  <div className="h-full rounded-full" style={{ width: `${rate.percent}%`, background: color }} />
                )}
              </div>
              {rate && (
                <div className="mt-0.75 text-[10.5px] text-muted-foreground">
                  {rate.closed} of {rate.received} closed
                </div>
              )}
            </div>
          ))}
          <div className="mt-4.5 border-t border-accent pt-4 flex justify-around text-center">
            {totals.map(s => (
              <div key={s.l} className="rounded-[10px] p-[8px_14px]" style={{ background: s.bg }}>
                <div className="font-heading text-[20px] font-bold" style={{ color: s.c }}>{s.v}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row — both panels read the audit trail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* Recently closed */}
        <div className="bg-white rounded-[13px] border border-border p-[18px_20px] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="flex justify-between items-center mb-3.75">
            <h3 className="font-heading text-[15px] font-bold text-card-foreground m-0">Recently closed</h3>
            {/* The Inquirer has no queries list to view, so no link is offered. */}
            <RoleGate allow={[ROLES.FRONT_OFFICE, ROLES.OFFICER_IN_CHARGE, ROLES.ASSIGNED_OFFICIAL, ROLES.REVIEWER, ROLES.ADMIN, ROLES.SUPER_ADMIN]}>
              <Link to={paths.QUERIES} className="text-[12px] text-primary font-semibold hover:underline">
                View all
              </Link>
            </RoleGate>
          </div>

          {recentlyClosed.length === 0 ? (
            <EmptyState
              icon={CheckCircle2Icon}
              title="Nothing closed yet"
              description="Closed queries appear here once a response has been dispatched."
            />
          ) : (
            recentlyClosed.map((item, i) => {
              // An Inquirer has no query-detail route, so the row is not a link
              // for them — building one would produce a path they cannot open.
              const Row = paths.QUERY_DETAIL ? Link : 'div';
              const rowProps = paths.QUERY_DETAIL
                ? { to: buildPath(paths.QUERY_DETAIL, { queryId: item.queryId }) }
                : {};
              return (
              <Row
                key={item.queryId}
                {...rowProps}
                className="flex items-center gap-2.75 p-2.5 rounded-[9px] transition-colors bg-[#f7fff9] hover:bg-status-green-bg"
                style={{ marginBottom: i < recentlyClosed.length - 1 ? 4 : 0 }}
              >
                <div className="w-7.5 h-7.5 rounded-[8px] bg-[#dcfce7] flex items-center justify-center shrink-0">
                  <CheckCircle2Icon className="h-3.25 w-3.25 text-status-green-fg" strokeWidth={2.2} aria-hidden="true" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="text-[13px] text-[#374151] whitespace-nowrap overflow-hidden text-ellipsis">{item.subject}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{item.queryId} · {item.division}</div>
                </div>
                <span className="text-[11px] text-[#cbd5e1] shrink-0">{relativeTime(item.closedAt)}</span>
              </Row>
              );
            })
          )}
        </div>

        {/* Activity feed */}
        <div className="bg-white rounded-[13px] border border-border p-[18px_20px] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-heading text-[15px] font-bold text-card-foreground m-0">Activity feed</h3>
            <span className="text-[11px] text-muted-foreground">Audit trail</span>
          </div>

          {activity.length === 0 ? (
            <EmptyState
              icon={InboxIcon}
              title="No activity yet"
              description="Every workflow transition is recorded here as it happens."
            />
          ) : (
            activity.map((event, i) => (
              <div
                key={event.auditId}
                className="flex gap-2.75 p-[9px_10px] rounded-[9px] cursor-default"
                style={{ marginBottom: i < activity.length - 1 ? 4 : 0 }}
              >
                <div className="flex flex-col items-center pt-1">
                  <div className="w-2 h-2 rounded-full shrink-0 bg-primary" />
                  {i < activity.length - 1 && <div className="w-px flex-1 bg-accent mt-1" />}
                </div>
                <div>
                  <div className="text-[13px] text-[#374151] leading-[1.45]">
                    {event.queryId} — {AUDIT_EVENT_LABELS[event.event] || event.event}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {event.actor} · {relativeTime(event.at)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

