import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Card, CardBody } from '@/components/ui/card';
import { ROLES, ROLE_LABELS } from '@/constants/roles';
import { ROUTE_PATHS } from '@/constants/routePaths';

export function AdminRolesPage() {
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Admin', path: ROUTE_PATHS.ADMIN }, { label: 'Roles' }]} />
      <PageHeader title="Roles" purpose="Role hierarchy — see docs/srs/03-stakeholders-and-roles.md for the full permission matrix." />
      <Card>
        <ul>
          {Object.values(ROLES).map((role) => (
            <li key={role} className="border-b border-border px-5 py-3 text-sm last:border-0">
              <span className="font-medium text-foreground">{ROLE_LABELS[role]}</span>
              <span className="ml-2 text-xs text-muted-foreground">{role}</span>
            </li>
          ))}
        </ul>
        <CardBody className="border-t border-border text-xs text-muted-foreground">
          Hierarchy does not automatically grant every workflow action — permissions are explicit.
        </CardBody>
      </Card>
    </div>
  );
}
