import { Link } from 'react-router-dom';
import { CheckCircle2 as CheckCircle2Icon } from 'lucide-react';
import { buildPath } from '@/constants/routePaths';
import { useRoutePaths } from '@/hooks/useRoutePaths';

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

export function DashboardRecentlyClosed({ recentlyClosed }) {
  const paths = useRoutePaths();

  return (
    <div className="bg-white rounded-3xl border border-slate-200/70 p-6 shadow-sm flex flex-col justify-between h-full">
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100/60 shadow-2xs">
              <CheckCircle2Icon className="h-7 w-7" strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">Recently closed</h3>
              <p className="text-[14px] font-normal text-slate-400 m-0 mt-1 max-w-70">
                Closed queries appear here once a response has been dispatched.
              </p>
            </div>
          </div>
        </div>

        {recentlyClosed.length === 0 ? (
          <div className="my-4 rounded-2xl border border-dashed border-emerald-200/80 bg-[#f8fcf9] p-8 flex flex-col items-center justify-center text-center">
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
                className="flex items-center gap-3 p-3.5 rounded-2xl transition-colors bg-emerald-50/40 hover:bg-emerald-50/80 mb-2.5 border border-emerald-100/70 shadow-2xs cursor-pointer"
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
  );
}
