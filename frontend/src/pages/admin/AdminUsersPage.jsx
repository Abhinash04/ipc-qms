import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { MOCK_USERS } from '@/constants/mockUsers';
import { ROLE_LABELS } from '@/constants/roles';
import { findDivisionById } from '@/constants/mockDivisions';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function AdminUsersPage() {
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Admin', path: ROUTE_PATHS.ADMIN }, { label: 'Users' }]} />
      <PageHeader title="Users" purpose="Mock user directory — replace with API data once auth exists." />
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow hoverable={false}>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Division</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_USERS.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium text-foreground">{user.name}</TableCell>
                <TableCell>
                  <Badge variant="status-blue">{ROLE_LABELS[user.role]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{findDivisionById(user.divisionId)?.name || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
