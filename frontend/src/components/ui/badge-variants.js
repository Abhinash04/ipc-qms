import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a]:hover:bg-primary-hover',
        secondary: 'border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        destructive:
          'border-status-red-line bg-status-red-bg text-status-red-fg focus-visible:ring-destructive/20 [a]:hover:bg-status-red-bg/70',
        outline:
          'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        ghost: 'border-transparent hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
        'status-green': 'border-status-green-line bg-status-green-bg text-status-green-fg',
        'status-amber': 'border-status-amber-line bg-status-amber-bg text-status-amber-fg',
        'status-blue': 'border-status-blue-line bg-status-blue-bg text-status-blue-fg',
        'status-indigo': 'border-status-indigo-line bg-status-indigo-bg text-status-indigo-fg',
        'status-purple': 'border-status-purple-line bg-status-purple-bg text-status-purple-fg',
        'status-orange': 'border-status-orange-line bg-status-orange-bg text-status-orange-fg',
        'status-red': 'border-status-red-line bg-status-red-bg text-status-red-fg',
        'status-gray': 'border-status-gray-line bg-status-gray-bg text-status-gray-fg',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);
