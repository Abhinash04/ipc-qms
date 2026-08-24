import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLES } from '@/constants/roles';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { useRoutePaths } from '@/hooks/useRoutePaths';
import { UserCheck } from 'lucide-react';
import { cn } from '@/utils/cn';

export function AssignmentsListPage() {
  const paths = useRoutePaths();
  const officials = MOCK_USERS.filter((u) => u.role === ROLES.ASSIGNED_OFFICIAL);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6">
        <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Assignments' }]} />
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-heading text-[40px] font-black text-slate-900 leading-tight">Assigned Officials</h1>
            <span className="glass-pill rounded-full px-4 py-1.5 text-[14px] font-semibold text-blue-700">
              {officials.length} active
            </span>
          </div>
        </div>
        <p className="mt-3 text-[15.5px] font-medium text-slate-500">
          List of Assigned Officials available for query assignment.
        </p>
      </div>

      <div className="flex-1 rounded-[24px] border border-white/60 bg-white/40 p-4 shadow-sm backdrop-blur-md">
        <div className="overflow-hidden rounded-[16px] border border-white/50 bg-white/60 shadow-sm">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b border-white/50 bg-white/40 text-[13px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4">Official Name</th>
                <th className="px-6 py-4">Email Address</th>
                <th className="px-6 py-4">Division</th>
                <th className="px-6 py-4">Areas of Expertise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/50">
              {officials.map((official) => (
                <tr key={official.id} className="group transition-colors hover:bg-white/40">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="clay-icon-surface flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                        <UserCheck className="h-5 w-5" />
                      </div>
                      <span className="font-semibold text-slate-900">{official.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-600 font-medium">{official.email}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1.5 text-[12px] font-extrabold uppercase tracking-wider text-slate-600 ring-1 ring-inset ring-slate-500/10">
                      {official.divisionId}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      {(official.expertise || []).map((exp) => (
                        <span key={exp} className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 ring-1 ring-inset ring-blue-700/10">
                          {exp}
                        </span>
                      ))}
                      {(!official.expertise || official.expertise.length === 0) && (
                        <span className="text-slate-400 italic text-[13px]">No expertise listed</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
