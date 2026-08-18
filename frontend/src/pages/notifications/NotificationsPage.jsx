import { Link } from 'react-router-dom';
import { BellIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Breadcrumb } from '@/components/common/Breadcrumb';
import { EmptyState } from '@/components/common/EmptyState';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useAuthStore } from '@/store/useAuthStore';
import { ROLE_LABELS } from '@/constants/roles';
import { buildPath } from '@/constants/routePaths';
import { useRoutePaths } from '@/hooks/useRoutePaths';

export function NotificationsPage() {
  const paths = useRoutePaths();
  const currentUser = useAuthStore((state) => state.currentUser);
  const notifications = useWorkflowStore((state) => state.notifications);
  const ordered = [...notifications].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div>
      <Breadcrumb items={[{ label: 'Dashboard', path: paths.DASHBOARD }, { label: 'Notifications' }]} />
      <PageHeader
        title="Notifications"
        purpose="Workflow events raised as the query moves. Delivery channels (email/in-app) to be confirmed with client."
      />
      <Card className="overflow-hidden">
        {ordered.length === 0 ? (
          <EmptyState icon={BellIcon} title="No notifications" description="You're all caught up." />
        ) : (
          <ul>
            {ordered.map((note) => {
              const forMe = note.recipientRole === currentUser?.role;
              return (
                <li key={note.notificationId} className="flex gap-3 border-b border-border px-5 py-3 text-sm last:border-0">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <BellIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">{note.message}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant={forMe ? 'status-blue' : 'status-gray'}>
                        {ROLE_LABELS[note.recipientRole] || note.recipientRole}
                      </Badge>
                      {note.queryId && (
                        <Link
                          to={buildPath(paths.QUERY_DETAIL, { queryId: note.queryId })}
                          className="text-xs text-ring hover:underline"
                        >
                          {note.queryId}
                        </Link>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(note.at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <CardBody className="border-t border-border text-xs text-muted-foreground">
          Notifications are generated in-app as workflow transitions occur. Real delivery infrastructure is not implemented — see docs/srs/10-notifications.md.
        </CardBody>
      </Card>
    </div>
  );
}
