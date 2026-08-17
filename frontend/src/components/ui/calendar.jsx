import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Calendar built on react-day-picker, styled with the project tokens +
 * enterprise .neo-* elevation. Used by DatePicker.
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3 neo-border rounded-md bg-card neo-shadow', className)}
      classNames={{
        months: 'relative',
        month: 'space-y-3',
        month_caption: 'flex justify-center items-center h-9 relative',
        caption_label: 'text-sm font-semibold',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between h-9 px-0.5',
        button_previous:
          'h-7 w-7 grid place-content-center neo-border rounded-md bg-card neo-interactive disabled:opacity-40 disabled:pointer-events-none',
        button_next:
          'h-7 w-7 grid place-content-center neo-border rounded-md bg-card neo-interactive disabled:opacity-40 disabled:pointer-events-none',
        chevron: 'h-4 w-4',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-xs font-medium text-muted-foreground',
        week: 'flex w-full mt-1',
        day: 'w-9 h-9 p-0 text-center text-sm',
        day_button:
          'w-9 h-9 rounded-md font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        today: 'font-bold text-primary',
        outside: 'text-muted-foreground/40',
        disabled: 'opacity-40',
        hidden: 'invisible',
        ...classNames,
      }}
      modifiersClassNames={{
        selected:
          'bg-primary text-primary-foreground rounded-md [&>button]:bg-transparent [&>button]:text-primary-foreground',
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? <ChevronLeft {...rest} className="h-4 w-4" /> : <ChevronRight {...rest} className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}

export { Calendar };
