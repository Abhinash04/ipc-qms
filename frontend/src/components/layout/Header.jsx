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
    online: 'bg-[#f0fdf4] border-[#bbf7d0] text-[#16a34a]',
    checking: 'bg-[#f8fafc] border-[#e2e8f0] text-[#64748b]',
    offline: 'bg-[#fff1f1] border-[#fecaca] text-[#b91c1c]',
  };
  
  const dotStyles = {
    online: 'bg-[#22c55e]',
    checking: 'bg-[#94a3b8]',
    offline: 'bg-[#ef4444]',
  };

  return (
    <header className="flex h-[54px] shrink-0 items-center justify-between border-b border-[#e2e8f0] bg-[#fff] px-[26px] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex items-center gap-[5px] text-[11.5px] font-semibold border rounded-[6px] px-[10px] py-[3px] ${badgeStyles[status]}`}>
          <span className={`w-[5px] h-[5px] rounded-full ${dotStyles[status]}`} />
          Backend: {status}
        </span>
        {persistenceError && (
          <span className={`inline-flex items-center gap-[5px] text-[11.5px] font-semibold border rounded-[6px] px-[10px] py-[3px] ${badgeStyles.offline}`} title={persistenceError}>
            Storage unavailable
          </span>
        )}
      </div>

      <div className="flex items-center gap-[10px]">
        <button
          onClick={resetDemo}
          title="Reset all workflow progress to the seeded starting state"
          className="flex items-center gap-[6px] rounded-[7px] border border-[#e2e8f0] bg-[#f8fafc] px-[12px] py-[5px] text-[12.5px] font-medium text-[#64748b] cursor-pointer hover:bg-[#f1f5f9] transition-colors"
        >
          <RotateCcwIcon className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          Reset demo data
        </button>

        <div className="w-[1px] h-[18px] bg-[#e2e8f0]" />

        <div className="flex items-center gap-[7px]">
          <span className="text-[12px] text-[#94a3b8]">Viewing as</span>
          <Select value={currentUser?.id || ''} onValueChange={switchUser}>
            <SelectTrigger className="flex items-center gap-[7px] h-auto border border-[#e2e8f0] bg-[#f8fafc] rounded-[20px] p-[5px_10px_5px_6px] text-[12.5px] font-semibold text-[#1e293b] hover:bg-[#f1f5f9] transition-colors focus:ring-0 focus:ring-offset-0">
              <SelectValue>
                <div className="flex items-center gap-[7px]">
                  <div className="w-[24px] h-[24px] rounded-full bg-[#ede9fe] border-[1.5px] border-[#c4b5fd] flex items-center justify-center text-[9.5px] font-bold text-[#7c3aed]">
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
                    <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#ede9fe] font-heading text-[9px] font-bold text-[#7c3aed]">
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
