import { Slot } from 'radix-ui';

import { cn } from '@/utils/cn';
import { buttonVariants } from '@/components/ui/button-variants';

/**
 * Legacy variant names from the pre-shadcn Button, mapped onto the cva keys
 * that produce an equivalent look. `secondary`/`ghost` already match cva key
 * names 1:1 and pass through unchanged.
 */
const LEGACY_VARIANT_ALIASES = {
  primary: 'default',
};

function Button({
  className,
  variant = 'primary',
  size = 'default',
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot.Root : 'button';
  const resolvedVariant = LEGACY_VARIANT_ALIASES[variant] || variant;

  return (
    <Comp
      data-slot="button"
      data-variant={resolvedVariant}
      data-size={size}
      className={cn(buttonVariants({ variant: resolvedVariant, size, className }))}
      {...props}
    />
  );
}

export { Button };
