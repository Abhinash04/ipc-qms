import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, RotateCcw } from 'lucide-react';

import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { AuditTable } from '@/components/admin/AuditTable';
import { fetchAuditEvents } from '@/services/api/adminService';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { buildPath } from '@/constants/routePaths';
import { AUDIT_ACTION_OPTIONS, RESULT_OPTIONS, ACTOR_OPTIONS } from '@/constants/auditFilters';

const PAGE_SIZE = 50;

const EMPTY = { action: '', actorType: '', result: '', queryId: '', from: '', to: '' };

/**
 * Seeds the filters from the URL, so a link like `?result=failure` from the
 * Administration overview arrives with that filter already applied. Only the
 * known keys are read; anything else in the query string is ignored.
 */
function filtersFromSearch(searchParams) {
  const seeded = { ...EMPTY };
  for (const key of Object.keys(EMPTY)) {
    const value = searchParams.get(key);
    if (value) seeded[key] = value;
  }
  return seeded;
}

/**
 * The Audit & Activity Center — who did what, when, to which query, and what
 * happened afterward.
 *
 * Filtering happens on the server (the API takes the same parameters), so the
 * table is a page of the real collection rather than a filtered slice of
 * whatever happened to be fetched first.
 */
export function AdminActivityPage() {
  const paths = useRoutePaths();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => filtersFromSearch(searchParams));
  const [page, setPage] = useState(0);

  const applied = { ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE };

  const audit = useQuery({
    queryKey: ['audit', 'list', applied],
    queryFn: () => fetchAuditEvents(applied),
    retry: false,
  });

  const set = (key) => (event) => {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: event.target.value }));
  };

  const openQuery = (queryId) => {
    if (paths.QUERY_DETAIL) navigate(buildPath(paths.QUERY_DETAIL, { queryId }));
  };

  const events = audit.data?.events ?? [];
  const isFiltered = Object.values(filters).some(Boolean);
  const field =
    'h-9 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: 'Dashboard', path: paths.DASHBOARD },
          { label: 'Administration', path: paths.ADMINISTRATION },
          { label: 'Audit Trail' },
        ]}
      />
      <PageHeader
        title="Audit Trail"
        purpose="Every recorded system action, newest first. Filters are applied by the server."
      />

      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm">
        {/* Filters in one row above the table. */}
        <div className="mb-4 flex flex-wrap items-end gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Event</span>
            <select className={field} value={filters.action} onChange={set('action')}>
              <option value="">All events</option>
              {AUDIT_ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Actor</span>
            <select className={field} value={filters.actorType} onChange={set('actorType')}>
              <option value="">Anyone</option>
              {ACTOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Result</span>
            <select className={field} value={filters.result} onChange={set('result')}>
              <option value="">Any result</option>
              {RESULT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Query ID</span>
            <span className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                className={`${field} w-44 pl-8`}
                placeholder="QRY-2026-00001"
                value={filters.queryId}
                onChange={set('queryId')}
              />
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">From</span>
            <input type="date" className={field} value={filters.from.slice(0, 10)} onChange={set('from')} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">To</span>
            <input type="date" className={field} value={filters.to.slice(0, 10)} onChange={set('to')} />
          </label>

          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY);
                setPage(0);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        <AuditTable
          events={events}
          loading={audit.isLoading}
          error={audit.isError ? 'The audit API could not be reached.' : null}
          onOpenQuery={openQuery}
        />

        {!audit.isLoading && !audit.isError && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-[12px] font-semibold text-slate-500">
              Showing {events.length} event{events.length === 1 ? '' : 's'}
              {page > 0 && ` · page ${page + 1}`}
              {audit.data?.durable === false && ' · in-memory store, not durable'}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
                disabled={page === 0}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12.5px] font-bold text-slate-600 disabled:opacity-40 hover:enabled:bg-slate-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={events.length < PAGE_SIZE}
                className="rounded-xl border border-slate-200 px-3 py-1.5 text-[12.5px] font-bold text-slate-600 disabled:opacity-40 hover:enabled:bg-slate-50"
              >
                Next
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
