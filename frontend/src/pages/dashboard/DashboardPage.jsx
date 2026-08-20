import { Link, useNavigate } from 'react-router-dom';
import { 
  Inbox as InboxIcon, 
  PenLine as PenLineIcon, 
  ClipboardCheck as ClipboardCheckIcon, 
  CheckCircle2 as CheckCircle2Icon, 
  Plus as PlusIcon,
  ChevronRight,
  TrendingUp,
  Activity,
  Send,
  UserCheck,
  Calendar,
  CalendarClock,
  CalendarCheck,
  User,
  FileText,
  Info,
  Mail,
  Clock,
  ShieldCheck,
  MoreVertical,
  ArrowRight,
  Pencil,
  XCircle
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatTile } from '@/components/common/StatTile';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { ROLE_LABELS, ROLES } from '@/constants/roles';
import { RoleGate } from '@/components/common/RoleGate';
import { findUserById } from '@/constants/mockUsers';
import { findDivisionById } from '@/constants/mockDivisions';
import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';
import { buildPath } from '@/constants/routePaths';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { ROLE_SLUG } from '@/constants/permissions';

const DRAFTING_STATES = [
  WORKFLOW_STATE.ASSIGNED,
  WORKFLOW_STATE.DRAFTING,
  WORKFLOW_STATE.RETURNED_FOR_REVISION,
];

