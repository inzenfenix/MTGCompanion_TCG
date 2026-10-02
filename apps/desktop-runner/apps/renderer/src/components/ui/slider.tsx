import * as React from 'react';
import { cn } from '@/lib/utils';

// Slider hecho a mano sobre <input type="range"> (mismo criterio que el
// resto de apps/renderer/src/components/ui/*: sin dependencia de Radix) —
// alcanza y sostiene, no necesita drag multi-thumb ni marcas.
export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number;
  onValueChange: (value: number) => void;
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, disabled, ...props }, ref) => (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className={cn(
        'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Slider.displayName = 'Slider';
