import BellIcon from 'lucide-react/dist/esm/icons/bell.mjs';

import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardBody } from '@/components/ui/card';
import { ROUTE_PATHS } from '@/constants/routePaths';

const MOCK_NOTIFICATIONS = [
  { id: 1, message: 'QRY-2026-00427 was assigned to you.', at: '2026-08-10T14:00:00.000Z' },
  { id: 2, message: 'Amit Mehta completed Review Level 1 on QRY-2026-00427.', at: '2026-08-12T16:00:00.000Z' },
];

export function NotificationsPage() {
  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: ROUTE_PATHS.DASHBOARD }, { label: 'Notifications' }]} />
      <PageHeader title="Notifications" purpose="Workflow events relevant to you. Channels (email/in-app) to be confirmed with client." />
      <Card className="overflow-hidden">
        {MOCK_NOTIFICATIONS.length === 0 ? (
          <EmptyState icon={BellIcon} title="No notifications" description="You're all caught up." />
        ) : (
          <ul>
            {MOCK_NOTIFICATIONS.map((note) => (
              <li key={note.id} className="flex gap-3 border-b border-border px-5 py-3 text-sm last:border-0">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <BellIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-foreground">{note.message}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{new Date(note.at).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <CardBody className="border-t border-border text-xs text-muted-foreground">
          Real-time delivery requires notification infrastructure (see docs/srs/10-notifications.md).
        </CardBody>
      </Card>
    </div>
  );
}