function since(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function countSince(auditEvents, event, from) {
  return auditEvents.filter((e) => e.event === event && new Date(e.at) >= from).length;
}

function relativeTime(iso) {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';
  return then.toLocaleDateString();
}

function newestFirst(events) {
  return [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function DashboardPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const queries = useWorkflowStore((state) => state.queries);
  const workflowSteps = useWorkflowStore((state) => state.workflowSteps);
  const auditEvents = useWorkflowStore((state) => state.auditEvents);

  const navigate = useNavigate();

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

  const totalCount = queries.length;
  const closedCount = queries.filter((q) => q.workflowState === WORKFLOW_STATE.CLOSED).length;
  const activeCount = queries.filter((q) => q.workflowState !== WORKFLOW_STATE.CLOSED).length;
  const draftsCount = queries.filter((q) => DRAFTING_STATES.includes(q.workflowState)).length;
  const resolutionPct = totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0;

  const kpis = [
    {
      label: 'Assigned to you',
      value: mine.length,
      trendText: '↗ 12%',
      trendType: 'up',
      subtextMain: `↑ ${mine.length} assigned to you`,
      subtextColor: 'text-emerald-600',
      cardBg: 'linear-gradient(180deg, #f4f8ff 0%, #ffffff 100%)',
      cardBorder: '#bfdbfe',
      numColor: '#2563eb',
      illustrationType: 'assigned',
      icon: UserCheck,
    },
    {
      label: 'In drafting',
      value: draftsCount,
      trendText: '↗ 8%',
      trendType: 'up',
      subtextMain: `↑ ${draftsCount} in draft state`,
      subtextColor: 'text-amber-600',
      cardBg: 'linear-gradient(180deg, #fffdf2 0%, #ffffff 100%)',
      cardBorder: '#fde68a',
      numColor: '#d97706',
      illustrationType: 'drafting',
      icon: PenLineIcon,
    },
    {
      label: 'Awaiting review',
      value: awaitingMyReview.length,
      trendText: '↘ 5%',
      trendType: 'down',
      subtextMain: `↓ ${awaitingMyReview.length} awaiting review`,
      subtextColor: 'text-rose-600',
      cardBg: 'linear-gradient(180deg, #fff5f6 0%, #ffffff 100%)',
      cardBorder: '#fecdd3',
      numColor: '#e11d48',
      illustrationType: 'review',
      icon: ClipboardCheckIcon,
    },
    {
      label: 'Closed',
      value: closedCount,
      trendText: '↑ 18%',
      trendType: 'up',
      subtextMain: `↑ ${closedCount} total closed`,
      subtextColor: 'text-emerald-600',
      cardBg: 'linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)',
      cardBorder: '#bbf7d0',
      numColor: '#059669',
      illustrationType: 'closed',
      icon: CheckCircle2Icon,
    },
  ];

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

  const myQueue = queries.filter((q) => {
    if (q.currentAssigneeId === currentUser?.id) return true;
    const step = workflowSteps.find((s) => s.stepId === q.currentWorkflowStepId);
    return step?.assignedUserId === currentUser?.id;
  });

  const getQueryDetailPath = (queryId) => {
    if (paths.QUERY_DETAIL) {
      return buildPath(paths.QUERY_DETAIL, { queryId });
    }
    const slug = ROLE_SLUG[currentUser?.role] || 'officer-in-charge';
    return `/${slug}/queries/${queryId}`;
  };

  const queueToRender = myQueue.length > 0 ? myQueue : visibleQueries.slice(0, 5);

  const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'User';

  return (
    <div className="space-y-5">
      <PageHeader
        greeting={`Good morning, ${firstName} 👋`}
        title="Dashboard"
        purpose={
          <>
            Role-specific overview · <span className="font-medium text-slate-500">{currentUser?.name} ({ROLE_LABELS[currentUser?.role]})</span>
          </>
        }
        actions={
          <RoleGate allow={[ROLES.INQUIRER]}>
            <button
              type="button"
              onClick={() => navigate(paths.COMPOSE)}
              className="flex items-center gap-2 text-[13px] font-semibold text-white bg-blue-600 border-none rounded-xl px-4 py-2.5 cursor-pointer shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-colors"
            >
              <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
              New Query
            </button>
          </RoleGate>
        }
      />

      {/* Stat cards row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <StatTile
            key={kpi.label}
            {...kpi}
          />
        ))}
      </div>

      {/* Middle section — Waiting on you + Resolution rate */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_450px] gap-4">
        {/* Waiting on you Card (Neumorphic Soft UI) */}
        <div className="bg-[#f1f5fa] rounded-3xl border border-white/80 overflow-hidden shadow-[12px_12px_24px_#d0d7e5,-12px_-12px_24px_#ffffff] flex flex-col justify-between">
          <div>
            {/* Card Top Header */}
            <div className="relative p-6 border-b border-white/60 flex justify-between items-center bg-[#f1f5fa]">
              <div className="flex items-center gap-4 relative z-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f1f5fa] text-purple-600 border border-white shadow-[5px_5px_10px_#d0d7e5,-5px_-5px_10px_#ffffff]">
                  <FileText className="h-7 w-7" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">Waiting on you</h2>
                  <p className="m-0 text-[14px] font-medium text-slate-400 mt-1">Queries requiring your action</p>
                </div>
              </div>

              <div className="relative z-10 flex items-center gap-2 rounded-xl bg-[#f1f5fa] px-4 py-2 text-[12.5px] font-extrabold text-purple-700 border border-white shadow-[4px_4px_8px_#d0d7e5,-4px_-4px_8px_#ffffff]">
                <InboxIcon className="h-4 w-4 text-purple-600" />
                <span>{myQueue.length || 1} open</span>
              </div>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[160px_1fr_210px_130px_36px] gap-3 px-6 py-3 bg-[#e8eef5] shadow-[inset_2px_2px_4px_#c8cfde,inset_-2px_-2px_4px_#ffffff] text-[11px] font-extrabold text-slate-400 tracking-wider uppercase">
              <span>ID</span>
              <span>TITLE</span>
              <span className="text-center">STATUS</span>
              <span className="text-center">PRIORITY</span>
              <span></span>
            </div>

            {/* Table Rows */}
            <div className="p-4 space-y-3">
              {queueToRender.map((query) => (
                <Link
                  key={query.queryId}
                  to={getQueryDetailPath(query.queryId)}
                  className="group relative flex items-center justify-between gap-3 neu-row rounded-2xl p-3.5 transition-all overflow-hidden cursor-pointer"
                >
                  {/* Left Accent Indicator Bar */}
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-purple-600 rounded-l-2xl" />

                  {/* ID */}
                  <div className="flex items-center gap-3 w-[160px] shrink-0 pl-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f1f5fa] text-purple-600 shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white">
                      <FileText className="h-5 w-5" strokeWidth={1.8} />
                    </div>
                    <div className="font-heading text-[13px] font-extrabold text-purple-700 group-hover:underline">
                      {query.queryId}
                    </div>
                  </div>

                  <div className="h-8 w-px bg-slate-200/60 shrink-0" />

                  {/* Title */}
                  <div className="flex items-center gap-3 flex-1 min-w-0 px-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-blue-600 shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white">
                      <Mail className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold text-slate-800 truncate group-hover:text-purple-700">
                        {query.subject}
                      </div>
                      <div className="text-[11px] font-medium text-slate-400 mt-0.5">
                        Received 19 Aug 2026 • 09:30 AM
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="w-[210px] shrink-0 flex justify-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f5fa] px-3.5 py-1.5 text-[11px] font-extrabold text-purple-700 shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff] border border-white/60">
                      <Clock className="h-3.5 w-3.5 text-purple-600" />
                      {query.businessStatus || query.workflowState || 'PENDING FINAL APPROVAL'}
                    </span>
                  </div>

                  {/* Priority Badge */}
                  <div className="w-[130px] shrink-0 flex justify-center">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f5fa] px-3.5 py-1.5 text-[11px] font-extrabold text-blue-700 shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff] border border-white/60">
                      <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                      {query.priority || 'NORMAL'}
                    </span>
                  </div>

                  {/* Menu */}
                  <div className="w-[36px] shrink-0 flex justify-end">
                    <div className="p-1 rounded-lg text-slate-400 group-hover:text-slate-600 transition-colors">
                      <MoreVertical className="h-4 w-4" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Footer Bar */}
          <div className="p-5 border-t border-white/60 flex items-center justify-between bg-[#f1f5fa]">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-purple-600 shrink-0" />
              <span className="text-[12px] font-semibold text-slate-600">Showing 1 of 1 item</span>
            </div>
          </div>
        </div>


        {/* Resolution rate Card (Neumorphic Soft UI) */}
        <div className="bg-[#f1f5fa] rounded-3xl border border-white/80 p-6 shadow-[12px_12px_24px_#d0d7e5,-12px_-12px_24px_#ffffff] flex flex-col justify-between">
          <div>
            {/* Top Header */}
            <div className="flex justify-between items-start mb-6">
              <div className="flex gap-4 items-start">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f1f5fa] text-blue-600 border border-white shadow-[5px_5px_10px_#d0d7e5,-5px_-5px_10px_#ffffff]">
                  <TrendingUp className="h-7 w-7" strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">Resolution rate</h3>
                  <p className="text-[14px] font-normal text-slate-400 m-0 mt-1 max-w-[240px] leading-relaxed">
                    Share of enquiries received in each period that are now closed
                  </p>
                </div>
              </div>

              {/* Vector graphic chart illustration in top right */}
              <div className="relative w-22 h-14 shrink-0 pointer-events-none select-none hidden sm:block">
                <svg width="50" height="50" viewBox="0 0 60 60" className="absolute top-0 left-0 opacity-80">
                  <circle cx="30" cy="30" r="22" stroke="#dbeafe" strokeWidth="10" fill="none" />
                  <circle cx="30" cy="30" r="22" stroke="#93c5fd" strokeWidth="10" strokeDasharray="40 100" strokeDashoffset="0" fill="none" />
                  <circle cx="30" cy="30" r="22" stroke="#c4b5fd" strokeWidth="10" strokeDasharray="30 100" strokeDashoffset="-40" fill="none" />
                </svg>
                <div className="absolute top-1 right-0 w-18 h-12 bg-white/95 rounded-xl shadow-[4px_4px_8px_#d0d7e5,-4px_-4px_8px_#ffffff] border border-slate-100 p-1.5 flex flex-col justify-between transform rotate-3">
                  <div className="flex gap-1 items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <div className="w-5 h-1 rounded-full bg-slate-100" />
                  </div>
                  <svg width="100%" height="16" viewBox="0 0 50 16" fill="none">
                    <path d="M2 14 L14 10 L26 12 L38 4 L46 2" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" fill="none" />
                    <circle cx="46" cy="2" r="2" fill="#6366f1" />
                  </svg>
                </div>
              </div>
            </div>

            {/* 3 Progress Rows */}
            <div className="space-y-4">
              {/* Row 1: This month */}
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-blue-600 shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white">
                    <Calendar className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[14px] font-bold text-slate-800">This month</span>
                      <span className="text-[14px] font-extrabold text-blue-600">{resolutionPct}%</span>
                    </div>
                    <div className="h-3 rounded-full bg-[#e6ebf2] shadow-[inset_2px_2px_4px_#c8cfde,inset_-2px_-2px_4px_#ffffff] overflow-hidden w-full p-0.5">
                      <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${resolutionPct}%` }} />
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-slate-400">{closedCount} of {totalCount} closed</div>
                  </div>
                </div>
              </div>

              <div className="h-px bg-slate-200/50" />

              {/* Row 2: This week */}
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-purple-600 shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white">
                    <CalendarClock className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[14px] font-bold text-slate-800">This week</span>
                      <span className="text-[14px] font-extrabold text-purple-600">{resolutionPct}%</span>
                    </div>
                    <div className="h-3 rounded-full bg-[#e6ebf2] shadow-[inset_2px_2px_4px_#c8cfde,inset_-2px_-2px_4px_#ffffff] overflow-hidden w-full p-0.5">
                      <div className="h-full rounded-full bg-purple-600 transition-all duration-500" style={{ width: `${resolutionPct}%` }} />
                    </div>
                    <div className="mt-1 text-[12px] font-medium text-slate-400">{closedCount} of {totalCount} closed</div>
                  </div>
                </div>
              </div>

              <div className="h-px bg-slate-200/50" />

              {/* Row 3: Last week */}
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-emerald-600 shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white">
                    <CalendarCheck className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[14px] font-bold text-slate-800">Last week</span>
                      <span className="text-[14px] font-extrabold text-emerald-600">{totalCount > 0 ? `${resolutionPct}%` : 'No data'}</span>
                    </div>
                    <div className="h-3 rounded-full bg-[#e6ebf2] shadow-[inset_2px_2px_4px_#c8cfde,inset_-2px_-2px_4px_#ffffff] overflow-hidden w-full p-0.5">
                      <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${resolutionPct}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3 Stat cards at bottom (Neumorphic Mini Cards) */}
          <div className="grid grid-cols-3 gap-3 my-5">
            {/* Card 1: Closed */}
            <div className="rounded-2xl p-3.5 bg-[#f1f5fa] border border-white/90 flex items-center gap-3 shadow-[6px_6px_12px_#d0d7e5,-6px_-6px_12px_#ffffff] hover:shadow-[8px_8px_16px_#c8cfde,-8px_-8px_16px_#ffffff] transition-all">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-emerald-600 shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff]">
                <CheckCircle2Icon className="h-5 w-5 text-emerald-600" strokeWidth={2.2} />
              </div>
              <div>
                <div className="font-heading text-[22px] font-extrabold text-emerald-700 leading-none">{closedCount}</div>
                <div className="text-[11.5px] font-semibold text-slate-500 mt-1">Closed</div>
              </div>
            </div>

            {/* Card 2: Active */}
            <div className="rounded-2xl p-3.5 bg-[#f1f5fa] border border-white/90 flex items-center gap-3 shadow-[6px_6px_12px_#d0d7e5,-6px_-6px_12px_#ffffff] hover:shadow-[8px_8px_16px_#c8cfde,-8px_-8px_16px_#ffffff] transition-all">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-blue-600 shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff]">
                <User className="h-5 w-5 text-blue-600" strokeWidth={2} />
              </div>
              <div>
                <div className="font-heading text-[22px] font-extrabold text-blue-700 leading-none">{activeCount}</div>
                <div className="text-[11.5px] font-semibold text-slate-500 mt-1">Active</div>
              </div>
            </div>

            {/* Card 3: Drafts */}
            <div className="rounded-2xl p-3.5 bg-[#f1f5fa] border border-white/90 flex items-center gap-3 shadow-[6px_6px_12px_#d0d7e5,-6px_-6px_12px_#ffffff] hover:shadow-[8px_8px_16px_#c8cfde,-8px_-8px_16px_#ffffff] transition-all">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-amber-600 shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff]">
                <FileText className="h-5 w-5 text-amber-600" strokeWidth={2} />
              </div>
              <div>
                <div className="font-heading text-[22px] font-extrabold text-amber-700 leading-none">{draftsCount}</div>
                <div className="text-[11.5px] font-semibold text-slate-500 mt-1">Drafts</div>
              </div>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="pt-2 border-t border-slate-100/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-500 shrink-0" />
              <div className="flex flex-col text-left leading-tight">
                <span className="text-[11px] font-normal italic text-slate-400">Auto-updated</span>
                <span className="text-[11px] font-medium text-slate-500">Today, 09:30 AM</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom section — Recently closed + Activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recently closed Card */}
        <div className="bg-white rounded-3xl border border-slate-200/70 p-6 shadow-sm flex flex-col justify-between">
          <div>
            {/* Card Header */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100/60 shadow-2xs">
                  <CheckCircle2Icon className="h-7 w-7" strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">Recently closed</h3>
                  <p className="text-[14px] font-normal text-slate-400 m-0 mt-1 max-w-[280px]">
                    Closed queries appear here once a response has been dispatched.
                  </p>
                </div>
              </div>
            </div>

            {/* Content Area */}
            {recentlyClosed.length === 0 ? (
              <div className="my-4 rounded-2xl border border-dashed border-emerald-200/80 bg-[#f8fcf9] p-8 flex flex-col items-center justify-center text-center">
                {/* Custom Green Graphic Illustration */}
                <div className="relative w-44 h-32 flex items-center justify-center select-none pointer-events-none mb-2">
                  <div className="absolute w-32 h-16 bg-emerald-200/40 rounded-full blur-xl" />
                  <svg width="150" height="110" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g transform="translate(105, 5)">
                      <path d="M0 25 L35 0 L22 30 L14 22 L0 25 Z" fill="#34d399" />
                      <path d="M22 30 L35 0 L14 22 Z" fill="#10b981" />
                      <path d="M-15 35 Q-5 25 10 24" stroke="#a7f3d0" strokeWidth="2" strokeDasharray="3 3" fill="none" />
                    </g>
                    <rect x="42" y="25" width="60" height="65" rx="8" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="2" />
                    <rect x="52" y="38" width="30" height="4" rx="2" fill="#cbd5e1" />
                    <rect x="52" y="48" width="40" height="4" rx="2" fill="#e2e8f0" />
                    <rect x="58" y="15" width="55" height="65" rx="8" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
                    <rect x="68" y="28" width="35" height="5" rx="2.5" fill="#94a3b8" />
                    <rect x="68" y="39" width="22" height="4" rx="2" fill="#cbd5e1" />
                    <path d="M30 65 L80 90 L130 65 V100 C130 105 125 110 120 110 H40 C35 110 30 105 30 100 V65 Z" fill="#10b981" />
                    <path d="M30 65 L80 95 L130 65 L80 90 L30 65 Z" fill="#059669" />
                    <circle cx="115" cy="85" r="16" fill="#ffffff" />
                    <circle cx="115" cy="85" r="14" fill="#34d399" />
                    <path d="M109 85 L113 89 L121 81" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                </div>

                <div className="text-[16px] font-extrabold text-slate-900 mt-2">Nothing closed yet</div>
                <div className="text-[12.5px] font-medium text-slate-400 mt-1">
                  Once a query is closed, it will appear here.
                </div>
              </div>
            ) : (
              recentlyClosed.map((item) => {
                const Row = paths.QUERY_DETAIL ? Link : 'div';
                const rowProps = paths.QUERY_DETAIL
                  ? { to: buildPath(paths.QUERY_DETAIL, { queryId: item.queryId }) }
                  : {};
                return (
                  <Row
                    key={item.queryId}
                    {...rowProps}
                    className="flex items-center gap-3 p-3.5 rounded-2xl transition-colors bg-emerald-50/40 hover:bg-emerald-50/80 mb-2.5 border border-emerald-100/70 shadow-2xs"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-700">
                      <CheckCircle2Icon className="h-5 w-5" strokeWidth={2.2} />
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="text-[13.5px] font-bold text-slate-800 truncate">{item.subject}</div>
                      <div className="text-[11.5px] font-medium text-slate-400 mt-0.5">{item.queryId} · {item.division}</div>
                    </div>
                    <span className="text-[11.5px] font-semibold text-slate-400 shrink-0">{relativeTime(item.closedAt)}</span>
                  </Row>
                );
              })
            )}
          </div>
        </div>

        {/* Activity feed Card */}
        <div className="bg-white rounded-3xl border border-slate-200/70 p-6 shadow-sm flex flex-col justify-between">
          <div>
            {/* Card Header */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100/60 shadow-2xs">
                  <Activity className="h-7 w-7" strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">Activity feed</h3>
                  <p className="text-[14px] font-normal text-slate-400 m-0 mt-1">
                    Stay updated with the latest actions and progress.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-xl border border-blue-200/80 bg-blue-50/80 px-4 py-2 text-[12.5px] font-bold text-blue-600 hover:bg-blue-100 transition-colors shadow-2xs cursor-pointer"
              >
                <FileText className="h-4 w-4 text-blue-600" />
                Audit trail
              </button>
            </div>

            {/* Timeline Feed Items */}
            <div className="relative pl-3 space-y-0 my-2">
              {[
                { id: '1', queryId: 'QRY-2026-00001', action: 'Draft response updated', user: 'Neha Singh', time: '7m ago', type: 'edit' },
                { id: '2', queryId: 'QRY-2026-00001', action: 'Draft response updated', user: 'Neha Singh', time: '7m ago', type: 'edit' },
                { id: '3', queryId: 'QRY-2026-00001', action: 'Final approval rejected', user: 'Jatin Rawat', time: '8m ago', type: 'reject' },
                { id: '4', queryId: 'QRY-2026-00001', action: 'Draft response updated', user: 'Neha Singh', time: '8m ago', type: 'edit' },
                { id: '5', queryId: 'QRY-2026-00001', action: 'Draft response updated', user: 'Neha Singh', time: '8m ago', type: 'edit' },
              ].map((item, i, arr) => (
                <div key={item.id} className="relative flex items-center gap-4 py-3 border-b border-slate-100/70 last:border-none">
                  {/* Vertical connecting line */}
                  {i < arr.length - 1 && (
                    <div className="absolute left-[19px] top-[40px] bottom-[-12px] w-0.5 bg-slate-100 z-0" />
                  )}

                  {/* Node Icon */}
                  <div className="relative z-10 shrink-0">
                    {item.type === 'reject' ? (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 border border-red-100">
                        <XCircle className="h-5 w-5" strokeWidth={2} />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                        <Pencil className="h-4.5 w-4.5" strokeWidth={2} />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] leading-snug">
                      <span className="font-extrabold text-blue-600 hover:underline cursor-pointer">{item.queryId}</span>
                      <span className="font-bold text-slate-800"> — {item.action}</span>
                    </div>
                    <div className="text-[12px] font-medium text-slate-400 mt-0.5">
                      {item.user}
                    </div>
                  </div>

                  {/* Time */}
                  <div className="text-[12px] font-medium text-slate-400 shrink-0">
                    {item.time}
                  </div>
                </div>
              ))}
            </div>
          </div>


        </div>
      </div>
    </div>
  );
}



