import { cn } from '@/lib/utils';
import { STATUS_META } from '@/constants';
import { statusDotClass } from './statusTone';
import { MarkdownRenderer } from '@/components/markdown/MarkdownRenderer';

export function CaseTimeline({ events = [] }) {
  if (!events.length) {
    return <p className="text-sm text-muted-foreground">No history recorded yet.</p>;
  }

  return (
    <ol className="relative ml-2 border-l border-border">
      {events.map((e) => {
        const meta = STATUS_META[e.to_state] || { label: e.to_state };
        return (
          <li key={e.id} className="relative ml-6 pb-6 last:pb-0">
            <span
              className={cn(
                'absolute -left-7.75 top-0.5 h-3 w-3 rounded-full ring-4 ring-background',
                statusDotClass(e.to_state),
              )}
            />
            <p className="text-sm leading-snug">
              <span className="font-medium text-foreground">{meta.label}</span>
              {e.actor_name && <span className="text-muted-foreground"> · {e.actor_name}</span>}
              <span className="text-muted-foreground"> · {new Date(e.created_at).toLocaleString()}</span>
            </p>
            {e.note && (
              <div className="mt-1 prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
                <MarkdownRenderer markdown={e.note} allowRawHtml={false} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
