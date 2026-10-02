import * as React from 'react';
import { cn } from '@/lib/utils';

type TabItemStatus = 'missing' | 'running' | 'success' | 'error';

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  items: { value: string; label: string; status?: TabItemStatus }[];
  className?: string;
}

// Ícono chico por pestaña — refleja el progreso de "Correr Todo"/"Correr
// todo" (ver useRunAllStatus.ts) sin agregar texto: ○ gris = todavía no
// corrió nada de esta pestaña en la corrida actual, spinner = corriendo
// ahora, ✓ verde = terminó bien, ✗ rojo = terminó con error. Sin `status`
// (uso normal, fuera de una corrida) no se renderiza nada.
function StatusDot({ status }: { status?: TabItemStatus }) {
  if (!status || status === 'missing') return null;
  if (status === 'running') {
    return (
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground"
        aria-label="corriendo"
      />
    );
  }
  if (status === 'success') {
    return (
      <span className="text-success" aria-label="listo">
        ✓
      </span>
    );
  }
  return (
    <span className="text-destructive" aria-label="error">
      ✗
    </span>
  );
}

export function Tabs({ value, onValueChange, items, className }: TabsProps) {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-lg bg-muted p-1', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onValueChange(item.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === item.value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <StatusDot status={item.status} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
