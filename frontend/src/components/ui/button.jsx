import { Slot } from 'radix-ui';

import { cn } from '@/utils/cn';
import { buttonVariants } from '@/components/ui/button-variants';

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
