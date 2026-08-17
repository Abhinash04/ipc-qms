import CircleUser from 'lucide-react/dist/esm/icons/circle-user.mjs';
import { useAuthStore } from '@/store/useAuthStore';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { ROLE_LABELS } from '@/constants/roles';
import { Badge } from '@/components/ui/badge';

export function Header() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const { data, isLoading, isError } = useHealthCheck();

  const status = isLoading ? 'checking' : isError ? 'offline' : data?.status === 'healthy' ? 'online' : 'offline';
  const statusVariant = status === 'online' ? 'status-green' : status === 'checking' ? 'status-gray' : 'status-red';

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <Badge variant={statusVariant}>Backend: {status}</Badge>
      {currentUser && (
        <div className="flex items-center gap-2.5">
          <CircleUser className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div className="text-right leading-tight">
            <p className="text-sm font-medium text-foreground">{currentUser.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[currentUser.role]}</p>
          </div>
        </div>
      )}
    </header>
  );
}
