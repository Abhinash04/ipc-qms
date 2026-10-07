import { createElement } from 'react';
import { BadgeCheck, Briefcase, Check, ClipboardCheck, Crown, Handshake, Inbox, User, UserCheck, UserRound, Users } from 'lucide-react';

import { buildCaseOfficials } from '@/constants/caseOfficials';
import { STAGE_STATUS } from '@/constants/queryLifecycle';
import { CaseCard } from '@/components/common/CaseCard';
import { initials } from '@/utils/initials';
import { cn } from '@/utils/cn';

const STATUS = {
  [STAGE_STATUS.COMPLETE]: { label: 'Completed', pill: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  [STAGE_STATUS.CURRENT]: { label: 'Current', pill: 'bg-primary-50 text-primary-700 ring-primary-200', dot: 'bg-primary-600 motion-safe:animate-pulse' },
  [STAGE_STATUS.PENDING]: { label: 'Pending', pill: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-300' },
};

const ROLE_ICONS = [
  [/inquirer/i, UserRound],
  [/front office/i, Inbox],
  [/officer-in-charge/i, Crown],
  [/assigned/i, Briefcase],
  [/reviewer/i, ClipboardCheck],
  [/final approval/i, BadgeCheck],
];

function RoleIcon({ role, ...props }) {
  const icon = ROLE_ICONS.find(([pattern]) => pattern.test(role))?.[1] || User;
  return createElement(icon, props);
}

function PersonCard({ person, order }) {
  const status = STATUS[person.status] || STATUS[STAGE_STATUS.PENDING];
  const current = person.status === STAGE_STATUS.CURRENT;

  return (
    <li
      className={cn(
        'relative flex min-w-0 items-start gap-3 rounded-xl border p-3 transition-colors',
        current ? 'border-primary-300 bg-primary-50/50 ring-1 ring-primary-200' : 'border-slate-200 bg-card hover:border-slate-300 hover:bg-slate-50/60',
      )}
      title={`${person.role}: ${person.name || 'not yet assigned'} — ${status.label}`}
    >
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold',
          person.name ? 'bg-linear-to-br from-primary-100 to-primary-50 text-primary-700' : 'bg-slate-100 text-slate-400',
        )}
        aria-hidden="true"
      >
        {initials(person.name)}
      </span>

      <div className="min-w-0 flex-1 pe-6">
        <p className="m-0 flex items-center gap-1.5 text-[11.5px] font-medium text-slate-500">
          <RoleIcon role={person.role} className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="truncate">{person.role}</span>
        </p>
        <p className={cn('m-0 truncate text-[14px] font-semibold', person.name ? 'text-slate-900' : 'text-slate-400')}>
          {person.name || 'Not yet assigned'}
        </p>
        <span className={cn('mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', status.pill)}>
          {person.status === STAGE_STATUS.COMPLETE ? (
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
          ) : (
            <span className={cn('h-1.5 w-1.5 rounded-full', status.dot)} aria-hidden="true" />
          )}
          {status.label}
        </span>
      </div>

      <span className="absolute end-2.5 top-2 text-[10.5px] font-semibold tabular-nums text-slate-400" aria-hidden="true">
        #{order}
      </span>
    </li>
  );
}

export function CaseOfficialsCard({ query, steps, audit }) {
  const officials = buildCaseOfficials({ query, steps, audit });
  if (officials.length === 0) return null;

  const done = officials.filter((person) => person.status === STAGE_STATUS.COMPLETE).length;
  const percent = Math.round((done / officials.length) * 100);

  return (
    <CaseCard
      tone="team"
      banner
      art={[Handshake, UserCheck, Users]}
      icon={Users}
      title="Officials"
      meta={`${done} of ${officials.length} hand-offs complete`}
      toolbar={
        <div className="flex w-full items-center gap-3">
          <span className="shrink-0 text-[12px] font-semibold text-slate-600">Hand-offs</span>
          <span
            className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-label="Hand-offs complete"
            aria-valuemin={0}
            aria-valuemax={officials.length}
            aria-valuenow={done}
          >
            <span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-700" style={{ width: `${percent}%` }} />
          </span>
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-600">
            {done}/{officials.length}
          </span>
        </div>
      }
    >
      <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {officials.map((person, index) => (
          <PersonCard key={person.role} person={person} order={index + 1} />
        ))}
      </ol>
    </CaseCard>
  );
}
