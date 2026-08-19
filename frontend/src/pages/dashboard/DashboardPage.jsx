import { Link } from 'react-router-dom';
import { InboxIcon, PenLineIcon, ClipboardCheckIcon, CheckCircle2Icon, PlusIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROLE_LABELS } from '@/constants/roles';
import { WORKFLOW_STATE } from '@/constants/statusEnums';
import { buildPath } from '@/constants/routePaths';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

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

  const mine = queries.filter((q) => q.currentAssigneeId === currentUser?.id);
  const awaitingMyReview = queries.filter((q) => {
    if (q.workflowState !== WORKFLOW_STATE.UNDER_REVIEW) return false;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  const kpis = [
    {
      label: 'Assigned to you',
      value: mine.length,
      delta: '+3 this week',
      up: true,
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
      delta: '2 pending review',
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
      delta: '3 overdue',
      up: false,
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
      delta: '+12 this month',
      up: true,
      cardBg: '#f0fdf4',
      cardBorder: '#bbf7d0',
      iconBg: '#dcfce7',
      iconColor: '#16a34a',
      accentBar: '#22c55e',
      numColor: '#14532d',
      icon: CheckCircle2Icon,
    },
  ];

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
            Role-specific overview · <span className="text-[#64748b] font-medium">{currentUser?.name} ({ROLE_LABELS[currentUser?.role]})</span>
          </>
        }
        actions={
          <button className="flex items-center gap-[6px] text-[13px] font-semibold text-white bg-[#4f46e5] border-none rounded-[9px] px-[16px] py-[8px] cursor-pointer shadow-[0_2px_8px_rgba(79,70,229,0.35)] hover:bg-[#4338ca] transition-colors">
            <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
            New Query
          </button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-[14px] mb-[20px] sm:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile
            key={kpi.label}
            {...kpi}
          />
        ))}
      </div>

      {/* Waiting + Resolution */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_296px] gap-[14px] mb-[14px]">
        {/* Waiting on you */}
        <div className="bg-white rounded-[13px] border border-[#e2e8f0] overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="p-[15px_20px] bg-[linear-gradient(90deg,#f5f3ff,#eef2ff)] border-b border-[#e0e7ff] flex justify-between items-center">
            <div>
              <h2 className="font-heading text-[15px] font-bold text-[#1e1b4b] m-0">Waiting on you</h2>
              <p className="m-[2px_0_0] text-[12px] text-[#818cf8]">Queries requiring your action</p>
            </div>
            <span className="text-[11.5px] font-bold text-[#4f46e5] bg-[#ede9fe] rounded-[20px] px-[11px] py-[3px] border border-[#ddd6fe]">
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
              <div className="grid grid-cols-[68px_1fr_130px_90px] gap-2 p-[8px_20px] bg-[#fafafa] border-b border-[#f1f5f9]">
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
                      <span className="text-[11.5px] font-bold text-[#4f46e5] group-hover:underline">{query.queryId}</span>
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

        {/* Resolution rate (Static Mock) */}
        <div className="bg-white rounded-[13px] border border-[#e2e8f0] p-[18px_20px] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <h3 className="font-heading text-[15px] font-bold text-[#0f172a] m-[0_0_3px]">Resolution rate</h3>
          <p className="text-[12px] text-[#94a3b8] m-[0_0_18px]">Avg. query completion</p>
          {[
            { label: 'This month', value: 91, color: '#4f46e5' },
            { label: 'This week', value: 87, color: '#f59e0b' },
            { label: 'Last week', value: 72, color: '#10b981' },
          ].map(row => (
            <div key={row.label} className="mb-[14px]">
              <div className="flex justify-between mb-[5px]">
                <span className="text-[12px] text-[#64748b]">{row.label}</span>
                <span className="text-[12px] font-bold text-[#374151]">{row.value}%</span>
              </div>
              <div className="h-[7px] rounded-full bg-[#f1f5f9] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${row.value}%`, background: row.color }} />
              </div>
            </div>
          ))}
          <div className="mt-[18px] border-t border-[#f1f5f9] pt-[16px] flex justify-around text-center">
            {[
              { v: '47', l: 'Closed', c: '#16a34a', bg: '#f0fdf4' },
              { v: '8', l: 'Active', c: '#4f46e5', bg: '#eef2ff' },
              { v: '5', l: 'Drafts', c: '#d97706', bg: '#fffbeb' },
            ].map(s => (
              <div key={s.l} className="rounded-[10px] p-[8px_14px]" style={{ background: s.bg }}>
                <div className="font-heading text-[20px] font-bold" style={{ color: s.c }}>{s.v}</div>
                <div className="text-[11px] text-[#94a3b8] mt-[2px]">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row (Static Mock) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px]">
        {/* Recently closed */}
        <div className="bg-white rounded-[13px] border border-[#e2e8f0] p-[18px_20px] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="flex justify-between items-center mb-[15px]">
            <h3 className="font-heading text-[15px] font-bold text-[#0f172a] m-0">Recently closed</h3>
            <button className="text-[12px] text-[#4f46e5] font-semibold bg-transparent border-none cursor-pointer hover:underline">View all</button>
          </div>
          {[
            { id: 'Q-2034', title: 'Staff access request for new ERP module', time: '2h ago', dept: 'Tech Ops', rowBg: '#f7f9ff', rowHover: '#eef2ff' },
            { id: 'Q-2031', title: 'Compliance report Q2 amendment required', time: '5h ago', dept: 'Legal', rowBg: '#f7fff9', rowHover: '#f0fdf4' },
            { id: 'Q-2028', title: 'Vendor invoice mismatch — July batch', time: 'Yesterday', dept: 'Finance', rowBg: '#fffdf5', rowHover: '#fffbeb' },
          ].map((item, i) => (
            <div key={item.id}
              className="flex items-center gap-[11px] p-[10px] rounded-[9px] cursor-pointer transition-colors"
              style={{ background: item.rowBg, marginBottom: i < 2 ? 4 : 0 }}
              onMouseEnter={e => e.currentTarget.style.background = item.rowHover}
              onMouseLeave={e => e.currentTarget.style.background = item.rowBg}
            >
              <div className="w-[30px] h-[30px] rounded-[8px] bg-[#dcfce7] flex items-center justify-center shrink-0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 12 2 2 4-4" /><circle cx="12" cy="12" r="10" />
                </svg>
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="text-[13px] text-[#374151] whitespace-nowrap overflow-hidden text-ellipsis">{item.title}</div>
                <div className="text-[11px] text-[#94a3b8] mt-[2px]">{item.id} · {item.dept}</div>
              </div>
              <span className="text-[11px] text-[#cbd5e1] shrink-0">{item.time}</span>
            </div>
          ))}
        </div>

        {/* Activity feed */}
        <div className="bg-white rounded-[13px] border border-[#e2e8f0] p-[18px_20px] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
          <div className="flex justify-between items-center mb-[16px]">
            <h3 className="font-heading text-[15px] font-bold text-[#0f172a] m-0">Activity feed</h3>
            <span className="flex items-center gap-[5px] text-[11px] font-semibold text-[#16a34a] bg-[#f0fdf4] rounded-[20px] px-[9px] py-[3px] border border-[#bbf7d0]">
              <span className="w-[5px] h-[5px] rounded-full bg-[#22c55e]" /> Live
            </span>
          </div>
          {[
            { text: 'Q-2041 marked as High priority', time: 'Just now', dot: '#ef4444', bg: '#fff1f2' },
            { text: 'Bhumika added a comment on Q-2038', time: '12 min ago', dot: '#6366f1', bg: '#eef2ff' },
            { text: 'Q-2035 reassigned to Front Office', time: '38 min ago', dot: '#f59e0b', bg: '#fffbeb' },
            { text: 'Q-2034 closed successfully', time: '2h ago', dot: '#22c55e', bg: '#f0fdf4' },
          ].map((ev, i) => (
            <div key={i}
              className="flex gap-[11px] p-[9px_10px] rounded-[9px] transition-colors cursor-default"
              style={{ background: i === 0 ? ev.bg : 'transparent', marginBottom: i < 3 ? 4 : 0 }}
              onMouseEnter={e => e.currentTarget.style.background = ev.bg}
              onMouseLeave={e => e.currentTarget.style.background = i === 0 ? ev.bg : 'transparent'}
            >
              <div className="flex flex-col items-center pt-[4px]">
                <div className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: ev.dot }} />
                {i < 3 && <div className="w-[1px] flex-1 bg-[#f1f5f9] mt-[4px]" />}
              </div>
              <div>
                <div className="text-[13px] text-[#374151] leading-[1.45]">{ev.text}</div>
                <div className="text-[11px] text-[#94a3b8] mt-[2px]">{ev.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

