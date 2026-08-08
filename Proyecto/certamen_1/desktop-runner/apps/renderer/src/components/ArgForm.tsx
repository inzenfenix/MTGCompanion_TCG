import type { ArgDef } from '@/lib/types';
import { Input, Label, Select, Checkbox } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Props {
  args: ArgDef[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}

export function ArgForm({ args, values, onChange, disabled }: Props) {
  if (args.length === 0) {
    return <p className="text-xs text-muted-foreground">Este script no tiene parámetros: corre con sus valores por defecto.</p>;
  }

  const pickFile = async (name: string, multiple: boolean) => {
    if (!window.electronAPI) return;
    if (multiple) {
      const paths = await window.electronAPI.pickFiles();
      if (paths.length) onChange(name, paths);
    } else {
      const p = await window.electronAPI.pickFile();
      if (p) onChange(name, p);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {args.map((arg) => {
        const value = values[arg.name];
        return (
          <div key={arg.name} className={arg.kind === 'files' ? 'sm:col-span-2' : undefined}>
            <Label htmlFor={arg.name}>
              {arg.label}
              {arg.required ? <span className="text-destructive"> *</span> : null}
            </Label>

            {arg.kind === 'boolean' && (
              <div className="mt-1 flex items-center gap-2">
                <Checkbox
                  id={arg.name}
                  checked={Boolean(value)}
                  disabled={disabled}
                  onChange={(e) => onChange(arg.name, e.target.checked)}
                />
              </div>
            )}

            {arg.kind === 'select' && (
              <Select
                id={arg.name}
                className="mt-1"
                value={String(value ?? '')}
                disabled={disabled}
                onChange={(e) => onChange(arg.name, e.target.value)}
              >
                {(arg.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            )}

            {(arg.kind === 'number' || arg.kind === 'float') && (
              <Input
                id={arg.name}
                className="mt-1"
                type="number"
                step={arg.kind === 'float' ? 'any' : 1}
                value={value === undefined || value === null ? '' : String(value)}
                disabled={disabled}
                onChange={(e) => onChange(arg.name, e.target.value === '' ? undefined : Number(e.target.value))}
              />
            )}

            {arg.kind === 'string' && (
              <Input
                id={arg.name}
                className="mt-1"
                type="text"
                value={String(value ?? '')}
                disabled={disabled}
                onChange={(e) => onChange(arg.name, e.target.value)}
              />
            )}

            {(arg.kind === 'file' || arg.kind === 'files') && (
              <div className="mt-1 flex items-center gap-2">
                <Input
                  id={arg.name}
                  type="text"
                  placeholder="Ruta de archivo…"
                  value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
                  disabled={disabled}
                  onChange={(e) => onChange(arg.name, e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || !window.electronAPI}
                  onClick={() => pickFile(arg.name, arg.kind === 'files')}
                >
                  Elegir…
                </Button>
              </div>
            )}

            {arg.help && <p className="mt-1 text-[11px] text-muted-foreground">{arg.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
