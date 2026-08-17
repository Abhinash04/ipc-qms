import { cva } from 'class-variance-authority';

export const tabsListVariants = cva(
  'inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground',
  {
    variants: {
      variant: {
        default: 'border border-border shadow-sm bg-muted',
        line: 'gap-1 bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);
