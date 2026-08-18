import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Card } from '@/components/ui/card';
import { MOCK_DIVISIONS } from '@/constants/mockDivisions';
import { MOCK_USERS } from '@/constants/mockUsers';
import { useRoutePaths } from '@/hooks/useRoutePaths';

export function AdminDivisionsPage() {
  const paths = useRoutePaths();
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Admin', path: paths.ADMINISTRATION }, { label: 'Divisions' }]} />
      <PageHeader title="Divisions" purpose="Organizational divisions and their assigned members." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {MOCK_DIVISIONS.map((division) => {
          const members = MOCK_USERS.filter((user) => user.divisionId === division.id);
          return (
            <Card key={division.id}>
              <div className="border-b border-border px-5 py-3">
                <p className="font-medium text-foreground">{division.name}</p>
                <p className="text-xs text-muted-foreground">{division.id}</p>
              </div>
              <ul className="px-5 py-3 text-sm text-muted-foreground">
                {members.length ? members.map((m) => <li key={m.id}>{m.name}</li>) : <li>No members</li>}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
