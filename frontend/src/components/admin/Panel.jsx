import { cn } from '@/utils/cn';

/**
 * The console's single card treatment.
 *
 * Three admin pages had re-declared this literal independently, which is how a
 * surface drifts. One elevation and one radius across the console; hierarchy
 * comes from type scale and spacing, not from competing shadows.
 */
export const PANEL_CLASS =
  'rounded-3xl border border-slate-200/80 bg-white shadow-sm';

export function Panel({ className, children, ...props }) {
  return (
    <div className={cn(PANEL_CLASS, 'p-5', className)} {...props}>
      {children}
    </div>
  );
}

/** A panel heading with an optional action on the right. */
export function PanelHeader({ id, title, action, note }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="font-heading text-[17px] font-black text-slate-900 m-0">
          {title}
        </h2>
        {note && <p className="m-0 mt-0.5 text-[11.5px] font-semibold text-slate-400">{note}</p>}
      </div>
      {action}
    </div>
  );
}
