import { useId } from 'react';
import { cn } from '@/utils/cn';


const TONES = {
  default: 'border-slate-200/80 bg-card',
  ai: 'border-violet-200/70 border-s-[3px] border-s-violet-500 bg-linear-to-b from-violet-50/70 to-card',
  action: 'border-primary-100 bg-primary-50/40',
  context: 'border-slate-200/80 bg-card',
};

const ICON_TONES = {
  default: 'bg-slate-100 text-slate-600',
  ai: 'bg-violet-100 text-violet-700',
  action: 'bg-primary-100 text-primary-700',
  context: 'bg-slate-100 text-slate-600',
};


const BANNER = 'bg-linear-to-r from-primary-700 to-primary-600';

const DOTS = {
  backgroundImage: 'radial-gradient(rgba(255,255,255,0.22) 1px, transparent 1.2px)',
  backgroundSize: '12px 12px',
};


const artDelay = (seed) => {
  let hash = 0;
  for (const char of String(seed || '')) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return { '--art-delay': `-${(hash % 50) / 10}s` };
};

function BannerArt({ art, compact, seed }) {
  const [Main, First, Second] = art;
  if (compact) {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-0 w-24 overflow-hidden" style={artDelay(seed)}>
        <span className="art-breathe absolute -end-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
        <Main className="art-float absolute end-3 top-1/2 h-11 w-11 text-white/25" strokeWidth={1.4} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 end-0 hidden w-56 overflow-hidden sm:block"
      style={artDelay(seed)}
    >
      <span
        className="art-dots absolute inset-y-0 end-0 w-40 [mask-image:linear-gradient(to_left,black,transparent)]"
        style={DOTS}
      />
      <span className="art-breathe absolute -end-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
      <span
        className="art-breathe absolute end-20 -bottom-12 h-24 w-24 rounded-full bg-white/[0.07]"
        style={{ animationDelay: 'calc(var(--art-delay, 0s) - 3s)' }}
      />
      <Main className="art-float absolute end-6 top-1/2 h-16 w-16 text-white/25" strokeWidth={1.4} />
      {First && <First className="art-drift-a absolute end-28 top-2.5 h-6 w-6 text-white/30" strokeWidth={1.7} />}
      {Second && <Second className="art-drift-b absolute end-24 bottom-2 h-5 w-5 text-white/25" strokeWidth={1.7} />}
    </span>
  );
}

function BannerShine({ seed }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={artDelay(seed)}>
      <span className="art-shine absolute inset-y-0 start-0 w-1/4" />
    </span>
  );
}

function CaseCardHeader({ tone, icon: Icon, title, headingId, meta, badge, actions, padX, compact, banner, art, illustrated }) {
  return (
    <header
      className={cn(
        'relative flex flex-wrap items-center gap-x-3 gap-y-2',
        padX,
        banner ? cn(BANNER, 'py-4 text-white') : cn('border-b border-slate-200/60', compact ? 'py-3' : 'py-3.5'),
        illustrated && (compact ? 'overflow-hidden pe-20' : 'min-h-[76px] overflow-hidden sm:pe-40'),
      )}
    >
      {illustrated && <BannerShine seed={title} />}
      {illustrated && <BannerArt art={art} compact={compact} seed={title} />}
      {Icon && (
        <span
          className={cn(
            'relative flex shrink-0 items-center justify-center rounded-lg',
            banner ? 'h-9 w-9 bg-white/15 text-white ring-1 ring-white/25' : cn('h-8 w-8', ICON_TONES[tone]),
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
      )}
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id={headingId}
            className={cn('m-0 font-heading font-semibold leading-tight', banner ? 'text-[17px] text-white' : 'text-[16px] text-slate-900')}
          >
            {title}
          </h2>
          {badge}
        </div>
        {meta && <p className={cn('m-0 mt-0.5 text-[12.5px]', banner ? 'text-white/80' : 'text-slate-500')}>{meta}</p>}
      </div>
      {actions && <div className="relative flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CaseCard({
  tone = 'default',
  icon: Icon,
  title,
  meta,
  badge,
  actions,
  footer,
  children,
  className,
  bodyClassName,
  compact = false,
  banner = false,
  art,
  toolbar,
}) {
  const illustrated = banner && art?.length > 0;
  const headingId = useId();
  const padX = compact ? 'px-4' : 'px-4 sm:px-5';

  return (
    <section
      data-slot="panel"
      data-tone={tone}
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        'min-w-0 overflow-hidden rounded-[14px] border shadow-xs transition-colors',
        banner ? 'border-slate-200/80 bg-card' : TONES[tone],
        className,
      )}
    >
      {title && (
        <CaseCardHeader
          tone={tone}
          icon={Icon}
          title={title}
          headingId={headingId}
          meta={meta}
          badge={badge}
          actions={actions}
          padX={padX}
          compact={compact}
          banner={banner}
          art={art}
          illustrated={illustrated}
        />
      )}
      {toolbar && (
        <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200/70 bg-slate-50/70 py-2.5', padX)}>
          {toolbar}
        </div>
      )}
      <div className={cn(padX, compact ? 'py-3' : 'py-4', bodyClassName)}>{children}</div>
      {footer && (
        <footer className={cn('border-t border-slate-200/60 py-2.5 text-[12px] text-slate-500', padX)}>{footer}</footer>
      )}
    </section>
  );
}

const PILL_TONES = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200/80',
  info: 'bg-primary-50 text-primary-700 ring-primary-200/80',
  ai: 'bg-violet-50 text-violet-800 ring-violet-200/80',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200/80',
  danger: 'bg-rose-50 text-rose-800 ring-rose-200/80',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200/80',
};

export function Pill({ tone = 'neutral', className, children, ...props }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 whitespace-nowrap', PILL_TONES[tone], className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function CardAction({ className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-card px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
            value === option.value ? 'bg-card text-primary-700 shadow-xs' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
