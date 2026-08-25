import { TrendingUp, Calendar, CalendarClock, CalendarCheck } from 'lucide-react';
import { cn } from '@/utils/cn';
import { AUDIT_EVENT } from '@/constants/statusEnums';

function since(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function closureRate(auditEvents, closedQueryIds, from, to = new Date()) {
  const received = auditEvents.filter(
    (e) => e.event === AUDIT_EVENT.QUERY_RECEIVED && new Date(e.at) >= from && new Date(e.at) < to,
  );
  if (received.length === 0) return null;
  const closed = received.filter((e) => closedQueryIds.has(e.queryId)).length;
  return { percent: Math.round((closed / received.length) * 100), received: received.length, closed };
}

const RATE_ROW_STYLES = [
  { icon: Calendar, text: 'text-blue-600', bar: 'bg-blue-600' },
  { icon: CalendarClock, text: 'text-purple-600', bar: 'bg-purple-600' },
  { icon: CalendarCheck, text: 'text-emerald-600', bar: 'bg-emerald-500' },
];

export function DashboardResolutionRate({ visibleAudit, closedQueryIds }) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const rates = [
    { label: 'This month', rate: closureRate(visibleAudit, closedQueryIds, startOfMonth) },
    { label: 'This week', rate: closureRate(visibleAudit, closedQueryIds, since(7)) },
    { label: 'Last week', rate: closureRate(visibleAudit, closedQueryIds, since(14), since(7)) },
  ];

  return (
    <div className="bg-[#f1f5fa] rounded-3xl border border-white/80 p-6 shadow-[12px_12px_24px_#d0d7e5,-12px_-12px_24px_#ffffff] flex flex-col justify-between sticky top-6 self-start">
      <div>
        <div className="flex justify-between items-start mb-6">
          <div className="flex gap-4 items-start">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f1f5fa] text-blue-600 border border-white shadow-[5px_5px_10px_#d0d7e5,-5px_-5px_10px_#ffffff]">
              <TrendingUp className="h-7 w-7" strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="font-heading text-[26px] font-black text-slate-900 m-0 leading-tight">Resolution rate</h3>
              <p className="text-[14px] font-normal text-slate-400 m-0 mt-1 max-w-60 leading-relaxed">
                Share of enquiries received in each period that are now closed
              </p>
            </div>
          </div>

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

        <div className="space-y-4">
          {rates.map(({ label, rate }, i) => {
            const { icon: RowIcon, text, bar } = RATE_ROW_STYLES[i];
            return (
              <div key={label}>
                {i > 0 && <div className="h-px bg-slate-200/50 mb-4" />}
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f1f5fa] shadow-[3px_3px_6px_#d0d7e5,-3px_-3px_6px_#ffffff] border border-white',
                    text,
                  )}>
                    <RowIcon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[14px] font-bold text-slate-800">{label}</span>
                      <span className={cn('text-[14px] font-extrabold', rate ? text : 'text-slate-400')}>
                        {rate ? `${rate.percent}%` : 'No data'}
                      </span>
                    </div>
                    <div className="h-3 rounded-full bg-[#e6ebf2] shadow-[inset_2px_2px_4px_#c8cfde,inset_-2px_-2px_4px_#ffffff] overflow-hidden w-full p-0.5">
                      {rate && (
                        <div
                          className={cn('h-full rounded-full transition-all duration-500', bar)}
                          style={{ width: `${rate.percent}%` }}
                        />
                      )}
                    </div>
                    {rate && (
                      <div className="mt-1 text-[12px] font-medium text-slate-400">
                        {rate.closed} of {rate.received} closed
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
