import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0-100. undefined/null = barra indeterminada (animación de carga sin % conocido). */
  value?: number | null;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(({ className, value, ...props }, ref) => (
  <div ref={ref} className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} {...props}>
    {value == null ? (
      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
    ) : (
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    )}
  </div>
));
Progress.displayName = 'Progress';
