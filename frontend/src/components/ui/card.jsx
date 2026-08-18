import { cn } from '@/utils/cn';

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-xl border border-border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn('border-b border-border px-5 py-4', className)}
      {...props}
    />
  );
}

function CardBody({ className, ...props }) {
  return <div data-slot="card-body" className={cn('px-5 py-4', className)} {...props} />;
}

export { Card, CardHeader, CardBody };
