import { Link } from 'react-router-dom';
import UsersIcon from 'lucide-react/dist/esm/icons/users.mjs';
import ShieldIcon from 'lucide-react/dist/esm/icons/shield.mjs';
import Building2Icon from 'lucide-react/dist/esm/icons/building-2.mjs';
import WorkflowIcon from 'lucide-react/dist/esm/icons/workflow.mjs';
import TagIcon from 'lucide-react/dist/esm/icons/tag.mjs';

import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Card, CardBody } from '@/components/ui/card';
import { ROUTE_PATHS } from '@/constants/routePaths';

const ADMIN_AREAS = [
  { label: 'Users', path: ROUTE_PATHS.ADMIN_USERS, description: 'Manage user accounts and role assignment.', icon: UsersIcon },
  { label: 'Roles', path: ROUTE_PATHS.ADMIN_ROLES, description: 'View the role hierarchy and permissions.', icon: ShieldIcon },
  { label: 'Divisions', path: ROUTE_PATHS.ADMIN_DIVISIONS, description: 'Manage organizational divisions.', icon: Building2Icon },
  { label: 'Workflows', path: ROUTE_PATHS.ADMIN_WORKFLOWS, description: 'Configure dynamic review-level templates.', icon: WorkflowIcon },
  { label: 'Categories', path: ROUTE_PATHS.ADMIN_CATEGORIES, description: 'Manage query categories.', icon: TagIcon },
];

export function AdminOverviewPage() {
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Admin' }]} />
      <PageHeader title="Admin" purpose="System configuration areas." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_AREAS.map((area) => (
          <Link key={area.path} to={area.path}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardBody className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <area.icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-foreground">{area.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{area.description}</p>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
