import { format, parseISO, isValid } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Neo-brutalist date picker. Controlled via an ISO `YYYY-MM-DD` string so it is
 * a drop-in for native <input type="date"> state.
 *
 * @param {string} value        ISO date string ('' when unset)
 * @param {(iso: string) => void} onChange
 * @param {string} placeholder
 */
export function DatePicker({ value, onChange, placeholder = 'Pick a date', className, id, 'aria-label': ariaLabel }) {
  const date = value ? parseISO(value) : undefined;
  const valid = date && isValid(date);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn('w-full justify-start text-left font-normal', !valid && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="h-4 w-4" />
          {valid ? format(date, 'PPP') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 border-0 shadow-none bg-transparent" align="start">
        <Calendar
          mode="single"
          selected={valid ? date : undefined}
          onSelect={(d) => onChange(d ? format(d, 'yyyy-MM-dd') : '')}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
