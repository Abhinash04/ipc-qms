import RotateCcwIcon from 'lucide-react/dist/esm/icons/rotate-ccw.mjs';

import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { ROLE_LABELS, ROLES } from '@/constants/roles';
import { MOCK_USERS } from '@/constants/mockUsers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const SWITCHABLE_USERS = MOCK_USERS.filter((user) => user.role !== ROLES.INQUIRER);

export function Header() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const login = useAuthStore((state) => state.login);
  const resetDemo = useWorkflowStore((state) => state.resetDemo);
  const persistenceError = useWorkflowStore((state) => state.persistenceError);
  const { data, isLoading, isError } = useHealthCheck();

  const status = isLoading ? 'checking' : isError ? 'offline' : data?.status === 'healthy' ? 'online' : 'offline';
  const statusVariant = status === 'online' ? 'status-green' : status === 'checking' ? 'status-gray' : 'status-red';

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-card px-6">
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant}>Backend: {status}</Badge>
        {persistenceError && (
          <Badge variant="status-red" title={persistenceError}>
            Storage unavailable — changes won't persist
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={resetDemo} title="Reset all workflow progress to the seeded starting state">
          <RotateCcwIcon className="h-4 w-4" aria-hidden="true" />
          Reset demo data
        </Button>

        <div className="flex items-center gap-2">
          <label htmlFor="user-switcher" className="text-xs text-muted-foreground">
            Viewing as
          </label>
          <Select id="user-switcher" value={currentUser?.id || ''} onValueChange={(id) => login(id)}>
            <SelectTrigger className="w-56" size="sm">
              <SelectValue placeholder="Select a user" />
            </SelectTrigger>
            <SelectContent>
              {SWITCHABLE_USERS.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} — {ROLE_LABELS[user.role]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
