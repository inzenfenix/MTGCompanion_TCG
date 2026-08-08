import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-transparent bg-muted text-muted-foreground',
      running: 'border-transparent bg-blue-100 text-blue-700 animate-pulse',
      success: 'border-transparent bg-green-100 text-green-700',
      error: 'border-transparent bg-red-100 text-red-700',
      stopped: 'border-transparent bg-amber-100 text-amber-800',
      outline: 'border-border text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
