import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Card, CardBody } from '@/components/ui/card';
import { SECTION, SECTIONS } from '@/constants/routeSections';
import { useRoutePaths } from '@/hooks/useRoutePaths';

const ADMIN_AREAS = [
  { section: SECTION.USERS, description: 'Manage user accounts and role assignment.' },
  { section: SECTION.ROLES_DIRECTORY, description: 'View the role hierarchy and permissions.' },
  { section: SECTION.DIVISIONS, description: 'Manage organizational divisions.' },
  { section: SECTION.WORKFLOWS, description: 'Configure dynamic review-level templates.' },
  { section: SECTION.CATEGORIES, description: 'Manage query categories.' },
];

export function AdminOverviewPage() {
  const paths = useRoutePaths();
  const areas = ADMIN_AREAS.filter((area) => paths[area.section]);

  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Administration' }]} />
      <PageHeader title="Administration" purpose="System configuration areas." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((area) => {
          const { label, icon: Icon } = SECTIONS[area.section];
          return (
            <Link key={area.section} to={paths[area.section]}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardBody className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{area.description}</p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
