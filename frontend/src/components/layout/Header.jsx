import { useNavigate } from 'react-router-dom';
import { RotateCcwIcon } from 'lucide-react';

import { roleHome } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { ROLE_LABELS } from '@/constants/roles';
import { MOCK_USERS, findUserById } from '@/constants/mockUsers';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { IpcLogo } from '@/components/common/IpcLogo';

const SWITCHABLE_USERS = MOCK_USERS;

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
    online: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    checking: 'bg-slate-100 border-slate-200 text-slate-600',
    offline: 'bg-red-50 border-red-200 text-red-700',
  };

  const dotStyles = {
    online: 'bg-emerald-500',
    checking: 'bg-slate-400',
    offline: 'bg-red-500',
  };

  return (
    <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-6 shadow-xs z-20">
      <div className="flex items-center gap-6">
        <IpcLogo size="md" variant="light" />

        <div className="hidden xl:flex items-center gap-3 pl-4 border-l border-slate-200">
          <span className={`inline-flex items-center gap-2 text-[12px] font-extrabold border rounded-full px-3.5 py-1 shadow-2xs transition-all ${badgeStyles[status]}`}>
            <span className={`w-2 h-2 rounded-full ${dotStyles[status]} shadow-xs animate-pulse`} />
            Backend: <span className="capitalize">{status}</span>
          </span>
          {persistenceError && (
            <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-bold border rounded-full px-3 py-1 ${badgeStyles.offline}`} title={persistenceError}>
              Storage unavailable
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={resetDemo}
          title="Reset all workflow progress to the seeded starting state"
          className="group flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-3.5 py-2 text-[12.5px] font-bold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-2xs cursor-pointer active:scale-95"
        >
          <RotateCcwIcon className="h-3.5 w-3.5 text-slate-500 group-hover:rotate-180 transition-transform duration-500" aria-hidden="true" strokeWidth={2.2} />
          <span>Reset demo data</span>
        </button>

        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline-block text-[12.5px] font-medium text-slate-400">Viewing as</span>
          <Select value={currentUser?.id || ''} onValueChange={switchUser}>
            <SelectTrigger className="flex items-center gap-2.5 h-auto border border-purple-200/80 bg-purple-50/50 hover:bg-purple-100/60 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-slate-800 transition-all focus:ring-0 focus:ring-offset-0 shadow-2xs cursor-pointer [&>svg]:text-purple-600">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-purple-600 text-white shadow-xs flex items-center justify-center text-[10.5px] font-black">
                    {initials(currentUser?.name)}
                  </div>
                  <span className="font-extrabold text-slate-800">{currentUser?.name}</span>
                  <span className="hidden lg:inline-block text-slate-400 font-medium">— {ROLE_LABELS[currentUser?.role]}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-77.5 max-h-96 p-1.5 rounded-2xl shadow-xl border border-slate-200/80 bg-white z-50">
              {SWITCHABLE_USERS.map((user) => (
                <SelectItem key={user.id} value={user.id} className="py-2.5 px-3 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f3e8ff] text-status-purple-fg text-[11px] font-extrabold shrink-0 border border-purple-200/50">
                      {initials(user.name)}
                    </span>
                    <span className="text-[13px] font-extrabold text-slate-800 leading-tight">
                      {user.name} <span className="font-medium text-slate-400">— {ROLE_LABELS[user.role]}</span>
                    </span>
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

