import { useNavigate } from 'react-router-dom';
import { RotateCcwIcon } from 'lucide-react';

import { roleHome } from '@/constants/routePaths';
import { useAuthStore } from '@/store/useAuthStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
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

  const switchUser = (userId) => {
    login(userId);
    navigate(roleHome(findUserById(userId)?.role));
  };

  return (
    <header className="relative z-20 px-5 pt-5 lg:px-7">
      <div className="pointer-events-none absolute inset-x-10 top-4 h-20 rounded-full bg-[radial-gradient(circle,rgba(124,77,255,0.12)_0%,rgba(52,120,246,0.1)_40%,rgba(255,255,255,0)_75%)] blur-2xl" />
      <div className="glass-panel aurora-panel flex min-h-20 items-center justify-between rounded-[28px] px-5 py-3">
        <div className="flex items-center gap-6">
          <IpcLogo size="md" variant="light" />

          {persistenceError && (
            <div className="hidden xl:flex items-center gap-3 pl-4 border-l border-white/50">
              <span className="glass-pill inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-bold bg-red-50 border-red-200 text-red-700" title={persistenceError}>
                Storage unavailable
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={resetDemo}
            className="glass-control flex h-auto items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-slate-600 transition-all hover:-translate-y-0.5 hover:text-rose-600 focus:outline-none cursor-pointer"
            title="Reset database to initial state"
          >
            <RotateCcwIcon className="h-4 w-4" />
            <span className="hidden sm:inline-block">Reset demo data</span>
          </button>

          <div className="flex items-center gap-2.5">
            <span className="hidden sm:inline-block text-[12.5px] font-medium text-slate-400">Viewing as</span>
            <Select value={currentUser?.id || ''} onValueChange={switchUser}>
              <SelectTrigger className="glass-control flex h-auto items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-bold text-slate-800 transition-all hover:-translate-y-0.5 focus:ring-0 focus:ring-offset-0 cursor-pointer [&>svg]:text-purple-600">
                <SelectValue>
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7C4DFF,#3478F6)] text-[10.5px] font-black text-white shadow-[0_8px_16px_rgba(124,77,255,0.3)]">
                      {initials(currentUser?.name)}
                    </div>
                    <span className="font-extrabold text-slate-800">{currentUser?.name}</span>
                    <span className="hidden lg:inline-block text-slate-400 font-medium">— {ROLE_LABELS[currentUser?.role]}</span>
                  </div>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="glass-panel w-77.5 max-h-96 rounded-2xl p-1.5 shadow-xl z-50">
                {SWITCHABLE_USERS.map((user) => (
                  <SelectItem key={user.id} value={user.id} className="rounded-xl px-3 py-2.5 cursor-pointer transition-colors hover:bg-white/80">
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
      </div>
    </header>
  );
}

