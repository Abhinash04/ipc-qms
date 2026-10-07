import { useEffect, useState } from 'react';
import { FileText, History, Mail, Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';

const SECTIONS = [
  { id: 'case-summary', label: 'Summary', Icon: Sparkles },
  { id: 'case-email-thread', label: 'Emails', Icon: Mail, count: 'emails' },
  { id: 'case-response', label: 'Response', Icon: FileText },
  { id: 'case-audit-history', label: 'History', Icon: History, count: 'events' },
];


function useSectionInView() {
  const [active, setActive] = useState(SECTIONS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    for (const { id } of SECTIONS) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return [active, setActive];
}


export function CaseSectionBar({ emails = 0, events = 0, stickyClassName = 'top-20' }) {
  const [active, setActive] = useSectionInView();
  const counts = { emails, events };

  return (
    <nav
      aria-label="Case sections"
      className={cn(
        'sticky z-20 overflow-x-auto rounded-xl border border-slate-200 bg-card px-1.5 py-1.5 shadow-sm',
        stickyClassName,
      )}
    >
      <ul className="m-0 flex list-none gap-1 p-0">
        {SECTIONS.map(({ id, label, Icon, count }) => (
          <li key={id} className="shrink-0">
            <a
              href={`#${id}`}
              aria-current={active === id ? 'location' : undefined}
              onClick={(event) => {
                const target = document.getElementById(id);
                if (!target) return;
                event.preventDefault();
                setActive(id);
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
                active === id ? 'bg-primary-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
              {count && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px] font-bold',
                    active === id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {counts[count]}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
