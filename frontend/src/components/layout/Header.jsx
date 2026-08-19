import { useNavigate } from 'react-router-dom';
import { RotateCcwIcon } from 'lucide-react';

import { roleHome } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { ROLE_LABELS, ROLES } from '@/constants/roles';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const SWITCHABLE_USERS = MOCK_USERS.filter((user) => user.role !== ROLES.INQUIRER);

function initials(name) {
  return (
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function Header() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const resetDemo = useWorkflowStore((state) => state.resetDemo);
  const persistenceError = useWorkflowStore((state) => state.persistenceError);
  const { data, isLoading, isError } = useHealthCheck();
  
  const switchUser = (userId) => {
    login(userId);
    navigate(roleHome(findUserById(userId)?.role));
  };

  const status = isLoading ? 'checking' : isError ? 'offline' : data?.status === 'healthy' ? 'online' : 'offline';
  
  const badgeStyles = {
    online: 'bg-status-green-bg border-status-green-line text-status-green-fg',
    checking: 'bg-muted border-border text-status-gray-fg',
    offline: 'bg-[#fff1f1] border-error-border text-[#b91c1c]',
  };
  
  const dotStyles = {
    online: 'bg-[#22c55e]',
    checking: 'bg-muted-foreground',
    offline: 'bg-destructive',
  };

  return (
    <header className="flex h-13.5 shrink-0 items-center justify-between border-b border-border bg-[#e5e5e5] px-6.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex items-center gap-1.25 text-[11.5px] font-semibold border rounded-[6px] px-2.5 py-0.75 ${badgeStyles[status]}`}>
          <span className={`w-1.25 h-1.25 rounded-full ${dotStyles[status]}`} />
          Backend: {status}
        </span>
        {persistenceError && (
          <span className={`inline-flex items-center gap-1.25 text-[11.5px] font-semibold border rounded-[6px] px-2.5 py-0.75 ${badgeStyles.offline}`} title={persistenceError}>
            Storage unavailable
          </span>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <button
          onClick={resetDemo}
          title="Reset all workflow progress to the seeded starting state"
          className="flex items-center gap-1.5 rounded-[7px] border border-border bg-muted px-3 py-1.25 text-[12.5px] font-medium text-status-gray-fg cursor-pointer hover:bg-accent transition-colors"
        >
          <RotateCcwIcon className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          Reset demo data
        </button>

        <div className="w-px h-4.5 bg-border" />

        <div className="flex items-center gap-1.75">
          <span className="text-[12px] text-muted-foreground">Viewing as</span>
          <Select value={currentUser?.id || ''} onValueChange={switchUser}>
            <SelectTrigger className="flex items-center gap-1.75 h-auto border border-border bg-muted rounded-[20px] p-[5px_10px_5px_6px] text-[12.5px] font-semibold text-accent-foreground hover:bg-accent transition-colors focus:ring-0 focus:ring-offset-0">
              <SelectValue>
                <div className="flex items-center gap-1.75">
                  <div className="w-6 h-6 rounded-full bg-[#ede9fe] border-[1.5px] border-[#c4b5fd] flex items-center justify-center text-[9.5px] font-bold text-[#7c3aed]">
                    {initials(currentUser?.name)}
                  </div>
                  {currentUser?.name} — {ROLE_LABELS[currentUser?.role]}
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SWITCHABLE_USERS.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-5.5 w-5.5 items-center justify-center rounded-full bg-[#ede9fe] font-heading text-[9px] font-bold text-[#7c3aed]">
                      {initials(user.name)}
                    </span>
                    {user.name} — {ROLE_LABELS[user.role]}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
