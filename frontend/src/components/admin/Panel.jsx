import { cn } from '@/utils/cn';

export const PANEL_CLASS =
  'rounded-2xl border border-transparent bg-surface shadow-card';

export function Panel({ className, children, ...props }) {
  return (
    <div className={cn(PANEL_CLASS, 'p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({ id, title, action, note }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="m-0 font-heading text-[17px] font-semibold text-ink">
          {title}
        </h2>
        {note && <p className="m-0 mt-0.5 text-[12px] text-ink-muted">{note}</p>}
      </div>
      {action}
    </div>
  );
}
