import { Link } from 'react-router-dom';
import { Inbox, FileText, Mail, Clock, ShieldCheck, MoreVertical, Info } from 'lucide-react';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { ROLE_SLUG } from '@/constants/permissions';
import { useAuthStore } from '@/store/useAuthStore';

export function DashboardQueryList({ title, subtitle, icon: Icon = FileText, items, emptyText, totalCount, statusBadgeLabel }) {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);

  const getQueryDetailPath = (queryId) => {
    if (paths.QUERY_DETAIL) {
      return paths.QUERY_DETAIL.replace(':queryId', queryId);
    }
    const slug = ROLE_SLUG[currentUser?.role] || 'officer-in-charge';
    return `/${slug}/queries/${queryId}`;
  };

  return (
    <div className="liquid-glass-card rounded-3xl overflow-hidden flex flex-col justify-between h-full">
      <div>
        <div className="relative p-6 border-b border-white/60 flex justify-between items-center bg-[#f1f5fa]/60 backdrop-blur-md">
          <div className="flex items-center gap-4 relative z-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f1f5fa] text-purple-600 border border-white shadow-[5px_5px_10px_#d0d7e5,-5px_-5px_10px_#ffffff]">
              <Icon className="h-7 w-7" strokeWidth={2} />
            </div>
            <div>
              <h2 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">{title}</h2>
              <p className="m-0 text-[14px] font-medium text-slate-400 mt-1">{subtitle}</p>
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-2 rounded-xl bg-[#f1f5fa]/80 backdrop-blur-md px-4 py-2 text-[12.5px] font-extrabold text-purple-700 border border-white shadow-[4px_4px_8px_#d0d7e5,-4px_-4px_8px_#ffffff]">
            <Inbox className="h-4 w-4 text-purple-600" />
            <span>{items.length} listed</span>
          </div>
        </div>

        <div className="grid grid-cols-[160px_1fr_210px_130px_36px] gap-3 px-6 py-3 bg-[#e8eef5]/80 backdrop-blur-md shadow-[inset_2px_2px_4px_#c8cfde,inset_-2px_-2px_4px_#ffffff] text-[11px] font-extrabold text-slate-400 tracking-wider uppercase">
          <span>ID</span>
          <span>TITLE</span>
          <span className="text-center">STATUS</span>
          <span className="text-center">PRIORITY</span>
          <span></span>
        </div>

        <div className="p-4 space-y-3">
          {items.length === 0 && (
            <p className="py-6 text-center text-[13px] font-medium text-slate-400">
              {emptyText}
            </p>
          )}
          {items.map((query) => (
            <Link
              key={query.queryId}
              to={getQueryDetailPath(query.queryId)}
              className="group relative flex items-center justify-between gap-3 liquid-glass-row rounded-2xl p-3.5 transition-all overflow-hidden cursor-pointer"
            >
              <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-linear-to-b from-purple-500 to-indigo-600 rounded-l-2xl shadow-xs" />

              <div className="flex items-center gap-3 w-40 shrink-0 pl-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f1f5fa] text-purple-600 shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white">
                  <FileText className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div className="font-heading text-[13px] font-extrabold text-purple-700 group-hover:underline">
                  {query.queryId}
                </div>
              </div>

              <div className="h-8 w-px bg-slate-200/60 shrink-0" />

              <div className="flex items-center gap-3 flex-1 min-w-0 px-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] text-blue-600 shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white">
                  <Mail className="h-4.5 w-4.5" strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold text-slate-800 truncate group-hover:text-purple-700">
                    {query.subject || '(No Subject)'}
                  </div>
                  <div className="text-[11px] font-medium text-slate-400 mt-0.5">
                    Received {query.createdAt ? new Date(query.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '19 Aug 2026'} • {query.createdAt ? new Date(query.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '09:30 AM'}
                  </div>
                </div>
              </div>

              <div className="w-52.5 shrink-0 flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f5fa]/90 backdrop-blur-sm px-3.5 py-1.5 text-[11px] font-extrabold text-purple-700 shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff] border border-white/80">
                  <Clock className="h-3.5 w-3.5 text-purple-600" />
                  {statusBadgeLabel ? statusBadgeLabel(query) : (query.businessStatus || query.workflowState || 'PENDING FINAL APPROVAL')}
                </span>
              </div>

              <div className="w-32.5 shrink-0 flex justify-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f5fa]/90 backdrop-blur-sm px-3.5 py-1.5 text-[11px] font-extrabold text-blue-700 shadow-[inset_2px_2px_4px_#d0d7e5,inset_-2px_-2px_4px_#ffffff] border border-white/80">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                  {query.priority || 'NORMAL'}
                </span>
              </div>

              <div className="w-9 shrink-0 flex justify-end">
                <div className="p-1 rounded-lg text-slate-400 group-hover:text-slate-600 transition-colors">
                  <MoreVertical className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="p-5 border-t border-white/60 flex items-center justify-between bg-[#f1f5fa]">
        <div className="flex items-center gap-2">
          <Info className="h-5 w-5 text-purple-600 shrink-0" />
          <span className="text-[12px] font-semibold text-slate-600">
            Showing {items.length} of {totalCount} item{totalCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}
