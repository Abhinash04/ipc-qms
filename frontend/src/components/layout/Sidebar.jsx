import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from '@/constants/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { cn } from '@/utils/cn';

export function Sidebar() {
  const role = useAuthStore((state) => state.currentUser?.role);
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center border-b border-border px-4">
        <span className="text-sm font-semibold tracking-tight text-foreground">QMS</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Primary">
        {items.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/dashboard'}
            className={({ isActive }) =>
              cn(
                'relative flex items-center gap-2.5 rounded-md py-2 pl-3 pr-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isActive && 'bg-muted font-medium text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity',
                    isActive && 'opacity-100',
                  )}
                  aria-hidden="true"
                />
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
