import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { PageHeader } from '@/components/common/PageHeader';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { UserCheck } from 'lucide-react';

function initials(name) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function AssignmentsListPage() {
  const paths = useRoutePaths();
  const officials = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Assignments' }]} />
      <PageHeader
        title="Assigned Officials"
        purpose="List of Assigned Officials available for query assignment."
        icon={UserCheck}
        actions={
          <span className="rounded-full bg-primary-50 px-3 py-1 text-[12.5px] font-semibold text-primary">
            {officials.length} active
          </span>
        }
      />

      <section
        aria-label="Assigned officials"
        className="overflow-hidden rounded-2xl border border-transparent bg-surface shadow-card"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-start text-[14px]">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-[11.5px] font-semibold uppercase tracking-wider text-ink-muted">
                <th scope="col" className="px-5 py-3 text-start">Official Name</th>
                <th scope="col" className="px-5 py-3 text-start">Email Address</th>
                <th scope="col" className="px-5 py-3 text-start">Division</th>
                <th scope="col" className="px-5 py-3 text-start">Areas of Expertise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {officials.map((official) => (
                <tr key={official.id} className="transition-colors hover:bg-surface-muted">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[12.5px] font-semibold text-primary">
                        {initials(official.name)}
                      </span>
                      <span className="font-semibold text-ink">{official.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-ink-soft">{official.email}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-wider text-slate-600">
                      {official.divisionId}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {(official.expertise || []).map((exp) => (
                        <span key={exp} className="inline-flex items-center rounded-md bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary">
                          {exp}
                        </span>
                      ))}
                      {(!official.expertise || official.expertise.length === 0) && (
                        <span className="text-[13px] italic text-ink-muted">No expertise listed</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
