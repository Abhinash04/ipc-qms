import { cn } from '@/utils/cn';

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-2xl border border-transparent bg-card text-card-foreground shadow-card',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn('border-b border-line px-5 py-4', className)}
      {...props}
    />
  );
}

function CardTitleBar({ title, description, actions, as: Heading = 'h2', className, id }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        <Heading id={id} className="font-heading text-[17px] font-semibold leading-tight text-ink">
          {title}
        </Heading>
        {description && <p className="mt-1 text-[12.5px] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

function CardBody({ className, ...props }) {
  return <div data-slot="card-body" className={cn('px-5 py-4', className)} {...props} />;
}

function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn('border-t border-line px-5 py-3 text-[12.5px] text-ink-muted', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitleBar, CardBody, CardFooter };
