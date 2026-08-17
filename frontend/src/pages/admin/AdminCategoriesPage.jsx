import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { Card } from '@/components/ui/card';
import { ROUTE_PATHS } from '@/constants/routePaths';

const MOCK_CATEGORIES = ['Training & Development', 'Policy & Compliance', 'Technical Operations', 'Administration'];

export function AdminCategoriesPage() {
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Admin', path: ROUTE_PATHS.ADMIN }, { label: 'Categories' }]} />
      <PageHeader title="Categories" purpose="Query categories used for classification and AI-assisted assignment." />
      <Card>
        <ul>
          {MOCK_CATEGORIES.map((category) => (
            <li key={category} className="border-b border-border px-5 py-3 text-sm text-foreground last:border-0">
              {category}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
