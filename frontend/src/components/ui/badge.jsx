import { Slot } from 'radix-ui';

import { cn } from '@/utils/cn';
import { badgeVariants } from '@/components/ui/badge-variants';

/**
 * Legacy variant names from the pre-shadcn Badge, mapped onto the cva
 * `status-*` keys with equivalent soft bg/border/fg treatment.
 */
const LEGACY_VARIANT_ALIASES = {
  neutral: 'status-gray',
  success: 'status-green',
  warning: 'status-amber',
  info: 'status-blue',
  danger: 'status-red',
};

function Badge({
  className,
  variant = 'neutral',
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot.Root : 'span';
  const resolvedVariant = LEGACY_VARIANT_ALIASES[variant] || variant;

  return (
    <Comp
      data-slot="badge"
      data-variant={resolvedVariant}
      className={cn(badgeVariants({ variant: resolvedVariant }), className)}
      {...props}
    />
  );
}

export { Badge };
