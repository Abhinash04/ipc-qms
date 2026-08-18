import { Card, CardBody } from '@/components/ui/card';
import { cn } from '@/utils/cn';

export function StatTile({ label, value, icon: Icon, className }) {
  return (
    <Card className={cn(className)}>
      <CardBody className="flex items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
        {Icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
